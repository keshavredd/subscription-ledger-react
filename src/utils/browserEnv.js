/**
 * browserEnv.js
 * Pure browser-environment detection used to choose an OAuth sign-in strategy.
 * Kept free of Firebase (and any other) imports so it can be unit tested.
 */

/**
 * True for environments where a popup-based OAuth flow cannot be relied upon:
 *
 *  - iOS/iPadOS: "Block Pop-ups" is enabled by default in Safari settings, so
 *    signInWithPopup fails with auth/popup-blocked before the user sees anything.
 *  - Embedded in-app browsers (Gmail, LinkedIn, Slack, Teams, Facebook, ...):
 *    popups are unavailable, and Google rejects OAuth in some of these webviews.
 *  - Desktop Safari: ITP restrictions on third-party storage break the
 *    cross-origin popup handshake with *.firebaseapp.com.
 *
 * @param {{userAgent?: string, platform?: string, maxTouchPoints?: number, vendor?: string}} [nav]
 *        Navigator-like object. Defaults to the live `navigator`.
 */
export function prefersRedirectSignIn(nav) {
  const n = nav ?? (typeof navigator !== 'undefined' ? navigator : null);
  if (!n) return false;

  const ua = n.userAgent || '';
  const vendor = n.vendor || '';
  const platform = n.platform || '';
  const touchPoints = n.maxTouchPoints || 0;

  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports a desktop Mac UA; touch points disambiguate it.
    (platform === 'MacIntel' && touchPoints > 1);

  // Chrome/Firefox/Edge on iOS are WebKit wrappers, but they do support popups.
  const isIOSRealBrowser = /CriOS|FxiOS|EdgiOS/i.test(ua);

  const isEmbeddedWebView =
    /FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp|WhatsApp|MicroMessenger|Snapchat/i.test(ua) ||
    // iOS webviews omit the "Safari" token that real Safari always includes.
    (isIOS && !isIOSRealBrowser && !/Safari/i.test(ua)) ||
    // Android WebView marker.
    /;\s*wv\)/i.test(ua);

  const isAppleSafari =
    /Safari/i.test(ua) &&
    !/Chrome|Chromium|Android|CriOS|FxiOS|EdgiOS|Edg\//i.test(ua) &&
    /Apple/i.test(vendor);

  return isIOS || isEmbeddedWebView || isAppleSafari;
}
