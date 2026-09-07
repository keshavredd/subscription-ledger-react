import { createClient } from '@libsql/client';
import Papa from 'papaparse';

const DEFAULT_TURSO_URL = "libsql://subscription-ledger-keshav-731.aws-ap-south-1.turso.io";
const DEFAULT_TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODc4NTYxMDMsImlkIjoiMDFhMDQ0ODYtMGUwMS03YjRhLWIwYzUtODgwYzYwMmViNDE3Iiwia2lkIjoiaFZyYzViX2E0N2JYeWlhaUpTNGZIbzlSbEd2c01MRWVIUmtrYmQzVkl2NCIsInJpZCI6IjkzNzcxNTExLTMwYzUtNDRmZS05NzEyLWViNGNmMWRjZGZkMCJ9.dt1_tlMrNN7R9ncYC1cwueTQ1Mx6Z0JQq_hMldYAkkJTyiw8WbMod20DvWdcJxDY03a1gOv3qxTvrt8fNmSkDA";

const DATASET_URLS = {
  realtime: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1333104452",
  funnel: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1049115614",
  subscription: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=598826199",
  renewals: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=renewal_raw",
  arpu: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=arpu_data"
};

export default async function handler(req, res) {
  const TURSO_URL = process.env.VITE_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || DEFAULT_TURSO_URL;
  const TURSO_TOKEN = process.env.VITE_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || DEFAULT_TURSO_TOKEN;

  // Support single table sync per request (e.g. ?table=realtime or ?table=all)
  const params = req?.query || {};
  const requestedTable = params.table || 'realtime';
  const targetTables = requestedTable === 'all' ? Object.keys(DATASET_URLS) : [requestedTable];

  try {
    const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
    const log = [];

    for (const key of targetTables) {
      const url = DATASET_URLS[key];
      if (!url) continue;

      const response = await fetch(url);
      if (!response.ok) continue;
      const csvText = await response.text();
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

      const chunkSize = 250;
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

    if (res && typeof res.status === 'function') {
      return res.status(200).json({ status: "success", message: "Turso DB sync complete", syncedTables: targetTables, log });
    }
    return new Response(JSON.stringify({ status: "success", message: "Turso DB sync complete", syncedTables: targetTables, log }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("[Vercel Sync Function Error]", err);
    if (res && typeof res.status === 'function') {
      return res.status(500).json({ status: "error", error: err.message });
    }
    return new Response(JSON.stringify({ status: "error", error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
