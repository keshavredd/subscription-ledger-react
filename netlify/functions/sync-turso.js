import { createClient } from '@libsql/client';
import Papa from 'papaparse';

const DATASET_URLS = {
  subscription: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=598826199",
  funnel: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1049115614",
  realtime: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1333104452",
  renewals: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=renewal_raw",
  arpu: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=arpu_data"
};

export async function handler(event, context) {
  const TURSO_URL = process.env.VITE_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
  const TURSO_TOKEN = process.env.VITE_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;

  if (!TURSO_URL || !TURSO_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing Turso credentials in environment" })
    };
  }

  try {
    const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
    const log = [];

    for (const [key, url] of Object.entries(DATASET_URLS)) {
      const res = await fetch(url);
      if (!res.ok) continue;
      const csvText = await res.text();
      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      const rows = parsed.data;

      if (!rows || rows.length === 0) continue;

      const rawColumns = Object.keys(rows[0]).map(k => k.trim()).filter(Boolean);
      const colMap = {};
      const sqlColumns = rawColumns.map(col => {
        const cleanName = col.replace(/[^a-zA-Z0-9_]/g, '_');
        colMap[col] = cleanName;
        return `${cleanName} TEXT`;
      });

      await client.execute(`DROP TABLE IF EXISTS ${key}`);
      await client.execute(`CREATE TABLE ${key} (${sqlColumns.join(', ')})`);

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
          return {
            sql: `INSERT INTO ${key} (${colNames.join(', ')}) VALUES (${colNames.map(() => '?').join(', ')})`,
            args: colVals
          };
        });
        await client.batch(statements);
      }
      log.push(`Synced ${rows.length} rows for table '${key}'`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Turso DB sync complete", log })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
