/**
 * MISReports.jsx
 * The "MIS" tab: renders the two daily-mailed MIS reports as native themed
 * tables, toggled between "ET Prime MIS" and "PM Performance Report".
 *
 * Data comes from IMPORTRANGE mirror tabs inside the public dashboard data
 * sheet (the source MIS sheets stay restricted). Parsed with header:false so
 * the sheet's own layout (header rows, section rows, label columns) survives.
 *
 * Both reports get the "guided ledger" treatment (report.enhanced):
 * Daily / Rolling / Monthly column groups, a day-over-day delta beside the two
 * daily columns, collapsible sections and heat
 * shading on share (%) rows. Column roles are detected from the header text,
 * so the sheet can add or drop months without code changes.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchDatasetCached, refreshDataset, DATASET_URLS } from '../services/dataPreloader';
import { FileSpreadsheet, RefreshCw, Loader2, ExternalLink, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';

const REPORTS = [
  {
    id: 'misEtPrime',
    name: 'ET Prime MIS',
    // Header = the sheet row containing "Row Labels"; everything above is a
    // redundant short-month strip that doesn't align with the data columns.
    findHeaderRow: rows => rows.findIndex(r => r.some(c => String(c).trim() === 'Row Labels')),
    labelColCount: 1,
    labelHeader: 'Metrics',
    labelAlign: 'left',
    compactNumbers: true,
    enhanced: true,
    sourceUrl: 'https://docs.google.com/spreadsheets/d/1bgpxJ0FaG6Qyc5qcek9Xd7ez_Q5ickGVMnbYBG1K-RA/edit',
  },
  {
    id: 'misPm',
    name: 'PM Performance Report',
    findHeaderRow: () => 0,
    labelColCount: 2,
    labelAlign: 'center',
    compactNumbers: false,
    enhanced: true,
    sourceUrl: 'https://docs.google.com/spreadsheets/d/1fc1zuxM0_G3WUH1UCkOhdtMwvcMOxou7MYXLXlPku3M/edit?gid=1094052471',
  },
];

const MONTH_ABBR = { january: 'Jan', february: 'Feb', march: 'Mar', april: 'Apr', may: 'May', june: 'Jun', july: 'Jul', august: 'Aug', september: 'Sep', october: 'Oct', november: 'Nov', december: 'Dec' };
const MONTH_LIST = Object.values(MONTH_ABBR);

/** "September" / "Sep" / "Sept" -> 0-based month index, or -1 */
function monthIndex(word) {
  const w = String(word).toLowerCase();
  if (w.length < 3) return -1;
  const full = Object.keys(MONTH_ABBR).find(k => k.startsWith(w));
  return full ? Object.keys(MONTH_ABBR).indexOf(full) : -1;
}

const MONTH_RE = /^([A-Za-z]+)[- ](\d{2}|\d{4})$/;
const DAY_RE = /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/;

/** "September-26" / "Sep-2026" -> { label: "Sep-26", key: 2026*12+8, isCurrent } or null */
function parseMonthHeader(h) {
  const m = String(h).trim().match(MONTH_RE);
  if (!m) return null;
  const mi = monthIndex(m[1]);
  if (mi < 0) return null;
  const yr = m[2].length === 4 ? Number(m[2]) : 2000 + Number(m[2]);
  const now = new Date();
  const isCurrent = now.getMonth() === mi && now.getFullYear() === yr;
  return { label: `${MONTH_LIST[mi]}-${String(yr).slice(2)}`, key: yr * 12 + mi, isCurrent };
}

/** "September-26" / "Sep-2026" -> "Sep-26"; the current month gets "(MTD)". */
function compactHeader(h) {
  const m = parseMonthHeader(h);
  return m ? `${m.label}${m.isCurrent ? ' (MTD)' : ''}` : h;
}

/** "14-Sep-2026" -> "14 Sep" */
function compactDay(h) {
  const m = String(h).trim().match(DAY_RE);
  return m ? `${Number(m[1])} ${m[2].slice(0, 3)}` : h;
}

/** Plain integers >= 1000 -> 10.2K / 1.2M; %, decimals and text pass through. */
function compactNumber(c) {
  const raw = c.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return c;
  const n = Number(raw);
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return c;
}

/** "1,023" / "10.2K" / "1.2M" / "91%" -> number, else null */
function parseNum(c) {
  const s = String(c ?? '').replace(/,/g, '').trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(%|K|M)?$/i);
  if (!m) return null;
  let n = Number(m[1]);
  const u = (m[2] || '').toUpperCase();
  if (u === 'K') n *= 1e3;
  else if (u === 'M') n *= 1e6;
  return n;
}

const LABEL_COL_WIDTH = 190; // px — fixed so a second sticky label column can offset against it

function parseGrid(rawRows, report) {
  const rows = (rawRows || []).map(r => (Array.isArray(r) ? r.map(c => String(c ?? '').trim()) : []));
  const headerIdx = Math.max(report.findHeaderRow(rows), 0);
  const body = rows.slice(headerIdx).filter(r => r.some(c => c !== ''));
  if (body.length === 0) return { header: [], rows: [], keepCols: [] };

  // Drop columns that are empty across every row (importrange padding, spacers)
  const colCount = Math.max(...body.map(r => r.length));
  const keepCols = [];
  for (let c = 0; c < colCount; c++) {
    if (body.some(r => (r[c] || '') !== '')) keepCols.push(c);
  }
  const pick = r => keepCols.map(c => r[c] || '');
  const header = pick(body[0]);
  if (report.labelHeader) header[0] = report.labelHeader;
  return { header, rows: body.slice(1).map(pick), keepCols };
}

/**
 * Classifies every value column by its header text so the enhanced table can
 * group them. Order in the output = display order:
 *   daily (sheet order) → Δ DoD (virtual, when ≥2 daily) → rolling → month
 *   (sheet order) → other
 */
function classifyColumns(header, labelColCount) {
  const cols = header.slice(labelColCount).map((h, i) => {
    const idx = i + labelColCount;
    const t = String(h).trim();
    if (DAY_RE.test(t)) return { idx, role: 'daily', label: compactDay(t) };
    if (/last\s*7/i.test(t)) return { idx, role: 'rolling', label: 'Last 7 days' };
    const m = parseMonthHeader(t);
    if (m) return { idx, role: 'month', label: m.label, key: m.key, isCurrent: m.isCurrent };
    return { idx, role: 'other', label: t };
  });
  const by = role => cols.filter(c => c.role === role);
  const daily = by('daily'), rolling = by('rolling'), months = by('month'), other = by('other');
  const ordered = [...daily];
  if (daily.length >= 2) ordered.push({ role: 'delta', label: 'Δ DoD', a: daily[0].idx, b: daily[1].idx });
  ordered.push(...rolling, ...months, ...other);
  return { ordered, counts: { daily: daily.length + (daily.length >= 2 ? 1 : 0), rolling: rolling.length, month: months.length + other.length }, monthIdx: months.map(c => c.idx) };
}

/** Caps every number in a cell at one decimal place: 80.14% -> 80.1%, 3.5991 -> 3.6 */
const capDecimals = (s) => s.replace(/-?\d+\.\d{2,}/g, (num) => Number(num).toFixed(1));

// Sheet error values (#DIV/0!, #N/A, #REF!, …) render as an em-dash
const cleanCell = (c) => (/^#[A-Z0-9/]+[!?]?$/.test(c) ? '—' : c);

const isPctCell = (c) => /%\s*$/.test(String(c));

function Caret({ up }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
      {up ? <path d="M4 1 L7.5 7 L0.5 7 Z" fill="currentColor" /> : <path d="M4 7 L7.5 1 L0.5 1 Z" fill="currentColor" />}
    </svg>
  );
}

/** Day-over-day change: % change for counts, percentage points for share rows. */
function DeltaCell({ cur, prev, pctRow }) {
  const a = parseNum(cur), b = parseNum(prev);
  if (a == null || b == null || (!pctRow && b === 0)) {
    return <span className="text-warm-muted dark:text-dark-muted">—</span>;
  }
  const d = pctRow ? a - b : ((a - b) / b) * 100;
  const flat = Math.abs(d) < 0.05;
  const cls = flat
    ? 'text-warm-muted dark:text-dark-muted'
    : d > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400';
  return (
    <span className={`inline-flex items-center gap-1 font-bold tabular-nums ${cls}`} title={pctRow ? 'Change in percentage points vs previous day' : 'Change vs previous day'}>
      {!flat && <Caret up={d > 0} />}
      {flat ? '' : d > 0 ? '+' : '−'}{Math.abs(d).toFixed(1)}{pctRow ? ' pt' : '%'}
    </span>
  );
}

/** Rows split into sections (a headless leading group is allowed). */
function groupRows(rows, labelColCount) {
  const groups = [];
  let cur = { title: null, rows: [], key: 'g0' };
  rows.forEach((r, ri) => {
    const labelCells = r.slice(0, labelColCount);
    const valueCells = r.slice(labelColCount);
    const isSection = labelCells.some(c => c !== '') && valueCells.every(c => c === '');
    if (isSection) {
      if (cur.title !== null || cur.rows.length) groups.push(cur);
      cur = { title: labelCells.find(c => c !== ''), rows: [], key: `g${ri}` };
    } else {
      cur.rows.push(r);
    }
  });
  if (cur.title !== null || cur.rows.length) groups.push(cur);
  return groups;
}

// Faint tint over the sticky (opaque) header cells of the Daily block. A plain
// alpha background would let scrolled rows show through a sticky cell, so the
// tint rides as a background-image layer on top of the opaque colour.
const DAILY_TINT_LAYER = { backgroundImage: 'linear-gradient(rgb(var(--accent-500) / 0.08), rgb(var(--accent-500) / 0.08))' };

function MISTable({ grid, report, collapsed, onToggle }) {
  const { header, rows } = grid;
  const { labelColCount, compactNumbers, enhanced, labelAlign = 'left' } = report;
  const labelAlignCls = labelAlign === 'center' ? 'text-center' : 'text-left';
  if (!header.length) return null;

  const cols = useMemo(() => classifyColumns(header, labelColCount), [header, labelColCount]);
  const groups = useMemo(() => groupRows(rows, labelColCount), [rows, labelColCount]);
  const totalCols = labelColCount + (enhanced ? cols.ordered.length : header.length - labelColCount);

  // Sticky offsets: z-order matters — the top-left corner must outrank both
  // the sticky header row and the sticky label column, or it gets painted
  // over while scrolling (the "first column header scrolled away" bug).
  const rowRule = 'border-b border-warm-border/40 dark:border-dark-border/40';
  const labelBase = `sticky bg-white dark:bg-dark-card px-3 text-warm-text dark:text-dark-text border-r border-warm-border/60 dark:border-dark-border/60 ${rowRule}`;
  const labelStyle = (col, span = 1) => ({
    left: col === 0 ? 0 : LABEL_COL_WIDTH,
    zIndex: 5,
    minWidth: LABEL_COL_WIDTH * span,
    maxWidth: (LABEL_COL_WIDTH + 70) * span,
  });

  const fmtValue = (c) => {
    const v = capDecimals(cleanCell(c));
    return compactNumbers ? compactNumber(v) : v;
  };

  const thBase = 'px-3 py-2.5 text-center text-[10.5px] font-bold text-warm-muted dark:text-dark-muted bg-warm-bg dark:bg-slate-800 border-b border-warm-border dark:border-dark-border';
  const groupTh = 'py-1 text-center text-[9.5px] font-black uppercase tracking-wider text-warm-muted dark:text-dark-muted bg-warm-bg dark:bg-slate-800 border-b border-warm-border dark:border-dark-border';

  // ---- header rows ----
  const labelHeaderCells = header.slice(0, labelColCount).map((h, ci) => (
    <th
      key={`lh${ci}`}
      rowSpan={enhanced ? 2 : 1}
      className={`${thBase} border-r`}
      style={{ position: 'sticky', left: ci === 0 ? 0 : LABEL_COL_WIDTH, zIndex: 30, minWidth: LABEL_COL_WIDTH, maxWidth: LABEL_COL_WIDTH + 70, textAlign: labelAlign }}
    >
      {h}
    </th>
  ));

  const groupRow = enhanced && (
    <tr>
      {labelHeaderCells}
      {cols.counts.daily > 0 && (
        <th colSpan={cols.counts.daily} className={`${groupTh} text-amber-700 dark:text-amber-300`} style={DAILY_TINT_LAYER}>Daily</th>
      )}
      {cols.counts.rolling > 0 && (
        <th colSpan={cols.counts.rolling} className={`${groupTh} border-l border-r`}>Rolling</th>
      )}
      {cols.counts.month > 0 && (
        <th colSpan={cols.counts.month} className={groupTh}>Monthly</th>
      )}
    </tr>
  );

  const valueHeaderCells = enhanced
    ? cols.ordered.map((c, i) => {
        const isDaily = c.role === 'daily' || c.role === 'delta';
        const edge = c.role === 'rolling' ? 'border-l border-r' : '';
        return (
          <th
            key={`vh${i}`}
            className={`${thBase} whitespace-nowrap ${edge} ${c.isCurrent ? 'text-amber-700 dark:text-amber-300' : ''}`}
            style={isDaily ? DAILY_TINT_LAYER : undefined}
          >
            {c.label}
            {c.isCurrent && <div className="text-[9px] font-bold text-amber-accent leading-none mt-0.5">MTD</div>}
          </th>
        );
      })
    : header.slice(labelColCount).map((h, i) => (
        <th key={`vh${i}`} className={`${thBase} whitespace-nowrap`}>
          {compactHeader(h)}
        </th>
      ));

  // ---- body ----
  const renderSection = (g) => {
    const isCollapsed = collapsed.has(g.key);
    return (
      // ONE cell across the whole table: the title sits in a sticky, fit-content
      // box so long headings flow over the value columns on a single line
      // instead of wrapping inside the label column and fattening the row.
      <tr key={g.key}>
        <td colSpan={totalCols} className="p-0 bg-amber-100 dark:bg-[#2b2416] border-y border-amber-500/20">
          <div className="sticky left-0 w-fit max-w-full flex items-center gap-2.5 px-3 py-2 whitespace-nowrap">
            {enhanced && (
              <button
                type="button"
                onClick={() => onToggle(g.key)}
                aria-expanded={!isCollapsed}
                className="inline-flex items-center justify-center h-[18px] w-[18px] rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 cursor-pointer shrink-0"
                title={isCollapsed ? 'Expand section' : 'Collapse section'}
              >
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
            <span className="font-black text-[10.5px] uppercase tracking-wider text-amber-700 dark:text-amber-300">{g.title}</span>
          </div>
        </td>
      </tr>
    );
  };

  const renderRow = (r, ri) => {
    const labelCells = r.slice(0, labelColCount);
    const valueCells = r.slice(labelColCount);
    // Google Sheets horizontal merge: label spans both label columns
    // (value lands in the first cell, second comes through empty)
    const isMergedLabel = labelColCount > 1 && labelCells[0] !== '' && labelCells[1] === '';

    const labelTds = isMergedLabel ? (
      <td colSpan={labelColCount} className={`${labelBase} py-2 font-bold whitespace-normal ${labelAlignCls}`} style={labelStyle(0, labelColCount)}>
        {labelCells[0]}
      </td>
    ) : (
      labelCells.map((c, ci) => (
        <td key={ci} className={`${labelBase} py-2 whitespace-normal ${labelAlignCls} ${ci === 0 && labelColCount > 1 ? 'font-bold' : labelColCount === 1 ? 'font-semibold' : 'font-medium text-warm-muted dark:text-dark-muted'}`} style={labelStyle(ci)}>
          {c}
        </td>
      ))
    );

    if (!enhanced) {
      return (
        <tr key={ri} className="hover:bg-amber-500/5">
          {labelTds}
          {valueCells.map((c, ci) => (
            <td key={ci} className={`px-3 py-2 text-center whitespace-nowrap text-warm-text dark:text-dark-text tabular-nums ${rowRule}`}>
              {fmtValue(c)}
            </td>
          ))}
        </tr>
      );
    }

    // Share rows: label starts with % or the value cells are mostly percentages
    const pctRow = /^\s*%/.test(labelCells[0] || '') || valueCells.filter(isPctCell).length > valueCells.length / 2;
    // Heat shading over the month columns, damped when the row barely moves
    // (a 1-point spread should not read as a swing)
    let shade = () => null;
    if (pctRow) {
      const vals = cols.monthIdx.map(i => parseNum(r[i])).filter(v => v != null);
      if (vals.length >= 2) {
        const min = Math.min(...vals), max = Math.max(...vals);
        const spread = Math.min(1, (max - min) / 10);
        shade = (v) => {
          const n = parseNum(v);
          if (n == null || max === min) return null;
          const a = (0.05 + 0.3 * ((n - min) / (max - min))) * spread;
          return a < 0.03 ? null : { backgroundColor: `rgb(var(--accent-500) / ${a.toFixed(2)})` };
        };
      }
    }

    return (
      <tr key={ri} className="hover:bg-amber-500/5">
        {labelTds}
        {cols.ordered.map((c, ci) => {
          const base = `px-3 py-2 text-center whitespace-nowrap text-warm-text dark:text-dark-text tabular-nums ${rowRule}`;
          switch (c.role) {
            case 'daily':
              return <td key={ci} className={`${base} bg-amber-500/[0.05] ${ci === 0 ? 'font-bold' : ''}`}>{fmtValue(r[c.idx])}</td>;
            case 'delta':
              return <td key={ci} className={`${base} bg-amber-500/[0.05]`}><DeltaCell cur={r[c.a]} prev={r[c.b]} pctRow={pctRow} /></td>;
            case 'rolling':
              return <td key={ci} className={`${base} border-l border-r border-warm-border dark:border-dark-border text-warm-label dark:text-dark-label`}>{fmtValue(r[c.idx])}</td>;
            case 'month':
              return <td key={ci} className={`${base} ${c.isCurrent ? 'font-bold' : ''}`} style={shade(r[c.idx])}>{fmtValue(r[c.idx])}</td>;
            default:
              return <td key={ci} className={base}>{fmtValue(r[c.idx])}</td>;
          }
        })}
      </tr>
    );
  };

  return (
    <div className="overflow-auto rounded-xl border border-warm-border dark:border-dark-border shadow-sm bg-white dark:bg-dark-card" style={{ maxHeight: 'calc(100vh - 170px)' }}>
      {/* border-separate + one sticky <thead>: collapsed borders leave 1px gaps
          between sticky cells, and stacking two sticky rows needs a measured
          offset — both let the numbers underneath show through while scrolling. */}
      <table className="border-separate border-spacing-0 text-[11.5px] leading-snug w-full">
        <thead className="sticky top-0 z-20">
          {groupRow}
          <tr>
            {!enhanced && labelHeaderCells}
            {valueHeaderCells}
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <React.Fragment key={g.key}>
              {g.title !== null && renderSection(g)}
              {!(enhanced && collapsed.has(g.key)) && g.rows.map((r, ri) => renderRow(r, `${g.key}-${ri}`))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MISReports({ isDark }) {
  const [active, setActive] = useState(REPORTS[0].id);
  const [datasets, setDatasets] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());

  const loadAll = useCallback(async (force = false) => {
    force ? setRefreshing(true) : setLoading(true);
    try {
      const results = await Promise.all(REPORTS.map(rep =>
        (force
          ? refreshDataset(rep.id, DATASET_URLS[rep.id], { header: false, skipEmptyLines: false })
          : fetchDatasetCached(rep.id, DATASET_URLS[rep.id], { header: false, skipEmptyLines: false })
        ).then(res => [rep.id, res?.data || []])
      ));
      setDatasets(Object.fromEntries(results));
    } catch (err) {
      console.warn('[MIS] load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadAll(false); }, [loadAll]);

  const report = REPORTS.find(r => r.id === active);
  const grid = useMemo(() => parseGrid(datasets[active], report), [datasets, active, report]);
  const sectionKeys = useMemo(
    () => groupRows(grid.rows, report.labelColCount).filter(g => g.title !== null).map(g => g.key),
    [grid.rows, report.labelColCount]
  );
  const allCollapsed = sectionKeys.length > 0 && sectionKeys.every(k => collapsed.has(k));

  const toggleSection = useCallback((key) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(sectionKeys));

  const btnCls = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text cursor-pointer hover:text-amber-accent disabled:opacity-50';

  return (
    <div className="animate-in fade-in duration-300 pt-4 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 p-1 rounded-full bg-black/5 dark:bg-white/5 border border-warm-border dark:border-dark-border w-fit">
          {REPORTS.map(rep => (
            <button
              key={rep.id}
              type="button"
              onClick={() => { setActive(rep.id); setCollapsed(new Set()); }}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                active === rep.id
                  ? 'bg-white dark:bg-slate-700 text-warm-text dark:text-dark-text shadow-sm'
                  : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
              }`}
            >
              {rep.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {report.enhanced && sectionKeys.length > 0 && (
            <button type="button" onClick={toggleAll} className={btnCls}>
              {allCollapsed ? <ChevronsUpDown className="h-3 w-3" /> : <ChevronsDownUp className="h-3 w-3" />}
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
          <a href={report.sourceUrl} target="_blank" rel="noopener noreferrer" className={btnCls}>
            <ExternalLink className="h-3 w-3" /> Source Sheet
          </a>
          <button type="button" onClick={() => loadAll(true)} disabled={refreshing} className={btnCls}>
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} /> Sync
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 gap-2 text-sm font-semibold text-warm-muted dark:text-dark-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading MIS…
        </div>
      ) : grid.header.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-2 text-warm-muted dark:text-dark-muted">
          <FileSpreadsheet className="h-8 w-8" />
          <p className="text-sm font-bold">No data found for {report.name}</p>
          <p className="text-xs">Check that the mirror tab in the dashboard data sheet is populated.</p>
        </div>
      ) : (
        <MISTable grid={grid} report={report} collapsed={collapsed} onToggle={toggleSection} />
      )}
    </div>
  );
}
