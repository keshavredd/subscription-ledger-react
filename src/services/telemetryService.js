/**
 * telemetryService.js
 * Access Whitelisting, Pageview Telemetry, and Conversational Chat Audit Logging Service
 */

const ADMIN_EMAILS = [
  'keshavreddy731@gmail.com',
  'keshaveddy731@gmail.com',
  'keshava.reddy@timesinternet.in'
];

const INITIAL_ALLOWED_USERS = [
  'keshavreddy731@gmail.com',
  'keshaveddy731@gmail.com',
  'keshava.reddy@timesinternet.in',
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
  // Ensure default admins are always present
  const combined = Array.from(new Set([...ADMIN_EMAILS, ...stored]));
  return combined;
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

export function addAllowedUser(newEmail) {
  if (!newEmail || !newEmail.trim()) return false;
  const norm = newEmail.toLowerCase().trim();
  const current = getAllowedUsers();
  if (!current.includes(norm)) {
    const updated = [...current, norm];
    setStorageJSON(STORAGE_KEYS.ALLOWED_USERS, updated);
    return true;
  }
  return false;
}

export function removeAllowedUser(targetEmail) {
  if (!targetEmail) return false;
  const norm = targetEmail.toLowerCase().trim();
  // Prevent removing root admin emails
  if (isAdminEmail(norm)) return false;

  const current = getAllowedUsers();
  const updated = current.filter(e => e.toLowerCase().trim() !== norm);
  setStorageJSON(STORAGE_KEYS.ALLOWED_USERS, updated);
  return true;
}

// ---------------------------------------------------------------------------
// 2. TELEMETRY & CHAT AUDIT LOGGING
// ---------------------------------------------------------------------------

export function logTabPageView(userEmail, tabName) {
  if (!userEmail || !tabName) return;
  const normEmail = userEmail.toLowerCase().trim();

  // Update Tab View Counts
  const tabViews = getStorageJSON(STORAGE_KEYS.TAB_VIEWS, {
    'Realtime': 142,
    'Funnel Analysis': 389,
    'Subscription Report': 264,
    'Renewals & Recurring': 310,
    'Conversational Analytics': 495
  });
  tabViews[tabName] = (tabViews[tabName] || 0) + 1;
  setStorageJSON(STORAGE_KEYS.TAB_VIEWS, tabViews);

  // Update User Sessions
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
}

export function logChatQuery(userEmail, queryText, engineUsed = 'Local React Engine') {
  if (!queryText || !queryText.trim()) return;

  const logs = getStorageJSON(STORAGE_KEYS.CHAT_LOGS, [
    {
      id: 1,
      timestamp: '2026-08-16 19:42',
      userEmail: 'keshava.reddy@timesinternet.in',
      query: 'Give me monthly renewal rate from jan\'26 till july\'26',
      engine: 'Gemini 3.6 Flash',
      status: 'Success (200)'
    },
    {
      id: 2,
      timestamp: '2026-08-16 19:20',
      userEmail: 'analyst@timesinternet.in',
      query: 'Which platform leads sales?',
      engine: 'Gemini 3.6 Flash',
      status: 'Success (200)'
    },
    {
      id: 3,
      timestamp: '2026-08-16 19:15',
      userEmail: 'keshaveddy731@gmail.com',
      query: 'What is the renewal rate for the month of july\'26?',
      engine: 'Local React Engine',
      status: 'Success (200)'
    }
  ]);

  const newLog = {
    id: Date.now(),
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
    userEmail: userEmail || 'Anonymous User',
    query: queryText.trim(),
    engine: engineUsed,
    status: 'Success (200)'
  };

  const updated = [newLog, ...logs].slice(0, 100); // Keep last 100 logs
  setStorageJSON(STORAGE_KEYS.CHAT_LOGS, updated);
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
