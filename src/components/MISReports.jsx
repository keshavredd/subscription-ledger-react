/**
 * MISReports.jsx
 * The "MIS" tab: renders the two daily-mailed MIS reports as native themed
 * tables, toggled between "ET Prime MIS" and "PM Performance Report".
 *
 * Data comes from IMPORTRANGE mirror tabs inside the public dashboard data
 * sheet (the source MIS sheets stay restricted). Parsed with header:false so
 * the sheet's own layout (header rows, section rows, label columns) survives.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchDatasetCached, refreshDataset, DATASET_URLS } from '../services/dataPreloader';
import { FileSpreadsheet, RefreshCw, Loader2, ExternalLink } from 'lucide-react';

const REPORTS = [
  {
    id: 'misEtPrime',
    name: 'ET Prime MIS',
    // Header = the sheet row containing "Row Labels"; everything above is a
    // redundant short-month strip that doesn't align with the data columns.
    findHeaderRow: rows => rows.findIndex(r => r.some(c => String(c).trim() === 'Row Labels')),
    labelColCount: 1,
    labelHeader: 'Metrics',
    compactNumbers: true,
    sourceUrl: 'https://docs.google.com/spreadsheets/d/1bgpxJ0FaG6Qyc5qcek9Xd7ez_Q5ickGVMnbYBG1K-RA/edit',
  },
  {
    id: 'misPm',
    name: 'PM Performance Report',
    findHeaderRow: () => 0,
    labelColCount: 2,
    compactNumbers: false,
    sourceUrl: 'https://docs.google.com/spreadsheets/d/1fc1zuxM0_G3WUH1UCkOhdtMwvcMOxou7MYXLXlPku3M/edit?gid=1094052471',
  },
];

const MONTH_ABBR = { january: 'Jan', february: 'Feb', march: 'Mar', april: 'Apr', may: 'May', june: 'Jun', july: 'Jul', august: 'Aug', september: 'Sep', october: 'Oct', november: 'Nov', december: 'Dec' };
const MONTH_LIST = Object.values(MONTH_ABBR);

/** "September-26" / "Sep-2026" -> "Sep-26"; the current month gets "(MTD)". */
function compactHeader(h) {
  const m = String(h).trim().match(/^([A-Za-z]+)[- ](\d{2}|\d{4})$/);
  if (!m || !(m[1].toLowerCase() in MONTH_ABBR)) return h;
  const mon = MONTH_ABBR[m[1].toLowerCase()];
  const yr = m[2].length === 4 ? m[2].slice(2) : m[2];
  const now = new Date();
  const isCurrent = MONTH_LIST[now.getMonth()] === mon && `${now.getFullYear()}`.slice(2) === yr;
  return `${mon}-${yr}${isCurrent ? ' (MTD)' : ''}`;
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

/** Caps every number in a cell at one decimal place: 80.14% -> 80.1%, 3.5991 -> 3.6 */
const capDecimals = (s) => s.replace(/-?\d+\.\d{2,}/g, (num) => Number(num).toFixed(1));

// Sheet error values (#DIV/0!, #N/A, #REF!, …) render as an em-dash
const cleanCell = (c) => (/^#[A-Z0-9/]+[!?]?$/.test(c) ? '—' : c);

function MISTable({ grid, labelColCount, compactNumbers, isDark }) {
  const { header, rows } = grid;
  if (!header.length) return null;

  // Sticky offsets: z-order matters — the top-left corner must outrank both
  // the sticky header row and the sticky label column, or it gets painted
  // over while scrolling (the "first column header scrolled away" bug).
  const labelBase = 'sticky bg-white dark:bg-dark-card px-3 text-center text-warm-text dark:text-dark-text border-r border-warm-border/60 dark:border-dark-border/60';
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

  return (
    <div className="overflow-auto rounded-xl border border-warm-border dark:border-dark-border shadow-sm bg-white dark:bg-dark-card" style={{ maxHeight: 'calc(100vh - 170px)' }}>
      <table className="border-collapse text-[11.5px] leading-snug w-full">
        <thead>
          <tr>
            {header.map((h, ci) => (
              ci < labelColCount ? (
                <th
                  key={ci}
                  className="px-3 py-2.5 text-center text-[10.5px] font-bold text-warm-muted dark:text-dark-muted bg-warm-bg dark:bg-slate-800 border-r border-b border-warm-border dark:border-dark-border"
                  style={{ position: 'sticky', top: 0, left: ci === 0 ? 0 : LABEL_COL_WIDTH, zIndex: 30, minWidth: LABEL_COL_WIDTH, maxWidth: LABEL_COL_WIDTH + 70 }}
                >
                  {h}
                </th>
              ) : (
                <th
                  key={ci}
                  className="px-3 py-2.5 text-center text-[10.5px] font-bold text-warm-muted dark:text-dark-muted whitespace-nowrap bg-warm-bg dark:bg-slate-800 border-b border-warm-border dark:border-dark-border"
                  style={{ position: 'sticky', top: 0, zIndex: 20 }}
                >
                  {compactHeader(h)}
                </th>
              )
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const labelCells = r.slice(0, labelColCount);
            const valueCells = r.slice(labelColCount);
            const isSection = labelCells.some(c => c !== '') && valueCells.every(c => c === '');
            if (isSection) {
              // The text lives in the STICKY label cell so it never scrolls
              // away; the second cell just extends the band across the table.
              return (
                <tr key={ri}>
                  <td
                    className="sticky px-3 py-2 text-center font-black text-[10.5px] uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-[#2b2416] border-y border-amber-500/20 whitespace-normal"
                    style={{ left: 0, zIndex: 5, minWidth: LABEL_COL_WIDTH * labelColCount, maxWidth: (LABEL_COL_WIDTH + 70) * labelColCount }}
                    colSpan={labelColCount}
                  >
                    {labelCells.find(c => c !== '')}
                  </td>
                  <td colSpan={header.length - labelColCount} className="py-2 bg-amber-100 dark:bg-[#2b2416] border-y border-amber-500/20" />
                </tr>
              );
            }
            // Google Sheets horizontal merge: label spans both label columns
            // (value lands in the first cell, second comes through empty)
            const isMergedLabel = labelColCount > 1 && labelCells[0] !== '' && labelCells[1] === '';
            return (
              <tr key={ri} className="hover:bg-amber-500/5 border-b border-warm-border/40 dark:border-dark-border/40">
                {isMergedLabel ? (
                  <td colSpan={labelColCount} className={`${labelBase} py-2 font-bold whitespace-normal`} style={labelStyle(0, labelColCount)}>
                    {labelCells[0]}
                  </td>
                ) : (
                  labelCells.map((c, ci) => (
                    <td key={ci} className={`${labelBase} py-2 whitespace-normal ${ci === 0 && labelColCount > 1 ? 'font-bold' : labelColCount === 1 ? 'font-semibold' : 'font-medium text-warm-muted dark:text-dark-muted'}`} style={labelStyle(ci)}>
                      {c}
                    </td>
                  ))
                )}
                {valueCells.map((c, ci) => (
                  <td key={ci} className="px-3 py-2 text-center whitespace-nowrap text-warm-text dark:text-dark-text tabular-nums">
                    {fmtValue(c)}
                  </td>
                ))}
              </tr>
            );
          })}
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

  return (
    <div className="animate-in fade-in duration-300 pt-4 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 p-1 rounded-full bg-black/5 dark:bg-white/5 border border-warm-border dark:border-dark-border w-fit">
          {REPORTS.map(rep => (
            <button
              key={rep.id}
              type="button"
              onClick={() => setActive(rep.id)}
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
          <a
            href={report.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:text-amber-accent"
          >
            <ExternalLink className="h-3 w-3" /> Source Sheet
          </a>
          <button
            type="button"
            onClick={() => loadAll(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text cursor-pointer hover:text-amber-accent disabled:opacity-50"
          >
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
        <MISTable grid={grid} labelColCount={report.labelColCount} compactNumbers={report.compactNumbers} isDark={isDark} />
      )}
    </div>
  );
}
