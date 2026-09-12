/**
 * firebaseService.js
 * Initializes Firebase Authentication (Google Sign-In) and Firestore Database
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { prefersRedirectSignIn } from '../utils/browserEnv';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD507aw8ZwCLi_3n8feESQIor3s2PDRozQ",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "subscription-ledger-849a8.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "subscription-ledger-849a8",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "subscription-ledger-849a8.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "49258537381",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:49258537381:web:b9c2bb15aa09926b66084c",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-5NVZKQ1T2S"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

/**
 * Auth persistence must be decided at CREATION, not patched afterwards with
 * setPersistence. getAuth() initializes with Firebase's default stack —
 * IndexedDB first — and that class registers pagehide/visibilitychange
 * handlers that close its database, after which every access throws
 * "Database is closing/hidden". Safari can begin loading the page returning
 * from an OAuth redirect while it is still hidden, so auth initialization
 * itself hits that teardown and getRedirectResult dies before a later
 * setPersistence call could change anything.
 *
 * On the redirect path (iOS, webviews, desktop Safari) IndexedDB is therefore
 * excluded from the list entirely — never instantiated, never able to throw.
 * localStorage/sessionStorage have no open/close lifecycle. Popup-path
 * browsers keep Firebase's default order. The first AVAILABLE entry wins, so
 * Safari Private Browsing (unusable storage) still falls through safely.
 */
function createAuth() {
  const persistence = prefersRedirectSignIn()
    ? [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence]
    : [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence];
  try {
    return initializeAuth(app, { persistence, popupRedirectResolver: browserPopupRedirectResolver });
  } catch {
    // Auth already initialized for this app (e.g. Vite HMR re-running this
    // module) — reuse the existing instance.
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Always let the user pick an account rather than silently reusing one.
googleProvider.setCustomParameters({ prompt: 'select_account' });

const REDIRECT_PENDING_KEY = 'et_sso_redirect_pending';

export { prefersRedirectSignIn };

/** Firebase error codes that mean "the popup never worked" — safe to retry via redirect. */
const POPUP_FAILURE_CODES = new Set([
  'auth/popup-blocked',
  'auth/cancelled-popup-request',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
  'auth/internal-error'
]);

export function isPopupFailure(error) {
  return !!error?.code && POPUP_FAILURE_CODES.has(error.code);
}

/**
 * Some popup blockers and browser extensions (common on macOS) don't refuse
 * the popup — they let it open and instantly kill it. Firebase then reports
 * auth/popup-closed-by-user, indistinguishable from a deliberate close, and
 * retrying the popup loops forever. So after one closed popup we mark the
 * popup path unreliable for this tab: the NEXT attempt goes straight to the
 * full-page redirect, which nothing can block.
 */
const POPUP_UNRELIABLE_KEY = 'et_sso_popup_unreliable';

export function markPopupUnreliable() {
  try { sessionStorage.setItem(POPUP_UNRELIABLE_KEY, '1'); } catch { /* flow still works */ }
}

export function isPopupUnreliable() {
  try { return sessionStorage.getItem(POPUP_UNRELIABLE_KEY) === '1'; } catch { return false; }
}

/** True once a redirect has been kicked off, so the UI can show a "completing" state. */
export function isRedirectPending() {
  try {
    return sessionStorage.getItem(REDIRECT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

function markRedirectPending(pending) {
  try {
    if (pending) sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
    else sessionStorage.removeItem(REDIRECT_PENDING_KEY);
  } catch {
    // sessionStorage unavailable (Safari lockdown) — the flow still works,
    // we just lose the "completing sign-in" spinner.
  }
}

export async function loginWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

/**
 * Full-page redirect sign-in. Does not resolve on success: the browser
 * navigates away and the result is picked up by completeRedirectSignIn().
 */
export async function loginWithGoogleRedirect() {
  markRedirectPending(true);
  try {
    await signInWithRedirect(auth, googleProvider);
  } catch (error) {
    markRedirectPending(false);
    throw error;
  }
}

/**
 * Call once on app start. Returns the signed-in user when returning from a
 * redirect, or null on a normal page load.
 */
export async function completeRedirectSignIn() {
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } finally {
    markRedirectPending(false);
  }
}

export async function logoutUser() {
  try {
    markRedirectPending(false);
    await firebaseSignOut(auth);
  } catch (error) {
    console.error("Logout Error:", error);
  }
}

export { onAuthStateChanged };
