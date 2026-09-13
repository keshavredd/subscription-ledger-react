/**
 * InsightsHub.jsx
 * Weekly report archive + Gemini cross-week summarization + GChat alert opt-ins.
 *
 * Data sources (all in the app's own Firebase project):
 *   insight_reports/{reportType}_{weekEnd}  — written by the Cloud Run weekly job
 *     { reportType, weekStart, weekEnd, generatedAt, narrative, keyMetrics, htmlBody, pdfPath }
 *   alert_catalog/{alertId}                 — admin-maintained alert definitions
 *     { name, description, frequency, joinLink, sample }
 *   alert_optins/{email}_{alertId}          — who opted into which alert
 */
import React, { useState, useEffect, useMemo } from 'react';
import { db, storage } from '../services/firebaseService';
import { collection, query, where, orderBy, getDocs, setDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { getStoredApiKey } from '../services/geminiService';
import { FileText, Bell, Sparkles, ChevronDown, ChevronRight, ChevronLeft, Loader2, Check, ExternalLink } from 'lucide-react';

const REPORT_TYPES = [
  { id: 'weekly_revenue_aop', name: 'Weekly Revenue & AOP Pacing', desc: 'Weekly revenue vs 4-week baseline, monthly AOP target tracking, platform and plan splits.' },
  { id: 'weekly_funnel', name: 'Weekly Funnel & Conversion', desc: 'DAU → paywall → plan page → purchase: step conversions and platform funnel breakdown.' },
  { id: 'weekly_renewals_recurring', name: 'Weekly Renewals & Recurring', desc: 'Renewals due / renewed / rate by platform, recurring adoption and revenue share.' },
  { id: 'weekly_team_channel', name: 'Weekly Team & Channel Attribution', desc: 'Marketing team and channel contribution, recurring split by acquisition team.' },
];

const cardCls = "bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm";

export default function InsightsHub({ isDark, currentUser }) {
  const [selectedType, setSelectedType] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [expandedReport, setExpandedReport] = useState(null);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [optedIn, setOptedIn] = useState({});

  const userEmail = (currentUser?.email || '').toLowerCase();

  // ---- Reports: load when a report type is opened --------------------------
  useEffect(() => {
    if (!selectedType) return;
    let cancelled = false;
    (async () => {
      setReportsLoading(true);
      setSummary(null);
      setSummaryError(null);
      try {
        const q = query(
          collection(db, 'insight_reports'),
          where('reportType', '==', selectedType.id),
          orderBy('weekEnd', 'desc')
        );
        const snap = await getDocs(q);
        if (!cancelled) setReports(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.warn('[InsightsHub] Error loading reports:', err);
        if (!cancelled) setReports([]);
      } finally {
        if (!cancelled) setReportsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedType]);

  // ---- Alerts catalog + my opt-ins -----------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catSnap = await getDocs(query(collection(db, 'alert_catalog'), orderBy('name')));
        const cat = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        let mine = {};
        if (userEmail) {
          const optSnap = await getDocs(query(collection(db, 'alert_optins'), where('email', '==', userEmail)));
          optSnap.docs.forEach(d => { mine[d.data().alertId] = true; });
        }
        if (!cancelled) { setAlerts(cat); setOptedIn(mine); }
      } catch (err) {
        console.warn('[InsightsHub] Error loading alert catalog:', err);
      } finally {
        if (!cancelled) setAlertsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userEmail]);

  const toggleOptIn = async (alert) => {
    if (!userEmail) return;
    const id = `${userEmail.replace(/[^a-z0-9@._-]/gi, '_')}_${alert.id}`;
    try {
      if (optedIn[alert.id]) {
        await deleteDoc(doc(db, 'alert_optins', id));
        setOptedIn(prev => ({ ...prev, [alert.id]: false }));
      } else {
        await setDoc(doc(db, 'alert_optins', id), {
          email: userEmail,
          alertId: alert.id,
          alertName: alert.name || alert.id,
          optedInAt: serverTimestamp(),
        });
        setOptedIn(prev => ({ ...prev, [alert.id]: true }));
        if (alert.joinLink) window.open(alert.joinLink, '_blank', 'noopener');
      }
    } catch (err) {
      console.warn('[InsightsHub] Opt-in error:', err);
    }
  };

  const openPdf = async (pdfPath) => {
    try {
      const url = await getDownloadURL(ref(storage, pdfPath));
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      console.warn('[InsightsHub] PDF fetch error:', err);
    }
  };

  const rangedReports = useMemo(() => {
    return reports.filter(r => {
      if (rangeStart && r.weekEnd < rangeStart) return false;
      if (rangeEnd && r.weekStart > rangeEnd) return false;
      return true;
    });
  }, [reports, rangeStart, rangeEnd]);

  // ---- Gemini cross-week summarization -------------------------------------
  const summarizeHighlights = async () => {
    const apiKey = getStoredApiKey() || import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) { setSummaryError('No Gemini API key configured.'); return; }
    if (rangedReports.length === 0) { setSummaryError('No reports in the selected range.'); return; }

    setSummarizing(true);
    setSummary(null);
    setSummaryError(null);
    try {
      const weeks = rangedReports.map(r => ({
        week: `${r.weekStart} to ${r.weekEnd}`,
        narrative: r.narrative || {},
      }));
      const prompt = `You are a revenue analyst at ET Prime. Below are the weekly "${selectedType.name}" report narratives for ${weeks.length} week(s). Synthesize them into a crisp cross-period summary for a business audience:
1. "The story of the period" — 2-3 sentences on the overall trajectory.
2. "Key highlights" — 4-6 bullets with concrete numbers and week references.
3. "Watch-outs" — 2-3 bullets on persistent or worsening problems.
Use plain text with the three section titles, hyphen bullets, no markdown symbols other than hyphens.

WEEKLY NARRATIVES (JSON):
${JSON.stringify(weeks, null, 1).slice(0, 28000)}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty response from Gemini');
      setSummary(text.trim());
    } catch (err) {
      console.warn('[InsightsHub] Summarize error:', err);
      setSummaryError('Could not generate the summary. Please try again.');
    } finally {
      setSummarizing(false);
    }
  };

  // ============================ RENDER =======================================

  if (selectedType) {
    return (
      <div className="animate-in fade-in duration-300 pt-4 pb-12">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { setSelectedType(null); setReports([]); setSummary(null); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text shadow-xs cursor-pointer hover:text-amber-accent"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> All Reports
            </button>
            <div>
              <h2 className="text-xl font-black text-warm-text dark:text-dark-text tracking-tight">{selectedType.name}</h2>
              <p className="text-xs text-warm-muted dark:text-dark-muted">{selectedType.desc}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} className="px-2.5 py-1.5 text-xs font-medium rounded-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
            <span className="text-xs text-warm-muted dark:text-dark-muted">to</span>
            <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} className="px-2.5 py-1.5 text-xs font-medium rounded-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
            <button
              type="button"
              onClick={summarizeHighlights}
              disabled={summarizing || rangedReports.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 cursor-pointer disabled:opacity-50 transition-all"
            >
              {summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Summarize Key Highlights
            </button>
          </div>
        </div>

        {summaryError && <div className="mb-4 p-3 rounded-xl text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300">{summaryError}</div>}

        {summary && (
          <div className={`${cardCls} p-5 mb-6 border-amber-500/40`}>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-amber-accent" />
              <h3 className="text-sm font-black text-warm-text dark:text-dark-text uppercase tracking-wider">Cross-Week Summary ({rangedReports.length} reports)</h3>
            </div>
            <pre className="whitespace-pre-wrap text-[13px] leading-relaxed font-sans text-warm-text dark:text-dark-text">{summary}</pre>
          </div>
        )}

        {reportsLoading ? (
          <div className="flex items-center justify-center h-48 text-warm-muted dark:text-dark-muted gap-2 text-sm font-semibold">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading reports…
          </div>
        ) : rangedReports.length === 0 ? (
          <div className={`${cardCls} p-10 text-center`}>
            <FileText className="h-8 w-8 mx-auto mb-3 text-warm-muted dark:text-dark-muted" />
            <p className="text-sm font-bold text-warm-text dark:text-dark-text mb-1">No reports here yet</p>
            <p className="text-xs text-warm-muted dark:text-dark-muted">
              Reports are generated every Monday by the scheduled weekly job and will appear here automatically.
              {reports.length > 0 && ' Try widening the date range.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {rangedReports.map(r => {
              const isOpen = expandedReport === r.id;
              const highlights = r.narrative?.key_highlights || [];
              return (
                <div key={r.id} className={`${cardCls} p-5`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-black text-warm-text dark:text-dark-text">
                        Week: {r.weekStart} → {r.weekEnd}
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {highlights.slice(0, isOpen ? highlights.length : 3).map((h, i) => (
                          <li key={i} className="text-xs text-warm-muted dark:text-dark-muted leading-relaxed flex gap-2">
                            <span className="text-amber-accent shrink-0">•</span>
                            <span dangerouslySetInnerHTML={{ __html: h }} />
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.pdfPath && (
                        <button
                          type="button"
                          onClick={() => openPdf(r.pdfPath)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text cursor-pointer hover:text-amber-accent"
                        >
                          <ExternalLink className="h-3 w-3" /> PDF
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedReport(isOpen ? null : r.id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text cursor-pointer hover:text-amber-accent"
                      >
                        {isOpen ? <>Less <ChevronDown className="h-3 w-3" /></> : <>Overview <ChevronRight className="h-3 w-3" /></>}
                      </button>
                    </div>
                  </div>

                  {isOpen && r.htmlBody && (
                    <div className="mt-4 pt-4 border-t border-warm-border/60 dark:border-dark-border/60 overflow-x-auto">
                      {/* Overview HTML is generated by our own Cloud Run job */}
                      <div className="insight-report-html bg-white rounded-xl p-2" dangerouslySetInnerHTML={{ __html: r.htmlBody }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300 pt-4 pb-12">
      {/* Weekly Reports */}
      <div className="mb-2">
        <h2 className="text-xl font-black text-warm-text dark:text-dark-text tracking-tight flex items-center gap-2">
          <FileText className="h-5 w-5 text-amber-accent" /> Weekly Reports
        </h2>
        <p className="text-xs text-warm-muted dark:text-dark-muted mt-0.5">
          Every Monday's scheduled reports, archived — open one to browse weeks, read overviews, download PDFs, and summarize a date range.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-4 mb-10">
        {REPORT_TYPES.map(rt => (
          <button
            key={rt.id}
            type="button"
            onClick={() => setSelectedType(rt)}
            className={`${cardCls} p-5 text-left hover:shadow-md hover:border-amber-500/40 transition-all cursor-pointer group/rt`}
          >
            <div className="text-sm font-black text-warm-text dark:text-dark-text mb-1.5 group-hover/rt:text-amber-accent transition-colors">{rt.name}</div>
            <p className="text-xs text-warm-muted dark:text-dark-muted leading-relaxed">{rt.desc}</p>
            <div className="mt-3 text-[11px] font-bold text-amber-accent flex items-center gap-1">
              View reports <ChevronRight className="h-3 w-3" />
            </div>
          </button>
        ))}
      </div>

      {/* GChat Alerts */}
      <div className="mb-2">
        <h2 className="text-xl font-black text-warm-text dark:text-dark-text tracking-tight flex items-center gap-2">
          <Bell className="h-5 w-5 text-amber-accent" /> Google Chat Alerts
        </h2>
        <p className="text-xs text-warm-muted dark:text-dark-muted mt-0.5">
          Automated alerts posted to Google Chat spaces. Opt in to join a space — you'll be taken to the space's join link.
        </p>
      </div>
      {alertsLoading ? (
        <div className="flex items-center gap-2 text-sm font-semibold text-warm-muted dark:text-dark-muted mt-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading alerts…
        </div>
      ) : alerts.length === 0 ? (
        <div className={`${cardCls} p-8 text-center mt-4`}>
          <Bell className="h-7 w-7 mx-auto mb-2 text-warm-muted dark:text-dark-muted" />
          <p className="text-sm font-bold text-warm-text dark:text-dark-text mb-1">No alerts published yet</p>
          <p className="text-xs text-warm-muted dark:text-dark-muted">Alert subscriptions will appear here once they're set up.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
          {alerts.map(a => {
            const isIn = !!optedIn[a.id];
            return (
              <div key={a.id} className={`${cardCls} p-5 flex flex-col`}>
                <div className="text-sm font-black text-warm-text dark:text-dark-text mb-1">{a.name || a.id}</div>
                {a.frequency && <div className="text-[10px] uppercase tracking-wider font-bold text-amber-accent mb-1.5">{a.frequency}</div>}
                <p className="text-xs text-warm-muted dark:text-dark-muted leading-relaxed flex-1">{a.description}</p>
                {a.sample && (
                  <pre className="mt-3 p-2.5 rounded-lg bg-black/5 dark:bg-white/5 text-[10px] leading-snug text-warm-muted dark:text-dark-muted whitespace-pre-wrap font-mono max-h-24 overflow-y-auto">{a.sample}</pre>
                )}
                <button
                  type="button"
                  onClick={() => toggleOptIn(a)}
                  className={`mt-4 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                    isIn
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {isIn ? <><Check className="h-3.5 w-3.5" /> Opted in — click to opt out</> : <><Bell className="h-3.5 w-3.5" /> Opt in</>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
