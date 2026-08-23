/**
 * duckdbService.js
 * In-browser WebAssembly SQL Database Engine powered by DuckDB-Wasm.
 * Provides microsecond SQL analytics over compressed Parquet files.
 */
import * as duckdb from '@duckdb/duckdb-wasm';

let dbInstance = null;
let connInstance = null;
let initPromise = null;
const registeredTables = new Set();

/**
 * Initialize DuckDB WebAssembly engine
 */
export async function getDuckDB() {
  if (dbInstance && connInstance) {
    return { db: dbInstance, conn: connInstance };
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      console.log("[DuckDB] Initializing WebAssembly SQL Engine...");
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

      const worker = await duckdb.createWorker(bundle.mainWorker);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const db = new duckdb.AsyncDuckDB(logger, worker);

      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();

      dbInstance = db;
      connInstance = conn;
      console.log("⚡ [DuckDB] WebAssembly Engine Ready!");
      return { db, conn };
    } catch (err) {
      console.error("[DuckDB] Failed to initialize WASM engine:", err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

/**
 * Register a Parquet file buffer into DuckDB in-memory filesystem as a SQL table
 */
export async function registerParquetTable(tableName, buffer) {
  try {
    const { db, conn } = await getDuckDB();
    const fileName = `${tableName}.parquet`;

    // Convert ArrayBuffer to Uint8Array for DuckDB WASM
    const uint8Array = new Uint8Array(buffer);
    await db.registerFileBuffer(fileName, uint8Array);

    // Create SQL View/Table mapping directly to the Parquet file
    await conn.query(`CREATE OR REPLACE VIEW ${tableName} AS SELECT * FROM read_parquet('${fileName}');`);
    registeredTables.add(tableName);
    console.log(`[DuckDB] Registered SQL Table: '${tableName}'`);
    return true;
  } catch (err) {
    console.error(`[DuckDB] Error registering table ${tableName}:`, err);
    return false;
  }
}

/**
 * Execute an SQL query against DuckDB and return clean JavaScript objects
 */
export async function queryDuckDBSQL(sqlQuery) {
  try {
    const { conn } = await getDuckDB();
    const result = await conn.query(sqlQuery);
    
    // Convert Apache Arrow Table to standard JavaScript objects
    const rawRows = result.toArray().map(row => row.toJSON());
    
    // Convert BigInts & Arrow types to standard JS primitive types
    const rows = rawRows.map(row => {
      const clean = {};
      for (const key in row) {
        const val = row[key];
        if (typeof val === 'bigint') {
          clean[key] = Number(val);
        } else {
          clean[key] = val;
        }
      }
      return clean;
    });

    return rows;
  } catch (err) {
    console.error(`[DuckDB SQL Error] Query: "${sqlQuery}"`, err);
    throw err;
  }
}

/**
 * Check if a SQL table is registered
 */
export function isTableRegistered(tableName) {
  return registeredTables.has(tableName);
}
