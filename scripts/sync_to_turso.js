/**
 * sync_to_turso.js
 * Ingestion pipeline script: Syncs dashboard datasets from Google Sheets into Turso Database.
 */
import { createClient } from '@libsql/client';
import Papa from 'papaparse';
import https from 'https';
import fs from 'fs';
import path from 'path';

// Helper to load .env file manually if process.env isn't set
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valParts] = trimmed.split('=');
        const val = valParts.join('=').trim();
        if (key && val && !process.env[key.trim()]) {
          process.env[key.trim()] = val;
        }
      }
    });
  }
}

loadEnv();

const TURSO_URL = process.env.VITE_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.VITE_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;

const DATASET_URLS = {
  subscription: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=598826199",
  funnel: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1049115614",
  realtime: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1333104452",
  renewals: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=renewal_raw",
  arpu: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=arpu_data"
};

function fetchCsv(url) {
  return new Promise((resolve, reject) => {
    function get(targetUrl) {
      https.get(targetUrl, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location);
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    }
    get(url);
  });
}

async function syncDataset(client, key, url) {
  console.log(`\n📥 Fetching CSV for '${key}'...`);
  const csvText = await fetchCsv(url);
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const rows = parsed.data;

  if (!rows || rows.length === 0) {
    console.warn(`[Sync] Warning: No rows found for '${key}'`);
    return;
  }

  console.log(`📊 Processing ${rows.length} rows for table '${key}'...`);
  const sample = rows[0];
  const rawColumns = Object.keys(sample).map(k => k.trim()).filter(Boolean);

  // Sanitize column names for SQL
  const colMap = {};
  const sqlColumns = rawColumns.map(col => {
    const cleanName = col.replace(/[^a-zA-Z0-9_]/g, '_');
    colMap[col] = cleanName;
    return `${cleanName} TEXT`;
  });

  // Recreate Table
  await client.execute(`DROP TABLE IF EXISTS ${key}`);
  await client.execute(`CREATE TABLE ${key} (${sqlColumns.join(', ')})`);
  console.log(`✅ Table '${key}' created.`);

  // Batch Insert
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const statements = chunk.map(row => {
      const colNames = [];
      const colVals = [];

      rawColumns.forEach(rawCol => {
        colNames.push(colMap[rawCol]);
        colVals.push(row[rawCol] ?? '');
      });

      const placeholders = colVals.map(() => '?').join(', ');
      return {
        sql: `INSERT INTO ${key} (${colNames.join(', ')}) VALUES (${placeholders})`,
        args: colVals
      };
    });

    await client.batch(statements);
    console.log(`   Inserted ${Math.min(i + chunkSize, rows.length)} / ${rows.length} rows...`);
  }
  console.log(`🎉 Table '${key}' fully synced (${rows.length} rows).`);
}

async function runSync() {
  if (!TURSO_URL || !TURSO_TOKEN) {
    console.error("❌ Error: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables must be provided in .env.");
    process.exit(1);
  }

  console.log("⚡ Connecting to Turso Database:", TURSO_URL);
  const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

  for (const key of Object.keys(DATASET_URLS)) {
    await syncDataset(client, key, DATASET_URLS[key]);
  }

  console.log("\n🚀 All dashboard datasets successfully synced to Turso Database!");
}

runSync().catch(err => {
  console.error("❌ Sync Error:", err);
  process.exit(1);
});
