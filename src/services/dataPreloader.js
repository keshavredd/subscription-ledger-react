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
import { isTursoConfigured, fetchTursoTable } from './tursoService';

export const CACHE_VERSION = 'v9_realtime_828';

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
 * 1. Instant IndexedDB Cache (<50ms)
 * 2. Turso Database HTTP SQL (<100ms) when configured
 * 3. Live Google Sheets CSV fallback
 */
export async function fetchDatasetCached(key, fallbackUrl, parseConfig = {}) {
  if (dataCache[key]) {
    return Promise.resolve(dataCache[key]);
  }

  if (activePromises[key]) {
    return activePromises[key];
  }

  activePromises[key] = (async () => {
    // 1. Turso Database HTTP Fast-Path (<100ms) - Direct live DB query when configured
    if (isTursoConfigured()) {
      try {
        console.log(`⚡ [Turso DB] Fetching live dataset '${key}' from Turso Database...`);
        const tursoResult = await fetchTursoTable(key);
        if (tursoResult && tursoResult.data && tursoResult.data.length > 0) {
          dataCache[key] = tursoResult;
          setCachedParquet(key, null, { version: CACHE_VERSION, data: tursoResult.data });
          return tursoResult;
        }
      } catch (tursoErr) {
        console.warn(`[Preloader] Turso DB fetch failed for '${key}', falling back to cache...`, tursoErr);
      }
    }

    // 2. IndexedDB Client Cache Fallback (<50ms)
    try {
      const cached = await getCachedParquet(key, 15 * 60 * 1000, CACHE_VERSION); // 15 min TTL
      if (cached && cached.data && cached.data.length > 0) {
        console.log(`⚡ [Fast-Path] Instant load '${key}' from IndexedDB cache (${cached.data.length} rows)...`);
        const result = { data: cached.data, source: 'indexeddb-fast' };
        dataCache[key] = result;
        
        // Trigger silent background sync from Google Sheets
        syncLiveDatasetInBackground(key, fallbackUrl, parseConfig);

        return result;
      }
    } catch (dbErr) {
      console.warn(`[Preloader] IndexedDB check failed for ${key}, fetching live data...`, dbErr);
    }

    // 3. Google Sheets CSV fetch fallback
    console.log(`[Preloader] Fetching live Google Sheet data for ${key}...`);
    return syncLiveDataset(key, fallbackUrl, parseConfig);
  })();

  return activePromises[key];
}

async function syncLiveDataset(key, fallbackUrl, parseConfig) {
  const targetUrl = fallbackUrl || DATASET_URLS[key];
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

function syncLiveDatasetInBackground(key, fallbackUrl, parseConfig) {
  setTimeout(async () => {
    if (isTursoConfigured()) {
      try {
        const tursoResult = await fetchTursoTable(key);
        if (tursoResult && tursoResult.data && tursoResult.data.length > 0) {
          dataCache[key] = tursoResult;
          setCachedParquet(key, null, { version: CACHE_VERSION, data: tursoResult.data });
          console.log(`🔄 [Background Sync] '${key}' revalidated with latest Turso DB data`);
          return;
        }
      } catch (e) {
        console.warn(`Background Turso sync failed for ${key}`, e);
      }
    }
    syncLiveDataset(key, fallbackUrl, parseConfig)
      .then(() => console.log(`🔄 [Background Sync] '${key}' updated with latest live Google Sheets data`))
      .catch(err => console.warn(`Background sync error for ${key}:`, err));
  }, 100);
}

/**
 * Preloads all dashboard datasets in parallel
 */
export function preloadAllDashboardData() {
  fetchDatasetCached('subscription', DATASET_URLS.subscription);
  fetchDatasetCached('funnel', DATASET_URLS.funnel);
  fetchDatasetCached('realtime', DATASET_URLS.realtime);
  fetchDatasetCached('renewals', DATASET_URLS.renewals);
  fetchDatasetCached('arpu', DATASET_URLS.arpu);
}

// Auto-start preloading immediately when script mounts
if (typeof window !== 'undefined') {
  preloadAllDashboardData();
}
