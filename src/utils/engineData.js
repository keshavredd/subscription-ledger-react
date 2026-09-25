/**
 * engineData.js — pure aggregation helpers for the Conversational Analytics
 * deterministic engine. Everything here reads the row shapes App.jsx builds:
 *
 *   subscriptionData: { dateStr 'YYYY-MM-DD', platform (normalised), revenue,
 *                       conversions, user_txn_type, plan_category, channel,
 *                       acq_source, auto_renew ('TRUE'/'FALSE'/...) }
 *   renewalsData:     { renew_date 'YYYY-MM-DD', platform (normalised),
 *                       plan_category, renewal_due, renewed }
 *   funnelData:       { dateStr, viewType, ET_Platform|platform, Country|country,
 *                       Marketing_team|marketingTeam, DAU, paywalling_hits,
 *                       Plan_Page_Loaded|Plan_Page_Load, Plan_Selected,
 *                       Pay_Initiated, Purchased }
 *   realtimeData:     raw sheet rows { event_date, event_hour, ET_Platform,
 *                       event_name, event_count }
 *
 * No numbers are invented here: when a window has no rows the helpers return
 * empty arrays / zero totals and the answer builders say so.
 */

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_TOKENS = [
  ['january', 'jan'], ['february', 'feb'], ['march', 'mar'], ['april', 'apr'], ['may', 'may'], ['june', 'jun'],
  ['july', 'jul'], ['august', 'aug'], ['september', 'sep'], ['october', 'oct'], ['november', 'nov'], ['december', 'dec'],
];

// ---------------------------------------------------------------------------
// dates & formatting
// ---------------------------------------------------------------------------
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseYmd = (s) => {
  const [y, m, d] = String(s || '').slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};
export const isYmd = (s) => /^\d{4}-\d{2}-\d{2}/.test(String(s || ''));
export const prettyYmd = (s) => {
  const d = parseYmd(s);
  return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` : String(s);
};
export const shortYmd = (s) => {
  const d = parseYmd(s);
  return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` : String(s);
};
export const monthKeyOf = (s) => String(s || '').slice(0, 7);
export const monthLabelOf = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return y && m ? `${MONTHS_LONG[m - 1]} ${y}` : key;
};
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function inr(v) {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
  return `${sign}₹${a.toFixed(0)}`;
}
export const pct = (v, d = 1) => `${(Number(v) || 0).toFixed(d)}%`;
export const num = (v) => (Math.round(Number(v) || 0)).toLocaleString('en-IN');
export const compact = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return num(n);
};
export const rate = (a, b) => (b > 0 ? (a / b) * 100 : 0);
export const sgn = (v, d = 1) => `${v > 0 ? '+' : ''}${(Number(v) || 0).toFixed(d)}`;

// ---------------------------------------------------------------------------
// timeframe resolution
// ---------------------------------------------------------------------------
export function latestDate(rows, field) {
  let max = null;
  (rows || []).forEach((r) => {
    const v = String(r?.[field] || '').slice(0, 10);
    if (isYmd(v) && (!max || v > max)) max = v;
  });
  return max;
}
export function earliestDate(rows, field) {
  let min = null;
  (rows || []).forEach((r) => {
    const v = String(r?.[field] || '').slice(0, 10);
    if (isYmd(v) && (!min || v < min)) min = v;
  });
  return min;
}

/** Months named in the question, in order of appearance: [{ year, month (0-11), key, label }]. */
export function monthsInQuery(q, fallbackYear = new Date().getFullYear()) {
  const text = String(q || '').toLowerCase();
  const found = [];
  const re = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b(?:\s*(?:'|’)?\s*(\d{2,4}))?/g;
  let m;
  while ((m = re.exec(text))) {
    const tok = m[1] === 'sept' ? 'sep' : m[1];
    if (tok === 'may' && /\bmay\s+(be|i|you|we|have|not)\b/.test(text.slice(m.index))) continue;
    const idx = MONTH_TOKENS.findIndex(([full, short]) => tok === full || tok === short);
    if (idx < 0) continue;
    let year = m[2] ? parseInt(m[2], 10) : fallbackYear;
    if (m[2] && m[2].length === 2) year = 2000 + year;
    const key = `${year}-${String(idx + 1).padStart(2, '0')}`;
    if (!found.some((f) => f.key === key)) found.push({ year, month: idx, key, label: `${MONTHS_LONG[idx]} ${year}` });
  }
  return found;
}

/** Rows of one calendar month. */
export function monthWindow(rows, field, year, month) {
  const start = ymd(new Date(year, month, 1));
  const end = ymd(new Date(year, month + 1, 0));
  const records = (rows || []).filter((r) => { const v = String(r?.[field] || '').slice(0, 10); return v >= start && v <= end; });
  return { records, start, end, label: `${MONTHS_LONG[month]} ${year}`, kind: 'month', key: `${year}-${String(month + 1).padStart(2, '0')}` };
}

/**
 * The timeframe a question asks for, resolved against the rows we have.
 * Rolling windows end on the latest date in the data. With nothing named the
 * window is the last `defaultDays` days (kind 'default'); "all time" returns
 * every row (kind 'all').
 */
export function resolveWindow(q, rows, field, { defaultDays = 30, fallbackYear } = {}) {
  const text = String(q || '').toLowerCase();
  const all = (rows || []).filter((r) => isYmd(r?.[field]));
  const maxYmd = latestDate(all, field);
  const minYmd = earliestDate(all, field);
  const between = (a, b) => all.filter((r) => { const v = String(r[field]).slice(0, 10); return v >= a && v <= b; });
  const mk = (a, b, label, kind) => ({ records: between(a, b), start: a, end: b, label, kind, days: Math.round((parseYmd(b) - parseYmd(a)) / 86400000) + 1 });
  if (!maxYmd) return { records: [], start: null, end: null, label: 'the selected period', kind: 'empty', days: 0 };

  if (/\b(all[- ]time|overall|entire|whole|since (?:the )?(?:start|beginning)|full (?:data|history)|lifetime)\b/.test(text)) {
    return mk(minYmd, maxYmd, `all available data (${prettyYmd(minYmd)} – ${prettyYmd(maxYmd)})`, 'all');
  }
  const rolling = text.match(/(?:last|past|previous|trailing|recent)\s+(\d{1,3})\s*(?:days?|d)\b/) || text.match(/\b(\d{1,3})\s*[- ]?days?\b/) || text.match(/\b(\d{1,3})\s*d\b/);
  let n = rolling ? parseInt(rolling[1], 10) : 0;
  if (!n && /\b(?:last|past|previous|this)\s+(?:one\s+)?week\b/.test(text)) n = 7;
  if (!n && /\b(?:fortnight|two weeks|2 weeks)\b/.test(text)) n = 14;
  if (!n && /\bquarter\b/.test(text)) n = 90;
  if (n > 0) {
    const a = ymd(addDays(parseYmd(maxYmd), -(n - 1)));
    const start = a < minYmd ? minYmd : a;
    return mk(start, maxYmd, `the last ${n} days (${prettyYmd(start)} – ${prettyYmd(maxYmd)})`, 'rolling');
  }
  if (/\byesterday\b/.test(text)) {
    const y = ymd(addDays(new Date(), -1));
    const a = y <= maxYmd ? y : maxYmd;
    return mk(a, a, prettyYmd(a), 'day');
  }
  if (/\btoday\b|\blatest\b/.test(text)) return mk(maxYmd, maxYmd, prettyYmd(maxYmd), 'day');
  const now = new Date();
  if (/\bthis month\b|\bcurrent month\b|\bmtd\b|\bmonth to date\b/.test(text)) {
    const a = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    return mk(a, maxYmd, `${MONTHS_LONG[now.getMonth()]} ${now.getFullYear()} (month to date)`, 'month');
  }
  if (/\blast month\b|\bprevious month\b/.test(text)) {
    const w = monthWindow(all, field, now.getFullYear(), now.getMonth() - 1);
    return { ...w, days: w.records.length ? undefined : 0 };
  }
  const months = monthsInQuery(text, fallbackYear || parseYmd(maxYmd).getFullYear());
  if (months.length) {
    const w = monthWindow(all, field, months[0].year, months[0].month);
    return { ...w };
  }
  const a = ymd(addDays(parseYmd(maxYmd), -(defaultDays - 1)));
  const start = a < minYmd ? minYmd : a;
  return mk(start, maxYmd, `the last ${defaultDays} days (${prettyYmd(start)} – ${prettyYmd(maxYmd)})`, 'default');
}

/** Two months to compare, in the order the question names them; falls back to the latest two months in the data. */
export function comparisonMonths(q, rows, field) {
  const maxYmd = latestDate(rows, field);
  const fallbackYear = maxYmd ? parseYmd(maxYmd).getFullYear() : new Date().getFullYear();
  const named = monthsInQuery(q, fallbackYear);
  const keys = [...new Set((rows || []).map((r) => monthKeyOf(r?.[field])).filter((k) => /^\d{4}-\d{2}$/.test(k)))].sort();
  const fromKey = (key) => { const [y, m] = key.split('-').map(Number); return monthWindow(rows, field, y, m - 1); };
  if (named.length >= 2) return [monthWindow(rows, field, named[0].year, named[0].month), monthWindow(rows, field, named[1].year, named[1].month)];
  if (named.length === 1) {
    const cur = monthWindow(rows, field, named[0].year, named[0].month);
    const prev = monthWindow(rows, field, named[0].year, named[0].month - 1);
    return [cur, prev];
  }
  if (keys.length >= 2) return [fromKey(keys[keys.length - 1]), fromKey(keys[keys.length - 2])];
  if (keys.length === 1) return [fromKey(keys[0]), null];
  return [null, null];
}

// ---------------------------------------------------------------------------
// platforms
// ---------------------------------------------------------------------------
/** Canonical platform key for any spelling the feeds use. */
export function canonPlatform(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return 'unknown';
  if (s.includes('combined') || s === 'overall' || s === 'all') return 'combined';
  if (s.includes('market') && s.includes('ios')) return 'market_ios';
  if (s.includes('market') && s.includes('android')) return 'market_android';
  if (s.includes('ios')) return 'main_ios';
  if (s.includes('android')) return 'main_android';
  if (s.includes('mweb') || s.includes('wap')) return 'wap';
  if (s.includes('web') || s.includes('desktop')) return 'web';
  return s;
}
export const PLATFORM_LABEL = { main_ios: 'Main iOS', market_ios: 'Market iOS', main_android: 'Main Android', market_android: 'Market Android', wap: 'MWeb', web: 'Web', combined: 'Overall', unknown: 'Unknown' };
export const platformLabel = (name) => PLATFORM_LABEL[canonPlatform(name)] || String(name);

/** Platforms a question asks for, as canonical keys (empty = all). */
export function platformsWanted(q) {
  const t = String(q || '').toLowerCase();
  const out = new Set();
  const has = (re) => re.test(t);
  if (has(/\bmain[\s-]*ios\b/)) out.add('main_ios');
  if (has(/\bmarket[\s-]*ios\b/)) out.add('market_ios');
  if (has(/\bmain[\s-]*android\b/)) out.add('main_android');
  if (has(/\bmarket[\s-]*android\b/)) out.add('market_android');
  if (has(/\bios\b/) && !has(/\b(main|market)[\s-]*ios\b/)) { out.add('main_ios'); out.add('market_ios'); }
  if (has(/\bandroid\b/) && !has(/\b(main|market)[\s-]*android\b/)) { out.add('main_android'); out.add('market_android'); }
  if (has(/\bmweb\b|\bwap\b|\bmobile web\b/)) out.add('wap');
  if (has(/\bweb\b|\bdesktop\b/) && !has(/\bmweb\b|\bmobile web\b/)) out.add('web');
  return [...out];
}

// ---------------------------------------------------------------------------
// generic grouping
// ---------------------------------------------------------------------------
function groupBy(records, keyFn) {
  const map = new Map();
  (records || []).forEach((r) => {
    const k = keyFn(r);
    if (k === null || k === undefined || k === '') return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return map;
}

// ---------------------------------------------------------------------------
// renewals
// ---------------------------------------------------------------------------
export function renewalsAgg(records) {
  let due = 0, renewed = 0;
  (records || []).forEach((r) => { due += parseInt(r.renewal_due, 10) || 0; renewed += parseInt(r.renewed, 10) || 0; });
  return { due, renewed, rate: rate(renewed, due) };
}
export function renewalsBy(records, keyFn) {
  return [...groupBy(records, keyFn)].map(([name, rows]) => ({ name, ...renewalsAgg(rows) })).filter((x) => x.due > 0).sort((a, b) => b.due - a.due);
}
export const renewalsByPlatform = (records) => renewalsBy(records, (r) => platformLabel(r.platform));
export const renewalsByPlan = (records) => renewalsBy(records, (r) => String(r.plan_category || 'UNKNOWN').toUpperCase().replace(/\s+/g, ' ').trim());
export function renewalsByMonth(rows) {
  return [...groupBy(rows, (r) => (isYmd(r.renew_date) ? monthKeyOf(r.renew_date) : null))]
    .map(([key, recs]) => ({ key, label: monthLabelOf(key), short: `${MONTHS_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, ...renewalsAgg(recs) }))
    .filter((m) => m.due > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}
export function renewalsDaily(records) {
  return [...groupBy(records, (r) => String(r.renew_date || '').slice(0, 10))].map(([date, recs]) => ({ date, ...renewalsAgg(recs) })).sort((a, b) => a.date.localeCompare(b.date));
}
/** Calendar weeks of a month: days 1–7, 8–14, 15–21, 22–end. */
export function renewalsByWeek(records, start, end) {
  const s = parseYmd(start), e = parseYmd(end);
  const out = [];
  let i = 0;
  for (let ws = new Date(s); ws <= e; ws = addDays(ws, 7)) {
    i += 1;
    const weLimit = addDays(ws, 6);
    const we = weLimit > e ? e : weLimit;
    if (i === 4 && we < e) { /* fold the trailing days into week 4 */ }
    const a = ymd(ws), b = i === 4 ? end : ymd(we);
    const recs = records.filter((r) => { const v = String(r.renew_date).slice(0, 10); return v >= a && v <= b; });
    out.push({ label: `Week ${i} (${shortYmd(a)} – ${shortYmd(b)})`, start: a, end: b, ...renewalsAgg(recs) });
    if (i === 4) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// funnel
// ---------------------------------------------------------------------------
const fld = (r, ...names) => { for (const n of names) { if (r && r[n] !== undefined && r[n] !== '') return parseFloat(String(r[n]).replace(/,/g, '')) || 0; } return 0; };
export const funnelRow = (r) => ({
  dau: fld(r, 'DAU', 'dau'),
  hits: fld(r, 'paywalling_hits', 'paywall_hits'),
  loads: fld(r, 'Plan_Page_Loaded', 'Plan_Page_Load', 'plan_page_loads'),
  selected: fld(r, 'Plan_Selected', 'plan_selected'),
  initiated: fld(r, 'Pay_Initiated', 'pay_initiated'),
  purchased: fld(r, 'Purchased', 'purchased'),
});
const low = (v) => String(v || '').trim().toLowerCase();
const fCountry = (r) => low(r.Country ?? r.country ?? 'overall') || 'overall';
const fTeam = (r) => low(r.Marketing_team ?? r.marketingTeam ?? 'overall') || 'overall';
const fPlat = (r) => String(r.ET_Platform ?? r.platform ?? '').trim();
const fView = (r) => low(r.viewType ?? r.view_type ?? '');
export const FUNNEL_STEPS = [['dau', 'DAU'], ['hits', 'Paywall Hits'], ['loads', 'Plan Page Loads'], ['selected', 'Plan Selected'], ['initiated', 'Pay Initiated'], ['purchased', 'Purchased']];

export const funnelOverallRows = (rows) => (rows || []).filter((r) => canonPlatform(fPlat(r)) === 'combined' && fCountry(r) === 'overall' && fTeam(r) === 'overall' && (fView(r) === '' || fView(r) === 'overall'));
export const funnelPlatformRows = (rows) => (rows || []).filter((r) => { const p = low(fPlat(r)); return p && !p.includes('combined') && fCountry(r) === 'overall' && fTeam(r) === 'overall'; });
export const funnelTeamRows = (rows) => (rows || []).filter((r) => canonPlatform(fPlat(r)) === 'combined' && fCountry(r) === 'overall' && fTeam(r) !== 'overall' && fTeam(r) !== '');
/** Marketing teams as the funnel feed names them; the query may use the raw tags too. */
const TEAM_MATCHERS = [
  { label: 'Telecalling', query: /tele[\s-]?call|wa[\s_-]?link|whatsapp/, row: /tele[\s-]?call|wa[\s_-]?link/ },
  // the ARPU sheet labels this team "Marketing Campaign"; the ledger's acq_source says "marketing_campaign"
  { label: 'Product Marketing', query: /product[\s-]?marketing|marketing[\s_-]?campaign|clevertap|\bcrm\b|push notif/, row: /product|clevertap|marketing[\s_-]?campaign/ },
  { label: 'Paid Marketing', query: /paid[\s-]?marketing|performance[\s-]?marketing|google[\s_-]?paid|\bpaid\b|\bads?\b/, row: /paid/ },
  { label: 'Organic / unattributed', query: /\borganic\b|unattributed/, row: null },
];
/** Every team a question names, in order of appearance: [{ label, isRow(teamName) }] (isRow null = organic remainder). */
export function teamsWanted(q) {
  const t = String(q || '').toLowerCase();
  const found = [];
  TEAM_MATCHERS.forEach((m) => {
    const idx = t.search(m.query);
    if (idx >= 0) found.push({ idx, label: m.label, isRow: m.row ? (name) => m.row.test(String(name || '').toLowerCase()) : null });
  });
  return found.sort((a, b) => a.idx - b.idx).map(({ idx, ...rest }) => rest);
}
/** The (single) team a question asks about, or null. */
export function teamWanted(q) {
  return teamsWanted(q)[0] || null;
}
/** Does any of the named teams claim this row's team name? */
export const rowInTeams = (teams, name) => teams.some((tm) => tm.isRow && tm.isRow(name));
export const teamLabelOf = (name) => { const n = String(name || '').toLowerCase(); const m = TEAM_MATCHERS.find((x) => x.row && x.row.test(n)); return m ? m.label : String(name).trim(); };
/** Combined-platform rows of one team (site-wide DAU / hits repeat on these rows; use the steps from plan page loads). */
export const funnelTeamRowsFor = (rows, team) => (rows || []).filter((r) => canonPlatform(fPlat(r)) === 'combined' && fCountry(r) === 'overall' && fTeam(r) !== 'overall' && team.isRow(fTeam(r)));
/** Per-platform rows of one team. */
export const funnelTeamPlatformRows = (rows, team) => (rows || []).filter((r) => { const p = low(fPlat(r)); return p && !p.includes('combined') && fCountry(r) === 'overall' && fTeam(r) !== 'overall' && team.isRow(fTeam(r)); });

export const funnelDates = (rows) => [...new Set((rows || []).map((r) => String(r.dateStr || '').slice(0, 10)).filter(isYmd))].sort();
export const lastN = (arr, n) => (n > 0 ? arr.slice(Math.max(0, arr.length - n)) : arr);

export function funnelDaily(rows, dates) {
  const set = new Set(dates);
  const map = new Map();
  (rows || []).forEach((r) => {
    const d = String(r.dateStr || '').slice(0, 10);
    if (!set.has(d)) return;
    const f = funnelRow(r);
    const cur = map.get(d) || { date: d, dau: 0, hits: 0, loads: 0, selected: 0, initiated: 0, purchased: 0 };
    FUNNEL_STEPS.forEach(([k]) => { cur[k] += f[k]; });
    map.set(d, cur);
  });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function funnelAverages(daily) {
  const n = daily.length;
  const avg = { days: n, dau: 0, hits: 0, loads: 0, selected: 0, initiated: 0, purchased: 0 };
  if (!n) return { ...avg, rates: {} };
  daily.forEach((d) => FUNNEL_STEPS.forEach(([k]) => { avg[k] += d[k]; }));
  FUNNEL_STEPS.forEach(([k]) => { avg[k] = Math.round(avg[k] / n); });
  avg.rates = {
    hitsPctDau: rate(avg.hits, avg.dau), loadsPctHits: rate(avg.loads, avg.hits), selectedPctLoads: rate(avg.selected, avg.loads),
    initiatedPctSelected: rate(avg.initiated, avg.selected), purchasedPctInitiated: rate(avg.purchased, avg.initiated),
    purchasedPctLoads: rate(avg.purchased, avg.loads), purchasedPctHits: rate(avg.purchased, avg.hits),
  };
  return avg;
}
/** Per-key daily averages over `dates` (key = platform label or team name). */
export function funnelByKey(rows, dates, keyFn) {
  const set = new Set(dates);
  const map = new Map();
  (rows || []).forEach((r) => {
    const d = String(r.dateStr || '').slice(0, 10);
    if (!set.has(d)) return;
    const k = keyFn(r);
    if (!k) return;
    const f = funnelRow(r);
    const cur = map.get(k) || { name: k, dau: 0, hits: 0, loads: 0, selected: 0, initiated: 0, purchased: 0, days: new Set() };
    FUNNEL_STEPS.forEach(([s]) => { cur[s] += f[s]; });
    cur.days.add(d);
    map.set(k, cur);
  });
  return [...map.values()].map((x) => {
    const n = x.days.size || 1;
    const o = { name: x.name, days: n };
    FUNNEL_STEPS.forEach(([s]) => { o[s] = Math.round(x[s] / n); });
    o.loadsToPurchase = rate(o.purchased, o.loads);
    o.hitsToPurchase = rate(o.purchased, o.hits);
    return o;
  }).sort((a, b) => b.purchased - a.purchased);
}

// ---------------------------------------------------------------------------
// subscriptions
// ---------------------------------------------------------------------------
export const FRESH_EXCLUDED = ['auto_renewal', 'manual_renewal'];
const isTrue = (v) => ['true', '1', 'yes', 'y'].includes(String(v || '').trim().toLowerCase());
export const isFreshSale = (r) => !FRESH_EXCLUDED.includes(String(r.user_txn_type || '').trim().toLowerCase());
export const channelOf = (r) => {
  const c = String(r.channel || r.acq_source || '').trim();
  return c ? c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : 'Others';
};
/** The marketing team of a ledger row: the `channel` column carries it (Others / Product Marketing / Telecalling / Paid Marketing). */
export const ledgerTeamOf = (r) => teamLabelOf(channelOf(r));
/** Does a ledger row belong to this team (matched on channel, then acquisition source)? */
export const ledgerRowInTeam = (r, team) => team.isRow(String(r.channel || '')) || team.isRow(String(r.acq_source || ''));
export const planOf = (r) => String(r.plan_category || 'Unknown').toUpperCase().replace(/\s+/g, ' ').trim() || 'UNKNOWN';
export const txnTypeOf = (r) => String(r.user_txn_type || 'unknown').trim().toLowerCase().replace(/_/g, ' ');

export function subAgg(records) {
  let revenue = 0, conversions = 0;
  const dates = new Set();
  (records || []).forEach((r) => { revenue += Number(r.revenue) || 0; conversions += parseInt(r.conversions, 10) || 0; if (r.dateStr) dates.add(String(r.dateStr).slice(0, 10)); });
  const days = dates.size;
  return { revenue, conversions, days, arpu: conversions > 0 ? revenue / conversions : 0, dailyRevenue: days ? revenue / days : 0, dailyConversions: days ? conversions / days : 0 };
}
export function subBy(records, keyFn) {
  const total = subAgg(records);
  return [...groupBy(records, keyFn)].map(([name, rows]) => { const a = subAgg(rows); return { name, ...a, share: rate(a.revenue, total.revenue), convShare: rate(a.conversions, total.conversions) }; })
    .filter((x) => x.revenue > 0 || x.conversions > 0).sort((a, b) => b.revenue - a.revenue);
}
export const subByPlatform = (records) => subBy(records, (r) => platformLabel(r.platform));
export const subByPlan = (records) => subBy(records, planOf);
export const subByChannel = (records) => subBy(records, channelOf);
export const subByTxnType = (records) => subBy(records, txnTypeOf);
export function subDaily(records) {
  return [...groupBy(records, (r) => String(r.dateStr || '').slice(0, 10))].map(([date, rows]) => { const a = subAgg(rows); return { date, revenue: a.revenue, conversions: a.conversions }; }).sort((a, b) => a.date.localeCompare(b.date));
}
/** Recurring adoption on fresh sales only (auto & manual renewals excluded), grouped by keyFn. */
export function recurringShareBy(records, keyFn) {
  const fresh = (records || []).filter(isFreshSale);
  const rows = [...groupBy(fresh, keyFn)].map(([name, rs]) => {
    let sold = 0, recurring = 0, recRevenue = 0;
    rs.forEach((r) => { const c = parseInt(r.conversions, 10) || 0; sold += c; if (isTrue(r.auto_renew)) { recurring += c; recRevenue += Number(r.revenue) || 0; } });
    return { name, sold, recurring, recRevenue, share: rate(recurring, sold) };
  }).filter((x) => x.sold > 0).sort((a, b) => b.recurring - a.recurring);
  const totals = rows.reduce((t, x) => ({ sold: t.sold + x.sold, recurring: t.recurring + x.recurring, recRevenue: t.recRevenue + x.recRevenue }), { sold: 0, recurring: 0, recRevenue: 0 });
  return { rows, totals: { ...totals, share: rate(totals.recurring, totals.sold) } };
}
export const filterPlatforms = (records, wanted) => (wanted && wanted.length ? (records || []).filter((r) => wanted.includes(canonPlatform(r.platform))) : records || []);

// ---------------------------------------------------------------------------
// realtime (raw sheet rows)
// ---------------------------------------------------------------------------
/**
 * Realtime pacing from the raw feed. Scope by platform (canonical key or null
 * for Combined), marketing team (matcher from teamWanted, or null) and event
 * (purchase by default). Benchmark: 'sameWeekday' = the other dates in the
 * feed that fall on today's weekday (the 4-week same-day view); 'last7' = the
 * seven most recent other dates.
 */
export function realtimeSummary(realtimeData, { platform = null, team = null, event = 'purchase', benchmark = 'sameWeekday' } = {}) {
  const rows = Array.isArray(realtimeData) ? realtimeData : [];
  const platOf = (r) => String(r.ET_Platform ?? r.platform ?? '').trim();
  const teamOf = (r) => String(r['Marketing Team'] ?? r.Marketing_Team ?? r.marketing_team ?? r.Item_category ?? r.team ?? '').trim();
  const dateOf = (r) => String(r.event_date ?? r.dateStr ?? r.date ?? '').trim();
  const hourOf = (r) => parseInt(r.event_hour ?? r.hour ?? 0, 10) || 0;
  const cnt = (r) => parseInt(r.event_count ?? r.count ?? 0, 10) || 0;
  const evOf = (r) => low(r.event_name ?? r.event);
  const isTeamOverall = (v) => { const x = low(v); return !x || x === 'combined' || x === 'overall' || x === 'all'; };
  const wantEvent = (r) => {
    const e = evOf(r);
    if (event === 'purchase') return e.includes('purchase');
    if (event === 'loads') return e.includes('page') && e.includes('load');
    if (event === 'initiated') return e.includes('init');
    if (event === 'selected') return e.includes('select');
    return e.includes(event);
  };
  const scoped = rows.filter((r) => {
    const pk = canonPlatform(platOf(r));
    if (platform ? pk !== platform : pk !== 'combined') return false;
    if (team) return !isTeamOverall(teamOf(r)) && team.isRow && team.isRow(teamOf(r));
    return isTeamOverall(teamOf(r));
  });
  const dates = [...new Set(scoped.map(dateOf).filter(Boolean))].sort((a, b) => new Date(a) - new Date(b));
  if (!dates.length) return null;
  const today = dates[dates.length - 1];
  const byDate = {};
  scoped.filter(wantEvent).forEach((r) => {
    const dd = dateOf(r); const h = hourOf(r);
    if (!byDate[dd]) byDate[dd] = { total: 0, hours: {} };
    byDate[dd].total += cnt(r); byDate[dd].hours[h] = (byDate[dd].hours[h] || 0) + cnt(r);
  });
  const t = byDate[today] || { total: 0, hours: {} };
  const currentHour = Math.max(-1, ...Object.keys(t.hours).map(Number));
  const uptoHour = (dd) => Object.entries((byDate[dd] || { hours: {} }).hours).reduce((s2, [h, c]) => (Number(h) <= currentHour ? s2 + c : s2), 0);
  const others = dates.filter((dd) => dd !== today && byDate[dd]);
  const todayDow = new Date(today).getDay();
  let past = benchmark === 'last7' ? others.slice(-7) : others.filter((dd) => new Date(dd).getDay() === todayDow);
  if (!past.length) past = others;
  const benchToHour = past.length ? past.reduce((s2, dd) => s2 + uptoHour(dd), 0) / past.length : 0;
  const benchFull = past.length ? past.reduce((s2, dd) => s2 + byDate[dd].total, 0) / past.length : 0;
  const projected = benchToHour > 0 && benchFull > 0 ? Math.round((t.total / benchToHour) * benchFull) : (currentHour >= 0 ? Math.round(t.total * (24 / (currentHour + 1))) : t.total);
  const hourly = [];
  for (let h = 0; h <= Math.max(currentHour, 0); h++) hourly.push({ hour: h, today: t.hours[h] || 0, bench: past.length ? past.reduce((s2, dd) => s2 + (byDate[dd].hours[h] || 0), 0) / past.length : 0 });
  const benchLabel = benchmark === 'last7' ? 'last 7 days' : '4-week same weekday';
  return { today, currentHour, todayPurchases: t.total, benchToHour, benchFull, benchDays: past.length, benchLabel, projected, pacingPct: benchToHour > 0 ? (t.total / benchToHour - 1) * 100 : null, hourly };
}
/** Today's totals per event for the scoped rows (purchases, plan page loads, pay initiated). */
export function realtimeEventsToday(realtimeData, opts = {}) {
  const out = {};
  ['purchase', 'loads', 'initiated', 'selected'].forEach((ev) => { const s2 = realtimeSummary(realtimeData, { ...opts, event: ev }); out[ev] = s2 ? s2.todayPurchases : 0; });
  return out;
}

// ---------------------------------------------------------------------------
// overview of everything loaded
// ---------------------------------------------------------------------------
export function overviewStats(ctx = {}) {
  const sub = ctx.subscriptionData || [];
  const ren = ctx.renewalsData || [];
  const fun = ctx.funnelData || [];
  const out = { sub: null, ren: null, fun: null };
  if (sub.length) {
    const all = subAgg(sub);
    const w = resolveWindow('last 30 days', sub, 'dateStr');
    const w30 = subAgg(w.records);
    const plats = subByPlatform(w.records);
    out.sub = { rows: sub.length, from: earliestDate(sub, 'dateStr'), to: latestDate(sub, 'dateStr'), all, w30, topPlatform: plats[0] || null, platforms: plats, window: w };
  }
  if (ren.length) {
    const months = renewalsByMonth(ren);
    out.ren = { months, from: earliestDate(ren, 'renew_date'), to: latestDate(ren, 'renew_date'), agg: renewalsAgg(ren), best: months.length ? months.reduce((a, b) => (b.rate > a.rate ? b : a)) : null, worst: months.length ? months.reduce((a, b) => (b.rate < a.rate ? b : a)) : null };
  }
  if (fun.length) {
    const ov = funnelOverallRows(fun);
    const dates = lastN(funnelDates(ov), 30);
    out.fun = { from: dates[0], to: dates[dates.length - 1], avg: funnelAverages(funnelDaily(ov, dates)) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// funnel geography (Country column: Overall / India; International = Overall − India)
// ---------------------------------------------------------------------------
export function geoWanted(q) {
  const t = String(q || '').toLowerCase();
  if (/\bindia\b|\bindian\b|domestic/.test(t)) return 'india';
  if (/international|overseas|outside india|non[\s-]?india|foreign|\brow\b|rest of (the )?world|global/.test(t)) return 'international';
  return null;
}
export const funnelCountryRows = (rows, country = 'india') => (rows || []).filter((r) => canonPlatform(fPlat(r)) === 'combined' && fTeam(r) === 'overall' && fCountry(r) === country);
export const funnelCountryPlatformRows = (rows, country = 'india') => (rows || []).filter((r) => { const p = low(fPlat(r)); return p && !p.includes('combined') && fTeam(r) === 'overall' && fCountry(r) === country; });

// ---------------------------------------------------------------------------
// subscription scopes
// ---------------------------------------------------------------------------
export function txnTypesWanted(q) {
  const t = String(q || '').toLowerCase();
  const out = [];
  if (/\bnew (users?|subscri|sales|customers?|acquisitions?)|\bfresh\b|first[\s-]?time/.test(t)) out.push('new');
  if (/\bexpired\b|win[\s-]?back|lapsed/.test(t)) out.push('expired');
  if (/\bupgrade/.test(t)) out.push('upgrade');
  if (/auto[\s-]?renewal(s)?\b/.test(t) && !/exclud|without|excl\b/.test(t)) out.push('auto_renewal');
  if (/manual[\s-]?renewal/.test(t)) out.push('manual_renewal');
  return out;
}
export const countryOf = (r) => { const c = String(r.country_name || '').trim(); return c ? c.replace(/\b\w/g, (m) => m.toUpperCase()) : 'Unknown'; };
export const subSourceOf = (r) => { const c = String(r.acq_sub_source || '').trim(); return c ? c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : 'Others'; };
export const hourOfTxn = (r) => { const m = String(r.transaction_time || '').match(/(\d{1,2})[:.]/); return m ? Math.min(23, parseInt(m[1], 10)) : null; };
export const subByHour = (records) => {
  const map = new Map();
  (records || []).forEach((r) => { const h = hourOfTxn(r); if (h === null) return; const cur = map.get(h) || { hour: h, revenue: 0, conversions: 0 }; cur.revenue += Number(r.revenue) || 0; cur.conversions += parseInt(r.conversions, 10) || 0; map.set(h, cur); });
  return [...map.values()].sort((a, b) => a.hour - b.hour);
};
export const filterTxnTypes = (records, types) => (types && types.length ? (records || []).filter((r) => types.includes(String(r.user_txn_type || '').trim().toLowerCase())) : records || []);
export const filterCountry = (records, geo) => {
  if (!geo) return records || [];
  const isIndia = (r) => /india/.test(String(r.country_name || '').toLowerCase());
  return (records || []).filter((r) => (geo === 'india' ? isIndia(r) : !isIndia(r)));
};
export function plansWanted(q) {
  const t = String(q || '').toLowerCase();
  const out = [];
  const re = /\b(\d{1,4})\s*[- ]?(year|yr|month|mo|day)s?\b/g;
  let m;
  while ((m = re.exec(t))) {
    const unit = m[2].startsWith('y') ? 'YEAR' : m[2].startsWith('m') ? 'MONTH' : 'DAY';
    // "last 7 days" / "30 days" are windows, not plans; day-denominated plans are long (397 DAY, 1195 DAY)
    if (unit === 'DAY' && parseInt(m[1], 10) < 100) continue;
    const key = `${parseInt(m[1], 10)} ${unit}`;
    if (!out.includes(key)) out.push(key);
  }
  if (/\bannual\b/.test(t) && !out.includes('1 YEAR')) out.push('1 YEAR');
  return out;
}
export const planKeyOf = (r) => String(r.plan_category || '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/S$/, '');
export const filterPlans = (records, plans) => (plans && plans.length ? (records || []).filter((r) => plans.includes(planKeyOf(r))) : records || []);

/** Two windows to compare for the ledger: months named, "this week vs last week", "last N days vs previous N days", "this month vs last month". */
export function comparisonWindows(q, rows, field) {
  const t = String(q || '').toLowerCase();
  const maxYmd = latestDate(rows, field);
  if (!maxYmd) return [null, null];
  const between = (a, b, label) => ({ records: (rows || []).filter((r) => { const v = String(r[field]).slice(0, 10); return v >= a && v <= b; }), start: a, end: b, label });
  const rollingPair = (n) => {
    const endA = parseYmd(maxYmd); const startA = addDays(endA, -(n - 1)); const endB = addDays(startA, -1); const startB = addDays(endB, -(n - 1));
    return [between(ymd(startA), ymd(endA), `the last ${n} days (${prettyYmd(ymd(startA))} – ${prettyYmd(ymd(endA))})`), between(ymd(startB), ymd(endB), `the previous ${n} days (${prettyYmd(ymd(startB))} – ${prettyYmd(ymd(endB))})`)];
  };
  const n = t.match(/(?:last|past)\s+(\d{1,3})\s*days?\s*(?:vs|versus|against|compared? (?:to|with))/) || t.match(/(\d{1,3})\s*days?\s*(?:vs|versus)\s*(?:the\s+)?(?:previous|prior|last)/);
  if (n) return rollingPair(parseInt(n[1], 10));
  if (/this week|last week|past week|week on week|\bwow\b|weekly/.test(t)) return rollingPair(7);
  const now = new Date();
  if (/this month|last month|month on month|\bmom\b|mtd/.test(t) && !monthsInQuery(t).length) {
    const cur = monthWindow(rows, field, now.getFullYear(), now.getMonth());
    const prev = monthWindow(rows, field, now.getFullYear(), now.getMonth() - 1);
    // same number of elapsed days in the previous month, so the comparison is like for like
    const elapsed = cur.records.length ? Math.round((parseYmd(latestDate(cur.records, field)) - parseYmd(cur.start)) / 86400000) + 1 : 0;
    const prevEnd = elapsed ? ymd(addDays(parseYmd(prev.start), elapsed - 1)) : prev.end;
    return [{ ...cur, label: `${cur.label} (month to date)` }, { ...between(prev.start, prevEnd, `${prev.label} (first ${elapsed} days)`), kind: 'month' }];
  }
  const [a, b] = comparisonMonths(q, rows, field);
  return [a, b];
}

// ---------------------------------------------------------------------------
// ARPU sheet (txn_date, platform, plan_category, user_txn_type, marketing_team, conversion, revenue, Offer, Theme, Sale status)
// ---------------------------------------------------------------------------
export const arpuTeamOf = (r) => { const v = String(r.marketing_team || '').trim(); return v ? teamLabelOf(v) === v ? v.replace(/\b\w/g, (m) => m.toUpperCase()) : teamLabelOf(v) : 'Others'; };
export const arpuThemeOf = (r) => String(r.theme || 'Regular').trim() || 'Regular';
export const arpuOfferOf = (r) => String(r.offer || 'Standard').trim() || 'Standard';
export const arpuStatusOf = (r) => String(r.sale_status || 'Active').trim() || 'Active';
/** ARPU is measured on non-auto-renewal transactions unless the caller says otherwise. */
export const arpuBase = (records, includeAuto = false) => (includeAuto ? records || [] : (records || []).filter((r) => String(r.user_txn_type || '').trim().toLowerCase() !== 'auto_renewal'));
export const arpuBy = (records, keyFn) => subBy(records, keyFn).sort((a, b) => b.arpu - a.arpu);
