    return "₹0";
    return `${sign}₹${(absVal / 1000).toFixed(1)}K`;
    return `${sign}₹${absVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
            });
              geo_region: geoRegion,
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

  const txnCounts = useMemo(() => {
    const counts = {};
    rawData.forEach(r => {
      counts[r.user_txn_type] = (counts[r.user_txn_type] || 0) + 1;
    });
    return counts;
  }, [rawData]);

  }, [allPlatformOptions, selectedPlatforms.length]);
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
        <div ref={platformRef} className="relative flex flex-col gap-1 w-[200px]">
        
        <div ref={txnRef} className="relative flex flex-col gap-1 w-[200px] flex-1">

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
            <br />
            <span>Excl. auto_renewal txns</span>
          </div>
        </div>

      </section>
                hovertemplate: "<b>%{x}</b><br>Revenue: ₹%{y:,.2f}<extra></extra>"
              }
            ]}
            layout={{
              title: {
                text: "<b>Daily revenue trend</b>",
                font: {

        {/* RECURRING RATE CARD */}
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Recurring Rate (New)</div>
          <div className="text-3xl font-bold text-warm-text dark:text-dark-text tracking-tight">{(metrics.recurringRate * 100).toFixed(1)}%</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
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
        {/* AVG TICKET CARD */}
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Avg Revenue / Txn</div>
          <div className="text-3xl font-bold text-warm-text dark:text-dark-text tracking-tight">{formatIndianCurrency(metrics.avgRevPerTxn)}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg volume: <span className="font-bold text-amber-accent">{metrics.dailyAvgTxns.toFixed(0)} txns/day</span> <br />
            <span>Across {metrics.totalTxns.toLocaleString()} transactions</span>
          </div>
        </div>
                color: isDark ? '#94A3B8' : '#64748B',
                size: 10
              },
              margin: { l: 45, r: 15, t: 60, b: 45 },
              height: 345,
              xaxis: {
                showgrid: false,
                gridcolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
                zerolinecolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Conversions (Excl. Auto-Renewal)</div>
          <div className="text-3xl font-bold text-warm-text dark:text-dark-text tracking-tight">{metrics.conversionsExclAuto.toLocaleString()}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg: <span className="font-bold text-amber-accent">{metrics.dailyAvgConvExcl.toFixed(0)}/day</span> <br />
            <span>Total conversions: {metrics.totalConversions.toLocaleString()}</span>
          </div>
        </div>

                tickfont: { size: 10, color: isDark ? '#94A3B8' : '#64748B' }
              },
              yaxis: {
                gridcolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
                zerolinecolor: isDark ? 'rgba(226, 232, 240, 0.05)' : 'rgba(226, 232, 240, 0.6)',
                tickfont: { size: 10, color: isDark ? '#94A3B8' : '#64748B' },
                range: [0, Math.max(...chartData.map(d => d.revenue)) * 1.18]
      const geo = r.geo_region || 'UNKNOWN';
  );
}

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
  const [activeTab, setActiveTab] = useState('Realtime');
  const isDark = theme === 'dark';
        config={{ displayModeBar: false, responsive: true }}
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  'wap': 'MWeb',
  'market_android': 'Android',
  'ios': 'iOS'
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

  const [datePreset, setDatePreset] = useState("Last 30 days");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

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

    let dataMaxDate = dates[dates.length - 1];
    
    return { 
      minDateLimit: dates[0], 
      maxDateLimit: dataMaxDate > yesterdayStr ? yesterdayStr : dataMaxDate
    };
  }, [rawData]);



  const { overallTotals, platformData, trendData } = useMemo(() => {
    const overall = { DAU: 0, paywalling_hits: 0, Plan_Page_Load: 0, Plan_Selected: 0, Pay_Initiated: 0, Purchased: 0, daily: {} };
    const platforms = {};
    const trends = {};

    if (!startDate || !endDate || rawData.length === 0) return { overallTotals: overall, platformData: platforms, trendData: null };

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

    const dates = Object.keys(trends).sort();
    const trendDau = dates.map(d => trends[d].DAU);
    const trendConv = dates.map(d => trends[d].Plan_Page_Load > 0 ? (trends[d].Purchased / trends[d].Plan_Page_Load) * 100 : 0);
    const trendPaywall = dates.map(d => trends[d].DAU > 0 ? (trends[d].paywalling_hits / trends[d].DAU) * 100 : 0);

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

  const overallConversion = overallTotals.Plan_Page_Load > 0 ? ((overallTotals.Purchased / overallTotals.Plan_Page_Load) * 100).toFixed(2) : 0;
  const paywallRate = overallTotals.DAU > 0 ? ((overallTotals.paywalling_hits / overallTotals.DAU) * 100).toFixed(2) : 0;

  const dailyAvgDau = trendData ? Math.round(overallTotals.DAU / trendData.uniqueDays) : 0;

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

  const activePlatforms = Object.keys(platformData).sort();

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