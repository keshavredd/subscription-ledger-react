import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { processConversationalQuery, processConversationalQueryAsync } from './utils/aiDataEngine';
import { getStoredApiKey, setStoredApiKey } from './services/geminiService';
import { getStoredLlamaConfig, setStoredLlamaConfig } from './services/llamaService';
import { buildPlotlyConfig } from './utils/chartHelper';
import Papa from 'papaparse';
import { Sun, Moon, ChevronDown, ChevronRight, Loader2, Bot, User, Send, Sparkles, Trash2, HelpCircle, RefreshCw, BarChart2, Globe, ShieldAlert, ArrowRight, MessageSquare, Key, Check, LogOut, ShieldCheck } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

import LoginScreen from './components/LoginScreen';
import AdminPanel from './components/AdminPanel';
import { isAdminEmail, isUserAuthorized, isUserAuthorizedAsync, logTabPageView, logChatQuery } from './services/telemetryService';
import { logoutUser, auth, onAuthStateChanged } from './services/firebaseService';
import { fetchDatasetCached, DATASET_URLS, preloadAllDashboardData } from './services/dataPreloader';
import { RenewalHeatmap, RenewalRateVsVolumeChart, RecurringDonutsSection } from './components/RenewalVisuals';

const Plot = createPlotlyComponent(Plotly);

const DEFAULT_GSHEET_URL = "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=598826199";
const FUNNEL_GSHEET_URL = "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1049115614";
const REALTIME_GSHEET_URL = "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1333104452";
const ARPU_GSHEET_URL = "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=arpu_data";

function formatArpuPlatform(platStr) {
  if (!platStr) return 'Web';
  const clean = String(platStr).toLowerCase().trim();
  if (clean.includes('market') && clean.includes('android')) return 'Market Android';
  if (clean.includes('market') && clean.includes('ios')) return 'Market iOS';
  if (clean.includes('android')) return 'Main Android';
  if (clean.includes('ios')) return 'Main iOS';
  if (clean.includes('wap') || clean.includes('mweb')) return 'WAP';
  if (clean.includes('web') || clean.includes('desktop')) return 'Web';
  return platStr;
}

function formatArpuDate(rawDateStr) {
  if (!rawDateStr) return '';
  const str = String(rawDateStr).trim();
  if (str.length === 8 && !str.includes('-') && !str.includes('/')) {
    return `${str.substring(0,4)}-${str.substring(4,6)}-${str.substring(6,8)}`;
  }
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      let year = parts[2].trim();
      if (year.length === 2) year = `20${year}`;
      return `${year}-${month}-${day}`;
    }
  }
  if (str.includes('-')) {
    const parts = str.split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) return str;
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  return str;
}

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

function CleanDashboardLoader({ title = "Fetching realtime data...", subtitle = "Updating live platform telemetry & 4-week benchmark data" }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 w-full text-center select-none animate-in fade-in duration-300">
      {/* Premium Multi-Layered GPU Orbit Loader */}
      <div className="relative mb-6 flex items-center justify-center">
        {/* Soft Ambient Breathing Backlight Glow */}
        <div className="absolute h-20 w-20 rounded-full bg-gradient-to-tr from-amber-500/20 via-orange-500/15 to-rose-500/20 blur-2xl gpu-breathe pointer-events-none" />
        
        {/* SVG Dash-Offset Smooth Spinner */}
        <svg className="h-16 w-16" viewBox="0 0 50 50">
          {/* Subtle Background Track */}
          <circle
            className="text-amber-500/15 dark:text-zinc-800"
            strokeWidth="3.5"
            stroke="currentColor"
            fill="transparent"
            r="20"
            cx="25"
            cy="25"
          />
          {/* Vibrant Animated Arc */}
          <circle
            className="gpu-svg-dash"
            strokeWidth="3.8"
            stroke="url(#loaderAmberGradient)"
            fill="transparent"
            r="20"
            cx="25"
            cy="25"
          />
          <defs>
            <linearGradient id="loaderAmberGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#F59E0B" />
              <stop offset="50%" stopColor="#FB923C" />
              <stop offset="100%" stopColor="#ED1C24" />
            </linearGradient>
          </defs>
        </svg>

        {/* Counter-Spinning Subtle Inner Orbit Ring */}
        <div className="absolute h-9 w-9 rounded-full border border-dashed border-amber-500/30 dark:border-amber-400/25 gpu-counter-spin pointer-events-none" />

        {/* Center Glowing ET Micro-Badge Core */}
        <div className="absolute h-5 w-5 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-md shadow-amber-500/30 gpu-breathe">
          <div className="h-1.5 w-1.5 rounded-full bg-white shadow-xs" />
        </div>
      </div>

      {/* Typography */}
      <h4 className="text-sm sm:text-base font-extrabold text-warm-text dark:text-dark-text tracking-tight mb-1">
        {title}
      </h4>
      <p className="text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wide max-w-sm leading-relaxed">
        {subtitle}
      </p>

      {/* Pure GPU Compositor Hardware Shimmer Bar */}
      <div className="w-52 h-1.5 bg-warm-border/60 dark:bg-zinc-800/80 rounded-full overflow-hidden mt-5 relative shadow-inner">
        <div className="absolute inset-y-0 bg-gradient-to-r from-amber-400 via-rose-500 to-amber-400 gpu-shimmer-progress rounded-full" />
      </div>
    </div>
  );
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
        <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-30">
            <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider">
              <th className="p-3 whitespace-nowrap bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text border-b border-r border-warm-border dark:border-dark-border sticky left-0 top-0 z-50">Plan Category</th>
              {platforms.map(col => (
                <th key={col} className="p-3 whitespace-nowrap bg-white dark:bg-[#1E293B] border-b border-warm-border dark:border-dark-border text-right">{col}</th>
              ))}
            </tr>
            <tr className="period-total-row text-warm-totalText dark:text-dark-totalText font-bold border-b border-warm-border dark:border-dark-border">
              <td className="p-3 whitespace-nowrap bg-[#FEF3C7] dark:bg-[#1E293B] font-black text-amber-600 dark:text-amber-400 sticky left-0 z-40 border-r border-warm-border dark:border-dark-border" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
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
                  <td className="p-3 whitespace-nowrap font-bold sticky left-0 z-20 bg-white dark:bg-[#0F172A] border-r border-warm-border/30 dark:border-zinc-800">{p}</td>
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
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 640 : false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    showscale: !isMobile,
    colorbar: {
      title: { text: 'Revenue Heatmap', font: { size: 11, color: isDark ? '#d1d5db' : '#374151' } },
      tickfont: { size: 9, color: isDark ? '#9ca3af' : '#6b7280' },
      len: 0.75,
      thickness: 10
    }
  }];

  return (
    <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-3.5 sm:p-5 mt-6 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 sm:mb-4">
        <div>
          <h3 className="text-sm sm:text-base font-bold text-warm-text dark:text-dark-text px-1">Geographic Revenue Distribution (World Map)</h3>
          <p className="text-xs text-warm-muted dark:text-dark-muted px-1 mt-0.5">Interactive Revenue Heatmap across Countries (Scaled for Global Visibility)</p>
        </div>
      </div>
      <div className="w-full h-[280px] sm:h-[450px] rounded-lg overflow-hidden border border-warm-border/50 dark:border-zinc-800">
        <Plot
          data={mapData}
          layout={{
            autosize: true,
            margin: isMobile ? { t: 0, r: 0, b: 0, l: 0 } : { t: 5, r: 5, b: 5, l: 5 },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            geo: {
              showframe: false,
              showcoastlines: true,
              coastlinecolor: isDark ? '#475569' : '#cbd5e1',
              projection: {
                type: 'natural earth',
                scale: isMobile ? 1.7 : 1.45
              },
              center: isMobile ? { lon: 25, lat: 15 } : { lon: 20, lat: 15 },
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
  const [revenueTrendViewMode, setRevenueTrendViewMode] = useState("Daily"); // "Daily" | "Weekly"

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
    function processParsedData(dataArray) {
      if (!dataArray || !Array.isArray(dataArray)) return;
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
          plan_tenure: getPlanTenureCategory(planCategory),
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

    async function fetchData() {
      if (!rawData || rawData.length === 0) setLoading(true);
      setError(null);
      try {
        const results = await fetchDatasetCached('subscription', DEFAULT_GSHEET_URL);
        if (results && results.data) processParsedData(results.data);
      } catch (err) {
        console.warn("Subscription report fetch error", err);
        setError("Failed to load subscription data.");
        setLoading(false);
      }
    }

    fetchData();

    const handleDatasetUpdated = (e) => {
      if (e.detail && e.detail.key === 'subscription' && e.detail.data) {
        console.log("⚡ [Subscription UI] Background live Google Sheet update received!");
        processParsedData(e.detail.data);
      }
    };
    window.addEventListener('dataset-updated', handleDatasetUpdated);
    return () => window.removeEventListener('dataset-updated', handleDatasetUpdated);
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

    let categories = [...categorySet].sort();
    if (field === 'platformDisplay') {
      const order = ['Main - Android', 'Main - IOS', 'Market - Android', 'Market - IOS', 'WAP', 'WEB'];
      categories.sort((a, b) => {
        const idxA = order.indexOf(a);
        const idxB = order.indexOf(b);
        return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
      });
    } else if (field === 'user_txn_type') {
      const order = ['new', 'auto_renewal', 'manual_renewal', 'renewal', 'upgrade', 'expired', 'existing', 'unknown'];
      categories.sort((a, b) => {
        const cleanA = a.toLowerCase();
        const cleanB = b.toLowerCase();
        const idxA = order.findIndex(o => cleanA === o || cleanA.includes(o));
        const idxB = order.findIndex(o => cleanB === o || cleanB.includes(o));
        return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
      });
    } else if (field === 'plan_tenure') {
      const order = ['< 1 Year', '1-3 Years', '> 3 Years'];
      categories.sort((a, b) => {
        const idxA = order.indexOf(a);
        const idxB = order.indexOf(b);
        return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
      });
    }
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

    if (revenueTrendViewMode === "Weekly") {
      const getWeekInfo = (dateStr) => {
        if (!dateStr) return { key: '', label: '' };
        const parts = dateStr.includes('-') ? dateStr.split('-') : dateStr.split('/');
        let d;
        if (dateStr.includes('-') && parts.length === 3) {
          d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        } else if (dateStr.includes('/') && parts.length === 3) {
          d = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
        } else {
          d = new Date(dateStr);
        }
        if (isNaN(d.getTime())) return { key: dateStr, label: dateStr };
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.getFullYear(), d.getMonth(), diff);
        const mStr = String(monday.getMonth() + 1).padStart(2, '0');
        const dStr = String(monday.getDate()).padStart(2, '0');
        const weekKey = `${monday.getFullYear()}-${mStr}-${dStr}`;
        
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const weekLabel = `Wk ${monday.getDate()} ${monthNames[monday.getMonth()]}`;
        return { key: weekKey, label: weekLabel };
      };

      const weekMap = {};
      filteredData.forEach(r => {
        if (r.dateStr) {
          const { key, label } = getWeekInfo(r.dateStr);
          if (key && !weekMap[key]) weekMap[key] = label;
        }
      });
      const sortedWeekKeys = Object.keys(weekMap).sort();
      const weekLabels = sortedWeekKeys.map(k => weekMap[k]);

      if (trendDataCut === 'Overall') {
        const revMap = {};
        filteredData.forEach(r => {
          if (r.dateStr) {
            const { key } = getWeekInfo(r.dateStr);
            revMap[key] = (revMap[key] || 0) + (r.revenue || 0);
          }
        });
        const revValues = sortedWeekKeys.map(k => revMap[k] || 0);

        return [{
          x: weekLabels,
          y: revValues,
          type: 'scatter',
          mode: 'lines+markers+text',
          name: 'Overall Weekly Revenue',
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
          hovertemplate: "<b>%{x}</b><br>Overall Weekly Revenue: ₹%{y:,.2f}<extra></extra>"
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
          if (r[fieldKey] === cat && r.dateStr) {
            const { key } = getWeekInfo(r.dateStr);
            catRevMap[key] = (catRevMap[key] || 0) + (r.revenue || 0);
          }
        });
        const catRevs = sortedWeekKeys.map(k => catRevMap[k] || 0);

        return {
          x: weekLabels,
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
          hovertemplate: `<b>${cat}</b><br>%{x}<br>Weekly Revenue: ₹%{y:,.2f}<extra></extra>`
        };
      });
    }

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
  }, [filteredData, trendDataCut, revenueTrendViewMode, isDark]);

  const platformPivot = useMemo(() => buildPivotData('platformDisplay'), [buildPivotData]);
  const userTypePivot = useMemo(() => buildPivotData('user_txn_type'), [buildPivotData]);
  const tenurePivot = useMemo(() => buildPivotData('plan_tenure'), [buildPivotData]);
  const planPivot = useMemo(() => buildPivotData('plan_category'), [buildPivotData]);
  const channelPivot = useMemo(() => buildPivotData('channel'), [buildPivotData]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm my-6 p-4">
        <CleanDashboardLoader title="Loading Subscription Data..." subtitle="Fetching and aggregating subscription lifecycle metrics" />
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
      
      {/* Date Range Selector Bar (Header & Dropdown Inline for More Screen Real Estate) */}
      <div className="flex flex-row items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base sm:text-xl font-bold text-warm-text dark:text-dark-text tracking-tight">Subscription Performance Report</h2>
          <span className="text-xs text-warm-muted dark:text-dark-muted font-medium hidden sm:inline">• {dateRangeStr}</span>
        </div>

        <div className="flex items-center gap-2">
          {datePreset === "Custom range" && (
            <div className="flex items-center gap-1.5 mr-1">
              <input type="date" value={startDate} min={minDateLimit} max={maxDateLimit} onChange={(e) => setStartDate(e.target.value)} className="px-2 py-1 text-xs font-medium rounded-lg bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent" />
              <span className="text-xs text-warm-muted dark:text-dark-muted">to</span>
              <input type="date" value={endDate} min={minDateLimit} max={maxDateLimit} onChange={(e) => setEndDate(e.target.value)} className="px-2 py-1 text-xs font-medium rounded-lg bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent" />
            </div>
          )}
          <div className="relative">
            <select 
              value={datePreset} 
              onChange={(e) => setDatePreset(e.target.value)}
              className="appearance-none bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-xs font-bold rounded-lg pl-3 pr-7 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-xs cursor-pointer"
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 p-4 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm w-full">
        
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
      <section className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="p-4 sm:p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Total Revenue</div>
          <div className="text-2xl sm:text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{formatIndianCurrency(metrics.totalRev)}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg: <span className="font-bold text-amber-accent">{formatIndianCurrency(metrics.dailyAvgRev)}/day</span> <br />
            <span className="text-[10px] hidden sm:inline">{dateRangeStr} ({metrics.numDays} days)</span>
          </div>
        </div>

        <div className="p-4 sm:p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Conversions</div>
          <div className="text-2xl sm:text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{metrics.conversionsExclAuto.toLocaleString()}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg: <span className="font-bold text-amber-accent">{metrics.dailyAvgConvExcl.toFixed(0)}/day</span> <br />
            <span>Total conversions: {metrics.totalConversions.toLocaleString()}</span>
          </div>
        </div>

        <div className="p-4 sm:p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Avg Revenue / Txn</div>
          <div className="text-2xl sm:text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{formatIndianCurrency(metrics.avgRevPerTxn)}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg volume: <span className="font-bold text-amber-accent">{metrics.dailyAvgTxns.toFixed(0)} txns/day</span> <br />
            <span>Across {metrics.totalTxns.toLocaleString()} transactions</span>
          </div>
        </div>

        <div className="p-4 sm:p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Recurring Rate (New)</div>
          <div className="text-2xl sm:text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{(metrics.recurringRate * 100).toFixed(1)}%</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            <span className="font-bold text-amber-accent">{metrics.recurringTrueCount} recurring transactions</span>
          </div>
        </div>
      </section>

      {/* Daily revenue trend Chart with Pill Toggle Cuts & 1 Decimal Data Labels */}
      <section className="mb-6 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text px-1">
              {revenueTrendViewMode === 'Weekly' ? 'Weekly' : 'Daily'} Revenue Trend {trendDataCut !== 'Overall' ? `(${trendDataCut} Split)` : ''}
            </h3>
            <p className="text-xs text-warm-muted dark:text-dark-muted px-1 mt-0.5">
              {revenueTrendViewMode === 'Weekly' ? 'Weekly' : 'Daily'} revenue trajectory for selected date range
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap self-start sm:self-auto">
            {/* Daily / Weekly View Mode Switch */}
            <div className="flex items-center bg-warm-tableBg dark:bg-zinc-800 p-1 rounded-full border border-warm-border dark:border-zinc-700 shadow-sm">
              {['Daily', 'Weekly'].map(mode => (
                <button
                  key={mode}
                  onClick={() => setRevenueTrendViewMode(mode)}
                  className={`px-3 py-1 text-xs font-bold rounded-full transition-all cursor-pointer ${
                    revenueTrendViewMode === mode
                      ? "bg-white dark:bg-slate-700 text-amber-accent shadow-sm"
                      : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            {/* Pill-like Toggle Bar for Trend Data Cuts */}
            <div className="flex items-center bg-warm-tableBg dark:bg-zinc-800 p-1 rounded-full border border-warm-border dark:border-zinc-700 shadow-sm">
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

      {/* Tables & Visualizations in 2-Column Split:
          1. Platform-wise Table (Left) + Platform Revenue Share Trend Stacked Area (Right)
          2. User-type-wise Table (Left) + User Type Revenue Share Trend Stacked Area (Right)
          3. Geographical Chart (100% full width, untouched)
          4. Channel-wise Table (Left) + Channel Revenue & Conversions Stacked Column (Right)
          5. Plan Duration Tenure Table (Left) + Plan Duration Tenure Stacked Column (Right)
          6. Plan-wise Table (Left) + Plan Revenue Dominance Treemap (Right)
      */}
      <section className="flex flex-col gap-8">
        {/* Row 1: Platform Table & Stacked Area Chart */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
          <div className="xl:col-span-6 overflow-hidden">
            <PivotTable 
              pivotData={platformPivot} 
              title="Platform-wise Revenue & Conversions"
              metricMode={tableMetricMode}
              isDark={isDark}
            />
          </div>
          <div className="xl:col-span-6">
            <StackedAreaTrendChart
              pivotData={platformPivot}
              title="Platform-wise Revenue & Conversions"
              colorMap={{
                'Main - Android': '#C2410C', // Deep burnt ember red-orange (Bottom layer)
                'main - android': '#C2410C',
                'Main - IOS': '#EA580C',     // Warm fiery ember orange
                'Main - iOS': '#EA580C',
                'main - ios': '#EA580C',
                'Market - Android': '#9A3412', // Rich burnt chestnut / russet brown
                'market - android': '#9A3412',
                'Market - IOS': '#D97706',   // Golden amber ochre
                'Market - iOS': '#D97706',
                'market - ios': '#D97706',
                'WAP': '#F59E0B',            // Vibrant golden yellow / marigold
                'wap': '#F59E0B',
                'MWeb': '#F59E0B',
                'mweb': '#F59E0B',
                'WEB': '#FEF08A',            // Soft luminous pale ember yellow glow (Top layer)
                'Web': '#FEF08A',
                'web': '#FEF08A'
              }}
              isDark={isDark}
            />
          </div>
        </div>

        {/* Row 2: User-type Table & Stacked Area Chart */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
          <div className="xl:col-span-6 overflow-hidden">
            <PivotTable 
              pivotData={userTypePivot} 
              title="User-type-wise Revenue & Conversions"
              metricMode={tableMetricMode}
              isDark={isDark}
            />
          </div>
          <div className="xl:col-span-6">
            <StackedAreaTrendChart
              pivotData={userTypePivot}
              title="User-type-wise Revenue & Conversions"
              colorMap={{
                'new': '#C2410C',            // Deep burnt ember red-orange (Bottom layer)
                'New': '#C2410C',
                'auto_renewal': '#EA580C',    // Warm fiery ember orange
                'Auto Renewal': '#EA580C',
                'auto_renew': '#EA580C',
                'Auto Renew': '#EA580C',
                'renewal': '#EA580C',        // Warm fiery ember orange
                'Renewal': '#EA580C',
                'manual_renewal': '#9A3412', // Rich burnt chestnut / russet brown
                'Manual Renewal': '#9A3412',
                'upgrade': '#D97706',        // Golden amber ochre
                'Upgrade': '#D97706',
                'existing': '#F59E0B',       // Vibrant golden yellow / marigold
                'Existing': '#F59E0B',
                'expired': '#FEF08A',        // Soft luminous pale ember yellow glow (Top layer)
                'Expired': '#FEF08A',
                'unknown': '#FEF3C7',
                'Unknown': '#FEF3C7'
              }}
              isDark={isDark}
            />
          </div>
        </div>
        
        {/* Geographical Chart (Full width, untouched) */}
        <GeoDistributionChart 
          geoData={geoData} 
          isDark={isDark}
        />

        {/* Row 3: Channel Table & Stacked Column Chart */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
          <div className="xl:col-span-6 overflow-hidden">
            <PivotTable 
              pivotData={channelPivot} 
              title="Channel-wise Revenue & Conversions"
              metricMode={tableMetricMode}
              isDark={isDark}
            />
          </div>
          <div className="xl:col-span-6">
            <StackedColumnTrendChart
              pivotData={channelPivot}
              title="Channel-wise Revenue & Conversions"
              colorMap={{
                'Google Search': '#059669',
                'Meta Ads': '#EA580C',
                'Direct': '#D97706',
                'Organic': '#10B981',
                'Organic Search': '#10B981',
                'Affiliate': '#B45309',
                'Partner': '#78350F',
                'Email': '#F59E0B',
                'Social': '#FBBF24',
                'Other': '#854D0E'
              }}
              initialMetric={tableMetricMode}
              isDark={isDark}
            />
          </div>
        </div>

        {/* Row 4: Plan Duration Tenure Table & Stacked Column Chart */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
          <div className="xl:col-span-6 overflow-hidden">
            <PivotTable 
              pivotData={tenurePivot} 
              title="Plan Duration Tenure-wise Revenue & Conversions"
              metricMode={tableMetricMode}
              isDark={isDark}
            />
          </div>
          <div className="xl:col-span-6">
            <StackedColumnTrendChart
              pivotData={tenurePivot}
              title="Plan Duration Tenure-wise Revenue & Conversions"
              colorMap={{
                '< 1 Year': '#FACC15',
                '1-3 Years': '#F59E0B',
                '> 3 Years': '#9A3412'
              }}
              initialMetric={tableMetricMode}
              isDark={isDark}
            />
          </div>
        </div>

        {/* Row 5: Plan Table & Plan Revenue Dominance Treemap */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
          <div className="xl:col-span-6 overflow-hidden">
            <PivotTable 
              pivotData={planPivot} 
              title="Plan-wise Revenue & Conversions"
              metricMode={tableMetricMode}
              isDark={isDark}
            />
          </div>
          <div className="xl:col-span-6">
            <PlanTreemapChart
              pivotData={planPivot}
              title="Plan-wise Revenue & Conversions"
              isDark={isDark}
            />
          </div>
        </div>
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
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-2 px-1 h-[28px]">
          <h3 className="text-base font-bold text-warm-text dark:text-dark-text truncate">{title}</h3>
        </div>
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5 h-[480px] flex items-center justify-center">
          <p className="text-sm text-warm-muted dark:text-dark-muted">No data available for the selection.</p>
        </div>
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
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 px-1 h-[28px]">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text truncate">{title}</h3>
      </div>
      <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-xl custom-scrollbar overflow-x-auto overflow-y-auto h-[480px] shadow-sm">
        <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-30">
            <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
              <th className="p-3 bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text whitespace-nowrap sticky left-0 top-0 z-50 border-r border-warm-border dark:border-dark-border">Date</th>
              {categories.map(cat => (
                <th key={cat} className="p-3 whitespace-nowrap bg-white dark:bg-[#1E293B] text-right">{cat}</th>
              ))}
              <th className="p-3 bg-white dark:bg-[#1E293B] text-right whitespace-nowrap">Total</th>
            </tr>
            <tr className="period-total-row font-bold text-amber-accent border-b border-warm-border dark:border-dark-border">
              <td className="p-3 whitespace-nowrap bg-[#FEF3C7] dark:bg-[#1E293B] font-black text-amber-600 dark:text-amber-400 sticky left-0 z-40 border-r border-warm-border dark:border-dark-border" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
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
                <td className="p-3 text-warm-muted dark:text-dark-muted whitespace-nowrap font-semibold sticky left-0 z-20 bg-white dark:bg-[#0F172A] border-r border-warm-border/30 dark:border-zinc-800">{row.dateStr}</td>
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
 
function StackedAreaTrendChart({ pivotData, title, colorMap, defaultColors, isDark }) {
  const [viewMode, setViewMode] = useState('percent'); // 'percent' | 'value'
  const { categories, dailyRows } = pivotData;

  const chartData = useMemo(() => {
    if (!dailyRows || !categories || dailyRows.length === 0) return [];
    const chronoRows = [...dailyRows].sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    const dates = chronoRows.map(r => {
      const parts = r.dateStr.split('-');
      if (parts.length === 3) {
        const mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        return `${mNames[m-1]} ${d}`;
      }
      return r.dateStr;
    });

    const colors = defaultColors || ['#C2410C', '#EA580C', '#9A3412', '#D97706', '#F59E0B', '#FEF08A', '#FBBF24', '#78350F'];

    return categories.map((cat, idx) => {
      const color = colorMap?.[cat] || colorMap?.[cat.toLowerCase()] || colors[idx % colors.length];
      const revs = chronoRows.map(r => (r.totals[cat] ? r.totals[cat].rev : 0));

      return {
        x: dates,
        y: revs,
        name: cat,
        stackgroup: 'one',
        groupnorm: viewMode === 'percent' ? 'percent' : undefined,
        mode: 'lines',
        line: { color, width: 1.5, shape: 'spline' },
        fillcolor: color,
        hovertemplate: viewMode === 'percent'
          ? `<b>${cat}</b><br>%{x}<br>Share: %{y:.1f}%<extra></extra>`
          : `<b>${cat}</b><br>%{x}<br>Revenue: ₹%{y:,.0f}<extra></extra>`
      };
    });
  }, [dailyRows, categories, viewMode, colorMap, defaultColors]);

  if (!categories || categories.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-2 px-1 h-[28px]">
          <h3 className="text-base font-bold text-warm-text dark:text-dark-text truncate">{title}</h3>
        </div>
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5 h-[480px] flex items-center justify-center text-center">
          <p className="text-xs text-warm-muted dark:text-dark-muted">No data available to display trend.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 px-1 h-[28px]">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text truncate">{title}</h3>
        <div className="flex items-center bg-warm-tableBg dark:bg-zinc-800 p-0.5 rounded-full border border-warm-border dark:border-zinc-700 shadow-xs shrink-0">
          <button
            onClick={() => setViewMode('percent')}
            className={`px-2.5 py-0.5 text-[10px] font-extrabold rounded-full transition-all cursor-pointer ${
              viewMode === 'percent'
                ? "bg-white dark:bg-slate-700 text-amber-accent shadow-xs"
                : "text-warm-muted dark:text-dark-muted hover:text-warm-text"
            }`}
          >
            % Share
          </button>
          <button
            onClick={() => setViewMode('value')}
            className={`px-2.5 py-0.5 text-[10px] font-extrabold rounded-full transition-all cursor-pointer ${
              viewMode === 'value'
                ? "bg-white dark:bg-slate-700 text-amber-accent shadow-xs"
                : "text-warm-muted dark:text-dark-muted hover:text-warm-text"
            }`}
          >
            ₹ Value
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-3 md:p-4 flex flex-col justify-center h-[480px]">
        <div className="w-full h-full min-h-0">
          <Plot
            data={chartData}
            layout={{
              autosize: true,
              margin: { l: 45, r: 20, t: 15, b: 70 },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              xaxis: {
                tickfont: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 9, weight: 'bold' },
                tickangle: -90,
                showgrid: false,
                zeroline: false
              },
              yaxis: {
                tickfont: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 10, weight: 'bold' },
                gridcolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
                ticksuffix: viewMode === 'percent' ? '%' : '',
                tickprefix: viewMode === 'value' ? '₹' : '',
                range: viewMode === 'percent' ? [0, 100] : undefined
              },
              legend: {
                orientation: 'h',
                traceorder: 'reversed',
                y: -0.28,
                x: 0,
                font: { color: isDark ? '#94A3B8' : '#64748B', size: 10 }
              },
              hovermode: 'x unified'
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}

function StackedColumnTrendChart({ pivotData, title, colorMap, defaultColors, isDark, initialMetric = "Revenue (₹)" }) {
  const [metricMode, setMetricMode] = useState(initialMetric);
  const { categories, dailyRows } = pivotData;

  const chartData = useMemo(() => {
    if (!dailyRows || !categories || dailyRows.length === 0) return [];
    const chronoRows = [...dailyRows].sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    const dates = chronoRows.map(r => {
      const parts = r.dateStr.split('-');
      if (parts.length === 3) {
        const mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        return `${mNames[m-1]} ${d}`;
      }
      return r.dateStr;
    });

    const colors = defaultColors || ['#059669', '#D97706', '#EA580C', '#B45309', '#F59E0B', '#10B981', '#78350F', '#854D0E'];

    return categories.map((cat, idx) => {
      const color = colorMap?.[cat] || colors[idx % colors.length];
      const vals = chronoRows.map(r => {
        const cell = r.totals[cat];
        if (!cell) return 0;
        return metricMode.includes('Conversion') ? cell.conv : cell.rev;
      });

      return {
        x: dates,
        y: vals,
        name: cat,
        type: 'bar',
        marker: { color },
        hovertemplate: metricMode.includes('Conversion')
          ? `<b>${cat}</b><br>%{x}<br>Conversions: %{y:,.0f}<extra></extra>`
          : `<b>${cat}</b><br>%{x}<br>Revenue: ₹%{y:,.0f}<extra></extra>`
      };
    });
  }, [dailyRows, categories, metricMode, colorMap, defaultColors]);

  if (!categories || categories.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-2 px-1 h-[28px]">
          <h3 className="text-base font-bold text-warm-text dark:text-dark-text truncate">{title}</h3>
        </div>
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5 h-[480px] flex items-center justify-center text-center">
          <p className="text-xs text-warm-muted dark:text-dark-muted">No data available to display chart.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 px-1 h-[28px]">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text truncate">{title}</h3>
        <div className="flex items-center bg-warm-tableBg dark:bg-zinc-800 p-0.5 rounded-full border border-warm-border dark:border-zinc-700 shadow-xs shrink-0">
          <button
            onClick={() => setMetricMode("Revenue (₹)")}
            className={`px-2.5 py-0.5 text-[10px] font-extrabold rounded-full transition-all cursor-pointer ${
              !metricMode.includes('Conversion')
                ? "bg-white dark:bg-slate-700 text-amber-accent shadow-xs"
                : "text-warm-muted dark:text-dark-muted hover:text-warm-text"
            }`}
          >
            Revenue (₹)
          </button>
          <button
            onClick={() => setMetricMode("Conversions (#)")}
            className={`px-2.5 py-0.5 text-[10px] font-extrabold rounded-full transition-all cursor-pointer ${
              metricMode.includes('Conversion')
                ? "bg-white dark:bg-slate-700 text-amber-accent shadow-xs"
                : "text-warm-muted dark:text-dark-muted hover:text-warm-text"
            }`}
          >
            Conversions (#)
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-3 md:p-4 flex flex-col justify-center h-[480px]">
        <div className="w-full h-full min-h-0">
          <Plot
            data={chartData}
            layout={{
              barmode: 'stack',
              autosize: true,
              margin: { l: 45, r: 20, t: 15, b: 65 },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              xaxis: {
                tickfont: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 10, weight: 'bold' },
                showgrid: false
              },
              yaxis: {
                tickfont: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 10, weight: 'bold' },
                gridcolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
                tickprefix: !metricMode.includes('Conversion') ? '₹' : ''
              },
              legend: {
                orientation: 'h',
                y: -0.24,
                x: 0,
                font: { color: isDark ? '#94A3B8' : '#64748B', size: 10 }
              },
              hovermode: 'x unified'
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}

function PlanTreemapChart({ pivotData, title = "Plan-wise Revenue & Conversions", isDark }) {
  const { categoryGrandTotals, finalGrandTotalRev } = pivotData;

  const treemapItems = useMemo(() => {
    if (!categoryGrandTotals || finalGrandTotalRev <= 0) return null;
    const sorted = Object.entries(categoryGrandTotals)
      .map(([name, totals]) => ({
        name,
        rev: totals.rev || 0,
        conv: totals.conv || 0
      }))
      .filter(item => item.rev > 0)
      .sort((a, b) => b.rev - a.rev);

    const labels = sorted.map(s => s.name);
    const parents = sorted.map(() => "");
    const values = sorted.map(s => s.rev);
    const text = sorted.map(s => {
      const pct = ((s.rev / finalGrandTotalRev) * 100).toFixed(0);
      return `<b>${s.name}</b><br><br><span style="font-size:18px;font-weight:900;">${formatIndianCurrency1Dec(s.rev)}</span><br><span style="font-size:13px;font-weight:700;">${pct}%</span>`;
    });

    const warmColors = [
      '#92400E',
      '#B45309',
      '#D97706',
      '#F59E0B',
      '#FBBF24',
      '#FCD34D',
      '#FDE68A',
      '#FEF3C7'
    ];

    return { labels, parents, values, text, warmColors, total: finalGrandTotalRev };
  }, [categoryGrandTotals, finalGrandTotalRev]);

  if (!treemapItems || treemapItems.labels.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-2 px-1 h-[28px]">
          <h3 className="text-base font-bold text-warm-text dark:text-dark-text truncate">{title}</h3>
        </div>
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5 h-[480px] flex items-center justify-center text-center">
          <p className="text-xs text-warm-muted dark:text-dark-muted">No plan revenue data available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 px-1 h-[28px]">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text truncate">{title}</h3>
        <div className="flex items-center gap-1.5 text-xs bg-warm-tableBg dark:bg-zinc-800 px-2.5 py-0.5 rounded-full border border-warm-border dark:border-zinc-700 shadow-xs shrink-0">
          <span className="text-[10px] uppercase font-bold text-warm-muted dark:text-dark-muted">Total Rev:</span>
          <span className="text-xs font-black text-amber-accent">{formatIndianCurrency1Dec(treemapItems.total)}</span>
        </div>
      </div>

      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-3 md:p-4 flex flex-col justify-center h-[480px]">
        <div className="w-full h-full min-h-0 rounded-lg overflow-hidden border border-warm-border/50 dark:border-zinc-800">
          <Plot
            data={[{
              type: 'treemap',
              labels: treemapItems.labels,
              parents: treemapItems.parents,
              values: treemapItems.values,
              text: treemapItems.text,
              textinfo: 'text',
              textposition: 'middle center',
              hoverinfo: 'label+value+percent root',
              marker: {
                colors: treemapItems.warmColors,
                line: { width: 2, color: isDark ? '#1E293B' : '#FFFFFF' }
              }
            }]}
            layout={{
              autosize: true,
              margin: { l: 4, r: 4, t: 4, b: 4 },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent'
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}

// Helper to group dates by Monday-to-Sunday week
function getWeekKeyAndLabel(dateStr) {
  if (!dateStr || !dateStr.includes('-')) return { key: dateStr || '', label: dateStr || '', labelShort: dateStr || '' };
  const parts = dateStr.split('-');
  if (parts.length !== 3) return { key: dateStr, label: dateStr, labelShort: dateStr };
  
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const dt = new Date(y, m, d);
  if (isNaN(dt.getTime())) return { key: dateStr, label: dateStr, labelShort: dateStr };
  
  // Day of week: 0 = Sun, 1 = Mon, ..., 6 = Sat
  const day = dt.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(dt);
  mon.setDate(dt.getDate() + diffToMon);
  
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  
  const monY = mon.getFullYear();
  const monM = String(mon.getMonth() + 1).padStart(2, '0');
  const monD = String(mon.getDate()).padStart(2, '0');
  const key = `${monY}-${monM}-${monD}`;
  
  const mShort = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const sShort = sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const labelShort = `${mShort} - ${sShort}`;
  
  return { key, label: key, labelShort };
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
  const [renTrendMetric, setRenTrendMetric] = useState("rate"); // 'rate' | 'due' | 'renewed' | 'combined'

  const [renComparePlatforms, setRenComparePlatforms] = useState([]);
  const [renComparePlans, setRenComparePlans] = useState([]);
  const [showRenPlatDropdown, setShowRenPlatDropdown] = useState(false);
  const [showRenPlanDropdown, setShowRenPlanDropdown] = useState(false);

  const [expandedRenPlatforms, setExpandedRenPlatforms] = useState({});
  const [expandedRenPlans, setExpandedRenPlans] = useState({});

  const renPlatDropdownRef = useRef(null);
  const renPlanDropdownRef = useRef(null);
  const recTeamDropdownRef = useRef(null);
  const recPlatDropdownRef = useRef(null);
  const recPlanDropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (renPlatDropdownRef.current && !renPlatDropdownRef.current.contains(event.target)) {
        setShowRenPlatDropdown(false);
      }
      if (renPlanDropdownRef.current && !renPlanDropdownRef.current.contains(event.target)) {
        setShowRenPlanDropdown(false);
      }
      if (recTeamDropdownRef.current && !recTeamDropdownRef.current.contains(event.target)) {
        setShowRecTeamDropdown(false);
      }
      if (recPlatDropdownRef.current && !recPlatDropdownRef.current.contains(event.target)) {
        setShowRecPlatDropdown(false);
      }
      if (recPlanDropdownRef.current && !recPlanDropdownRef.current.contains(event.target)) {
        setShowRecPlanDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function processRenewals(dataArray) {
      if (!dataArray || !Array.isArray(dataArray)) return;
      const processed = dataArray.map(row => {
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
    }

    async function fetchRenewals() {
      if (!renewalsData || renewalsData.length === 0) setRenewalsLoading(true);
      setRenewalsError(null);
      try {
        const results = await fetchDatasetCached('renewals', DATASET_URLS.renewals);
        if (results && results.data) processRenewals(results.data);
      } catch (err) {
        console.error("Error fetching renewals:", err);
        setRenewalsError("Could not fetch renewal sheet data.");
        setRenewalsLoading(false);
      }
    }
    fetchRenewals();

    const handleDatasetUpdated = (e) => {
      if (e.detail && e.detail.key === 'renewals' && e.detail.data) {
        console.log("⚡ [Renewals UI] Background live Google Sheet update received!");
        processRenewals(e.detail.data);
      }
    };
    window.addEventListener('dataset-updated', handleDatasetUpdated);
    return () => window.removeEventListener('dataset-updated', handleDatasetUpdated);
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
      let key = '';
      let labelShort = '';
      if (renViewLevel === "Day") {
        key = r.renew_date || r.renew_month;
      } else if (renViewLevel === "Week") {
        if (r.renew_date) {
          const wInfo = getWeekKeyAndLabel(r.renew_date);
          key = wInfo.key;
          labelShort = wInfo.labelShort;
        } else {
          key = r.renew_month;
        }
      } else {
        key = r.renew_month;
      }
      if (!key) return;
      if (!grouped[key]) grouped[key] = { label: key, labelShort: labelShort || key, due: 0, renewed: 0 };
      grouped[key].due += r.renewal_due;
      grouped[key].renewed += r.renewed;
    });

    return Object.values(grouped)
      .map(g => {
        let labelShort = g.labelShort;
        if (renViewLevel === "Day" && g.label && g.label.includes("-")) {
          const parts = g.label.split("-");
          if (parts.length === 3) {
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            labelShort = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }
        } else if (renViewLevel === "Month" && g.label && g.label.includes("-")) {
          const parts = g.label.split("-");
          if (parts.length >= 2) {
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
            labelShort = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
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

    const getRowKey = (r) => {
      if (renViewLevel === "Day") return r.renew_date || r.renew_month;
      if (renViewLevel === "Week") return r.renew_date ? getWeekKeyAndLabel(r.renew_date).key : r.renew_month;
      return r.renew_month;
    };

    if (renTrendMetric === "combined") {
      const traces = [
        {
          x: dateLabels,
          y: renTrendData.map(d => d.due),
          type: 'scatter',
          mode: 'lines+markers+text',
          name: 'Renewal Due',
          text: renTrendData.map(d => d.due.toLocaleString()),
          textposition: 'top center',
          cliponaxis: false,
          textfont: { size: 10, color: isDark ? '#fbbf24' : '#d97706', weight: 'bold' },
          line: { color: '#f59e0b', width: 2.5, shape: 'spline' },
          marker: { size: 6, color: '#f59e0b' },
          fill: 'tozeroy',
          fillcolor: isDark ? 'rgba(245, 158, 11, 0.08)' : 'rgba(217, 119, 6, 0.06)',
          hovertemplate: "<b>Renewal Due</b><br>%{x}<br>Due: <b>%{y:,.0f}</b><extra></extra>"
        },
        {
          x: dateLabels,
          y: renTrendData.map(d => d.renewed),
          type: 'scatter',
          mode: 'lines+markers+text',
          name: 'Renewed',
          text: renTrendData.map(d => d.renewed.toLocaleString()),
          textposition: 'top center',
          cliponaxis: false,
          textfont: { size: 10, color: '#10b981', weight: 'bold' },
          line: { color: '#10b981', width: 2.5, shape: 'spline' },
          marker: { size: 6, color: '#10b981' },
          hovertemplate: "<b>Renewed</b><br>%{x}<br>Renewed: <b>%{y:,.0f}</b><extra></extra>"
        }
      ];
      return traces;
    }

    const COMPARISON_COLORS = ['#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#06B6D4', '#EAB308', '#6366F1'];
    let colorIdx = 0;

    let mainY = [];
    let mainName = '';
    let mainText = [];
    let mainColor = '#f59e0b';
    let hoverLabel = '';

    if (renTrendMetric === "due") {
      mainY = renTrendData.map(d => d.due);
      mainName = 'Overall Renewal Due';
      mainText = renTrendData.map(d => d.due.toLocaleString());
      hoverLabel = 'Renewal Due';
    } else if (renTrendMetric === "renewed") {
      mainY = renTrendData.map(d => d.renewed);
      mainName = 'Overall Renewed';
      mainText = renTrendData.map(d => d.renewed.toLocaleString());
      mainColor = '#10B981';
      hoverLabel = 'Renewed';
    } else {
      mainY = renTrendData.map(d => d.rate);
      mainName = 'Overall Renewal Rate';
      mainText = renTrendData.map(d => `${d.rate.toFixed(1)}%`);
      hoverLabel = 'Renewal Rate';
    }

    const traces = [
      {
        x: dateLabels,
        y: mainY,
        type: 'scatter',
        mode: 'lines+markers+text',
        name: mainName,
        text: mainText,
        textposition: 'top center',
        cliponaxis: false,
        textfont: { size: 10, color: mainColor, weight: 'bold' },
        line: { color: mainColor, width: 3, shape: 'spline' },
        marker: { size: 6, color: mainColor },
        fill: 'tozeroy',
        fillcolor: isDark ? 'rgba(245, 158, 11, 0.08)' : 'rgba(217, 119, 6, 0.06)',
        hovertemplate: `<b>Overall</b><br>%{x}<br>${hoverLabel}: <b>${renTrendMetric === 'rate' ? '%{y:.2f}%' : '%{y:,.0f}'}</b><extra></extra>`
      }
    ];

    renComparePlatforms.forEach(plat => {
      const platVals = dateKeys.map(k => {
        let due = 0, ren = 0;
        filteredRenewalsData.forEach(r => {
          const rKey = getRowKey(r);
          if (rKey === k && r.platform === plat) {
            due += r.renewal_due;
            ren += r.renewed;
          }
        });
        if (renTrendMetric === "due") return due;
        if (renTrendMetric === "renewed") return ren;
        return due > 0 ? (ren / due) * 100 : 0;
      });

      const color = COMPARISON_COLORS[colorIdx % COMPARISON_COLORS.length];
      colorIdx++;

      traces.push({
        x: dateLabels,
        y: platVals,
        type: 'scatter',
        mode: 'lines+markers+text',
        name: `Platform: ${plat}`,
        text: platVals.map(v => renTrendMetric === 'rate' ? `${v.toFixed(1)}%` : v.toLocaleString()),
        textposition: 'top center',
        cliponaxis: false,
        textfont: { size: 9, color: color, weight: 'bold' },
        line: { color: color, width: 2, dash: 'dot', shape: 'spline' },
        marker: { size: 5, color: color },
        hovertemplate: `<b>${plat}</b><br>%{x}<br>${hoverLabel}: <b>${renTrendMetric === 'rate' ? '%{y:.2f}%' : '%{y:,.0f}'}</b><extra></extra>`
      });
    });

    renComparePlans.forEach(plan => {
      const planVals = dateKeys.map(k => {
        let due = 0, ren = 0;
        filteredRenewalsData.forEach(r => {
          const rKey = getRowKey(r);
          if (rKey === k && r.plan_category === plan) {
            due += r.renewal_due;
            ren += r.renewed;
          }
        });
        if (renTrendMetric === "due") return due;
        if (renTrendMetric === "renewed") return ren;
        return due > 0 ? (ren / due) * 100 : 0;
      });

      const color = COMPARISON_COLORS[colorIdx % COMPARISON_COLORS.length];
      colorIdx++;

      traces.push({
        x: dateLabels,
        y: planVals,
        type: 'scatter',
        mode: 'lines+markers+text',
        name: `Plan: ${plan}`,
        text: planVals.map(v => renTrendMetric === 'rate' ? `${v.toFixed(1)}%` : v.toLocaleString()),
        textposition: 'top center',
        cliponaxis: false,
        textfont: { size: 9, color: color, weight: 'bold' },
        line: { color: color, width: 2, dash: 'dash', shape: 'spline' },
        marker: { size: 5, color: color },
        hovertemplate: `<b>${plan}</b><br>%{x}<br>${hoverLabel}: <b>${renTrendMetric === 'rate' ? '%{y:.2f}%' : '%{y:,.0f}'}</b><extra></extra>`
      });
    });

    return traces;
  }, [renTrendData, renComparePlatforms, renComparePlans, filteredRenewalsData, renViewLevel, renTrendMetric, isDark]);

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

  // Recurring Trend Data (Daily, Weekly, or Monthly Recurring %)
  const recTrendData = useMemo(() => {
    const map = {};
    filteredRecurringData.forEach(r => {
      let key = '';
      let labelShort = '';
      if (recViewLevel === "Day") {
        key = r.txn_date;
      } else if (recViewLevel === "Week") {
        if (r.txn_date) {
          const wInfo = getWeekKeyAndLabel(r.txn_date);
          key = wInfo.key;
          labelShort = wInfo.labelShort;
        } else {
          key = r.txn_month;
        }
      } else {
        key = r.txn_month || (r.txn_date ? r.txn_date.substring(0, 7) : '');
      }
      if (!key) return;
      if (!map[key]) map[key] = { key, labelShort: labelShort || key, total: 0, rec: 0 };
      map[key].total += r.conversion;
      if (r.auto_renew) map[key].rec += r.conversion;
    });

    return Object.keys(map).sort().map(k => {
      let labelShort = map[k].labelShort || k;
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

    const getRowKey = (r) => {
      if (recViewLevel === "Day") return r.txn_date;
      if (recViewLevel === "Week") return r.txn_date ? getWeekKeyAndLabel(r.txn_date).key : r.txn_month;
      return r.txn_month || (r.txn_date ? r.txn_date.substring(0, 7) : '');
    };

    const traces = [
      {
        x: dateLabels,
        y: recTrendData.map(d => d.rate),
        type: 'scatter',
        mode: 'lines+markers+text',
        name: 'Overall Recurring %',
        text: recTrendData.map(d => `${d.rate.toFixed(1)}%`),
        textposition: 'top center',
        cliponaxis: false,
        textfont: { size: 10, color: isDark ? '#fbbf24' : '#d97706', weight: 'bold' },
        line: { color: '#f59e0b', width: 3, shape: 'spline' },
        marker: { size: 6, color: '#f59e0b' },
        fill: 'tozeroy',
        fillcolor: isDark ? 'rgba(245, 158, 11, 0.08)' : 'rgba(217, 119, 6, 0.06)',
        hovertemplate: "<b>Overall Recurring</b><br>%{x}<br>Recurring Share: <b>%{y:.2f}%</b><extra></extra>"
      }
    ];

    const COMPARISON_COLORS = ['#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#06B6D4', '#EAB308', '#6366F1'];
    let colorIdx = 0;

    // 1. Marketing Team Comparisons
    recCompareTeams.forEach(team => {
      const rates = dateKeys.map(k => {
        let tot = 0, rec = 0;
        filteredRecurringData.forEach(r => {
          const rKey = getRowKey(r);
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
        cliponaxis: false,
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
          const rKey = getRowKey(r);
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
        cliponaxis: false,
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
          const rKey = getRowKey(r);
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
        cliponaxis: false,
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
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm my-6 p-4">
        <CleanDashboardLoader title="Loading Renewals & Recurring Data..." subtitle="Processing cohort retention and recurring revenue trends" />
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
                onClick={() => setRenViewLevel("Week")}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  renViewLevel === "Week"
                    ? "bg-white dark:bg-slate-700 text-amber-accent shadow-sm"
                    : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                }`}
              >
                Week Level View
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
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
                {renTrendMetric === 'rate' && `Overall Renewal Rate Trend (${renViewLevel} Level)`}
                {renTrendMetric === 'due' && `Renewal Due Trend (${renViewLevel} Level)`}
                {renTrendMetric === 'renewed' && `Renewed Subscriptions Trend (${renViewLevel} Level)`}
                {renTrendMetric === 'combined' && `Renewal Due vs Renewed Trend (${renViewLevel} Level)`}
              </h3>
              <p className="text-xs text-warm-muted dark:text-dark-muted px-1 mt-0.5">
                {renTrendMetric === 'rate' ? 'Compare overall renewal rate against specific Platforms or Plans' : 'Analyze renewal volume trends over time'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Metric Selector Pills */}
              <div className="flex items-center bg-warm-tableBg dark:bg-zinc-800 p-0.5 rounded-lg border border-warm-border dark:border-zinc-700 shadow-xs">
                <button
                  onClick={() => setRenTrendMetric("rate")}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    renTrendMetric === "rate"
                      ? "bg-white dark:bg-slate-700 text-amber-accent shadow-xs"
                      : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                  }`}
                >
                  Renewal Rate (%)
                </button>
                <button
                  onClick={() => setRenTrendMetric("due")}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    renTrendMetric === "due"
                      ? "bg-white dark:bg-slate-700 text-amber-accent shadow-xs"
                      : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                  }`}
                >
                  Renewal Due
                </button>
                <button
                  onClick={() => setRenTrendMetric("renewed")}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    renTrendMetric === "renewed"
                      ? "bg-white dark:bg-slate-700 text-amber-accent shadow-xs"
                      : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                  }`}
                >
                  Renewed
                </button>
                <button
                  onClick={() => setRenTrendMetric("combined")}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    renTrendMetric === "combined"
                      ? "bg-white dark:bg-slate-700 text-amber-accent shadow-xs"
                      : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                  }`}
                >
                  Due vs Renewed
                </button>
              </div>

              {renTrendMetric !== "combined" && (
                <>
                  <div className="relative" ref={renPlatDropdownRef}>
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

                  <div className="relative" ref={renPlanDropdownRef}>
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
                </>
              )}
            </div>
          </div>

          {renTrendMetric !== "combined" && (renComparePlatforms.length > 0 || renComparePlans.length > 0) && (
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
                margin: { l: 55, r: 50, t: 40, b: 50 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                font: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 10 },
                xaxis: { 
                  showgrid: false,
                  automargin: true,
                  tickangle: renTrendData.length > 20 ? -45 : 0,
                  tickfont: { size: 10, color: isDark ? '#94A3B8' : '#64748B' }
                },
                yaxis: renTrendMetric === 'rate' ? { 
                  gridcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', 
                  range: [0, 115],
                  ticksuffix: '%'
                } : {
                  gridcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  autorange: true
                },
                legend: {
                  orientation: 'h',
                  y: 1.12,
                  x: 0,
                  font: { size: 10, color: isDark ? '#cbd5e1' : '#334155' }
                },
                showlegend: renChartTraces.length > 1 || renTrendMetric === 'combined'
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

        {/* Two-Column Visualizations: Heatmap & Rate vs Volume */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-6">
          {/* Left Column: Renewal Performance Heatmap */}
          <div className="xl:col-span-6 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5 flex flex-col justify-between">
            <RenewalHeatmap
              filteredRenewalsData={filteredRenewalsData}
              renDatePreset={renDatePreset}
              renViewLevel={renViewLevel}
              isDark={isDark}
            />
          </div>

          {/* Right Column: Renewal Rate vs Volume Quadrant Chart */}
          <div className="xl:col-span-6 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-5 flex flex-col justify-between">
            <RenewalRateVsVolumeChart
              renPlatformData={renPlatformData}
              renTotalDue={renTotalDue}
              renOverallRate={renOverallRate}
              renDatePreset={renDatePreset}
              isDark={isDark}
            />
          </div>
        </div>

        {/* Platform & Plan Breakdown Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Platform-wise Table */}
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">Platform-wise Renewals</h3>
            <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-xl custom-scrollbar overflow-x-auto max-h-[480px] shadow-sm">
              <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-30">
                  <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th className="p-3 whitespace-nowrap bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text sticky left-0 top-0 z-50 border-r border-warm-border dark:border-dark-border">Platform</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Renewal Due</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Renewed</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Renewal Rate</th>
                  </tr>
                  <tr className="font-bold border-b border-warm-border dark:border-dark-border text-amber-accent">
                    <td className="p-3 whitespace-nowrap font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400 sticky left-0 z-40 border-r border-warm-border dark:border-dark-border" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
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
                          <td className="p-3 font-semibold text-warm-text dark:text-dark-text sticky left-0 z-20 bg-white dark:bg-[#0F172A] border-r border-warm-border/30 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setExpandedRenPlatforms(prev => ({ ...prev, [row.platform]: !prev[row.platform] }))}
                                className="p-1 hover:bg-amber-500/20 rounded text-amber-accent transition-transform cursor-pointer"
                                title="Click to view daily trend"
                              >
                                <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                              </button>
                              <span>{row.platform}</span>
                            </div>
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
                <thead className="sticky top-0 z-30">
                  <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th className="p-3 whitespace-nowrap bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text sticky left-0 top-0 z-50 border-r border-warm-border dark:border-dark-border">Plan Category</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Renewal Due</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Renewed</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Renewal Rate</th>
                  </tr>
                  <tr className="font-bold border-b border-warm-border dark:border-dark-border text-amber-accent">
                    <td className="p-3 whitespace-nowrap font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400 sticky left-0 z-40 border-r border-warm-border dark:border-dark-border" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
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
                          <td className="p-3 font-semibold text-warm-text dark:text-dark-text sticky left-0 z-20 bg-white dark:bg-[#0F172A] border-r border-warm-border/30 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setExpandedRenPlans(prev => ({ ...prev, [row.plan]: !prev[row.plan] }))}
                                className="p-1 hover:bg-amber-500/20 rounded text-amber-accent transition-transform cursor-pointer"
                                title="Click to view daily trend"
                              >
                                <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                              </button>
                              <span>{row.plan}</span>
                            </div>
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
            {/* Day / Week / Month Level View Toggle for Recurring */}
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
                onClick={() => setRecViewLevel("Week")}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  recViewLevel === "Week"
                    ? "bg-white dark:bg-slate-700 text-amber-accent shadow-sm"
                    : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                }`}
              >
                Week Level View
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
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
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
              <div className="relative" ref={recTeamDropdownRef}>
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
              <div className="relative" ref={recPlatDropdownRef}>
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
              <div className="relative" ref={recPlanDropdownRef}>
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
                margin: { l: 55, r: 50, t: 40, b: 50 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                font: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 10 },
                xaxis: { 
                  showgrid: false,
                  automargin: true,
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

        {/* Recurring 3 Donut Charts Section (Platform, Plan Category, Marketing Team) */}
        <RecurringDonutsSection
          recPlatformData={recPlatformData}
          recPlanData={recPlanData}
          recTeamData={recTeamData}
          recRecurringConv={recRecurringConv}
          isDark={isDark}
        />

        {/* Recurring Breakdown Tables Section (Platform, Plan, Marketing Team) */}
        <div className="flex flex-col gap-6">
          {/* Platform Breakdown */}
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">Platform-wise Recurring Breakdown</h3>
            <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-xl custom-scrollbar overflow-x-auto max-h-[480px] shadow-sm">
              <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-30">
                  <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th className="p-3 whitespace-nowrap bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text sticky left-0 top-0 z-50 border-r border-warm-border dark:border-dark-border">Platform</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Total Sold</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Non-Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Recurring Share</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Recurring Revenue</th>
                  </tr>
                  <tr className="font-bold border-b border-warm-border dark:border-dark-border text-amber-accent">
                    <td className="p-3 whitespace-nowrap font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400 sticky left-0 z-40 border-r border-warm-border dark:border-dark-border" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
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
                          <td className="p-3 font-semibold text-warm-text dark:text-dark-text sticky left-0 z-20 bg-white dark:bg-[#0F172A] border-r border-warm-border/30 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setExpandedRecPlatforms(prev => ({ ...prev, [row.platform]: !prev[row.platform] }))}
                                className="p-1 hover:bg-amber-500/20 rounded text-amber-accent transition-transform cursor-pointer"
                                title="Click to view daily trend"
                              >
                                <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                              </button>
                              <span>{row.platform}</span>
                            </div>
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
                <thead className="sticky top-0 z-30">
                  <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th className="p-3 whitespace-nowrap bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text sticky left-0 top-0 z-50 border-r border-warm-border dark:border-dark-border">Plan Category</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Total Sold</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Non-Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Recurring Share</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Recurring Revenue</th>
                  </tr>
                  <tr className="font-bold border-b border-warm-border dark:border-dark-border text-amber-accent">
                    <td className="p-3 whitespace-nowrap font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400 sticky left-0 z-40 border-r border-warm-border dark:border-dark-border" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
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
                          <td className="p-3 font-semibold text-warm-text dark:text-dark-text sticky left-0 z-20 bg-white dark:bg-[#0F172A] border-r border-warm-border/30 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setExpandedRecPlans(prev => ({ ...prev, [row.plan]: !prev[row.plan] }))}
                                className="p-1 hover:bg-amber-500/20 rounded text-amber-accent transition-transform cursor-pointer"
                                title="Click to view daily trend"
                              >
                                <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                              </button>
                              <span>{row.plan}</span>
                            </div>
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
                <thead className="sticky top-0 z-30">
                  <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th className="p-3 whitespace-nowrap bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text sticky left-0 top-0 z-50 border-r border-warm-border dark:border-dark-border">Marketing Team</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Total Sold</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Non-Recurring</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Recurring Share</th>
                    <th className="p-3 text-right whitespace-nowrap bg-white dark:bg-[#1E293B]">Recurring Revenue</th>
                  </tr>
                  <tr className="font-bold border-b border-warm-border dark:border-dark-border text-amber-accent">
                    <td className="p-3 whitespace-nowrap font-black bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400 sticky left-0 z-40 border-r border-warm-border dark:border-dark-border" style={{ boxShadow: isDark ? 'inset 0 -3px 0 0 #f59e0b' : 'inset 0 -3px 0 0 #d97706' }}>Period total</td>
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
                          <td className="p-3 font-semibold text-warm-text dark:text-dark-text sticky left-0 z-20 bg-white dark:bg-[#0F172A] border-r border-warm-border/30 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setExpandedRecTeams(prev => ({ ...prev, [row.team]: !prev[row.team] }))}
                                className="p-1 hover:bg-amber-500/20 rounded text-amber-accent transition-transform cursor-pointer"
                                title="Click to view daily trend"
                              >
                                <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                              </button>
                              <span>{row.team}</span>
                            </div>
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


function UserProfileMenu({ currentUser, isAdmin, onLogout, onSelectAdminPanel, isDark }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!currentUser) return null;

  const displayName = currentUser.displayName || currentUser.email?.split('@')[0] || 'User';
  const photoUrl = currentUser.photoURL;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      {/* Human Avatar Icon Button Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center h-9 w-9 rounded-full bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border hover:border-amber-accent dark:hover:border-amber-accent text-warm-text dark:text-dark-text shadow-sm transition-all cursor-pointer relative group"
        title={`${displayName} (${currentUser.email})`}
      >
        {photoUrl ? (
          <img src={photoUrl} alt={displayName} className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-amber-500/10 text-amber-800 dark:text-amber-300 font-black text-sm">
            <User className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
          </div>
        )}
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-dark-card"></span>
      </button>

      {/* Profile Dropdown Popover */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-zinc-900 border border-warm-border dark:border-zinc-700 rounded-2xl shadow-xl z-50 p-3 animate-in fade-in zoom-in-95 duration-150">
          
          {/* User Info Header Card */}
          <div className="flex items-center gap-3 p-2.5 mb-2 bg-warm-tableBg dark:bg-zinc-800/60 rounded-xl">
            {photoUrl ? (
              <img src={photoUrl} alt={displayName} className="h-10 w-10 rounded-full object-cover shrink-0" />
            ) : (
              <div className="flex items-center justify-center h-10 w-10 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 font-extrabold text-base shrink-0">
                {initial}
              </div>
            )}
            <div className="overflow-hidden min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-xs text-warm-text dark:text-dark-text truncate" title={displayName}>
                  {displayName}
                </span>
                {isAdmin && (
                  <span className="px-1.5 py-0.2 text-[8px] font-black rounded bg-amber-500/20 text-amber-800 dark:text-amber-300 shrink-0">
                    ADMIN
                  </span>
                )}
              </div>
              <p className="text-[10px] text-warm-muted dark:text-dark-muted truncate mt-0.5" title={currentUser.email}>
                {currentUser.email}
              </p>
            </div>
          </div>

          <div className="my-1.5 border-t border-warm-border/60 dark:border-zinc-800"></div>

          {/* Admin Panel Option (If Admin) */}
          {isAdmin && (
            <button
              onClick={() => {
                setIsOpen(false);
                if (onSelectAdminPanel) onSelectAdminPanel();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-amber-900 dark:text-amber-300 hover:bg-amber-500/10 transition-colors text-xs font-bold cursor-pointer text-left mb-1"
            >
              <ShieldCheck className="h-4 w-4 text-amber-500 shrink-0" />
              <span>Admin Panel</span>
            </button>
          )}

          {/* Logout Option */}
          <button
            onClick={() => {
              setIsOpen(false);
              onLogout();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors text-xs font-bold cursor-pointer text-left"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      )}
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
    // Auto-poll live Google Sheets data every 5 minutes
    const interval = setInterval(() => {
      console.log("🔄 [Auto-Poll] Synchronizing live Google Sheets data...");
      preloadAllDashboardData();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
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

  const currentUserRef = useRef(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser?.email) {
        if (!currentUserRef.current) {
          const authorized = await isUserAuthorizedAsync(firebaseUser.email);
          if (authorized) {
            handleSetUser({
              email: firebaseUser.email,
              displayName: firebaseUser.displayName || firebaseUser.email.split('@')[0]
            });
          }
        }
      }
    });
    return () => unsubscribe();
  }, [handleSetUser]);

  const isAdmin = isAdminEmail(currentUser?.email);
  const baseTabs = ['Realtime', 'Funnel Analysis', 'Subscription Report', 'Renewals & Recurring', 'ARPU'];
  const navTabs = isAdmin ? [...baseTabs, 'Conversational Analytics'] : baseTabs;

  useEffect(() => {
    if (!isAdmin && activeTab === 'Conversational Analytics') {
      setActiveTab('Realtime');
    }
  }, [isAdmin, activeTab]);

  if (!currentUser) {
    return <LoginScreen onLoginSuccess={handleSetUser} isDark={isDark} />;
  }

  return (
    <div className={`min-h-screen ${isDark ? 'dark bg-[#0F172A] text-[#f8fafc]' : 'bg-[#F8FAFC] text-[#0F172A]'}`}>
      <div className="w-full px-6 py-5 md:px-10 lg:px-12">
        {/* Main Header */}
        <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-warm-border dark:border-dark-border pb-5 mb-5">
          <div className="flex items-center justify-between w-full xl:w-auto">
            <div className="flex items-center gap-3">
              <div className="bg-[#ED1C24] text-white font-serif font-black text-[32px] leading-none h-[54px] w-[54px] rounded-lg shadow-md flex items-center justify-center tracking-tighter shrink-0">
                ET
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight dark:text-dark-text text-warm-text">Prime</h1>
                <p className="text-xs tracking-wider text-warm-muted dark:text-dark-muted font-bold uppercase">Subscription Ledger</p>
              </div>
            </div>

            {/* Mobile Header Right Profile Tools */}
            <div className="flex xl:hidden items-center gap-2">
              <UserProfileMenu
                currentUser={currentUser}
                isAdmin={isAdmin}
                onLogout={handleLogout}
                onSelectAdminPanel={() => setActiveTab('Admin Panel')}
                isDark={isDark}
              />
              <button 
                onClick={() => {
                  const newTheme = isDark ? 'light' : 'dark';
                  setTheme(newTheme);
                  localStorage.setItem('theme', newTheme);
                }}
                className="flex items-center justify-center p-2 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg text-warm-text dark:text-dark-text hover:bg-warm-tableBg dark:hover:bg-zinc-800 transition-all shadow-xs focus:outline-hidden cursor-pointer"
                title="Toggle Light / Dark Mode"
              >
                {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-warm-text" />}
              </button>
            </div>
          </div>

          {/* View Toggle Bar (Responsive Scrollable Container) */}
          <div className="flex items-center gap-1 bg-warm-totalBg dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl xl:rounded-full p-1 overflow-x-auto custom-scrollbar w-full xl:w-auto shrink-0 scrollbar-none">
            {navTabs.map(tab => (
              <button 
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 xl:px-4 py-1.5 text-xs xl:text-sm font-semibold rounded-lg xl:rounded-full whitespace-nowrap transition-all duration-300 ease-in-out cursor-pointer flex-1 xl:flex-none text-center ${
                  activeTab === tab 
                    ? 'bg-white dark:bg-slate-700 shadow-sm border border-warm-border/50 dark:border-slate-600 text-amber-accent font-bold' 
                    : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {tab === 'Admin Panel' ? '👑 Admin Panel' : tab}
              </button>
            ))}
          </div>
          
          {/* Desktop Right Tools & User Profile */}
          <div className="hidden xl:flex items-center gap-3 justify-end h-[38px]">
            <UserProfileMenu
              currentUser={currentUser}
              isAdmin={isAdmin}
              onLogout={handleLogout}
              onSelectAdminPanel={() => setActiveTab('Admin Panel')}
              isDark={isDark}
            />
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
          <div className={activeTab === 'ARPU' ? 'block' : 'hidden'}>
            <ArpuReport isDark={isDark} />
          </div>
          {isAdmin && (
            <div className={activeTab === 'Conversational Analytics' ? 'block' : 'hidden'}>
              <ConversationalAnalytics isDark={isDark} currentUser={currentUser} />
            </div>
          )}
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


function ConversationalAnalytics({ isDark, currentUser }) {
  const [subscriptionData, setSubscriptionData] = useState([]);
  const [funnelData, setFunnelData] = useState([]);
  const [renewalsData, setRenewalsData] = useState([]);
  const [realtimeData, setRealtimeData] = useState([]);

  const [apiKey, setApiKeyState] = useState(getStoredApiKey());
  const [llamaConfigState, setLlamaConfigState] = useState(getStoredLlamaConfig());
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey || '');
  const [groqInput, setGroqInput] = useState(getStoredLlamaConfig().apiKey || '');

  const handleSaveApiKey = (e) => {
    e.preventDefault();
    if (groqInput && groqInput.trim()) {
      setStoredLlamaConfig({ apiKey: groqInput.trim() });
    }
    if (keyInput && keyInput.trim()) {
      setStoredApiKey(keyInput.trim());
      setApiKeyState(keyInput.trim());
    }
    setLlamaConfigState(getStoredLlamaConfig());
    setShowKeyModal(false);
  };

  useEffect(() => {
    async function fetchSubData() {
      try {
        const results = await fetchDatasetCached('subscription', DEFAULT_GSHEET_URL);
        const parsed = (results.data || []).map(row => {
          const rawDate = row.txn_date || row.Date || row.date;
          if (!rawDate) return null;
          let dateStr = String(rawDate).trim();
          if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
              const m = parts[0].padStart(2, '0');
              const d = parts[1].padStart(2, '0');
              let y = parts[2].trim();
              if (y.length === 2) y = `20${y}`;
              dateStr = `${y}-${m}-${d}`;
            }
          }
          const platRaw = String(row.platform || row.Platform || '').toLowerCase().trim();
          return {
            dateStr,
            rawDate: String(rawDate).trim(),
            platform: normalizePlatformName(platRaw) || row.platform || row.Platform,
            rawPlatform: String(row.platform || row.Platform || '').trim(),
            revenue: parseFloat(row.revenue_above_rs_6_txn || row.Revenue || row.rev || 0),
            conversions: parseInt(row.conversion || row.Conversions || row.conversions || 0, 10) || 0,
            user_txn_type: String(row.user_txn_type || '').trim(),
            plan_category: String(row.plan_category || '').trim(),
            country_name: String(row.country_name || '').trim(),
            acq_source: String(row.acq_source || '').trim(),
            channel: String(row.channel || '').trim(),
            auto_renew: String(row.auto_renew || '').trim(),
            transaction_id: String(row.transaction_id || '').trim(),
            merchant_code: String(row.merchant_code || '').trim(),
            transaction_time: String(row.transaction_time || '').trim()
          };
        }).filter(Boolean);
        setSubscriptionData(parsed);
      } catch (err) {
        console.warn("ConversationalAnalytics subscription data load fallback", err);
      }
    }

    async function fetchRenewalsData() {
      try {
        const results = await fetchDatasetCached('renewals', DATASET_URLS.renewals);
        const processed = (results.data || []).map(row => {
          const cleanRow = {};
          Object.keys(row).forEach(k => cleanRow[k.trim()] = row[k]);
          
          const dParts = String(cleanRow['renew_date'] || '').split('/');
          let dateStr = '';
          if (dParts.length === 3) {
            const y = dParts[2].trim();
            const m = dParts[0].padStart(2, '0');
            const d = dParts[1].padStart(2, '0');
            dateStr = `${y}-${m}-${d}`;
          }

          const platformCode = String(cleanRow['platform'] || '').trim();
          const platformDisplay = normalizePlatformName(platformCode);

          return {
            renew_month: String(cleanRow['renew_month'] || '').trim(),
            renew_date: dateStr,
            raw_renew_date: String(cleanRow['renew_date'] || '').trim(),
            platform: platformDisplay,
            rawPlatform: platformCode,
            plan_category: String(cleanRow['plan_category'] || 'UNKNOWN').trim(),
            renewal_due: parseInt(cleanRow['renewal_due'], 10) || 0,
            renewed: parseInt(cleanRow['renewed'], 10) || 0
          };
        }).filter(r => r.renew_month || r.renew_date);
        setRenewalsData(processed);
      } catch (err) {
        console.warn("ConversationalAnalytics renewals data load fallback", err);
      }
    }

    async function fetchFunnelData() {
      try {
        const results = await fetchDatasetCached('funnel', FUNNEL_GSHEET_URL);
        const parsed = (results.data || []).map(row => {
          const dateStr = String(row.event_date || '').trim();
          let formattedDateStr = '';
          if (dateStr.length === 8 && !dateStr.includes('-') && !dateStr.includes('/')) {
            formattedDateStr = `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`;
          } else if (dateStr.includes('-')) {
            formattedDateStr = dateStr;
          } else if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
              formattedDateStr = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
            }
          }
          if (!formattedDateStr) return null;
          
          const rawPlatform = String(row.ET_Platform || row.platform || '').trim();
          const dau = parseInt(row.DAU || row.dau || 0, 10) || 0;
          const hits = parseInt(row.paywalling_hits || row.paywall_hits || row.paywall_hit || 0, 10) || 0;
          const loads = parseInt(row.Plan_Page_Loaded || row.Plan_Page_Load || row.plan_page_loads || 0, 10) || 0;
          const selected = parseInt(row.Plan_Selected || 0, 10) || 0;
          const initiated = parseInt(row.Pay_Initiated || 0, 10) || 0;
          const purchased = parseInt(row.Purchased || row.purchased || row.purchases || 0, 10) || 0;

          return {
            dateObj: new Date(formattedDateStr),
            dateStr: formattedDateStr,
            viewType: row.view_type || 'Overall',
            platform: rawPlatform,
            ET_Platform: rawPlatform,
            country: String(row.Country || row.country || '').trim(),
            Country: String(row.Country || row.country || '').trim(),
            marketingTeam: String(row.Marketing_team || row.marketing_team || '').trim(),
            Marketing_team: String(row.Marketing_team || row.marketing_team || '').trim(),
            DAU: dau,
            dau: dau,
            paywalling_hits: hits,
            paywall_hits: hits,
            Plan_Page_Load: loads,
            Plan_Page_Loaded: loads,
            plan_page_loads: loads,
            Plan_Selected: selected,
            Pay_Initiated: initiated,
            Purchased: purchased,
            purchased: purchased
          };
        }).filter(row => row && !isNaN(row.dateObj));
        setFunnelData(parsed);
      } catch (err) {
        console.warn("ConversationalAnalytics funnel data load fallback", err);
      }
    }

    async function fetchRealtimeData() {
      try {
        const results = await fetchDatasetCached('realtime', REALTIME_GSHEET_URL);
        if (results && results.data) {
          setRealtimeData(results.data);
        }
      } catch (err) {
        console.warn("ConversationalAnalytics realtime data load fallback", err);
      }
    }

    fetchSubData();
    fetchFunnelData();
    fetchRenewalsData();
    fetchRealtimeData();
  }, []);

  const INITIAL_BOT_PROMPTS = [
    "give me funnel data for the last 7 days day wise",
    "What is the renewal rate for the month of july'26?",
    "Give me platform wise breakup of renewals for the month of july'26",
    "Which platform leads sales?"
  ];

  const [messages, setMessages] = useState([
    {
      id: 1,
      isWelcome: true,
      sender: 'bot',
      text: 'Hello! I am your AI Ledger Assistant. Ask me anything about subscription trends, renewals, revenue pacing, or platform breakdowns across dates.',
      kpis: [
        { label: "Total Revenue (30d)", value: "₹4.23 Cr", sub: "₹14.10 L/day" },
        { label: "Top Sales Platform", value: "MWeb", sub: "41% Total Vol" },
        { label: "Funnel Conversion", value: "1.56%", sub: "Page Load to Sale" }
      ],
      suggestedFollowups: INITIAL_BOT_PROMPTS
    }
  ]);

  // Dynamically update the initial welcome card KPIs when live data finishes loading
  useEffect(() => {
    if ((subscriptionData && subscriptionData.length > 0) || (funnelData && funnelData.length > 0)) {
      setMessages(prev => {
        if (!prev || prev.length === 0) return prev;
        const first = prev[0];
        if (first.id !== 1 && !first.text.startsWith('Hello! I am your AI Ledger Assistant')) return prev;

        let revStr = "₹4.23 Cr";
        let dailyAvgStr = "₹14.10 L/day";
        let topPlatStr = "MWeb";
        let topVolStr = "41% Total Vol";
        let convStr = "1.56%";

        if (subscriptionData && subscriptionData.length > 0) {
          // Filter to distinct dates in the last 30 days of the dataset
          const allDates = Array.from(new Set(subscriptionData.map(r => r.dateStr).filter(Boolean))).sort();
          const last30Dates = new Set(allDates.slice(-30));

          let totRev = 0;
          const pMap = {};
          subscriptionData.forEach(r => {
            if (last30Dates.has(r.dateStr)) {
              const rev = parseFloat(r.revenue) || 0;
              totRev += rev;
              const p = r.platform || 'Other';
              pMap[p] = (pMap[p] || 0) + rev;
            }
          });
          const days = last30Dates.size || 30;
          if (totRev > 0) {
            revStr = totRev >= 10000000 ? `₹${(totRev / 10000000).toFixed(2)} Cr` : `₹${(totRev / 100000).toFixed(2)} L`;
            dailyAvgStr = `₹${(totRev / days / 100000).toFixed(2)} L/day`;
            let maxP = 'MWeb', maxRev = 0;
            for (const [p, v] of Object.entries(pMap)) {
              if (v > maxRev) { maxRev = v; maxP = p; }
            }
            topPlatStr = maxP;
            topVolStr = `${Math.round((maxRev / totRev) * 100)}% Total Vol`;
          }
        }

        if (funnelData && funnelData.length > 0) {
          let totLoads = 0, totPurchased = 0;
          funnelData.filter(r => (r.viewType || '').toLowerCase() === 'overall' && (r.ET_Platform || '').toLowerCase() === 'combined' && (r.Country || '').toLowerCase() === 'overall' && (r.Marketing_team || '').toLowerCase() === 'overall').forEach(r => {
            totLoads += (r.Plan_Page_Loaded || r.Plan_Page_Load || r.plan_page_loads || 0);
            totPurchased += (r.Purchased || r.purchased || 0);
          });
          if (totLoads > 0) {
            convStr = `${((totPurchased / totLoads) * 100).toFixed(2)}%`;
          }
        }

        const updated = {
          ...first,
          kpis: [
            { label: "Total Revenue (30d)", value: revStr, sub: dailyAvgStr },
            { label: "Top Sales Platform", value: topPlatStr, sub: topVolStr },
            { label: "Funnel Conversion", value: convStr, sub: "Page Load to Sale" }
          ]
        };

        return [updated, ...prev.slice(1)];
      });
    }
  }, [subscriptionData, funnelData]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef(null);
  const lastRealQueryRef = useRef('');

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const sanitizeFollowups = (list) => {
    if (!Array.isArray(list)) return null;
    const filtered = list.filter(q => {
      if (!q || typeof q !== 'string') return false;
      const s = q.toLowerCase();
      if (s.includes('roas')) return false;
      if (s.includes('leaking') || s.includes('funnel leaking')) return false;
      if (s.includes('spend rose') || s.includes('delivery')) return false;
      if (s.includes('google vs meta') || s.includes('meta vs google')) return false;
      if (s.includes('landed') || s.includes('payment selected') || s.includes('landed -> payment') || s.includes('landed to payment') || s.includes('landed to pay')) return false;
      if (s.includes('top 3 campaigns') || s.includes('campaigns by pay initiated')) return false;
      return true;
    });
    return filtered.length > 0 ? filtered : null;
  };

  const sendQuery = async (queryText) => {
    if (!queryText || !queryText.trim()) return;

    let targetQuery = queryText.trim();
    let displayUserText = targetQuery;

    // If user clicked "Retry query" or typed "retry", re-run the previous actual query!
    if (targetQuery.toLowerCase() === 'retry query' || targetQuery.toLowerCase() === 'retry') {
      if (lastRealQueryRef.current) {
        targetQuery = lastRealQueryRef.current;
        displayUserText = `Retry: "${targetQuery}"`;
      }
    } else {
      lastRealQueryRef.current = targetQuery;
    }

    const userMsg = { id: Date.now(), sender: 'user', text: displayUserText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const result = await processConversationalQueryAsync(targetQuery, {
        subscriptionData,
        funnelData,
        realtimeData,
        renewalsData,
        conversationHistory: messages
      });

      const engineUsed = getStoredApiKey() ? 'Gemini 2.0 Flash' : 'Local React Engine';
      const userEmail = (typeof currentUser !== 'undefined' && currentUser && currentUser.email) ? currentUser.email : 'Anonymous User';
      logChatQuery(userEmail, queryText.trim(), engineUsed);

      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'bot',
          domain: result.domain || null,
          text: result.text,
          kpis: result.kpis || null,
          chart: result.chart || null,
          table: result.table || null,
          suggestedFollowups: sanitizeFollowups(result.suggestedFollowups)
        }
      ]);
    } catch (err) {
      console.error("Error running query:", err);
      const userEmail = (typeof currentUser !== 'undefined' && currentUser && currentUser.email) ? currentUser.email : 'Anonymous User';
      logChatQuery(userEmail, queryText.trim(), 'Error Engine');
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
        id: 1,
        isWelcome: true,
        sender: 'bot',
        text: 'Hello! I am your AI Ledger Assistant. Ask me anything about subscription trends, renewals, revenue pacing, or platform breakdowns across dates.',
        kpis: [
          { label: "Total Revenue (30d)", value: "₹4.23 Cr", sub: "₹14.10 L/day" },
          { label: "Top Sales Platform", value: "MWeb", sub: "41% Total Vol" },
          { label: "Funnel Conversion", value: "1.56%", sub: "Page Load to Sale" }
        ],
        suggestedFollowups: INITIAL_BOT_PROMPTS
      }
    ]);
  };

  const handleSend = (e) => {
    e.preventDefault();
    sendQuery(input);
  };

  return (
    <div className="animate-in fade-in duration-300 max-w-5xl mx-auto py-2 h-[calc(100vh-165px)] sm:h-[calc(100vh-135px)] flex flex-col">
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl shadow-sm p-4 md:p-5 flex flex-col flex-1 min-h-0">
        {/* Assistant Header */}
        <div className="flex items-center justify-between border-b border-warm-border dark:border-dark-border pb-3 mb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-500/10 text-amber-accent rounded-xl">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-warm-text dark:text-dark-text tracking-tight">Conversational BI Assistant</h2>
              <p className="text-[11px] text-warm-muted dark:text-dark-muted font-medium">Ask questions in natural language to analyze live dashboard data</p>
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
          </div>
        </div>

        {/* LLM Engine Configuration Modal */}
        {showKeyModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-zinc-900 border border-warm-border dark:border-zinc-700 rounded-2xl p-5 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-warm-border dark:border-zinc-800">
                <div className="flex items-center gap-2 text-amber-500">
                  <Sparkles className="h-5 w-5" />
                  <h3 className="font-extrabold text-warm-text dark:text-dark-text text-base">Conversational LLM Settings</h3>
                </div>
                <button onClick={() => setShowKeyModal(false)} className="text-warm-muted hover:text-warm-text text-lg cursor-pointer">✕</button>
              </div>
              
              <form onSubmit={handleSaveApiKey} className="space-y-4 pt-4">
                <p className="text-xs text-warm-muted dark:text-dark-muted font-medium leading-relaxed">
                  Configure your LLM provider to enable natural language zero-shot reasoning, 2-Pass multi-tool data fetching, and dynamic visualization synthesis.
                </p>
                
                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-extrabold text-amber-600 dark:text-amber-400 mb-1.5 flex items-center justify-between">
                    <span>🦙 Groq / Llama 3 API Key (Recommended)</span>
                    <span className="text-[9px] text-emerald-500 font-bold">Fastest (~200ms)</span>
                  </label>
                  <input
                    type="password"
                    value={groqInput}
                    onChange={(e) => setGroqInput(e.target.value)}
                    placeholder="gsk_..."
                    className="w-full px-3 py-2 text-xs rounded-xl bg-warm-tableBg dark:bg-zinc-800 border border-warm-border dark:border-zinc-700 text-warm-text dark:text-dark-text focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-extrabold text-warm-muted dark:text-dark-muted mb-1.5">
                    <span>⚡ Gemini 2.0 Flash API Key (Secondary Fallback)</span>
                  </label>
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full px-3 py-2 text-xs rounded-xl bg-warm-tableBg dark:bg-zinc-800 border border-warm-border dark:border-zinc-700 text-warm-text dark:text-dark-text focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-mono"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStoredApiKey('');
                      setStoredLlamaConfig({ apiKey: '' });
                      setApiKeyState('');
                      setLlamaConfigState({ apiKey: '' });
                      setKeyInput('');
                      setGroqInput('');
                      setShowKeyModal(false);
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-500/10 rounded-xl cursor-pointer"
                  >
                    Clear All Keys
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs font-extrabold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-sm transition-all cursor-pointer"
                  >
                    Save & Enable LLM
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Chat Messages Box */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-3.5 p-3.5 bg-warm-tableBg dark:bg-zinc-900/60 rounded-xl border border-warm-border/50 dark:border-zinc-800 mb-3">
          {messages.map(msg => (
            <div key={msg.id} className={`flex items-start gap-3 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`p-2 rounded-lg shrink-0 ${msg.sender === 'user' ? 'bg-amber-accent text-white' : 'bg-slate-700 text-amber-400'}`}>
                {msg.sender === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>

              <div className={`max-w-[85%] p-3.5 rounded-2xl text-xs md:text-sm font-medium leading-relaxed space-y-2.5 ${
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1.5">
                    {msg.kpis.map((kpi, idx) => (
                      <div key={idx} className="bg-warm-tableBg dark:bg-zinc-900/80 border border-warm-border/80 dark:border-zinc-700 p-2 rounded-xl shadow-xs">
                        <div className="text-[10px] uppercase tracking-wider font-extrabold text-warm-muted dark:text-dark-muted">{kpi.label}</div>
                        <div className="text-sm font-black text-warm-text dark:text-dark-text mt-0.5">{kpi.value}</div>
                        {kpi.sub && <div className="text-[10px] font-bold text-amber-accent dark:text-amber-400 mt-0.5">{kpi.sub}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* 3. Embedded Inline Mini Chart */}
                {msg.chart && (() => {
                  const cfg = buildPlotlyConfig(msg.chart, isDark);
                  if (!cfg || !cfg.traces || cfg.traces.length === 0) return null;
                  return (
                    <div className="bg-warm-tableBg dark:bg-zinc-900/80 border border-warm-border/80 dark:border-zinc-700 p-2.5 rounded-xl shadow-xs mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-xs font-bold text-warm-text dark:text-dark-text">{msg.chart.title}</div>
                        {cfg.traces.length > 1 && (
                          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md">
                            Multi-Metric Comparison
                          </span>
                        )}
                      </div>
                      <div className="w-full h-[220px]">
                        <Plot
                          data={cfg.traces}
                          layout={cfg.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: '100%', height: '100%' }}
                        />
                      </div>
                    </div>
                  );
                })()}

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
                            {(Array.isArray(row) ? row : Object.values(row || {})).map((cell, cIdx) => (
                              <td key={cIdx} className={`p-2 ${cIdx > 0 ? 'text-right font-bold' : 'font-semibold text-amber-accent'}`}>
                                {typeof cell === 'number' ? cell.toLocaleString() : String(cell ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 5. Inline Contextual Follow-up Suggestions */}
                {(() => {
                  const safeFollowups = sanitizeFollowups(msg.suggestedFollowups);
                  if (!safeFollowups || safeFollowups.length === 0) return null;
                  return (
                    <div className="pt-2.5 border-t border-warm-border/60 dark:border-zinc-700/60 mt-2.5">
                      <div className="text-[11px] font-bold text-warm-muted dark:text-dark-muted mb-1.5 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-amber-accent" />
                        <span>{(msg.isWelcome || msg.id === 1) ? "I can help you with:" : "Suggested Follow-up Questions:"}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {safeFollowups.map((followupQ, fIdx) => (
                          <button
                            key={fIdx}
                            onClick={() => sendQuery(followupQ)}
                            className="px-2.5 py-1 text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-500/30 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                          >
                            <span>{followupQ}</span>
                            <ArrowRight className="h-3 w-3 text-amber-accent" />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
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
        <form onSubmit={handleSend} className="flex items-center gap-2 shrink-0 pt-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything: e.g. How much revenue did iOS generate in last 7 days? Give Main iOS vs Market iOS..."
            className="flex-1 px-4 py-2.5 text-xs md:text-sm rounded-xl bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text focus:outline-none focus:ring-2 focus:ring-amber-accent shadow-sm"
          />
          <button
            type="submit"
            className="px-4 py-2.5 bg-amber-accent hover:bg-amber-600 text-white font-bold text-xs md:text-sm rounded-xl transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
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

function getPlanTenureCategory(planCat) {
  if (!planCat) return '< 1 Year';
  const str = String(planCat).trim().toUpperCase();
  const numMatch = str.match(/(\d+)/);
  if (!numMatch) return '< 1 Year';
  const num = parseInt(numMatch[1], 10);
  
  let days = 0;
  if (str.includes('MONTH') || str.includes('MO')) {
    days = num * 30;
  } else if (str.includes('YEAR') || str.includes('YR')) {
    days = num * 365;
  } else if (str.includes('DAY') || str.includes('D')) {
    days = num;
  } else {
    days = num;
  }

  if (days < 365) return '< 1 Year';
  if (days <= 1095) return '1-3 Years';
  return '> 3 Years';
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

  // Segment Filters State (Platform, Country, Marketing Team & Day of Week)
  const [selectedCountry, setSelectedCountry] = useState("All");
  const [selectedMarketingTeam, setSelectedMarketingTeam] = useState("All");

  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [isPlatformDropdownOpen, setIsPlatformDropdownOpen] = useState(false);
  const [isPlatformsTouched, setIsPlatformsTouched] = useState(false);

  const platformDropdownRef = useRef(null);
  const dayOfWeekDropdownRef = useRef(null);

  const DAYS_LIST = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const [selectedDaysOfWeek, setSelectedDaysOfWeek] = useState([...DAYS_LIST]);
  const [isDayOfWeekDropdownOpen, setIsDayOfWeekDropdownOpen] = useState(false);

  const toggleDayOfWeek = (day) => {
    if (selectedDaysOfWeek.includes(day)) {
      if (selectedDaysOfWeek.length === 1) return;
      setSelectedDaysOfWeek(prev => prev.filter(d => d !== day));
    } else {
      setSelectedDaysOfWeek(prev => [...prev, day]);
    }
  };

  const availablePlatforms = useMemo(() => {
    const list = Array.from(new Set(rawData.map(r => r.platform).filter(Boolean))).sort();
    return list.filter(p => p.toLowerCase() !== 'combined');
  }, [rawData]);

  useEffect(() => {
    if (availablePlatforms.length > 0 && !isPlatformsTouched) {
      setSelectedPlatforms(availablePlatforms);
    }
  }, [availablePlatforms, isPlatformsTouched]);

  const togglePlatform = (plat) => {
    setIsPlatformsTouched(true);
    if (selectedPlatforms.includes(plat)) {
      setSelectedPlatforms(prev => prev.filter(p => p !== plat));
    } else {
      setSelectedPlatforms(prev => [...prev, plat]);
    }
  };

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (platformDropdownRef.current && !platformDropdownRef.current.contains(event.target)) {
        setIsPlatformDropdownOpen(false);
      }
      if (dayOfWeekDropdownRef.current && !dayOfWeekDropdownRef.current.contains(event.target)) {
        setIsDayOfWeekDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [expandedRows, setExpandedRows] = useState({});
  const toggleRow = (key) => setExpandedRows(prev => ({ ...prev, [key]: !prev[key] }));

  // Dynamic dropdown lists for Country and Marketing Team
  const availableCountries = useMemo(() => {
    const list = Array.from(new Set(rawData.map(r => r.country).filter(Boolean))).sort();
    const sorted = list.filter(c => c.toLowerCase() !== 'overall');
    return ['All', ...sorted];
  }, [rawData]);

  const availableMarketingTeams = useMemo(() => {
    const list = Array.from(new Set(rawData.map(r => r.marketingTeam).filter(Boolean))).sort();
    const sorted = list.filter(m => m.toLowerCase() !== 'overall');
    return ['All', ...sorted];
  }, [rawData]);



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
    function processFunnelData(dataArray) {
      if (!dataArray || !Array.isArray(dataArray)) return;
      const parsed = dataArray.map(row => {
        const dateStr = String(row.event_date || '').trim();
        let formattedDateStr = '';
        if (dateStr.length === 8 && !dateStr.includes('-') && !dateStr.includes('/')) {
          formattedDateStr = `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`;
        } else if (dateStr.includes('-')) {
          formattedDateStr = dateStr;
        } else if (dateStr.includes('/')) {
          const parts = dateStr.split('/');
          if (parts.length === 3) {
            formattedDateStr = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
          }
        }
        if (!formattedDateStr) return null;
        
        return {
          dateObj: new Date(formattedDateStr),
          dateStr: formattedDateStr,
          viewType: row.view_type || 'Overall',
          platform: String(row.ET_Platform || row.et_platform || row.platform || '').trim(),
          country: String(row.Country || row.country || 'Overall').trim(),
          marketingTeam: String(row.Marketing_team || row.marketing_team || row.MarketingTeam || 'Overall').trim(),
          DAU: parseInt(row.DAU, 10) || 0,
          paywalling_hits: parseInt(row.paywalling_hits, 10) || 0,
          Plan_Page_Load: parseInt(row.Plan_Page_Loaded || row.Plan_Page_Load, 10) || 0,
          Plan_Selected: parseInt(row.Plan_Selected, 10) || 0,
          Pay_Initiated: parseInt(row.Pay_Initiated, 10) || 0,
          Purchased: parseInt(row.Purchased, 10) || 0
        };
      }).filter(Boolean);

      setRawData(parsed);
      setLoading(false);
    }

    async function fetchData() {
      if (!rawData || rawData.length === 0) setLoading(true);
      try {
        const results = await fetchDatasetCached('funnel', FUNNEL_GSHEET_URL);
        if (results && results.data) processFunnelData(results.data);
      } catch (err) {
        console.error("Funnel fetch error", err);
        setError("Failed to load funnel data.");
        setLoading(false);
      }
    }

    fetchData();

    const handleDatasetUpdated = (e) => {
      if (e.detail && e.detail.key === 'funnel' && e.detail.data) {
        console.log("⚡ [Funnel UI] Background live Google Sheet update received!");
        processFunnelData(e.detail.data);
      }
    };
    window.addEventListener('dataset-updated', handleDatasetUpdated);
    return () => window.removeEventListener('dataset-updated', handleDatasetUpdated);
  }, []);

  const [trendlineViewMode, setTrendlineViewMode] = useState("Daily"); // "Daily" | "Weekly"
  const [weeklyDauMode, setWeeklyDauMode] = useState("Daily Average"); // "Daily Average" | "Weekly Sum"

  // Process data for a given date range, segment filters, day of week list, and platforms list
  const processFunnelData = useCallback((sDate, eDate, filterCountry = 'All', filterMktTeam = 'All', daysOfWeekFilter = [], platformsFilter = []) => {
    const overall = { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Plan_Selected: 0, Pay_Initiated: 0, Purchased: 0, daily: {} };
    const platforms = {};
    const marketingTeams = {};
    const trends = {};

    if (!sDate || !eDate || rawData.length === 0) {
      return { overallSum: overall, overallAvg: overall, platformAvg: {}, marketingTeamAvg: {}, uniqueDays: 1, dates: [] };
    }

    const targetCountry = filterCountry === 'All' ? 'Overall' : filterCountry;
    const targetMktTeam = filterMktTeam === 'All' ? 'Overall' : filterMktTeam;
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const filtered = rawData.filter(r => {
      if (r.dateStr < sDate || r.dateStr > eDate) return false;
      const cMatch = r.country && r.country.toLowerCase() === targetCountry.toLowerCase();
      const mMatch = filterMktTeam === 'All' || (r.marketingTeam && r.marketingTeam.toLowerCase() === targetMktTeam.toLowerCase());
      
      let dayMatch = true;
      if (daysOfWeekFilter && daysOfWeekFilter.length > 0 && daysOfWeekFilter.length < 7) {
        const dayName = DAYS[r.dateObj.getDay()];
        dayMatch = daysOfWeekFilter.includes(dayName);
      }

      let platMatch = true;
      if (availablePlatforms.length > 0) {
        if (selectedPlatforms.length === 0 && isPlatformsTouched) {
          platMatch = false;
        } else if (selectedPlatforms.length > 0 && selectedPlatforms.length < availablePlatforms.length) {
          const p = r.platform || '';
          platMatch = p.toLowerCase() === 'combined' || selectedPlatforms.includes(p);
        }
      }

      return cMatch && mMatch && dayMatch && platMatch;
    });

    // Group filtered rows by dateStr, platform, and marketing team
    const dailyGroups = {};
    const platformDailyMap = {};
    const mktTeamDailyMap = {};

    filtered.forEach(row => {
      if (!dailyGroups[row.dateStr]) dailyGroups[row.dateStr] = [];
      dailyGroups[row.dateStr].push(row);

      // Platform grouping
      if (row.viewType === 'By Platform' || row.platform) {
        const plat = row.platform || 'Other';
        const key = `${plat}_${row.dateStr}`;
        if (!platformDailyMap[key]) {
          platformDailyMap[key] = { plat, dateStr: row.dateStr, rows: [] };
        }
        platformDailyMap[key].rows.push(row);
      }

      // Marketing team grouping
      const mTeam = row.marketingTeam;
      if (mTeam && mTeam.toLowerCase() !== 'overall') {
        const key = `${mTeam}_${row.dateStr}`;
        if (!mktTeamDailyMap[key]) {
          mktTeamDailyMap[key] = { mTeam, dateStr: row.dateStr, rows: [] };
        }
        mktTeamDailyMap[key].rows.push(row);
      }
    });

    // Aggregate platforms: DAU & paywalling_hits are identical across marketing teams for a platform on a date -> take once per date
    Object.values(platformDailyMap).forEach(({ plat, dateStr, rows }) => {
      if (!platforms[plat]) {
        platforms[plat] = { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Plan_Selected: 0, Pay_Initiated: 0, Purchased: 0, daily: {} };
      }

      const dayDau = Math.max(...rows.map(r => r.DAU), 0);
      const dayPaywall = Math.max(...rows.map(r => r.paywalling_hits), 0);

      let dayPageLoad = 0, daySelected = 0, dayInit = 0, dayPurch = 0;
      const overallTeamRow = rows.find(r => r.marketingTeam && r.marketingTeam.toLowerCase() === 'overall');

      if (overallTeamRow && filterMktTeam === 'All') {
        dayPageLoad = overallTeamRow.Plan_Page_Load;
        daySelected = overallTeamRow.Plan_Selected;
        dayInit = overallTeamRow.Pay_Initiated;
        dayPurch = overallTeamRow.Purchased;
      } else {
        const teamRows = filterMktTeam === 'All' 
          ? rows.filter(r => !r.marketingTeam || r.marketingTeam.toLowerCase() !== 'overall' || rows.length === 1)
          : rows;
        teamRows.forEach(r => {
          dayPageLoad += r.Plan_Page_Load;
          daySelected += r.Plan_Selected;
          dayInit += r.Pay_Initiated;
          dayPurch += r.Purchased;
        });
      }

      platforms[plat].DAU += dayDau;
      platforms[plat].paywalling_hits += dayPaywall;
      platforms[plat].Plan_Page_Load += dayPageLoad;
      platforms[plat].Plan_Selected += daySelected;
      platforms[plat].Pay_Initiated += dayInit;
      platforms[plat].Purchased += dayPurch;

      platforms[plat].daily[dateStr] = {
        DAU: dayDau,
        paywalling_hits: dayPaywall,
        Plan_Page_Load: dayPageLoad,
        Plan_Selected: daySelected,
        Pay_Initiated: dayInit,
        Purchased: dayPurch
      };
    });

    // Aggregate marketing teams
    Object.values(mktTeamDailyMap).forEach(({ mTeam, dateStr, rows }) => {
      if (!marketingTeams[mTeam]) {
        marketingTeams[mTeam] = { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Plan_Selected: 0, Pay_Initiated: 0, Purchased: 0, daily: {} };
      }

      const combinedPlatRow = rows.find(r => r.platform && r.platform.toLowerCase() === 'combined');
      let dayDau = 0;
      let dayPaywall = 0;

      if (combinedPlatRow) {
        dayDau = combinedPlatRow.DAU;
        dayPaywall = combinedPlatRow.paywalling_hits;
      } else {
        const platSeen = new Set();
        rows.forEach(r => {
          const plat = r.platform || 'Other';
          if (!platSeen.has(plat)) {
            platSeen.add(plat);
            dayDau += r.DAU;
            dayPaywall += r.paywalling_hits;
          }
        });
      }

      let dayPageLoad = 0, daySelected = 0, dayInit = 0, dayPurch = 0;
      if (combinedPlatRow && rows.length > 1) {
        const nonCombinedRows = rows.filter(r => r !== combinedPlatRow);
        nonCombinedRows.forEach(r => {
          dayPageLoad += r.Plan_Page_Load;
          daySelected += r.Plan_Selected;
          dayInit += r.Pay_Initiated;
          dayPurch += r.Purchased;
        });
      } else {
        rows.forEach(r => {
          dayPageLoad += r.Plan_Page_Load;
          daySelected += r.Plan_Selected;
          dayInit += r.Pay_Initiated;
          dayPurch += r.Purchased;
        });
      }

      marketingTeams[mTeam].DAU += dayDau;
      marketingTeams[mTeam].paywalling_hits += dayPaywall;
      marketingTeams[mTeam].Plan_Page_Load += dayPageLoad;
      marketingTeams[mTeam].Plan_Selected += daySelected;
      marketingTeams[mTeam].Pay_Initiated += dayInit;
      marketingTeams[mTeam].Purchased += dayPurch;

      marketingTeams[mTeam].daily[dateStr] = {
        DAU: dayDau,
        paywalling_hits: dayPaywall,
        Plan_Page_Load: dayPageLoad,
        Plan_Selected: daySelected,
        Pay_Initiated: dayInit,
        Purchased: dayPurch
      };
    });

    // Calculate Overall totals per date
    const dates = Object.keys(dailyGroups).sort();

    // Use Combined platform metrics for Overall if present, taking DAU and paywalling_hits once per date
    const combinedPlatformKey = Object.keys(platforms).find(k => k.toLowerCase() === 'combined');
    if (combinedPlatformKey && platforms[combinedPlatformKey]) {
      const pComb = platforms[combinedPlatformKey];
      overall.DAU = pComb.DAU;
      overall.paywalling_hits = pComb.paywalling_hits;
      overall.Plan_Page_Load = pComb.Plan_Page_Load;
      overall.Plan_Selected = pComb.Plan_Selected;
      overall.Pay_Initiated = pComb.Pay_Initiated;
      overall.Purchased = pComb.Purchased;
      overall.daily = pComb.daily;

      dates.forEach(d => {
        const dObj = pComb.daily[d] || { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Plan_Selected: 0, Pay_Initiated: 0, Purchased: 0 };
        trends[d] = { ...dObj };
      });
    } else {
      dates.forEach(d => {
        const rows = dailyGroups[d];

        // For DAU and Paywall Hits, take max value among rows for date d to count DAU and paywall hits once per date
        const dayDau = Math.max(...rows.map(r => r.DAU), 0);
        const dayPaywall = Math.max(...rows.map(r => r.paywalling_hits), 0);

        // For funnel stages, check if there is an Overall row, else sum across team rows
        const overallRow = rows.find(r => r.marketingTeam && r.marketingTeam.toLowerCase() === 'overall');

        let dayPageLoad = 0, daySelected = 0, dayInit = 0, dayPurch = 0;
        if (overallRow && filterMktTeam === 'All') {
          dayPageLoad = overallRow.Plan_Page_Load;
          daySelected = overallRow.Plan_Selected;
          dayInit = overallRow.Pay_Initiated;
          dayPurch = overallRow.Purchased;
        } else {
          const teamRows = rows.filter(r => !r.marketingTeam || r.marketingTeam.toLowerCase() !== 'overall' || rows.length === 1);
          teamRows.forEach(r => {
            dayPageLoad += r.Plan_Page_Load;
            daySelected += r.Plan_Selected;
            dayInit += r.Pay_Initiated;
            dayPurch += r.Purchased;
          });
        }

        overall.DAU += dayDau;
        overall.paywalling_hits += dayPaywall;
        overall.Plan_Page_Load += dayPageLoad;
        overall.Plan_Selected += daySelected;
        overall.Pay_Initiated += dayInit;
        overall.Purchased += dayPurch;

        overall.daily[d] = {
          DAU: dayDau,
          paywalling_hits: dayPaywall,
          Plan_Page_Load: dayPageLoad,
          Plan_Selected: daySelected,
          Pay_Initiated: dayInit,
          Purchased: dayPurch
        };

        trends[d] = {
          DAU: dayDau,
          paywalling_hits: dayPaywall,
          Plan_Page_Load: dayPageLoad,
          Plan_Selected: daySelected,
          Pay_Initiated: dayInit,
          Purchased: dayPurch
        };
      });
    }

    const uniqueDays = dates.length || 1;

    // Daily Averages
    const overallAvg = {
      DAU: Math.round(overall.DAU / uniqueDays),
      paywalling_hits: Math.round(overall.paywalling_hits / uniqueDays),
      Plan_Page_Load: Math.round(overall.Plan_Page_Load / uniqueDays),
      Plan_Selected: Math.round(overall.Plan_Selected / uniqueDays),
      Pay_Initiated: Math.round(overall.Pay_Initiated / uniqueDays),
      Purchased: Math.round(overall.Purchased / uniqueDays),
      daily: overall.daily
    };

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

    const marketingTeamAvg = {};
    Object.keys(marketingTeams).forEach(team => {
      const t = marketingTeams[team];
      marketingTeamAvg[team] = {
        DAU: Math.round(t.DAU / uniqueDays),
        paywalling_hits: Math.round(t.paywalling_hits / uniqueDays),
        Plan_Page_Load: Math.round(t.Plan_Page_Load / uniqueDays),
        Plan_Selected: Math.round(t.Plan_Selected / uniqueDays),
        Pay_Initiated: Math.round(t.Pay_Initiated / uniqueDays),
        Purchased: Math.round(t.Purchased / uniqueDays),
        daily: t.daily
      };
    });

    // Step Conversion Daily Rates
    const trendDau = dates.map(d => trends[d] ? trends[d].DAU : 0);
    const trendPaywallHits = dates.map(d => trends[d] ? trends[d].paywalling_hits : 0);
    const trendPageLoads = dates.map(d => trends[d] ? trends[d].Plan_Page_Load : 0);
    const trendPlanSelected = dates.map(d => trends[d] ? trends[d].Plan_Selected : 0);
    const trendPayInitiated = dates.map(d => trends[d] ? trends[d].Pay_Initiated : 0);
    const trendPurchased = dates.map(d => trends[d] ? trends[d].Purchased : 0);

    const trendConv = dates.map(d => (trends[d] && trends[d].Plan_Page_Load > 0) ? (trends[d].Purchased / trends[d].Plan_Page_Load) * 100 : 0);
    const trendPaywallRate = dates.map(d => (trends[d] && trends[d].DAU > 0) ? (trends[d].paywalling_hits / trends[d].DAU) * 100 : 0);

    const step1LoadToSelect = dates.map(d => (trends[d] && trends[d].Plan_Page_Load > 0) ? (trends[d].Plan_Selected / trends[d].Plan_Page_Load) * 100 : 0);
    const step2SelectToInit = dates.map(d => (trends[d] && trends[d].Plan_Selected > 0) ? (trends[d].Pay_Initiated / trends[d].Plan_Selected) * 100 : 0);
    const step3InitToPurch = dates.map(d => (trends[d] && trends[d].Pay_Initiated > 0) ? (trends[d].Purchased / trends[d].Pay_Initiated) * 100 : 0);
    const step4LoadToPurch = dates.map(d => (trends[d] && trends[d].Plan_Page_Load > 0) ? (trends[d].Purchased / trends[d].Plan_Page_Load) * 100 : 0);

    return { 
      overallSum: overall, 
      overallAvg, 
      platformAvg, 
      marketingTeamAvg,
      uniqueDays, 
      dates,
      trendData: { 
        dates, 
        dau: trendDau, 
        paywallHits: trendPaywallHits,
        pageLoads: trendPageLoads,
        planSelected: trendPlanSelected,
        payInitiated: trendPayInitiated,
        purchased: trendPurchased,
        paywallRate: trendPaywallRate, 
        conv: trendConv, 
        uniqueDays,
        step1: step1LoadToSelect,
        step2: step2SelectToInit,
        step3: step3InitToPurch,
        step4: step4LoadToPurch
      }
    };
  }, [rawData]);

  const primaryFunnel = useMemo(() => processFunnelData(startDate, endDate, selectedCountry, selectedMarketingTeam, selectedDaysOfWeek, selectedPlatforms), [processFunnelData, startDate, endDate, selectedCountry, selectedMarketingTeam, selectedDaysOfWeek, selectedPlatforms]);
  
  const isCompActive = compPreset !== "None" && compStartDate && compEndDate;
  const compFunnel = useMemo(() => {
    if (!isCompActive) return null;
    return processFunnelData(compStartDate, compEndDate, selectedCountry, selectedMarketingTeam, selectedDaysOfWeek, selectedPlatforms);
  }, [processFunnelData, isCompActive, compStartDate, compEndDate, selectedCountry, selectedMarketingTeam, selectedDaysOfWeek, selectedPlatforms]);

  // Helper to compute weekly grouped step data for trendlines
  const computeWeeklyStepData = useCallback((trendObj, dauMode = "Daily Average") => {
    if (!trendObj || !trendObj.dates || !trendObj.dates.length) {
      return { dates: [], dau: [], paywallHits: [], pageLoads: [], planSelected: [], payInitiated: [], purchased: [], step1: [], step2: [], step3: [], step4: [] };
    }

    const weeklyBuckets = {};
    trendObj.dates.forEach((dateStr, idx) => {
      const d = new Date(dateStr);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      const monthStr = String(monday.getMonth() + 1).padStart(2, '0');
      const dateNumStr = String(monday.getDate()).padStart(2, '0');
      const weekKey = `${monday.getFullYear()}-${monthStr}-${dateNumStr}`;
      const weekLabel = weekKey; // Week Start Date (YYYY-MM-DD)

      if (!weeklyBuckets[weekKey]) {
        weeklyBuckets[weekKey] = { 
          label: weekLabel, 
          dauSum: 0, 
          paywallHitsSum: 0, 
          pageLoadsSum: 0,
          planSelectedSum: 0,
          payInitiatedSum: 0,
          purchasedSum: 0,
          step1Sum: 0, 
          step2Sum: 0, 
          step3Sum: 0, 
          step4Sum: 0, 
          count: 0 
        };
      }
      weeklyBuckets[weekKey].dauSum += trendObj.dau ? (trendObj.dau[idx] || 0) : 0;
      weeklyBuckets[weekKey].paywallHitsSum += trendObj.paywallHits ? (trendObj.paywallHits[idx] || 0) : 0;
      weeklyBuckets[weekKey].pageLoadsSum += trendObj.pageLoads ? (trendObj.pageLoads[idx] || 0) : 0;
      weeklyBuckets[weekKey].planSelectedSum += trendObj.planSelected ? (trendObj.planSelected[idx] || 0) : 0;
      weeklyBuckets[weekKey].payInitiatedSum += trendObj.payInitiated ? (trendObj.payInitiated[idx] || 0) : 0;
      weeklyBuckets[weekKey].purchasedSum += trendObj.purchased ? (trendObj.purchased[idx] || 0) : 0;
      weeklyBuckets[weekKey].step1Sum += trendObj.step1 ? (trendObj.step1[idx] || 0) : 0;
      weeklyBuckets[weekKey].step2Sum += trendObj.step2 ? (trendObj.step2[idx] || 0) : 0;
      weeklyBuckets[weekKey].step3Sum += trendObj.step3 ? (trendObj.step3[idx] || 0) : 0;
      weeklyBuckets[weekKey].step4Sum += trendObj.step4 ? (trendObj.step4[idx] || 0) : 0;
      weeklyBuckets[weekKey].count += 1;
    });

    const sortedKeys = Object.keys(weeklyBuckets).sort();
    return {
      dates: sortedKeys.map(k => weeklyBuckets[k].label),
      dau: sortedKeys.map(k => dauMode === "Weekly Sum" ? weeklyBuckets[k].dauSum : Math.round(weeklyBuckets[k].dauSum / weeklyBuckets[k].count)),
      paywallHits: sortedKeys.map(k => dauMode === "Weekly Sum" ? weeklyBuckets[k].paywallHitsSum : Math.round(weeklyBuckets[k].paywallHitsSum / weeklyBuckets[k].count)),
      pageLoads: sortedKeys.map(k => dauMode === "Weekly Sum" ? weeklyBuckets[k].pageLoadsSum : Math.round(weeklyBuckets[k].pageLoadsSum / weeklyBuckets[k].count)),
      planSelected: sortedKeys.map(k => dauMode === "Weekly Sum" ? weeklyBuckets[k].planSelectedSum : Math.round(weeklyBuckets[k].planSelectedSum / weeklyBuckets[k].count)),
      payInitiated: sortedKeys.map(k => dauMode === "Weekly Sum" ? weeklyBuckets[k].payInitiatedSum : Math.round(weeklyBuckets[k].payInitiatedSum / weeklyBuckets[k].count)),
      purchased: sortedKeys.map(k => dauMode === "Weekly Sum" ? weeklyBuckets[k].purchasedSum : Math.round(weeklyBuckets[k].purchasedSum / weeklyBuckets[k].count)),
      step1: sortedKeys.map(k => parseFloat((weeklyBuckets[k].step1Sum / weeklyBuckets[k].count).toFixed(1))),
      step2: sortedKeys.map(k => parseFloat((weeklyBuckets[k].step2Sum / weeklyBuckets[k].count).toFixed(1))),
      step3: sortedKeys.map(k => parseFloat((weeklyBuckets[k].step3Sum / weeklyBuckets[k].count).toFixed(1))),
      step4: sortedKeys.map(k => parseFloat((weeklyBuckets[k].step4Sum / weeklyBuckets[k].count).toFixed(1))),
    };
  }, []);

  const primaryTrendDisplay = useMemo(() => {
    if (!primaryFunnel.trendData) return null;
    if (trendlineViewMode === "Weekly") {
      return computeWeeklyStepData(primaryFunnel.trendData, weeklyDauMode);
    }
    return {
      dates: primaryFunnel.trendData.dates,
      dau: primaryFunnel.trendData.dau,
      paywallHits: primaryFunnel.trendData.paywallHits,
      pageLoads: primaryFunnel.trendData.pageLoads,
      planSelected: primaryFunnel.trendData.planSelected,
      payInitiated: primaryFunnel.trendData.payInitiated,
      purchased: primaryFunnel.trendData.purchased,
      step1: primaryFunnel.trendData.step1.map(v => parseFloat(v.toFixed(1))),
      step2: primaryFunnel.trendData.step2.map(v => parseFloat(v.toFixed(1))),
      step3: primaryFunnel.trendData.step3.map(v => parseFloat(v.toFixed(1))),
      step4: primaryFunnel.trendData.step4.map(v => parseFloat(v.toFixed(1)))
    };
  }, [primaryFunnel.trendData, trendlineViewMode, weeklyDauMode, computeWeeklyStepData]);

  const compTrendDisplay = useMemo(() => {
    if (!compFunnel || !compFunnel.trendData) return null;
    if (trendlineViewMode === "Weekly") {
      return computeWeeklyStepData(compFunnel.trendData, weeklyDauMode);
    }
    return {
      dates: compFunnel.trendData.dates,
      dau: compFunnel.trendData.dau,
      paywallHits: compFunnel.trendData.paywallHits,
      pageLoads: compFunnel.trendData.pageLoads,
      planSelected: compFunnel.trendData.planSelected,
      payInitiated: compFunnel.trendData.payInitiated,
      purchased: compFunnel.trendData.purchased,
      step1: compFunnel.trendData.step1.map(v => parseFloat(v.toFixed(1))),
      step2: compFunnel.trendData.step2.map(v => parseFloat(v.toFixed(1))),
      step3: compFunnel.trendData.step3.map(v => parseFloat(v.toFixed(1))),
      step4: compFunnel.trendData.step4.map(v => parseFloat(v.toFixed(1)))
    };
  }, [compFunnel, trendlineViewMode, weeklyDauMode, computeWeeklyStepData]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm my-6 p-4">
        <CleanDashboardLoader title="Loading Funnel Data..." subtitle="Processing conversion stages across channels and marketing teams" />
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
  const trendlineColor = isDark ? '#fbbf24' : '#d97706';

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
      color: ['#FDE68A', '#FCD34D', '#FBBF24', '#F59E0B', '#D97706', '#B45309'],
      line: { width: 1, color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }
    },
    textfont: { family: 'inherit', color: '#0F172A', size: 11, weight: 'bold' }
  });

  if (isCompActive && compFunnel) {
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
    autosize: true,
    height: 48,
    margin: { l: 2, r: 2, t: 2, b: 2 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    xaxis: { visible: false, fixedrange: true },
    yaxis: { visible: false, fixedrange: true },
    showlegend: false,
    hovermode: 'x'
  };

  const activePlatforms = Object.keys(primaryFunnel.platformAvg).filter(p => p.toLowerCase() !== 'combined').sort();

  // Helper renderer for cell stage metrics
  const renderStageCell = (val, prevVal, compVal = null, showPerDay = true, isFirstStep = false) => {
    const dropoff = (!isFirstStep && prevVal > 0) ? ((val / prevVal) * 100).toFixed(1) : null;
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
            parseFloat(diffPct) >= 0 ? (
              <span className="text-xs font-semibold text-green-600 dark:text-green-400 inline-flex items-center gap-0.5">
                <span className="text-[9px]">▲</span> +{diffPct}%
              </span>
            ) : (
              <span className="text-xs font-semibold text-red-600 dark:text-red-400 inline-flex items-center gap-0.5">
                <span className="text-[9px]">▼</span> {diffPct}%
              </span>
            )
          )}
        </div>
      </td>
    );
  };

  return (
    <div className="animate-in fade-in duration-300">
      
      {/* Date Range & Segment Controls Card (Header on Line 1, Filters on Line 2) */}
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl p-3.5 2xl:p-4 shadow-sm mb-6 relative z-20">
        {/* Header Line */}
        <div className="pb-2.5 mb-3 border-b border-warm-border/60 dark:border-dark-border/60">
          <h2 className="text-sm font-bold text-warm-text dark:text-dark-text tracking-tight">
            Funnel Period Controls
          </h2>
        </div>

        {/* Filter Controls Grid (3x2 Matrix Layout like Subscription Report) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 w-full">
          {/* 1. Primary Range Selection */}
          <div className="flex flex-col gap-1 w-full">
            <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Primary Period</label>
            <div className="flex items-center gap-1 w-full bg-warm-tableBg/60 dark:bg-slate-800/60 p-1.5 rounded-lg border border-warm-border/40 dark:border-dark-border/40">
              {datePreset === "Custom range" && (
                <div className="flex items-center gap-1">
                  <input type="date" value={startDate} min="2020-01-01" max={new Date().toISOString().split('T')[0]} onChange={(e) => setStartDate(e.target.value)} className="px-1 py-0.5 text-[10px] font-medium rounded-md bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
                  <span className="text-[10px] text-warm-muted dark:text-dark-muted">to</span>
                  <input type="date" value={endDate} min="2020-01-01" max={new Date().toISOString().split('T')[0]} onChange={(e) => setEndDate(e.target.value)} className="px-1 py-0.5 text-[10px] font-medium rounded-md bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
                </div>
              )}
              <select 
                value={datePreset} 
                onChange={(e) => setDatePreset(e.target.value)}
                className="bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-[11px] font-bold rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-xs cursor-pointer w-full"
              >
                <option value="Yesterday">Yesterday</option>
                <option value="Last 7 days">Last 7 days</option>
                <option value="Last 30 days">Last 30 days</option>
                <option value="This month">This month</option>
                <option value="Last month">Last month</option>
                <option value="Last 90 days">Last 90 days</option>
                <option value="Custom range">Custom range</option>
              </select>
            </div>
          </div>

          {/* 2. Comparison Period Selector */}
          <div className="flex flex-col gap-1 w-full">
            <label className="text-[10px] font-bold uppercase tracking-wider text-amber-accent">Comparison Period</label>
            <div className="flex items-center gap-1 w-full bg-warm-tableBg/60 dark:bg-slate-800/60 p-1.5 rounded-lg border border-warm-border/40 dark:border-dark-border/40">
              {compPreset === "Custom range" && (
                <div className="flex items-center gap-1">
                  <input type="date" value={compStartDate} min="2020-01-01" max={new Date().toISOString().split('T')[0]} onChange={(e) => setCompStartDate(e.target.value)} className="px-1 py-0.5 text-[10px] font-medium rounded-md bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
                  <span className="text-[10px] text-warm-muted dark:text-dark-muted">to</span>
                  <input type="date" value={compEndDate} min="2020-01-01" max={new Date().toISOString().split('T')[0]} onChange={(e) => setCompEndDate(e.target.value)} className="px-1 py-0.5 text-[10px] font-medium rounded-md bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
                </div>
              )}
              <select 
                value={compPreset} 
                onChange={(e) => setCompPreset(e.target.value)}
                className="bg-white dark:bg-slate-800 border border-amber-500/40 text-warm-text dark:text-dark-text text-[11px] font-bold rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-xs cursor-pointer w-full"
              >
                <option value="None">No Comparison</option>
                <option value="Previous period">Previous period</option>
                <option value="Previous month">Previous month</option>
                <option value="Custom range">Custom range</option>
              </select>
            </div>
          </div>

          {/* 3. Platform Multi-select Checkbox Popover */}
          <div className="relative flex flex-col gap-1 w-full" ref={platformDropdownRef}>
            <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Platform</label>
            <button
              type="button"
              onClick={() => setIsPlatformDropdownOpen(!isPlatformDropdownOpen)}
              className="flex items-center justify-between bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-[11px] font-bold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-xs cursor-pointer w-full"
            >
              <span className="truncate">
                {selectedPlatforms.length === 0
                  ? 'None Selected'
                  : selectedPlatforms.length === availablePlatforms.length
                  ? 'All Platforms' 
                  : `${selectedPlatforms.length} Selected`}
              </span>
              <ChevronDown size={14} className="text-warm-muted dark:text-dark-muted shrink-0 ml-1" />
            </button>

            {isPlatformDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-56 bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-xl shadow-xl z-50 p-3">
                <div className="flex items-center justify-between border-b border-warm-border dark:border-dark-border pb-2 mb-2">
                  <span className="text-xs font-bold text-warm-text dark:text-dark-text">Select Platforms</span>
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsPlatformsTouched(true);
                      if (selectedPlatforms.length === availablePlatforms.length) {
                        setSelectedPlatforms([]);
                      } else {
                        setSelectedPlatforms([...availablePlatforms]);
                      }
                    }}
                    className="text-[11px] font-bold text-amber-accent hover:underline cursor-pointer"
                  >
                    {selectedPlatforms.length === availablePlatforms.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar">
                  {availablePlatforms.map(plat => {
                    const checked = selectedPlatforms.includes(plat);
                    return (
                      <label key={plat} className="flex items-center gap-2 text-xs font-medium text-warm-text dark:text-dark-text cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePlatform(plat)}
                          className="accent-amber-500 rounded cursor-pointer"
                        />
                        <span>{plat}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 4. Country Filter Selector */}
          <div className="flex flex-col gap-1 w-full">
            <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Country</label>
            <select 
              value={selectedCountry} 
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-[11px] font-bold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-xs cursor-pointer w-full"
            >
              {availableCountries.map(c => (
                <option key={c} value={c}>{c === 'All' ? 'All Countries' : c}</option>
              ))}
            </select>
          </div>

          {/* 5. Marketing Team Filter Selector */}
          <div className="flex flex-col gap-1 w-full">
            <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Marketing Team</label>
            <select 
              value={selectedMarketingTeam} 
              onChange={(e) => setSelectedMarketingTeam(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-[11px] font-bold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-xs cursor-pointer w-full"
            >
              {availableMarketingTeams.map(m => (
                <option key={m} value={m}>{m === 'All' ? 'All Teams' : m}</option>
              ))}
            </select>
          </div>

          {/* 6. Day of Week Multi-select Checkbox Popover */}
          <div className="relative flex flex-col gap-1 w-full" ref={dayOfWeekDropdownRef}>
            <label className="text-[10px] font-bold uppercase tracking-wider text-warm-label dark:text-dark-label">Day of Week</label>
            <button
              type="button"
              onClick={() => setIsDayOfWeekDropdownOpen(!isDayOfWeekDropdownOpen)}
              className="flex items-center justify-between bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-[11px] font-bold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-xs cursor-pointer w-full"
            >
              <span className="truncate">
                {selectedDaysOfWeek.length === 7 
                  ? 'All Days' 
                  : selectedDaysOfWeek.length === 0 
                  ? 'None Selected' 
                  : `${selectedDaysOfWeek.length} Days Selected`}
              </span>
              <ChevronDown size={14} className="text-warm-muted dark:text-dark-muted shrink-0 ml-1" />
            </button>

            {isDayOfWeekDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 bg-white dark:bg-slate-800 border border-warm-border dark:border-dark-border rounded-xl shadow-xl z-50 p-3">
                <div className="flex items-center justify-between border-b border-warm-border dark:border-dark-border pb-2 mb-2">
                  <span className="text-xs font-bold text-warm-text dark:text-dark-text">Select Days</span>
                  <button 
                    type="button" 
                    onClick={() => {
                      if (selectedDaysOfWeek.length === 7) {
                        setSelectedDaysOfWeek([]);
                      } else {
                        setSelectedDaysOfWeek([...DAYS_LIST]);
                      }
                    }}
                    className="text-[11px] font-bold text-amber-accent hover:underline cursor-pointer"
                  >
                    {selectedDaysOfWeek.length === 7 ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                  {DAYS_LIST.map(day => {
                    const checked = selectedDaysOfWeek.includes(day);
                    return (
                      <label key={day} className="flex items-center gap-2 text-xs font-medium text-warm-text dark:text-dark-text cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDayOfWeek(day)}
                          className="accent-amber-500 rounded cursor-pointer"
                        />
                        <span>{day}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-4 sm:p-5 hover:shadow-md transition-shadow flex flex-col sm:flex-row sm:items-center justify-between gap-2 relative overflow-hidden">
          <div className="shrink-0">
            <h3 className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-1">Daily Active Users</h3>
            <div className="flex items-end gap-2">
              <span className="text-2xl sm:text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">
                {dailyAvgDau.toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] text-warm-muted dark:text-dark-muted mt-1 font-semibold">Daily Active Users</p>
          </div>
          {trendData && (
            <div className="w-full sm:w-28 h-12 shrink-0 overflow-hidden mt-1 sm:mt-0">
              <Plot
                data={[{ x: trendData.dates, y: trendData.dau, type: 'scatter', mode: 'lines+markers', marker: { size: 3 }, line: { color: isDark ? '#fbbf24' : '#d97706', width: 2 }, fill: 'tozeroy', fillcolor: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(217,119,6,0.1)', hovertext: trendData.dau.map(v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(1)), hovertemplate: '%{hovertext}<extra></extra>' }]}
                layout={sparklineLayout} config={{ responsive: true, displayModeBar: false }} style={{ width: '100%', height: '100%' }}
              />
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-4 sm:p-5 hover:shadow-md transition-shadow flex flex-col sm:flex-row sm:items-center justify-between gap-2 relative overflow-hidden">
          <div className="shrink-0">
            <h3 className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-1">Overall Conversion</h3>
            <div className="flex items-end gap-2">
              <span className="text-2xl sm:text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">
                {overallConversion}%
              </span>
            </div>
            <p className="text-[10px] text-warm-muted dark:text-dark-muted mt-1 font-semibold">Purchased vs Plan Page Load</p>
          </div>
          {trendData && (
            <div className="w-full sm:w-28 h-12 shrink-0 overflow-hidden mt-1 sm:mt-0">
              <Plot
                data={[{ x: trendData.dates, y: trendData.conv, type: 'scatter', mode: 'lines+markers', marker: { size: 3 }, line: { color: isDark ? '#fbbf24' : '#d97706', width: 2 }, fill: 'tozeroy', fillcolor: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(217,119,6,0.1)', hovertext: trendData.conv.map(v => `${Number(v).toFixed(1)}%`), hovertemplate: '%{hovertext}<extra></extra>' }]}
                layout={sparklineLayout} config={{ responsive: true, displayModeBar: false }} style={{ width: '100%', height: '100%' }}
              />
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-4 sm:p-5 hover:shadow-md transition-shadow flex flex-col sm:flex-row sm:items-center justify-between gap-2 relative overflow-hidden">
          <div className="shrink-0">
            <h3 className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-1">Paywall Hit Rate</h3>
            <div className="flex items-end gap-2">
              <span className="text-2xl sm:text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">
                {paywallRate}%
              </span>
            </div>
            <p className="text-[10px] text-warm-muted dark:text-dark-muted mt-1 font-semibold">Paywall hits vs DAU</p>
          </div>
          {trendData && (
            <div className="w-full sm:w-28 h-12 shrink-0 overflow-hidden mt-1 sm:mt-0">
              <Plot
                data={[{ x: trendData.dates, y: trendData.paywallRate, type: 'scatter', mode: 'lines+markers', marker: { size: 3 }, line: { color: isDark ? '#fbbf24' : '#d97706', width: 2 }, fill: 'tozeroy', fillcolor: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(217,119,6,0.1)', hovertext: trendData.paywallRate.map(v => `${Number(v).toFixed(1)}%`), hovertemplate: '%{hovertext}<extra></extra>' }]}
                layout={sparklineLayout} config={{ responsive: true, displayModeBar: false }} style={{ width: '100%', height: '100%' }}
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

      {/* Funnel Trendlines Section (DAU, Paywall Hits & Step Conversions) */}
      {primaryTrendDisplay && (
        <section className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-warm-text dark:text-dark-text">Funnel Volume & Step Conversion Rate Trendlines</h3>
              <p className="text-xs text-warm-muted dark:text-dark-muted">Volume trends and step-by-step conversion percentages ({trendlineViewMode} View)</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
              {/* Sub-toggle for DAU & Funnel Volumes in Weekly View */}
              {trendlineViewMode === "Weekly" && (
                <div className="flex items-center gap-1 bg-amber-50 dark:bg-amber-950/40 p-1 rounded-lg border border-amber-200 dark:border-amber-900/50 text-xs">
                  <span className="text-[11px] font-bold text-amber-900 dark:text-amber-300 px-1">Volume Metrics:</span>
                  <button
                    type="button"
                    onClick={() => setWeeklyDauMode("Daily Average")}
                    className={`px-2 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-all ${
                      weeklyDauMode === "Daily Average"
                        ? "bg-amber-500 text-white shadow-xs"
                        : "text-amber-800 dark:text-amber-300 hover:bg-amber-200/50"
                    }`}
                  >
                    Daily Avg
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeeklyDauMode("Weekly Sum")}
                    className={`px-2 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-all ${
                      weeklyDauMode === "Weekly Sum"
                        ? "bg-amber-500 text-white shadow-xs"
                        : "text-amber-800 dark:text-amber-300 hover:bg-amber-200/50"
                    }`}
                  >
                    Weekly Sum
                  </button>
                </div>
              )}

              {/* Daily / Weekly View Toggle */}
              <div className="flex items-center gap-1 bg-warm-bg dark:bg-zinc-800 p-1 rounded-lg border border-warm-border dark:border-zinc-700">
                <button
                  type="button"
                  onClick={() => setTrendlineViewMode("Daily")}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    trendlineViewMode === "Daily"
                      ? "bg-amber-500 text-white shadow-xs"
                      : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                  }`}
                >
                  Daily View
                </button>
                <button
                  type="button"
                  onClick={() => setTrendlineViewMode("Weekly")}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    trendlineViewMode === "Weekly"
                      ? "bg-amber-500 text-white shadow-xs"
                      : "text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
                  }`}
                >
                  Weekly View
                </button>
              </div>
            </div>
          </div>

          {/* 3x3 Matrix of Trendline Charts (9 Charts Total) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Chart 1: DAU */}
            <div className="bg-warm-bg/40 dark:bg-zinc-900/40 p-4 rounded-xl border border-warm-border/60 dark:border-zinc-800">
              <div className="text-xs font-bold mb-2 text-warm-text dark:text-dark-text flex items-center justify-between">
                <span>Daily Active Users (DAU)</span>
                <span className="text-[11px] font-extrabold text-amber-accent">Volume</span>
              </div>
              <div className="w-full h-[200px]">
                <Plot
                  data={[
                    {
                      x: primaryTrendDisplay.dates,
                      y: primaryTrendDisplay.dau,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Primary (${startDate} to ${endDate})`,
                      line: { color: trendlineColor, width: 2 },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} DAU</b><extra></extra>'
                    },
                    ...(compTrendDisplay ? [{
                      x: compTrendDisplay.dates,
                      y: compTrendDisplay.dau,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Comparison (${compStartDate} to ${compEndDate})`,
                      line: { color: '#3b82f6', width: 2, dash: 'dot' },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} DAU</b><extra></extra>'
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 55, r: 20, t: 20, b: 40 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    xaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' } },
                    yaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' }, tickformat: ',d' },
                    showlegend: isCompActive,
                    legend: { orientation: 'h', y: 1.15, font: { size: 10 } }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>

            {/* Chart 2: Paywall Hits */}
            <div className="bg-warm-bg/40 dark:bg-zinc-900/40 p-4 rounded-xl border border-warm-border/60 dark:border-zinc-800">
              <div className="text-xs font-bold mb-2 text-warm-text dark:text-dark-text flex items-center justify-between">
                <span>Paywall Hits</span>
                <span className="text-[11px] font-extrabold text-amber-accent">Volume</span>
              </div>
              <div className="w-full h-[200px]">
                <Plot
                  data={[
                    {
                      x: primaryTrendDisplay.dates,
                      y: primaryTrendDisplay.paywallHits,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Primary (${startDate} to ${endDate})`,
                      line: { color: trendlineColor, width: 2 },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} Hits</b><extra></extra>'
                    },
                    ...(compTrendDisplay ? [{
                      x: compTrendDisplay.dates,
                      y: compTrendDisplay.paywallHits,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Comparison (${compStartDate} to ${compEndDate})`,
                      line: { color: '#3b82f6', width: 2, dash: 'dot' },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} Hits</b><extra></extra>'
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 55, r: 20, t: 20, b: 40 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    xaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' } },
                    yaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' }, tickformat: ',d' },
                    showlegend: isCompActive,
                    legend: { orientation: 'h', y: 1.15, font: { size: 10 } }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>

            {/* Chart 3: Plan Page Loads */}
            <div className="bg-warm-bg/40 dark:bg-zinc-900/40 p-4 rounded-xl border border-warm-border/60 dark:border-zinc-800">
              <div className="text-xs font-bold mb-2 text-warm-text dark:text-dark-text flex items-center justify-between">
                <span>Plan Page Loads</span>
                <span className="text-[11px] font-extrabold text-amber-accent">Volume</span>
              </div>
              <div className="w-full h-[200px]">
                <Plot
                  data={[
                    {
                      x: primaryTrendDisplay.dates,
                      y: primaryTrendDisplay.pageLoads,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Primary (${startDate} to ${endDate})`,
                      line: { color: trendlineColor, width: 2 },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} Page Loads</b><extra></extra>'
                    },
                    ...(compTrendDisplay ? [{
                      x: compTrendDisplay.dates,
                      y: compTrendDisplay.pageLoads,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Comparison (${compStartDate} to ${compEndDate})`,
                      line: { color: '#3b82f6', width: 2, dash: 'dot' },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} Page Loads</b><extra></extra>'
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 55, r: 20, t: 20, b: 40 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    xaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' } },
                    yaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' }, tickformat: ',d' },
                    showlegend: isCompActive,
                    legend: { orientation: 'h', y: 1.15, font: { size: 10 } }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>

            {/* Chart 4: Plan Selected */}
            <div className="bg-warm-bg/40 dark:bg-zinc-900/40 p-4 rounded-xl border border-warm-border/60 dark:border-zinc-800">
              <div className="text-xs font-bold mb-2 text-warm-text dark:text-dark-text flex items-center justify-between">
                <span>Plan Selected</span>
                <span className="text-[11px] font-extrabold text-amber-accent">Volume</span>
              </div>
              <div className="w-full h-[200px]">
                <Plot
                  data={[
                    {
                      x: primaryTrendDisplay.dates,
                      y: primaryTrendDisplay.planSelected,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Primary (${startDate} to ${endDate})`,
                      line: { color: trendlineColor, width: 2 },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} Plan Selected</b><extra></extra>'
                    },
                    ...(compTrendDisplay ? [{
                      x: compTrendDisplay.dates,
                      y: compTrendDisplay.planSelected,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Comparison (${compStartDate} to ${compEndDate})`,
                      line: { color: '#3b82f6', width: 2, dash: 'dot' },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} Plan Selected</b><extra></extra>'
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 55, r: 20, t: 20, b: 40 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    xaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' } },
                    yaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' }, tickformat: ',d' },
                    showlegend: isCompActive,
                    legend: { orientation: 'h', y: 1.15, font: { size: 10 } }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>

            {/* Chart 5: Pay Initiated */}
            <div className="bg-warm-bg/40 dark:bg-zinc-900/40 p-4 rounded-xl border border-warm-border/60 dark:border-zinc-800">
              <div className="text-xs font-bold mb-2 text-warm-text dark:text-dark-text flex items-center justify-between">
                <span>Pay Initiated</span>
                <span className="text-[11px] font-extrabold text-amber-accent">Volume</span>
              </div>
              <div className="w-full h-[200px]">
                <Plot
                  data={[
                    {
                      x: primaryTrendDisplay.dates,
                      y: primaryTrendDisplay.payInitiated,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Primary (${startDate} to ${endDate})`,
                      line: { color: trendlineColor, width: 2 },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} Pay Initiated</b><extra></extra>'
                    },
                    ...(compTrendDisplay ? [{
                      x: compTrendDisplay.dates,
                      y: compTrendDisplay.payInitiated,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Comparison (${compStartDate} to ${compEndDate})`,
                      line: { color: '#3b82f6', width: 2, dash: 'dot' },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} Pay Initiated</b><extra></extra>'
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 55, r: 20, t: 20, b: 40 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    xaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' } },
                    yaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' }, tickformat: ',d' },
                    showlegend: isCompActive,
                    legend: { orientation: 'h', y: 1.15, font: { size: 10 } }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>

            {/* Chart 6: Purchased */}
            <div className="bg-warm-bg/40 dark:bg-zinc-900/40 p-4 rounded-xl border border-warm-border/60 dark:border-zinc-800">
              <div className="text-xs font-bold mb-2 text-warm-text dark:text-dark-text flex items-center justify-between">
                <span>Purchased</span>
                <span className="text-[11px] font-extrabold text-amber-accent">Volume</span>
              </div>
              <div className="w-full h-[200px]">
                <Plot
                  data={[
                    {
                      x: primaryTrendDisplay.dates,
                      y: primaryTrendDisplay.purchased,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Primary (${startDate} to ${endDate})`,
                      line: { color: trendlineColor, width: 2 },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} Purchased</b><extra></extra>'
                    },
                    ...(compTrendDisplay ? [{
                      x: compTrendDisplay.dates,
                      y: compTrendDisplay.purchased,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Comparison (${compStartDate} to ${compEndDate})`,
                      line: { color: '#3b82f6', width: 2, dash: 'dot' },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:,.0f} Purchased</b><extra></extra>'
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 55, r: 20, t: 20, b: 40 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    xaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' } },
                    yaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' }, tickformat: ',d' },
                    showlegend: isCompActive,
                    legend: { orientation: 'h', y: 1.15, font: { size: 10 } }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>

            {/* Chart 7: Step 1: Plan Load -> Plan Selected */}
            <div className="bg-warm-bg/40 dark:bg-zinc-900/40 p-4 rounded-xl border border-warm-border/60 dark:border-zinc-800">
              <div className="text-xs font-bold mb-2 text-warm-text dark:text-dark-text flex items-center justify-between">
                <span>Plan Page Load &rarr; Plan Selected %</span>
                <span className="text-[11px] font-extrabold text-amber-accent">Step 1</span>
              </div>
              <div className="w-full h-[200px]">
                <Plot
                  data={[
                    {
                      x: primaryTrendDisplay.dates,
                      y: primaryTrendDisplay.step1,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Primary (${startDate} to ${endDate})`,
                      line: { color: trendlineColor, width: 2 },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:.1f}%</b><extra></extra>'
                    },
                    ...(compTrendDisplay ? [{
                      x: compTrendDisplay.dates,
                      y: compTrendDisplay.step1,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Comparison (${compStartDate} to ${compEndDate})`,
                      line: { color: '#3b82f6', width: 2, dash: 'dot' },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:.1f}%</b><extra></extra>'
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 45, r: 20, t: 20, b: 40 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    xaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' } },
                    yaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' }, ticksuffix: '%', tickformat: '.1f' },
                    showlegend: isCompActive,
                    legend: { orientation: 'h', y: 1.15, font: { size: 10 } }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>

            {/* Chart 8: Step 2: Plan Selected -> Pay Initiated */}
            <div className="bg-warm-bg/40 dark:bg-zinc-900/40 p-4 rounded-xl border border-warm-border/60 dark:border-zinc-800">
              <div className="text-xs font-bold mb-2 text-warm-text dark:text-dark-text flex items-center justify-between">
                <span>Plan Selected &rarr; Pay Initiated %</span>
                <span className="text-[11px] font-extrabold text-amber-accent">Step 2</span>
              </div>
              <div className="w-full h-[200px]">
                <Plot
                  data={[
                    {
                      x: primaryTrendDisplay.dates,
                      y: primaryTrendDisplay.step2,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Primary (${startDate} to ${endDate})`,
                      line: { color: trendlineColor, width: 2 },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:.1f}%</b><extra></extra>'
                    },
                    ...(compTrendDisplay ? [{
                      x: compTrendDisplay.dates,
                      y: compTrendDisplay.step2,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Comparison (${compStartDate} to ${compEndDate})`,
                      line: { color: '#3b82f6', width: 2, dash: 'dot' },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:.1f}%</b><extra></extra>'
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 45, r: 20, t: 20, b: 40 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    xaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' } },
                    yaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' }, ticksuffix: '%', tickformat: '.1f' },
                    showlegend: isCompActive,
                    legend: { orientation: 'h', y: 1.15, font: { size: 10 } }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>

            {/* Chart 9: Step 3: Pay Initiated -> Purchased */}
            <div className="bg-warm-bg/40 dark:bg-zinc-900/40 p-4 rounded-xl border border-warm-border/60 dark:border-zinc-800">
              <div className="text-xs font-bold mb-2 text-warm-text dark:text-dark-text flex items-center justify-between">
                <span>Pay Initiated &rarr; Purchased %</span>
                <span className="text-[11px] font-extrabold text-amber-accent">Step 3</span>
              </div>
              <div className="w-full h-[200px]">
                <Plot
                  data={[
                    {
                      x: primaryTrendDisplay.dates,
                      y: primaryTrendDisplay.step3,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Primary (${startDate} to ${endDate})`,
                      line: { color: trendlineColor, width: 2 },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:.1f}%</b><extra></extra>'
                    },
                    ...(compTrendDisplay ? [{
                      x: compTrendDisplay.dates,
                      y: compTrendDisplay.step3,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: `Comparison (${compStartDate} to ${compEndDate})`,
                      line: { color: '#3b82f6', width: 2, dash: 'dot' },
                      marker: { size: 4 },
                      hovertemplate: '%{x}<br><b>%{y:.1f}%</b><extra></extra>'
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 45, r: 20, t: 20, b: 40 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    xaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' } },
                    yaxis: { tickfont: { size: 10, color: isDark ? '#94a3b8' : '#64748b' }, ticksuffix: '%', tickformat: '.1f' },
                    showlegend: isCompActive,
                    legend: { orientation: 'h', y: 1.15, font: { size: 10 } }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Platform Breakdown Table Section with COLUMN comparison & FIXED STICKY HEADERS */}
      <section className="mt-8">
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

        {/* Mobile Touch Swipe Indicator */}
        <div className="block sm:hidden text-center text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 py-1 px-3 rounded-full mb-2">
          ← Swipe table left / right to view all stages →
        </div>

        <div className="overflow-x-auto border border-warm-border dark:border-dark-border rounded-xl bg-white dark:bg-dark-card custom-scrollbar relative">
          <table className="ledger-table text-sm text-left w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-30">
              {isCompActive ? (
                <>
                  {/* Level 1 Group Header Row */}
                  <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-extrabold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th rowSpan={2} className="p-3 whitespace-nowrap bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-900 dark:text-amber-200 border-r border-amber-500/30 align-middle sticky left-0 top-0 z-50">
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
                  <tr className="relative z-20 text-warm-muted dark:text-dark-muted uppercase font-bold text-[11px] tracking-wider border-b border-warm-border dark:border-dark-border">
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
                <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                  <th className="p-3 whitespace-nowrap bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text sticky left-0 top-0 z-50 border-r border-warm-border dark:border-dark-border">Platform</th>
                  {FUNNEL_STAGES.map(stage => (
                    <th key={stage.key} className="p-3 whitespace-nowrap text-right bg-white dark:bg-[#1E293B]">{stage.label}</th>
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
                      <td className="p-3 whitespace-nowrap font-bold border-r border-warm-border/30 dark:border-zinc-800 sticky left-0 z-20 bg-white dark:bg-[#0F172A]">
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
                        return renderStageCell(val, prevVal, null, true, idx === 0);
                      })}

                      {/* Comparison Period Stage Columns */}
                      {isCompActive && compDataObj && FUNNEL_STAGES.map((stage, idx) => {
                        const compVal = compDataObj[stage.key] || 0;
                        const compPrevVal = idx > 0 ? (compDataObj[FUNNEL_STAGES[idx-1].key] || 0) : compVal;
                        const primaryVal = primaryDataObj[stage.key] || 0;
                        
                        return renderStageCell(compVal, compPrevVal, primaryVal, true, idx === 0);
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
                          <td className="p-2.5 pl-7 whitespace-nowrap font-bold text-warm-muted dark:text-dark-muted border-r border-warm-border/30 dark:border-zinc-800 sticky left-0 z-20 bg-white dark:bg-[#0F172A]">
                            <div>{dateStr}</div>
                            {isCompActive && compDateStr && (
                              <div className="text-[10px] text-blue-500 font-semibold mt-0.5">vs {compDateStr}</div>
                            )}
                          </td>

                          {/* Primary Day Values */}
                          {FUNNEL_STAGES.map((stage, idx) => {
                            const val = pDay[stage.key] || 0;
                            const prevVal = idx > 0 ? (pDay[FUNNEL_STAGES[idx-1].key] || 0) : val;
                            return renderStageCell(val, prevVal, null, false, idx === 0);
                          })}

                          {/* Comparison Day Values (Looked up using corresponding comparison date index) */}
                          {isCompActive && FUNNEL_STAGES.map((stage, idx) => {
                            const compVal = cDay ? (cDay[stage.key] || 0) : 0;
                            const compPrevVal = idx > 0 && cDay ? (cDay[FUNNEL_STAGES[idx-1].key] || 0) : compVal;
                            const primaryVal = pDay[stage.key] || 0;

                            return renderStageCell(compVal, compPrevVal, primaryVal, false, idx === 0);
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

      {/* Marketing Team-wise Funnel Breakdown Table Section */}
      <section className="mt-8 pb-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 px-1 gap-2">
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text">Marketing Team-wise Funnel Breakdown</h3>
            <p className="text-xs text-warm-muted dark:text-dark-muted font-medium">Daily average metrics per marketing team (click row chevron to reveal day-level data)</p>
          </div>
        </div>

        {/* Mobile Touch Swipe Indicator */}
        <div className="block sm:hidden text-center text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 py-1 px-3 rounded-full mb-2">
          ← Swipe table left / right to view all stages →
        </div>

        <div className="overflow-x-auto border border-warm-border dark:border-dark-border rounded-xl bg-white dark:bg-dark-card max-h-[500px]">
          <table className="w-full text-xs text-left border-separate border-spacing-0">
            <thead className="sticky top-0 z-30">
              {isCompActive ? (
                <>
                  <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-bold text-[11px] tracking-wider border-b border-warm-border dark:border-dark-border">
                    <th rowSpan={2} className="p-3 whitespace-nowrap bg-amber-100/90 dark:bg-[#1E293B] text-amber-900 dark:text-amber-200 sticky left-0 top-0 z-50 border-r border-warm-border dark:border-dark-border align-middle">Marketing Team</th>
                    <th colSpan={FUNNEL_STAGES.length} className="p-2 text-center bg-amber-100/60 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-extrabold border-r border-warm-border dark:border-dark-border">
                      Primary ({startDate} to {endDate})
                    </th>
                    <th colSpan={FUNNEL_STAGES.length} className="p-2 text-center bg-[#DBEAFE] dark:bg-[#1E293B] text-blue-700 dark:text-blue-300 font-extrabold">
                      Comparison ({compStartDate} to {compEndDate})
                    </th>
                  </tr>
                  <tr className="relative z-20 text-warm-muted dark:text-dark-muted uppercase font-bold text-[10px] tracking-wider border-b border-warm-border dark:border-dark-border">
                    {FUNNEL_STAGES.map(stage => (
                      <th key={`mkt-prim-${stage.key}`} className="p-2.5 whitespace-nowrap text-right bg-warm-tableBg dark:bg-[#1E293B]">{stage.label}</th>
                    ))}
                    {FUNNEL_STAGES.map((stage, idx) => (
                      <th key={`mkt-comp-${stage.key}`} className={`p-2.5 whitespace-nowrap text-right bg-[#DBEAFE] dark:bg-[#1E293B] text-blue-700 dark:text-blue-300 font-extrabold ${idx === 0 ? 'border-l border-warm-border dark:border-dark-border' : ''}`}>
                        {stage.label}
                      </th>
                    ))}
                  </tr>
                </>
              ) : (
                <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-bold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                  <th className="p-3 whitespace-nowrap bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text sticky left-0 top-0 z-40 border-r border-warm-border dark:border-dark-border">Marketing Team</th>
                  {FUNNEL_STAGES.map(stage => (
                    <th key={stage.key} className="p-3 whitespace-nowrap text-right bg-white dark:bg-[#1E293B]">{stage.label}</th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {[ 'overall', ...Object.keys(primaryFunnel.marketingTeamAvg || {}).sort() ].map(rowKey => {
                const title = rowKey === 'overall' ? 'Overall (All Teams)' : rowKey;
                const mktRowKey = `mkt-${rowKey}`;
                const isExpanded = expandedRows[mktRowKey];
                
                const primaryDataObj = rowKey === 'overall' ? primaryFunnel.overallAvg : (primaryFunnel.marketingTeamAvg[rowKey] || {});
                const compDataObj = compFunnel ? (rowKey === 'overall' ? compFunnel.overallAvg : (compFunnel.marketingTeamAvg[rowKey] || {})) : null;

                const primaryDaily = primaryDataObj.daily || {};
                const compDaily = compDataObj ? (compDataObj.daily || {}) : {};

                const sortedPrimaryDates = Object.keys(primaryDaily).sort((a,b) => b.localeCompare(a));
                const sortedCompDates = Object.keys(compDaily).sort((a,b) => b.localeCompare(a));

                return (
                  <React.Fragment key={mktRowKey}>
                    <tr className="border-b border-warm-border/50 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5 transition-colors font-semibold text-warm-text dark:text-dark-text">
                      <td className="p-3 whitespace-nowrap font-bold border-r border-warm-border/30 dark:border-zinc-800 sticky left-0 z-20 bg-white dark:bg-[#0F172A]">
                        <div 
                          onClick={() => toggleRow(mktRowKey)}
                          className="flex items-center gap-2 cursor-pointer select-none text-amber-accent dark:text-amber-400 hover:opacity-80"
                        >
                          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                          <span className="text-warm-text dark:text-dark-text">{title}</span>
                        </div>
                      </td>

                      {FUNNEL_STAGES.map((stage, idx) => {
                        const val = primaryDataObj[stage.key] || 0;
                        const prevVal = idx > 0 ? (primaryDataObj[FUNNEL_STAGES[idx-1].key] || 0) : val;
                        return renderStageCell(val, prevVal, null, true, idx === 0);
                      })}

                      {isCompActive && compDataObj && FUNNEL_STAGES.map((stage, idx) => {
                        const compVal = compDataObj[stage.key] || 0;
                        const compPrevVal = idx > 0 ? (compDataObj[FUNNEL_STAGES[idx-1].key] || 0) : compVal;
                        const primaryVal = primaryDataObj[stage.key] || 0;
                        
                        return renderStageCell(compVal, compPrevVal, primaryVal, true, idx === 0);
                      })}
                    </tr>

                    {isExpanded && sortedPrimaryDates.map((dateStr, pIdx) => {
                      const pDay = primaryDaily[dateStr] || {};
                      const compDateStr = sortedCompDates[pIdx];
                      const cDay = compDateStr ? (compDaily[compDateStr] || {}) : null;

                      return (
                        <tr key={`${mktRowKey}-${dateStr}`} className="border-b border-warm-border/30 dark:border-zinc-800/60 bg-black/5 dark:bg-white/5 font-medium text-warm-text dark:text-dark-text text-xs">
                          <td className="p-2.5 pl-7 whitespace-nowrap font-bold text-warm-muted dark:text-dark-muted border-r border-warm-border/30 dark:border-zinc-800 sticky left-0 z-20 bg-white dark:bg-[#0F172A]">
                            <div>{dateStr}</div>
                            {isCompActive && compDateStr && (
                              <div className="text-[10px] text-blue-500 font-semibold mt-0.5">vs {compDateStr}</div>
                            )}
                          </td>

                          {FUNNEL_STAGES.map((stage, idx) => {
                            const val = pDay[stage.key] || 0;
                            const prevVal = idx > 0 ? (pDay[FUNNEL_STAGES[idx-1].key] || 0) : val;
                            return renderStageCell(val, prevVal, null, false, idx === 0);
                          })}

                          {isCompActive && FUNNEL_STAGES.map((stage, idx) => {
                            const compVal = cDay ? (cDay[stage.key] || 0) : 0;
                            const compPrevVal = idx > 0 && cDay ? (cDay[FUNNEL_STAGES[idx-1].key] || 0) : compVal;
                            const primaryVal = pDay[stage.key] || 0;

                            return renderStageCell(compVal, compPrevVal, primaryVal, false, idx === 0);
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [realtimeCompMode, setRealtimeCompMode] = useState("4-Week"); // "4-Week" | "7-Day"

  const parseRealtimeRows = (rows) => {
    if (!rows || !Array.isArray(rows)) return [];
    return rows.map(r => {
      const rawDate = r.event_date || r.EVENT_DATE || '';
      const rawHour = r.event_hour ?? r.EVENT_HOUR ?? '';
      const rawPlatform = r.ET_Platform || r.et_platform || r.platform || '';
      const rawEvent = r.event_name || r.EVENT_NAME || r.event || '';
      const rawCount = r.event_count ?? r.EVENT_COUNT ?? r.count ?? 0;

      const dateStr = String(rawDate).trim();
      const hour = typeof rawHour === 'number' || typeof rawHour === 'bigint' ? Number(rawHour) : parseInt(String(rawHour).trim(), 10);
      const platform = String(rawPlatform).trim();
      const event = String(rawEvent).trim();
      const count = typeof rawCount === 'number' || typeof rawCount === 'bigint' ? Number(rawCount) : (parseInt(String(rawCount).trim(), 10) || 0);

      return { dateStr, hour, platform, event, count };
    }).filter(r => r.dateStr && !isNaN(r.hour));
  };

  const loadRealtimeData = async () => {
    try {
      // 1. Instant Load from Turso DB / Cache (<50ms)
      const cachedOrTurso = await fetchDatasetCached('realtime', REALTIME_GSHEET_URL);
      if (cachedOrTurso && cachedOrTurso.data && cachedOrTurso.data.length > 0) {
        setRawData(parseRealtimeRows(cachedOrTurso.data));
      }
    } catch (err) {
      console.error("Realtime fetch error", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRealtimeData();

    // Listen for background live Google Sheet CSV update
    const handleDatasetUpdated = (e) => {
      if (e.detail && e.detail.key === 'realtime' && e.detail.data) {
        console.log("⚡ [Realtime UI] Background live Google Sheet update received!");
        setRawData(parseRealtimeRows(e.detail.data));
        setLoading(false);
      }
    };
    window.addEventListener('dataset-updated', handleDatasetUpdated);
    return () => window.removeEventListener('dataset-updated', handleDatasetUpdated);
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      // Trigger serverless sync on Vercel (/api/sync-turso) or Netlify (/.netlify/functions/sync-turso)
      await fetch('/api/sync-turso').catch(() => fetch('/.netlify/functions/sync-turso')).catch(() => {});
      await loadRealtimeData(true);
    } catch (e) {
      console.warn("Manual sync error", e);
    } finally {
      setIsSyncing(false);
    }
  };

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
      }

      // Funnel counts (for all platforms, including 'Combined')
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

  if (loading && (!rawData || rawData.length === 0)) {
    return (
      <div className="animate-in fade-in duration-300 pb-12">
        {/* Realtime Header Skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="h-8 w-64 bg-warm-border/40 dark:bg-zinc-800 rounded-lg animate-pulse mb-2" />
            <div className="h-4 w-80 bg-warm-border/30 dark:bg-zinc-800/60 rounded-md animate-pulse" />
          </div>
          <div className="h-9 w-48 bg-warm-border/30 dark:bg-zinc-800/60 rounded-full animate-pulse self-start sm:self-auto" />
        </div>

        {/* KPI Cards Skeleton Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white dark:bg-dark-card border border-warm-border/80 dark:border-dark-border rounded-xl p-5 shadow-sm animate-pulse">
              <div className="h-3 w-28 bg-warm-border/40 dark:bg-zinc-800 rounded mb-3" />
              <div className="h-8 w-20 bg-warm-border/60 dark:bg-zinc-700 rounded mb-2" />
              <div className="h-3 w-36 bg-warm-border/30 dark:bg-zinc-800/60 rounded" />
            </div>
          ))}
        </div>

        {/* Main Container Loader with GPU-Accelerated Hardware Spinner */}
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl p-6 shadow-sm min-h-[380px] flex items-center justify-center">
          <CleanDashboardLoader 
            title="Fetching realtime data..." 
            subtitle="Loading latest platform telemetry & 4-week benchmark data" 
          />
        </div>
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
  const otherPlatforms = [...new Set([...Object.keys(platformToday), ...Object.keys(platformBenchmark)])]
    .filter(p => p !== 'Combined')
    .sort();
  const hasCombined = platformToday['Combined'] || platformBenchmark['Combined'];
  const activePlatforms = hasCombined ? ['Combined', ...otherPlatforms] : otherPlatforms;

  return (
    <div className="animate-in fade-in duration-300 pb-12">
      {/* Realtime Header + Top Right Comparison Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-black text-warm-text dark:text-dark-text tracking-tight flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
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

      {/* KPI Cards (2-Column Grid on Mobile) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-4 md:p-5">
          <h3 className="text-[10px] md:text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Purchases Today</h3>
          <span className="text-2xl md:text-4xl font-black text-warm-text dark:text-dark-text tracking-tight">{Math.round(todayPurchases).toLocaleString()}</span>
        </div>
        
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-4 md:p-5 ring-1 ring-amber-500/30 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 opacity-10 hidden sm:block">
            <Sun size={48} />
          </div>
          <h3 className="text-[10px] md:text-[11px] font-bold text-amber-accent dark:text-amber-500 tracking-wider uppercase mb-1">Estimated Today (EOD)</h3>
          <span className="text-2xl md:text-4xl font-black text-amber-accent dark:text-amber-400 tracking-tight">{Math.round(projectedTotal).toLocaleString()}</span>
        </div>

        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-4 md:p-5">
          <h3 className="text-[10px] md:text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">{benchmarkTitle}</h3>
          <div className="flex items-end gap-1.5 md:gap-2">
            <span className="text-2xl md:text-3xl font-black text-warm-text dark:text-dark-text tracking-tight">{Math.round(benchmarkTotal).toLocaleString()}</span>
            <span className="text-[10px] md:text-xs text-warm-muted dark:text-dark-muted pb-1 font-bold">Total EOD</span>
          </div>
        </div>

        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-4 md:p-5">
           <h3 className="text-[10px] md:text-xs font-medium text-warm-muted dark:text-dark-muted tracking-wider uppercase mb-1">Pacing vs History</h3>
           <div className="flex items-end gap-2">
              <span className={`text-2xl md:text-3xl font-black tracking-tight ${todayPurchases >= benchmarkCurrentHour ? 'text-emerald-500' : 'text-red-500'}`}>
                {benchmarkCurrentHour > 0 ? ((todayPurchases / benchmarkCurrentHour - 1) * 100).toFixed(1) : 0}%
              </span>
           </div>
           <p className="text-[10px] font-bold text-warm-muted dark:text-dark-muted mt-1">vs {benchmarkShort}</p>
        </div>
      </section>

      {/* Hourly Trend Chart & Today vs History sharing real estate */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-8">
        {/* Left: Hourly Purchase Velocity Chart */}
        <div className="lg:col-span-8 xl:col-span-9 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-4 md:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text">
              Hourly Purchase Velocity (Today vs {benchmarkShort})
            </h3>
          </div>
          <div className="w-full h-[320px]">
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
                legend: { orientation: 'h', y: 1.18, x: 0, font: { color: isDark ? '#94A3B8' : '#64748B', family: 'inherit', size: 10 } },
                hovermode: 'x unified'
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>

        {/* Right: TODAY VS HISTORY */}
        <div className="lg:col-span-4 xl:col-span-3 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-4 md:p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-warm-text dark:text-dark-text">
                TODAY VS HISTORY
              </h3>
            </div>

            {/* Quick Benchmark Comparison Toggle */}
            <div className="flex items-center bg-warm-tableBg dark:bg-zinc-800 p-0.5 rounded-full border border-warm-border/60 dark:border-zinc-700 mb-4">
              <button
                onClick={() => setRealtimeCompMode("4-Week")}
                className={`flex-1 py-1 text-[10px] font-extrabold rounded-full transition-all cursor-pointer ${
                  realtimeCompMode === "4-Week"
                    ? "bg-white dark:bg-slate-700 text-amber-accent shadow-xs"
                    : "text-warm-muted dark:text-dark-muted hover:text-warm-text"
                }`}
              >
                Past 4-Week Avg
              </button>
              <button
                onClick={() => setRealtimeCompMode("7-Day")}
                className={`flex-1 py-1 text-[10px] font-extrabold rounded-full transition-all cursor-pointer ${
                  realtimeCompMode === "7-Day"
                    ? "bg-white dark:bg-slate-700 text-amber-accent shadow-xs"
                    : "text-warm-muted dark:text-dark-muted hover:text-warm-text"
                }`}
              >
                Last 7-Days
              </button>
            </div>
          </div>

          {/* Dual Bar Graphic */}
          <div className="flex flex-col items-center my-auto">
            {(() => {
              const maxBarVal = Math.max(projectedTotal, benchmarkTotal, 1);
              const maxH = 130;
              const minH = 28;
              const todayH = Math.max(minH, Math.round((projectedTotal / maxBarVal) * maxH));
              const benchH = Math.max(minH, Math.round((benchmarkTotal / maxBarVal) * maxH));
              const diffPctVal = benchmarkTotal > 0 ? ((projectedTotal - benchmarkTotal) / benchmarkTotal) * 100 : 0;
              const isShortfall = diffPctVal < 0;

              return (
                <div className="w-full max-w-[200px] flex flex-col items-center">
                  {/* Bars Container */}
                  <div className="w-full h-44 flex items-end justify-center gap-3 relative pb-0.5">
                    {/* Central Vertical Guide Line */}
                    <div className="absolute top-1 bottom-0 left-1/2 -translate-x-1/2 w-px bg-slate-300 dark:bg-zinc-700 border-l border-dashed border-slate-400 dark:border-zinc-600 z-0" />

                    {/* Bar 1: Estimated Today */}
                    <div className="flex flex-col items-center z-10 w-14">
                      <span className="text-[10px] font-extrabold text-warm-muted dark:text-dark-muted text-center leading-tight mb-1">
                        Estimated Today<br/>
                        <span className="text-xs font-black text-warm-text dark:text-dark-text">({Math.round(projectedTotal)})</span>
                      </span>
                      <div
                        style={{ height: `${todayH}px` }}
                        className="w-12 bg-slate-700 dark:bg-slate-500 rounded-t-xs shadow-xs transition-all duration-300"
                      />
                    </div>

                    {/* Bar 2: Benchmark (Past 4-Week or Last 7-Days) */}
                    <div className="flex flex-col items-center z-10 w-14">
                      <span className="text-[10px] font-extrabold text-warm-muted dark:text-dark-muted text-center leading-tight mb-1">
                        {realtimeCompMode === "4-Week" ? "Past 4-Week" : "Last 7-Days"}<br/>
                        <span className="text-xs font-black text-warm-text dark:text-dark-text">({Math.round(benchmarkTotal)})</span>
                      </span>
                      <div
                        style={{ height: `${benchH}px` }}
                        className="w-12 bg-slate-300 dark:bg-zinc-600 rounded-t-xs shadow-xs transition-all duration-300"
                      />
                    </div>
                  </div>

                  {/* Horizontal Base Plinth in Terracotta/Amber */}
                  <div className="w-full h-3.5 bg-[#C25E1A] dark:bg-amber-600 rounded-xs shadow-xs" />

                  {/* Variance Metric & Details */}
                  <div className="text-center mt-3">
                    <span className="text-[11px] font-black uppercase tracking-wider text-warm-muted dark:text-dark-muted block">
                      {isShortfall ? "Shortfall" : "Surplus"}
                    </span>
                    <span className={`text-3xl sm:text-4xl font-black tracking-tight ${isShortfall ? 'text-[#C25E1A] dark:text-rose-400' : 'text-emerald-500'}`}>
                      {diffPctVal >= 0 ? "+" : ""}{diffPctVal.toFixed(1)}%
                    </span>
                    <span className="text-[10px] font-bold text-warm-muted dark:text-dark-muted block mt-0.5">
                      Original metric vs {benchmarkShort}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </section>

      {/* Visuals: Multi-Platform Funnel Charts (Full Width for 1 Overall + 6 Platforms = 7 Funnels) */}
      <section className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-4 md:p-6 mb-8 overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-black text-warm-text dark:text-dark-text tracking-tight">Multi-Platform Funnel Charts</h3>
            <p className="text-[11px] font-semibold text-warm-muted dark:text-dark-muted">Today's live conversion progression by platform (Overall + 6 Platforms)</p>
          </div>
        </div>

        {/* SVG Multi-Platform Funnel Canvas */}
        <div className="overflow-x-auto custom-scrollbar w-full py-2">
          {(() => {
            const combinedPlat = activePlatforms.filter(p => p.toLowerCase() === 'combined');
            const otherPlats = activePlatforms.filter(p => p.toLowerCase() !== 'combined');
            const displayPlatforms = [...(combinedPlat.length ? combinedPlat : ['Combined']), ...otherPlats];
            const numCols = displayPlatforms.length;
            const labelColW = 120;
            const colW = 142;
            const totalSvgW = labelColW + numCols * colW;

            const getBottomColor = (p) => {
              const s = p.toLowerCase();
              if (s.includes('combined')) return '#EA580C';
              if (s.includes('mkt_android')) return '#EA580C';
              if (s.includes('mkt_ios')) return '#F97316';
              if (s.includes('mweb')) return '#DC2626';
              if (s.includes('main android') || s.includes('main_android')) return '#D97706';
              if (s.includes('main ios') || s.includes('main_ios')) return '#2563EB';
              if (s.includes('web')) return '#059669';
              return '#475569';
            };

            return (
              <svg viewBox={`0 0 ${totalSvgW} 330`} className="w-full h-auto min-w-[960px] select-none">
                {/* Left Stage Labels & Horizontal Ticks */}
                <g className="font-bold text-[11px]">
                  <text x="100" y="70" textAnchor="end" className="fill-slate-700 dark:fill-slate-200" fontSize="11" fontWeight="700">Plan Page Load</text>
                  <line x1="104" y1="67" x2="116" y2="67" stroke="#94A3B8" strokeWidth="1.5" />

                  <text x="100" y="146" textAnchor="end" className="fill-slate-700 dark:fill-slate-200" fontSize="11" fontWeight="700">Plan Selected</text>
                  <line x1="104" y1="143" x2="116" y2="143" stroke="#94A3B8" strokeWidth="1.5" />

                  <text x="100" y="214" textAnchor="end" className="fill-slate-700 dark:fill-slate-200" fontSize="11" fontWeight="700">Pay Initiated</text>
                  <line x1="104" y1="211" x2="116" y2="211" stroke="#94A3B8" strokeWidth="1.5" />

                  <text x="100" y="276" textAnchor="end" className="fill-slate-700 dark:fill-slate-200" fontSize="11" fontWeight="700">Purchase</text>
                  <line x1="104" y1="273" x2="116" y2="273" stroke="#94A3B8" strokeWidth="1.5" />
                </g>

                {/* Flow Curves between adjacent columns */}
                {displayPlatforms.map((_, cIdx) => {
                  if (cIdx >= numCols - 1) return null;
                  const c1 = labelColW + cIdx * colW + colW / 2;
                  const c2 = labelColW + (cIdx + 1) * colW + colW / 2;
                  return (
                    <g key={`flow-${cIdx}`}>
                      {/* Curve Stage 2 -> Stage 3 */}
                      <path
                        d={`M ${c1 + 44} 143 C ${c1 + 78} 150, ${c2 - 62} 170, ${c2 - 31} 178`}
                        fill="none"
                        stroke="#94A3B8"
                        strokeWidth="1.2"
                        strokeDasharray="2,2"
                        opacity="0.55"
                      />
                      {/* Curve Stage 3 -> Stage 4 */}
                      <path
                        d={`M ${c1 + 21} 211 C ${c1 + 52} 220, ${c2 - 48} 235, ${c2 - 20} 243`}
                        fill="none"
                        stroke="#94A3B8"
                        strokeWidth="1.2"
                        strokeDasharray="2,2"
                        opacity="0.55"
                      />
                    </g>
                  );
                })}

                {/* Platform Columns */}
                {displayPlatforms.map((plat, cIdx) => {
                  const cCenter = labelColW + cIdx * colW + colW / 2;
                  const tData = platformToday[plat] || { PlanPageLoaded: 0, PlanSelected: 0, PayInitiated: 0, Purchase: 0 };
                  const loads = tData.PlanPageLoaded || 0;
                  const selected = tData.PlanSelected || 0;
                  const initiated = tData.PayInitiated || 0;
                  const purchased = tData.Purchase || 0;

                  const drop1 = loads > 0 ? Math.max(0, Math.round((1 - selected / loads) * 100)) : 0;
                  const drop2 = selected > 0 ? Math.max(0, Math.round((1 - initiated / selected) * 100)) : 0;
                  const platDisplay = plat === 'Combined' ? 'Overall (Combined)' : plat;
                  const bottomColor = getBottomColor(plat);

                  return (
                    <g key={plat}>
                      {/* Platform Header */}
                      <text
                        x={cCenter}
                        y="20"
                        textAnchor="middle"
                        fontSize="11.5"
                        fontWeight="800"
                        className="fill-slate-800 dark:fill-slate-100 uppercase tracking-tight"
                      >
                        {platDisplay}
                      </text>

                      {/* Level 1: Plan Page Load (Trap 1) */}
                      <polygon
                        points={`${cCenter - 58},35 ${cCenter + 58},35 ${cCenter + 44},106 ${cCenter - 44},106`}
                        fill="#1E293B"
                      />
                      <text x={cCenter} y="58" textAnchor="middle" fill="#FFFFFF" fontSize="13" fontWeight="900">
                        {loads.toLocaleString()}
                      </text>
                      <text x={cCenter} y="71" textAnchor="middle" fill="#94A3B8" fontSize="8.5" fontWeight="600">
                        tot Volume
                      </text>
                      <text x={cCenter} y="84" textAnchor="middle" fill="#CBD5E1" fontSize="8" fontWeight="500">
                        Plan Page Load to
                      </text>
                      <text x={cCenter} y="95" textAnchor="middle" fill="#CBD5E1" fontSize="8" fontWeight="500">
                        Plan Selected: {drop1}% drop-off
                      </text>

                      {/* Level 2: Plan Selected (Trap 2) */}
                      <polygon
                        points={`${cCenter - 44},109 ${cCenter + 44},109 ${cCenter + 31},175 ${cCenter - 31},175`}
                        fill="#334155"
                      />
                      <text x={cCenter} y="132" textAnchor="middle" fill="#FFFFFF" fontSize="12.5" fontWeight="900">
                        {selected.toLocaleString()}
                      </text>
                      <text x={cCenter} y="146" textAnchor="middle" fill="#94A3B8" fontSize="8.5" fontWeight="600">
                        Plan Selected
                      </text>
                      <text x={cCenter} y="160" textAnchor="middle" fill="#CBD5E1" fontSize="8" fontWeight="500">
                        Drop-off: {drop2}% drop-off
                      </text>

                      {/* Level 3: Pay Initiated (Trap 3) */}
                      <polygon
                        points={`${cCenter - 31},178 ${cCenter + 31},178 ${cCenter + 21},240 ${cCenter - 21},240`}
                        fill="#475569"
                      />
                      <text x={cCenter} y="206" textAnchor="middle" fill="#FFFFFF" fontSize="12.5" fontWeight="900">
                        {initiated.toLocaleString()}
                      </text>
                      <text x={cCenter} y="222" textAnchor="middle" fill="#CBD5E1" fontSize="8.5" fontWeight="600">
                        Pay Initiated
                      </text>

                      {/* Level 4: Purchase (Block) */}
                      <rect
                        x={cCenter - 20}
                        y="243"
                        width="40"
                        height="58"
                        rx="3"
                        fill={bottomColor}
                      />
                      <text x={cCenter} y="271" textAnchor="middle" fill="#FFFFFF" fontSize="13.5" fontWeight="900">
                        {purchased.toLocaleString()}
                      </text>
                      <text x={cCenter} y="286" textAnchor="middle" fill="#FFFFFF" fontSize="8.5" fontWeight="700">
                        Purchase
                      </text>
                    </g>
                  );
                })}

                {/* Centered Platform Label */}
                <text
                  x={labelColW + (numCols * colW) / 2}
                  y="320"
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  className="fill-slate-500 dark:fill-slate-400 tracking-wider"
                >
                  Platform
                </text>
              </svg>
            );
          })()}
        </div>
      </section>

      {/* Realtime Platform Funnel Table with Multi-level Headers */}
      <section className="mt-8">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text mb-2 px-1">Today's Live Platform Breakdown</h3>
        
        {/* Mobile Touch Swipe Indicator */}
        <div className="block sm:hidden text-center text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 py-1 px-3 rounded-full mb-2">
          ← Swipe table left / right to view all stages →
        </div>

        <div className="overflow-x-auto border border-warm-border dark:border-dark-border rounded-xl bg-white dark:bg-dark-card custom-scrollbar relative">
          <table className="w-full text-sm text-left border-separate border-spacing-0">
            <thead className="sticky top-0 z-30">
              {/* Level 1 Group Header Row */}
              <tr className="relative z-30 text-warm-muted dark:text-dark-muted uppercase font-extrabold text-xs tracking-wider border-b border-warm-border dark:border-dark-border">
                <th rowSpan={2} className="p-3 whitespace-nowrap bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-900 dark:text-amber-200 border-r border-amber-500/30 align-middle sticky left-0 top-0 z-50">
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
              <tr className="relative z-20 text-warm-muted dark:text-dark-muted uppercase font-bold text-[11px] tracking-wider border-b border-warm-border dark:border-dark-border">
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
                const isCombined = plat === 'Combined';

                return (
                  <tr 
                    key={plat} 
                    className={`border-b transition-colors ${
                      isCombined 
                        ? 'bg-amber-500/10 dark:bg-amber-500/15 font-black border-amber-500/30 border-b-2' 
                        : 'border-warm-border/50 dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5 font-semibold text-warm-text dark:text-dark-text'
                    }`}
                  >
                    <td className={`p-3 whitespace-nowrap border-r border-warm-border/30 dark:border-zinc-800 sticky left-0 z-20 ${
                      isCombined 
                        ? 'bg-[#FEF3C7] dark:bg-[#1E293B] font-black text-amber-700 dark:text-amber-300' 
                        : 'bg-white dark:bg-[#0F172A] font-bold text-amber-accent dark:text-amber-400'
                    }`}>
                      {isCombined ? 'Overall (Combined)' : plat}
                    </td>
                    
                    {/* Today's Data with % comparison badge & previous step conversion % */}
                    {['PlanPageLoaded', 'PlanSelected', 'PayInitiated', 'Purchase'].map((key, idx) => {
                      const stageKeys = ['PlanPageLoaded', 'PlanSelected', 'PayInitiated', 'Purchase'];
                      const tVal = tData[key] || 0;
                      const bVal = bData[key] || 0;

                      // Step conversion % (of previous step)
                      const prevTVal = idx > 0 ? (tData[stageKeys[idx - 1]] || 0) : 0;
                      const tStepPct = idx > 0 && prevTVal > 0 ? ((tVal / prevTVal) * 100).toFixed(1) : null;

                      let diffPct = null;
                      if (bVal > 0) {
                        diffPct = (((tVal - bVal) / bVal) * 100).toFixed(1);
                      }
                      const isLast = idx === 3;

                      return (
                        <td key={key} className={`p-3 whitespace-nowrap text-right ${isLast ? 'border-r border-warm-border/30 dark:border-zinc-800' : ''}`}>
                          <div className={`font-extrabold ${isCombined ? 'text-base text-amber-800 dark:text-amber-200' : 'text-sm text-warm-text dark:text-dark-text'}`}>
                            {tVal.toLocaleString()}
                            {tStepPct !== null && (
                              <span className="ml-1 text-xs font-semibold text-warm-muted dark:text-dark-muted">
                                ({tStepPct}% of prev)
                              </span>
                            )}
                          </div>
                          {diffPct !== null ? (
                            <div className="flex items-center justify-end mt-0.5">
                              {parseFloat(diffPct) >= 0 ? (
                                <span className="text-xs font-semibold text-green-600 dark:text-green-400 inline-flex items-center gap-0.5">
                                  <span className="text-[9px]">▲</span> +{diffPct}%
                                </span>
                              ) : (
                                <span className="text-xs font-semibold text-red-600 dark:text-red-400 inline-flex items-center gap-0.5">
                                  <span className="text-[9px]">▼</span> {diffPct}%
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="text-[10px] text-warm-muted dark:text-dark-muted font-medium mt-0.5">-</div>
                          )}
                        </td>
                      );
                    })}

                    {/* Benchmark Data with previous step conversion % */}
                    {['PlanPageLoaded', 'PlanSelected', 'PayInitiated', 'Purchase'].map((key, idx) => {
                      const stageKeys = ['PlanPageLoaded', 'PlanSelected', 'PayInitiated', 'Purchase'];
                      const bVal = bData[key] || 0;

                      // Benchmark step conversion % (of previous step)
                      const prevBVal = idx > 0 ? (bData[stageKeys[idx - 1]] || 0) : 0;
                      const bStepPct = idx > 0 && prevBVal > 0 ? ((bVal / prevBVal) * 100).toFixed(1) : null;

                      return (
                        <td key={key} className={`p-3 whitespace-nowrap text-right ${isCombined ? 'font-bold text-warm-text dark:text-dark-text' : 'font-medium text-warm-muted dark:text-dark-muted'}`}>
                          <span>{bVal.toLocaleString()}</span>
                          {bStepPct !== null && (
                            <span className="ml-1 text-xs text-warm-muted/75 dark:text-dark-muted/75 font-semibold">
                              ({bStepPct}% of prev)
                            </span>
                          )}
                        </td>
                      );
                    })}
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

function MultiSelectDropdown({ label, options, selectedValues, onChange, isDark }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isAllSelected = selectedValues.length === 0 || selectedValues.length === options.length;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      onChange([]);
    } else {
      onChange([...options]);
    }
  };

  const toggleOption = (opt) => {
    if (selectedValues.includes(opt)) {
      const updated = selectedValues.filter(v => v !== opt);
      onChange(updated);
    } else {
      onChange([...selectedValues, opt]);
    }
  };

  let displayLabel = "All";
  if (selectedValues.length > 0 && selectedValues.length < options.length) {
    if (selectedValues.length <= 2) {
      displayLabel = selectedValues.join(', ');
    } else {
      displayLabel = `${selectedValues.length} Selected`;
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <label className="block text-[10px] font-bold text-warm-muted dark:text-dark-muted uppercase mb-1 truncate">{label}</label>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-xs font-bold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-xs cursor-pointer flex items-center justify-between gap-1 text-left"
      >
        <span className="truncate max-w-[110px]">{displayLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1 w-56 max-h-64 overflow-y-auto custom-scrollbar bg-white dark:bg-zinc-900 border border-warm-border dark:border-zinc-700 rounded-xl shadow-xl z-50 p-2 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-warm-border/60 dark:border-zinc-800 px-1">
            <label className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleSelectAll}
                className="rounded text-amber-500 focus:ring-amber-400 h-3.5 w-3.5 cursor-pointer"
              />
              <span>Select All</span>
            </label>
            <span className="text-[10px] text-warm-muted dark:text-dark-muted font-semibold">
              {selectedValues.length === 0 ? options.length : selectedValues.length} / {options.length}
            </span>
          </div>

          <div className="space-y-1">
            {options.map((opt) => {
              const isChecked = selectedValues.length === 0 || selectedValues.includes(opt);
              return (
                <label
                  key={opt}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-amber-500/10 dark:hover:bg-amber-500/20 text-xs font-medium text-warm-text dark:text-dark-text cursor-pointer transition-colors select-none"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleOption(opt)}
                    className="rounded text-amber-500 focus:ring-amber-400 h-3.5 w-3.5 cursor-pointer"
                  />
                  <span className="truncate">{opt}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ArpuReport({ isDark }) {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Multi-Select Filter States (Array of strings, empty array [] = All)
  const [datePreset, setDatePreset] = useState("Last 30 days");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [selectedPlanCategories, setSelectedPlanCategories] = useState([]);
  const [selectedUserTxnTypes, setSelectedUserTxnTypes] = useState([]);
  const [selectedMarketingTeams, setSelectedMarketingTeams] = useState([]);
  const [selectedOffers, setSelectedOffers] = useState([]);
  const [selectedThemes, setSelectedThemes] = useState([]);
  const [selectedSaleStatuses, setSelectedSaleStatuses] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;

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

  // Fetch ARPU Data
  useEffect(() => {
    function processArpuData(dataArray) {
      if (!dataArray || !Array.isArray(dataArray)) return;
      const processed = dataArray.map(row => {
        const rawDate = row.txn_date || row.Date || row.date;
        const dateStr = formatArpuDate(rawDate);
        if (!dateStr) return null;

        const platformCode = String(row.platform || '').trim();
        const platformDisplay = formatArpuPlatform(platformCode);
        const planCategory = String(row.plan_category || 'UNKNOWN').trim().toUpperCase();
        const userTxnType = String(row.user_txn_type || 'unknown').trim();
        const marketingTeam = String(row.marketing_team || 'Others').trim();
        const offer = String(row.Offer || row.offer || 'Standard').trim();
        const theme = String(row.Theme || row.theme || 'Regular').trim();
        const saleStatus = String(row['Sale status'] || row.sale_status || row.SaleStatus || 'Active').trim();
        const conversion = parseInt(row.conversion, 10) || 0;
        const revenue = parseFloat(row.revenue) || 0.0;

        return {
          dateStr,
          platform: platformDisplay,
          plan_category: planCategory,
          user_txn_type: userTxnType,
          marketing_team: marketingTeam,
          offer,
          theme,
          sale_status: saleStatus,
          conversion,
          revenue
        };
      }).filter(r => r && r.dateStr);

      setRawData(processed);
      setLoading(false);
    }

    async function fetchData() {
      if (!rawData || rawData.length === 0) setLoading(true);
      setError(null);
      try {
        const results = await fetchDatasetCached('arpu', ARPU_GSHEET_URL);
        if (results && results.data) processArpuData(results.data);
      } catch (err) {
        console.error("Failed to load ARPU data", err);
        setError("Failed to load ARPU data: " + (err.message || String(err)));
        setLoading(false);
      }
    }

    fetchData();

    const handleDatasetUpdated = (e) => {
      if (e.detail && e.detail.key === 'arpu' && e.detail.data) {
        console.log("⚡ [ARPU UI] Background live Google Sheet update received!");
        processArpuData(e.detail.data);
      }
    };
    window.addEventListener('dataset-updated', handleDatasetUpdated);
    return () => window.removeEventListener('dataset-updated', handleDatasetUpdated);
  }, []);

  // Unique Filter Options Extractor
  const platforms = useMemo(() => Array.from(new Set(rawData.map(r => r.platform))).sort(), [rawData]);
  const planCategories = useMemo(() => Array.from(new Set(rawData.map(r => r.plan_category))).sort(), [rawData]);
  const userTxnTypes = useMemo(() => Array.from(new Set(rawData.map(r => r.user_txn_type))).sort(), [rawData]);
  const marketingTeams = useMemo(() => Array.from(new Set(rawData.map(r => r.marketing_team))).sort(), [rawData]);
  const offers = useMemo(() => Array.from(new Set(rawData.map(r => r.offer))).sort(), [rawData]);
  const themes = useMemo(() => Array.from(new Set(rawData.map(r => r.theme))).sort(), [rawData]);
  const saleStatuses = useMemo(() => Array.from(new Set(rawData.map(r => r.sale_status))).sort(), [rawData]);

  // Filtered Rows Calculation with Multi-Select Support
  const filteredData = useMemo(() => {
    if (!rawData.length) return [];
    return rawData.filter(r => {
      if (startDate && r.dateStr < startDate) return false;
      if (endDate && r.dateStr > endDate) return false;

      if (selectedPlatforms.length > 0 && selectedPlatforms.length < platforms.length && !selectedPlatforms.includes(r.platform)) return false;
      if (selectedPlanCategories.length > 0 && selectedPlanCategories.length < planCategories.length && !selectedPlanCategories.includes(r.plan_category)) return false;
      if (selectedUserTxnTypes.length > 0 && selectedUserTxnTypes.length < userTxnTypes.length && !selectedUserTxnTypes.includes(r.user_txn_type)) return false;
      if (selectedMarketingTeams.length > 0 && selectedMarketingTeams.length < marketingTeams.length && !selectedMarketingTeams.includes(r.marketing_team)) return false;
      if (selectedOffers.length > 0 && selectedOffers.length < offers.length && !selectedOffers.includes(r.offer)) return false;
      if (selectedThemes.length > 0 && selectedThemes.length < themes.length && !selectedThemes.includes(r.theme)) return false;
      if (selectedSaleStatuses.length > 0 && selectedSaleStatuses.length < saleStatuses.length && !selectedSaleStatuses.includes(r.sale_status)) return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const textMatch = 
          r.platform.toLowerCase().includes(q) ||
          r.plan_category.toLowerCase().includes(q) ||
          r.theme.toLowerCase().includes(q) ||
          r.offer.toLowerCase().includes(q) ||
          r.user_txn_type.toLowerCase().includes(q);
        if (!textMatch) return false;
      }

      return true;
    });
  }, [rawData, startDate, endDate, selectedPlatforms, selectedPlanCategories, selectedUserTxnTypes, selectedMarketingTeams, selectedOffers, selectedThemes, selectedSaleStatuses, searchQuery, platforms, planCategories, userTxnTypes, marketingTeams, offers, themes, saleStatuses]);

  // Reset Filters
  const resetFilters = () => {
    setSelectedPlatforms([]);
    setSelectedPlanCategories([]);
    setSelectedUserTxnTypes([]);
    setSelectedMarketingTeams([]);
    setSelectedOffers([]);
    setSelectedThemes([]);
    setSelectedSaleStatuses([]);
    setDatePreset('Last 30 days');
    setSearchQuery('');
  };

  // Aggregate Metrics & Charts Data
  const metrics = useMemo(() => {
    let totalRevenue = 0;
    let totalConversions = 0;

    const themeAgg = {};
    const platformAgg = {};
    const dateAgg = {};

    filteredData.forEach(r => {
      totalRevenue += r.revenue;
      totalConversions += r.conversion;

      // Theme Aggregation
      if (!themeAgg[r.theme]) themeAgg[r.theme] = { revenue: 0, conversion: 0 };
      themeAgg[r.theme].revenue += r.revenue;
      themeAgg[r.theme].conversion += r.conversion;

      // Platform Aggregation
      if (!platformAgg[r.platform]) platformAgg[r.platform] = { revenue: 0, conversion: 0 };
      platformAgg[r.platform].revenue += r.revenue;
      platformAgg[r.platform].conversion += r.conversion;

      // Date Aggregation
      if (!dateAgg[r.dateStr]) dateAgg[r.dateStr] = { revenue: 0, conversion: 0 };
      dateAgg[r.dateStr].revenue += r.revenue;
      dateAgg[r.dateStr].conversion += r.conversion;
    });

    const overallArpu = totalConversions > 0 ? Math.round(totalRevenue / totalConversions) : 0;

    // Top Theme by ARPU
    let topTheme = 'N/A';
    let maxThemeArpu = 0;
    Object.keys(themeAgg).forEach(t => {
      const conv = themeAgg[t].conversion;
      const rev = themeAgg[t].revenue;
      if (conv > 0) {
        const arpu = rev / conv;
        if (arpu > maxThemeArpu) {
          maxThemeArpu = arpu;
          topTheme = t;
        }
      }
    });

    // Theme Chart Data
    const themeLabels = Object.keys(themeAgg).sort((a,b) => (themeAgg[b].revenue / (themeAgg[b].conversion||1)) - (themeAgg[a].revenue / (themeAgg[a].conversion||1)));
    const themeArpuValues = themeLabels.map(t => themeAgg[t].conversion > 0 ? Math.round(themeAgg[t].revenue / themeAgg[t].conversion) : 0);

    // Platform Chart Data
    const platformLabels = Object.keys(platformAgg).sort();
    const platformArpuValues = platformLabels.map(p => platformAgg[p].conversion > 0 ? Math.round(platformAgg[p].revenue / platformAgg[p].conversion) : 0);

    // Date Trend Chart Data
    const sortedDates = Object.keys(dateAgg).sort();
    const dateArpuValues = sortedDates.map(d => dateAgg[d].conversion > 0 ? Math.round(dateAgg[d].revenue / dateAgg[d].conversion) : 0);

    return {
      totalRevenue,
      totalConversions,
      overallArpu,
      topTheme,
      maxThemeArpu: Math.round(maxThemeArpu),
      themeChart: { labels: themeLabels, values: themeArpuValues },
      platformChart: { labels: platformLabels, values: platformArpuValues },
      dateTrendChart: { dates: sortedDates, values: dateArpuValues }
    };
  }, [filteredData]);

  // Table Pagination
  const totalPages = Math.ceil(filteredData.length / rowsPerPage) || 1;
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredData.slice(start, start + rowsPerPage);
  }, [filteredData, currentPage]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm my-6 p-4">
        <CleanDashboardLoader title="Loading ARPU Analytics Data..." subtitle="Calculating Average Revenue Per User across plans and platforms" />
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
    <div className="animate-in fade-in duration-300">
      
      {/* Header Info Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-warm-text dark:text-dark-text tracking-tight">ARPU Analytics & Campaign Performance</h2>
          <p className="text-xs text-warm-muted dark:text-dark-muted font-medium mt-0.5">
            Average Revenue Per User (Revenue / Conversions) across campaign themes, offers & user segments
          </p>
        </div>
        <button
          onClick={resetFilters}
          className="px-3.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 self-end md:self-auto"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Reset All Filters</span>
        </button>
      </div>

      {/* Multi-Select Dropdown Filters Toolbar */}
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-4 shadow-sm mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          
          {/* Timeframe */}
          <div>
            <label className="block text-[10px] font-bold text-warm-muted dark:text-dark-muted uppercase mb-1">Timeframe</label>
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
              className="w-full bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text text-xs font-bold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-accent shadow-xs cursor-pointer"
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

          <MultiSelectDropdown label="Platform" options={platforms} selectedValues={selectedPlatforms} onChange={setSelectedPlatforms} isDark={isDark} />
          <MultiSelectDropdown label="Plan Category" options={planCategories} selectedValues={selectedPlanCategories} onChange={setSelectedPlanCategories} isDark={isDark} />
          <MultiSelectDropdown label="User Txn Type" options={userTxnTypes} selectedValues={selectedUserTxnTypes} onChange={setSelectedUserTxnTypes} isDark={isDark} />
          <MultiSelectDropdown label="Marketing Team" options={marketingTeams} selectedValues={selectedMarketingTeams} onChange={setSelectedMarketingTeams} isDark={isDark} />
          <MultiSelectDropdown label="Offer" options={offers} selectedValues={selectedOffers} onChange={setSelectedOffers} isDark={isDark} />
          <MultiSelectDropdown label="Campaign Theme" options={themes} selectedValues={selectedThemes} onChange={setSelectedThemes} isDark={isDark} />
          <MultiSelectDropdown label="Sale Status" options={saleStatuses} selectedValues={selectedSaleStatuses} onChange={setSelectedSaleStatuses} isDark={isDark} />

        </div>

        {/* Custom Range Inputs if selected */}
        {datePreset === "Custom range" && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-warm-border/50 dark:border-zinc-800">
            <span className="text-xs font-bold text-warm-muted dark:text-dark-muted">Custom Date Range:</span>
            <input type="date" value={startDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setStartDate(e.target.value)} className="px-2.5 py-1 text-xs font-medium rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
            <span className="text-xs text-warm-muted dark:text-dark-muted">to</span>
            <input type="date" value={endDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setEndDate(e.target.value)} className="px-2.5 py-1 text-xs font-medium rounded-lg bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none" />
          </div>
        )}
      </div>

      {/* Executive KPI Cards */}
      <section className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        
        {/* Card 1: OVERALL ARPU */}
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-5 shadow-xs relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl pointer-events-none"></div>
          <span className="text-[10px] font-black uppercase tracking-wider text-amber-accent block mb-1">Overall ARPU</span>
          <div className="text-2xl font-black tracking-tight text-warm-text dark:text-dark-text mb-1">
            ₹{metrics.overallArpu.toLocaleString()}
          </div>
          <span className="text-[11px] font-medium text-warm-muted dark:text-dark-muted">
            Formula: Revenue / Conversion
          </span>
        </div>

        {/* Card 2: TOTAL REVENUE */}
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-5 shadow-xs relative overflow-hidden">
          <div className="text-[10px] font-black uppercase tracking-wider text-emerald-500 block mb-1">Total Revenue</div>
          <div className="text-2xl font-black tracking-tight text-warm-text dark:text-dark-text mb-1">
            {metrics.totalRevenue >= 10000000 
              ? `₹${(metrics.totalRevenue / 10000000).toFixed(2)} Cr` 
              : metrics.totalRevenue >= 100000 
                ? `₹${(metrics.totalRevenue / 100000).toFixed(2)} L`
                : `₹${Math.round(metrics.totalRevenue).toLocaleString()}`}
          </div>
          <span className="text-[11px] font-medium text-warm-muted dark:text-dark-muted">
            Filtered Segment Volume
          </span>
        </div>

        {/* Card 3: TOTAL CONVERSIONS */}
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-5 shadow-xs relative overflow-hidden">
          <div className="text-[10px] font-black uppercase tracking-wider text-blue-500 block mb-1">Total Conversions</div>
          <div className="text-2xl font-black tracking-tight text-warm-text dark:text-dark-text mb-1">
            {metrics.totalConversions.toLocaleString()}
          </div>
          <span className="text-[11px] font-medium text-warm-muted dark:text-dark-muted">
            Total Subscriptions Sold
          </span>
        </div>

        {/* Card 4: TOP PERFORMING THEME */}
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-5 shadow-xs relative overflow-hidden">
          <div className="text-[10px] font-black uppercase tracking-wider text-purple-500 block mb-1">Top ARPU Theme</div>
          <div className="text-lg font-black tracking-tight text-warm-text dark:text-dark-text truncate mb-1" title={metrics.topTheme}>
            {metrics.topTheme}
          </div>
          <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400">
            ₹{metrics.maxThemeArpu.toLocaleString()} ARPU
          </span>
        </div>

      </section>

      {/* Visual Analytics Charts Section */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        
        {/* Chart 1: ARPU Trend Across Dates */}
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-warm-text dark:text-dark-text mb-1">ARPU Trend Across Dates</h3>
          <p className="text-[11px] text-warm-muted dark:text-dark-muted mb-4">Daily average revenue per conversion (₹)</p>
          <div className="h-64 w-full">
            <Plot
              data={[{
                x: metrics.dateTrendChart.dates,
                y: metrics.dateTrendChart.values,
                type: 'scatter',
                mode: 'lines+markers',
                line: { color: '#F59E0B', width: 3, shape: 'spline' },
                marker: { color: '#D97706', size: 6 },
                name: 'ARPU (₹)'
              }]}
              layout={{
                autosize: true,
                margin: { l: 45, r: 20, t: 10, b: 35 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                xaxis: { 
                  color: isDark ? '#94a3b8' : '#64748b', 
                  showgrid: false, 
                  tickfont: { size: 10 } 
                },
                yaxis: { 
                  color: isDark ? '#94a3b8' : '#64748b', 
                  gridcolor: isDark ? '#334155' : '#f1f5f9',
                  tickprefix: '₹',
                  tickfont: { size: 10 }
                },
                hovermode: 'x'
              }}
              useResizeHandler={true}
              className="w-full h-full"
              config={{ displayModeBar: false }}
            />
          </div>
        </div>

        {/* Chart 2: ARPU by Campaign Theme */}
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-warm-text dark:text-dark-text mb-1">ARPU by Campaign Theme</h3>
          <p className="text-[11px] text-warm-muted dark:text-dark-muted mb-4">Average revenue per subscription for each sale theme (₹)</p>
          <div className="h-64 w-full">
            <Plot
              data={[{
                x: metrics.themeChart.labels,
                y: metrics.themeChart.values,
                type: 'bar',
                marker: {
                  color: ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6']
                },
                text: metrics.themeChart.values.map(v => `₹${v.toLocaleString()}`),
                textposition: 'auto',
                textfont: { size: 10, color: '#FFFFFF', weight: 'bold' }
              }]}
              layout={{
                autosize: true,
                margin: { l: 45, r: 20, t: 10, b: 65 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                xaxis: { 
                  color: isDark ? '#94a3b8' : '#64748b', 
                  showgrid: false, 
                  tickangle: -25,
                  tickfont: { size: 9 } 
                },
                yaxis: { 
                  color: isDark ? '#94a3b8' : '#64748b', 
                  gridcolor: isDark ? '#334155' : '#f1f5f9',
                  tickprefix: '₹',
                  tickfont: { size: 10 }
                }
              }}
              useResizeHandler={true}
              className="w-full h-full"
              config={{ displayModeBar: false }}
            />
          </div>
        </div>

      </section>

      {/* Platform ARPU Comparison Chart */}
      <section className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-5 shadow-sm mb-6">
        <h3 className="text-sm font-bold text-warm-text dark:text-dark-text mb-1">Platform ARPU Performance</h3>
        <p className="text-[11px] text-warm-muted dark:text-dark-muted mb-4">Comparing average revenue generated per user across platforms</p>
        <div className="h-56 w-full">
          <Plot
            data={[{
              x: metrics.platformChart.labels,
              y: metrics.platformChart.values,
              type: 'bar',
              marker: { color: '#3B82F6' },
              text: metrics.platformChart.values.map(v => `₹${v.toLocaleString()}`),
              textposition: 'auto',
              textfont: { size: 11, color: '#FFFFFF', weight: 'bold' }
            }]}
            layout={{
              autosize: true,
              margin: { l: 45, r: 20, t: 10, b: 35 },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              xaxis: { color: isDark ? '#94a3b8' : '#64748b', tickfont: { size: 10 } },
              yaxis: { color: isDark ? '#94a3b8' : '#64748b', gridcolor: isDark ? '#334155' : '#f1f5f9', tickprefix: '₹' }
            }}
            useResizeHandler={true}
            className="w-full h-full"
            config={{ displayModeBar: false }}
          />
        </div>
      </section>

      {/* Detailed Granular ARPU Data Table */}
      <section className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-warm-text dark:text-dark-text tracking-tight">Granular ARPU Transactions ({filteredData.length.toLocaleString()} Records)</h3>
            <p className="text-xs text-warm-muted dark:text-dark-muted font-medium">Detailed breakdown of conversions, revenue, offer, theme, and ARPU per row</p>
          </div>
          
          <input
            type="text"
            placeholder="Search by theme, platform, plan..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3.5 py-1.5 text-xs font-medium rounded-xl bg-warm-tableBg dark:bg-slate-800 border border-warm-border dark:border-dark-border focus:outline-none focus:ring-1 focus:ring-amber-accent w-full sm:w-64"
          />
        </div>

        {/* Table Container */}
        <div className="overflow-x-auto custom-scrollbar border border-warm-border/60 dark:border-zinc-800 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-warm-tableBg dark:bg-slate-800 text-warm-muted dark:text-dark-muted uppercase font-bold text-[10px] tracking-wider border-b border-warm-border dark:border-dark-border">
              <tr>
                <th className="p-3 sticky left-0 top-0 z-40 bg-warm-tableBg dark:bg-slate-800 border-r border-warm-border/40 dark:border-zinc-800">Txn Date</th>
                <th className="p-3">Platform</th>
                <th className="p-3">Plan Category</th>
                <th className="p-3">User Txn Type</th>
                <th className="p-3">Marketing Team</th>
                <th className="p-3">Offer</th>
                <th className="p-3">Campaign Theme</th>
                <th className="p-3">Sale Status</th>
                <th className="p-3 text-right">Conversions</th>
                <th className="p-3 text-right">Revenue (₹)</th>
                <th className="p-3 text-right">ARPU (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-border/40 dark:divide-zinc-800/60 font-medium">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan="11" className="p-6 text-center text-warm-muted dark:text-dark-muted italic">
                    No matching ARPU records found for the selected filters.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((r, idx) => {
                  const rowArpu = r.conversion > 0 ? Math.round(r.revenue / r.conversion) : 0;
                  return (
                    <tr key={idx} className="hover:bg-amber-500/5 transition-colors">
                      <td className="p-3 font-semibold whitespace-nowrap sticky left-0 z-20 bg-white dark:bg-[#0F172A] border-r border-warm-border/30 dark:border-zinc-800">{r.dateStr}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 font-bold text-[11px]">
                          {r.platform}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">{r.plan_category}</td>
                      <td className="p-3 capitalize whitespace-nowrap">{r.user_txn_type.replace(/_/g, ' ')}</td>
                      <td className="p-3 whitespace-nowrap">{r.marketing_team}</td>
                      <td className="p-3 font-semibold text-purple-600 dark:text-purple-400 whitespace-nowrap">{r.offer}</td>
                      <td className="p-3 font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">{r.theme}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold text-[10px]">
                          {r.sale_status}
                        </span>
                      </td>
                      <td className="p-3 text-right font-bold whitespace-nowrap">{r.conversion.toLocaleString()}</td>
                      <td className="p-3 text-right font-bold whitespace-nowrap">₹{Math.round(r.revenue).toLocaleString()}</td>
                      <td className="p-3 text-right font-black text-amber-accent whitespace-nowrap">
                        ₹{rowArpu.toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="flex justify-between items-center mt-4 pt-3 border-t border-warm-border/50 dark:border-zinc-800 text-xs">
            <span className="text-warm-muted dark:text-dark-muted font-medium">
              Page {currentPage} of {totalPages} ({filteredData.length.toLocaleString()} total rows)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg border border-warm-border dark:border-dark-border bg-white dark:bg-slate-800 disabled:opacity-40 font-bold cursor-pointer"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg border border-warm-border dark:border-dark-border bg-white dark:bg-slate-800 disabled:opacity-40 font-bold cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}

      </section>

    </div>
  );
}
