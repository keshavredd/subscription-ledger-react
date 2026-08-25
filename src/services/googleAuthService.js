/**
 * googleAuthService.js
 * Unified Google SSO Authentication Service
 * Supports Firebase Auth (signInWithPopup) & Google Identity Services (GIS)
 */

import { loginWithGoogle } from './firebaseService';

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
 * Triggers official Google SSO Popup Authentication.
 * Uses Firebase signInWithPopup if VITE_FIREBASE_API_KEY is configured,
 * or Google Identity Services if VITE_GOOGLE_CLIENT_ID is provided.
 */
export async function loginWithGoogleSSO() {
  const firebaseApiKey = import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD507aw8ZwCLi_3n8feESQIor3s2PDRozQ";

  // 1. Primary: Firebase Google Sign-In Popup
  if (firebaseApiKey && !firebaseApiKey.includes('demo_key') && !firebaseApiKey.includes('placeholder')) {
    try {
      const firebaseUser = await loginWithGoogle();
      if (firebaseUser && firebaseUser.email) {
        return {
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || firebaseUser.email.split('@')[0]
        };
      }
    } catch (err) {
      console.error("Firebase Auth Popup Error:", err);
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
