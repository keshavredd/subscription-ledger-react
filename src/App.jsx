import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { processConversationalQuery, processConversationalQueryAsync } from './utils/aiDataEngine';
import { getStoredApiKey, setStoredApiKey } from './services/geminiService';
import Papa from 'papaparse';
import { Sun, Moon, ChevronDown, ChevronRight, Loader2, Bot, User, Send, Sparkles, Trash2, HelpCircle, RefreshCw, BarChart2, Globe, ShieldAlert, ArrowRight, MessageSquare, Key, Check, LogOut, ShieldCheck } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

import LoginScreen from './components/LoginScreen';
import AdminPanel from './components/AdminPanel';
import { isAdminEmail, isUserAuthorized, logTabPageView, logChatQuery } from './services/telemetryService';
import { logoutUser } from './services/firebaseService';
import { fetchDatasetCached, DATASET_URLS, preloadAllDashboardData } from './services/dataPreloader';

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
  'main_android': 'Main - Android',
  'main_ios': 'Main - IOS',
  'market_android': 'Market - Android',
  'market_ios': 'Market - IOS',
  'et main · android': 'Main - Android',
  'et main · ios': 'Main - IOS',
  'et markets · android': 'Market - Android',
  'et markets · ios': 'Market - IOS',
  'et main - android': 'Main - Android',
  'et main - ios': 'Main - IOS',
  'et markets - android': 'Market - Android',
  'et markets - ios': 'Market - IOS',
  'android': 'Main - Android',
  'ios': 'Main - IOS',
  'wap': 'WAP',
  'mweb': 'WAP',
  'web': 'WEB',
  'desktop': 'WEB'
};



function formatIndianCurrency1Dec(num) {
  if (!num || isNaN(num)) return "₹0";
  const absNum = Math.abs(num);
  let formatted = "";
  if (absNum >= 10000000) {
    formatted = `₹${(num / 10000000).toFixed(1)}Cr`;
  } else if (absNum >= 100000) {
    formatted = `₹${(num / 100000).toFixed(1)}L`;
  } else if (absNum >= 1000) {
    formatted = `₹${(num / 1000).toFixed(1)}K`;
  } else {
    formatted = `₹${num.toFixed(1)}`;
  }
  return formatted;
}

function parseStrictDate(rawDateStr) {
  if (!rawDateStr) return { dateStr: '', dateShort: '' };
  const s = String(rawDateStr).trim();
  
  let year, month, day;
  
  if (s.includes('-') && s.split('-')[0].length === 4) {
    const parts = s.split('-');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2].substring(0, 2), 10);
  } else if (s.includes('/')) {
    const parts = s.split('/');
    if (parts[0].length === 4) {
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      day = parseInt(parts[2].substring(0, 2), 10);
    } else if (parts.length === 3) {
      month = parseInt(parts[0], 10);
      day = parseInt(parts[1], 10);
      year = parseInt(parts[2].substring(0, 4), 10);
    }
  } else {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      year = d.getFullYear();
      month = d.getMonth() + 1;
      day = d.getDate();
    }
  }
  
  if (!year || !month || !day || isNaN(year) || isNaN(month) || isNaN(day)) {
    return { dateStr: '', dateShort: '' };
  }
  
  const yyyy = String(year);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthName = MONTH_NAMES[month - 1] || 'Jan';
  const dateShort = `${monthName} ${dd}`;
  
  return { dateStr, dateShort };
}

function normalizePlatformName(rawStr) {
  if (!rawStr) return 'WEB';
  const str = String(rawStr).trim().toLowerCase();
  if (PLATFORM_MAP[str]) return PLATFORM_MAP[str];
  if (str.includes('market') && str.includes('android')) return 'Market - Android';
  if (str.includes('market') && str.includes('ios')) return 'Market - IOS';
  if (str.includes('main') && str.includes('android')) return 'Main - Android';
  if (str.includes('main') && str.includes('ios')) return 'Main - IOS';
  if (str.includes('wap') || str.includes('mweb')) return 'WAP';
  if (str.includes('web') || str.includes('desktop')) return 'WEB';
  return rawStr;
}

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
          <thead className="sticky top-0 z-20 bg-warm-tableBg dark:bg-[#1E293B]">
            <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider">
              <th className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B] border-b border-warm-border dark:border-dark-border">Plan Category</th>
              {platforms.map(col => (
                <th key={col} className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B] border-b border-warm-border dark:border-dark-border text-right">{col}</th>
              ))}
            </tr>
            <tr className="period-total-row text-warm-totalText dark:text-dark-totalText font-bold bg-[#FEF3C7] dark:bg-[#1E293B]">
              <td className="p-3 whitespace-nowrap bg-[#FEF3C7] dark:bg-[#1E293B] font-black text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
              {platforms.map(pl => {
                const { rev, conv } = platformTotals[pl];
                const arpu = conv > 0 ? rev / conv : 0;
                return (
                  <td key={pl} className="p-3 font-extrabold text-right bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>
                    {conv > 0 ? formatIndianCurrency(arpu) : '-'}
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
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
  if (!geoData || geoData.length === 0) {
    return (
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 mt-6 w-full">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-4">Geographic Revenue Distribution</h3>
        <p className="text-sm text-warm-muted dark:text-dark-muted">No data available for the selection.</p>
      </div>
    );
  }

  const countryNameMap = {
    'IN': 'India', 'INDIA': 'India',
    'US': 'United States', 'USA': 'United States', 'UNITED STATES': 'United States',
    'UK': 'United Kingdom', 'GB': 'United Kingdom', 'UNITED KINGDOM': 'United Kingdom',
    'AE': 'United Arab Emirates', 'UAE': 'United Arab Emirates', 'UNITED ARAB EMIRATES': 'United Arab Emirates',
    'CA': 'Canada', 'CANADA': 'Canada',
    'AU': 'Australia', 'AUSTRALIA': 'Australia',
    'SG': 'Singapore', 'SINGAPORE': 'Singapore',
    'DE': 'Germany', 'GERMANY': 'Germany',
    'FR': 'France', 'FRANCE': 'France'
  };

  const formattedGeo = geoData.map(d => {
    const raw = String(d.region || '').trim().toUpperCase();
    const name = countryNameMap[raw] || d.region;
    return {
      country: name,
      rev: d.rev
    };
  });

  const locations = formattedGeo.map(d => d.country);
  const rawRevs = formattedGeo.map(d => d.rev);
  const hoverText = formattedGeo.map(d => `<b>${d.country}</b><br>Revenue: ${formatIndianCurrency(d.rev)}`);

  const zValues = rawRevs.map(r => r > 0 ? Math.log10(r + 1) : 0);

  const mapData = [{
    type: 'choropleth',
    locationmode: 'country names',
    locations: locations,
    z: zValues,
    text: hoverText,
    hoverinfo: 'text',
    colorscale: isDark ? [
      [0, '#1e293b'],
      [0.2, '#fef08a'],
      [0.5, '#f59e0b'],
      [0.8, '#d97706'],
      [1.0, '#991b1b']
    ] : [
      [0, '#f8fafc'],
      [0.2, '#fde68a'],
      [0.5, '#f59e0b'],
      [0.8, '#d97706'],
      [1.0, '#7c2d12']
    ],
    showscale: true,
    colorbar: {
      title: { text: 'Revenue Heatmap', font: { size: 12, color: isDark ? '#d1d5db' : '#374151' } },
      tickfont: { size: 10, color: isDark ? '#9ca3af' : '#6b7280' },
      len: 0.8
    }
  }];

  return (
    <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 mt-6 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-warm-text dark:text-dark-text px-1">Geographic Revenue Distribution (World Map)</h3>
          <p className="text-xs text-warm-muted dark:text-dark-muted px-1 mt-0.5">Interactive Revenue Heatmap across Countries (Scaled for Global Visibility)</p>
        </div>
      </div>
      <div className="w-full h-[450px] rounded-lg overflow-hidden border border-warm-border/50 dark:border-zinc-800">
        <Plot
          data={mapData}
          layout={{
            autosize: true,
            margin: { t: 10, r: 10, b: 10, l: 10 },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            geo: {
              showframe: false,
              showcoastlines: true,
              coastlinecolor: isDark ? '#475569' : '#cbd5e1',
              projection: {
                type: 'natural earth',
                scale: 1.1
              },
              center: { lon: 15, lat: 20 },
              bgcolor: 'transparent',
              showland: true,
              landcolor: isDark ? '#1e293b' : '#f1f5f9',
              countrycolor: isDark ? '#334155' : '#e2e8f0',
              showcountries: true
            }
          }}
          config={{ displayModeBar: false, responsive: true }}
          className="w-full h-full"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}

export function SubscriptionReport({ isDark }) {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tableMetricMode, setTableMetricMode] = useState("Revenue (₹)");
  const [trendDataCut, setTrendDataCut] = useState("Overall");

  const [datePreset, setDatePreset] = useState("Last 30 days");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [selectedCountries, setSelectedCountries] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [selectedPlans, setSelectedPlans] = useState([]);
  const [selectedTxnTypes, setSelectedTxnTypes] = useState([]);

  const [platformOpen, setPlatformOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [txnOpen, setTxnOpen] = useState(false);

  const platformRef = useRef(null);
  const countryRef = useRef(null);
  const channelRef = useRef(null);
  const planRef = useRef(null);
  const txnRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (platformRef.current && !platformRef.current.contains(event.target)) setPlatformOpen(false);
      if (countryRef.current && !countryRef.current.contains(event.target)) setCountryOpen(false);
      if (channelRef.current && !channelRef.current.contains(event.target)) setChannelOpen(false);
      if (planRef.current && !planRef.current.contains(event.target)) setPlanOpen(false);
      if (txnRef.current && !txnRef.current.contains(event.target)) setTxnOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calculate latest available data date in dataset (T-1)
  const maxAvailableDate = useMemo(() => {
    if (!rawData || rawData.length === 0) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d;
    }
    const dates = rawData.map(r => r.dateStr).filter(Boolean).sort();
    const lastDateStr = dates[dates.length - 1];
    if (lastDateStr && lastDateStr.includes("-")) {
      const [y, m, d] = lastDateStr.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    const fallback = new Date();
    fallback.setDate(fallback.getDate() - 1);
    return fallback;
  }, [rawData]);

  useEffect(() => {
    if (datePreset === "Custom range") return;

    // Anchor to T-1 date (maxAvailableDate, e.g. Aug 14)
    const baseEnd = new Date(maxAvailableDate);
    let start = new Date(baseEnd);
    let end = new Date(baseEnd);

    if (datePreset === "Last 30 days") {
      start.setDate(baseEnd.getDate() - 29);
    } else if (datePreset === "Last 7 days") {
      start.setDate(baseEnd.getDate() - 6);
    } else if (datePreset === "Yesterday") {
      start = new Date(baseEnd);
      end = new Date(baseEnd);
    } else if (datePreset === "This month") {
      start = new Date(baseEnd.getFullYear(), baseEnd.getMonth(), 1);
    } else if (datePreset === "Last month") {
      start = new Date(baseEnd.getFullYear(), baseEnd.getMonth() - 1, 1);
      end = new Date(baseEnd.getFullYear(), baseEnd.getMonth(), 0);
    } else if (datePreset === "Last 90 days") {
      start.setDate(baseEnd.getDate() - 89);
    } else if (datePreset === "All time") {
      start = new Date(2000, 0, 1);
    }

    const formatDateYMD = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    setStartDate(formatDateYMD(start));
    setEndDate(formatDateYMD(end));
  }, [datePreset, maxAvailableDate]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const results = await fetchDatasetCached('subscription', DEFAULT_GSHEET_URL);
        processParsedData(results.data);
      } catch (err) {
        console.warn("Subscription report fetch error", err);
        setError("Failed to load subscription data.");
        setLoading(false);
      }
    }

    function processParsedData(dataArray) {
      const processed = dataArray.map(row => {
            const cleanRow = {};
            Object.keys(row).forEach(key => {
              cleanRow[key.trim()] = row[key];
            });

            let planCategory = 'UNKNOWN';
            let geoRegion = 'UNKNOWN';
            let countryName = 'UNKNOWN';
            let channelName = 'UNKNOWN';

            Object.keys(cleanRow).forEach(key => {
              const k = key.toLowerCase();
              if (k.includes('plan_category') || k.includes('plan_name') || k === 'plan') {
                planCategory = String(cleanRow[key]).trim().toUpperCase();
              }
              if (k.includes('country_name') || k.includes('country') || k.includes('geo_region')) {
                countryName = String(cleanRow[key]).trim();
              }
              if (k.includes('channel')) {
                channelName = String(cleanRow[key]).trim();
              }
            });

            const rev = parseFloat(cleanRow['revenue_above_rs_6_txn']) || 0.0;
            const conv = parseInt(cleanRow['conversion'], 10) || 1;
            const { dateStr, dateShort } = parseStrictDate(cleanRow['txn_date']);

            const platformCode = String(cleanRow['platform'] || cleanRow['et_platform'] || '').trim().toLowerCase();
            const platformDisplay = normalizePlatformName(platformCode);
            const autoRenewVal = String(cleanRow['auto_renew'] || '').trim().toLowerCase() === 'true';

            return {
              ...cleanRow,
              dateStr,
              dateShort,
              revenue: rev,
              conversion: conv,
              platformDisplay,
              country_name: countryName || 'Unknown',
              channel: channelName || 'Unknown',
              user_txn_type: String(cleanRow['user_txn_type'] || '').trim().toLowerCase() || 'unknown',
              plan_category: planCategory || 'UNKNOWN',
              geo_region: countryName || geoRegion || 'UNKNOWN',
              auto_renew: autoRenewVal
            };
          }).filter(row => row.dateStr);

          setRawData(processed);
          
          const platforms = [...new Set(processed.map(r => r.platformDisplay))].sort();
          const countries = [...new Set(processed.map(r => r.country_name))].sort();
          const channels = [...new Set(processed.map(r => r.channel))].sort();
          const plans = [...new Set(processed.map(r => r.plan_category))].sort();
          const txns = [...new Set(processed.map(r => r.user_txn_type))].sort();

          setSelectedPlatforms(platforms);
          setSelectedCountries(countries);
          setSelectedChannels(channels);
          setSelectedPlans(plans);
          setSelectedTxnTypes(txns);

          setLoading(false);
    }

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
      const matchCountry = selectedCountries.includes(row.country_name);
      const matchChannel = selectedChannels.includes(row.channel);
      const matchPlan = selectedPlans.includes(row.plan_category);
      const matchTxn = selectedTxnTypes.includes(row.user_txn_type);
      return matchDate && matchPlatform && matchCountry && matchChannel && matchPlan && matchTxn;
    });
  }, [rawData, startDate, endDate, selectedPlatforms, selectedCountries, selectedChannels, selectedPlans, selectedTxnTypes]);

  const allPlatformOptions = useMemo(() => [...new Set(rawData.map(r => r.platformDisplay))].sort(), [rawData]);
  const allCountryOptions = useMemo(() => [...new Set(rawData.map(r => r.country_name))].sort(), [rawData]);
  const allChannelOptions = useMemo(() => [...new Set(rawData.map(r => r.channel))].sort(), [rawData]);
  const allPlanOptions = useMemo(() => [...new Set(rawData.map(r => r.plan_category))].sort(), [rawData]);
  const allTxnOptions = useMemo(() => [...new Set(rawData.map(r => r.user_txn_type))].sort(), [rawData]);

  useEffect(() => {
    if (allPlatformOptions.length > 0 && selectedPlatforms.length === 0) setSelectedPlatforms(allPlatformOptions);
    if (allCountryOptions.length > 0 && selectedCountries.length === 0) setSelectedCountries(allCountryOptions);
    if (allChannelOptions.length > 0 && selectedChannels.length === 0) setSelectedChannels(allChannelOptions);
    if (allPlanOptions.length > 0 && selectedPlans.length === 0) setSelectedPlans(allPlanOptions);
    if (allTxnOptions.length > 0 && selectedTxnTypes.length === 0) setSelectedTxnTypes(allTxnOptions);
  }, [allPlatformOptions, allCountryOptions, allChannelOptions, allPlanOptions, allTxnOptions]);

  const metrics = useMemo(() => {
    let totalRev = 0;
    let conversionsExclAuto = 0;
    let totalConversions = 0;
    let totalTxns = 0;
    let nonAutoTxnCount = 0;
    let recurringTrueCount = 0;
    
    filteredData.forEach(r => {
      totalRev += r.revenue || 0;
      totalConversions += r.conversion || 0;
      totalTxns += 1;
      
      const isAutoTxnType = String(r.user_txn_type || '').toLowerCase().includes('auto');
      if (!isAutoTxnType) {
        conversionsExclAuto += r.conversion || 0;
        nonAutoTxnCount += 1;
        
        const isAutoRenewTrue = r.auto_renew === true || String(r.auto_renew || '').toLowerCase() === 'true';
        if (isAutoRenewTrue) {
          recurringTrueCount += 1;
        }
      }
    });

    let numDays = 1;
    if (startDate && endDate) {
      const [y1, m1, d1] = startDate.split('-').map(Number);
      const [y2, m2, d2] = endDate.split('-').map(Number);
      if (y1 && m1 && d1 && y2 && m2 && d2) {
        const dt1 = new Date(y1, m1 - 1, d1);
        const dt2 = new Date(y2, m2 - 1, d2);
        numDays = Math.max(1, Math.round((dt2.getTime() - dt1.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      }
    }

    const dailyAvgRev = totalRev / numDays;
    const dailyAvgConvExcl = conversionsExclAuto / numDays;
    const dailyAvgTxns = totalTxns / numDays;
    const avgRevPerTxn = totalTxns > 0 ? totalRev / totalTxns : 0;
    const recurringRate = nonAutoTxnCount > 0 ? (recurringTrueCount / nonAutoTxnCount) : 0;

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
      recurringRate,
      nonAutoTxnCount,
      recurringTrueCount
    };
  }, [filteredData, startDate, endDate]);

  // Timezone-safe date string formatter (YYYY-MM-DD -> MMM DD, YYYY)
  const formatDisplayDate = (dateStr) => {
    if (!dateStr || !dateStr.includes('-')) return dateStr || '';
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return dateStr;
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = MONTHS[m - 1] || "";
    const dayPadded = String(d).padStart(2, '0');
    return `${monthName} ${dayPadded}, ${y}`;
  };

  const dateRangeStr = useMemo(() => {
    if (!startDate || !endDate) return "";
    return `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;
  }, [startDate, endDate]);

  // ARPU by Plan & Platform matrix
  const aovData = useMemo(() => {
    const plansSet = new Set();
    filteredData.forEach(r => plansSet.add(r.plan_category));
    const plans = [...plansSet].sort();

    const platforms = [
      'Main - Android',
      'Main - IOS',
      'Market - Android',
      'Market - IOS',
      'WAP',
      'WEB'
    ];

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

    return { plans, platforms, matrix };
  }, [filteredData]);

  const geoData = useMemo(() => {
    const geoRev = {};
    filteredData.forEach(r => {
      const geo = r.country_name || r.geo_region || 'UNKNOWN';
      geoRev[geo] = (geoRev[geo] || 0) + r.revenue;
    });
    
    return Object.entries(geoRev)
      .map(([region, rev]) => ({ region, rev }))
      .sort((a, b) => b.rev - a.rev);
  }, [filteredData]);

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

  // Pivot table builder: Categories in Columns, Period Total in Row 1, Daily Date Rows below!
  const buildPivotData = useCallback((field) => {
    const categorySet = new Set();
    const dateMap = {};

    filteredData.forEach(r => {
      const cat = r[field] || 'Unknown';
      const dStr = r.dateStr;
      categorySet.add(cat);

      if (!dateMap[dStr]) {
        dateMap[dStr] = { dateStr: dStr, totals: {}, dayTotalRev: 0, dayTotalConv: 0 };
      }
      if (!dateMap[dStr].totals[cat]) {
        dateMap[dStr].totals[cat] = { rev: 0, conv: 0 };
      }
      dateMap[dStr].totals[cat].rev += (r.revenue || 0);
      dateMap[dStr].totals[cat].conv += (r.conversion || 0);
      dateMap[dStr].dayTotalRev += (r.revenue || 0);
      dateMap[dStr].dayTotalConv += (r.conversion || 0);
    });

    const categories = [...categorySet].sort();
    const categoryGrandTotals = {};
    categories.forEach(c => categoryGrandTotals[c] = { rev: 0, conv: 0 });

    let finalGrandTotalRev = 0;
    let finalGrandTotalConv = 0;

    const dailyRows = Object.values(dateMap).sort((a, b) => b.dateStr.localeCompare(a.dateStr));

    dailyRows.forEach(row => {
      categories.forEach(c => {
        const cell = row.totals[c] || { rev: 0, conv: 0 };
        categoryGrandTotals[c].rev += cell.rev;
        categoryGrandTotals[c].conv += cell.conv;
        finalGrandTotalRev += cell.rev;
        finalGrandTotalConv += cell.conv;
      });
    });

    return {
      categories,
      dailyRows,
      categoryGrandTotals,
      finalGrandTotalRev,
      finalGrandTotalConv
    };
  }, [filteredData]);

  
  const trendChartTraces = useMemo(() => {
    if (!filteredData.length) return [];

    const dateMap = {};
    filteredData.forEach(r => {
      if (r.dateStr) dateMap[r.dateStr] = r.dateShort;
    });
    const sortedDateStrs = Object.keys(dateMap).sort();
    const dateLabels = sortedDateStrs.map(d => dateMap[d]);

    if (trendDataCut === 'Overall') {
      const revMap = {};
      filteredData.forEach(r => {
        revMap[r.dateStr] = (revMap[r.dateStr] || 0) + (r.revenue || 0);
      });
      const revValues = sortedDateStrs.map(d => revMap[d] || 0);

      return [{
        x: dateLabels,
        y: revValues,
        type: 'scatter',
        mode: 'lines+markers+text',
        name: 'Overall Revenue',
        text: revValues.map(v => formatIndianCurrency1Dec(v)),
        textposition: revValues.map((v, idx) => {
          if (idx === 0) return 'top right';
          if (idx === revValues.length - 1) return 'top left';
          return 'top center';
        }),
        cliponaxis: false,
        textfont: { family: "DM Sans, sans-serif", size: 10, color: isDark ? '#fbbf24' : '#d97706', weight: 'bold' },
        line: { color: '#f59e0b', width: 2.5, shape: 'spline' },
        fill: 'tozeroy',
        fillcolor: isDark ? 'rgba(245, 158, 11, 0.08)' : 'rgba(217, 119, 6, 0.06)',
        hovertemplate: "<b>%{x}</b><br>Overall Revenue: ₹%{y:,.2f}<extra></extra>"
      }];
    }

    const fieldMap = {
      'Platform': 'platformDisplay',
      'Channel': 'channel',
      'Txn Type': 'user_txn_type'
    };
    const fieldKey = fieldMap[trendDataCut];

    const categories = [...new Set(filteredData.map(r => r[fieldKey]))].filter(Boolean).sort();
    const CUT_COLORS = ['#f59e0b', '#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#06B6D4', '#6366F1'];
    let colorIdx = 0;

    return categories.map(cat => {
      const color = CUT_COLORS[colorIdx % CUT_COLORS.length];
      colorIdx++;

      const catRevMap = {};
      filteredData.forEach(r => {
        if (r[fieldKey] === cat) {
          catRevMap[r.dateStr] = (catRevMap[r.dateStr] || 0) + (r.revenue || 0);
        }
      });
      const catRevs = sortedDateStrs.map(d => catRevMap[d] || 0);

      return {
        x: dateLabels,
        y: catRevs,
        type: 'scatter',
        mode: 'lines+markers+text',
        name: cat,
        text: catRevs.map(v => v > 0 ? formatIndianCurrency1Dec(v) : ''),
        textposition: catRevs.map((v, idx) => {
          if (idx === 0) return 'top right';
          if (idx === catRevs.length - 1) return 'top left';
          return 'top center';
        }),
        cliponaxis: false,
        textfont: { family: "DM Sans, sans-serif", size: 9, color: color, weight: 'bold' },
        line: { color: color, width: 2, shape: 'spline' },
        marker: { size: 5, color: color },
        hovertemplate: `<b>${cat}</b><br>%{x}<br>Revenue: ₹%{y:,.2f}<extra></extra>`
      };
    });
  }, [filteredData, trendDataCut, isDark]);

  const platformPivot = useMemo(() => buildPivotData('platformDisplay'), [buildPivotData]);
  const userTypePivot = useMemo(() => buildPivotData('user_txn_type'), [buildPivotData]);
  const planPivot = useMemo(() => buildPivotData('plan_category'), [buildPivotData]);
  const channelPivot = useMemo(() => buildPivotData('channel'), [buildPivotData]);

  if (loading) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center text-warm-text dark:text-dark-text">
        <Loader2 className="h-10 w-10 animate-spin text-amber-accent" />
        <p className="mt-4 font-semibold tracking-wide">Loading Subscription Data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center p-6 text-red-500 text-center">
        <p className="text-2xl font-bold mb-4">An Error Occurred</p>
        <p className="max-w-md">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full animate-in fade-in duration-300">
      
      {/* Date Range Selector Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-warm-text dark:text-dark-text tracking-tight">Subscription Performance Report</h2>
          <p className="text-xs text-warm-muted dark:text-dark-muted font-medium mt-0.5">{dateRangeStr}</p>
        </div>

        <div className="flex items-center gap-2 self-end">
          {datePreset === "Custom range" && (
            <div className="flex items-center gap-2 mr-2">
              <input type="date" value={startDate} min={minDateLimit} max={maxDateLimit} onChange={(e) => setStartDate(e.target.value)} className="px-2 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent" />
              <span className="text-xs text-warm-muted dark:text-dark-muted">to</span>
              <input type="date" value={endDate} min={minDateLimit} max={maxDateLimit} onChange={(e) => setEndDate(e.target.value)} className="px-2 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent" />
            </div>
          )}
          <div className="relative">
            <select 
              value={datePreset} 
              onChange={(e) => setDatePreset(e.target.value)}
              className="appearance-none bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-xs font-bold rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-sm cursor-pointer"
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

      {/* 6 Equal Width Symmetrical Filters Header */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-6 p-4 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm w-full">
        
        {/* 1. Platform Filter */}
        <div ref={platformRef} className="relative flex flex-col gap-1 w-full">
          <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Platform</label>
          <button onClick={() => setPlatformOpen(!platformOpen)} className="flex items-center justify-between px-3 py-2 bg-warm-totalBg dark:bg-slate-800 rounded-lg border border-warm-border dark:border-dark-border text-xs font-semibold focus:outline-none w-full">
            <span className="truncate">{selectedPlatforms.length === allPlatformOptions.length && allPlatformOptions.length > 0 ? `All Platforms` : selectedPlatforms.length === 0 ? 'No Platforms' : `${selectedPlatforms.length} Platforms`}</span>
            <ChevronDown className="w-3.5 h-3.5 ml-1 shrink-0 text-warm-muted dark:text-dark-muted" />
          </button>
          {platformOpen && (
            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
              <div className="px-3 py-2 border-b border-warm-border dark:border-dark-border hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-bold" onClick={() => setSelectedPlatforms(selectedPlatforms.length === allPlatformOptions.length ? [] : allPlatformOptions)}>
                {selectedPlatforms.length === allPlatformOptions.length ? 'Deselect All' : 'Select All'}
              </div>
              {allPlatformOptions.map(p => (
                <label key={p} className="flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-medium">
                  <input type="checkbox" checked={selectedPlatforms.includes(p)} onChange={() => setSelectedPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])} className="rounded text-amber-accent focus:ring-amber-accent" />
                  <span className="truncate">{p}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 2. Country Name Filter */}
        <div ref={countryRef} className="relative flex flex-col gap-1 w-full">
          <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Country Name</label>
          <button onClick={() => setCountryOpen(!countryOpen)} className="flex items-center justify-between px-3 py-2 bg-warm-totalBg dark:bg-slate-800 rounded-lg border border-warm-border dark:border-dark-border text-xs font-semibold focus:outline-none w-full">
            <span className="truncate">{selectedCountries.length === allCountryOptions.length && allCountryOptions.length > 0 ? `All Countries` : selectedCountries.length === 0 ? 'No Countries' : `${selectedCountries.length} Countries`}</span>
            <ChevronDown className="w-3.5 h-3.5 ml-1 shrink-0 text-warm-muted dark:text-dark-muted" />
          </button>
          {countryOpen && (
            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
              <div className="px-3 py-2 border-b border-warm-border dark:border-dark-border hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-bold" onClick={() => setSelectedCountries(selectedCountries.length === allCountryOptions.length ? [] : allCountryOptions)}>
                {selectedCountries.length === allCountryOptions.length ? 'Deselect All' : 'Select All'}
              </div>
              {allCountryOptions.map(c => (
                <label key={c} className="flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-medium">
                  <input type="checkbox" checked={selectedCountries.includes(c)} onChange={() => setSelectedCountries(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])} className="rounded text-amber-accent focus:ring-amber-accent" />
                  <span className="truncate">{c}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 3. Channel Filter */}
        <div ref={channelRef} className="relative flex flex-col gap-1 w-full">
          <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Channel</label>
          <button onClick={() => setChannelOpen(!channelOpen)} className="flex items-center justify-between px-3 py-2 bg-warm-totalBg dark:bg-slate-800 rounded-lg border border-warm-border dark:border-dark-border text-xs font-semibold focus:outline-none w-full">
            <span className="truncate">{selectedChannels.length === allChannelOptions.length && allChannelOptions.length > 0 ? `All Channels` : selectedChannels.length === 0 ? 'No Channels' : `${selectedChannels.length} Channels`}</span>
            <ChevronDown className="w-3.5 h-3.5 ml-1 shrink-0 text-warm-muted dark:text-dark-muted" />
          </button>
          {channelOpen && (
            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
              <div className="px-3 py-2 border-b border-warm-border dark:border-dark-border hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-bold" onClick={() => setSelectedChannels(selectedChannels.length === allChannelOptions.length ? [] : allChannelOptions)}>
                {selectedChannels.length === allChannelOptions.length ? 'Deselect All' : 'Select All'}
              </div>
              {allChannelOptions.map(ch => (
                <label key={ch} className="flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-medium">
                  <input type="checkbox" checked={selectedChannels.includes(ch)} onChange={() => setSelectedChannels(prev => prev.includes(ch) ? prev.filter(x => x !== ch) : [...prev, ch])} className="rounded text-amber-accent focus:ring-amber-accent" />
                  <span className="truncate">{ch}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 4. Plan Filter */}
        <div ref={planRef} className="relative flex flex-col gap-1 w-full">
          <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Plan</label>
          <button onClick={() => setPlanOpen(!planOpen)} className="flex items-center justify-between px-3 py-2 bg-warm-totalBg dark:bg-slate-800 rounded-lg border border-warm-border dark:border-dark-border text-xs font-semibold focus:outline-none w-full">
            <span className="truncate">{selectedPlans.length === allPlanOptions.length && allPlanOptions.length > 0 ? `All Plans` : selectedPlans.length === 0 ? 'No Plans' : `${selectedPlans.length} Plans`}</span>
            <ChevronDown className="w-3.5 h-3.5 ml-1 shrink-0 text-warm-muted dark:text-dark-muted" />
          </button>
          {planOpen && (
            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
              <div className="px-3 py-2 border-b border-warm-border dark:border-dark-border hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-bold" onClick={() => setSelectedPlans(selectedPlans.length === allPlanOptions.length ? [] : allPlanOptions)}>
                {selectedPlans.length === allPlanOptions.length ? 'Deselect All' : 'Select All'}
              </div>
              {allPlanOptions.map(p => (
                <label key={p} className="flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-medium">
                  <input type="checkbox" checked={selectedPlans.includes(p)} onChange={() => setSelectedPlans(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])} className="rounded text-amber-accent focus:ring-amber-accent" />
                  <span className="truncate">{p}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 5. TXN Type Filter */}
        <div ref={txnRef} className="relative flex flex-col gap-1 w-full">
          <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">TXN Type</label>
          <button onClick={() => setTxnOpen(!txnOpen)} className="flex items-center justify-between px-3 py-2 bg-warm-totalBg dark:bg-slate-800 rounded-lg border border-warm-border dark:border-dark-border text-xs font-semibold focus:outline-none w-full">
            <span className="truncate">{selectedTxnTypes.length === allTxnOptions.length && allTxnOptions.length > 0 ? `All Txns` : selectedTxnTypes.length === 0 ? 'No Txns' : `${selectedTxnTypes.length} Txns`}</span>
            <ChevronDown className="w-3.5 h-3.5 ml-1 shrink-0 text-warm-muted dark:text-dark-muted" />
          </button>
          {txnOpen && (
            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
              <div className="px-3 py-2 border-b border-warm-border dark:border-dark-border hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-bold" onClick={() => setSelectedTxnTypes(selectedTxnTypes.length === allTxnOptions.length ? [] : allTxnOptions)}>
                {selectedTxnTypes.length === allTxnOptions.length ? 'Deselect All' : 'Select All'}
              </div>
              {allTxnOptions.map(t => (
                <label key={t} className="flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-medium">
                  <input type="checkbox" checked={selectedTxnTypes.includes(t)} onChange={() => setSelectedTxnTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])} className="rounded text-amber-accent focus:ring-amber-accent" />
                  <span className="truncate">{t}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 6. Table Metrics View Select */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Table Metrics View</label>
          <select 
            value={tableMetricMode}
            onChange={(e) => setTableMetricMode(e.target.value)}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text focus:outline-none focus:ring-1 focus:ring-amber-accent cursor-pointer w-full"
          >
            <option value="Revenue (₹)">Revenue (₹)</option>
            <option value="Conversions (#)">Conversions (#)</option>
            <option value="Combined (Revenue & Conversions)">Combined (Rev & Conv)</option>
          </select>
        </div>

      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Total Revenue</div>
          <div className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{formatIndianCurrency(metrics.totalRev)}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg: <span className="font-bold text-amber-accent">{formatIndianCurrency(metrics.dailyAvgRev)}/day</span> <br />
            <span className="text-[10px]">{dateRangeStr} ({metrics.numDays} days)</span>
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Conversions (Excl. Auto-Renewal)</div>
          <div className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{metrics.conversionsExclAuto.toLocaleString()}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg: <span className="font-bold text-amber-accent">{metrics.dailyAvgConvExcl.toFixed(0)}/day</span> <br />
            <span>Total conversions: {metrics.totalConversions.toLocaleString()}</span>
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Avg Revenue / Txn</div>
          <div className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{formatIndianCurrency(metrics.avgRevPerTxn)}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg volume: <span className="font-bold text-amber-accent">{metrics.dailyAvgTxns.toFixed(0)} txns/day</span> <br />
            <span>Across {metrics.totalTxns.toLocaleString()} transactions</span>
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Recurring Rate (New)</div>
          <div className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{(metrics.recurringRate * 100).toFixed(1)}%</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            <span className="font-bold text-amber-accent">{metrics.recurringTrueCount} recurring</span> out of {metrics.nonAutoTxnCount} non-auto_renewal txns
          </div>
        </div>
      </section>

      {/* Daily revenue trend Chart with Pill Toggle Cuts & 1 Decimal Data Labels */}
      <section className="mb-6 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text px-1">
              Daily Revenue Trend {trendDataCut !== 'Overall' ? `(${trendDataCut} Split)` : ''}
            </h3>
            <p className="text-xs text-warm-muted dark:text-dark-muted px-1 mt-0.5">
              Daily revenue trajectory for selected date range
            </p>
          </div>

          {/* Pill-like Toggle Bar for Trend Data Cuts */}
          <div className="flex items-center bg-warm-tableBg dark:bg-zinc-800 p-1 rounded-full border border-warm-border dark:border-zinc-700 shadow-sm self-start sm:self-auto">
            {['Overall', 'Platform', 'Channel', 'Txn Type'].map(cut => (
              <button
                key={cut}
                onClick={() => setTrendDataCut(cut)}
                className={`px-3 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer ${
                  trendDataCut === cut
                    ? "bg-white dark:bg-slate-700 text-amber-accent shadow-sm"
                    : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                }`}
              >
                {cut}
              </button>
            ))}
          </div>
        </div>

        {trendChartTraces.length > 0 ? (
          <Plot 
            data={trendChartTraces}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: 'rgba(0,0,0,0)',
              font: {
                family: "DM Sans, sans-serif",
                color: isDark ? '#94A3B8' : '#64748B',
                size: 10
              },
              margin: { l: 55, r: 55, t: trendDataCut !== 'Overall' ? 45 : 30, b: 45 },
              height: 380,
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
                range: [0, Math.max(...trendChartTraces.flatMap(t => t.y)) * 1.25]
              },
              legend: {
                orientation: 'h',
                y: 1.15,
                x: 0,
                font: { size: 10, color: isDark ? '#cbd5e1' : '#334155' }
              },
              showlegend: trendDataCut !== 'Overall',
              autosize: true
            }}
            config={{ displayModeBar: false, responsive: true }}
            className="w-full"
            style={{ width: "100%", height: "380px" }}
          />
        ) : (
          <div className="flex h-[250px] items-center justify-center text-base font-semibold text-warm-muted dark:text-dark-muted">
            No transaction data available for the selected date range.
          </div>
        )}
      </section>

      {/* Tables & Visualizations in requested exact order:
          1. Platform-wise Revenue & Conversions
          2. User-type-wise Revenue & Conversions
          3. World Map (100% width)
          4. Plan-wise Revenue & Conversions
          5. ARPU by Plan & Platform Table
      */}
      <section className="flex flex-col gap-6">
        <PivotTable 
          pivotData={platformPivot} 
          title="Platform-wise Revenue & Conversions"
          metricMode={tableMetricMode}
          isDark={isDark}
        />
        <PivotTable 
          pivotData={userTypePivot} 
          title="User-type-wise Revenue & Conversions"
          metricMode={tableMetricMode}
          isDark={isDark}
        />
        
        {/* World Map below User-type table */}
        <GeoDistributionChart 
          geoData={geoData} 
          isDark={isDark}
        />

        {/* Channel-wise Revenue & Conversions Table */}
        <PivotTable 
          pivotData={channelPivot} 
          title="Channel-wise Revenue & Conversions"
          metricMode={tableMetricMode}
          isDark={isDark}
        />

        <PivotTable 
          pivotData={planPivot} 
          title="Plan-wise Revenue & Conversions"
          metricMode={tableMetricMode}
          isDark={isDark}
        />

        <AovMatrixTable 
          aovData={aovData} 
          isDark={isDark}
        />
      </section>
    </div>
  );
}

function PivotTable({ pivotData, title, metricMode, isDark }) {
  const { categories, dailyRows, categoryGrandTotals, finalGrandTotalRev, finalGrandTotalConv } = pivotData;

  const maxMetricValue = useMemo(() => {
    if (!dailyRows || !categories) return 0;
    let max = 0;
    dailyRows.forEach(row => {
      categories.forEach(cat => {
        const cell = row.totals[cat];
        if (!cell) return;
        const val = metricMode === "Conversions (#)" ? cell.conv : cell.rev;
        if (val > max) max = val;
      });
    });
    return max;
  }, [dailyRows, categories, metricMode]);

  if (!categories || categories.length === 0) {
    return (
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-4">{title}</h3>
        <p className="text-sm text-warm-muted dark:text-dark-muted">No data available for the selection.</p>
      </div>
    );
  }

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

  return (
    <div>
      <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">{title}</h3>
      <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-xl custom-scrollbar overflow-x-auto max-h-[520px] shadow-sm">
        <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-20 bg-warm-tableBg dark:bg-[#1E293B]">
            <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
              <th className="p-3 bg-warm-tableBg dark:bg-[#1E293B] whitespace-nowrap">Date</th>
              {categories.map(cat => (
                <th key={cat} className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B] text-right">{cat}</th>
              ))}
              <th className="p-3 bg-warm-tableBg dark:bg-[#1E293B] text-right whitespace-nowrap">Total</th>
            </tr>
            <tr className="period-total-row font-bold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-accent shadow-sm">
              <td className="p-3 whitespace-nowrap bg-[#FEF3C7] dark:bg-[#1E293B] font-black text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
              {categories.map(cat => (
                <td key={cat} className="p-3 text-right bg-[#FEF3C7] dark:bg-[#1E293B] font-extrabold text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>
                  {getMetricCell(categoryGrandTotals[cat].rev, categoryGrandTotals[cat].conv)}
                </td>
              ))}
              <td className="p-3 text-right bg-[#FEF3C7] dark:bg-[#1E293B] font-black text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>
                {getMetricCell(finalGrandTotalRev, finalGrandTotalConv)}
              </td>
            </tr>
          </thead>
          <tbody>
            {dailyRows.map(row => (
              <tr 
                key={row.dateStr} 
                className="border-b border-warm-border/50 dark:border-zinc-800/60 hover:bg-black/5 dark:hover:bg-white/5 font-medium text-warm-text dark:text-dark-text transition-colors"
              >
                <td className="p-3 text-warm-muted dark:text-dark-muted whitespace-nowrap font-semibold">{row.dateStr}</td>
                {categories.map(cat => {
                  const cell = row.totals[cat];
                  const r = cell ? cell.rev : 0;
                  const c = cell ? cell.conv : 0;
                  
                  const val = metricMode === "Conversions (#)" ? c : r;
                  const intensity = maxMetricValue > 0 && val > 0 ? val / maxMetricValue : 0;
                  const heatmapStyle = intensity > 0 ? {
                    backgroundColor: isDark 
                      ? `rgba(245, 158, 11, ${Math.min(0.4, intensity * 0.35)})` 
                      : `rgba(217, 119, 6, ${Math.min(0.3, intensity * 0.22)})`
                  } : {};

                  return (
                    <td key={cat} className="p-3 text-right font-medium transition-colors" style={heatmapStyle}>
                      {getMetricCell(r, c)}
                    </td>
                  );
                })}
                <td className="p-3 text-right font-bold">
                  {getMetricCell(row.dayTotalRev, row.dayTotalConv)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}




function RenewalsAndRecurring({ isDark }) {
  // ----------------------------------------------------
  // RENEWALS STATE & LOGIC (TOP HALF)
  // ----------------------------------------------------
  const [renewalsData, setRenewalsData] = useState([]);
  const [renewalsLoading, setRenewalsLoading] = useState(true);
  const [renewalsError, setRenewalsError] = useState(null);

  const [renDatePreset, setRenDatePreset] = useState("Last 30 days");
  const [renStartDate, setRenStartDate] = useState("");
  const [renEndDate, setRenEndDate] = useState("");
  const [renViewLevel, setRenViewLevel] = useState("Day");

  const [renComparePlatforms, setRenComparePlatforms] = useState([]);
  const [renComparePlans, setRenComparePlans] = useState([]);
  const [showRenPlatDropdown, setShowRenPlatDropdown] = useState(false);
  const [showRenPlanDropdown, setShowRenPlanDropdown] = useState(false);

  const [expandedRenPlatforms, setExpandedRenPlatforms] = useState({});
  const [expandedRenPlans, setExpandedRenPlans] = useState({});

  useEffect(() => {
    async function fetchRenewals() {
      setRenewalsLoading(true);
      setRenewalsError(null);
      try {
        const results = await fetchDatasetCached('renewals', DATASET_URLS.renewals);
        const processed = results.data.map(row => {
          const cleanRow = {};
          Object.keys(row).forEach(k => cleanRow[k.trim()] = row[k]);
          
          const dParts = String(cleanRow['renew_date'] || '').split('/');
          let dateStr = '';
          if (dParts.length === 3) {
            const y = dParts[2];
            const m = dParts[0].padStart(2, '0');
            const d = dParts[1].padStart(2, '0');
            dateStr = `${y}-${m}-${d}`;
          }

          const platformCode = String(cleanRow['platform'] || '').trim();
          const platformDisplay = normalizePlatformName(platformCode);

          return {
            renew_month: String(cleanRow['renew_month'] || '').trim(),
            renew_date: dateStr,
            dateShort: dateStr ? new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) : '',
            platform: platformDisplay,
            plan_category: String(cleanRow['plan_category'] || 'UNKNOWN').trim().toUpperCase(),
            renewal_due: parseInt(cleanRow['renewal_due'], 10) || 0,
            renewed: parseInt(cleanRow['renewed'], 10) || 0
          };
        }).filter(r => r.renew_month || r.renew_date);

        setRenewalsData(processed);
        setRenewalsLoading(false);
      } catch (err) {
        console.error("Error fetching renewals:", err);
        setRenewalsError("Could not fetch renewal sheet data.");
        setRenewalsLoading(false);
      }
    }
    fetchRenewals();
  }, []);

  useEffect(() => {
    if (renDatePreset === "Custom range") return;
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (renDatePreset === "Last 30 days") {
      start.setDate(now.getDate() - 30);
    } else if (renDatePreset === "Last 7 days") {
      start.setDate(now.getDate() - 7);
    } else if (renDatePreset === "Yesterday") {
      start.setDate(now.getDate() - 1);
      end.setDate(now.getDate() - 1);
    } else if (renDatePreset === "This month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (renDatePreset === "Last month") {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (renDatePreset === "Last 90 days") {
      start.setDate(now.getDate() - 90);
    } else if (renDatePreset === "All time") {
      start = new Date(2000, 0, 1);
    }
    
    setRenStartDate(start.toISOString().split('T')[0]);
    setRenEndDate(end.toISOString().split('T')[0]);
  }, [renDatePreset]);

  const filteredRenewalsData = useMemo(() => {
    if (!renewalsData.length) return [];
    return renewalsData.filter(r => {
      if (!renStartDate || !renEndDate) return true;
      if (r.renew_date) {
        return r.renew_date >= renStartDate && r.renew_date <= renEndDate;
      }
      return true;
    });
  }, [renewalsData, renStartDate, renEndDate]);

  const { renTotalDue, renTotalRenewed, renOverallRate } = useMemo(() => {
    let due = 0, ren = 0;
    filteredRenewalsData.forEach(r => {
      due += r.renewal_due;
      ren += r.renewed;
    });
    const rate = due > 0 ? (ren / due) * 100 : 0;
    return { renTotalDue: due, renTotalRenewed: ren, renOverallRate: rate };
  }, [filteredRenewalsData]);

  const renTrendData = useMemo(() => {
    const grouped = {};
    filteredRenewalsData.forEach(r => {
      const key = renViewLevel === "Day" ? (r.renew_date || r.renew_month) : r.renew_month;
      if (!key) return;
      if (!grouped[key]) grouped[key] = { label: key, due: 0, renewed: 0 };
      grouped[key].due += r.renewal_due;
      grouped[key].renewed += r.renewed;
    });

    return Object.values(grouped)
      .map(g => {
        let labelShort = g.label;
        if (renViewLevel === "Day" && g.label && g.label.includes("-")) {
          const parts = g.label.split("-");
          if (parts.length === 3) {
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            labelShort = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }
        }
        return {
          ...g,
          labelShort,
          rate: g.due > 0 ? (g.renewed / g.due) * 100 : 0
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredRenewalsData, renViewLevel]);

  const availableRenPlatforms = useMemo(() => {
    return [...new Set(renewalsData.map(r => r.platform))].filter(Boolean).sort();
  }, [renewalsData]);

  const availableRenPlans = useMemo(() => {
    return [...new Set(renewalsData.map(r => r.plan_category))].filter(Boolean).sort();
  }, [renewalsData]);

  const renPlatformData = useMemo(() => {
    const grouped = {};
    filteredRenewalsData.forEach(r => {
      const p = r.platform || 'Unknown';
      if (!grouped[p]) grouped[p] = { platform: p, due: 0, renewed: 0, dailyMap: {} };
      grouped[p].due += r.renewal_due;
      grouped[p].renewed += r.renewed;

      const dateKey = r.renew_date || r.renew_month;
      if (dateKey) {
        if (!grouped[p].dailyMap[dateKey]) grouped[p].dailyMap[dateKey] = { due: 0, renewed: 0 };
        grouped[p].dailyMap[dateKey].due += r.renewal_due;
        grouped[p].dailyMap[dateKey].renewed += r.renewed;
      }
    });

    return Object.values(grouped)
      .map(g => {
        const dailyRows = Object.keys(g.dailyMap).sort().map(d => {
          let dLabel = d;
          if (d.includes("-")) {
            const parts = d.split("-");
            if (parts.length === 3) {
              const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
              dLabel = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            }
          }
          const due = g.dailyMap[d].due;
          const renewed = g.dailyMap[d].renewed;
          return {
            dateKey: d,
            dateLabel: dLabel,
            due,
            renewed,
            rate: due > 0 ? (renewed / due) * 100 : 0
          };
        });

        return {
          ...g,
          rate: g.due > 0 ? (g.renewed / g.due) * 100 : 0,
          dailyRows
        };
      })
      .sort((a, b) => b.due - a.due);
  }, [filteredRenewalsData]);

  const renPlanData = useMemo(() => {
    const grouped = {};
    filteredRenewalsData.forEach(r => {
      const pl = r.plan_category || 'Unknown';
      if (!grouped[pl]) grouped[pl] = { plan: pl, due: 0, renewed: 0, dailyMap: {} };
      grouped[pl].due += r.renewal_due;
      grouped[pl].renewed += r.renewed;

      const dateKey = r.renew_date || r.renew_month;
      if (dateKey) {
        if (!grouped[pl].dailyMap[dateKey]) grouped[pl].dailyMap[dateKey] = { due: 0, renewed: 0 };
        grouped[pl].dailyMap[dateKey].due += r.renewal_due;
        grouped[pl].dailyMap[dateKey].renewed += r.renewed;
      }
    });

    return Object.values(grouped)
      .map(g => {
        const dailyRows = Object.keys(g.dailyMap).sort().map(d => {
          let dLabel = d;
          if (d.includes("-")) {
            const parts = d.split("-");
            if (parts.length === 3) {
              const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
              dLabel = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            }
          }
          const due = g.dailyMap[d].due;
          const renewed = g.dailyMap[d].renewed;
          return {
            dateKey: d,
            dateLabel: dLabel,
            due,
            renewed,
            rate: due > 0 ? (renewed / due) * 100 : 0
          };
        });

        return {
          ...g,
          rate: g.due > 0 ? (g.renewed / g.due) * 100 : 0,
          dailyRows
        };
      })
      .sort((a, b) => b.due - a.due);
  }, [filteredRenewalsData]);

  const renChartTraces = useMemo(() => {
    if (!renTrendData.length) return [];

    const dateKeys = renTrendData.map(d => d.label);
    const dateLabels = renTrendData.map(d => d.labelShort);

    const traces = [
      {
        x: dateLabels,
        y: renTrendData.map(d => d.rate),
        type: 'scatter',
        mode: 'lines+markers+text',
        name: 'Overall Renewal Rate',
        text: renTrendData.map(d => `${d.rate.toFixed(1)}%`),
        textposition: 'top center',
        textfont: { size: 10, color: isDark ? '#fbbf24' : '#d97706', weight: 'bold' },
        line: { color: '#f59e0b', width: 3, shape: 'spline' },
        marker: { size: 6, color: '#f59e0b' },
        fill: 'tozeroy',
        fillcolor: isDark ? 'rgba(245, 158, 11, 0.08)' : 'rgba(217, 119, 6, 0.06)',
        hovertemplate: "<b>Overall</b><br>%{x}<br>Renewal Rate: <b>%{y:.2f}%</b><extra></extra>>"
      }
    ];

    const COMPARISON_COLORS = ['#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#06B6D4', '#EAB308', '#6366F1'];
    let colorIdx = 0;

    renComparePlatforms.forEach(plat => {
      const platRates = dateKeys.map(k => {
        let due = 0, ren = 0;
        filteredRenewalsData.forEach(r => {
          const rKey = renViewLevel === "Day" ? (r.renew_date || r.renew_month) : r.renew_month;
          if (rKey === k && r.platform === plat) {
            due += r.renewal_due;
            ren += r.renewed;
          }
        });
        return due > 0 ? (ren / due) * 100 : 0;
      });

      const color = COMPARISON_COLORS[colorIdx % COMPARISON_COLORS.length];
      colorIdx++;

      traces.push({
        x: dateLabels,
        y: platRates,
        type: 'scatter',
        mode: 'lines+markers+text',
        name: `Platform: ${plat}`,
        text: platRates.map(r => `${r.toFixed(1)}%`),
        textposition: 'top center',
        textfont: { size: 9, color: color, weight: 'bold' },
        line: { color: color, width: 2, dash: 'dot', shape: 'spline' },
        marker: { size: 5, color: color },
        hovertemplate: `<b>${plat}</b><br>%{x}<br>Renewal Rate: <b>%{y:.2f}%</b><extra></extra>>`
      });
    });

    renComparePlans.forEach(plan => {
      const planRates = dateKeys.map(k => {
        let due = 0, ren = 0;
        filteredRenewalsData.forEach(r => {
          const rKey = renViewLevel === "Day" ? (r.renew_date || r.renew_month) : r.renew_month;
          if (rKey === k && r.plan_category === plan) {
            due += r.renewal_due;
            ren += r.renewed;
          }
        });
        return due > 0 ? (ren / due) * 100 : 0;
      });

      const color = COMPARISON_COLORS[colorIdx % COMPARISON_COLORS.length];
      colorIdx++;

      traces.push({
        x: dateLabels,
        y: planRates,
        type: 'scatter',
        mode: 'lines+markers+text',
        name: `Plan: ${plan}`,
        text: planRates.map(r => `${r.toFixed(1)}%`),
        textposition: 'top center',
        textfont: { size: 9, color: color, weight: 'bold' },
        line: { color: color, width: 2, dash: 'dash', shape: 'spline' },
        marker: { size: 5, color: color },
        hovertemplate: `<b>${plan}</b><br>%{x}<br>Renewal Rate: <b>%{y:.2f}%</b><extra></extra>>`
      });
    });

    return traces;
  }, [renTrendData, renComparePlatforms, renComparePlans, filteredRenewalsData, renViewLevel, isDark]);

  // ----------------------------------------------------
  // RECURRING STATE & LOGIC (BOTTOM HALF)
  // ----------------------------------------------------
  const [recurringData, setRecurringData] = useState([]);
  const [recurringLoading, setRecurringLoading] = useState(true);

  const [recDatePreset, setRecDatePreset] = useState("Last 30 days");
  const [recStartDate, setRecStartDate] = useState("");
  const [recEndDate, setRecEndDate] = useState("");
  const [recViewLevel, setRecViewLevel] = useState("Day");
  const [selectedMarketingTeam, setSelectedMarketingTeam] = useState("All Marketing Teams");

  // Comparison State for Recurring Daily Trend
  const [recCompareTeams, setRecCompareTeams] = useState([]);
  const [recComparePlatforms, setRecComparePlatforms] = useState([]);
  const [recComparePlans, setRecComparePlans] = useState([]);
  const [showRecTeamDropdown, setShowRecTeamDropdown] = useState(false);
  const [showRecPlatDropdown, setShowRecPlatDropdown] = useState(false);
  const [showRecPlanDropdown, setShowRecPlanDropdown] = useState(false);

  // Accordion Expand State for Recurring Tables
  const [expandedRecPlatforms, setExpandedRecPlatforms] = useState({});
  const [expandedRecPlans, setExpandedRecPlans] = useState({});
  const [expandedRecTeams, setExpandedRecTeams] = useState({});

  useEffect(() => {
    async function fetchRecurring() {
      setRecurringLoading(true);
      try {
        const url = "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=recurring_raw";
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load recurring data");
        const text = await res.text();

        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const processed = results.data.map(row => {
              const cleanRow = {};
              Object.keys(row).forEach(k => cleanRow[k.trim()] = row[k]);

              const dParts = String(cleanRow['txn_date'] || '').split('/');
              let dateStr = '';
              if (dParts.length === 3) {
                const y = dParts[2];
                const m = dParts[0].padStart(2, '0');
                const d = dParts[1].padStart(2, '0');
                dateStr = `${y}-${m}-${d}`;
              }

              const platformCode = String(cleanRow['platform'] || '').trim();
              const platformDisplay = normalizePlatformName(platformCode);
              const autoRenewVal = String(cleanRow['auto_renew'] || '').trim().toLowerCase() === 'true';

              return {
                txn_date: dateStr,
                txn_month: dateStr ? dateStr.substring(0, 7) : '',
                dateShort: dateStr ? new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) : '',
                platform: platformDisplay,
                plan_category: String(cleanRow['plan_category'] || 'UNKNOWN').trim().toUpperCase(),
                auto_renew: autoRenewVal,
                marketing_team: String(cleanRow['marketing_team'] || 'Others').trim(),
                conversion: parseInt(cleanRow['conversion'], 10) || 1,
                revenue: parseFloat(cleanRow['revenue_above_rs_6_txn']) || 0.0
              };
            }).filter(r => r.txn_date);

            setRecurringData(processed);
            setRecurringLoading(false);
          }
        });
      } catch (err) {
        console.error("Error fetching recurring data:", err);
        setRecurringLoading(false);
      }
    }
    fetchRecurring();
  }, []);

  useEffect(() => {
    if (recDatePreset === "Custom range") return;
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (recDatePreset === "Last 30 days") {
      start.setDate(now.getDate() - 30);
    } else if (recDatePreset === "Last 7 days") {
      start.setDate(now.getDate() - 7);
    } else if (recDatePreset === "Yesterday") {
      start.setDate(now.getDate() - 1);
      end.setDate(now.getDate() - 1);
    } else if (recDatePreset === "This month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (recDatePreset === "Last month") {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (recDatePreset === "Last 90 days") {
      start.setDate(now.getDate() - 90);
    } else if (recDatePreset === "All time") {
      start = new Date(2000, 0, 1);
    }
    
    setRecStartDate(start.toISOString().split('T')[0]);
    setRecEndDate(end.toISOString().split('T')[0]);
  }, [recDatePreset]);

  const allMarketingTeams = useMemo(() => {
    const teams = [...new Set(recurringData.map(r => r.marketing_team))].filter(Boolean).sort();
    return ["All Marketing Teams", ...teams];
  }, [recurringData]);

  const availableRecPlatforms = useMemo(() => {
    return [...new Set(recurringData.map(r => r.platform))].filter(Boolean).sort();
  }, [recurringData]);

  const availableRecPlans = useMemo(() => {
    return [...new Set(recurringData.map(r => r.plan_category))].filter(Boolean).sort();
  }, [recurringData]);

  const filteredRecurringData = useMemo(() => {
    if (!recurringData.length) return [];
    return recurringData.filter(r => {
      const matchDate = !recStartDate || !recEndDate || (r.txn_date >= recStartDate && r.txn_date <= recEndDate);
      const matchTeam = selectedMarketingTeam === "All Marketing Teams" || r.marketing_team === selectedMarketingTeam;
      return matchDate && matchTeam;
    });
  }, [recurringData, recStartDate, recEndDate, selectedMarketingTeam]);

  const { recTotalConv, recRecurringConv, recNonRecurringConv, recRecurringShare, recRecurringRev, recTotalRev } = useMemo(() => {
    let totC = 0, recC = 0, nonRecC = 0, recR = 0, totR = 0;
    filteredRecurringData.forEach(r => {
      totC += r.conversion;
      totR += r.revenue;
      if (r.auto_renew) {
        recC += r.conversion;
        recR += r.revenue;
      } else {
        nonRecC += r.conversion;
      }
    });
    const share = totC > 0 ? (recC / totC) * 100 : 0;
    return { recTotalConv: totC, recRecurringConv: recC, recNonRecurringConv: nonRecC, recRecurringShare: share, recRecurringRev: recR, recTotalRev: totR };
  }, [filteredRecurringData]);

  // Recurring Trend Data (Daily or Monthly Recurring %)
  const recTrendData = useMemo(() => {
    const map = {};
    filteredRecurringData.forEach(r => {
      const key = recViewLevel === "Day" ? r.txn_date : (r.txn_month || (r.txn_date ? r.txn_date.substring(0, 7) : ''));
      if (!key) return;
      if (!map[key]) map[key] = { key, total: 0, rec: 0 };
      map[key].total += r.conversion;
      if (r.auto_renew) map[key].rec += r.conversion;
    });

    return Object.keys(map).sort().map(k => {
      let labelShort = k;
      if (recViewLevel === "Day" && k.includes("-")) {
        const parts = k.split("-");
        if (parts.length === 3) {
          const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
          labelShort = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        }
      } else if (recViewLevel === "Month" && k.includes("-")) {
        const parts = k.split("-");
        if (parts.length >= 2) {
          const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
          labelShort = dateObj.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        }
      }
      const total = map[k].total;
      const rec = map[k].rec;
      const rate = total > 0 ? (rec / total) * 100 : 0;
      return { key: k, labelShort, total, rec, rate };
    });
  }, [filteredRecurringData, recViewLevel]);

  // Recurring Chart Traces with Comparisons (Marketing Team, Platform, Plan)
  const recChartTraces = useMemo(() => {
    if (!recTrendData.length) return [];

    const dateKeys = recTrendData.map(d => d.key);
    const dateLabels = recTrendData.map(d => d.labelShort);

    const traces = [
      {
        x: dateLabels,
        y: recTrendData.map(d => d.rate),
        type: 'scatter',
        mode: 'lines+markers+text',
        name: 'Overall Recurring %',
        text: recTrendData.map(d => `${d.rate.toFixed(1)}%`),
        textposition: 'top center',
        textfont: { size: 10, color: isDark ? '#fbbf24' : '#d97706', weight: 'bold' },
        line: { color: '#f59e0b', width: 3, shape: 'spline' },
        marker: { size: 6, color: '#f59e0b' },
        fill: 'tozeroy',
        fillcolor: isDark ? 'rgba(245, 158, 11, 0.08)' : 'rgba(217, 119, 6, 0.06)',
        hovertemplate: "<b>Overall Recurring</b><br>%{x}<br>Recurring Share: <b>%{y:.2f}%</b><extra></extra>>"
      }
    ];

    const COMPARISON_COLORS = ['#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#06B6D4', '#EAB308', '#6366F1'];
    let colorIdx = 0;

    // 1. Marketing Team Comparisons
    recCompareTeams.forEach(team => {
      const rates = dateKeys.map(k => {
        let tot = 0, rec = 0;
        filteredRecurringData.forEach(r => {
          const rKey = recViewLevel === "Day" ? r.txn_date : (r.txn_month || (r.txn_date ? r.txn_date.substring(0, 7) : ''));
          if (rKey === k && r.marketing_team === team) {
            tot += r.conversion;
            if (r.auto_renew) rec += r.conversion;
          }
        });
        return tot > 0 ? (rec / tot) * 100 : 0;
      });

      const color = COMPARISON_COLORS[colorIdx % COMPARISON_COLORS.length];
      colorIdx++;

      traces.push({
        x: dateLabels,
        y: rates,
        type: 'scatter',
        mode: 'lines+markers+text',
        name: `Team: ${team}`,
        text: rates.map(r => `${r.toFixed(1)}%`),
        textposition: 'top center',
        textfont: { size: 9, color: color, weight: 'bold' },
        line: { color: color, width: 2, dash: 'dot', shape: 'spline' },
        marker: { size: 5, color: color },
        hovertemplate: `<b>${team}</b><br>%{x}<br>Recurring Share: <b>%{y:.2f}%</b><extra></extra>`
      });
    });

    // 2. Platform Comparisons
    recComparePlatforms.forEach(plat => {
      const rates = dateKeys.map(k => {
        let tot = 0, rec = 0;
        filteredRecurringData.forEach(r => {
          const rKey = recViewLevel === "Day" ? r.txn_date : (r.txn_month || (r.txn_date ? r.txn_date.substring(0, 7) : ''));
          if (rKey === k && r.platform === plat) {
            tot += r.conversion;
            if (r.auto_renew) rec += r.conversion;
          }
        });
        return tot > 0 ? (rec / tot) * 100 : 0;
      });

      const color = COMPARISON_COLORS[colorIdx % COMPARISON_COLORS.length];
      colorIdx++;

      traces.push({
        x: dateLabels,
        y: rates,
        type: 'scatter',
        mode: 'lines+markers+text',
        name: `Platform: ${plat}`,
        text: rates.map(r => `${r.toFixed(1)}%`),
        textposition: 'top center',
        textfont: { size: 9, color: color, weight: 'bold' },
        line: { color: color, width: 2, dash: 'dash', shape: 'spline' },
        marker: { size: 5, color: color },
        hovertemplate: `<b>${plat}</b><br>%{x}<br>Recurring Share: <b>%{y:.2f}%</b><extra></extra>`
      });
    });

    // 3. Plan Comparisons
    recComparePlans.forEach(plan => {
      const rates = dateKeys.map(k => {
        let tot = 0, rec = 0;
        filteredRecurringData.forEach(r => {
          const rKey = recViewLevel === "Day" ? r.txn_date : (r.txn_month || (r.txn_date ? r.txn_date.substring(0, 7) : ''));
          if (rKey === k && r.plan_category === plan) {
            tot += r.conversion;
            if (r.auto_renew) rec += r.conversion;
          }
        });
        return tot > 0 ? (rec / tot) * 100 : 0;
      });

      const color = COMPARISON_COLORS[colorIdx % COMPARISON_COLORS.length];
      colorIdx++;

      traces.push({
        x: dateLabels,
        y: rates,
        type: 'scatter',
        mode: 'lines+markers+text',
        name: `Plan: ${plan}`,
        text: rates.map(r => `${r.toFixed(1)}%`),
        textposition: 'top center',
        textfont: { size: 9, color: color, weight: 'bold' },
        line: { color: color, width: 2, dash: 'longdash', shape: 'spline' },
        marker: { size: 5, color: color },
        hovertemplate: `<b>${plan}</b><br>%{x}<br>Recurring Share: <b>%{y:.2f}%</b><extra></extra>`
      });
    });

    return traces;
  }, [recTrendData, recCompareTeams, recComparePlatforms, recComparePlans, filteredRecurringData, recViewLevel, isDark]);

  // Aggregations for Platform, Plan, and Marketing Team with Daily Breakdown
  const recPlatformData = useMemo(() => {
    const map = {};
    filteredRecurringData.forEach(r => {
      const p = r.platform;
      if (!map[p]) map[p] = { platform: p, total: 0, rec: 0, nonRec: 0, recRev: 0, dailyMap: {} };
      map[p].total += r.conversion;
      if (r.auto_renew) {
        map[p].rec += r.conversion;
        map[p].recRev += r.revenue;
      } else {
        map[p].nonRec += r.conversion;
      }

      const d = r.txn_date;
      if (d) {
        if (!map[p].dailyMap[d]) map[p].dailyMap[d] = { total: 0, rec: 0, nonRec: 0, recRev: 0 };
        map[p].dailyMap[d].total += r.conversion;
        if (r.auto_renew) {
          map[p].dailyMap[d].rec += r.conversion;
          map[p].dailyMap[d].recRev += r.revenue;
        } else {
          map[p].dailyMap[d].nonRec += r.conversion;
        }
      }
    });

    return Object.values(map)
      .map(m => {
        const dailyRows = Object.keys(m.dailyMap).sort().map(d => {
          let dLabel = d;
          if (d.includes("-")) {
            const parts = d.split("-");
            if (parts.length === 3) {
              const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
              dLabel = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            }
          }
          const tot = m.dailyMap[d].total;
          const rec = m.dailyMap[d].rec;
          const nonRec = m.dailyMap[d].nonRec;
          const recRev = m.dailyMap[d].recRev;
          return {
            dateKey: d,
            dateLabel: dLabel,
            total: tot,
            rec,
            nonRec,
            share: tot > 0 ? (rec / tot) * 100 : 0,
            recRev
          };
        });

        return {
          ...m,
          share: m.total > 0 ? (m.rec / m.total) * 100 : 0,
          dailyRows
        };
      })
      .sort((a, b) => b.rec - a.rec);
  }, [filteredRecurringData]);

  const recPlanData = useMemo(() => {
    const map = {};
    filteredRecurringData.forEach(r => {
      const pl = r.plan_category;
      if (!map[pl]) map[pl] = { plan: pl, total: 0, rec: 0, nonRec: 0, recRev: 0, dailyMap: {} };
      map[pl].total += r.conversion;
      if (r.auto_renew) {
        map[pl].rec += r.conversion;
        map[pl].recRev += r.revenue;
      } else {
        map[pl].nonRec += r.conversion;
      }

      const d = r.txn_date;
      if (d) {
        if (!map[pl].dailyMap[d]) map[pl].dailyMap[d] = { total: 0, rec: 0, nonRec: 0, recRev: 0 };
        map[pl].dailyMap[d].total += r.conversion;
        if (r.auto_renew) {
          map[pl].dailyMap[d].rec += r.conversion;
          map[pl].dailyMap[d].recRev += r.revenue;
        } else {
          map[pl].dailyMap[d].nonRec += r.conversion;
        }
      }
    });

    return Object.values(map)
      .map(m => {
        const dailyRows = Object.keys(m.dailyMap).sort().map(d => {
          let dLabel = d;
          if (d.includes("-")) {
            const parts = d.split("-");
            if (parts.length === 3) {
              const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
              dLabel = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            }
          }
          const tot = m.dailyMap[d].total;
          const rec = m.dailyMap[d].rec;
          const nonRec = m.dailyMap[d].nonRec;
          const recRev = m.dailyMap[d].recRev;
          return {
            dateKey: d,
            dateLabel: dLabel,
            total: tot,
            rec,
            nonRec,
            share: tot > 0 ? (rec / tot) * 100 : 0,
            recRev
          };
        });

        return {
          ...m,
          share: m.total > 0 ? (m.rec / m.total) * 100 : 0,
          dailyRows
        };
      })
      .sort((a, b) => b.rec - a.rec);
  }, [filteredRecurringData]);

  const recTeamData = useMemo(() => {
    const map = {};
    filteredRecurringData.forEach(r => {
      const tm = r.marketing_team;
      if (!map[tm]) map[tm] = { team: tm, total: 0, rec: 0, nonRec: 0, recRev: 0, dailyMap: {} };
      map[tm].total += r.conversion;
      if (r.auto_renew) {
        map[tm].rec += r.conversion;
        map[tm].recRev += r.revenue;
      } else {
        map[tm].nonRec += r.conversion;
      }

      const d = r.txn_date;
      if (d) {
        if (!map[tm].dailyMap[d]) map[tm].dailyMap[d] = { total: 0, rec: 0, nonRec: 0, recRev: 0 };
        map[tm].dailyMap[d].total += r.conversion;
        if (r.auto_renew) {
          map[tm].dailyMap[d].rec += r.conversion;
          map[tm].dailyMap[d].recRev += r.revenue;
        } else {
          map[tm].dailyMap[d].nonRec += r.conversion;
        }
      }
    });

    return Object.values(map)
      .map(m => {
        const dailyRows = Object.keys(m.dailyMap).sort().map(d => {
          let dLabel = d;
          if (d.includes("-")) {
            const parts = d.split("-");
            if (parts.length === 3) {
              const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
              dLabel = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            }
          }
          const tot = m.dailyMap[d].total;
          const rec = m.dailyMap[d].rec;
          const nonRec = m.dailyMap[d].nonRec;
          const recRev = m.dailyMap[d].recRev;
          return {
            dateKey: d,
            dateLabel: dLabel,
            total: tot,
            rec,
            nonRec,
            share: tot > 0 ? (rec / tot) * 100 : 0,
            recRev
          };
        });

        return {
          ...m,
          share: m.total > 0 ? (m.rec / m.total) * 100 : 0,
          dailyRows
        };
      })
      .sort((a, b) => b.rec - a.rec);
  }, [filteredRecurringData]);

  if (renewalsLoading || recurringLoading) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center text-warm-text dark:text-dark-text">
        <Loader2 className="h-10 w-10 animate-spin text-amber-accent" />
        <p className="mt-4 font-semibold tracking-wide">Loading Renewals & Recurring Data...</p>
      </div>
    );
  }

  return (
    <div className="w-full animate-in fade-in duration-300">
      {/* ======================================================== */}
      {/* TOP HALF: RENEWALS DASHBOARD */}
      {/* ======================================================== */}
      <section className="mb-12">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-warm-border dark:border-dark-border pb-4">
          <div>
            <h2 className="text-xl font-bold text-warm-text dark:text-dark-text tracking-tight">Subscription Renewals Dashboard</h2>
            <p className="text-xs text-warm-muted dark:text-dark-muted font-medium mt-0.5">Tracking Renewal Due vs Renewed Performance</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-end">
            <div className="flex items-center bg-warm-tableBg dark:bg-zinc-800 p-1 rounded-lg border border-warm-border dark:border-zinc-700">
              <button
                onClick={() => setRenViewLevel("Day")}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  renViewLevel === "Day"
                    ? "bg-white dark:bg-slate-700 text-amber-accent shadow-sm"
                    : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                }`}
              >
                Day Level View
              </button>
              <button
                onClick={() => setRenViewLevel("Month")}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  renViewLevel === "Month"
                    ? "bg-white dark:bg-slate-700 text-amber-accent shadow-sm"
                    : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                }`}
              >
                Month Level View
              </button>
            </div>

            {renDatePreset === "Custom range" && (
              <div className="flex items-center gap-2">
                <input type="date" value={renStartDate} onChange={(e) => setRenStartDate(e.target.value)} className="px-2 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent" />
                <span className="text-xs text-warm-muted dark:text-dark-muted">to</span>
                <input type="date" value={renEndDate} onChange={(e) => setRenEndDate(e.target.value)} className="px-2 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent" />
              </div>
            )}
            <select 
              value={renDatePreset} 
              onChange={(e) => setRenDatePreset(e.target.value)}
              className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-xs font-bold rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-sm cursor-pointer"
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
          </div>
        </div>

        {/* Renewals KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
            <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Total Renewal Due</div>
            <div className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{renTotalDue.toLocaleString()}</div>
            <p className="text-xs text-warm-muted dark:text-dark-muted mt-2">Subscriptions up for renewal</p>
          </div>

          <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
            <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Total Renewed</div>
            <div className="text-3xl font-black text-amber-accent tracking-tight">{renTotalRenewed.toLocaleString()}</div>
            <p className="text-xs text-warm-muted dark:text-dark-muted mt-2">Successfully renewed</p>
          </div>

          <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
            <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Overall Renewal Rate</div>
            <div className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{renOverallRate.toFixed(1)}%</div>
            <p className="text-xs text-warm-muted dark:text-dark-muted mt-2">(Renewed / Renewal Due) × 100</p>
          </div>
        </div>

        {/* Renewals Trend Chart Section */}
        <div className="mb-6 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-bold text-warm-text dark:text-dark-text px-1">
                Overall Renewal Rate Trend ({renViewLevel} Level)
              </h3>
              <p className="text-xs text-warm-muted dark:text-dark-muted px-1 mt-0.5">Compare overall renewal rate against specific Platforms or Plans</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <button
                  onClick={() => { setShowRenPlatDropdown(!showRenPlatDropdown); setShowRenPlanDropdown(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:bg-black/5 dark:hover:bg-white/5 transition-all shadow-sm"
                >
                  <span>Compare Platforms ({renComparePlatforms.length})</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {showRenPlatDropdown && (
                  <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-30 p-2 text-xs">
                    <div className="font-bold text-warm-muted dark:text-dark-muted mb-2 px-1 border-b border-warm-border dark:border-zinc-700 pb-1 flex justify-between items-center">
                      <span>Select Platforms</span>
                      {renComparePlatforms.length > 0 && (
                        <button onClick={() => setRenComparePlatforms([])} className="text-[10px] text-amber-accent font-bold">Clear</button>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1">
                      {availableRenPlatforms.map(plat => {
                        const isSelected = renComparePlatforms.includes(plat);
                        return (
                          <label key={plat} className="flex items-center gap-2 p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded cursor-pointer font-medium text-warm-text dark:text-dark-text">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setRenComparePlatforms(prev => 
                                  isSelected ? prev.filter(p => p !== plat) : [...prev, plat]
                                );
                              }}
                              className="rounded text-amber-accent focus:ring-amber-accent"
                            />
                            <span>{plat}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => { setShowRenPlanDropdown(!showRenPlanDropdown); setShowRenPlatDropdown(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:bg-black/5 dark:hover:bg-white/5 transition-all shadow-sm"
                >
                  <span>Compare Plans ({renComparePlans.length})</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {showRenPlanDropdown && (
                  <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-30 p-2 text-xs">
                    <div className="font-bold text-warm-muted dark:text-dark-muted mb-2 px-1 border-b border-warm-border dark:border-zinc-700 pb-1 flex justify-between items-center">
                      <span>Select Plans</span>
                      {renComparePlans.length > 0 && (
                        <button onClick={() => setRenComparePlans([])} className="text-[10px] text-amber-accent font-bold">Clear</button>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1">
                      {availableRenPlans.map(plan => {
                        const isSelected = renComparePlans.includes(plan);
                        return (
                          <label key={plan} className="flex items-center gap-2 p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded cursor-pointer font-medium text-warm-text dark:text-dark-text">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setRenComparePlans(prev => 
                                  isSelected ? prev.filter(p => p !== plan) : [...prev, plan]
                                );
                              }}
                              className="rounded text-amber-accent focus:ring-amber-accent"
                            />
                            <span>{plan}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {(renComparePlatforms.length > 0 || renComparePlans.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 mb-3 px-1">
              <span className="text-xs font-bold text-warm-muted dark:text-dark-muted">Active Comparisons:</span>
              {renComparePlatforms.map(p => (
                <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded-full">
                  Platform: {p}
                  <button onClick={() => setRenComparePlatforms(prev => prev.filter(item => item !== p))} className="hover:text-blue-800">×</button>
                </span>
              ))}
              {renComparePlans.map(p => (
                <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 rounded-full">
                  Plan: {p}
                  <button onClick={() => setRenComparePlans(prev => prev.filter(item => item !== p))} className="hover:text-purple-800">×</button>
                </span>
              ))}
            </div>
          )}

          {renTrendData.length > 0 ? (
            <Plot
              data={renChartTraces}
              layout={{
                autosize: true,
                height: 380,
                margin: { l: 45, r: 25, t: 35, b: 45 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                font: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 10 },
                xaxis: { 
                  showgrid: false,
                  tickangle: renTrendData.length > 20 ? -45 : 0,
                  tickfont: { size: 10, color: isDark ? '#94A3B8' : '#64748B' }
                },
                yaxis: { 
                  gridcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', 
                  range: [0, 115],
                  ticksuffix: '%'
                },
                legend: {
                  orientation: 'h',
                  y: 1.12,
                  x: 0,
                  font: { size: 10, color: isDark ? '#cbd5e1' : '#334155' }
                },
                showlegend: renChartTraces.length > 1
              }}
              config={{ displayModeBar: false, responsive: true }}
              className="w-full"
              style={{ width: "100%", height: "380px" }}
            />
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm font-semibold text-warm-muted dark:text-dark-muted">
              No renewal records available for selected date range.
            </div>
          )}
        </div>

        {/* Platform & Plan Breakdown Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Platform-wise Table */}
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">Platform-wise Renewals</h3>
            <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-xl custom-scrollbar overflow-x-auto max-h-[480px] shadow-sm">
              <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-20 bg-warm-tableBg dark:bg-[#1E293B] shadow-sm">
                  <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Platform</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Renewal Due</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Renewed</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Renewal Rate</th>
                  </tr>
                  <tr className="font-bold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-accent">
                    <td className="p-3 whitespace-nowrap font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{renTotalDue.toLocaleString()}</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{renTotalRenewed.toLocaleString()}</td>
                    <td className="p-3 text-right font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{renOverallRate.toFixed(1)}%</td>
                  </tr>
                </thead>
                <tbody>
                  {renPlatformData.map(row => {
                    const isExpanded = !!expandedRenPlatforms[row.platform];
                    return (
                      <React.Fragment key={row.platform}>
                        <tr className="border-b border-warm-border/50 dark:border-zinc-800/60 hover:bg-black/5 dark:hover:bg-white/5 font-medium transition-colors">
                          <td className="p-3 font-semibold text-warm-text dark:text-dark-text flex items-center gap-2">
                            <button
                              onClick={() => setExpandedRenPlatforms(prev => ({ ...prev, [row.platform]: !prev[row.platform] }))}
                              className="p-1 hover:bg-amber-500/20 rounded text-amber-accent transition-transform cursor-pointer"
                              title="Click to view daily trend"
                            >
                              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                            <span>{row.platform}</span>
                          </td>
                          <td className="p-3 text-right">{row.due.toLocaleString()}</td>
                          <td className="p-3 text-right font-semibold text-amber-accent">{row.renewed.toLocaleString()}</td>
                          <td className="p-3 text-right font-bold">{row.rate.toFixed(1)}%</td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-amber-500/5 dark:bg-amber-400/5 border-b border-amber-500/20">
                            <td colSpan={4} className="p-3 pl-8">
                              <div className="text-xs font-bold text-amber-accent mb-2">Daily Renewal Breakdown: {row.platform}</div>
                              <div className="max-h-48 overflow-y-auto custom-scrollbar border border-warm-border dark:border-zinc-700 rounded-lg">
                                <table className="w-full text-xs text-left">
                                  <thead className="bg-warm-tableBg dark:bg-slate-800 text-warm-muted dark:text-dark-muted font-bold uppercase sticky top-0">
                                    <tr>
                                      <th className="p-2">Date</th>
                                      <th className="p-2 text-right">Renewal Due</th>
                                      <th className="p-2 text-right">Renewed</th>
                                      <th className="p-2 text-right">Renewal Rate</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.dailyRows.map(d => (
                                      <tr key={d.dateKey} className="border-b border-warm-border/30 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5">
                                        <td className="p-2 font-medium">{d.dateLabel}</td>
                                        <td className="p-2 text-right">{d.due.toLocaleString()}</td>
                                        <td className="p-2 text-right font-semibold text-amber-accent">{d.renewed.toLocaleString()}</td>
                                        <td className="p-2 text-right font-bold">{d.rate.toFixed(1)}%</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Plan-wise Table */}
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">Plan-wise Renewals</h3>
            <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-xl custom-scrollbar overflow-x-auto max-h-[480px] shadow-sm">
              <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-20 bg-warm-tableBg dark:bg-[#1E293B] shadow-sm">
                  <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Plan Category</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Renewal Due</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Renewed</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Renewal Rate</th>
                  </tr>
                  <tr className="font-bold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-accent">
                    <td className="p-3 whitespace-nowrap font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{renTotalDue.toLocaleString()}</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{renTotalRenewed.toLocaleString()}</td>
                    <td className="p-3 text-right font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{renOverallRate.toFixed(1)}%</td>
                  </tr>
                </thead>
                <tbody>
                  {renPlanData.map(row => {
                    const isExpanded = !!expandedRenPlans[row.plan];
                    return (
                      <React.Fragment key={row.plan}>
                        <tr className="border-b border-warm-border/50 dark:border-zinc-800/60 hover:bg-black/5 dark:hover:bg-white/5 font-medium transition-colors">
                          <td className="p-3 font-semibold text-warm-text dark:text-dark-text flex items-center gap-2">
                            <button
                              onClick={() => setExpandedRenPlans(prev => ({ ...prev, [row.plan]: !prev[row.plan] }))}
                              className="p-1 hover:bg-amber-500/20 rounded text-amber-accent transition-transform cursor-pointer"
                              title="Click to view daily trend"
                            >
                              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                            <span>{row.plan}</span>
                          </td>
                          <td className="p-3 text-right">{row.due.toLocaleString()}</td>
                          <td className="p-3 text-right font-semibold text-amber-accent">{row.renewed.toLocaleString()}</td>
                          <td className="p-3 text-right font-bold">{row.rate.toFixed(1)}%</td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-amber-500/5 dark:bg-amber-400/5 border-b border-amber-500/20">
                            <td colSpan={4} className="p-3 pl-8">
                              <div className="text-xs font-bold text-amber-accent mb-2">Daily Renewal Breakdown: {row.plan}</div>
                              <div className="max-h-48 overflow-y-auto custom-scrollbar border border-warm-border dark:border-zinc-700 rounded-lg">
                                <table className="w-full text-xs text-left">
                                  <thead className="bg-warm-tableBg dark:bg-slate-800 text-warm-muted dark:text-dark-muted font-bold uppercase sticky top-0">
                                    <tr>
                                      <th className="p-2">Date</th>
                                      <th className="p-2 text-right">Renewal Due</th>
                                      <th className="p-2 text-right">Renewed</th>
                                      <th className="p-2 text-right">Renewal Rate</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.dailyRows.map(d => (
                                      <tr key={d.dateKey} className="border-b border-warm-border/30 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5">
                                        <td className="p-2 font-medium">{d.dateLabel}</td>
                                        <td className="p-2 text-right">{d.due.toLocaleString()}</td>
                                        <td className="p-2 text-right font-semibold text-amber-accent">{d.renewed.toLocaleString()}</td>
                                        <td className="p-2 text-right font-bold">{d.rate.toFixed(1)}%</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION SEPARATOR DIVIDER */}
      <hr className="my-10 border-t-2 border-warm-border dark:border-dark-border" />

      {/* ======================================================== */}
      {/* BOTTOM HALF: RECURRING SUBSCRIPTIONS ANALYSIS */}
      {/* ======================================================== */}
      <section className="mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-warm-border dark:border-dark-border pb-4">
          <div>
            <h2 className="text-xl font-bold text-warm-text dark:text-dark-text tracking-tight">Recurring Subscriptions Analysis</h2>
            <p className="text-xs text-warm-muted dark:text-dark-muted font-medium mt-0.5">Tracking Subscriptions Sold with Auto-Renew Enabled</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-end">
            {/* Day / Month Level View Toggle for Recurring */}
            <div className="flex items-center bg-warm-tableBg dark:bg-zinc-800 p-1 rounded-lg border border-warm-border dark:border-zinc-700">
              <button
                onClick={() => setRecViewLevel("Day")}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  recViewLevel === "Day"
                    ? "bg-white dark:bg-slate-700 text-amber-accent shadow-sm"
                    : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                }`}
              >
                Day Level View
              </button>
              <button
                onClick={() => setRecViewLevel("Month")}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  recViewLevel === "Month"
                    ? "bg-white dark:bg-slate-700 text-amber-accent shadow-sm"
                    : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                }`}
              >
                Month Level View
              </button>
            </div>

            {/* Marketing Team Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Marketing Team:</span>
              <select
                value={selectedMarketingTeam}
                onChange={(e) => setSelectedMarketingTeam(e.target.value)}
                className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-xs font-bold rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-sm cursor-pointer"
              >
                {allMarketingTeams.map(team => (
                  <option key={team} value={team}>{team}</option>
                ))}
              </select>
            </div>

            {/* Recurring Date Selector */}
            {recDatePreset === "Custom range" && (
              <div className="flex items-center gap-2">
                <input type="date" value={recStartDate} onChange={(e) => setRecStartDate(e.target.value)} className="px-2 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent" />
                <span className="text-xs text-warm-muted dark:text-dark-muted">to</span>
                <input type="date" value={recEndDate} onChange={(e) => setRecEndDate(e.target.value)} className="px-2 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent" />
              </div>
            )}
            <select 
              value={recDatePreset} 
              onChange={(e) => setRecDatePreset(e.target.value)}
              className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-xs font-bold rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-sm cursor-pointer"
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
          </div>
        </div>

        {/* Recurring KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
            <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Total Subscriptions Sold</div>
            <div className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{recTotalConv.toLocaleString()}</div>
            <p className="text-xs text-warm-muted dark:text-dark-muted mt-2">All transactions sold</p>
          </div>

          <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
            <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Recurring Subscriptions</div>
            <div className="text-3xl font-black text-amber-accent tracking-tight">{recRecurringConv.toLocaleString()}</div>
            <p className="text-xs text-warm-muted dark:text-dark-muted mt-2 font-semibold">
              <span className="text-amber-accent font-bold">{recRecurringShare.toFixed(1)}%</span> of total sales (auto_renew = TRUE)
            </p>
          </div>

          <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
            <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Recurring Revenue</div>
            <div className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{formatIndianCurrency(recRecurringRev)}</div>
            <p className="text-xs text-warm-muted dark:text-dark-muted mt-2">Revenue from auto-renew sales</p>
          </div>

          <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
            <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Non-Recurring Subscriptions</div>
            <div className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{recNonRecurringConv.toLocaleString()}</div>
            <p className="text-xs text-warm-muted dark:text-dark-muted mt-2">(auto_renew = FALSE)</p>
          </div>
        </div>

        {/* NEW: Daily Recurring % Trendline with Comparisons (Marketing Team, Platform, Plan) */}
        <div className="mb-6 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-bold text-warm-text dark:text-dark-text px-1">
                Recurring Subscription % Trend ({recViewLevel} Level)
              </h3>
              <p className="text-xs text-warm-muted dark:text-dark-muted px-1 mt-0.5">Compare overall recurring % against Marketing Teams, Platforms, or Plans</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Compare Marketing Teams Dropdown */}
              <div className="relative">
                <button
                  onClick={() => { setShowRecTeamDropdown(!showRecTeamDropdown); setShowRecPlatDropdown(false); setShowRecPlanDropdown(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:bg-black/5 dark:hover:bg-white/5 transition-all shadow-sm"
                >
                  <span>Compare Teams ({recCompareTeams.length})</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {showRecTeamDropdown && (
                  <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-30 p-2 text-xs">
                    <div className="font-bold text-warm-muted dark:text-dark-muted mb-2 px-1 border-b border-warm-border dark:border-zinc-700 pb-1 flex justify-between items-center">
                      <span>Select Marketing Teams</span>
                      {recCompareTeams.length > 0 && (
                        <button onClick={() => setRecCompareTeams([])} className="text-[10px] text-amber-accent font-bold">Clear</button>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1">
                      {allMarketingTeams.filter(t => t !== "All Marketing Teams").map(team => {
                        const isSelected = recCompareTeams.includes(team);
                        return (
                          <label key={team} className="flex items-center gap-2 p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded cursor-pointer font-medium text-warm-text dark:text-dark-text">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setRecCompareTeams(prev => 
                                  isSelected ? prev.filter(t => t !== team) : [...prev, team]
                                );
                              }}
                              className="rounded text-amber-accent focus:ring-amber-accent"
                            />
                            <span>{team}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Compare Platforms Dropdown */}
              <div className="relative">
                <button
                  onClick={() => { setShowRecPlatDropdown(!showRecPlatDropdown); setShowRecTeamDropdown(false); setShowRecPlanDropdown(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:bg-black/5 dark:hover:bg-white/5 transition-all shadow-sm"
                >
                  <span>Compare Platforms ({recComparePlatforms.length})</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {showRecPlatDropdown && (
                  <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-30 p-2 text-xs">
                    <div className="font-bold text-warm-muted dark:text-dark-muted mb-2 px-1 border-b border-warm-border dark:border-zinc-700 pb-1 flex justify-between items-center">
                      <span>Select Platforms</span>
                      {recComparePlatforms.length > 0 && (
                        <button onClick={() => setRecComparePlatforms([])} className="text-[10px] text-amber-accent font-bold">Clear</button>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1">
                      {availableRecPlatforms.map(plat => {
                        const isSelected = recComparePlatforms.includes(plat);
                        return (
                          <label key={plat} className="flex items-center gap-2 p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded cursor-pointer font-medium text-warm-text dark:text-dark-text">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setRecComparePlatforms(prev => 
                                  isSelected ? prev.filter(p => p !== plat) : [...prev, plat]
                                );
                              }}
                              className="rounded text-amber-accent focus:ring-amber-accent"
                            />
                            <span>{plat}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Compare Plans Dropdown */}
              <div className="relative">
                <button
                  onClick={() => { setShowRecPlanDropdown(!showRecPlanDropdown); setShowRecTeamDropdown(false); setShowRecPlatDropdown(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:bg-black/5 dark:hover:bg-white/5 transition-all shadow-sm"
                >
                  <span>Compare Plans ({recComparePlans.length})</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {showRecPlanDropdown && (
                  <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-lg shadow-xl z-30 p-2 text-xs">
                    <div className="font-bold text-warm-muted dark:text-dark-muted mb-2 px-1 border-b border-warm-border dark:border-zinc-700 pb-1 flex justify-between items-center">
                      <span>Select Plans</span>
                      {recComparePlans.length > 0 && (
                        <button onClick={() => setRecComparePlans([])} className="text-[10px] text-amber-accent font-bold">Clear</button>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1">
                      {availableRecPlans.map(plan => {
                        const isSelected = recComparePlans.includes(plan);
                        return (
                          <label key={plan} className="flex items-center gap-2 p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded cursor-pointer font-medium text-warm-text dark:text-dark-text">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setRecComparePlans(prev => 
                                  isSelected ? prev.filter(p => p !== plan) : [...prev, plan]
                                );
                              }}
                              className="rounded text-amber-accent focus:ring-amber-accent"
                            />
                            <span>{plan}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {(recCompareTeams.length > 0 || recComparePlatforms.length > 0 || recComparePlans.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 mb-3 px-1">
              <span className="text-xs font-bold text-warm-muted dark:text-dark-muted">Active Comparisons:</span>
              {recCompareTeams.map(t => (
                <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 rounded-full">
                  Team: {t}
                  <button onClick={() => setRecCompareTeams(prev => prev.filter(item => item !== t))} className="hover:text-green-800">×</button>
                </span>
              ))}
              {recComparePlatforms.map(p => (
                <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded-full">
                  Platform: {p}
                  <button onClick={() => setRecComparePlatforms(prev => prev.filter(item => item !== p))} className="hover:text-blue-800">×</button>
                </span>
              ))}
              {recComparePlans.map(p => (
                <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 rounded-full">
                  Plan: {p}
                  <button onClick={() => setRecComparePlans(prev => prev.filter(item => item !== p))} className="hover:text-purple-800">×</button>
                </span>
              ))}
            </div>
          )}

          {recTrendData.length > 0 ? (
            <Plot
              data={recChartTraces}
              layout={{
                autosize: true,
                height: 380,
                margin: { l: 45, r: 25, t: 35, b: 45 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                font: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 10 },
                xaxis: { 
                  showgrid: false,
                  tickangle: recTrendData.length > 20 ? -45 : 0,
                  tickfont: { size: 10, color: isDark ? '#94A3B8' : '#64748B' }
                },
                yaxis: { 
                  gridcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', 
                  range: [0, 115],
                  ticksuffix: '%'
                },
                legend: {
                  orientation: 'h',
                  y: 1.12,
                  x: 0,
                  font: { size: 10, color: isDark ? '#cbd5e1' : '#334155' }
                },
                showlegend: recChartTraces.length > 1
              }}
              config={{ displayModeBar: false, responsive: true }}
              className="w-full"
              style={{ width: "100%", height: "380px" }}
            />
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm font-semibold text-warm-muted dark:text-dark-muted">
              No recurring sales data available for selected filters.
            </div>
          )}
        </div>

        {/* Recurring Breakdown Tables Section (Platform, Plan, Marketing Team) */}
        <div className="flex flex-col gap-6">
          {/* Platform Breakdown */}
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">Platform-wise Recurring Breakdown</h3>
            <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-xl custom-scrollbar overflow-x-auto max-h-[480px] shadow-sm">
              <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-20 bg-warm-tableBg dark:bg-[#1E293B] shadow-sm">
                  <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Platform</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Total Sold</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Non-Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Recurring Share</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Recurring Revenue</th>
                  </tr>
                  <tr className="font-bold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-accent">
                    <td className="p-3 whitespace-nowrap font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recTotalConv.toLocaleString()}</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recRecurringConv.toLocaleString()}</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recNonRecurringConv.toLocaleString()}</td>
                    <td className="p-3 text-right font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recRecurringShare.toFixed(1)}%</td>
                    <td className="p-3 text-right font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{formatIndianCurrency(recRecurringRev)}</td>
                  </tr>
                </thead>
                <tbody>
                  {recPlatformData.map(row => {
                    const isExpanded = !!expandedRecPlatforms[row.platform];
                    return (
                      <React.Fragment key={row.platform}>
                        <tr className="border-b border-warm-border/50 dark:border-zinc-800/60 hover:bg-black/5 dark:hover:bg-white/5 font-medium transition-colors">
                          <td className="p-3 font-semibold text-warm-text dark:text-dark-text flex items-center gap-2">
                            <button
                              onClick={() => setExpandedRecPlatforms(prev => ({ ...prev, [row.platform]: !prev[row.platform] }))}
                              className="p-1 hover:bg-amber-500/20 rounded text-amber-accent transition-transform cursor-pointer"
                              title="Click to view daily trend"
                            >
                              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                            <span>{row.platform}</span>
                          </td>
                          <td className="p-3 text-right">{row.total.toLocaleString()}</td>
                          <td className="p-3 text-right font-semibold text-amber-accent">{row.rec.toLocaleString()}</td>
                          <td className="p-3 text-right">{row.nonRec.toLocaleString()}</td>
                          <td className="p-3 text-right font-bold">{row.share.toFixed(1)}%</td>
                          <td className="p-3 text-right font-bold">{formatIndianCurrency(row.recRev)}</td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-amber-500/5 dark:bg-amber-400/5 border-b border-amber-500/20">
                            <td colSpan={6} className="p-3 pl-8">
                              <div className="text-xs font-bold text-amber-accent mb-2">Daily Recurring Sales Breakdown: {row.platform}</div>
                              <div className="max-h-48 overflow-y-auto custom-scrollbar border border-warm-border dark:border-zinc-700 rounded-lg">
                                <table className="w-full text-xs text-left">
                                  <thead className="bg-warm-tableBg dark:bg-slate-800 text-warm-muted dark:text-dark-muted font-bold uppercase sticky top-0">
                                    <tr>
                                      <th className="p-2">Date</th>
                                      <th className="p-2 text-right">Total Sold</th>
                                      <th className="p-2 text-right">Recurring</th>
                                      <th className="p-2 text-right">Non-Recurring</th>
                                      <th className="p-2 text-right">Recurring Share</th>
                                      <th className="p-2 text-right">Recurring Revenue</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.dailyRows.map(d => (
                                      <tr key={d.dateKey} className="border-b border-warm-border/30 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5">
                                        <td className="p-2 font-medium">{d.dateLabel}</td>
                                        <td className="p-2 text-right">{d.total.toLocaleString()}</td>
                                        <td className="p-2 text-right font-semibold text-amber-accent">{d.rec.toLocaleString()}</td>
                                        <td className="p-2 text-right">{d.nonRec.toLocaleString()}</td>
                                        <td className="p-2 text-right font-bold">{d.share.toFixed(1)}%</td>
                                        <td className="p-2 text-right font-bold">{formatIndianCurrency(d.recRev)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Plan Breakdown */}
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">Plan-wise Recurring Breakdown</h3>
            <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-xl custom-scrollbar overflow-x-auto max-h-[480px] shadow-sm">
              <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-20 bg-warm-tableBg dark:bg-[#1E293B] shadow-sm">
                  <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Plan Category</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Total Sold</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Non-Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Recurring Share</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Recurring Revenue</th>
                  </tr>
                  <tr className="font-bold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-accent">
                    <td className="p-3 whitespace-nowrap font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recTotalConv.toLocaleString()}</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recRecurringConv.toLocaleString()}</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recNonRecurringConv.toLocaleString()}</td>
                    <td className="p-3 text-right font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recRecurringShare.toFixed(1)}%</td>
                    <td className="p-3 text-right font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{formatIndianCurrency(recRecurringRev)}</td>
                  </tr>
                </thead>
                <tbody>
                  {recPlanData.map(row => {
                    const isExpanded = !!expandedRecPlans[row.plan];
                    return (
                      <React.Fragment key={row.plan}>
                        <tr className="border-b border-warm-border/50 dark:border-zinc-800/60 hover:bg-black/5 dark:hover:bg-white/5 font-medium transition-colors">
                          <td className="p-3 font-semibold text-warm-text dark:text-dark-text flex items-center gap-2">
                            <button
                              onClick={() => setExpandedRecPlans(prev => ({ ...prev, [row.plan]: !prev[row.plan] }))}
                              className="p-1 hover:bg-amber-500/20 rounded text-amber-accent transition-transform cursor-pointer"
                              title="Click to view daily trend"
                            >
                              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                            <span>{row.plan}</span>
                          </td>
                          <td className="p-3 text-right">{row.total.toLocaleString()}</td>
                          <td className="p-3 text-right font-semibold text-amber-accent">{row.rec.toLocaleString()}</td>
                          <td className="p-3 text-right">{row.nonRec.toLocaleString()}</td>
                          <td className="p-3 text-right font-bold">{row.share.toFixed(1)}%</td>
                          <td className="p-3 text-right font-bold">{formatIndianCurrency(row.recRev)}</td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-amber-500/5 dark:bg-amber-400/5 border-b border-amber-500/20">
                            <td colSpan={6} className="p-3 pl-8">
                              <div className="text-xs font-bold text-amber-accent mb-2">Daily Recurring Sales Breakdown: {row.plan}</div>
                              <div className="max-h-48 overflow-y-auto custom-scrollbar border border-warm-border dark:border-zinc-700 rounded-lg">
                                <table className="w-full text-xs text-left">
                                  <thead className="bg-warm-tableBg dark:bg-slate-800 text-warm-muted dark:text-dark-muted font-bold uppercase sticky top-0">
                                    <tr>
                                      <th className="p-2">Date</th>
                                      <th className="p-2 text-right">Total Sold</th>
                                      <th className="p-2 text-right">Recurring</th>
                                      <th className="p-2 text-right">Non-Recurring</th>
                                      <th className="p-2 text-right">Recurring Share</th>
                                      <th className="p-2 text-right">Recurring Revenue</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.dailyRows.map(d => (
                                      <tr key={d.dateKey} className="border-b border-warm-border/30 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5">
                                        <td className="p-2 font-medium">{d.dateLabel}</td>
                                        <td className="p-2 text-right">{d.total.toLocaleString()}</td>
                                        <td className="p-2 text-right font-semibold text-amber-accent">{d.rec.toLocaleString()}</td>
                                        <td className="p-2 text-right">{d.nonRec.toLocaleString()}</td>
                                        <td className="p-2 text-right font-bold">{d.share.toFixed(1)}%</td>
                                        <td className="p-2 text-right font-bold">{formatIndianCurrency(d.recRev)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Marketing Team Breakdown */}
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">Marketing Team Breakdown</h3>
            <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-xl custom-scrollbar overflow-x-auto max-h-[480px] shadow-sm">
              <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-20 bg-warm-tableBg dark:bg-[#1E293B] shadow-sm">
                  <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Marketing Team</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Total Sold</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Non-Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Recurring Share</th>
                    <th className="p-3 text-right whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B]">Recurring Revenue</th>
                  </tr>
                  <tr className="font-bold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-accent">
                    <td className="p-3 whitespace-nowrap font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recTotalConv.toLocaleString()}</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recRecurringConv.toLocaleString()}</td>
                    <td className="p-3 text-right font-extrabold bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recNonRecurringConv.toLocaleString()}</td>
                    <td className="p-3 text-right font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{recRecurringShare.toFixed(1)}%</td>
                    <td className="p-3 text-right font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>{formatIndianCurrency(recRecurringRev)}</td>
                  </tr>
                </thead>
                <tbody>
                  {recTeamData.map(row => {
                    const isExpanded = !!expandedRecTeams[row.team];
                    return (
                      <React.Fragment key={row.team}>
                        <tr className="border-b border-warm-border/50 dark:border-zinc-800/60 hover:bg-black/5 dark:hover:bg-white/5 font-medium transition-colors">
                          <td className="p-3 font-semibold text-warm-text dark:text-dark-text flex items-center gap-2">
                            <button
                              onClick={() => setExpandedRecTeams(prev => ({ ...prev, [row.team]: !prev[row.team] }))}
                              className="p-1 hover:bg-amber-500/20 rounded text-amber-accent transition-transform cursor-pointer"
                              title="Click to view daily trend"
                            >
                              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                            <span>{row.team}</span>
                          </td>
                          <td className="p-3 text-right">{row.total.toLocaleString()}</td>
                          <td className="p-3 text-right font-semibold text-amber-accent">{row.rec.toLocaleString()}</td>
                          <td className="p-3 text-right">{row.nonRec.toLocaleString()}</td>
                          <td className="p-3 text-right font-bold">{row.share.toFixed(1)}%</td>
                          <td className="p-3 text-right font-bold">{formatIndianCurrency(row.recRev)}</td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-amber-500/5 dark:bg-amber-400/5 border-b border-amber-500/20">
                            <td colSpan={6} className="p-3 pl-8">
                              <div className="text-xs font-bold text-amber-accent mb-2">Daily Recurring Sales Breakdown: {row.team}</div>
                              <div className="max-h-48 overflow-y-auto custom-scrollbar border border-warm-border dark:border-zinc-700 rounded-lg">
                                <table className="w-full text-xs text-left">
                                  <thead className="bg-warm-tableBg dark:bg-slate-800 text-warm-muted dark:text-dark-muted font-bold uppercase sticky top-0">
                                    <tr>
                                      <th className="p-2">Date</th>
                                      <th className="p-2 text-right">Total Sold</th>
                                      <th className="p-2 text-right">Recurring</th>
                                      <th className="p-2 text-right">Non-Recurring</th>
                                      <th className="p-2 text-right">Recurring Share</th>
                                      <th className="p-2 text-right">Recurring Revenue</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.dailyRows.map(d => (
                                      <tr key={d.dateKey} className="border-b border-warm-border/30 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5">
                                        <td className="p-2 font-medium">{d.dateLabel}</td>
                                        <td className="p-2 text-right">{d.total.toLocaleString()}</td>
                                        <td className="p-2 text-right font-semibold text-amber-accent">{d.rec.toLocaleString()}</td>
                                        <td className="p-2 text-right">{d.nonRec.toLocaleString()}</td>
                                        <td className="p-2 text-right font-bold">{d.share.toFixed(1)}%</td>
                                        <td className="p-2 text-right font-bold">{formatIndianCurrency(d.recRev)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}


export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [activeTab, setActiveTab] = useState('Realtime');
  const isDark = theme === 'dark';

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('et_ledger_current_user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const handleSetUser = (u) => {
    setCurrentUser(u);
    if (u) {
      localStorage.setItem('et_ledger_current_user', JSON.stringify(u));
    } else {
      localStorage.removeItem('et_ledger_current_user');
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    handleSetUser(null);
  };

  useEffect(() => {
    preloadAllDashboardData();
  }, []);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  useEffect(() => {
    if (currentUser?.email && activeTab) {
      logTabPageView(currentUser.email, activeTab);
    }
  }, [activeTab, currentUser]);

  if (!currentUser) {
    return <LoginScreen onLoginSuccess={handleSetUser} isDark={isDark} />;
  }

  const isAdmin = isAdminEmail(currentUser.email);
  const navTabs = ['Realtime', 'Funnel Analysis', 'Subscription Report', 'Renewals & Recurring', 'Conversational Analytics'];
  if (isAdmin) {
    navTabs.push('Admin Panel');
  }

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

          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-warm-totalBg dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-full p-1 overflow-x-auto custom-scrollbar">
            {navTabs.map(tab => (
              <button 
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-1.5 text-sm font-semibold rounded-full whitespace-nowrap transition-all duration-300 ease-in-out cursor-pointer ${
                  activeTab === tab 
                    ? 'bg-white dark:bg-slate-700 shadow-sm border border-warm-border/50 dark:border-slate-600 text-amber-accent font-bold' 
                    : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {tab === 'Admin Panel' ? '👑 Admin Panel' : tab}
              </button>
            ))}
          </div>
          
          {/* Header Right Tools & User Profile */}
          <div className="flex items-center gap-3 justify-end h-[38px]">
            
            {/* Logged in User Profile Pill */}
            <div className="flex items-center gap-2 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg px-3 py-1.5 shadow-xs text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span className="truncate max-w-[150px] font-bold text-warm-text dark:text-dark-text" title={currentUser.email}>
                {currentUser.displayName || currentUser.email.split('@')[0]}
              </span>
              {isAdmin && (
                <span className="px-1.5 py-0.2 text-[9px] font-black rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                  ADMIN
                </span>
              )}
            </div>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-bold transition-all cursor-pointer"
              title="Sign out of your session"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>

            {/* Theme Toggle */}
            <button 
              onClick={() => {
                const newTheme = isDark ? 'light' : 'dark';
                setTheme(newTheme);
                localStorage.setItem('theme', newTheme);
              }}
              className="flex items-center justify-center p-2.5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg text-warm-text dark:text-dark-text hover:bg-warm-tableBg dark:hover:bg-zinc-800 transition-all shadow-xs focus:outline-hidden hover:scale-105 cursor-pointer"
              title="Toggle Light / Dark Mode"
            >
              {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-warm-text" />}
            </button>
          </div>
        </header>

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
          <div className={activeTab === 'Renewals & Recurring' ? 'block' : 'hidden'}>
            <RenewalsAndRecurring isDark={isDark} />
          </div>
          <div className={activeTab === 'Conversational Analytics' ? 'block' : 'hidden'}>
            <ConversationalAnalytics isDark={isDark} currentUser={currentUser} />
          </div>
          {isAdmin && (
            <div className={activeTab === 'Admin Panel' ? 'block' : 'hidden'}>
              <AdminPanel user={currentUser} isDark={isDark} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}


function ConversationalAnalytics({ isDark }) {
  const [subscriptionData, setSubscriptionData] = useState([]);
  const [funnelData, setFunnelData] = useState([]);
  const [renewalsData, setRenewalsData] = useState([]);

  useEffect(() => {
    async function fetchSubData() {
      try {
        let response = await fetch(DEFAULT_GSHEET_URL);
        let csvText = await response.text();
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const parsed = results.data.map(row => {
              const dateStr = row.Date || row.date;
              if (!dateStr) return null;
              const platRaw = (row.Platform || '').toLowerCase().trim();
              return {
                dateStr,
                platform: PLATFORM_MAP[platRaw] || row.Platform,
                revenue: parseFloat(row.Revenue || row.rev || 0),
                conversions: parseInt(row.Conversions || row.conversions || 0, 10) || 0
              };
            }).filter(Boolean);
            setSubscriptionData(parsed);
          }
        });
      } catch (err) {
        console.error("Failed to fetch sub data in ConversationalAnalytics", err);
      }
    }

    async function fetchRenewalsData() {
      try {
        const url = "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=renewal_raw";
        let res = await fetch(url);
        let csvText = await res.text();
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const processed = results.data.map(row => {
              const cleanRow = {};
              Object.keys(row).forEach(k => cleanRow[k.trim()] = row[k]);
              
              const dParts = String(cleanRow['renew_date'] || '').split('/');
              let dateStr = '';
              if (dParts.length === 3) {
                const y = dParts[2];
                const m = dParts[0].padStart(2, '0');
                const d = dParts[1].padStart(2, '0');
                dateStr = `${y}-${m}-${d}`;
              }

              const platformCode = String(cleanRow['platform'] || '').trim();
              const platformDisplay = normalizePlatformName(platformCode);

              return {
                renew_month: String(cleanRow['renew_month'] || '').trim(),
                renew_date: dateStr,
                platform: platformDisplay,
                plan_category: String(cleanRow['plan_category'] || 'UNKNOWN').trim().toUpperCase(),
                renewal_due: parseInt(cleanRow['renewal_due'], 10) || 0,
                renewed: parseInt(cleanRow['renewed'], 10) || 0
              };
            }).filter(r => r.renew_month || r.renew_date);
            setRenewalsData(processed);
          }
        });
      } catch (err) {
        console.error("Failed to fetch renewals data in ConversationalAnalytics", err);
      }
    }

    fetchSubData();
    fetchRenewalsData();
  }, []);

  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'bot',
      text: 'Hello! I am your AI Ledger Assistant. Ask me anything about subscription trends, renewals, revenue pacing, or platform breakdowns across dates.',
      kpis: [
        { label: "Total Revenue (30d)", value: "₹4.33 Cr", sub: "₹14.43 L/day" },
        { label: "Top Sales Platform", value: "MWeb", sub: "68% Total Vol" },
        { label: "Funnel Conversion", value: "1.55%", sub: "Page Load to Sale" }
      ],
      suggestedFollowups: [
        "give me funnel data for the last 7 days day wise",
        "What is the renewal rate for the month of july'26?",
        "Give me platform wise breakup of renewals for the month of july'26",
        "How much revenue did iOS generate in last 7 days?"
      ]
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const sendQuery = async (queryText) => {
    if (!queryText || !queryText.trim()) return;

    const userMsg = { id: Date.now(), sender: 'user', text: queryText.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const result = await processConversationalQueryAsync(queryText.trim(), {
        subscriptionData,
        funnelData,
        realtimeData: null,
        renewalsData
      });

      const engineUsed = getStoredApiKey() ? 'Gemini 3.6 Flash' : 'Local React Engine';
      logChatQuery(currentUser?.email || 'Anonymous User', queryText.trim(), engineUsed);

      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'bot',
          text: result.text,
          kpis: result.kpis || null,
          chart: result.chart || null,
          table: result.table || null,
          suggestedFollowups: result.suggestedFollowups || null
        }
      ]);
    } catch (err) {
      console.error("Error running query:", err);
      logChatQuery(currentUser?.email || 'Anonymous User', queryText.trim(), 'Error Engine');
      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'bot',
          text: `An error occurred while processing your request: ${err.message}`
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: Date.now(),
        sender: 'bot',
        text: 'Hello! I am your AI Ledger Assistant. Ask me anything about subscription trends, renewals, revenue pacing, or platform breakdowns across dates.',
        kpis: [
          { label: "Total Revenue (30d)", value: "₹4.33 Cr", sub: "₹14.43 L/day" },
          { label: "Top Sales Platform", value: "MWeb", sub: "68% Total Vol" },
          { label: "Funnel Conversion", value: "1.55%", sub: "Page Load to Sale" }
        ],
        suggestedFollowups: [
          "give me funnel data for the last 7 days day wise",
          "What is the renewal rate for the month of july'26?",
          "Give me platform wise breakup of renewals for the month of july'26",
          "Which platform leads sales?"
        ]
      }
    ]);
  };

  const handleSend = (e) => {
    e.preventDefault();
    sendQuery(input);
  };

  return (
    <div className="animate-in fade-in duration-300 max-w-4xl mx-auto py-6 relative">
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl shadow-sm p-6">
        {/* Assistant Header */}
        <div className="flex items-center justify-between border-b border-warm-border dark:border-dark-border pb-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 text-amber-accent rounded-xl">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-warm-text dark:text-dark-text tracking-tight">Conversational BI Assistant</h2>
              <p className="text-xs text-warm-muted dark:text-dark-muted font-medium">Ask questions in natural language to analyze live dashboard data</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClearChat}
              className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
              title="Clear chat conversation history"
            >
              <Trash2 className="h-3 w-3" />
              <span>Clear Chat</span>
            </button>

            <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Live Data Connected
            </span>
          </div>
        </div>

        {/* Chat Messages Box */}
        <div className="h-[520px] overflow-y-auto custom-scrollbar flex flex-col gap-4 p-4 bg-warm-tableBg dark:bg-zinc-900/60 rounded-xl border border-warm-border/50 dark:border-zinc-800 mb-4">
          {messages.map(msg => (
            <div key={msg.id} className={`flex items-start gap-3 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`p-2 rounded-lg shrink-0 ${msg.sender === 'user' ? 'bg-amber-accent text-white' : 'bg-slate-700 text-amber-400'}`}>
                {msg.sender === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>

              <div className={`max-w-[85%] p-4 rounded-2xl text-sm font-medium leading-relaxed space-y-3 ${
                msg.sender === 'user'
                  ? 'bg-amber-500 text-white rounded-tr-none'
                  : 'bg-white dark:bg-slate-800 text-warm-text dark:text-dark-text border border-warm-border dark:border-dark-border rounded-tl-none shadow-sm'
              }`}>
                {/* 1. Natural Language Text (renders bold formatting) */}
                <div className="whitespace-pre-line leading-relaxed">
                  {msg.text.split('**').map((part, i) => i % 2 === 1 ? <strong key={i} className="font-extrabold text-amber-600 dark:text-amber-400">{part}</strong> : part)}
                </div>

                {/* 2. Embedded KPI Stat Pills */}
                {msg.kpis && msg.kpis.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
                    {msg.kpis.map((kpi, idx) => (
                      <div key={idx} className="bg-warm-tableBg dark:bg-zinc-900/80 border border-warm-border/80 dark:border-zinc-700 p-2.5 rounded-xl shadow-xs">
                        <div className="text-[10px] uppercase tracking-wider font-extrabold text-warm-muted dark:text-dark-muted">{kpi.label}</div>
                        <div className="text-base font-black text-warm-text dark:text-dark-text mt-0.5">{kpi.value}</div>
                        {kpi.sub && <div className="text-[10px] font-bold text-amber-accent dark:text-amber-400 mt-0.5">{kpi.sub}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* 3. Embedded Inline Mini Chart */}
                {msg.chart && (
                  <div className="bg-warm-tableBg dark:bg-zinc-900/80 border border-warm-border/80 dark:border-zinc-700 p-3 rounded-xl shadow-xs mt-2">
                    <div className="text-xs font-bold text-warm-text dark:text-dark-text mb-1">{msg.chart.title}</div>
                    <div className="w-full h-[180px]">
                      <Plot
                        data={[
                          {
                            x: msg.chart.labels,
                            y: msg.chart.values,
                            type: msg.chart.type || 'bar',
                            marker: { color: msg.chart.colors || '#F59E0B' },
                            text: msg.chart.values.map(v => typeof v === 'number' ? v.toLocaleString() : v),
                            textposition: 'auto'
                          }
                        ]}
                        layout={{
                          autosize: true,
                          margin: { l: 30, r: 15, t: 15, b: 30 },
                          paper_bgcolor: 'transparent',
                          plot_bgcolor: 'transparent',
                          xaxis: { tickfont: { size: 10, color: isDark ? '#cbd5e1' : '#475569' } },
                          yaxis: { tickfont: { size: 10, color: isDark ? '#cbd5e1' : '#475569' }, showgrid: true, gridcolor: 'rgba(200,200,200,0.1)' }
                        }}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </div>
                  </div>
                )}

                {/* 4. Embedded Micro Breakdown Table */}
                {msg.table && (
                  <div className="overflow-x-auto border border-warm-border dark:border-zinc-700 rounded-xl mt-2">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-amber-100/60 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-extrabold border-b border-amber-300 dark:border-amber-800">
                        <tr>
                          {msg.table.headers.map((h, i) => (
                            <th key={i} className={`p-2 ${i > 0 ? 'text-right' : ''}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-warm-border/40 dark:divide-zinc-800 bg-white dark:bg-zinc-900 font-medium">
                        {msg.table.rows.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-black/5 dark:hover:bg-white/5">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className={`p-2 ${cIdx > 0 ? 'text-right font-bold' : 'font-semibold text-amber-accent'}`}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 5. Inline Contextual Follow-up Suggestions */}
                {msg.suggestedFollowups && msg.suggestedFollowups.length > 0 && (
                  <div className="pt-3 border-t border-warm-border/60 dark:border-zinc-700/60 mt-3">
                    <div className="text-[11px] font-bold text-warm-muted dark:text-dark-muted mb-2 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-amber-accent" />
                      <span>Suggested Follow-up Questions:</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {msg.suggestedFollowups.map((followupQ, fIdx) => (
                        <button
                          key={fIdx}
                          onClick={() => sendQuery(followupQ)}
                          className="px-3 py-1.5 text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-500/30 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                        >
                          <span>{followupQ}</span>
                          <ArrowRight className="h-3 w-3 text-amber-accent" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex items-center gap-2 text-xs text-warm-muted dark:text-dark-muted italic pl-2">
              <Bot className="h-4 w-4 animate-bounce text-amber-accent" />
              <span>AI Assistant is querying live data...</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Query Input Form */}
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything: e.g. How much revenue did iOS generate in last 7 days? Give Main iOS vs Market iOS..."
            className="flex-1 px-4 py-3 text-sm rounded-xl bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text focus:outline-none focus:ring-2 focus:ring-amber-accent shadow-sm"
          />
          <button
            type="submit"
            className="px-5 py-3 bg-amber-accent hover:bg-amber-600 text-white font-bold text-sm rounded-xl transition-all flex items-center gap-2 shadow-sm cursor-pointer"
          >
            <span>Ask</span>
            <Send className="h-4 w-4" />
          </button>
        </form>


      </div>
    </div>
  );
}

function formatMetric(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

function FunnelAnalysis({ isDark }) {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Primary Date State
  const [datePreset, setDatePreset] = useState("Last 30 days");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Comparison Date State
  const [compPreset, setCompPreset] = useState("None"); // "None" | "Previous period" | "Previous month" | "Custom range"
  const [compStartDate, setCompStartDate] = useState("");
  const [compEndDate, setCompEndDate] = useState("");

  const [expandedRows, setExpandedRows] = useState({});
  const toggleRow = (key) => setExpandedRows(prev => ({ ...prev, [key]: !prev[key] }));

  // Auto-calculate primary date range
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

  // Auto-calculate comparison date range
  useEffect(() => {
    if (compPreset === "None" || compPreset === "Custom range") return;
    if (!startDate || !endDate) return;

    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return;

    if (compPreset === "Previous period") {
      const diffTime = Math.abs(e - s);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      
      const compE = new Date(s);
      compE.setDate(compE.getDate() - 1);
      const compS = new Date(compE);
      compS.setDate(compS.getDate() - diffDays + 1);

      setCompStartDate(compS.toISOString().split('T')[0]);
      setCompEndDate(compE.toISOString().split('T')[0]);
    } else if (compPreset === "Previous month") {
      const compS = new Date(s.getFullYear(), s.getMonth() - 1, 1);
      const compE = new Date(s.getFullYear(), s.getMonth(), 0);

      setCompStartDate(compS.toISOString().split('T')[0]);
      setCompEndDate(compE.toISOString().split('T')[0]);
    }
  }, [compPreset, startDate, endDate]);

  // Fetch CSV data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const results = await fetchDatasetCached('funnel', FUNNEL_GSHEET_URL);
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
      } catch (err) {
        setError("Failed to fetch data.");
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Process data for a given date range
  const processFunnelData = useCallback((sDate, eDate) => {
    const overall = { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Plan_Selected: 0, Pay_Initiated: 0, Purchased: 0, daily: {} };
    const platforms = {};
    const trends = {};

    if (!sDate || !eDate || rawData.length === 0) {
      return { overallSum: overall, overallAvg: overall, platformAvg: {}, uniqueDays: 1, dates: [] };
    }

    const filtered = rawData.filter(r => r.dateStr >= sDate && r.dateStr <= eDate);

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

    const dates = Object.keys(trends).sort();
    const uniqueDays = dates.length || 1;

    // Calculate Daily Averages for Overall
    const overallAvg = {
      DAU: Math.round(overall.DAU / uniqueDays),
      paywalling_hits: Math.round(overall.paywalling_hits / uniqueDays),
      Plan_Page_Load: Math.round(overall.Plan_Page_Load / uniqueDays),
      Plan_Selected: Math.round(overall.Plan_Selected / uniqueDays),
      Pay_Initiated: Math.round(overall.Pay_Initiated / uniqueDays),
      Purchased: Math.round(overall.Purchased / uniqueDays),
      daily: overall.daily
    };

    // Calculate Daily Averages for Platforms
    const platformAvg = {};
    Object.keys(platforms).forEach(plat => {
      const p = platforms[plat];
      platformAvg[plat] = {
        DAU: Math.round(p.DAU / uniqueDays),
        paywalling_hits: Math.round(p.paywalling_hits / uniqueDays),
        Plan_Page_Load: Math.round(p.Plan_Page_Load / uniqueDays),
        Plan_Selected: Math.round(p.Plan_Selected / uniqueDays),
        Pay_Initiated: Math.round(p.Pay_Initiated / uniqueDays),
        Purchased: Math.round(p.Purchased / uniqueDays),
        daily: p.daily
      };
    });

    const trendDau = dates.map(d => trends[d].DAU);
    const trendConv = dates.map(d => trends[d].Plan_Page_Load > 0 ? (trends[d].Purchased / trends[d].Plan_Page_Load) * 100 : 0);
    const trendPaywall = dates.map(d => trends[d].DAU > 0 ? (trends[d].paywalling_hits / trends[d].DAU) * 100 : 0);

    return { 
      overallSum: overall, 
      overallAvg, 
      platformAvg, 
      uniqueDays, 
      dates,
      trendData: { dates, dau: trendDau, conv: trendConv, paywall: trendPaywall, uniqueDays }
    };
  }, [rawData]);

  const primaryFunnel = useMemo(() => processFunnelData(startDate, endDate), [processFunnelData, startDate, endDate]);
  
  const isCompActive = compPreset !== "None" && compStartDate && compEndDate;
  const compFunnel = useMemo(() => {
    if (!isCompActive) return null;
    return processFunnelData(compStartDate, compEndDate);
  }, [processFunnelData, isCompActive, compStartDate, compEndDate]);

  if (loading) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center text-warm-text dark:text-dark-text">
        <Loader2 className="h-10 w-10 animate-spin text-amber-accent" />
        <p className="mt-4 font-semibold tracking-wide">Loading Funnel Data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center p-6 text-red-500 text-center">
        <p className="text-2xl font-bold mb-4">An Error Occurred</p>
        <p className="max-w-md">{error}</p>
      </div>
    );
  }

  const { overallAvg, trendData } = primaryFunnel;
  const overallConversion = overallAvg.Plan_Page_Load > 0 ? ((overallAvg.Purchased / overallAvg.Plan_Page_Load) * 100).toFixed(2) : 0;
  const paywallRate = overallAvg.DAU > 0 ? ((overallAvg.paywalling_hits / overallAvg.DAU) * 100).toFixed(2) : 0;
  const dailyAvgDau = overallAvg.DAU;

  const funnelLabels = FUNNEL_STAGES.map(s => s.label);

  // Traces for Plotly Funnel Chart
  const funnelTraces = [];

  const primaryValues = FUNNEL_STAGES.map(s => primaryFunnel.overallAvg[s.key]);
  const primaryFakeX = primaryValues.map((_, i) => Math.pow(0.7, i) * 100);
  const primaryText = primaryValues.map((v, i) => {
    const init = primaryValues[0];
    const pct = init > 0 ? ((v / init) * 100).toFixed(2) : 100;
    return `${formatMetric(v)}/day<br>${pct}%`;
  });

  funnelTraces.push({
    type: 'funnel',
    name: `Primary (${startDate} to ${endDate})`,
    y: funnelLabels,
    x: primaryFakeX,
    text: primaryText,
    textinfo: "text",
    hoverinfo: "text",
    marker: {
      color: ['#FEF9C3', '#FEF08A', '#FDE047', '#FCD34D', '#FBBF24', '#F59E0B'],
      line: { width: 1, color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }
    },
    textfont: { family: 'inherit', color: '#0F172A', size: 11, weight: 'bold' }
  });

  if (compFunnel) {
    const compValues = FUNNEL_STAGES.map(s => compFunnel.overallAvg[s.key]);
    const compFakeX = compValues.map((_, i) => Math.pow(0.7, i) * 100);
    const compText = compValues.map((v, i) => {
      const init = compValues[0];
      const pct = init > 0 ? ((v / init) * 100).toFixed(2) : 100;
      return `${formatMetric(v)}/day<br>${pct}%`;
    });

    funnelTraces.push({
      type: 'funnel',
      name: `Comparison (${compStartDate} to ${compEndDate})`,
      y: funnelLabels,
      x: compFakeX,
      text: compText,
      textinfo: "text",
      hoverinfo: "text",
      marker: {
        color: ['#DBEAFE', '#93C5FD', '#60A5FA', '#3B82F6', '#2563EB', '#1D4ED8'],
        line: { width: 1, color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }
      },
      textfont: { family: 'inherit', color: '#0F172A', size: 11, weight: 'bold' }
    });
  }

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

  const activePlatforms = Object.keys(primaryFunnel.platformAvg).sort();

  // Helper renderer for cell stage metrics
  const renderStageCell = (val, prevVal, compVal = null, showPerDay = true) => {
    const dropoff = prevVal > 0 ? ((val / prevVal) * 100).toFixed(1) : null;
    let diffPct = null;
    if (compVal !== null && compVal > 0) {
      diffPct = (((val - compVal) / compVal) * 100).toFixed(1);
    }

    return (
      <td key={Math.random()} className="p-3 whitespace-nowrap text-right">
        <div className="font-bold text-[13px]">
          {val.toLocaleString()}{showPerDay && <span className="text-[10px] text-warm-muted dark:text-dark-muted font-medium">/day</span>}
        </div>
        <div className="flex items-center justify-end gap-1.5 mt-0.5 text-[11px]">
          {dropoff !== null && (
            <span className="text-warm-muted dark:text-dark-muted">
              {dropoff}% of prev
            </span>
          )}
          {diffPct !== null && (
            <span className={`font-extrabold text-[10px] px-1.5 py-0.2 rounded ${
              parseFloat(diffPct) >= 0 
                ? 'bg-green-500/10 text-green-600 dark:text-green-400' 
                : 'bg-red-500/10 text-red-600 dark:text-red-400'
            }`}>
              {parseFloat(diffPct) >= 0 ? `+${diffPct}%` : `${diffPct}%`}
            </span>
          )}
        </div>
      </td>
    );
  };

  return (
    <div className="animate-in fade-in duration-300">
      
      {/* Date Range & Comparison Selector Toolbar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl p-4 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-warm-text dark:text-dark-text tracking-tight">Funnel Period Controls</h2>
          <p className="text-xs text-warm-muted dark:text-dark-muted font-medium">Select primary timeframe and compare against previous periods</p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {/* Primary Range Selection */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-warm-muted dark:text-dark-muted">Primary:</span>
            {datePreset === "Custom range" && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={startDate} min="2020-01-01" max={new Date().toISOString().split('T')[0]} onChange={(e) => setStartDate(e.target.value)} className="px-2 py-1 text-xs font-medium rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
                <span className="text-xs text-warm-muted dark:text-dark-muted">to</span>
                <input type="date" value={endDate} min="2020-01-01" max={new Date().toISOString().split('T')[0]} onChange={(e) => setEndDate(e.target.value)} className="px-2 py-1 text-xs font-medium rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
              </div>
            )}
            <select 
              value={datePreset} 
              onChange={(e) => setDatePreset(e.target.value)}
              className="bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-xs font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-sm cursor-pointer"
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
          </div>

          {/* Comparison Period Selector */}
          <div className="flex items-center gap-2 border-l border-warm-border dark:border-dark-border pl-4">
            <span className="text-xs font-bold text-amber-accent">Compare:</span>
            {compPreset === "Custom range" && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={compStartDate} min="2020-01-01" max={new Date().toISOString().split('T')[0]} onChange={(e) => setCompStartDate(e.target.value)} className="px-2 py-1 text-xs font-medium rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
                <span className="text-xs text-warm-muted dark:text-dark-muted">to</span>
                <input type="date" value={compEndDate} min="2020-01-01" max={new Date().toISOString().split('T')[0]} onChange={(e) => setCompEndDate(e.target.value)} className="px-2 py-1 text-xs font-medium rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
              </div>
            )}
            <select 
              value={compPreset} 
              onChange={(e) => setCompPreset(e.target.value)}
              className="bg-warm-tableBg dark:bg-slate-800 border border-amber-500/40 text-warm-text dark:text-dark-text text-xs font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-sm cursor-pointer"
            >
              <option value="None">No Comparison</option>
              <option value="Previous period">Previous period</option>
              <option value="Previous month">Previous month</option>
              <option value="Custom range">Custom range</option>
            </select>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow flex justify-between items-center">
          <div>
            <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Daily Avg DAU</h3>
            <div className="flex items-end gap-3">
              <span className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">
                {dailyAvgDau.toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] text-warm-muted dark:text-dark-muted mt-1 font-semibold">Average daily active users</p>
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

        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow flex justify-between items-center">
          <div>
            <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Overall Conversion</h3>
            <div className="flex items-end gap-3">
              <span className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">
                {overallConversion}%
              </span>
              <span className="text-xs font-bold text-warm-muted dark:text-dark-muted mb-1">Purchased / Page Load</span>
            </div>
            <p className="text-[10px] text-warm-muted dark:text-dark-muted mt-1 font-semibold">Purchased vs Plan Page Load</p>
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

        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow flex justify-between items-center">
          <div>
            <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Paywall Hit Rate</h3>
            <div className="flex items-end gap-3">
              <span className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">
                {paywallRate}%
              </span>
              <span className="text-xs font-bold text-warm-muted dark:text-dark-muted mb-1">Hits / DAU</span>
            </div>
            <p className="text-[10px] text-warm-muted dark:text-dark-muted mt-1 font-semibold">Paywall hits vs DAU</p>
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

      {/* Funnel Chart Section */}
      <section className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 mb-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text">
              {isCompActive ? "Overall User Funnel Comparison" : "Overall User Funnel"}
            </h3>
            <p className="text-xs text-warm-muted dark:text-dark-muted">
              {isCompActive 
                ? `Comparing Primary (${startDate} to ${endDate}) vs Comparison (${compStartDate} to ${compEndDate})`
                : `Daily average volume across funnel stages (${startDate} to ${endDate})`}
            </p>
          </div>
        </div>

        <div className="w-full h-[420px]">
          <Plot
            data={funnelTraces}
            layout={{
              autosize: true,
              margin: { l: 140, r: 40, t: isCompActive ? 40 : 20, b: 20 },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              yaxis: { 
                tickfont: { family: 'inherit', color: isDark ? '#F8FAFC' : '#0F172A', size: 12, weight: 'bold' }
              },
              legend: {
                orientation: 'h',
                y: 1.15,
                x: 0,
                font: { size: 11, color: isDark ? '#cbd5e1' : '#334155' }
              },
              showlegend: isCompActive
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </section>

      {/* Platform Breakdown Table Section with COLUMN comparison & FIXED STICKY HEADERS */}
      <section className="mt-8 pb-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 px-1 gap-2">
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text">Platform-wise Funnel Breakdown</h3>
            <p className="text-xs text-warm-muted dark:text-dark-muted font-medium">Daily average metrics per platform (click row chevron to reveal day-level data)</p>
          </div>
          {isCompActive && (
            <div className="flex items-center gap-2 text-xs font-bold">
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">Primary Period</span>
              <span className="text-warm-muted">vs</span>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30">Comparison Period</span>
            </div>
          )}
        </div>

        <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-lg custom-scrollbar overflow-x-auto shadow-sm relative">
          <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-20 shadow-sm">
              {isCompActive ? (
                <>
                  {/* Level 1 Group Header Row */}
                  <tr className="text-warm-muted dark:text-dark-muted uppercase font-extrabold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th rowSpan={2} className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B] border-r border-warm-border dark:border-dark-border align-bottom sticky left-0 z-30 shadow-sm">
                      Platform
                    </th>
                    <th colSpan={6} className="p-2.5 text-center bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400 border-b border-r border-amber-500/30 font-black">
                      PRIMARY PERIOD ({startDate} to {endDate})
                    </th>
                    <th colSpan={6} className="p-2.5 text-center bg-[#DBEAFE] dark:bg-[#1E293B] text-blue-600 dark:text-blue-400 border-b border-blue-500/30 font-black">
                      COMPARISON PERIOD ({compStartDate} to {compEndDate})
                    </th>
                  </tr>

                  {/* Level 2 Funnel Stages Row */}
                  <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-[11px] tracking-wider border-b border-warm-border dark:border-dark-border">
                    {/* Primary Stages */}
                    {FUNNEL_STAGES.map(stage => (
                      <th key={`primary-${stage.key}`} className="p-2.5 whitespace-nowrap text-right bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-700 dark:text-amber-300 font-extrabold">
                        {stage.label}
                      </th>
                    ))}
                    {/* Comparison Stages */}
                    {FUNNEL_STAGES.map((stage, idx) => (
                      <th key={`comp-${stage.key}`} className={`p-2.5 whitespace-nowrap text-right bg-[#DBEAFE] dark:bg-[#1E293B] text-blue-700 dark:text-blue-300 font-extrabold ${idx === 0 ? 'border-l border-warm-border dark:border-dark-border' : ''}`}>
                        {stage.label}
                      </th>
                    ))}
                  </tr>
                </>
              ) : (
                <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                  <th className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B] sticky left-0 z-30">Platform</th>
                  {FUNNEL_STAGES.map(stage => (
                    <th key={stage.key} className="p-3 whitespace-nowrap text-right bg-warm-tableBg dark:bg-[#1E293B]">{stage.label}</th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {/* Function to render a platform row or overall row */}
              {[ 'overall', ...activePlatforms ].map(rowKey => {
                const title = rowKey === 'overall' ? 'Overall' : rowKey;
                const isExpanded = expandedRows[rowKey];
                
                const primaryDataObj = rowKey === 'overall' ? primaryFunnel.overallAvg : (primaryFunnel.platformAvg[rowKey] || {});
                const compDataObj = compFunnel ? (rowKey === 'overall' ? compFunnel.overallAvg : (compFunnel.platformAvg[rowKey] || {})) : null;

                // Dates for day-level expansion
                const primaryDaily = primaryDataObj.daily || {};
                const compDaily = compDataObj ? (compDataObj.daily || {}) : {};

                const sortedPrimaryDates = Object.keys(primaryDaily).sort((a,b) => b.localeCompare(a));
                const sortedCompDates = Object.keys(compDaily).sort((a,b) => b.localeCompare(a));

                return (
                  <React.Fragment key={rowKey}>
                    {/* Platform Summary Row */}
                    <tr className="border-b border-warm-border/50 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5 transition-colors font-semibold text-warm-text dark:text-dark-text">
                      <td className="p-3 whitespace-nowrap font-bold border-r border-warm-border/30 dark:border-zinc-800 sticky left-0 z-10 bg-warm-tableBg dark:bg-[#1E293B]">
                        <div 
                          onClick={() => toggleRow(rowKey)}
                          className="flex items-center gap-2 cursor-pointer select-none text-amber-accent dark:text-amber-400 hover:opacity-80"
                        >
                          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                          <span className="text-warm-text dark:text-dark-text">{title}</span>
                        </div>
                      </td>

                      {/* Primary Period Stage Columns */}
                      {FUNNEL_STAGES.map((stage, idx) => {
                        const val = primaryDataObj[stage.key] || 0;
                        const prevVal = idx > 0 ? (primaryDataObj[FUNNEL_STAGES[idx-1].key] || 0) : val;
                        return renderStageCell(val, prevVal, null, true);
                      })}

                      {/* Comparison Period Stage Columns */}
                      {isCompActive && compDataObj && FUNNEL_STAGES.map((stage, idx) => {
                        const compVal = compDataObj[stage.key] || 0;
                        const compPrevVal = idx > 0 ? (compDataObj[FUNNEL_STAGES[idx-1].key] || 0) : compVal;
                        const primaryVal = primaryDataObj[stage.key] || 0;
                        
                        return renderStageCell(compVal, compPrevVal, primaryVal, true);
                      })}
                    </tr>

                    {/* Day-level Expansion Sub-rows (Map relative index between Primary & Comparison) */}
                    {isExpanded && sortedPrimaryDates.map((dateStr, pIdx) => {
                      const pDay = primaryDaily[dateStr] || {};
                      
                      // Map relative day index for Comparison period (e.g. Day 1 vs Day 1)
                      const compDateStr = sortedCompDates[pIdx];
                      const cDay = compDateStr ? (compDaily[compDateStr] || {}) : null;

                      return (
                        <tr key={`${rowKey}-${dateStr}`} className="border-b border-warm-border/30 dark:border-zinc-800/60 bg-black/5 dark:bg-white/5 font-medium text-warm-text dark:text-dark-text text-xs">
                          <td className="p-2.5 pl-7 whitespace-nowrap font-bold text-warm-muted dark:text-dark-muted border-r border-warm-border/30 dark:border-zinc-800 sticky left-0 z-10 bg-warm-tableBg dark:bg-[#1E293B]">
                            <div>{dateStr}</div>
                            {isCompActive && compDateStr && (
                              <div className="text-[10px] text-blue-500 font-semibold mt-0.5">vs {compDateStr}</div>
                            )}
                          </td>

                          {/* Primary Day Values */}
                          {FUNNEL_STAGES.map((stage, idx) => {
                            const val = pDay[stage.key] || 0;
                            const prevVal = idx > 0 ? (pDay[FUNNEL_STAGES[idx-1].key] || 0) : val;
                            return renderStageCell(val, prevVal, null, false);
                          })}

                          {/* Comparison Day Values (Looked up using corresponding comparison date index) */}
                          {isCompActive && FUNNEL_STAGES.map((stage, idx) => {
                            const compVal = cDay ? (cDay[stage.key] || 0) : 0;
                            const compPrevVal = idx > 0 && cDay ? (cDay[FUNNEL_STAGES[idx-1].key] || 0) : compVal;
                            const primaryVal = pDay[stage.key] || 0;

                            return renderStageCell(compVal, compPrevVal, primaryVal, false);
                          })}
                        </tr>
                      );
                    })}
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


function Realtime({ isDark }) {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [realtimeCompMode, setRealtimeCompMode] = useState("4-Week"); // "4-Week" | "7-Day"

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const results = await fetchDatasetCached('realtime', REALTIME_GSHEET_URL);
        const data = results.data.map(r => ({
          dateStr: (r.event_date || '').trim(),
          hour: parseInt((r.event_hour || '').trim(), 10),
          platform: (r.ET_Platform || '').trim(),
          event: (r.event_name || '').trim(),
          count: parseInt((r.event_count || '').trim(), 10) || 0
        })).filter(r => r.dateStr && !isNaN(r.hour));
        setRawData(data);
        setLoading(false);
      } catch (err) {
        console.error("Realtime fetch error", err);
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const processedData = useMemo(() => {
    if (!rawData.length) return null;

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

    let currentHour = -1;
    rawData.forEach(r => {
      if (r.dateStr === todayDateStr && r.hour > currentHour) {
        currentHour = r.hour;
      }
    });

    // 1. Past 4-Week Same Day Dates
    const past4Dates = [];
    for (let i = 1; i <= 4; i++) {
      const d = new Date(maxDateObj);
      d.setDate(d.getDate() - (i * 7));
      past4Dates.push(`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`);
    }

    // 2. Last 7-Days Dates (Preceding 7 calendar days)
    const last7Dates = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(maxDateObj);
      d.setDate(d.getDate() - i);
      last7Dates.push(`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`);
    }

    let todayPurchases = 0;

    // Hourly accumulators
    const past4HourlySums = Array.from({length: 24}, () => 0);
    const last7HourlySums = Array.from({length: 24}, () => 0);
    const todayHourlySums = Array.from({length: 24}, () => 0);

    // Platform accumulators: Today vs Past4 vs Last7
    const platformFunnelToday = {};
    const platformFunnelPast4 = {};
    const platformFunnelLast7 = {};

    const ensurePlatObj = (obj, plat) => {
      if (!obj[plat]) {
        obj[plat] = { PlanPageLoaded: 0, PlanSelected: 0, PayInitiated: 0, Purchase: 0 };
      }
    };

    rawData.forEach(r => {
      const isToday = r.dateStr === todayDateStr;
      const isPast4 = past4Dates.includes(r.dateStr);
      const isLast7 = last7Dates.includes(r.dateStr);
      const isPurchase = r.event === 'Purchase';

      if (r.platform === 'Combined') {
        if (isToday && isPurchase) {
          todayPurchases += r.count;
          todayHourlySums[r.hour] += r.count;
        }
        if (isPast4 && isPurchase) {
          past4HourlySums[r.hour] += r.count;
        }
        if (isLast7 && isPurchase) {
          last7HourlySums[r.hour] += r.count;
        }
      } else {
        // Specific Platform counts
        if (isToday) {
          ensurePlatObj(platformFunnelToday, r.platform);
          if (r.event === 'Plan Page Loaded') platformFunnelToday[r.platform].PlanPageLoaded += r.count;
          if (r.event === 'Plan Selected') platformFunnelToday[r.platform].PlanSelected += r.count;
          if (r.event === 'Pay Initiated') platformFunnelToday[r.platform].PayInitiated += r.count;
          if (r.event === 'Purchase') platformFunnelToday[r.platform].Purchase += r.count;
        }
        if (isPast4 && r.hour <= currentHour) {
          ensurePlatObj(platformFunnelPast4, r.platform);
          if (r.event === 'Plan Page Loaded') platformFunnelPast4[r.platform].PlanPageLoaded += r.count;
          if (r.event === 'Plan Selected') platformFunnelPast4[r.platform].PlanSelected += r.count;
          if (r.event === 'Pay Initiated') platformFunnelPast4[r.platform].PayInitiated += r.count;
          if (r.event === 'Purchase') platformFunnelPast4[r.platform].Purchase += r.count;
        }
        if (isLast7 && r.hour <= currentHour) {
          ensurePlatObj(platformFunnelLast7, r.platform);
          if (r.event === 'Plan Page Loaded') platformFunnelLast7[r.platform].PlanPageLoaded += r.count;
          if (r.event === 'Plan Selected') platformFunnelLast7[r.platform].PlanSelected += r.count;
          if (r.event === 'Pay Initiated') platformFunnelLast7[r.platform].PayInitiated += r.count;
          if (r.event === 'Purchase') platformFunnelLast7[r.platform].Purchase += r.count;
        }
      }
    });

    const uniquePast4Count = new Set(rawData.filter(r => past4Dates.includes(r.dateStr)).map(r => r.dateStr)).size || 1;
    const uniqueLast7Count = new Set(rawData.filter(r => last7Dates.includes(r.dateStr)).map(r => r.dateStr)).size || 1;

    // Hourly Trend Arrays
    const hourlyTrendData = Array.from({length: 24}, (_, h) => {
      const todayVal = h <= currentHour ? todayHourlySums[h] : null;
      const past4Avg = past4HourlySums[h] / uniquePast4Count;
      const last7Avg = last7HourlySums[h] / uniqueLast7Count;
      return { hour: h, today: todayVal, past4Avg, last7Avg };
    });

    // Totals & Current Hour Pacing
    let past4Total = 0, past4CurrentHourSum = 0;
    let last7Total = 0, last7CurrentHourSum = 0;

    for (let h = 0; h < 24; h++) {
      past4Total += hourlyTrendData[h].past4Avg;
      last7Total += hourlyTrendData[h].last7Avg;

      if (h <= currentHour) {
        past4CurrentHourSum += hourlyTrendData[h].past4Avg;
        last7CurrentHourSum += hourlyTrendData[h].last7Avg;
      }
    }

    // Platform Averages
    const platformFunnelPast4Avg = {};
    Object.keys(platformFunnelPast4).forEach(plat => {
      const p = platformFunnelPast4[plat];
      platformFunnelPast4Avg[plat] = {
        PlanPageLoaded: Math.round(p.PlanPageLoaded / uniquePast4Count),
        PlanSelected: Math.round(p.PlanSelected / uniquePast4Count),
        PayInitiated: Math.round(p.PayInitiated / uniquePast4Count),
        Purchase: Math.round(p.Purchase / uniquePast4Count),
      };
    });

    const platformFunnelLast7Avg = {};
    Object.keys(platformFunnelLast7).forEach(plat => {
      const p = platformFunnelLast7[plat];
      platformFunnelLast7Avg[plat] = {
        PlanPageLoaded: Math.round(p.PlanPageLoaded / uniqueLast7Count),
        PlanSelected: Math.round(p.PlanSelected / uniqueLast7Count),
        PayInitiated: Math.round(p.PayInitiated / uniqueLast7Count),
        Purchase: Math.round(p.Purchase / uniqueLast7Count),
      };
    });

    const projectedTotal4Week = past4CurrentHourSum > 0 
      ? (todayPurchases / past4CurrentHourSum) * past4Total 
      : todayPurchases * (24 / (currentHour + 1));

    const projectedTotal7Day = last7CurrentHourSum > 0 
      ? (todayPurchases / last7CurrentHourSum) * last7Total 
      : todayPurchases * (24 / (currentHour + 1));

    return {
      todayDate: todayDateStr,
      currentHour,
      todayPurchases,
      projectedTotal: realtimeCompMode === "4-Week" ? projectedTotal4Week : projectedTotal7Day,
      
      // Comparison active values
      benchmarkTitle: realtimeCompMode === "4-Week" ? "Past 4-Week Avg (Same Day)" : "Last 7-Days Avg",
      benchmarkShort: realtimeCompMode === "4-Week" ? "4-Week Avg" : "7-Day Avg",
      benchmarkTotal: realtimeCompMode === "4-Week" ? past4Total : last7Total,
      benchmarkCurrentHour: realtimeCompMode === "4-Week" ? past4CurrentHourSum : last7CurrentHourSum,
      
      hourlyTrend: hourlyTrendData,
      platformToday: platformFunnelToday,
      platformBenchmark: realtimeCompMode === "4-Week" ? platformFunnelPast4Avg : platformFunnelLast7Avg
    };
  }, [rawData, realtimeCompMode]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-warm-muted dark:text-dark-muted">
        <Loader2 className="animate-spin mb-4" size={32} />
        <p className="font-semibold text-base tracking-wide">Fetching realtime data...</p>
      </div>
    );
  }

  if (!processedData) {
    return <div className="p-4 text-red-500 font-bold">No realtime data available.</div>;
  }

  const {
    todayDate,
    currentHour,
    todayPurchases,
    projectedTotal,
    benchmarkTitle,
    benchmarkShort,
    benchmarkTotal,
    benchmarkCurrentHour,
    hourlyTrend,
    platformToday,
    platformBenchmark
  } = processedData;

  const hours = Array.from({length: 24}, (_, i) => i);
  const activePlatforms = [...new Set([...Object.keys(platformToday), ...Object.keys(platformBenchmark)])].sort();

  return (
    <div className="animate-in fade-in duration-300 pb-12">
      {/* Realtime Header + Top Right Comparison Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            Realtime Live Forecast
          </h2>
          <p className="text-base font-medium text-warm-muted dark:text-dark-muted mt-1 tracking-wide">
            Monitoring data for <strong className="text-warm-text dark:text-dark-text">{todayDate}</strong> up to hour <strong className="text-warm-text dark:text-dark-text">{String(currentHour + 1).padStart(2, '0')}:00</strong>
          </p>
        </div>

        {/* Comparison Mode Toggle */}
        <div className="flex items-center bg-warm-tableBg dark:bg-zinc-800 p-1 rounded-full border border-warm-border dark:border-zinc-700 shadow-sm self-start sm:self-auto">
          <button
            onClick={() => setRealtimeCompMode("4-Week")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer ${
              realtimeCompMode === "4-Week"
                ? "bg-white dark:bg-slate-700 text-amber-accent shadow-sm"
                : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
            }`}
          >
            Past 4-Week Avg (Same Day)
          </button>
          <button
            onClick={() => setRealtimeCompMode("7-Day")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer ${
              realtimeCompMode === "7-Day"
                ? "bg-white dark:bg-slate-700 text-amber-accent shadow-sm"
                : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
            }`}
          >
            Last 7-Days Avg
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Purchases Today (So far)</h3>
          <span className="text-4xl font-black text-warm-text dark:text-dark-text tracking-tight">{Math.round(todayPurchases).toLocaleString()}</span>
        </div>
        
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 ring-1 ring-amber-500/30 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 opacity-10">
            <Sun size={48} />
          </div>
          <h3 className="text-[11px] font-bold text-amber-accent dark:text-amber-500 tracking-wider uppercase mb-1">Estimated Today (EOD)</h3>
          <span className="text-4xl font-black text-amber-accent dark:text-amber-400 tracking-tight">{Math.round(projectedTotal).toLocaleString()}</span>
        </div>

        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">{benchmarkTitle}</h3>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{Math.round(benchmarkTotal).toLocaleString()}</span>
            <span className="text-xs text-warm-muted dark:text-dark-muted pb-1 font-bold">Total EOD</span>
          </div>
        </div>

        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
           <h3 className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Pacing vs History</h3>
           <div className="flex items-end gap-2">
              <span className={`text-3xl font-black tracking-tight ${todayPurchases >= benchmarkCurrentHour ? 'text-emerald-500' : 'text-red-500'}`}>
                {benchmarkCurrentHour > 0 ? ((todayPurchases / benchmarkCurrentHour - 1) * 100).toFixed(1) : 0}%
              </span>
           </div>
           <p className="text-xs font-bold text-warm-muted dark:text-dark-muted mt-1">vs {benchmarkShort} (up to hour {String(currentHour + 1).padStart(2, '0')}:00)</p>
        </div>
      </section>

      {/* Hourly Trend Chart */}
      <section className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 mb-6">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-4">
          Hourly Purchase Velocity (Today vs {benchmarkShort})
        </h3>
        <div className="w-full h-[300px]">
          <Plot
            data={[
              {
                x: hours,
                y: hourlyTrend.map(h => h.today),
                type: 'scatter',
                mode: 'lines',
                name: 'Today',
                line: { color: isDark ? '#fbbf24' : '#d97706', width: 3, shape: 'spline' },
                hovertemplate: '  <b>%{y}</b>  <extra></extra>'
              },
              {
                x: hours,
                y: hourlyTrend.map(h => realtimeCompMode === "4-Week" ? h.past4Avg : h.last7Avg),
                type: 'scatter',
                mode: 'lines',
                name: benchmarkShort,
                line: { color: isDark ? '#64748B' : '#94A3B8', width: 2, dash: 'dot', shape: 'spline' },
                hovertemplate: '  <b>%{y:.1f}</b>  <extra></extra>'
              }
            ]}
            layout={{
              autosize: true,
              margin: { l: 50, r: 20, t: 20, b: 40 },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              xaxis: { 
                title: 'Hour of Day (0-23)',
                range: [0, 23],
                zeroline: true,
                zerolinecolor: isDark ? '#334155' : '#E2E8F0',
                showgrid: false,
                tickfont: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 11, weight: 'bold' },
                tickmode: 'array',
                tickvals: [5, 10, 15, 20]
              },
              yaxis: { 
                title: 'Purchases',
                automargin: true,
                zeroline: true,
                zerolinecolor: isDark ? '#334155' : '#E2E8F0',
                gridcolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
                tickfont: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 11, weight: 'bold' }
              },
              legend: { orientation: 'h', y: -0.2, font: { color: isDark ? '#94A3B8' : '#64748B', family: 'inherit' } },
              hovermode: 'x unified'
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </section>

      {/* Realtime Platform Funnel Table with Multi-level Headers */}
      <section className="mt-8">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">Today's Live Platform Breakdown</h3>
        <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-lg custom-scrollbar overflow-x-auto shadow-sm relative">
          <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 shadow-sm">
              {/* Level 1 Group Header Row */}
              <tr className="text-warm-muted dark:text-dark-muted uppercase font-extrabold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                <th rowSpan={2} className="p-3 whitespace-nowrap bg-warm-tableBg dark:bg-[#1E293B] border-r border-warm-border dark:border-dark-border align-bottom">
                  Platform
                </th>
                <th colSpan={4} className="p-2.5 text-center bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400 border-b border-r border-amber-500/30 font-black">
                  Today's Performance
                </th>
                <th colSpan={4} className="p-2.5 text-center bg-[#DBEAFE] dark:bg-[#1E293B] text-blue-600 dark:text-blue-400 border-b border-blue-500/30 font-black">
                  {benchmarkTitle} <span className="text-[10px] font-bold opacity-80">(Up to hour {String(currentHour + 1).padStart(2, '0')}:00)</span>
                </th>
              </tr>

              {/* Level 2 Sub-header Row */}
              <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-[11px] tracking-wider border-b border-warm-border dark:border-dark-border">
                {/* Today's Columns */}
                <th className="p-2.5 whitespace-nowrap text-right bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-700 dark:text-amber-300 font-extrabold">Plan Page Load</th>
                <th className="p-2.5 whitespace-nowrap text-right bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-700 dark:text-amber-300 font-extrabold">Plan Selected</th>
                <th className="p-2.5 whitespace-nowrap text-right bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-700 dark:text-amber-300 font-extrabold">Pay Initiated</th>
                <th className="p-2.5 whitespace-nowrap text-right bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-700 dark:text-amber-300 font-extrabold border-r border-amber-500/30">Purchase</th>

                {/* Benchmark Columns */}
                <th className="p-2.5 whitespace-nowrap text-right bg-[#DBEAFE] dark:bg-[#1E293B] text-blue-700 dark:text-blue-300 font-extrabold">Plan Page Load</th>
                <th className="p-2.5 whitespace-nowrap text-right bg-[#DBEAFE] dark:bg-[#1E293B] text-blue-700 dark:text-blue-300 font-extrabold">Plan Selected</th>
                <th className="p-2.5 whitespace-nowrap text-right bg-[#DBEAFE] dark:bg-[#1E293B] text-blue-700 dark:text-blue-300 font-extrabold">Pay Initiated</th>
                <th className="p-2.5 whitespace-nowrap text-right bg-[#DBEAFE] dark:bg-[#1E293B] text-blue-700 dark:text-blue-300 font-extrabold">Purchase</th>
              </tr>
            </thead>
            <tbody>
              {activePlatforms.map(plat => {
                const tData = platformToday[plat] || { PlanPageLoaded: 0, PlanSelected: 0, PayInitiated: 0, Purchase: 0 };
                const bData = platformBenchmark[plat] || { PlanPageLoaded: 0, PlanSelected: 0, PayInitiated: 0, Purchase: 0 };

                return (
                  <tr key={plat} className="border-b border-warm-border/50 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5 font-semibold text-warm-text dark:text-dark-text transition-colors">
                    <td className="p-3 whitespace-nowrap font-bold text-amber-accent dark:text-amber-400 border-r border-warm-border/30 dark:border-zinc-800">{plat}</td>
                    
                    {/* Today's Data with % comparison badge */}
                    {['PlanPageLoaded', 'PlanSelected', 'PayInitiated', 'Purchase'].map((key, idx) => {
                      const tVal = tData[key] || 0;
                      const bVal = bData[key] || 0;
                      let diffPct = null;
                      if (bVal > 0) {
                        diffPct = (((tVal - bVal) / bVal) * 100).toFixed(1);
                      }
                      const isLast = idx === 3;

                      return (
                        <td key={key} className={`p-3 whitespace-nowrap text-right ${isLast ? 'border-r border-warm-border/30 dark:border-zinc-800' : ''}`}>
                          <div className="font-extrabold text-sm text-warm-text dark:text-dark-text">{tVal.toLocaleString()}</div>
                          {diffPct !== null ? (
                            <div className="flex items-center justify-end mt-0.5">
                              <span className={`text-[10px] font-extrabold px-1.5 py-0.2 rounded ${
                                parseFloat(diffPct) >= 0
                                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
                              }`}>
                                {parseFloat(diffPct) >= 0 ? `+${diffPct}%` : `${diffPct}%`}
                              </span>
                            </div>
                          ) : (
                            <div className="text-[10px] text-warm-muted dark:text-dark-muted font-medium mt-0.5">-</div>
                          )}
                        </td>
                      );
                    })}

                    {/* Benchmark Data */}
                    <td className="p-3 whitespace-nowrap text-right font-medium text-warm-muted dark:text-dark-muted">{bData.PlanPageLoaded.toLocaleString()}</td>
                    <td className="p-3 whitespace-nowrap text-right font-medium text-warm-muted dark:text-dark-muted">{bData.PlanSelected.toLocaleString()}</td>
                    <td className="p-3 whitespace-nowrap text-right font-medium text-warm-muted dark:text-dark-muted">{bData.PayInitiated.toLocaleString()}</td>
                    <td className="p-3 whitespace-nowrap text-right font-medium text-warm-muted dark:text-dark-muted">{bData.Purchase.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
