export function SubscriptionReport({ isDark }) {

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

    useEffect(() => {
    function handleClickOutside(event) {
      if (platformRef.current && !platformRef.current.contains(event.target)) setPlatformOpen(false);
      if (txnRef.current && !txnRef.current.contains(event.target)) setTxnOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

            const rev = parseFloat(cleanRow['revenue_above_rs_6_txn']) || 0.0;
            const conv = parseInt(cleanRow['conversion'], 10) || 1;
            const dateObj = new Date(cleanRow['txn_date']);
            const isValidDate = !isNaN(dateObj.getTime());

            const platformCode = String(cleanRow['platform'] || '').trim().toLowerCase();
            const platformDisplay = PLATFORM_MAP[platformCode] || platformCode.toUpperCase();
            const autoRenewVal = String(cleanRow['auto_renew'] || '').trim().toLowerCase() === 'true';

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

          setRawData(processed);
          
          const platforms = [...new Set(processed.map(r => r.platformDisplay))].sort();
          const txns = [...new Set(processed.map(r => r.user_txn_type))].sort();
          setSelectedPlatforms(platforms);
          setSelectedTxnTypes(txns);

          setLoading(false);
        },
        error: (err) => {
          setError("Error parsing CSV data: " + err.message);
          setLoading(false);
        }
      });
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

  const txnCounts = useMemo(() => {
    const counts = {};
    rawData.forEach(r => {
      counts[r.user_txn_type] = (counts[r.user_txn_type] || 0) + 1;
    });
    return counts;
  }, [rawData]);

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

        {/* CONVERSIONS CARD */}
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Conversions (Excl. Auto-Renewal)</div>
          <div className="text-3xl font-bold text-warm-text dark:text-dark-text tracking-tight">{metrics.conversionsExclAuto.toLocaleString()}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg: <span className="font-bold text-amber-accent">{metrics.dailyAvgConvExcl.toFixed(0)}/day</span> <br />
            <span>Total conversions: {metrics.totalConversions.toLocaleString()}</span>
          </div>
        </div>

        {/* AVG TICKET CARD */}
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Avg Revenue / Txn</div>
          <div className="text-3xl font-bold text-warm-text dark:text-dark-text tracking-tight">{formatIndianCurrency(metrics.avgRevPerTxn)}</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            Daily avg volume: <span className="font-bold text-amber-accent">{metrics.dailyAvgTxns.toFixed(0)} txns/day</span> <br />
            <span>Across {metrics.totalTxns.toLocaleString()} transactions</span>
          </div>
        </div>

        {/* RECURRING RATE CARD */}
        <div className="p-5 bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-lg shadow-sm p-5">
          <div className="text-xs font-bold tracking-wider text-warm-label dark:text-dark-label uppercase mb-2">Recurring Rate (New)</div>
          <div className="text-3xl font-bold text-warm-text dark:text-dark-text tracking-tight">{(metrics.recurringRate * 100).toFixed(1)}%</div>
          <div className="text-xs text-warm-muted dark:text-dark-muted mt-2 leading-relaxed">
            <br />
            <span>Excl. auto_renewal txns</span>
          </div>
        </div>

      </section>

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

