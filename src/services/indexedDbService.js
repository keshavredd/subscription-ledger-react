/**
 * indexedDbService.js
 * High-performance browser IndexedDB persistence for Parquet datasets & parsed buffers.
 * Enables 0ms instant dashboard opening on repeat sessions directly from local disk.
 */

const DB_NAME = 'ET_SubscriptionLedger_DB';
const DB_VERSION = 1;
const STORE_NAME = 'parquet_cache';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      console.warn("IndexedDB failed to open:", event.target.error);
      resolve(null);
    };
  });

  return dbPromise;
}

/**
 * Save binary Parquet ArrayBuffer to IndexedDB
 */
export async function setCachedParquet(key, dataBuffer, meta = {}) {
  const db = await openDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const record = {
        key,
        buffer: dataBuffer,
        timestamp: Date.now(),
        meta
      };

      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch (e) {
      console.warn(`Failed to cache ${key} in IndexedDB`, e);
      resolve(false);
    }
  });
}

/**
 * Retrieve binary Parquet ArrayBuffer from IndexedDB
 */
export async function getCachedParquet(key, maxAgeMs = 12 * 60 * 60 * 1000) { // Default 12 hr TTL
  const db = await openDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        const record = req.result;
        if (!record) {
          resolve(null);
          return;
        }

        // Check if cache entry is expired
        const age = Date.now() - (record.timestamp || 0);
        if (age > maxAgeMs) {
          console.log(`[IndexedDB] Cache expired for ${key} (${Math.round(age / 60000)}m old)`);
          resolve(null);
          return;
        }

        console.log(`[IndexedDB] Loaded cached ${key} from local disk (${Math.round(record.buffer.byteLength / 1024)} KB)`);
        resolve(record);
      };

      req.onerror = () => resolve(null);
    } catch (e) {
      console.warn(`Failed to read ${key} from IndexedDB`, e);
      resolve(null);
    }
  });
}

/**
 * Clear all cached datasets from IndexedDB
 */
export async function clearParquetCache() {
  const db = await openDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}
