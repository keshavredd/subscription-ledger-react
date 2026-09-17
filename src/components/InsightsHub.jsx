/**
 * InsightsHub.jsx
 * Weekly report archive + Gemini cross-week summarization + GChat alert opt-ins.
 *
 * Data sources (all in the app's own Firebase project):
 *   insight_reports/{reportType}_{weekEnd}  — written by the Cloud Run weekly job
 *     { reportType, weekStart, weekEnd, generatedAt, narrative, keyMetrics,
 *       htmlBody (revenue doc only), reportText (detailed report as markdown —
 *       the email PDF's content; no Firebase Storage on the Spark plan) }
 *   alert_catalog/{alertId}                 — admin-maintained alert definitions
 *     { name, description, frequency, joinLink, sample }
 *   alert_optins/{email}_{alertId}          — who opted into which alert
 */
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../services/firebaseService';
import { collection, query, where, orderBy, getDocs, setDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { getStoredApiKey, GEMINI_MODEL } from '../services/geminiService';
import { FileText, Bell, Sparkles, ChevronDown, ChevronRight, ChevronLeft, Loader2, Check, IndianRupee, Filter, RefreshCw, Users, Zap, BarChart3 } from 'lucide-react';

const REPORT_TYPES = [
  { id: 'weekly_revenue_aop', name: 'Weekly Revenue & AOP Pacing', desc: 'Weekly revenue vs 4-week baseline, monthly AOP target tracking, platform and plan splits.', Icon: IndianRupee, iconBg: 'bg-emerald-500/10', iconFg: 'text-emerald-600 dark:text-emerald-300' },
  { id: 'weekly_funnel', name: 'Weekly Funnel & Conversion', desc: 'DAU → paywall → plan page → purchase: step conversions and platform funnel breakdown.', Icon: Filter, iconBg: 'bg-blue-500/10', iconFg: 'text-blue-600 dark:text-blue-300' },
  { id: 'weekly_renewals_recurring', name: 'Weekly Renewals & Recurring', desc: 'Renewals due / renewed / rate by platform, recurring adoption and revenue share.', Icon: RefreshCw, iconBg: 'bg-violet-500/10', iconFg: 'text-violet-600 dark:text-violet-300' },
  { id: 'weekly_team_channel', name: 'Weekly Team & Channel Attribution', desc: 'Marketing team and channel contribution, recurring split by acquisition team.', Icon: Users, iconBg: 'bg-rose-500/10', iconFg: 'text-rose-600 dark:text-rose-300' },
];

// Visual identity for alert cards, keyed by catalog doc id (sensible fallback for future alerts)
const ALERT_META = {
  revenue_updates_daily: { Icon: BarChart3, iconBg: 'bg-emerald-500/10', iconFg: 'text-emerald-600 dark:text-emerald-300' },
  realtime_funnel_alerts: { Icon: Zap, iconBg: 'bg-rose-500/10', iconFg: 'text-rose-600 dark:text-rose-300' },
  teamwise_funnel_alerts: { Icon: Users, iconBg: 'bg-sky-500/10', iconFg: 'text-sky-600 dark:text-sky-300' },
};
const ALERT_META_DEFAULT = { Icon: Bell, iconBg: 'bg-amber-500/10', iconFg: 'text-amber-600 dark:text-amber-300' };

const cardCls = "bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm";

// Minimal renderer for the Cloud Run job's reportText markdown (headings,
// hyphen bullets, **bold** lead-ins, pipe tables). Content is our own job's
// output, but everything is rendered as text nodes — no HTML injection.
function ReportTextView({ text }) {
  const blocks = useMemo(() => {
    const out = [];
    const lines = String(text || '').split('\n');
    let table = null;
    const flushTable = () => { if (table) { out.push(table); table = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('|')) {
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        if (cells.every(c => /^-{3,}$/.test(c))) continue; // separator row
        if (!table) table = { kind: 'table', header: cells, rows: [] };
        else table.rows.push(cells);
        continue;
      }
      flushTable();
      if (!line) continue;
      if (line.startsWith('## ')) out.push({ kind: 'h2', text: line.slice(3) });
      else if (line.startsWith('# ')) out.push({ kind: 'h1', text: line.slice(2) });
      else if (line.startsWith('- ')) out.push({ kind: 'li', text: line.slice(2) });
      else {
        const m = line.match(/^\*\*(.+?):\*\*\s*(.*)$/);
        if (m) out.push({ kind: 'kv', label: m[1], text: m[2] });
        else out.push({ kind: 'p', text: line });
      }
    }
    flushTable();
    return out;
  }, [text]);

  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        if (b.kind === 'h1') return <div key={i} className="text-sm font-black text-warm-text dark:text-dark-text">{b.text}</div>;
        if (b.kind === 'h2') return <div key={i} className="text-xs font-black uppercase tracking-wider text-amber-accent pt-2">{b.text}</div>;
        if (b.kind === 'li') return <div key={i} className="text-xs text-warm-muted dark:text-dark-muted leading-relaxed flex gap-2"><span className="text-amber-accent shrink-0">•</span><span>{b.text}</span></div>;
        if (b.kind === 'kv') return <div key={i} className="text-xs text-warm-muted dark:text-dark-muted leading-relaxed"><span className="font-bold text-warm-text dark:text-dark-text">{b.label}:</span> {b.text}</div>;
        if (b.kind === 'table') return (
          <div key={i} className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  {b.header.map((h, hi) => (
                    <th key={hi} className={`px-2.5 py-1.5 font-bold text-warm-text dark:text-dark-text bg-black/5 dark:bg-white/5 border border-warm-border/60 dark:border-dark-border/60 ${hi === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((c, ci) => (
                      <td key={ci} className={`px-2.5 py-1.5 border border-warm-border/60 dark:border-dark-border/60 ${ci === 0 ? 'text-left font-semibold text-warm-text dark:text-dark-text' : 'text-right text-warm-muted dark:text-dark-muted'} whitespace-nowrap`}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        return <p key={i} className="text-xs text-warm-muted dark:text-dark-muted leading-relaxed">{b.text}</p>;
      })}
    </div>
  );
}

export default function InsightsHub({ isDark, currentUser }) {
  const [selectedType, setSelectedType] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [expandedReport, setExpandedReport] = useState(null);
  const [expandedDetail, setExpandedDetail] = useState(null);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [rangePreset, setRangePreset] = useState('all');
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState(null);   // Firestore error code when the catalog read failed
  const [alertsReload, setAlertsReload] = useState(0);    // bump to re-run the catalog fetch
  const [optedIn, setOptedIn] = useState({});
  const [openSamples, setOpenSamples] = useState({});

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
  // The two reads are independent: a failed opt-in lookup must not hide the
  // catalog, and a failed catalog read is surfaced (code + Retry) instead of
  // masquerading as "no alerts published yet".
  useEffect(() => {
    let cancelled = false;
    setAlertsLoading(true);
    setAlertsError(null);
    (async () => {
      let cat = null;
      try {
        const catSnap = await getDocs(query(collection(db, 'alert_catalog'), orderBy('name')));
        cat = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (err) {
        console.warn('[InsightsHub] Error loading alert catalog:', err);
        if (!cancelled) setAlertsError(err?.code || err?.message || 'unknown error');
      }
      const mine = {};
      if (cat && userEmail) {
        try {
          const optSnap = await getDocs(query(collection(db, 'alert_optins'), where('email', '==', userEmail)));
          optSnap.docs.forEach(d => { mine[d.data().alertId] = true; });
        } catch (err) {
          console.warn('[InsightsHub] Error loading alert opt-ins:', err);
        }
      }
      if (!cancelled) {
        if (cat) setAlerts(cat);
        setOptedIn(mine);
        setAlertsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userEmail, alertsReload]);

  // Opt-ins are dashboard-side records only: joining/leaving the Chat space
  // itself always happens in Google Chat (we can only open the join link).
  const optInDocId = (alert) => `${userEmail.replace(/[^a-z0-9@._-]/gi, '_')}_${alert.id}`;

  const optIn = async (alert) => {
    if (!userEmail) return;
    try {
      await setDoc(doc(db, 'alert_optins', optInDocId(alert)), {
        email: userEmail,
        alertId: alert.id,
        alertName: alert.name || alert.id,
        optedInAt: serverTimestamp(),
      });
      setOptedIn(prev => ({ ...prev, [alert.id]: true }));
      if (alert.joinLink) window.open(alert.joinLink, '_blank', 'noopener');
    } catch (err) {
      console.warn('[InsightsHub] Opt-in error:', err);
    }
  };

  // Only exposed for coming-soon alerts (removes the interest registration);
  // live-alert membership is managed in Google Chat, not here.
  const removeOptIn = async (alert) => {
    if (!userEmail) return;
    try {
      await deleteDoc(doc(db, 'alert_optins', optInDocId(alert)));
      setOptedIn(prev => ({ ...prev, [alert.id]: false }));
    } catch (err) {
      console.warn('[InsightsHub] Opt-out error:', err);
    }
  };

  const applyRangePreset = (preset) => {
    setRangePreset(preset);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    if (preset === 'all') {
      setRangeStart(''); setRangeEnd('');
    } else if (preset === 'last30') {
      const s = new Date(today); s.setDate(s.getDate() - 30);
      setRangeStart(fmt(s)); setRangeEnd(fmt(today));
    } else if (preset === 'this_month') {
      setRangeStart(fmt(new Date(today.getFullYear(), today.getMonth(), 1))); setRangeEnd(fmt(today));
    } else if (preset === 'last_month') {
      setRangeStart(fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1)));
      setRangeEnd(fmt(new Date(today.getFullYear(), today.getMonth(), 0)));
    } else if (preset === 'this_quarter') {
      const qStartMonth = Math.floor(today.getMonth() / 3) * 3;
      setRangeStart(fmt(new Date(today.getFullYear(), qStartMonth, 1))); setRangeEnd(fmt(today));
    }
    // 'custom' keeps whatever is in the date inputs
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
        detailed_report: (r.reportText || '').slice(0, 4000),
      }));
      const prompt = `You are a revenue analyst at ET Prime. Below are the weekly "${selectedType.name}" report narratives for ${weeks.length} week(s). Synthesize them into a crisp cross-period summary for a business audience:
1. "The story of the period" — 2-3 sentences on the overall trajectory.
2. "Key highlights" — 4-6 bullets with concrete numbers and week references.
3. "Watch-outs" — 2-3 bullets on persistent or worsening problems.
Use plain text with the three section titles, hyphen bullets, no markdown symbols other than hyphens.

WEEKLY NARRATIVES (JSON):
${JSON.stringify(weeks, null, 1).slice(0, 28000)}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        let errMsg = '';
        try { errMsg = JSON.parse(errBody)?.error?.message || ''; } catch { errMsg = errBody; }
        throw new Error(`Gemini HTTP ${res.status}${errMsg ? ` — ${errMsg.slice(0, 180)}` : ''}`);
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error(`Empty response from Gemini (finishReason: ${data?.candidates?.[0]?.finishReason || 'unknown'})`);
      setSummary(text.trim());
    } catch (err) {
      console.warn('[InsightsHub] Summarize error:', err);
      setSummaryError(`Could not generate the summary. ${err.message || ''}`.trim());
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
              onClick={() => { setSelectedType(null); setReports([]); setSummary(null); setExpandedDetail(null); }}
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
            <select
              value={rangePreset}
              onChange={e => applyRangePreset(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-bold rounded-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text focus:outline-none cursor-pointer"
            >
              <option value="all">All weeks</option>
              <option value="last30">Last 30 days</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="this_quarter">This quarter</option>
              <option value="custom">Custom range</option>
            </select>
            {rangePreset === 'custom' && (
              <>
                <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} className="px-2.5 py-1.5 text-xs font-medium rounded-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text focus:outline-none" />
                <span className="text-xs text-warm-muted dark:text-dark-muted">to</span>
                <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} className="px-2.5 py-1.5 text-xs font-medium rounded-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text focus:outline-none" />
              </>
            )}
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
              const isDetailOpen = expandedDetail === r.id;
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
                      {r.reportText && (
                        <button
                          type="button"
                          onClick={() => setExpandedDetail(isDetailOpen ? null : r.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text cursor-pointer hover:text-amber-accent"
                        >
                          <FileText className="h-3 w-3" /> {isDetailOpen ? 'Hide Report' : 'Detailed Report'}
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

                  {isDetailOpen && r.reportText && (
                    <div className="mt-4 pt-4 border-t border-warm-border/60 dark:border-dark-border/60">
                      <ReportTextView text={r.reportText} />
                    </div>
                  )}

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
          Archived every Monday — browse weeks, read reports, summarize any date range.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-4 mb-10">
        {REPORT_TYPES.map(rt => (
          <button
            key={rt.id}
            type="button"
            onClick={() => setSelectedType(rt)}
            className={`${cardCls} p-5 text-left hover:shadow-md hover:border-amber-500/40 hover:-translate-y-0.5 transition-all cursor-pointer group/rt`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${rt.iconBg}`}>
                <rt.Icon className={`h-4 w-4 ${rt.iconFg}`} />
              </div>
              <div className="text-sm font-black text-warm-text dark:text-dark-text group-hover/rt:text-amber-accent transition-colors">{rt.name}</div>
            </div>
            <p className="text-xs text-warm-muted dark:text-dark-muted leading-relaxed max-h-0 opacity-0 overflow-hidden group-hover/rt:max-h-24 group-hover/rt:opacity-100 group-hover/rt:mt-1.5 transition-all duration-300 ease-out">{rt.desc}</p>
            <div className="mt-3 text-[11px] font-bold text-amber-accent flex items-center gap-1">
              View reports <ChevronRight className="h-3 w-3 group-hover/rt:translate-x-0.5 transition-transform" />
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
          Opt in to join an alert's Chat space — to stop the alerts, leave the space in Google Chat.
        </p>
      </div>
      {alertsLoading ? (
        <div className="flex items-center gap-2 text-sm font-semibold text-warm-muted dark:text-dark-muted mt-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading alerts…
        </div>
      ) : alertsError ? (
        <div className={`${cardCls} p-8 text-center mt-4`}>
          <Bell className="h-7 w-7 mx-auto mb-2 text-red-600 dark:text-red-400" />
          <p className="text-sm font-bold text-warm-text dark:text-dark-text mb-1">Couldn't load alerts</p>
          <p className="text-xs text-warm-muted dark:text-dark-muted">
            Firestore returned <code className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono text-[11px] text-warm-text dark:text-dark-text">{alertsError}</code>
          </p>
          <button
            type="button"
            onClick={() => setAlertsReload(n => n + 1)}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:text-amber-accent cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
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
            const isComingSoon = a.status === 'coming_soon';
            const meta = ALERT_META[a.id] || ALERT_META_DEFAULT;
            const sampleOpen = !!openSamples[a.id];
            return (
              <div key={a.id} className={`${cardCls} p-5 flex flex-col hover:shadow-md transition-shadow group/al`}>
                <div className="flex items-start gap-3 mb-2">
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${meta.iconBg}`}>
                    <meta.Icon className={`h-4 w-4 ${meta.iconFg}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-sm font-black text-warm-text dark:text-dark-text">{a.name || a.id}</div>
                      {isComingSoon && (
                        <span className="px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-black bg-sky-500/10 text-sky-600 dark:text-sky-300 border border-sky-500/30">Coming soon</span>
                      )}
                    </div>
                    {a.frequency && (
                      <span className="mt-1 inline-flex px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide bg-black/5 dark:bg-white/10 text-warm-muted dark:text-dark-muted">{a.frequency}</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-warm-muted dark:text-dark-muted leading-relaxed max-h-0 opacity-0 overflow-hidden group-hover/al:max-h-40 group-hover/al:opacity-100 group-hover/al:mt-1 transition-all duration-300 ease-out">{a.description}</p>
                {a.sample && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setOpenSamples(prev => ({ ...prev, [a.id]: !sampleOpen }))}
                      className="flex items-center gap-1 text-[10.5px] font-bold text-warm-muted dark:text-dark-muted hover:text-amber-accent cursor-pointer"
                    >
                      <ChevronDown className={`h-3 w-3 transition-transform ${sampleOpen ? 'rotate-180' : ''}`} />
                      {sampleOpen ? 'Hide sample message' : 'View sample message'}
                    </button>
                    {sampleOpen && (
                      <pre className="mt-2 p-2.5 rounded-lg bg-black/5 dark:bg-white/5 text-[10px] leading-snug text-warm-muted dark:text-dark-muted whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{a.sample}</pre>
                    )}
                  </div>
                )}
                <div className="flex-1" />
                {isIn ? (
                  <>
                    <button
                      type="button"
                      onClick={() => { if (a.joinLink) window.open(a.joinLink, '_blank', 'noopener'); }}
                      className={`mt-4 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold border transition-all bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 ${a.joinLink ? 'cursor-pointer hover:bg-emerald-500/20' : 'cursor-default'}`}
                    >
                      <Check className="h-3.5 w-3.5" /> {isComingSoon ? 'Interest registered' : 'Opted in — open space'}
                    </button>
                    {isComingSoon && (
                      <button
                        type="button"
                        onClick={() => removeOptIn(a)}
                        className="mt-1.5 text-[10px] font-semibold text-warm-muted dark:text-dark-muted hover:text-rose-500 dark:hover:text-rose-400 underline underline-offset-2 cursor-pointer self-center"
                      >
                        Remove interest
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => optIn(a)}
                    className="mt-4 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold border transition-all cursor-pointer bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-700 dark:text-amber-300"
                  >
                    <Bell className="h-3.5 w-3.5" /> {isComingSoon ? 'Register interest' : 'Opt in & join space'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
