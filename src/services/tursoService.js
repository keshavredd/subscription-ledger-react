/**
 * tursoService.js
 * Fast client service for Turso Database (LibSQL engine over HTTP).
 * Enables sub-100ms HTTP SQL querying for all dashboard datasets and live Whitelist/Telemetry persistence.
 */
import { createClient } from '@libsql/client/web';

const tursoUrl = import.meta.env.VITE_TURSO_DATABASE_URL || '';
const tursoToken = import.meta.env.VITE_TURSO_AUTH_TOKEN || '';

let tursoClient = null;

/**
 * Returns whether Turso credentials are available in environment
 */
export function isTursoConfigured() {
  return Boolean(tursoUrl && tursoToken && tursoUrl.length > 5);
}

/**
 * Returns the singleton Turso client instance
 */
export function getTursoClient() {
  if (!isTursoConfigured()) return null;
  if (!tursoClient) {
    tursoClient = createClient({
      url: tursoUrl,
      authToken: tursoToken
    });
  }
  return tursoClient;
}

/**
 * Executes a SQL query against Turso Database and returns clean JS objects.
 */
export async function queryTurso(sql, args = []) {
  const client = getTursoClient();
  if (!client) {
    throw new Error('Turso client is not configured.');
  }
  const result = await client.execute({ sql, args });
  const columns = result.columns;
  return result.rows.map(row => {
    const obj = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  });
}

/**
 * Fetches all rows from a Turso dataset table ('subscription', 'funnel', 'realtime', 'renewals', 'arpu').
 */
export async function fetchTursoTable(tableName) {
  try {
    const rows = await queryTurso(`SELECT * FROM ${tableName}`);
    return { data: rows, source: 'turso-db' };
  } catch (err) {
    console.warn(`[TursoService] Error fetching table '${tableName}':`, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// ADMIN & TELEMETRY TURSO PERSISTENCE HELPERS
// ---------------------------------------------------------------------------

/**
 * Fetches whitelisted user emails from Turso DB
 */
export async function fetchAllowedUsersTurso() {
  if (!isTursoConfigured()) return null;
  try {
    const rows = await queryTurso('SELECT email FROM admin_whitelist ORDER BY email ASC');
    return rows.map(r => String(r.email).toLowerCase().trim()).filter(Boolean);
  } catch (err) {
    console.warn('[TursoService] Error fetching whitelist from Turso:', err);
    return null;
  }
}

/**
 * Adds a new whitelisted user email to Turso DB
 */
export async function addAllowedUserTurso(email, addedBy = 'Admin') {
  if (!isTursoConfigured() || !email) return false;
  try {
    const norm = email.toLowerCase().trim();
    const now = new Date().toISOString();
    const client = getTursoClient();
    await client.execute({
      sql: `INSERT INTO admin_whitelist (email, added_by, added_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING`,
      args: [norm, addedBy, now]
    });
    return true;
  } catch (err) {
    console.warn('[TursoService] Error adding user to Turso whitelist:', err);
    return false;
  }
}

/**
 * Removes a whitelisted user email from Turso DB
 */
export async function removeAllowedUserTurso(email) {
  if (!isTursoConfigured() || !email) return false;
  try {
    const norm = email.toLowerCase().trim();
    const client = getTursoClient();
    await client.execute({
      sql: `DELETE FROM admin_whitelist WHERE LOWER(email) = ?`,
      args: [norm]
    });
    return true;
  } catch (err) {
    console.warn('[TursoService] Error removing user from Turso whitelist:', err);
    return false;
  }
}

/**
 * Logs a tab pageview and updates user session tracking in Turso DB
 */
export async function logTabPageViewTurso(userEmail, tabName, role = 'User') {
  if (!isTursoConfigured() || !userEmail || !tabName) return;
  try {
    const client = getTursoClient();
    const normEmail = userEmail.toLowerCase().trim();
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 16);

    await client.batch([
      {
        sql: `INSERT INTO admin_pageviews (tab_name, view_count) VALUES (?, 1) ON CONFLICT(tab_name) DO UPDATE SET view_count = view_count + 1`,
        args: [tabName]
      },
      {
        sql: `INSERT INTO admin_user_sessions (email, role, total_visits, last_active) VALUES (?, ?, 1, ?) ON CONFLICT(email) DO UPDATE SET total_visits = total_visits + 1, last_active = ?`,
        args: [normEmail, role, nowStr, nowStr]
      }
    ]);
  } catch (err) {
    console.warn('[TursoService] Error logging telemetry to Turso:', err);
  }
}

/**
 * Logs a conversational AI chat query into Turso DB
 */
export async function logChatQueryTurso(userEmail, queryText, engine = 'Local React Engine') {
  if (!isTursoConfigured() || !queryText) return;
  try {
    const client = getTursoClient();
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 16);
    await client.execute({
      sql: `INSERT INTO admin_chat_logs (id, timestamp, user_email, query, engine, status) VALUES (?, ?, ?, ?, ?, 'Success (200)')`,
      args: [Date.now(), nowStr, userEmail || 'Anonymous User', queryText.trim(), engine]
    });
  } catch (err) {
    console.warn('[TursoService] Error logging chat query to Turso:', err);
  }
}

/**
 * Fetches all telemetry stats (pageviews, user sessions, chat audit logs) from Turso DB
 */
export async function getTelemetryStatsTurso() {
  if (!isTursoConfigured()) return null;
  try {
    const [pageviewsRows, sessionRows, chatRows] = await Promise.all([
      queryTurso('SELECT * FROM admin_pageviews'),
      queryTurso('SELECT * FROM admin_user_sessions ORDER BY last_active DESC'),
      queryTurso('SELECT * FROM admin_chat_logs ORDER BY id DESC LIMIT 100')
    ]);

    const tabViews = {};
    pageviewsRows.forEach(r => {
      tabViews[r.tab_name] = Number(r.view_count || 0);
    });

    const userSessions = sessionRows.map(r => ({
      email: r.email,
      role: r.role || 'User',
      totalVisits: Number(r.total_visits || 0),
      lastActive: r.last_active
    }));

    const chatLogs = chatRows.map(r => ({
      id: Number(r.id),
      timestamp: r.timestamp,
      userEmail: r.user_email,
      query: r.query,
      engine: r.engine,
      status: r.status
    }));

    const totalTabViews = Object.values(tabViews).reduce((a, b) => a + b, 0);

    return {
      totalTabViews,
      tabViews,
      userSessions,
      chatLogs
    };
  } catch (err) {
    console.warn('[TursoService] Error fetching telemetry stats from Turso:', err);
    return null;
  }
}
