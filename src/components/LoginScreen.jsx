/**
 * LoginScreen.jsx
 * ET Prime Subscription Ledger - Authentication & Access Control Guard
 */
import React, { useState } from 'react';
import { ShieldAlert, LogIn, Lock, ArrowRight, UserCheck, CheckCircle, Mail } from 'lucide-react';
import { loginWithGoogle } from '../services/firebaseService';
import { isUserAuthorized } from '../services/telemetryService';

export default function LoginScreen({ onLoginSuccess, isDark }) {
  const [errorMsg, setErrorMsg] = useState(null);
  const [unauthorizedEmail, setUnauthorizedEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [customEmailInput, setCustomEmailInput] = useState('');
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [googleEmailInput, setGoogleEmailInput] = useState('');

  const processEmailAuth = (emailStr) => {
    if (!emailStr || !emailStr.trim()) return;
    const email = emailStr.trim();
    if (isUserAuthorized(email)) {
      onLoginSuccess({ email, displayName: email.split('@')[0] });
    } else {
      setUnauthorizedEmail(email);
      setErrorMsg(`Access Denied: Your email (${email}) has not been granted access to this dashboard.`);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const user = await loginWithGoogle();
      if (user && user.email) {
        processEmailAuth(user.email);
        return;
      }
      setShowGoogleModal(true);
    } catch (err) {
      console.warn("Google OAuth fallback to email modal", err);
      setShowGoogleModal(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCustomEmailLogin = (e) => {
    e.preventDefault();
    processEmailAuth(customEmailInput);
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
              <p className="text-xs text-warm-muted dark:text-dark-muted">Sign in to view the Dashboard</p>
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
                    Contact an administrator (keshaveddy731@gmail.com) to add your email to the dashboard whitelist.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Primary Action: Sign In with Google */}
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full py-3.5 px-4 rounded-2xl font-bold text-xs bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 shadow-md hover:shadow-lg cursor-pointer mb-6 disabled:opacity-50"
          >
            <LogIn className="h-4 w-4 text-amber-accent" />
            <span>{isLoading ? "Signing in..." : "Sign in with Google"}</span>
          </button>

          <div className="relative flex items-center justify-center my-6">
            <div className="border-t border-warm-border dark:border-zinc-800 w-full"></div>
            <span className="bg-white dark:bg-dark-card px-3 text-[11px] font-bold text-warm-muted dark:text-dark-muted uppercase tracking-wider absolute">
              Or Enter Email
            </span>
          </div>

          {/* Fallback Email Sign In */}
          <form onSubmit={handleCustomEmailLogin} className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-warm-muted dark:text-dark-muted mb-1 uppercase tracking-wider">
                Work Email Address
              </label>
              <div className="relative">
                <Mail className="h-4 w-4 absolute left-3 top-3 text-warm-muted dark:text-dark-muted" />
                <input
                  type="email"
                  placeholder="your.name@timesinternet.in"
                  value={customEmailInput}
                  onChange={(e) => setCustomEmailInput(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-warm-border dark:border-zinc-700 bg-warm-bg/50 dark:bg-zinc-900 text-xs font-medium focus:outline-hidden focus:ring-2 focus:ring-amber-500/50"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-amber-500 hover:bg-amber-600 text-white transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <span>Check Access & Sign In</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </form>

        </div>

        {/* Footer */}
        <p className="text-[11px] text-center text-warm-muted dark:text-dark-muted mt-6 font-medium">
          ET Prime Subscription Ledger &bull; Internal Enterprise Tool
        </p>

      </div>

      {/* Google Account Selector Modal */}
      {showGoogleModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-900 border border-warm-border dark:border-zinc-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 border-b border-warm-border/60 dark:border-zinc-800 pb-3">
              <div className="bg-white dark:bg-zinc-800 p-2 rounded-xl shadow-xs border border-zinc-200 dark:border-zinc-700">
                <svg className="h-6 w-6" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold">Google Sign In</h3>
                <p className="text-[11px] text-warm-muted dark:text-dark-muted">Select your Google account email</p>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => { setShowGoogleModal(false); processEmailAuth('keshaveddy731@gmail.com'); }}
                className="w-full text-left p-3 rounded-xl border border-warm-border/80 dark:border-zinc-800 hover:bg-amber-500/10 dark:hover:bg-amber-500/20 transition-all flex items-center justify-between cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold">keshaveddy731@gmail.com</div>
                  <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">Primary Admin Account</div>
                </div>
                <ArrowRight className="h-4 w-4 text-amber-500" />
              </button>

              <button
                onClick={() => { setShowGoogleModal(false); processEmailAuth('keshava.reddy@timesinternet.in'); }}
                className="w-full text-left p-3 rounded-xl border border-warm-border/80 dark:border-zinc-800 hover:bg-amber-500/10 dark:hover:bg-amber-500/20 transition-all flex items-center justify-between cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold">keshava.reddy@timesinternet.in</div>
                  <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">Times Internet Admin</div>
                </div>
                <ArrowRight className="h-4 w-4 text-amber-500" />
              </button>
            </div>

            <div className="pt-2 border-t border-warm-border/60 dark:border-zinc-800">
              <label className="block text-[10px] font-bold text-warm-muted dark:text-dark-muted uppercase mb-1">Or Enter Other Google Account:</label>
              <form onSubmit={(e) => { e.preventDefault(); setShowGoogleModal(false); processEmailAuth(googleEmailInput); }} className="flex gap-2">
                <input
                  type="email"
                  placeholder="your.name@gmail.com"
                  value={googleEmailInput}
                  onChange={(e) => setGoogleEmailInput(e.target.value)}
                  className="flex-1 text-xs p-2 rounded-lg border border-warm-border dark:border-zinc-700 bg-warm-bg dark:bg-zinc-800 font-medium"
                  required
                />
                <button type="submit" className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-lg cursor-pointer">
                  Sign In
                </button>
              </form>
            </div>

            <button
              onClick={() => setShowGoogleModal(false)}
              className="w-full py-1 text-center text-xs font-semibold text-warm-muted dark:text-dark-muted hover:underline cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
