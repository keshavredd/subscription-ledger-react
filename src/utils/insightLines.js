/**
 * insightLines.js — one or two lines of commentary for a Conversational
 * Analytics answer, derived from the answer's own chart or table so the
 * numbers always agree with what is shown below them.
 *
 * Time-like series (dates, weeks, hours) get: direction first→last, peak and
 * low. Categorical series get: leader, trailer, how many sit above average.
 * Answers without a chart or table (greetings, help) are left untouched.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  const cleaned = String(v).replace(/[₹,%\s]/g, '').replace(/[LK]$/i, (m) => (m.toUpperCase() === 'L' ? 'e5' : 'e3'));
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const isTimeLabel = (l) => /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}$|^\d{1,2}\s?[A-Za-z]{3}\b|^(week|wk|w)\s?\d|^\d{1,2}(:\d{2})?\s?(am|pm|h)?$/i.test(String(l).trim());

const niceLabel = (l) => {
  const s = String(l).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${parseInt(iso[3], 10)} ${MONTHS_SHORT[parseInt(iso[2], 10) - 1]}`;
  const md = s.match(/^(\d{2})\/(\d{2})$/);
  if (md) return `${parseInt(md[2], 10)} ${MONTHS_SHORT[parseInt(md[1], 10) - 1]}`;
  return s;
};

function makeFormatter(hint) {
  const h = String(hint || '').toLowerCase();
  const isPct = /rate|%|share|conversion|retention|pacing/.test(h);
  const isMoney = /₹|revenue|gtv|arpu|aov|value/.test(h);
  const fmt = (v) => {
    if (v === null || v === undefined) return '—';
    if (isPct) return `${Number(v).toFixed(1)}%`;
    if (isMoney) {
      const a = Math.abs(v);
      if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
      if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
      return `₹${Math.round(v).toLocaleString('en-IN')}`;
    }
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    return Number.isInteger(v) ? v.toLocaleString('en-IN') : Number(v).toFixed(1);
  };
  fmt.isPct = isPct;
  return fmt;
}

function seriesLines(name, labels, values, fmt, timeLike) {
  const pts = labels.map((l, i) => ({ l, v: toNumber(values[i]) })).filter((p) => p.v !== null);
  if (pts.length < 2) return [];
  const hi = pts.reduce((a, b) => (b.v > a.v ? b : a));
  const lo = pts.reduce((a, b) => (b.v < a.v ? b : a));
  const label = name ? `${name} ` : '';
  if (timeLike) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    const chg = first.v !== 0 ? ((last.v - first.v) / Math.abs(first.v)) * 100 : 0;
    const dir = Math.abs(chg) < 1 ? 'held flat' : chg > 0 ? `rose **${chg.toFixed(0)}%**` : `fell **${Math.abs(chg).toFixed(0)}%**`;
    return [
      `${label ? label.charAt(0).toUpperCase() + label.slice(1) : 'Values '}${dir} from **${fmt(first.v)}** on ${niceLabel(first.l)} to **${fmt(last.v)}** on ${niceLabel(last.l)}, ` +
      `peaking on **${niceLabel(hi.l)}** (${fmt(hi.v)}) with the low on **${niceLabel(lo.l)}** (${fmt(lo.v)}).`,
    ];
  }
  const avg = pts.reduce((a, p) => a + p.v, 0) / pts.length;
  const above = pts.filter((p) => p.v > avg).length;
  const gap = hi.v - lo.v;
  const gapText = fmt.isPct ? `${gap.toFixed(1)} points` : fmt(gap);
  return [
    `**${niceLabel(hi.l)}** leads ${label ? `on ${label.trim()} ` : ''}at **${fmt(hi.v)}** while **${niceLabel(lo.l)}** trails at **${fmt(lo.v)}**, a gap of ${gapText}; ` +
    `${above} of ${pts.length} sit above the average of ${fmt(avg)}.`,
  ];
}

/** Returns 0–2 markdown lines describing the answer's data, or an empty array. */
export function deriveInsightLines(result) {
  if (!result || result.insights === 'custom') return [];
  const chart = result.chart;
  const lines = [];

  if (chart && Array.isArray(chart.labels) && chart.labels.length >= 2) {
    const timeLike = chart.type === 'line' || chart.labels.every(isTimeLabel);
    const series = Array.isArray(chart.series) && chart.series.length
      ? chart.series
      : Array.isArray(chart.values) ? [{ name: '', values: chart.values }] : [];
    // A lone time series is named after its chart ("Daily Revenue fell 12%...");
    // categorical bars read better without a subject ("Main - IOS leads at...").
    const titleSubject = String(chart.title || '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    for (const s of series.slice(0, 2)) {
      const fmt = makeFormatter(`${chart.title || ''} ${s.name || ''}`);
      const subject = series.length > 1 ? s.name : (timeLike ? titleSubject : '');
      lines.push(...seriesLines(subject, chart.labels, s.values || [], fmt, timeLike));
      if (lines.length >= 2) break;
    }
  }

  if (!lines.length && result.table && Array.isArray(result.table.rows) && result.table.rows.length >= 2) {
    const { headers = [], rows } = result.table;
    // first column that is numeric on every row
    const colIdx = headers.findIndex((h, i) => i > 0 && rows.every((r) => toNumber(r[i]) !== null));
    if (colIdx > 0) {
      const labels = rows.map((r) => r[0]);
      const values = rows.map((r) => toNumber(r[colIdx]));
      const timeLike = labels.every(isTimeLabel);
      lines.push(...seriesLines(headers[colIdx], labels, values, makeFormatter(headers[colIdx]), timeLike));
    }
  }

  return lines.slice(0, 2);
}

/** Puts the insight lines under the answer's opening line (or at the top). */
export function withInsightLines(result) {
  const lines = deriveInsightLines(result);
  if (!lines.length) return result;
  const text = String(result.text || '');
  const cut = text.indexOf('\n\n');
  const head = cut > 0 ? text.slice(0, cut) : '';
  const rest = cut > 0 ? text.slice(cut + 2) : text;
  const insight = lines.join(' ');
  const merged = head && /[:：]\s*$/.test(head) ? `${head}\n\n${insight}\n\n${rest}` : `${insight}\n\n${text}`;
  return { ...result, text: merged, insights: 'derived' };
}
