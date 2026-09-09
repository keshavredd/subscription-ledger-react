/**
 * LoginScreen.jsx
 * ET Prime Subscription Ledger - Authentication & Access Control Guard
 */
import React, { useState, useEffect, useRef } from 'react';
import { ShieldAlert, LogIn, Lock, ArrowRight, UserCheck, CheckCircle, Mail, Loader2 } from 'lucide-react';
import { loginWithGoogleSSO } from '../services/googleAuthService';
import { completeRedirectSignIn, isRedirectPending } from '../services/firebaseService';
import { isUserAuthorizedAsync } from '../services/telemetryService';

/** Maps Firebase auth error codes to something a user can act on. */
function describeAuthError(err) {
  // Not a coded error: Firebase's IndexedDB persistence throws this bare
  // message once it has torn its database down on pagehide/visibilitychange.
  if (/Database is closing/i.test(err?.message || '')) {
    return "Sign-in was interrupted while the page was navigating. Please try again — keep this tab in the foreground while it completes.";
  }

  switch (err?.code) {
    case 'auth/popup-blocked':
      return "Your browser blocked the sign-in window. Please allow pop-ups for this site, or try again to be redirected instead.";
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return "Sign-in was cancelled before it completed. Please try again.";
    case 'auth/unauthorized-domain':
      return "This site's domain is not authorized in Firebase Authentication. An administrator needs to add it under Authentication → Settings → Authorized domains.";
    case 'auth/operation-not-supported-in-this-environment':
    case 'auth/web-storage-unsupported':
      return "This browser is blocking the storage that sign-in requires. If you are in Private Browsing or an in-app browser, please open the dashboard in Safari or Chrome directly.";
    case 'auth/network-request-failed':
      return "Could not reach Google's sign-in service. Please check your network connection and try again.";
    default:
      return err?.message || "Google SSO failed. Please try again.";
  }
}

export default function LoginScreen({ onLoginSuccess, isDark }) {
  const [errorMsg, setErrorMsg] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  // True while returning from a full-page redirect, so we show a "finishing"
  // state instead of flashing the sign-in button at a user who already signed in.
  const [isCompletingRedirect, setIsCompletingRedirect] = useState(() => isRedirectPending());
  const isMountedRef = useRef(true);

  useEffect(() => () => { isMountedRef.current = false; }, []);

  const processEmailAuth = async (emailStr) => {
    if (!emailStr || !emailStr.trim()) return false;
    const email = emailStr.trim();
    const authorized = await isUserAuthorizedAsync(email);
    if (authorized) {
      onLoginSuccess({ email, displayName: email.split('@')[0] });
      return true;
    } else {
      setErrorMsg(`Access Denied: Your Google account (${email}) has not been granted access to this dashboard.`);
      return false;
    }
  };

  // Consume a pending redirect sign-in on load. Runs on every mount so the
  // redirect result is always collected, even if the "pending" flag was lost
  // (e.g. sessionStorage blocked in a locked-down browser).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await completeRedirectSignIn();
        if (cancelled || !isMountedRef.current) return;
        if (user?.email) {
          await processEmailAuth(user.email);
        }
      } catch (err) {
        console.error("Google SSO redirect error:", err);
        if (!cancelled && isMountedRef.current) setErrorMsg(describeAuthError(err));
      } finally {
        if (!cancelled && isMountedRef.current) setIsCompletingRedirect(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const user = await loginWithGoogleSSO();
      // Redirect flow: the browser is navigating away to Google. Show the
      // "redirecting" state rather than reporting a missing email.
      if (user?.redirecting) {
        setIsCompletingRedirect(true);
        return;
      }
      if (user && user.email) {
        await processEmailAuth(user.email);
        return;
      }
      setErrorMsg("Google Sign-In Failed: No email address returned.");
    } catch (err) {
      console.error("Google OAuth Error:", err);
      setErrorMsg(describeAuthError(err));
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text flex items-center justify-center p-4">
      <div className="max-w-md w-full animate-in fade-in zoom-in-95 duration-300">
        
        {/* Branding Logo & Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="bg-[#ED1C24] text-white font-serif font-black text-4xl leading-none h-16 w-16 rounded-xl tracking-tighter shadow-md flex items-center justify-center shrink-0">
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
            disabled={isLoading || isCompletingRedirect}
            className="w-full py-3.5 px-4 rounded-2xl font-bold text-xs bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 shadow-md hover:shadow-lg cursor-pointer disabled:opacity-50"
          >
            {isLoading || isCompletingRedirect
              ? <Loader2 className="h-4 w-4 text-amber-accent animate-spin" />
              : <LogIn className="h-4 w-4 text-amber-accent" />}
            <span>
              {isCompletingRedirect
                ? "Completing Google sign-in..."
                : isLoading
                  ? "Signing in with Google SSO..."
                  : "Sign in with Google SSO"}
            </span>
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
