/**
 * LoginScreen.jsx
 * ET Prime Subscription Ledger - Authentication & Access Control Guard
 */
import React, { useState } from 'react';
import { ShieldAlert, LogIn, Lock, ArrowRight, UserCheck, CheckCircle, Mail } from 'lucide-react';
import { loginWithGoogleSSO } from '../services/googleAuthService';
import { isUserAuthorizedAsync } from '../services/telemetryService';

export default function LoginScreen({ onLoginSuccess, isDark }) {
  const [errorMsg, setErrorMsg] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const processEmailAuth = async (emailStr) => {
    if (!emailStr || !emailStr.trim()) return;
    const email = emailStr.trim();
    const authorized = await isUserAuthorizedAsync(email);
    if (authorized) {
      onLoginSuccess({ email, displayName: email.split('@')[0] });
    } else {
      setErrorMsg(`Access Denied: Your Google account (${email}) has not been granted access to this dashboard.`);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const user = await loginWithGoogleSSO();
      if (user && user.email) {
        processEmailAuth(user.email);
        return;
      }
      setErrorMsg("Google Sign-In Failed: No email address returned.");
    } catch (err) {
      console.error("Google OAuth Popup Error:", err);
      setErrorMsg(err?.message || "Google SSO popup failed or was closed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text flex items-center justify-center p-4">
      <div className="max-w-md w-full animate-in fade-in zoom-in-95 duration-300">
        
        {/* Branding Logo & Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="bg-black dark:bg-white text-white dark:text-black font-black px-3 py-1.5 rounded-lg text-xl tracking-wider">
              ET
            </div>
            <span className="text-2xl font-extrabold tracking-tight">Prime</span>
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-accent">Subscription Ledger</p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-3xl p-8 shadow-xl">
          
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-warm-border/60 dark:border-zinc-800">
            <div className="p-3 bg-amber-500/10 text-amber-accent rounded-2xl">
              <Lock className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Authorized Access Only</h2>
              <p className="text-xs text-warm-muted dark:text-dark-muted">Sign in via Google SSO to view the Dashboard</p>
            </div>
          </div>

          {/* Access Denied Alert Box */}
          {errorMsg && (
            <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="h-5 w-5 shrink-0 text-rose-500 mt-0.5" />
                <div>
                  <span className="font-bold block mb-1">Access Restricted</span>
                  <p className="leading-relaxed">{errorMsg}</p>
                  <p className="mt-2 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    Contact your dashboard administrator to add your email address to the access whitelist.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Primary Action: Sign In with Google */}
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full py-3.5 px-4 rounded-2xl font-bold text-xs bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 shadow-md hover:shadow-lg cursor-pointer disabled:opacity-50"
          >
            <LogIn className="h-4 w-4 text-amber-accent" />
            <span>{isLoading ? "Signing in with Google SSO..." : "Sign in with Google SSO"}</span>
          </button>

        </div>

        {/* Footer */}
        <p className="text-[11px] text-center text-warm-muted dark:text-dark-muted mt-6 font-medium">
          ET Prime Subscription Ledger &bull; Internal Enterprise Tool
        </p>

      </div>
    </div>
  );
}
