import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import { Sun, Moon, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

const Plot = createPlotlyComponent(Plotly);

const DEFAULT_GSHEET_URL = "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=598826199";
const FUNNEL_GSHEET_URL = "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1049115614";
const REALTIME_GSHEET_URL = "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1333104452";

const FUNNEL_STAGES = [
  { key: 'DAU', label: 'DAU' },
  { key: 'paywalling_hits', label: 'Paywall Hits' },
  { key: 'Plan_Page_Load', label: 'Plan Page Load' },
  { key: 'Plan_Selected', label: 'Plan Selected' },
  { key: 'Pay_Initiated', label: 'Pay Initiated' },
  { key: 'Purchased', label: 'Purchased' },
];

const PLATFORM_MAP = {
  'web': 'Web',
  'wap': 'MWeb',
  'market_android': 'Android',
  'ios': 'iOS'
};

const FALLBACK_CSV_URL = "/sample_subscriptions.csv";

function formatIndianCurrency(val) {
  if (val === null || val === undefined || isNaN(val) || val === 0) {
    return "₹0";
  }
  const absVal = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (absVal >= 10000000) {
    return `${sign}₹${(absVal / 10000000).toFixed(2)}Cr`;
  } else if (absVal >= 100000) {
    return `${sign}₹${(absVal / 100000).toFixed(2)}L`;
  } else if (absVal >= 1000) {
    return `${sign}₹${(absVal / 1000).toFixed(1)}K`;
  } else {
    return `${sign}₹${absVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }
}

function AovMatrixTable({ aovData, isDark }) {
  const { plans, platforms, matrix } = aovData;

  const activePlans = plans.filter(p => platforms.some(pl => matrix[p][pl].conv > 0));
  
  if (activePlans.length === 0) {
    return (
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 mt-6">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-4">ARPU by Plan & Platform</h3>
        <p className="text-sm text-warm-muted dark:text-dark-muted">No data available for the selection.</p>
      </div>
    );
  }

  let maxAov = 0;
  activePlans.forEach(p => {
    platforms.forEach(pl => {
      const { rev, conv } = matrix[p][pl];
      if (conv > 0) {
        const aov = rev / conv;
        if (aov > maxAov) maxAov = aov;
      }
    });
  });

  const platformTotals = {};
  platforms.forEach(pl => {
    let totalRev = 0;
    let totalConv = 0;
    activePlans.forEach(p => {
      totalRev += matrix[p][pl].rev;
      totalConv += matrix[p][pl].conv;
    });
    platformTotals[pl] = { rev: totalRev, conv: totalConv };
  });

  return (
    <div className="mt-2">
      <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">ARPU by Plan & Platform</h3>
      <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-lg custom-scrollbar overflow-x-auto">
        <table className="ledger-table text-sm text-left w-full">
          <thead>
            <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider">
              <th className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B] border-b border-warm-border dark:border-dark-border">Plan Category</th>
              {platforms.map(col => (
                <th key={col} className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B] border-b border-warm-border dark:border-dark-border">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="period-total-row text-warm-totalText dark:text-dark-totalText font-bold">
              <td className="p-3 whitespace-nowrap bg-warm-totalBg dark:bg-dark-totalBg border-b-2 border-amber-accent">Period total</td>
              {platforms.map(pl => {
                const { rev, conv } = platformTotals[pl];
                const arpu = conv > 0 ? rev / conv : 0;
                return (
                  <td key={pl} className="p-3 font-bold bg-warm-totalBg dark:bg-dark-totalBg border-b-2 border-amber-accent">
                    {conv > 0 ? formatIndianCurrency(arpu) : '-'}
                  </td>
                );
              })}
            </tr>
            {activePlans.map(p => {
              return (
                <tr 
                  key={p} 
                  className="border-b border-warm-border/50 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5 font-semibold text-warm-text dark:text-dark-text transition-colors"
                >
                  <td className="p-3 whitespace-nowrap font-bold">{p}</td>
                  {platforms.map(pl => {
                    const { rev, conv } = matrix[p][pl];
                    const aov = conv > 0 ? rev / conv : 0;
                    
                    const intensity = maxAov > 0 ? aov / maxAov : 0;
                    const bgStyle = intensity > 0 ? { backgroundColor: isDark ? `rgba(245, 158, 11, ${intensity * 0.35})` : `rgba(217, 119, 6, ${intensity * 0.25})` } : {};

                    return (
                      <td key={pl} className="p-3 font-medium" style={bgStyle}>
                        {conv > 0 ? formatIndianCurrency(aov) : '-'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function GeoDistributionChart({ geoData, isDark }) {
function GeoDistributionChart({ geoData, isDark }) {
  if (geoData.length === 0) {
    return (
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 mt-6">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-4">Geographic Revenue Distribution</h3>
        <p className="text-sm text-warm-muted dark:text-dark-muted">No data available for the selection.</p>
      </div>
    );
  }

  const topGeo = geoData.slice(0, 15).reverse(); 
    <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 mt-2">
  const chartData = [{
    type: 'bar',
    x: topGeo.map(d => d.rev),
    y: topGeo.map(d => d.region),
    orientation: 'h',
    marker: {
      color: isDark ? '#d97706' : '#d97706',
      line: {
        color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
        width: 1
      }
    },
    text: topGeo.map(d => formatIndianCurrency(d.rev)),
    textposition: 'outside',
    hoverinfo: 'y+text'
  }];
            autocolorscale: false,
  return (
    <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 mt-2 shadow-sm">
      <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-4 px-1">Geographic Revenue Distribution</h3>
      <div className="w-full h-[400px]">
        <Plot
          data={chartData}
          layout={{
            autosize: true,
            margin: { t: 10, r: 80, b: 40, l: 80 },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { family: 'inherit', color: isDark ? '#d1d5db' : '#374151' },
            xaxis: {
              showgrid: true,
              gridcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
              zerolinecolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
              tickfont: { size: 10, color: isDark ? '#9ca3af' : '#6b7280' },
              visible: false
            },
            yaxis: {
              showgrid: false,
              tickfont: { size: 11, color: isDark ? '#e5e7eb' : '#0F172A', weight: 'bold' }
            }
          }}
          config={{ displayModeBar: false }}
          className="w-full h-full"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
        config={{ displayModeBar: false, responsive: true }}
export function SubscriptionReport({ isDark }) {
        style={{ width: "100%", height: "100%" }}
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tableMetricMode, setTableMetricMode] = useState("Revenue (₹)");

  const [datePreset, setDatePreset] = useState("Last 30 days");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [selectedTxnTypes, setSelectedTxnTypes] = useState([]);
  const [platformOpen, setPlatformOpen] = useState(false);
  const [txnOpen, setTxnOpen] = useState(false);
  const platformRef = useRef(null);
  const txnRef = useRef(null);
  const [txnOpen, setTxnOpen] = useState(false);
    useEffect(() => {
    function handleClickOutside(event) {
      if (platformRef.current && !platformRef.current.contains(event.target)) setPlatformOpen(false);
      if (txnRef.current && !txnRef.current.contains(event.target)) setTxnOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const [channelOpen, setChannelOpen] = useState(false);
  useEffect(() => {
    if (datePreset === "Custom range") return;
    const now = new Date();
    let start = new Date();
    let end = new Date();
    
    if (datePreset === "Last 30 days") {
      start.setDate(now.getDate() - 30);
    } else if (datePreset === "Last 7 days") {
      start.setDate(now.getDate() - 7);
    } else if (datePreset === "Yesterday") {
      start.setDate(now.getDate() - 1);
      end.setDate(now.getDate() - 1);
    } else if (datePreset === "This month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (datePreset === "Last month") {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (datePreset === "Last 90 days") {
      start.setDate(now.getDate() - 90);
    } else if (datePreset === "All time") {
      start = new Date(2000, 0, 1);
    }
    
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  }, [datePreset]);
      if (planRef.current && !planRef.current.contains(event.target)) setPlanOpen(false);
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        let response = await fetch(DEFAULT_GSHEET_URL);
        if (!response.ok) throw new Error("GSheet load failed");
        const text = await response.text();
        parseCSV(text);
      } catch (err) {
        console.warn("Falling back to local CSV...", err);
        try {
          let response = await fetch(FALLBACK_CSV_URL);
          if (!response.ok) throw new Error("Local CSV load failed");
          const text = await response.text();
          parseCSV(text);
        } catch (fallbackErr) {
          setError("Failed to load subscription data from both Google Sheet and local fallback.");
          setLoading(false);
        }
      }
    }
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    function parseCSV(text) {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const processed = results.data.map(row => {
            const cleanRow = {};
            Object.keys(row).forEach(key => {
              cleanRow[key.trim()] = row[key];
            });
  const toggleRow = (key) => setExpandedRows(prev => ({ ...prev, [key]: !prev[key] }));
            let planCategory = 'UNKNOWN';
            let geoRegion = 'UNKNOWN';
            Object.keys(cleanRow).forEach(key => {
              if (key.toLowerCase().includes('plan_category')) {
                planCategory = String(cleanRow[key]).trim().toUpperCase();
              }
              if (key.toLowerCase().includes('geo_region')) {
                geoRegion = String(cleanRow[key]).trim().toUpperCase();
              }
            });
            let countryName = 'UNKNOWN';
            const rev = parseFloat(cleanRow['revenue_above_rs_6_txn']) || 0.0;
            const conv = parseInt(cleanRow['conversion'], 10) || 1;
            const dateObj = new Date(cleanRow['txn_date']);
            const isValidDate = !isNaN(dateObj.getTime());
              }
            const platformCode = String(cleanRow['platform'] || '').trim().toLowerCase();
            const platformDisplay = PLATFORM_MAP[platformCode] || platformCode.toUpperCase();
            const autoRenewVal = String(cleanRow['auto_renew'] || '').trim().toLowerCase() === 'true';
              if (key.toLowerCase().includes('country_name')) {
            return {
              ...cleanRow,
              date: dateObj,
              dateStr: isValidDate ? dateObj.toISOString().split('T')[0] : '',
              dateShort: isValidDate ? dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) : '',
              revenue: rev,
              conversion: conv,
              platformDisplay,
              user_txn_type: String(cleanRow['user_txn_type'] || '').trim().toLowerCase() || 'unknown',
              plan_category: planCategory,
              geo_region: geoRegion,
              auto_renew: autoRenewVal
            };
          }).filter(row => row.dateStr);
            const platformCode = String(cleanRow['platform'] || '').trim().toLowerCase();
          setRawData(processed);
          
          const platforms = [...new Set(processed.map(r => r.platformDisplay))].sort();
          const txns = [...new Set(processed.map(r => r.user_txn_type))].sort();
          setSelectedPlatforms(platforms);
          setSelectedTxnTypes(txns);
              dateStr: isValidDate ? dateObj.toISOString().split('T')[0] : '',
          setLoading(false);
        },
        error: (err) => {
          setError("Error parsing CSV data: " + err.message);
          setLoading(false);
        }
      });
    }
              auto_renew: autoRenewVal
    fetchData();
  }, []);

const { minDateLimit, maxDateLimit } = useMemo(() => {
    if (rawData.length === 0) return { minDateLimit: '', maxDateLimit: '' };
    const dates = rawData.map(r => r.dateStr).sort();
    const absoluteMax = dates[dates.length - 1];

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const getLocalYMD = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const yesterdayStr = getLocalYMD(yesterday);
    const cappedMax = absoluteMax > yesterdayStr ? yesterdayStr : absoluteMax;
    
    return {
      minDateLimit: dates[0],
      maxDateLimit: cappedMax
    };
  }, [rawData]);

  const filteredData = useMemo(() => {
    if (rawData.length === 0) return [];
    return rawData.filter(row => {
      const matchDate = row.dateStr >= startDate && row.dateStr <= endDate;
      const matchPlatform = selectedPlatforms.includes(row.platformDisplay);
      const matchTxn = selectedTxnTypes.includes(row.user_txn_type);
      return matchDate && matchPlatform && matchTxn;
    });
  }, [rawData, startDate, endDate, selectedPlatforms, selectedTxnTypes]);

  const platformCounts = useMemo(() => {
    const counts = {};
    rawData.forEach(r => {
      counts[r.platformDisplay] = (counts[r.platformDisplay] || 0) + 1;
    });
    return counts;
  }, [rawData]);
    const yesterday = new Date(now);
  const txnCounts = useMemo(() => {
    const counts = {};
    rawData.forEach(r => {
      counts[r.user_txn_type] = (counts[r.user_txn_type] || 0) + 1;
    });
    return counts;
  }, [rawData]);
    };
  const allPlatformOptions = useMemo(() => Object.keys(platformCounts).sort(), [platformCounts]);
  useEffect(() => {
    if (allPlatformOptions.length > 0 && selectedPlatforms.length === 0) {
      setSelectedPlatforms(allPlatformOptions);
    }
  }, [allPlatformOptions, selectedPlatforms.length]);
  const allTxnOptions = useMemo(() => Object.keys(txnCounts).sort(), [txnCounts]);
  useEffect(() => {
    if (allTxnOptions.length > 0 && selectedTxnTypes.length === 0) {
      setSelectedTxnTypes(allTxnOptions);
    }
  }, [allTxnOptions, selectedTxnTypes.length]);
    return rawData.filter(row => {
  const metrics = useMemo(() => {
    let totalRev = 0;
    let conversionsExclAuto = 0;
    let totalConversions = 0;
    let totalTxns = 0;
    let autoRenewCount = 0;
    let recurringCount = 0;
    
    filteredData.forEach(r => {
      totalRev += r.revenue || 0;
      totalConversions += r.conversion || 0;
      totalTxns += 1;
      
      if (!r.auto_renew) {
        conversionsExclAuto += r.conversion || 0;
      } else {
        autoRenewCount += r.conversion || 0;
      }
      
      if (r.user_txn_type === 'recurring') {
        recurringCount += r.conversion || 0;
      }
    });

    const msInDay = 1000 * 60 * 60 * 24;
    const s = new Date(startDate);
    const e = new Date(endDate);
    const numDays = Math.max(1, Math.round((e - s) / msInDay) + 1);

    const dailyAvgRev = totalRev / numDays;
    const dailyAvgConvExcl = conversionsExclAuto / numDays;
    const dailyAvgTxns = totalTxns / numDays;
    const avgRevPerTxn = totalTxns > 0 ? totalRev / totalTxns : 0;
    
    const recurringRate = conversionsExclAuto > 0 ? (recurringCount / conversionsExclAuto) : 0;

    return {
      totalRev,
      dailyAvgRev,
      numDays,
      conversionsExclAuto,
      dailyAvgConvExcl,
      totalConversions,
      avgRevPerTxn,
      dailyAvgTxns,
      totalTxns,
      recurringRate
    };
  }, [filteredData, startDate, endDate]);
  const allChannelOptions = useMemo(() => Object.keys(channelCounts).sort(), [channelCounts]);
  const dateRangeStr = useMemo(() => {
    if (!startDate || !endDate) return "";
    const options = { month: 'short', day: '2-digit', year: 'numeric' };
    const s = new Date(startDate).toLocaleDateString('en-US', options);
    const e = new Date(endDate).toLocaleDateString('en-US', options);
    return `${s} - ${e}`;
  }, [startDate, endDate]);
    let totalRev = 0;
  const aovData = useMemo(() => {
    const plansSet = new Set();
    filteredData.forEach(r => plansSet.add(r.plan_category));
    const plans = [...plansSet].sort();
    let recurringCount = 0;
    const platforms = [
      'ET Main · Android',
      'ET Main · iOS',
      'ET Markets · Android',
      'ET Markets · iOS',
      'ET Main · mWeb (Mobile)',
      'ET Main · Web (Desktop)'
    ];
      } else {
    const matrix = {};
    plans.forEach(p => {
      matrix[p] = {};
      platforms.forEach(pl => {
        matrix[p][pl] = { rev: 0, conv: 0 };
      });
    });

    filteredData.forEach(r => {
      const p = r.plan_category;
      const pl = r.platformDisplay;
      if (matrix[p] && matrix[p][pl]) {
        matrix[p][pl].rev += r.revenue;
        matrix[p][pl].conv += r.conversion;
      }
    });
    const avgRevPerTxn = totalTxns > 0 ? totalRev / totalTxns : 0;
    return { plans, platforms, matrix };
  }, [filteredData]);

  const geoData = useMemo(() => {
    const geoRev = {};
    filteredData.forEach(r => {
      const geo = r.geo_region || 'UNKNOWN';
      geoRev[geo] = (geoRev[geo] || 0) + r.revenue;
    });
    
    // Sort by revenue descending
    return Object.entries(geoRev)
      .map(([region, rev]) => ({ region, rev }))
      .sort((a, b) => b.rev - a.rev);
  }, [filteredData]);
  }, [filteredData, startDate, endDate]);
  const chartData = useMemo(() => {
    const grouped = {};
    filteredData.forEach(r => {
      if (!grouped[r.dateStr]) {
        grouped[r.dateStr] = { dateStr: r.dateStr, dateShort: r.dateShort, revenue: 0 };
      }
      grouped[r.dateStr].revenue += (r.revenue || 0);
    });
    return Object.values(grouped).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  }, [filteredData]);
    const plansSet = new Set();
  const buildPivotData = useCallback((field, orderArr = []) => {
    const headersSet = new Set();
    filteredData.forEach(r => {
      const d = new Date(r.dateStr);
      const h = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
      r.pivotHeader = h;
      headersSet.add(h);
    });
    
    const headers = [...headersSet].sort((a, b) => {
      const [m1, y1] = a.split(' ');
      const [m2, y2] = b.split(' ');
      const d1 = new Date("1 " + m1 + " 20" + y1);
      const d2 = new Date("1 " + m2 + " 20" + y2);
      return d1 - d2;
    });
        matrix[p][pl] = { rev: 0, conv: 0 };
    const rowsMap = {};
    const grandTotals = {};
    headers.forEach(h => grandTotals[h] = { rev: 0, conv: 0 });
    let finalGrandTotalRev = 0;
    let finalGrandTotalConv = 0;
    
    filteredData.forEach(r => {
      const f = r[field] || 'Unknown';
      const h = r.pivotHeader;
      
      if (!rowsMap[f]) {
        rowsMap[f] = { label: f, totals: {}, rowTotalRev: 0, rowTotalConv: 0 };
        headers.forEach(hdr => rowsMap[f].totals[hdr] = { rev: 0, conv: 0 });
      }
      
      rowsMap[f].totals[h].rev += (r.revenue || 0);
      rowsMap[f].totals[h].conv += (r.conversion || 0);
      rowsMap[f].rowTotalRev += (r.revenue || 0);
      rowsMap[f].rowTotalConv += (r.conversion || 0);
      
      grandTotals[h].rev += (r.revenue || 0);
      grandTotals[h].conv += (r.conversion || 0);
      
      finalGrandTotalRev += (r.revenue || 0);
      finalGrandTotalConv += (r.conversion || 0);
    });
    
    let rows = Object.values(rowsMap);
    if (orderArr && orderArr.length > 0) {
      rows.sort((a, b) => {
        const ia = orderArr.indexOf(a.label);
        const ib = orderArr.indexOf(b.label);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return b.rowTotalRev - a.rowTotalRev;
      });
    } else {
      rows.sort((a, b) => b.rowTotalRev - a.rowTotalRev);
    }
    
    return {
      headers,
      rows,
      grandTotals,
      finalGrandTotalRev,
      finalGrandTotalConv
    };
  }, [filteredData]);
      const [m1, y1] = a.split(' ');
  const platformPivot = useMemo(() => buildPivotData('platformDisplay', []), [buildPivotData]);
  const userTypePivot = useMemo(() => buildPivotData('user_txn_type', []), [buildPivotData]);
  const planPivot = useMemo(() => buildPivotData('plan_category', []), [buildPivotData]);
      return d1 - d2;
  return (
    <div className="w-full">
      
      
      {/* Filters Header specific to Subscription Report */}
      <div className="flex flex-col md:flex-row gap-4 items-end mb-6 p-4 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm">
        
        <div ref={platformRef} className="relative flex flex-col gap-1 w-[200px]">
          <label className="text-[11px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Platform</label>
          <button onClick={() => setPlatformOpen(!platformOpen)} className="flex items-center justify-between px-3 py-2 bg-warm-totalBg dark:bg-slate-800 rounded-lg border border-warm-border dark:border-dark-border text-sm font-semibold focus:outline-none">
            <span>{selectedPlatforms.length === allPlatformOptions.length && allPlatformOptions.length > 0 ? `All Platforms` : selectedPlatforms.length === 0 ? 'No Platforms' : `${selectedPlatforms.length} Platforms`}</span>
          </button>
          {platformOpen && (
            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
              <div 
                className="px-3 py-2 border-b border-warm-border dark:border-dark-border hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-sm font-semibold"
                onClick={() => setSelectedPlatforms(selectedPlatforms.length === allPlatformOptions.length ? [] : allPlatformOptions)}
              >
                {selectedPlatforms.length === allPlatformOptions.length ? 'Deselect All' : 'Select All'}
              </div>
              {allPlatformOptions.map(p => (
                <label key={p} className="flex items-center gap-2 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-sm font-medium">
                  <input type="checkbox" checked={selectedPlatforms.includes(p)} onChange={() => setSelectedPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])} className="rounded text-amber-accent focus:ring-amber-accent" />
                  {p}
                </label>
              ))}
            </div>
          )}
        </div>
        
        <div ref={txnRef} className="relative flex flex-col gap-1 w-[200px] flex-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Txn Type</label>
          <button onClick={() => setTxnOpen(!txnOpen)} className="flex items-center justify-between px-3 py-2 bg-warm-totalBg dark:bg-slate-800 rounded-lg border border-warm-border dark:border-dark-border text-sm font-semibold focus:outline-none">
            <span>{selectedTxnTypes.length === allTxnOptions.length && allTxnOptions.length > 0 ? `All Txns` : selectedTxnTypes.length === 0 ? 'No Txns' : `${selectedTxnTypes.length} Txns`}</span>
          </button>
          {txnOpen && (
            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
              <div 
                className="px-3 py-2 border-b border-warm-border dark:border-dark-border hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-sm font-semibold"
                onClick={() => setSelectedTxnTypes(selectedTxnTypes.length === allTxnOptions.length ? [] : allTxnOptions)}
              >
                {selectedTxnTypes.length === allTxnOptions.length ? 'Deselect All' : 'Select All'}
              </div>
              {allTxnOptions.map(t => (
                <label key={t} className="flex items-center gap-2 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-sm font-medium">
                  <input type="checkbox" checked={selectedTxnTypes.includes(t)} onChange={() => setSelectedTxnTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])} className="rounded text-amber-accent focus:ring-amber-accent" />
                  {t}
                </label>
              ))}
            </div>
          )}
        </div>
        
        <div className="flex justify-end items-end ml-auto">
        {/* Table Metrics Select */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Table Metrics View</label>
          <select 
            value={tableMetricMode}
            onChange={(e) => setTableMetricMode(e.target.value)}
            className="px-3 py-2 text-base font-semibold rounded-lg bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text focus:outline-none focus:ring-1 focus:ring-amber-accent cursor-pointer"
          >
            <option value="Revenue (₹)">Revenue (₹)</option>
            <option value="Conversions (#)">Conversions (#)</option>
            <option value="Combined (Revenue & Conversions)">Combined (Revenue & Conversions)</option>
          </select>
        </div>
      </div>
      </div>
            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        
        {/* REVENUE CARD */}
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Total Revenue</div>
          <div className="text-3xl font-bold text-warm-text dark:text-dark-text tracking-tight">{formatIndianCurrency(metrics.totalRev)}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg: <span className="font-bold text-amber-accent">{formatIndianCurrency(metrics.dailyAvgRev)}/day</span> <br />
            <span className="text-[9px]">{dateRangeStr} ({metrics.numDays} days)</span>
          </div>
        </div>
            </div>
        {/* CONVERSIONS CARD */}
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Conversions (Excl. Auto-Renewal)</div>
          <div className="text-3xl font-bold text-warm-text dark:text-dark-text tracking-tight">{metrics.conversionsExclAuto.toLocaleString()}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg: <span className="font-bold text-amber-accent">{metrics.dailyAvgConvExcl.toFixed(0)}/day</span> <br />
            <span>Total conversions: {metrics.totalConversions.toLocaleString()}</span>
          </div>
        </div>
            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
        {/* AVG TICKET CARD */}
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Avg Revenue / Txn</div>
          <div className="text-3xl font-bold text-warm-text dark:text-dark-text tracking-tight">{formatIndianCurrency(metrics.avgRevPerTxn)}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg volume: <span className="font-bold text-amber-accent">{metrics.dailyAvgTxns.toFixed(0)} txns/day</span> <br />
            <span>Across {metrics.totalTxns.toLocaleString()} transactions</span>
          </div>
        </div>
                  {t}
        {/* RECURRING RATE CARD */}
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Recurring Rate (New)</div>
          <div className="text-3xl font-bold text-warm-text dark:text-dark-text tracking-tight">{(metrics.recurringRate * 100).toFixed(1)}%</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            <br />
            <span>Excl. auto_renewal txns</span>
          </div>
        </div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Table Metrics View</label>
      </section>
            value={tableMetricMode}
      {/* Daily revenue trend Chart */}
      <section className="mb-6 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 shadow-sm">
        {chartData.length > 0 ? (
          <Plot 
            data={[
              {
                x: chartData.map(d => d.dateShort),
                y: chartData.map(d => d.revenue),
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Daily Revenue',
                line: {
                  color: '#f59e0b',
                  width: 2.5,
                  shape: 'spline'
                },
                fill: 'tozeroy',
                fillcolor: isDark ? 'rgba(79, 70, 229, 0.15)' : 'rgba(79, 70, 229, 0.12)',
                hovertemplate: "<b>%{x}</b><br>Revenue: ₹%{y:,.2f}<extra></extra>"
              }
            ]}
            layout={{
              title: {
                text: "<b>Daily revenue trend</b>",
                font: {
                  family: "DM Sans, sans-serif",
                  color: isDark ? '#F8FAFC' : '#0F172A',
                  size: 16
                },
                x: 0.01,
                y: 0.95
              },
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: 'rgba(0,0,0,0)',
              font: {
                family: "DM Sans, sans-serif",
                color: isDark ? '#94A3B8' : '#64748B',
                size: 10
              },
              margin: { l: 45, r: 15, t: 60, b: 45 },
              height: 345,
              xaxis: {
                showgrid: false,
                gridcolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
                zerolinecolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
                tickfont: { size: 10, color: isDark ? '#94A3B8' : '#64748B' }
              },
              yaxis: {
                gridcolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
                zerolinecolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
                tickfont: { size: 10, color: isDark ? '#94A3B8' : '#64748B' },
                range: [0, Math.max(...chartData.map(d => d.revenue)) * 1.18]
              },
              showlegend: false,
              autosize: true
            }}
            config={{ displayModeBar: false, responsive: true }}
            className="w-full"
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <div className="flex h-[250px] items-center justify-center text-base font-semibold text-warm-muted dark:text-dark-muted">
            No transaction data available for the selected date range.
          </div>
        )}
      </section>
                name: 'Daily Revenue',
      {/* Pivot Tables */}
      <section className="flex flex-col gap-6">
        <PivotTable 
          pivotData={platformPivot} 
          title="Platform-wise revenue & conversions"
          metricMode={tableMetricMode}
          isDark={isDark}
        />
        <PivotTable 
          pivotData={userTypePivot} 
          title="User-type-wise revenue & conversions"
          metricMode={tableMetricMode}
          isDark={isDark}
        />
        <PivotTable 
          pivotData={planPivot} 
          title="Plan-wise revenue & conversions"
          metricMode={tableMetricMode}
          isDark={isDark}
        />
      </section>
              paper_bgcolor: 'rgba(0,0,0,0)',
      {/* New Visualizations */}
      <section className="flex flex-col gap-6 mt-6">
        <AovMatrixTable 
          aovData={aovData} 
          isDark={isDark}
        />
        <GeoDistributionChart 
          geoData={geoData} 
          isDark={isDark}
        />
      </section>
    </div>
  );
}
        </div>
function PivotTable({ pivotData, title, metricMode, isDark }) {
  const { headers, rows, grandTotals, finalGrandTotalRev, finalGrandTotalConv } = pivotData;
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-4">{title}</h3>
        <p className="text-sm text-warm-muted dark:text-dark-muted">No data available for the selection.</p>
      </div>
    );
  }
        {/* RECURRING RATE CARD */}
  function getMetricCell(rev, conv) {
    if (metricMode === "Conversions (#)") {
      return conv > 0 ? conv.toLocaleString() : "0";
    } else if (metricMode === "Combined (Revenue & Conversions)") {
      if (rev === 0 && conv === 0) return "0";
      return (
        <span>
          {formatIndianCurrency(rev)}{' '}
          <span className="text-xs font-normal text-warm-muted dark:text-dark-muted">({conv.toLocaleString()})</span>
        </span>
      );
    } else {
      return formatIndianCurrency(rev);
    }
  }
                text: "<b>Daily revenue trend</b>",
  return (
    <div>
      <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">{title}</h3>
      <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-lg custom-scrollbar">
        <table className="ledger-table text-sm text-left">
          <thead>
            <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider">
              <th className="p-3 bg-warm-tableBg dark:bg-[#1E293B] border-b border-warm-border dark:border-dark-border">Date</th>
              {headers.map(col => (
                <th key={col} className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B] border-b border-warm-border dark:border-dark-border">{col}</th>
              ))}
              <th className="p-3 bg-warm-tableBg dark:bg-[#1E293B] border-b border-warm-border dark:border-dark-border">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="period-total-row text-warm-totalText dark:text-dark-totalText font-bold">
              <td className="p-3 whitespace-nowrap bg-warm-totalBg dark:bg-dark-totalBg border-b-2 border-amber-accent">Period total</td>
              {headers.map(col => (
                <td key={col} className="p-3 bg-warm-totalBg dark:bg-dark-totalBg border-b-2 border-amber-accent">
                  {getMetricCell(grandTotals[col].rev, grandTotals[col].conv)}
                </td>
              ))}
              <td className="p-3 bg-warm-totalBg dark:bg-dark-totalBg border-b-2 border-amber-accent">
                {getMetricCell(finalGrandTotalRev, finalGrandTotalConv)}
              </td>
            </tr>
            {rows.map(row => {
              let dayRev = 0;
              let dayConv = 0;
              headers.forEach(col => {
                if (row.totals[col]) {
                  dayRev += row.totals[col].rev;
                  dayConv += row.totals[col].conv;
                }
              });
      {/* New Visualizations */}
              return (
                <tr 
                  key={row.label} 
                  className="border-b border-warm-border/50 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5 font-semibold text-warm-text dark:text-dark-text transition-colors"
                >
                  <td className="p-3 text-warm-muted dark:text-dark-muted whitespace-nowrap">{row.label}</td>
                  {headers.map(col => {
                    const cell = row.totals[col];
                    const r = cell ? cell.rev : 0;
                    const c = cell ? cell.conv : 0;
                    return (
                      <td key={col} className="p-3 font-medium">
                        {getMetricCell(r, c)}
                      </td>
                    );
                  })}
                  <td className="p-3 font-bold">
                    {getMetricCell(dayRev, dayConv)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
      {/* Pivot Tables */}
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [activeTab, setActiveTab] = useState('Realtime');
  const isDark = theme === 'dark';
          metricMode={tableMetricMode}
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);
        />
  return (
    <div className={`min-h-screen ${isDark ? 'dark bg-[#0F172A] text-[#f8fafc]' : 'bg-[#F8FAFC] text-[#0F172A]'}`}>
      <div className="w-full px-6 py-5 md:px-10 lg:px-12">
        {/* Main Header */}
        <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-warm-border dark:border-dark-border pb-5 mb-5">
          <div className="flex items-center gap-3">
            <div className="bg-[#1E293B] text-white font-extrabold text-xl px-3 py-1.5 rounded-md shadow-sm">
              ET
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight dark:text-dark-text text-warm-text">Prime</h1>
              <p className="text-xs tracking-wider text-warm-muted dark:text-dark-muted font-bold uppercase">Subscription Ledger</p>
            </div>
          </div>
        <GeoDistributionChart 
          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-warm-totalBg dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-full p-1 overflow-x-auto custom-scrollbar">
            {['Realtime', 'Funnel Analysis', 'Subscription Report', 'Conversational Analytics'].map(tab => (
              <button 
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-1.5 text-sm font-semibold rounded-full whitespace-nowrap transition-all duration-300 ease-in-out ${activeTab === tab ? 'bg-white dark:bg-slate-700 shadow-sm border border-warm-border/50 dark:border-slate-600 text-amber-accent' : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-black/5 dark:hover:bg-white/5'}`}
              >
                {tab}
              </button>
            ))}
          </div>
          
          {/* Theme Toggle */}
          <div className="flex items-center justify-end h-[38px] pb-1">
            <button 
              onClick={() => {
                const newTheme = isDark ? 'light' : 'dark';
                setTheme(newTheme);
                localStorage.setItem('theme', newTheme);
              }}
              className="flex items-center justify-center p-2.5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 text-warm-text dark:text-dark-text hover:bg-warm-tableBg dark:hover:bg-zinc-800 transition-all shadow-sm focus:outline-none hover:scale-105"
            >
              {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-warm-text" />}
            </button>
          </div>
        </header>
          {formatIndianCurrency(rev)}{' '}
          <span className="text-xs font-normal text-warm-muted dark:text-dark-muted">({conv.toLocaleString()})</span>
        </span>
        {/* Page Content */}
        <main>
          <div className={activeTab === 'Subscription Report' ? 'block' : 'hidden'}>
            <SubscriptionReport isDark={isDark} />
          </div>
          <div className={activeTab === 'Funnel Analysis' ? 'block' : 'hidden'}>
            <FunnelAnalysis isDark={isDark} />
          </div>
          <div className={activeTab === 'Realtime' ? 'block' : 'hidden'}>
            <Realtime isDark={isDark} />
          </div>
          <div className={activeTab === 'Conversational Analytics' ? 'block' : 'hidden'}>
            <ConversationalAnalytics isDark={isDark} />
          </div>
        </main>
      </div>
    </div>
  );
}
          </thead>
function formatMetric(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}
                  {getMetricCell(grandTotals[col].rev, grandTotals[col].conv)}
function FunnelAnalysis({ isDark }) {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
              </td>
  const [datePreset, setDatePreset] = useState("Last 30 days");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
              let dayConv = 0;
  useEffect(() => {
    if (datePreset === "Custom range") return;
    const now = new Date();
    let start = new Date();
    let end = new Date();
    
    if (datePreset === "Last 30 days") {
      start.setDate(now.getDate() - 30);
    } else if (datePreset === "Last 7 days") {
      start.setDate(now.getDate() - 7);
    } else if (datePreset === "Yesterday") {
      start.setDate(now.getDate() - 1);
      end.setDate(now.getDate() - 1);
    } else if (datePreset === "This month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (datePreset === "Last month") {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (datePreset === "Last 90 days") {
      start.setDate(now.getDate() - 90);
    } else if (datePreset === "All time") {
      start = new Date(2000, 0, 1);
    }
    
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  }, [datePreset]);
  const [expandedRows, setExpandedRows] = useState({});
  const toggleRow = (key) => setExpandedRows(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        let response = await fetch(FUNNEL_GSHEET_URL);
        let csvText = await response.text();
        
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const parsed = results.data.map(row => {
              const dateStr = row.event_date;
              if (!dateStr || dateStr.length !== 8) return null;
              const formattedDateStr = `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`;
              
              return {
                dateObj: new Date(formattedDateStr),
                dateStr: formattedDateStr,
                viewType: row.view_type,
                platform: row.ET_Platform,
                DAU: parseInt(row.DAU) || 0,
                paywalling_hits: parseInt(row.paywalling_hits) || 0,
                Plan_Page_Load: parseInt(row.Plan_Page_Loaded) || 0,
                Plan_Selected: parseInt(row.Plan_Selected) || 0,
                Pay_Initiated: parseInt(row.Pay_Initiated) || 0,
                Purchased: parseInt(row.Purchased) || 0,
              };
            }).filter(row => row && !isNaN(row.dateObj));
            setRawData(parsed);
            setLoading(false);
          },
          error: (err) => {
            setError("Failed to parse CSV.");
            setLoading(false);
          }
        });
      } catch (err) {
        setError("Failed to fetch data.");
        setLoading(false);
      }
    }
    fetchData();
  }, []);
            })}
  const { minDateLimit, maxDateLimit } = useMemo(() => {
    if (rawData.length === 0) return { minDateLimit: '', maxDateLimit: '' };
    const dates = rawData.map(r => r.dateStr).sort();
    
    // We want to limit the max date to yesterday, excluding today (t-1 logic)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
    const dd = String(yesterday.getDate()).padStart(2, '0');
    const yesterdayStr = `${yyyy}-${mm}-${dd}`;
        </table>
    let dataMaxDate = dates[dates.length - 1];
    
    return { 
      minDateLimit: dates[0], 
      maxDateLimit: dataMaxDate > yesterdayStr ? yesterdayStr : dataMaxDate
    };
  }, [rawData]);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  useEffect(() => {
    if (isDark) {
  const { overallTotals, platformData, trendData } = useMemo(() => {
    const overall = { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Plan_Selected: 0, Pay_Initiated: 0, Purchased: 0, daily: {} };
    const platforms = {};
    const trends = {};
              <h1 className="text-2xl font-black tracking-tight dark:text-dark-text text-warm-text">Prime</h1>
    if (!startDate || !endDate || rawData.length === 0) return { overallTotals: overall, platformData: platforms, trendData: null };
            </div>
    const filtered = rawData.filter(r => r.dateStr >= startDate && r.dateStr <= endDate);

    filtered.forEach(row => {
      if (row.viewType === 'Overall') {
        overall.DAU += row.DAU;
        overall.paywalling_hits += row.paywalling_hits;
        overall.Plan_Page_Load += row.Plan_Page_Load;
        overall.Plan_Selected += row.Plan_Selected;
        overall.Pay_Initiated += row.Pay_Initiated;
        overall.Purchased += row.Purchased;
        
        if (!overall.daily[row.dateStr]) overall.daily[row.dateStr] = { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Plan_Selected: 0, Pay_Initiated: 0, Purchased: 0 };
        overall.daily[row.dateStr].DAU += row.DAU;
        overall.daily[row.dateStr].paywalling_hits += row.paywalling_hits;
        overall.daily[row.dateStr].Plan_Page_Load += row.Plan_Page_Load;
        overall.daily[row.dateStr].Plan_Selected += row.Plan_Selected;
        overall.daily[row.dateStr].Pay_Initiated += row.Pay_Initiated;
        overall.daily[row.dateStr].Purchased += row.Purchased;
        
        if (!trends[row.dateStr]) trends[row.dateStr] = { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Purchased: 0 };
        trends[row.dateStr].DAU += row.DAU;
        trends[row.dateStr].paywalling_hits += row.paywalling_hits;
        trends[row.dateStr].Plan_Page_Load += row.Plan_Page_Load;
        trends[row.dateStr].Purchased += row.Purchased;
      } else if (row.viewType === 'By Platform') {
        const plat = row.platform;
        if (!platforms[plat]) platforms[plat] = { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Plan_Selected: 0, Pay_Initiated: 0, Purchased: 0, daily: {} };
        platforms[plat].DAU += row.DAU;
        platforms[plat].paywalling_hits += row.paywalling_hits;
        platforms[plat].Plan_Page_Load += row.Plan_Page_Load;
        platforms[plat].Plan_Selected += row.Plan_Selected;
        platforms[plat].Pay_Initiated += row.Pay_Initiated;
        platforms[plat].Purchased += row.Purchased;
        
        if (!platforms[plat].daily[row.dateStr]) platforms[plat].daily[row.dateStr] = { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Plan_Selected: 0, Pay_Initiated: 0, Purchased: 0 };
        platforms[plat].daily[row.dateStr].DAU += row.DAU;
        platforms[plat].daily[row.dateStr].paywalling_hits += row.paywalling_hits;
        platforms[plat].daily[row.dateStr].Plan_Page_Load += row.Plan_Page_Load;
        platforms[plat].daily[row.dateStr].Plan_Selected += row.Plan_Selected;
        platforms[plat].daily[row.dateStr].Pay_Initiated += row.Pay_Initiated;
        platforms[plat].daily[row.dateStr].Purchased += row.Purchased;
      }
    });
          </div>
    const dates = Object.keys(trends).sort();
    const trendDau = dates.map(d => trends[d].DAU);
    const trendConv = dates.map(d => trends[d].Plan_Page_Load > 0 ? (trends[d].Purchased / trends[d].Plan_Page_Load) * 100 : 0);
    const trendPaywall = dates.map(d => trends[d].DAU > 0 ? (trends[d].paywalling_hits / trends[d].DAU) * 100 : 0);
        {/* Page Content */}
    return { 
      overallTotals: overall, 
      platformData: platforms,
      trendData: {
        dates,
        dau: trendDau,
        conv: trendConv,
        paywall: trendPaywall,
        uniqueDays: dates.length || 1
      }
    };
  }, [rawData, startDate, endDate]);
          </div>
  if (loading) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center text-warm-text dark:text-dark-text">
        <Loader2 className="h-10 w-10 animate-spin text-amber-accent" />
        <p className="mt-4 font-semibold tracking-wide">Loading Funnel Data...</p>
      </div>
    );
  }
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  if (error) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center p-6 text-red-500 text-center">
        <p className="text-2xl font-bold mb-4">An Error Occurred</p>
        <p className="max-w-md">{error}</p>
      </div>
    );
  }
}
  const overallConversion = overallTotals.Plan_Page_Load > 0 ? ((overallTotals.Purchased / overallTotals.Plan_Page_Load) * 100).toFixed(3) : 0;
  const paywallRate = overallTotals.DAU > 0 ? ((overallTotals.paywalling_hits / overallTotals.DAU) * 100).toFixed(2) : 0;
  const [rawData, setRawData] = useState([]);
  const dailyAvgDau = trendData ? Math.round(overallTotals.DAU / trendData.uniqueDays) : 0;
  const [error, setError] = useState(null);
  const funnelValues = FUNNEL_STAGES.map(s => overallTotals[s.key]);
  const funnelLabels = FUNNEL_STAGES.map(s => s.label);
  
  const maxFunnelVal = Math.max(...funnelValues);
  const adjustedFunnelValues = funnelValues.map(v => Math.max(v, maxFunnelVal * 0.05));
  const funnelText = funnelValues.map((v, i) => {
    const initial = funnelValues[0];
    const prev = i > 0 ? funnelValues[i-1] : v;
    const pctInit = initial > 0 ? ((v/initial)*100).toFixed(2) : 100;
    const pctPrev = i > 0 && prev > 0 ? ((v/prev)*100).toFixed(2) : 100;
    return `${formatMetric(v)}<br>${pctInit}% of initial<br>${pctPrev}% of previous`;
  });
      start.setDate(now.getDate() - 30);
  const sparklineLayout = {
    width: 128,
    height: 64,
    margin: { l: 0, r: 15, t: 5, b: 5 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    xaxis: { visible: false, fixedrange: true },
    yaxis: { visible: false, fixedrange: true },
    showlegend: false,
    hovermode: 'x'
  };
      start.setDate(now.getDate() - 90);
  const activePlatforms = Object.keys(platformData).sort();
      start = new Date(2000, 0, 1);
  const renderRow = (key, pData, title, isExpanded, onToggle, isDaily = false) => {
    return (
      <tr 
        key={key} 
        className={`border-b border-warm-border/50 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5 transition-colors font-semibold text-warm-text dark:text-dark-text ${isDaily ? 'bg-black/5 dark:bg-white/5' : ''}`}
      >
        <td className={`p-3 whitespace-nowrap font-bold flex items-center gap-2 ${isDaily ? 'pl-10 text-warm-muted dark:text-dark-muted' : 'text-amber-accent dark:text-amber-400 cursor-pointer select-none'}`} onClick={!isDaily ? onToggle : undefined}>
          {!isDaily && (
             isExpanded ? <ChevronDown size={14} className="text-warm-text dark:text-dark-text" /> : <ChevronRight size={14} className="text-warm-text dark:text-dark-text" />
          )}
          {title}
        </td>
        {FUNNEL_STAGES.map((stage, idx) => {
          const val = pData[stage.key] || 0;
          const prevVal = idx > 0 ? (pData[FUNNEL_STAGES[idx-1].key] || 0) : val;
          const dropoff = idx > 0 && prevVal > 0 ? ((val / prevVal) * 100).toFixed(1) : null;
          
          return (
            <td key={stage.key} className="p-3 whitespace-nowrap text-right">
              <div className={`font-bold ${isDaily ? 'text-[11px]' : 'text-[13px]'}`}>{val.toLocaleString()}</div>
              {dropoff !== null && (
                <div className="text-xs text-warm-muted dark:text-dark-muted mt-0.5">
                  {dropoff}% of prev
                </div>
              )}
            </td>
          );
        })}
      </tr>
    );
  };
              {expandedRows['overall'] && Object.keys(overallTotals.daily || {}).sort((a,b)=>b.localeCompare(a)).map(date => (
  return (
    <div className="animate-in fade-in duration-300">
      
      {/* Date Range Selector */}
      <div className="flex justify-end mb-4">
        <div className="flex items-center gap-2">
          {datePreset === "Custom range" && (
            <div className="flex items-center gap-2 mr-2">
              <input type="date" value={startDate} min="2020-01-01" max={new Date().toISOString().split('T')[0]} onChange={(e) => setStartDate(e.target.value)} className="px-2 py-1.5 text-sm font-medium rounded-lg bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent" />
              <span className="text-sm text-warm-muted dark:text-dark-muted">to</span>
              <input type="date" value={endDate} min="2020-01-01" max={new Date().toISOString().split('T')[0]} onChange={(e) => setEndDate(e.target.value)} className="px-2 py-1.5 text-sm font-medium rounded-lg bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent" />
            </div>
          )}
          <div className="relative">
            <select 
              value={datePreset} 
              onChange={(e) => setDatePreset(e.target.value)}
              className="appearance-none bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-sm font-semibold rounded-lg pl-3 pr-8 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-sm cursor-pointer"
            >
              <option value="Yesterday">Yesterday</option>
              <option value="Last 7 days">Last 7 days</option>
              <option value="Last 30 days">Last 30 days</option>
              <option value="This month">This month</option>
              <option value="Last month">Last month</option>
              <option value="Last 90 days">Last 90 days</option>
              <option value="All time">All time</option>
              <option value="Custom range">Custom range</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-warm-muted dark:text-dark-muted">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 shadow-sm hover:shadow-md transition-shadow flex justify-between items-center">
          <div>
            <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Daily Avg DAU</h3>
            <div className="flex items-end gap-3">
              <span className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">
                {dailyAvgDau.toLocaleString()}
              </span>
            </div>
          </div>
          {trendData && (
            <div className="w-32 h-16">
              <Plot
                data={[{ x: trendData.dates, y: trendData.dau, type: 'scatter', mode: 'lines+markers', marker: { size: 4 }, line: { color: isDark ? '#fbbf24' : '#d97706', width: 2 }, fill: 'tozeroy', fillcolor: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(217,119,6,0.1)' }]}
                layout={sparklineLayout} config={{ displayModeBar: false }} style={{ width: '100%', height: '100%' }}
              />
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 shadow-sm hover:shadow-md transition-shadow flex justify-between items-center">
          <div>
            <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Overall Conversion</h3>
            <div className="flex items-end gap-3">
              <span className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">
                {overallConversion}%
              </span>
              <span className="text-sm font-bold text-warm-muted dark:text-dark-muted mb-1 pb-0.5">Purchased / Plan Page Load</span>
            </div>
          </div>
          {trendData && (
            <div className="w-32 h-16">
              <Plot
                data={[{ x: trendData.dates, y: trendData.conv, type: 'scatter', mode: 'lines+markers', marker: { size: 4 }, line: { color: isDark ? '#fbbf24' : '#d97706', width: 2 }, fill: 'tozeroy', fillcolor: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(217,119,6,0.1)' }]}
                layout={sparklineLayout} config={{ displayModeBar: false }} style={{ width: '100%', height: '100%' }}
              />
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 shadow-sm hover:shadow-md transition-shadow flex justify-between items-center">
          <div>
            <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Paywall Hit Rate</h3>
            <div className="flex items-end gap-3">
              <span className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">
                {paywallRate}%
              </span>
              <span className="text-sm font-bold text-warm-muted dark:text-dark-muted mb-1 pb-0.5">Hits / DAU</span>
            </div>
          </div>
          {trendData && (
            <div className="w-32 h-16">
              <Plot
                data={[{ x: trendData.dates, y: trendData.paywall, type: 'scatter', mode: 'lines+markers', marker: { size: 4 }, line: { color: isDark ? '#fbbf24' : '#d97706', width: 2 }, fill: 'tozeroy', fillcolor: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(217,119,6,0.1)' }]}
                layout={sparklineLayout} config={{ displayModeBar: false }} style={{ width: '100%', height: '100%' }}
              />
            </div>
          )}
        </div>
      </section>

      {/* Funnel Chart */}
      <section className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 shadow-sm hover:shadow-md transition-shadow mb-6">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-4">Overall User Funnel</h3>
        <div className="w-full h-[400px]">
          <Plot
            data={[
              {
                type: 'funnel',
                y: funnelLabels,
                x: funnelValues,
                textinfo: "value+percent initial",
                hoverinfo: "x+percent previous+percent initial",
                marker: {
                  color: isDark 
                    ? ['#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f', '#451a03']
                    : ['#fcd34d', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f'],
                  line: { width: 0 }
                }
              }
            ]}
            layout={{
              autosize: true,
              margin: { l: 140, r: 40, t: 20, b: 20 },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              yaxis: { 
                tickfont: { family: 'inherit', color: isDark ? '#F8FAFC' : '#0F172A', size: 12, weight: 'bold' }
              }
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </section>
  const dailyAvgDau = trendData ? Math.round(overallTotals.DAU / trendData.uniqueDays) : 0;
      {/* Platform Breakdown Table */}
      <section className="mt-8 pb-10">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">Platform-wise Funnel Breakdown</h3>
        <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-lg custom-scrollbar overflow-x-auto shadow-sm">
          <table className="ledger-table text-sm text-left w-full">
            <thead>
              <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider">
                <th className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B] border-b border-warm-border dark:border-dark-border">Platform</th>
                {FUNNEL_STAGES.map(stage => (
                  <th key={stage.key} className="p-3 whitespace-nowrap text-right bg-warm-tableBg dark:bg-[#1E293B] border-b border-warm-border dark:border-dark-border">{stage.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Overall Row */}
              {renderRow('overall', overallTotals, 'Overall', expandedRows['overall'], () => toggleRow('overall'))}
              {expandedRows['overall'] && Object.keys(overallTotals.daily || {}).sort((a,b)=>b.localeCompare(a)).map(date => (
                 renderRow(`overall-${date}`, overallTotals.daily[date], date, false, null, true)
              ))}
              
              {/* Platform Rows */}
              {activePlatforms.map(plat => {
                const pData = platformData[plat];
                const isExpanded = expandedRows[plat];
                return (
                  <React.Fragment key={plat}>
                    {renderRow(plat, pData, plat, isExpanded, () => toggleRow(plat))}
                    {isExpanded && Object.keys(pData.daily || {}).sort((a,b)=>b.localeCompare(a)).map(date => (
                       renderRow(`${plat}-${date}`, pData.daily[date], date, false, null, true)
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
        {FUNNEL_STAGES.map((stage, idx) => {
function Realtime({ isDark }) {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
          
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        let response = await fetch(REALTIME_GSHEET_URL);
        let csvText = await response.text();
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const data = results.data.map(r => ({
              dateStr: r.event_date.trim(),
              hour: parseInt(r.event_hour.trim(), 10),
              platform: r.ET_Platform.trim(),
              event: r.event_name.trim(),
              count: parseInt(r.event_count.trim(), 10) || 0
            })).filter(r => r.dateStr && !isNaN(r.hour));
            setRawData(data);
            setLoading(false);
          }
        });
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    }
    fetchData();
  }, []);
          <div className="relative">
  const { todayDate, currentHour, todayPurchases, avgPast4WeeksTotal, avgPast4WeeksCurrentHour, projectedTotal, hourlyTrend, platformBreakdown } = useMemo(() => {
    if (!rawData.length) return { hourlyTrend: null };
              onChange={(e) => setDatePreset(e.target.value)}
    let maxDateObj = new Date(0);
    let todayDateStr = "";
    
    rawData.forEach(r => {
       const parts = r.dateStr.split('/');
       if (parts.length === 3) {
         const d = new Date(r.dateStr);
         if (d > maxDateObj) {
           maxDateObj = d;
           todayDateStr = r.dateStr;
         }
       }
    });
            </div>
    let currentHour = -1;
    rawData.forEach(r => {
      if (r.dateStr === todayDateStr && r.hour > currentHour) {
        currentHour = r.hour;
      }
    });
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 shadow-sm hover:shadow-md transition-shadow flex justify-between items-center">
    const past4Dates = [];
    for (let i = 1; i <= 4; i++) {
      const d = new Date(maxDateObj);
      d.setDate(d.getDate() - (i * 7));
      past4Dates.push(`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`);
    }
            </div>
    let todayPurchases = 0;
    let past4WeeksTotal = 0;
    let past4WeeksCurrentHourSum = 0;
              <Plot
    const hourlyData = Array.from({length: 24}, () => ({ today: 0, pastAvg: 0 }));
    const pastHourlySums = Array.from({length: 24}, () => 0);
    const platformFunnel = {};
            </div>
    rawData.forEach(r => {
      const isToday = r.dateStr === todayDateStr;
      const isPast = past4Dates.includes(r.dateStr);
      const isPurchase = r.event === 'Purchase';
            <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Overall Conversion</h3>
      if (r.platform === 'Combined') {
        if (isToday && isPurchase) {
          todayPurchases += r.count;
          hourlyData[r.hour].today += r.count;
        } else if (isPast && isPurchase) {
          pastHourlySums[r.hour] += r.count;
        }
      } else {
        if (isToday) {
          if (!platformFunnel[r.platform]) platformFunnel[r.platform] = { PlanPageLoaded: 0, PlanSelected: 0, PayInitiated: 0, Purchase: 0 };
          if (r.event === 'Plan Page Loaded') platformFunnel[r.platform].PlanPageLoaded += r.count;
          if (r.event === 'Plan Selected') platformFunnel[r.platform].PlanSelected += r.count;
          if (r.event === 'Pay Initiated') platformFunnel[r.platform].PayInitiated += r.count;
          if (r.event === 'Purchase') platformFunnel[r.platform].Purchase += r.count;
        }
      }
    });
          <div>
    const uniquePastDatesSet = new Set();
    rawData.forEach(r => { if (past4Dates.includes(r.dateStr)) uniquePastDatesSet.add(r.dateStr); });
    const numPastDays = uniquePastDatesSet.size || 1;
                {paywallRate}%
    for (let h = 0; h < 24; h++) {
      hourlyData[h].pastAvg = pastHourlySums[h] / numPastDays;
      past4WeeksTotal += hourlyData[h].pastAvg;
      if (h <= currentHour) {
        past4WeeksCurrentHourSum += hourlyData[h].pastAvg;
      }
    }
                data={[{ x: trendData.dates, y: trendData.paywall, type: 'scatter', mode: 'lines+markers', marker: { size: 4 }, line: { color: isDark ? '#fbbf24' : '#d97706', width: 2 }, fill: 'tozeroy', fillcolor: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(217,119,6,0.1)' }]}
    const projectedTotal = past4WeeksCurrentHourSum > 0 
      ? (todayPurchases / past4WeeksCurrentHourSum) * past4WeeksTotal 
      : todayPurchases * (24 / (currentHour + 1));
          )}
    return {
      todayDate: todayDateStr,
      currentHour,
      todayPurchases,
      avgPast4WeeksTotal: past4WeeksTotal,
      avgPast4WeeksCurrentHour: past4WeeksCurrentHourSum,
      projectedTotal,
      hourlyTrend: hourlyData,
      platformBreakdown: platformFunnel
    };
  }, [rawData]);
                y: funnelLabels,
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-warm-muted dark:text-dark-muted">
        <Loader2 className="animate-spin mb-4" size={32} />
        <p className="font-semibold text-base tracking-wide">Fetching realtime data...</p>
      </div>
    );
  }
                }
  if (!hourlyTrend) {
    return <div className="p-4 text-red-500 font-bold">No realtime data available.</div>;
  }
              autosize: true,
  const hours = Array.from({length: 24}, (_, i) => i);
  
  return (
    <div className="animate-in fade-in duration-300 pb-12">
      {/* Realtime Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            Realtime Live Forecast
          </h2>
          <p className="text-base font-medium text-warm-muted dark:text-dark-muted mt-1 tracking-wide">
            Monitoring data for <strong className="text-warm-text dark:text-dark-text">{todayDate}</strong> up to hour <strong className="text-warm-text dark:text-dark-text">{currentHour}:00</strong>
          </p>
        </div>
      </div>
              <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider">
      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 shadow-sm">
          <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Purchases Today (So far)</h3>
          <span className="text-4xl font-black text-warm-text dark:text-dark-text tracking-tight">{Math.round(todayPurchases).toLocaleString()}</span>
        </div>
        
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 shadow-sm ring-1 ring-amber-500/30 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 opacity-10">
            <Sun size={48} />
          </div>
          <h3 className="text-[11px] font-bold text-amber-accent dark:text-amber-500 tracking-wider uppercase mb-1">Estimated Today (EOD)</h3>
          <span className="text-4xl font-black text-amber-accent dark:text-amber-400 tracking-tight">{Math.round(projectedTotal).toLocaleString()}</span>
        </div>
              {activePlatforms.map(plat => {
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 shadow-sm">
          <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Past 4-Week Avg (Same Day)</h3>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{Math.round(avgPast4WeeksTotal).toLocaleString()}</span>
            <span className="text-xs text-warm-muted dark:text-dark-muted pb-1 font-bold">Total EOD</span>
          </div>
        </div>
                    ))}