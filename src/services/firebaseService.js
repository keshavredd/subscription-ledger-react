/**
 * firebaseService.js
 * Initializes Firebase Authentication (Google Sign-In) and Firestore Database
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
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
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Always let the user pick an account rather than silently reusing one.
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Safari in Private Browsing (and locked-down iOS webviews) can have IndexedDB
 * present but unusable, which makes Firebase's default persistence throw and
 * surfaces to the user as "unable to log in". Walk the persistence options from
 * most to least durable and keep the first one that actually initializes.
 */
export const persistenceReady = (async () => {
  const tiers = [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence
  ];
  for (const tier of tiers) {
    try {
      await setPersistence(auth, tier);
      return tier;
    } catch {
      // Try the next, less capable storage mechanism.
    }
  }
  return null;
})();

const REDIRECT_PENDING_KEY = 'et_sso_redirect_pending';

export { prefersRedirectSignIn };

/** Firebase error codes that mean "the popup never worked" — safe to retry via redirect. */
const POPUP_FAILURE_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
  'auth/internal-error'
]);

export function isPopupFailure(error) {
  return !!error?.code && POPUP_FAILURE_CODES.has(error.code);
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
  await persistenceReady;
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
  await persistenceReady;
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
