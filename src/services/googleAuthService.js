/**
 * googleAuthService.js
 * Unified Google SSO Authentication Service
 * Supports Firebase Auth (signInWithPopup) & Google Identity Services (GIS)
 */

import {
  loginWithGoogle,
  loginWithGoogleRedirect,
  prefersRedirectSignIn,
  isPopupFailure
} from './firebaseService';

// Dynamically load Google Identity Services SDK if needed
let gsiPromise = null;
export function loadGsiScript() {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null);
    if (window.google?.accounts) return resolve(window.google.accounts);

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google?.accounts || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return gsiPromise;
}

/**
 * Triggers official Google SSO Authentication.
 *
 * Uses Firebase if VITE_FIREBASE_API_KEY is configured, or Google Identity
 * Services if VITE_GOOGLE_CLIENT_ID is provided.
 *
 * Firebase sign-in picks its mechanism per environment. Popups are unusable on
 * iOS/iPadOS (Safari blocks pop-ups by default), inside in-app webviews, and on
 * desktop Safari (ITP blocks the cross-origin popup handshake), so those get a
 * full-page redirect instead. Everywhere else keeps the popup — it preserves
 * app state — and falls back to redirect if the popup turns out to be blocked.
 *
 * Returns { email, displayName } on success, or { redirecting: true } when the
 * browser is navigating away to complete a redirect sign-in.
 */
export async function loginWithGoogleSSO() {
  const firebaseApiKey = import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD507aw8ZwCLi_3n8feESQIor3s2PDRozQ";

  // 1. Primary: Firebase Google Sign-In
  if (firebaseApiKey && !firebaseApiKey.includes('demo_key') && !firebaseApiKey.includes('placeholder')) {
    if (prefersRedirectSignIn()) {
      await loginWithGoogleRedirect();
      return { redirecting: true };
    }

    try {
      const firebaseUser = await loginWithGoogle();
      if (firebaseUser && firebaseUser.email) {
        return {
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || firebaseUser.email.split('@')[0]
        };
      }
    } catch (err) {
      if (isPopupFailure(err)) {
        console.warn(`Popup sign-in unavailable (${err.code}) — retrying via redirect.`);
        await loginWithGoogleRedirect();
        return { redirecting: true };
      }
      console.error("Firebase Auth Error:", err);
      throw err;
    }
  }

  // 2. Secondary: Google Identity Services (GIS) OAuth 2.0 (if VITE_GOOGLE_CLIENT_ID is set)
  const googleAccounts = await loadGsiScript();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  if (googleAccounts?.oauth2 && clientId && !clientId.includes('YOUR_GOOGLE_CLIENT_ID')) {
    return new Promise((resolve, reject) => {
      const client = googleAccounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'email profile',
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            reject(new Error(tokenResponse.error_description || tokenResponse.error));
            return;
          }
          try {
            const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
            });
            const profile = await res.json();
            resolve({ email: profile.email, displayName: profile.name || profile.email.split('@')[0] });
          } catch (err) {
            reject(err);
          }
        }
      });
      client.requestAccessToken();
    });
  }

  // 3. Fallback: Prompt user to configure their Firebase credentials
  throw new Error("Firebase Google Auth is not configured. Please paste your Firebase web config credentials into your .env file.");
}
