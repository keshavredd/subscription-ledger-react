/**
 * dataPreloader.js
 * Background preloader service that fetches and parses Google Sheets data
 * while the user is logging in, ensuring instant dashboard rendering with zero wait time.
 */
import Papa from 'papaparse';

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

export function fetchDatasetCached(key, url, parseConfig = {}) {
  if (dataCache[key]) {
    return Promise.resolve(dataCache[key]);
  }

  if (activePromises[key]) {
    return activePromises[key];
  }

  activePromises[key] = fetch(url)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.text();
    })
    .then(csvText => {
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
    })
    .catch(err => {
      console.warn(`Dataset prefetch error [${key}]:`, err);
      activePromises[key] = null;
      throw err;
    });

  return activePromises[key];
}

/**
 * Preloads all dashboard datasets in parallel immediately on page load / login screen
 */
export function preloadAllDashboardData() {
  fetchDatasetCached('subscription', DATASET_URLS.subscription);
  fetchDatasetCached('funnel', DATASET_URLS.funnel);
  fetchDatasetCached('realtime', DATASET_URLS.realtime);
  fetchDatasetCached('renewals', DATASET_URLS.renewals);
}

// Auto-start preloading immediately when this service is imported
if (typeof window !== 'undefined') {
  preloadAllDashboardData();
}
