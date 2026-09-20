/**
 * InsightsWindow.jsx
 * A window that floats above the current tab, opened from the "Ask Insights"
 * dock button. Opening plays a macOS-style genie: the panel grows out of the
 * button, stretching taller than it is wide on the way up, then settles into
 * its resting frame. Minimising runs the same path in reverse, back into the
 * button. Children stay mounted while minimised so the conversation survives.
 *
 * Geometry is measured at animation time (button rect vs. the panel's resting
 * rect), so the effect tracks wherever the button and viewport happen to be.
 * Animations run through the Web Animations API and are cancelled on finish,
 * leaving the panel with no transform at rest — a lingering transform would
 * turn the panel into the containing block for any position:fixed modal
 * rendered inside it.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const OPEN_MS = 520;
const CLOSE_MS = 420;
const EASE_OPEN = 'cubic-bezier(0.22, 1, 0.36, 1)';   // fast out, soft landing
const EASE_CLOSE = 'cubic-bezier(0.55, 0, 0.55, 0.2)'; // gathers speed into the dock

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Where the panel has to start (or end) to sit exactly over the anchor. */
function genieGeometry(panel, anchor) {
  const p = panel.getBoundingClientRect();
  const a = anchor?.getBoundingClientRect?.() || {
    left: window.innerWidth - 80, top: window.innerHeight - 80, width: 56, height: 56,
  };
  return {
    dx: (a.left + a.width / 2) - (p.left + p.width / 2),
    dy: (a.top + a.height / 2) - (p.top + p.height / 2),
    sx: Math.max(a.width / p.width, 0.02),
    sy: Math.max(a.height / p.height, 0.02),
  };
}

/**
 * Keyframes from the dock to rest. The mid-frame is deliberately taller than
 * wide and still displaced toward the dock — that stretch is what reads as
 * "being pulled out of the icon" rather than a plain zoom.
 */
function genieFrames({ dx, dy, sx, sy }) {
  return [
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.35, borderRadius: '999px', offset: 0 },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.42}px) scale(${Math.min(0.42, sx + 0.35)}, ${Math.min(0.78, sy + 0.7)})`, opacity: 1, borderRadius: '28px', offset: 0.45 },
    { transform: `translate(${dx * 0.08}px, ${dy * 0.06}px) scale(0.97, 0.99)`, opacity: 1, borderRadius: '18px', offset: 0.85 },
    { transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1, borderRadius: '16px', offset: 1 },
  ];
}

export default function InsightsWindow({ open, onClose, anchorRef, title = 'Ask Insights', children }) {
  // closed | opening | open | closing
  const [phase, setPhase] = useState(open ? 'open' : 'closed');
  const panelRef = useRef(null);
  const backdropRef = useRef(null);
  const anims = useRef([]);

  const stopAnims = useCallback(() => {
    anims.current.forEach(a => { try { a.cancel(); } catch { /* already done */ } });
    anims.current = [];
  }, []);

  // Drive phase from the `open` prop
  useEffect(() => {
    if (open && (phase === 'closed' || phase === 'closing')) setPhase('opening');
    else if (!open && (phase === 'open' || phase === 'opening')) setPhase('closing');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run the genie for the transitional phases
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop) return undefined;
    if (phase !== 'opening' && phase !== 'closing') return undefined;

    stopAnims();
    const opening = phase === 'opening';
    const duration = prefersReducedMotion() ? 0 : (opening ? OPEN_MS : CLOSE_MS);
    const frames = genieFrames(genieGeometry(panel, anchorRef?.current));
    if (!opening) {
      // Same path back into the dock: reverse the frames and re-space them so
      // the panel lingers near rest briefly, then accelerates into the icon.
      frames.reverse();
      [0, 0.15, 0.55, 1].forEach((offset, i) => { frames[i].offset = offset; });
    }

    const panelAnim = panel.animate(frames, {
      duration,
      easing: opening ? EASE_OPEN : EASE_CLOSE,
      fill: 'both',
    });
    const backdropAnim = backdrop.animate(
      opening ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
      { duration: Math.max(duration * 0.7, 0), easing: 'ease-out', fill: 'both', delay: opening ? 0 : duration * 0.15 }
    );
    anims.current = [panelAnim, backdropAnim];

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stopAnims(); // back to stylesheet values: no transform at rest
      setPhase(opening ? 'open' : 'closed');
    };
    panelAnim.onfinish = finish;
    panelAnim.oncancel = () => { /* superseded by a newer phase */ };
    if (duration === 0) finish();
    return () => { panelAnim.onfinish = null; };
  }, [phase, anchorRef, stopAnims]);

  const visible = phase !== 'closed';

  // Escape minimises; lock page scroll while the window is up
  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [visible, onClose]);

  // Move focus into the window once it has landed
  useEffect(() => {
    if (phase === 'open') panelRef.current?.focus({ preventScroll: true });
  }, [phase]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 ${visible ? '' : 'invisible pointer-events-none'}`}
      aria-hidden={!visible}
    >
      <div
        ref={backdropRef}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full max-w-[1180px] h-[min(88vh,900px)] rounded-2xl overflow-hidden shadow-2xl bg-white dark:bg-dark-card outline-none will-change-transform"
      >
        {children}
      </div>
    </div>
  );
}
