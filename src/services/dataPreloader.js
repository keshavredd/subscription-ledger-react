/**
 * dataPreloader.js
 * Ultra-fast hybrid dataset preloader:
 * 1. Instant IndexedDB Cache Load (<50ms load time).
 * 2. Background Live Google Sheets Sync with graceful error catching.
 * 3. Lazy DuckDB-Wasm background registration for Conversational AI SQL queries.
 */
import Papa from 'papaparse';
import { getCachedParquet, setCachedParquet } from './indexedDbService';
import { registerParquetTable } from './duckdbService';

export const CACHE_VERSION = 'v11_gsheets';

export const DATASET_URLS = {
  subscription: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=598826199",
  funnel: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1049115614",
  realtime: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1333104452",
  renewals: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=renewal_raw",
  arpu: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=arpu_data"
};

const dataCache = {
  subscription: null,
  funnel: null,
  realtime: null,
  renewals: null,
  arpu: null
};

const activePromises = {};

/**
 * Fetch and load a dataset using:
 * 1. Instant In-Memory Cache (0ms)
 * 2. Instant IndexedDB Local Disk Cache (<50ms)
 * 3. Live Google Sheets CSV — the backend of record
 *    (realtime & funnel also re-sync hourly in the background)
 */
export async function fetchDatasetCached(key, fallbackUrl, parseConfig = {}) {
  // 1. Instant Memory Cache (0ms)
  if (dataCache[key]) {
    // Only 'realtime' and 'funnel' sync latest hourly changes in background from Google Sheets
    if ((key === 'realtime' || key === 'funnel') && (fallbackUrl || DATASET_URLS[key])) {
      syncLiveDatasetInBackground(key, fallbackUrl, parseConfig);
    }
    return Promise.resolve(dataCache[key]);
  }

  if (activePromises[key]) {
    return activePromises[key];
  }

  activePromises[key] = (async () => {
    // 2. Instant IndexedDB Local Disk Cache (<50ms)
    try {
      const cached = await getCachedParquet(key, 2 * 60 * 60 * 1000, CACHE_VERSION); // 2 hr TTL
      if (cached && cached.data && cached.data.length > 0) {
        console.log(`⚡ [Fast-Path] Instant load '${key}' from IndexedDB cache (${cached.data.length} rows)...`);
        const result = { data: cached.data, source: 'indexeddb-fast' };
        dataCache[key] = result;
        
        // Only 'realtime' and 'funnel' sync latest hourly changes in background from Google Sheets
        if (key === 'realtime' || key === 'funnel') {
          syncLiveDatasetInBackground(key, fallbackUrl, parseConfig);
        }

        return result;
      }
    } catch (dbErr) {
      console.warn(`[Preloader] IndexedDB check failed for ${key}`, dbErr);
    }

    // 3. Live Google Sheets CSV (the primary backend)
    console.log(`[Preloader] Fetching live Google Sheet data for ${key}...`);
    return syncLiveDataset(key, fallbackUrl, parseConfig);
  })();

  return activePromises[key];
}

async function syncLiveDataset(key, fallbackUrl, parseConfig) {
  const targetUrl = (fallbackUrl || DATASET_URLS[key]) + (DATASET_URLS[key] && DATASET_URLS[key].includes('?') ? '&' : '?') + `_t=${Date.now()}`;
  try {
    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const csvText = await res.text();

    return new Promise((resolve) => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        ...parseConfig,
        complete: (results) => {
          const result = { data: results.data, source: 'live-gsheet' };
          dataCache[key] = result;
          
          // Cache parsed records in IndexedDB for instant subsequent loads
          setCachedParquet(key, null, { version: CACHE_VERSION, data: results.data });

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('dataset-updated', { detail: { key, data: results.data } }));
          }

          resolve(result);
        },
        error: (err) => {
          console.warn(`PapaParse error for ${key}:`, err);
          resolve(dataCache[key] || { data: [], source: 'fallback-empty' });
        }
      });
    });
  } catch (err) {
    console.warn(`[Preloader] Live fetch error for ${key}:`, err.message);
    return dataCache[key] || { data: [], source: 'fallback-empty' };
  }
}

/**
 * Forces a fresh fetch from the live Google Sheet, bypassing all caches.
 * Used by the manual "Sync" button; the 'dataset-updated' event notifies the UI.
 */
export async function refreshDataset(key, fallbackUrl) {
  return syncLiveDataset(key, fallbackUrl, {});
}

function syncLiveDatasetInBackground(key, fallbackUrl, parseConfig) {
  // Only realtime and funnel should ever fetch from Google Sheets
  if (key !== 'realtime' && key !== 'funnel') return;

  setTimeout(async () => {
    syncLiveDataset(key, fallbackUrl, parseConfig)
      .then(() => console.log(`🔄 [Background Sync] '${key}' updated with latest live Google Sheets data`))
      .catch(err => console.warn(`Background sync error for ${key}:`, err));
  }, 100);
}

/**
 * Preloads dashboard datasets with intelligent priority scheduling:
 * 1. Priority 1: Active realtime dataset & funnel dataset loaded immediately
 * 2. Priority 2: Stagger heavy cohort & historical tables by 400ms so initial render is instantaneous
 */
export function preloadAllDashboardData() {
  fetchDatasetCached('realtime', DATASET_URLS.realtime);
  fetchDatasetCached('funnel', DATASET_URLS.funnel);

  setTimeout(() => {
    fetchDatasetCached('renewals', DATASET_URLS.renewals);
    fetchDatasetCached('arpu', DATASET_URLS.arpu);
    fetchDatasetCached('subscription', DATASET_URLS.subscription);
  }, 400);
}

// Auto-start preloading immediately when script mounts
if (typeof window !== 'undefined') {
  preloadAllDashboardData();
}
