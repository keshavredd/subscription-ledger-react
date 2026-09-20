/**
 * tourService.js — has this user seen the guided tour?
 *
 * The answer lives on the user's own Firestore session document
 * (admin_user_sessions/{email}, field `tourVersionSeen`) so it follows them
 * across devices; localStorage mirrors it so a Firestore hiccup never re-asks
 * someone who already answered. Bump TOUR_VERSION to offer the tour again after
 * a change worth announcing.
 */
import { getUserTourStateFS, setUserTourStateFS } from './firestoreService';

export const TOUR_VERSION = 1;

const localKey = (email) => `et_tour_v${TOUR_VERSION}_${String(email || '').toLowerCase().trim()}`;

/** True when the tour prompt should be shown to this user. */
export async function shouldOfferTour(email) {
  if (!email) return false;
  try {
    if (localStorage.getItem(localKey(email))) return false;
  } catch (_) { /* storage blocked: fall through to Firestore */ }
  const remote = await getUserTourStateFS(email);
  if (remote && Number(remote.tourVersionSeen || 0) >= TOUR_VERSION) {
    try { localStorage.setItem(localKey(email), remote.tourOutcome || 'seen'); } catch (_) { /* ignore */ }
    return false;
  }
  return true;
}

/** Record how the prompt / tour ended: 'declined' | 'skipped' | 'completed'. */
export async function markTourSeen(email, outcome) {
  if (!email) return;
  try { localStorage.setItem(localKey(email), outcome || 'seen'); } catch (_) { /* ignore */ }
  await setUserTourStateFS(email, { tourVersionSeen: TOUR_VERSION, tourOutcome: outcome || 'seen' });
}
