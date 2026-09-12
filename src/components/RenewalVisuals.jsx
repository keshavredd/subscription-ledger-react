import React, { useMemo } from 'react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

const Plot = createPlotlyComponent(Plotly);

const CANONICAL_PLATFORMS = [
  'Main - IOS',
  'Main - Android',
  'WEB',
  'WAP',
  'Market - Android',
  'Market - IOS'
];

/**
 * Maps renewal rate % to heatmap color swatch
 */
function getHeatmapCellStyle(rate, isDark) {
  if (rate === null || rate === undefined || isNaN(rate)) {
    return {
      bg: isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)',
      text: isDark ? '#64748B' : '#94A3B8',
      display: '—'
    };
  }

  const rounded = Math.round(rate);
  const display = `${rounded}%`;

  if (rate < 30) {
    return {
      bg: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2',
      text: isDark ? '#FCA5A5' : '#991B1B',
      display
    };
  }
  if (rate < 40) {
    return {
      bg: isDark ? 'rgba(254, 240, 138, 0.25)' : '#FEF08A',
      text: isDark ? '#FEF08A' : '#854D0E',
      display
    };
  }
  if (rate < 50) {
    return {
      bg: isDark ? 'rgba(251, 191, 36, 0.35)' : '#FDE047',
      text: isDark ? '#FDE047' : '#78350F',
      display
    };
  }
  if (rate < 60) {
    return {
      bg: isDark ? 'rgba(249, 115, 22, 0.50)' : '#FB923C',
      text: isDark ? '#FED7AA' : '#FFFFFF',
      display
    };
  }
  // >= 60%
  return {
    bg: isDark ? 'rgba(239, 68, 68, 0.70)' : '#EA580C',
    text: '#FFFFFF',
    display
  };
}

/**
 * 1. RENEWAL PERFORMANCE HEATMAP COMPONENT
 */
export function RenewalHeatmap({ filteredRenewalsData = [], renDatePreset = "Last 30 days", renViewLevel = "Day", isDark = false }) {
  const { dateColumns, platformRows, avgLabel } = useMemo(() => {
    if (!filteredRenewalsData.length) {
      return { dateColumns: [], platformRows: [], avgLabel: "Avg" };
    }

    // Determine unique dates/months in dataset
    const dateMap = {};
    filteredRenewalsData.forEach(r => {
      const key = renViewLevel === "Day" ? (r.renew_date || r.renew_month) : r.renew_month;
      if (key && !dateMap[key]) {
        let label = key;
        if (renViewLevel === "Day" && key.includes("-")) {
          const parts = key.split("-");
          if (parts.length === 3) {
            const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }
        } else if (renViewLevel === "Month" && key.includes("-")) {
          const parts = key.split("-");
          if (parts.length >= 2) {
            const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
            label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
          }
        }
        dateMap[key] = label;
      }
    });

    const sortedDateKeys = Object.keys(dateMap).sort((a, b) => b.localeCompare(a));
    const cols = sortedDateKeys.map(k => ({ key: k, label: dateMap[k] }));

    // Extract all platforms, ordering by canonical list first
    const existingPlatforms = Array.from(new Set(filteredRenewalsData.map(r => r.platform).filter(Boolean)));
    const orderedPlatforms = [
      ...CANONICAL_PLATFORMS.filter(p => existingPlatforms.includes(p)),
      ...existingPlatforms.filter(p => !CANONICAL_PLATFORMS.includes(p))
    ];

    // Build platform-wise rows
    const rows = orderedPlatforms.map(platform => {
      let totalDue = 0;
      let totalRenewed = 0;
      const cellMap = {};

      filteredRenewalsData.forEach(r => {
        if (r.platform === platform) {
          const key = renViewLevel === "Day" ? (r.renew_date || r.renew_month) : r.renew_month;
          if (key) {
            if (!cellMap[key]) cellMap[key] = { due: 0, renewed: 0 };
            cellMap[key].due += r.renewal_due;
            cellMap[key].renewed += r.renewed;
            totalDue += r.renewal_due;
            totalRenewed += r.renewed;
          }
        }
      });

      const cellRates = cols.map(c => {
        const data = cellMap[c.key];
        if (!data || data.due === 0) return { key: c.key, rate: null, due: 0, renewed: 0 };
        const rate = (data.renewed / data.due) * 100;
        return { key: c.key, rate, due: data.due, renewed: data.renewed };
      });

      const avgRate = totalDue > 0 ? (totalRenewed / totalDue) * 100 : null;

      // Clean display name matching reference (IOS, Android, WEB, WAP, etc.)
      const displayName = platform.startsWith('Main - ') ? platform.replace('Main - ', '') : platform;

      return {
        platform,
        displayName,
        cellRates,
        totalDue,
        totalRenewed,
        avgRate
      };
    });

    // Label for rightmost column
    let label = "Avg (Period)";
    if (renDatePreset === "Last 30 days") label = "Avg (30 Days)";
    else if (renDatePreset === "Last 7 days") label = "Avg (7 Days)";
    else if (renDatePreset === "Last 90 days") label = "Avg (90 Days)";
    else if (renDatePreset === "Yesterday") label = "Yesterday";
    else if (renDatePreset === "This month") label = "Avg (Month)";
    else if (renDatePreset === "Last month") label = "Avg (Last Month)";
    else if (cols.length > 0) label = `Avg (${cols.length} Days)`;

    return { dateColumns: cols, platformRows: rows, avgLabel: label };
  }, [filteredRenewalsData, renDatePreset, renViewLevel]);

  return (
    <div className="w-full flex flex-col h-full">
      {/* Header */}
      <div className="mb-3 px-1">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text tracking-tight">
          Renewal Performance Heatmap (Renewal Rate %)
        </h3>
        <p className="text-xs text-warm-muted dark:text-dark-muted font-medium mt-0.5">
          Platform-wise daily renewal rates with benchmark gradient and period average
        </p>
      </div>

      {/* Heatmap Matrix Table */}
      <div className="ledger-table-box bg-warm-tableBg dark:bg-dark-tableBg border border-warm-border dark:border-dark-border rounded-xl custom-scrollbar overflow-x-auto shadow-sm flex-1 min-h-[220px]">
        <table className="ledger-table text-xs text-left w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-30">
            <tr className="text-warm-muted dark:text-dark-muted uppercase font-bold text-[11px] tracking-wider border-b border-warm-border dark:border-dark-border">
              {/* Sticky Platform Header */}
              <th className="p-2.5 whitespace-nowrap bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text sticky left-0 top-0 z-50 border-r border-warm-border dark:border-dark-border shadow-sm min-w-[110px]">
                PLATFORM
              </th>

              {/* Dynamic Date Columns */}
              {dateColumns.map(col => (
                <th key={col.key} className="p-2.5 text-center whitespace-nowrap bg-white dark:bg-[#1E293B] text-warm-text dark:text-dark-text min-w-[58px]">
                  {col.label}
                </th>
              ))}

              {/* Sticky Rightmost Average Column */}
              <th className="p-2.5 text-center whitespace-nowrap bg-[#FEF3C7] dark:bg-[#1E293B] text-amber-600 dark:text-amber-400 sticky right-0 top-0 z-50 border-l border-warm-border dark:border-dark-border font-extrabold shadow-sm min-w-[95px]">
                {avgLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {platformRows.length > 0 ? (
              platformRows.map(row => (
                <tr key={row.platform} className="border-b border-warm-border/40 dark:border-zinc-800/60 font-medium">
                  {/* Sticky Platform Column */}
                  <td className="p-2.5 font-bold text-warm-text dark:text-dark-text sticky left-0 z-20 bg-white dark:bg-[#0F172A] border-r border-warm-border/60 dark:border-zinc-800 whitespace-nowrap shadow-sm">
                    <span title={row.platform}>{row.displayName}</span>
                  </td>

                  {/* Heatmap Metric Cells */}
                  {row.cellRates.map(cell => {
                    const style = getHeatmapCellStyle(cell.rate, isDark);
                    return (
                      <td
                        key={cell.key}
                        style={{ backgroundColor: style.bg, color: style.text }}
                        title={`${row.platform} on ${cell.key}: ${cell.rate !== null ? cell.rate.toFixed(1) + '%' : 'No Data'} (Due: ${cell.due}, Renewed: ${cell.renewed})`}
                        className="p-2 text-center font-bold text-xs transition-colors cursor-default border-r border-b border-black/5 dark:border-white/5"
                      >
                        {style.display}
                      </td>
                    );
                  })}

                  {/* Sticky Rightmost Average Rate Cell */}
                  <td className="p-2.5 text-center font-black text-xs text-amber-700 dark:text-amber-300 sticky right-0 z-20 bg-[#FFFBEB] dark:bg-[#0F172A] border-l border-warm-border/60 dark:border-zinc-800 whitespace-nowrap shadow-sm">
                    {row.avgRate !== null ? `${row.avgRate.toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={dateColumns.length + 2} className="p-8 text-center text-xs font-semibold text-warm-muted dark:text-dark-muted">
                  No renewal records found for the selected timeframe.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Heatmap Color Scale Legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-3 mt-3 border-t border-warm-border/60 dark:border-dark-border/60 text-xs text-warm-muted dark:text-dark-muted font-semibold">
        <span className="font-bold text-warm-text dark:text-dark-text">Renewal Rate %:</span>
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-3.5 rounded-sm bg-[#FEF2F2] dark:bg-red-950/40 border border-red-200 dark:border-red-900" />
          <span>&lt; 30%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-3.5 rounded-sm bg-[#FEF08A] dark:bg-yellow-900/40 border border-yellow-300 dark:border-yellow-700" />
          <span>30% - 40%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-3.5 rounded-sm bg-[#FDE047] dark:bg-amber-800/40 border border-amber-400 dark:border-amber-600" />
          <span>40% - 50%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-3.5 rounded-sm bg-[#FB923C] dark:bg-orange-700/50 border border-orange-400 dark:border-orange-600" />
          <span>50% - 60%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-3.5 rounded-sm bg-[#EA580C] dark:bg-red-600/70 border border-red-500" />
          <span>&gt; 60%</span>
        </div>
      </div>
    </div>
  );
}

/**
 * 2. RENEWAL RATE VS VOLUME 4-QUADRANT BUBBLE CHART COMPONENT
 */
export function RenewalRateVsVolumeChart({
  renPlatformData = [],
  renTotalDue = 0,
  renOverallRate = 44.6,
  renDatePreset = "Last 30 days",
  isDark = false
}) {
  const chartData = useMemo(() => {
    if (!renPlatformData.length) return { traces: [], layout: {} };

    // Calculate min/max volume for proportional sizing
    const dueValues = renPlatformData.map(p => p.due);
    const minDue = Math.min(...dueValues);
    const maxDue = Math.max(...dueValues);

    // Dynamic Quadrant Thresholds
    // Vertical divider at median/threshold volume (around 2,800 to 3,000)
    const volumeThreshold = maxDue > 3000 ? 3000 : Math.round((minDue + maxDue) / 2);
    // Horizontal divider at benchmark rate (40%)
    const rateThreshold = 40;

    const xValues = [];
    const yValues = [];
    const markerSizes = [];
    const markerColors = [];
    const markerLineColors = [];
    const textLabels = [];
    const customData = [];

    renPlatformData.forEach(row => {
      xValues.push(row.due);
      yValues.push(row.rate);

      // Bubble size between 22px and 56px based on Renewal Due volume
      const normalizedSize = maxDue > minDue ? (row.due - minDue) / (maxDue - minDue) : 0.5;
      const size = Math.round(24 + normalizedSize * 32);
      markerSizes.push(size);

      // Color mapping matching performance:
      // High rate (>= 50%): Green/Lime
      // Medium rate (40% - 50%): Amber/Orange
      // Low rate (< 40%): Red/Coral
      let fillCol, lineCol;
      if (row.rate >= 60) {
        fillCol = 'rgba(34, 197, 94, 0.70)';
        lineCol = '#16A34A';
      } else if (row.rate >= 50) {
        fillCol = 'rgba(132, 204, 22, 0.75)';
        lineCol = '#65A30D';
      } else if (row.rate >= 40) {
        fillCol = 'rgba(245, 158, 11, 0.75)';
        lineCol = '#D97706';
      } else {
        fillCol = 'rgba(239, 68, 68, 0.70)';
        lineCol = '#DC2626';
      }
      markerColors.push(fillCol);
      markerLineColors.push(lineCol);

      // Label shown next to bubble
      const displayName = row.platform.startsWith('Main - ') ? row.platform.replace('Main - ', '') : row.platform;
      textLabels.push(`${displayName} (${row.rate.toFixed(1)}%)`);

      customData.push({
        platform: row.platform,
        due: row.due,
        renewed: row.renewed,
        rate: row.rate,
        share: renTotalDue > 0 ? (row.due / renTotalDue) * 100 : 0
      });
    });

    const traces = [
      {
        x: xValues,
        y: yValues,
        mode: 'markers+text',
        type: 'scatter',
        text: textLabels,
        textposition: 'top right',
        textfont: {
          size: 10,
          color: isDark ? '#E2E8F0' : '#1E293B',
          weight: 'bold'
        },
        marker: {
          size: markerSizes,
          color: markerColors,
          line: {
            color: markerLineColors,
            width: 2.5
          },
          sizemode: 'diameter'
        },
        customdata: customData,
        hovertemplate:
          `<b>%{customdata.platform}</b><br>` +
          `Renewal Rate: <b>%{y:.1f}%</b><br>` +
          `Renewal Due: <b>%{x:,.0f}</b><br>` +
          `Renewed: <b>%{customdata.renewed:,.0f}</b><br>` +
          `Volume Share: <b>%{customdata.share:.1f}%</b><extra></extra>`
      }
    ];

    const maxX = Math.max(5000, Math.ceil((maxDue * 1.25) / 1000) * 1000);

    const layout = {
      autosize: true,
      height: 380,
      margin: { l: 55, r: 60, t: 25, b: 50 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { family: 'inherit', color: isDark ? '#94A3B8' : '#64748B', size: 10 },
      showlegend: false,
      xaxis: {
        title: { text: '<b>RENEWAL DUE (VOLUME)</b>', font: { size: 10, color: isDark ? '#94A3B8' : '#64748B' } },
        range: [0, maxX],
        showgrid: false,
        zeroline: false,
        tickvals: [0, 1000, 2000, 3000, 4000, 5000],
        ticktext: ['0', '1K', '2K', '3K', '4K', '5K'],
        tickfont: { size: 10, color: isDark ? '#94A3B8' : '#64748B' }
      },
      yaxis: {
        title: { text: '<b>RENEWAL RATE (%)</b>', font: { size: 10, color: isDark ? '#94A3B8' : '#64748B' } },
        range: [0, 85],
        ticksuffix: '%',
        showgrid: false,
        zeroline: false,
        tickvals: [0, 20, 40, 60, 80],
        tickfont: { size: 10, color: isDark ? '#94A3B8' : '#64748B' }
      },
      shapes: [
        // Horizontal Benchmark Divider (40%)
        {
          type: 'line',
          xref: 'paper',
          x0: 0,
          x1: 1,
          y0: rateThreshold,
          y1: rateThreshold,
          line: {
            color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)',
            width: 1.5,
            dash: 'dash'
          }
        },
        // Vertical Benchmark Divider (Volume threshold)
        {
          type: 'line',
          yref: 'paper',
          y0: 0,
          y1: 1,
          x0: volumeThreshold,
          x1: volumeThreshold,
          line: {
            color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)',
            width: 1.5,
            dash: 'dash'
          }
        }
      ],
      annotations: [
        // Top-Left: High Rate / Low Volume
        {
          xref: 'paper',
          yref: 'paper',
          x: 0.02,
          y: 0.98,
          text: '<b>High Rate / Low Volume</b>',
          showarrow: false,
          font: { size: 11, color: '#16A34A' },
          xanchor: 'left',
          yanchor: 'top'
        },
        // Top-Right: High Rate / High Volume
        {
          xref: 'paper',
          yref: 'paper',
          x: 0.98,
          y: 0.98,
          text: '<b>High Rate / High Volume</b>',
          showarrow: false,
          font: { size: 11, color: '#16A34A' },
          xanchor: 'right',
          yanchor: 'top'
        },
        // Bottom-Left: Low Rate / Low Volume
        {
          xref: 'paper',
          yref: 'paper',
          x: 0.02,
          y: 0.04,
          text: '<b>Low Rate / Low Volume</b>',
          showarrow: false,
          font: { size: 11, color: '#DC2626' },
          xanchor: 'left',
          yanchor: 'bottom'
        },
        // Bottom-Right: Low Rate / High Volume
        {
          xref: 'paper',
          yref: 'paper',
          x: 0.98,
          y: 0.04,
          text: '<b>Low Rate / High Volume</b>',
          showarrow: false,
          font: { size: 11, color: '#DC2626' },
          xanchor: 'right',
          yanchor: 'bottom'
        }
      ]
    };

    return { traces, layout };
  }, [renPlatformData, renTotalDue, renOverallRate, isDark]);

  return (
    <div className="w-full flex flex-col h-full">
      {/* Header */}
      <div className="mb-2 px-1">
        <h3 className="text-base font-bold text-warm-text dark:text-dark-text tracking-tight">
          Renewal Rate vs Volume ({renDatePreset})
        </h3>
        <p className="text-xs text-warm-muted dark:text-dark-muted font-medium mt-0.5">
          Bubble size represents Renewal Due volume across 4 strategic performance quadrants
        </p>
      </div>

      {/* 4-Quadrant Bubble Plot */}
      <div className="w-full flex-1 flex items-center justify-center min-h-[380px]">
        {chartData.traces.length > 0 ? (
          <Plot
            data={chartData.traces}
            layout={chartData.layout}
            config={{ displayModeBar: false, responsive: true }}
            className="w-full"
            style={{ width: '100%', height: '380px' }}
          />
        ) : (
          <div className="flex h-[260px] items-center justify-center text-sm font-semibold text-warm-muted dark:text-dark-muted">
            No platform data available for quadrant analysis.
          </div>
        )}
      </div>
    </div>
  );
}

const DONUT_PALETTE = [
  '#F97316', // Orange (Top category)
  '#1E3A8A', // Deep Navy
  '#3B82F6', // Blue
  '#14B8A6', // Teal
  '#22C55E', // Green
  '#94A3B8', // Slate
  '#A855F7', // Purple
  '#EAB308', // Yellow
  '#EC4899', // Pink
  '#06B6D4'  // Cyan
];

// Dark mode: the orange top slot goes blue-family (sky-400) — still separable
// from the navy and blue slots that follow it.
const DARK_DONUT_PALETTE = ['#38BDF8', ...DONUT_PALETTE.slice(1)];

function donutPalette(isDark) {
  return isDark ? DARK_DONUT_PALETTE : DONUT_PALETTE;
}

/**
 * Reusable Donut Chart Card matching reference image
 */
export function RecurringDonutCard({ title, items = [], totalCount = 0, isDark = false }) {
  const chartData = useMemo(() => {
    if (!items || items.length === 0) return { trace: null, layout: {} };

    const labels = items.map(d => d.label);
    const values = items.map(d => d.count);
    const colors = items.map((_, idx) => donutPalette(isDark)[idx % DONUT_PALETTE.length]);

    const trace = {
      type: 'pie',
      labels,
      values,
      hole: 0.68,
      marker: {
        colors,
        line: {
          color: isDark ? '#1E293B' : '#FFFFFF',
          width: 2
        }
      },
      textinfo: 'none',
      hoverinfo: 'label+value+percent',
      hovertemplate: '<b>%{label}</b><br>Recurring: <b>%{value:,.0f}</b><br>Share: <b>%{percent}</b><extra></extra>',
      sort: false
    };

    const layout = {
      autosize: true,
      height: 190,
      width: 190,
      margin: { l: 5, r: 5, t: 5, b: 5 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      showlegend: false,
      annotations: [
        {
          text: `<span style="font-size:17px;font-weight:900;color:${isDark ? '#F1F5F9' : '#0F172A'}">${totalCount.toLocaleString()}</span><br><span style="font-size:11px;font-weight:600;color:${isDark ? '#94A3B8' : '#64748B'}">(100%)</span>`,
          showarrow: false,
          x: 0.5,
          y: 0.5
        }
      ]
    };

    return { trace, layout, colors };
  }, [items, totalCount, isDark]);

  return (
    <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-xl shadow-sm p-4 flex flex-col justify-between">
      {/* Title */}
      <h3 className="text-sm font-bold text-warm-text dark:text-dark-text tracking-tight mb-3 px-1">
        {title}
      </h3>

      {items.length > 0 && totalCount > 0 ? (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Donut Chart with Center Total */}
          <div className="w-[190px] h-[190px] flex-shrink-0 flex items-center justify-center">
            {chartData.trace && (
              <Plot
                data={[chartData.trace]}
                layout={chartData.layout}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '190px', height: '190px' }}
              />
            )}
          </div>

          {/* Right-hand Legend List matching reference */}
          <div className="flex-1 min-w-0 w-full flex flex-col justify-center space-y-1.5 pl-1 pr-1">
            {items.map((item, idx) => {
              const color = chartData.colors ? chartData.colors[idx] : donutPalette(isDark)[idx % DONUT_PALETTE.length];
              return (
                <div key={item.label} className="flex items-center justify-between text-xs py-0.5 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate font-semibold text-warm-text dark:text-dark-text text-[11px]" title={item.label}>
                      {item.label}
                    </span>
                  </div>
                  <span className="text-warm-muted dark:text-dark-muted font-bold text-[11px] whitespace-nowrap">
                    {item.count.toLocaleString()} <span className="font-semibold text-warm-muted/80">({item.share.toFixed(1)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex h-[190px] items-center justify-center text-xs font-semibold text-warm-muted dark:text-dark-muted">
          No recurring data available for this breakdown.
        </div>
      )}
    </div>
  );
}

/**
 * 3-Column Recurring Donuts Section (Platform, Plan Category, Marketing Team)
 */
export function RecurringDonutsSection({
  recPlatformData = [],
  recPlanData = [],
  recTeamData = [],
  recRecurringConv = 0,
  isDark = false
}) {
  // 1. Process Platform Donut Data
  const platformItems = useMemo(() => {
    if (!recPlatformData.length || recRecurringConv === 0) return [];
    return recPlatformData
      .filter(p => p.rec > 0)
      .map(p => {
        const cleanName = p.platform.startsWith('Main - ') ? p.platform.replace('Main - ', '') : p.platform;
        return {
          label: cleanName,
          count: p.rec,
          share: (p.rec / recRecurringConv) * 100
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [recPlatformData, recRecurringConv]);

  // 2. Process Plan Category Donut Data
  const planItems = useMemo(() => {
    if (!recPlanData.length || recRecurringConv === 0) return [];
    const sorted = [...recPlanData].filter(p => p.rec > 0).sort((a, b) => b.rec - a.rec);
    
    // Format plan names e.g. "1 YEAR" -> "1 Year"
    const formatted = sorted.map(p => {
      const words = (p.plan || 'Unknown').toLowerCase().split(' ');
      const titleCase = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return {
        label: titleCase,
        count: p.rec,
        share: (p.rec / recRecurringConv) * 100
      };
    });

    // Top 5 and bundle rest into "Others" if many
    if (formatted.length > 6) {
      const top = formatted.slice(0, 5);
      const others = formatted.slice(5);
      const othersCount = others.reduce((acc, curr) => acc + curr.count, 0);
      const othersShare = (othersCount / recRecurringConv) * 100;
      return [...top, { label: 'Others', count: othersCount, share: othersShare }];
    }
    return formatted;
  }, [recPlanData, recRecurringConv]);

  // 3. Process Marketing Team Donut Data
  const teamItems = useMemo(() => {
    if (!recTeamData.length || recRecurringConv === 0) return [];
    const sorted = [...recTeamData].filter(t => t.rec > 0).sort((a, b) => b.rec - a.rec);
    const formatted = sorted.map(t => ({
      label: t.team || 'Unknown',
      count: t.rec,
      share: (t.rec / recRecurringConv) * 100
    }));

    if (formatted.length > 6) {
      const top = formatted.slice(0, 5);
      const others = formatted.slice(5);
      const othersCount = others.reduce((acc, curr) => acc + curr.count, 0);
      const othersShare = (othersCount / recRecurringConv) * 100;
      return [...top, { label: 'Others', count: othersCount, share: othersShare }];
    }
    return formatted;
  }, [recTeamData, recRecurringConv]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      <RecurringDonutCard
        title="Recurring by Platform"
        items={platformItems}
        totalCount={recRecurringConv}
        isDark={isDark}
      />
      <RecurringDonutCard
        title="Recurring by Plan Category"
        items={planItems}
        totalCount={recRecurringConv}
        isDark={isDark}
      />
      <RecurringDonutCard
        title="Recurring by Marketing Team"
        items={teamItems}
        totalCount={recRecurringConv}
        isDark={isDark}
      />
    </div>
  );
}

