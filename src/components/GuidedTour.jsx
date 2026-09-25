/**
 * GuidedTour.jsx — first-visit walkthrough of the top navigation.
 *
 * Two phases. `ask` shows a small centred card asking whether the user wants a
 * tour. `tour` walks the nav pills one tab at a time: the app switches to that
 * tab, the pill is spotlighted (a dimmed overlay with a cut-out around it) and
 * a popover under the pill says what the tab is for. Only tabs present in the
 * `tabs` prop are covered. The last step is not a tab: it spotlights the
 * floating Ask Insights button (also tagged `data-tour-tab`) with the popover
 * above it, since the button sits at the bottom of the screen.
 *
 * The spotlight is measured from the live pill (`data-tour-tab` attribute) and
 * re-measured on resize and scroll, so it tracks the sticky header and the
 * horizontally scrolling pill bar on phones. When the tour ends the app returns
 * to the tab the user was on before it started.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Compass, X } from 'lucide-react';

export const TOUR_COPY = {
  'Realtime': {
    title: 'Realtime',
    body: "Today's purchases as they happen, hour by hour, with an end-of-day estimate against the same weekday over the past four weeks. The place to start each morning.",
  },
  'Funnel Analysis': {
    title: 'Funnel Analysis',
    body: 'How readers move from daily active users through paywall hits, plan page, plan selected and pay initiated to purchase, split by platform and marketing team.',
  },
  'Subscription Report': {
    title: 'Subscription Report',
    body: 'Revenue and conversions over any date range, cut by platform, channel, transaction type and plan tenure, plus a world map of where revenue comes from.',
  },
  'Renewals & Recurring': {
    title: 'Renewals & Recurring',
    body: 'Renewals due against renewed and the renewal rate by platform and plan, and the share of fresh sales that choose a recurring plan (auto and manual renewals excluded).',
  },
  'ARPU': {
    title: 'ARPU',
    body: 'Average revenue per conversion across dates, campaign themes and platforms, with every underlying transaction in the table below the charts.',
  },
  'MIS': {
    title: 'MIS',
    body: 'The monthly ET Prime MIS and the PM Performance Report as one ledger: daily, rolling and monthly columns with day-on-day changes.',
  },
  'Insights Hub': {
    title: 'Insights Hub',
    body: 'Weekly performance reports land here every Monday in four cuts: revenue & AOP pacing, funnel, renewals & recurring, and team & channel. You can also opt in to Google Chat alerts.',
  },
};

/** The closing step: the floating Ask Insights button, not a nav tab. */
export const ASK_INSIGHTS_STEP = 'Ask Insights';
TOUR_COPY[ASK_INSIGHTS_STEP] = {
  title: 'Ask Insights',
  body: 'Ask questions in plain English — "Telecalling GTV for the last 7 days", "team-wise funnel", "compare this month vs last month" — and get the numbers, a chart and a table computed from the same data as the tabs. Open it any time from this button.',
};

const POPOVER_W = 320;
const GAP = 12;

export default function GuidedTour({ open, mode = 'ask', tabs, activeTab, onSelectTab, onClose, onStart }) {
  const [phase, setPhase] = useState(mode);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const returnTabRef = useRef(activeTab);

  const steps = useMemo(() => [...(tabs || []).filter((t) => TOUR_COPY[t] && t !== ASK_INSIGHTS_STEP), ASK_INSIGHTS_STEP], [tabs]);
  const tabCount = steps.length - 1;
  const current = steps[step];

  // Reset whenever the tour is (re)opened; remember where the user was.
  useEffect(() => {
    if (!open) return;
    setPhase(mode);
    setStep(0);
    returnTabRef.current = activeTab;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  // The walkthrough has begun (from the prompt or a replay): let the app clear
  // anything floating above the page, such as the Ask Insights window.
  useEffect(() => {
    if (open && phase === 'tour') onStart?.();
  }, [open, phase, onStart]);

  const finish = useCallback((outcome) => {
    if (returnTabRef.current && onSelectTab) onSelectTab(returnTabRef.current);
    onClose?.(outcome);
  }, [onClose, onSelectTab]);

  // Show the tab being explained (the Ask Insights step keeps the current tab).
  useEffect(() => {
    if (!open || phase !== 'tour' || !current || current === ASK_INSIGHTS_STEP) return;
    if (activeTab !== current && onSelectTab) onSelectTab(current);
  }, [open, phase, current, activeTab, onSelectTab]);

  // Measure the pill; keep measuring while the layout can move.
  const measure = useCallback(() => {
    if (!current) return;
    const el = document.querySelector(`[data-tour-tab="${current}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom });
  }, [current]);

  useLayoutEffect(() => {
    if (!open || phase !== 'tour' || !current) return undefined;
    const el = document.querySelector(`[data-tour-tab="${current}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    measure();
    const raf = requestAnimationFrame(measure);
    const t1 = setTimeout(measure, 150);
    const t2 = setTimeout(measure, 450); // after the smooth scroll settles
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, phase, current, measure]);

  // Keyboard: Esc leaves, arrows move.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') finish(phase === 'ask' ? 'declined' : 'skipped');
      if (phase !== 'tour') return;
      if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, steps.length - 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase, steps.length, finish]);

  if (!open) return null;

  // ---- phase 1: the question ------------------------------------------------
  if (phase === 'ask') {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="tour-ask-title">
        <div className="w-full max-w-sm bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/15 text-amber-accent flex items-center justify-center shrink-0">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <h2 id="tour-ask-title" className="text-base font-black text-warm-text dark:text-dark-text leading-tight">Welcome to the Subscription Ledger</h2>
              <p className="text-[11px] text-warm-muted dark:text-dark-muted font-semibold">First time here?</p>
            </div>
          </div>
          <p className="text-sm text-warm-text dark:text-dark-text leading-relaxed mb-5">
            Would you like a quick tour of the {tabCount} tabs and Ask Insights? It takes under a minute, and you can replay it any time from your profile menu.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => { setStep(0); setPhase('tour'); }}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#ED1C24] hover:bg-[#c9151c] text-white text-sm font-bold shadow-sm transition-colors cursor-pointer"
            >
              Start the tour
            </button>
            <button
              type="button"
              onClick={() => finish('declined')}
              className="px-4 py-2.5 rounded-xl border border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text text-sm font-semibold transition-colors cursor-pointer"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- phase 2: the walkthrough -----------------------------------------------
  if (!current) return null;
  const copy = TOUR_COPY[current];
  const isLast = step === steps.length - 1;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const popW = Math.min(POPOVER_W, vw - 32);
  const anchorCenter = rect ? rect.left + rect.width / 2 : vw / 2;
  const popLeft = Math.max(16, Math.min(anchorCenter - popW / 2, vw - popW - 16));
  // Below the anchor unless it sits in the lower half of the screen (the
  // floating Ask Insights button), then above it.
  const placeAbove = !!rect && rect.top > vh / 2;
  const popPos = placeAbove ? { bottom: vh - rect.top + GAP } : { top: rect ? rect.bottom + GAP : 96 };
  const arrowLeft = Math.max(18, Math.min(anchorCenter - popLeft, popW - 18));
  const stepKind = 'Step';

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-labelledby="tour-step-title">
      {/* click-catcher: the page underneath is not interactive during the tour */}
      <div className="absolute inset-0" onClick={() => finish('skipped')} />

      {/* spotlight: the pill stays fully visible, everything else dims */}
      {rect && (
        <div
          className="absolute rounded-full pointer-events-none transition-all duration-300 ease-out ring-2 ring-amber-400/90"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.62)',
          }}
        />
      )}
      {!rect && <div className="absolute inset-0 bg-slate-900/60 pointer-events-none" />}

      {/* popover under the pill */}
      <div
        className="absolute bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl shadow-2xl p-4 transition-all duration-300 ease-out"
        style={{ ...popPos, left: popLeft, width: popW }}
      >
        <div
          className={`absolute h-4 w-4 rotate-45 bg-white dark:bg-dark-card border-warm-border dark:border-dark-border ${placeAbove ? '-bottom-2 border-r border-b' : '-top-2 border-l border-t'}`}
          style={{ left: arrowLeft - 8 }}
        />
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-amber-accent">{stepKind} {step + 1} of {steps.length}</p>
            <h3 id="tour-step-title" className="text-sm font-black text-warm-text dark:text-dark-text leading-tight mt-0.5">{copy.title}</h3>
          </div>
          <button
            type="button"
            onClick={() => finish('skipped')}
            aria-label="Skip the tour"
            title="Skip (Esc)"
            className="h-7 w-7 -mr-1 -mt-1 rounded-full flex items-center justify-center text-warm-muted dark:text-dark-muted hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[13px] text-warm-text dark:text-dark-text leading-relaxed">{copy.body}</p>

        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((t, i) => (
              <span key={t} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-4 bg-amber-accent' : 'w-1.5 bg-warm-border dark:bg-dark-border'}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="h-8 px-3 rounded-lg border border-warm-border dark:border-dark-border text-xs font-bold text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text flex items-center gap-1 transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => (isLast ? finish('completed') : setStep((s) => s + 1))}
              className="h-8 px-3.5 rounded-lg bg-[#ED1C24] hover:bg-[#c9151c] text-white text-xs font-bold flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
            >
              {isLast ? 'Done' : 'Next'} {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
