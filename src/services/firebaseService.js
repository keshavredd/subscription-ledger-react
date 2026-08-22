/**
 * firebaseService.js
 * Initializes Firebase Authentication (Google Sign-In) and Firestore Database
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSy_demo_key_placeholder",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "et-prime-ledger.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "et-prime-ledger",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "et-prime-ledger.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:123456789:web:abcdef"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Google Login Error:", error);
    throw error;
  }
}

export async function logoutUser() {
  try {
    await firebaseSignOut(auth);
  } catch (error) {
    console.error("Logout Error:", error);
  }
}

export { onAuthStateChanged };
