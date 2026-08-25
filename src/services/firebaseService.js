/**
 * firebaseService.js
 * Initializes Firebase Authentication (Google Sign-In) and Firestore Database
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
