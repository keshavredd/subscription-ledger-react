/**
 * telemetryService.js
 * Access Whitelisting, Pageview Telemetry, and Conversational Chat Audit Logging Service
 * Hybrid Persistence: Turso Database (shared across all devices) + Local Storage Fallback
 */
import { 
  isTursoConfigured, 
  fetchAllowedUsersTurso, 
  addAllowedUserTurso, 
  removeAllowedUserTurso, 
  logTabPageViewTurso, 
  logChatQueryTurso, 
  getTelemetryStatsTurso 
} from './tursoService';

const ADMIN_EMAILS = [
  'keshavreddy731@gmail.com',
  'keshaveddy731@gmail.com',
  'keshava.reddy@timesinternet.in'
];

const INITIAL_ALLOWED_USERS = [
  'keshavreddy731@gmail.com',
  'keshaveddy731@gmail.com',
  'keshava.reddy@timesinternet.in',
  'nitish.gupta@timesinternet.in',
  'analyst@timesinternet.in',
  'product.lead@timesinternet.in'
];

const STORAGE_KEYS = {
  ALLOWED_USERS: 'et_ledger_allowed_users',
  TAB_VIEWS: 'et_ledger_tab_views',
  CHAT_LOGS: 'et_ledger_chat_logs',
  USER_SESSIONS: 'et_ledger_user_sessions'
};

// Initialize Local Storage Defaults
function getStorageJSON(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch (err) {
    return fallback;
  }
}

function setStorageJSON(key, data) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error(`Failed to write ${key} to storage`, err);
  }
}

// ---------------------------------------------------------------------------
// 1. ACCESS CONTROL & WHITELIST MANAGEMENT
// ---------------------------------------------------------------------------

export function isAdminEmail(email) {
  if (!email) return false;
  const norm = email.toLowerCase().trim();
  return ADMIN_EMAILS.some(adm => norm === adm.toLowerCase());
}

export function getAllowedUsers() {
  const stored = getStorageJSON(STORAGE_KEYS.ALLOWED_USERS, INITIAL_ALLOWED_USERS);
  const combined = Array.from(new Set([...ADMIN_EMAILS, ...stored]));
  return combined;
}

export async function getAllowedUsersAsync() {
  if (isTursoConfigured()) {
    try {
      const dbUsers = await fetchAllowedUsersTurso();
      if (dbUsers && dbUsers.length > 0) {
        const combined = Array.from(new Set([...ADMIN_EMAILS, ...dbUsers]));
        setStorageJSON(STORAGE_KEYS.ALLOWED_USERS, combined);
        return combined;
      }
    } catch (err) {
      console.warn('[Telemetry] Error fetching async whitelist from Turso:', err);
    }
  }
  return getAllowedUsers();
}

export function isUserAuthorized(email) {
  if (!email) return false;
  const norm = email.toLowerCase().trim();

  // 1. Check if Admin
  if (isAdminEmail(norm)) return true;

  // 2. Check if in Whitelist
  const allowedList = getAllowedUsers();
  return allowedList.some(userEmail => userEmail.toLowerCase().trim() === norm);
}

export async function isUserAuthorizedAsync(email) {
  if (!email) return false;
  const norm = email.toLowerCase().trim();

  // 1. Check if Admin
  if (isAdminEmail(norm)) return true;

  // 2. Fetch live Whitelist from Turso DB
  const allowedList = await getAllowedUsersAsync();
  return allowedList.some(userEmail => userEmail.toLowerCase().trim() === norm);
}

export function addAllowedUser(newEmail) {
  if (!newEmail || !newEmail.trim()) return false;
  const norm = newEmail.toLowerCase().trim();
  const current = getAllowedUsers();
  let updated = current;

  if (!current.includes(norm)) {
    updated = [...current, norm];
    setStorageJSON(STORAGE_KEYS.ALLOWED_USERS, updated);
  }

  // Persist to Turso DB asynchronously
  if (isTursoConfigured()) {
    addAllowedUserTurso(norm).catch(err => console.warn('[Telemetry] Error syncing user add to Turso:', err));
  }

  return true;
}

export async function addAllowedUserAsync(newEmail) {
  if (!newEmail || !newEmail.trim()) return false;
  const norm = newEmail.toLowerCase().trim();

  addAllowedUser(norm);
  if (isTursoConfigured()) {
    await addAllowedUserTurso(norm);
  }
  return true;
}

export function removeAllowedUser(targetEmail) {
  if (!targetEmail) return false;
  const norm = targetEmail.toLowerCase().trim();
  if (isAdminEmail(norm)) return false;

  const current = getAllowedUsers();
  const updated = current.filter(e => e.toLowerCase().trim() !== norm);
  setStorageJSON(STORAGE_KEYS.ALLOWED_USERS, updated);

  // Remove from Turso DB asynchronously
  if (isTursoConfigured()) {
    removeAllowedUserTurso(norm).catch(err => console.warn('[Telemetry] Error syncing user removal to Turso:', err));
  }

  return true;
}

export async function removeAllowedUserAsync(targetEmail) {
  if (!targetEmail) return false;
  const norm = targetEmail.toLowerCase().trim();
  if (isAdminEmail(norm)) return false;

  removeAllowedUser(norm);
  if (isTursoConfigured()) {
    await removeAllowedUserTurso(norm);
  }
  return true;
}

// ---------------------------------------------------------------------------
// 2. TELEMETRY & CHAT AUDIT LOGGING
// ---------------------------------------------------------------------------

export function logTabPageView(userEmail, tabName) {
  if (!userEmail || !tabName) return;
  const normEmail = userEmail.toLowerCase().trim();

  // Update Tab View Counts in Local Storage
  const tabViews = getStorageJSON(STORAGE_KEYS.TAB_VIEWS, {
    'Realtime': 142,
    'Funnel Analysis': 389,
    'Subscription Report': 264,
    'Renewals & Recurring': 310,
    'Conversational Analytics': 495
  });
  tabViews[tabName] = (tabViews[tabName] || 0) + 1;
  setStorageJSON(STORAGE_KEYS.TAB_VIEWS, tabViews);

  // Update User Sessions in Local Storage
  const sessions = getStorageJSON(STORAGE_KEYS.USER_SESSIONS, [
    { email: 'keshaveddy731@gmail.com', role: 'Admin', totalVisits: 48, lastActive: '2026-08-16 19:45' },
    { email: 'keshava.reddy@timesinternet.in', role: 'Admin', totalVisits: 32, lastActive: '2026-08-16 19:30' },
    { email: 'analyst@timesinternet.in', role: 'User', totalVisits: 14, lastActive: '2026-08-16 18:15' }
  ]);

  const existingIdx = sessions.findIndex(s => s.email.toLowerCase() === normEmail);
  const timeStr = new Date().toISOString().replace('T', ' ').slice(0, 16);

  if (existingIdx >= 0) {
    sessions[existingIdx].totalVisits = (sessions[existingIdx].totalVisits || 0) + 1;
    sessions[existingIdx].lastActive = timeStr;
  } else {
    sessions.push({
      email: normEmail,
      role: isAdminEmail(normEmail) ? 'Admin' : 'User',
      totalVisits: 1,
      lastActive: timeStr
    });
  }
  setStorageJSON(STORAGE_KEYS.USER_SESSIONS, sessions);

  // Log to Turso DB asynchronously
  if (isTursoConfigured()) {
    logTabPageViewTurso(normEmail, tabName, isAdminEmail(normEmail) ? 'Admin' : 'User')
      .catch(err => console.warn('[Telemetry] Error logging view to Turso:', err));
  }
}

export function logChatQuery(userEmail, queryText, engineUsed = 'Local React Engine') {
  if (!queryText || !queryText.trim()) return;

  const logs = getStorageJSON(STORAGE_KEYS.CHAT_LOGS, []);
  const newLog = {
    id: Date.now(),
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
    userEmail: userEmail || 'Anonymous User',
    query: queryText.trim(),
    engine: engineUsed,
    status: 'Success (200)'
  };

  const updated = [newLog, ...logs].slice(0, 100);
  setStorageJSON(STORAGE_KEYS.CHAT_LOGS, updated);

  // Log to Turso DB asynchronously
  if (isTursoConfigured()) {
    logChatQueryTurso(userEmail, queryText, engineUsed)
      .catch(err => console.warn('[Telemetry] Error logging chat query to Turso:', err));
  }
}

export function getTelemetryStats() {
  const tabViews = getStorageJSON(STORAGE_KEYS.TAB_VIEWS, {
    'Realtime': 142,
    'Funnel Analysis': 389,
    'Subscription Report': 264,
    'Renewals & Recurring': 310,
    'Conversational Analytics': 495
  });

  const userSessions = getStorageJSON(STORAGE_KEYS.USER_SESSIONS, [
    { email: 'keshaveddy731@gmail.com', role: 'Admin', totalVisits: 48, lastActive: '2026-08-16 19:45' },
    { email: 'keshava.reddy@timesinternet.in', role: 'Admin', totalVisits: 32, lastActive: '2026-08-16 19:30' },
    { email: 'analyst@timesinternet.in', role: 'User', totalVisits: 14, lastActive: '2026-08-16 18:15' }
  ]);

  const chatLogs = getStorageJSON(STORAGE_KEYS.CHAT_LOGS, []);
  const totalTabViews = Object.values(tabViews).reduce((a, b) => a + b, 0);

  return {
    totalTabViews,
    tabViews,
    userSessions,
    chatLogs
  };
}

export async function getTelemetryStatsAsync() {
  if (isTursoConfigured()) {
    try {
      const stats = await getTelemetryStatsTurso();
      if (stats) return stats;
    } catch (err) {
      console.warn('[Telemetry] Error fetching telemetry stats from Turso:', err);
    }
  }
  return getTelemetryStats();
}
