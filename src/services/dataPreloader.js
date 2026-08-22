/**
 * dataPreloader.js
 * High-speed dataset preloader using DuckDB-Wasm + Parquet + IndexedDB persistent caching.
 * Loads pre-compressed Parquet files in micro-seconds and caches them locally for 0ms loads.
 */
import Papa from 'papaparse';
import { getCachedParquet, setCachedParquet } from './indexedDbService';
import { registerParquetTable, queryDuckDBSQL } from './duckdbService';

export const DATASET_URLS = {
  subscription: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=598826199",
  funnel: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1049115614",
  realtime: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1333104452",
  renewals: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=renewal_raw"
};

const dataCache = {
  subscription: null,
  funnel: null,
  realtime: null,
  renewals: null
};

const activePromises = {};

/**
 * Fetch and load a dataset using IndexedDB cache -> Parquet -> CSV fallback pipeline
 */
export async function fetchDatasetCached(key, fallbackUrl, parseConfig = {}) {
  if (dataCache[key]) {
    return Promise.resolve(dataCache[key]);
  }

  if (activePromises[key]) {
    return activePromises[key];
  }

  activePromises[key] = (async () => {
    // 1. Try reading cached Parquet binary from IndexedDB (0ms load time!)
    try {
      const cachedRecord = await getCachedParquet(key);
      if (cachedRecord && cachedRecord.buffer) {
        console.log(`⚡ [Fast-Path] Loading '${key}' from IndexedDB Parquet cache...`);
        await registerParquetTable(key, cachedRecord.buffer);
        const rows = await queryDuckDBSQL(`SELECT * FROM ${key}`);
        const result = { data: rows, source: 'indexeddb-parquet' };
        dataCache[key] = result;
        return result;
      }
    } catch (dbErr) {
      console.warn(`[Preloader] IndexedDB check failed for ${key}, trying network...`, dbErr);
    }

    // 2. Try fetching static Parquet binary file from /data/{key}.parquet
    try {
      const parquetUrl = `/data/${key}.parquet`;
      console.log(`[Preloader] Fetching compressed Parquet: ${parquetUrl}`);
      const res = await fetch(parquetUrl);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        
        // Cache buffer in IndexedDB in background
        setCachedParquet(key, buffer);

        // Register with DuckDB WASM engine
        await registerParquetTable(key, buffer);
        const rows = await queryDuckDBSQL(`SELECT * FROM ${key}`);
        const result = { data: rows, source: 'network-parquet' };
        dataCache[key] = result;
        return result;
      }
    } catch (parquetErr) {
      console.warn(`[Preloader] Static Parquet fetch failed for ${key}, falling back to CSV...`, parquetErr);
    }

    // 3. Fallback: Fetch raw CSV from Google Sheets / URL
    console.log(`[Preloader] Fallback to CSV for ${key}...`);
    const targetUrl = fallbackUrl || DATASET_URLS[key];
    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const csvText = await res.text();

    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        ...parseConfig,
        complete: (results) => {
          dataCache[key] = results;
          resolve(results);
        },
        error: (err) => reject(err)
      });
    });
  })();

  return activePromises[key];
}

/**
 * Preloads all dashboard datasets in parallel
 */
export function preloadAllDashboardData() {
  fetchDatasetCached('subscription', DATASET_URLS.subscription);
  fetchDatasetCached('funnel', DATASET_URLS.funnel);
  fetchDatasetCached('realtime', DATASET_URLS.realtime);
  fetchDatasetCached('renewals', DATASET_URLS.renewals);
}

// Auto-start preloading immediately when script mounts
if (typeof window !== 'undefined') {
  preloadAllDashboardData();
}
