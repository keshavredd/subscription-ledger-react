/**
 * firestoreService.js
 * Whitelist + telemetry persistence in Cloud Firestore (same Firebase project
 * as Google SSO: subscription-ledger-849a8). Replaces the Turso/BigQuery
 * layer for the app's only writable data.
 *
 * Collections:
 *   admin_whitelist/{email}      -> { email, addedBy, addedAt }
 *   admin_pageviews/{tabName}    -> { tabName, viewCount }          (atomic increment)
 *   admin_user_sessions/{email}  -> { email, role, totalVisits, lastActive }
 *   admin_chat_logs/{id}         -> { id, timestamp, userEmail, query, engine, status }
 *
 * Every helper catches its own errors and returns null/false so callers fall
 * back to localStorage exactly like the previous backends did.
 */
import { db } from './firebaseService';
import {
  doc, setDoc, deleteDoc, getDocs, collection,
  query, orderBy, limit, increment, serverTimestamp
} from 'firebase/firestore';

let firestoreDisabled = false; // set after a hard failure so we stop retrying every call

export function isFirestoreAvailable() {
  return !firestoreDisabled;
}

function handleError(context, err) {
  console.warn(`[FirestoreService] ${context}:`, err);
  // permission-denied => rules not set up; unavailable/failed-precondition => DB not created
  if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) {
    firestoreDisabled = true;
  }
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 16);
}

// ---------------------------------------------------------------------------
// ADMIN WHITELIST
// ---------------------------------------------------------------------------

export async function fetchAllowedUsersFS() {
  if (firestoreDisabled) return null;
  try {
    const snap = await getDocs(collection(db, 'admin_whitelist'));
    return snap.docs
      .map(d => String(d.data().email || d.id).toLowerCase().trim())
      .filter(Boolean)
      .sort();
  } catch (err) {
    handleError('Error fetching whitelist', err);
    return null;
  }
}

export async function addAllowedUserFS(email, addedBy = 'Admin') {
  if (firestoreDisabled || !email) return false;
  try {
    const norm = email.toLowerCase().trim();
    // Email as document id => naturally idempotent, no duplicates
    await setDoc(doc(db, 'admin_whitelist', norm), {
      email: norm,
      addedBy,
      addedAt: serverTimestamp()
    }, { merge: true });
    return true;
  } catch (err) {
    handleError('Error adding user to whitelist', err);
    return false;
  }
}

export async function removeAllowedUserFS(email) {
  if (firestoreDisabled || !email) return false;
  try {
    const norm = email.toLowerCase().trim();
    await deleteDoc(doc(db, 'admin_whitelist', norm));
    return true;
  } catch (err) {
    handleError('Error removing user from whitelist', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// TELEMETRY
// ---------------------------------------------------------------------------

export async function logTabPageViewFS(userEmail, tabName, role = 'User') {
  if (firestoreDisabled || !userEmail || !tabName) return;
  try {
    const normEmail = userEmail.toLowerCase().trim();
    const timeStr = nowStr();
    await Promise.all([
      setDoc(doc(db, 'admin_pageviews', tabName), {
        tabName,
        viewCount: increment(1)
      }, { merge: true }),
      setDoc(doc(db, 'admin_user_sessions', normEmail), {
        email: normEmail,
        role,
        totalVisits: increment(1),
        lastActive: timeStr
      }, { merge: true })
    ]);
  } catch (err) {
    handleError('Error logging pageview', err);
  }
}

export async function logChatQueryFS(userEmail, queryText, engine = 'Local React Engine') {
  if (firestoreDisabled || !queryText) return;
  try {
    const id = Date.now();
    await setDoc(doc(db, 'admin_chat_logs', String(id)), {
      id,
      timestamp: nowStr(),
      userEmail: userEmail || 'Anonymous User',
      query: queryText.trim(),
      engine,
      status: 'Success (200)'
    });
  } catch (err) {
    handleError('Error logging chat query', err);
  }
}

export async function getTelemetryStatsFS() {
  if (firestoreDisabled) return null;
  try {
    const [pageviewsSnap, sessionsSnap, chatSnap] = await Promise.all([
      getDocs(collection(db, 'admin_pageviews')),
      getDocs(collection(db, 'admin_user_sessions')),
      getDocs(query(collection(db, 'admin_chat_logs'), orderBy('id', 'desc'), limit(100)))
    ]);

    const tabViews = {};
    pageviewsSnap.forEach(d => {
      const data = d.data();
      tabViews[data.tabName || d.id] = Number(data.viewCount || 0);
    });

    const userSessions = sessionsSnap.docs
      .map(d => {
        const data = d.data();
        return {
          email: data.email || d.id,
          role: data.role || 'User',
          totalVisits: Number(data.totalVisits || 0),
          lastActive: data.lastActive || ''
        };
      })
      .sort((a, b) => String(b.lastActive).localeCompare(String(a.lastActive)));

    const chatLogs = chatSnap.docs.map(d => {
      const data = d.data();
      return {
        id: Number(data.id),
        timestamp: data.timestamp,
        userEmail: data.userEmail,
        query: data.query,
        engine: data.engine,
        status: data.status
      };
    });

    const totalTabViews = Object.values(tabViews).reduce((a, b) => a + b, 0);
    return { totalTabViews, tabViews, userSessions, chatLogs };
  } catch (err) {
    handleError('Error fetching telemetry stats', err);
    return null;
  }
}
