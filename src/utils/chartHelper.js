/**
 * chartHelper.js
 * Utilities for formatting, cleaning, and constructing multi-series Plotly charts
 * for the Conversational BI Assistant.
 */

// Curated distinctive palette for multi-series lines/bars
export const CHART_PALETTE = [
  '#3B82F6', // Blue (DAU / Primary)
  '#F59E0B', // Amber (Paywall Hits / Secondary)
  '#10B981', // Emerald (Purchased / Conversions)
  '#EC4899', // Pink
  '#8B5CF6', // Purple
  '#06B6D4', // Cyan
  '#F97316'  // Orange
];

/**
 * Clean any value into a strict number.
 * Strips commas, currency symbols, %, and parses abbreviations like 1.5M, 94.4k.
 */
export function cleanNumericValue(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const str = String(val).replace(/,/g, '').trim();
  // Check for M / k / lakh abbreviations
  const match = str.match(/[-+]?[0-9]*\.?[0-9]+/);
  if (match) {
    let num = parseFloat(match[0]);
    if (isNaN(num)) return 0;
    if (/lakh/i.test(str) || /L\b/i.test(str)) num *= 100000;
    else if (/cr/i.test(str) || /crore/i.test(str)) num *= 10000000;
    else if (/k\b/i.test(str)) num *= 1000;
    else if (/m\b/i.test(str)) num *= 1000000;
    return num;
  }
  return 0;
}

/**
 * Transforms an arbitrary chart object from an LLM or query engine into
 * a normalized structure with Plotly data traces and layout settings.
 */
export function buildPlotlyConfig(chart, isDark = false) {
  if (!chart || typeof chart !== 'object') return null;

  const rawLabels = Array.isArray(chart.labels) ? chart.labels.map(String) : [];
  const chartType = (chart.type || 'line').toLowerCase();
  let traces = [];

  // 1. Check if series array is present (Multi-series / multi-metric)
  if (Array.isArray(chart.series) && chart.series.length > 0) {
    traces = chart.series.map((s, idx) => {
      const sVals = (Array.isArray(s.values) ? s.values : (Array.isArray(s.data) ? s.data : []))
        .map(cleanNumericValue);
      const sType = s.type || (chartType.includes('bar') ? 'bar' : 'scatter');
      const traceType = sType === 'line' ? 'scatter' : sType;
      const color = s.color || CHART_PALETTE[idx % CHART_PALETTE.length];

      return {
        name: s.name || `Series ${idx + 1}`,
        x: rawLabels,
        y: sVals,
        type: traceType,
        mode: traceType === 'scatter' ? 'lines+markers' : undefined,
        line: traceType === 'scatter' ? { color: color, width: 2.5 } : undefined,
        marker: { color: color, size: traceType === 'scatter' ? 6 : undefined },
        yaxis: s.yAxis || undefined,
        text: sVals.map(v => v.toLocaleString()),
        hoverinfo: 'x+y+name'
      };
    });
  } 
  // 2. Check if values array is present
  else if (Array.isArray(chart.values) && chart.values.length > 0) {
    // Check for legacy hyphen-separated ranges e.g. "3059039 - 91838" or "24 - 20"
    const hasHyphenStrings = chart.values.some(v => typeof v === 'string' && /\d+\s*-\s*\d+/.test(v));

    if (hasHyphenStrings) {
      const s1 = [];
      const s2 = [];
      chart.values.forEach(v => {
        if (typeof v === 'string' && /\d+\s*-\s*\d+/.test(v)) {
          const parts = v.split('-').map(p => cleanNumericValue(p));
          s1.push(parts[0] || 0);
          s2.push(parts[1] || 0);
        } else {
          s1.push(cleanNumericValue(v));
          s2.push(0);
        }
      });

      traces = [
        {
          name: 'Primary Metric',
          x: rawLabels,
          y: s1,
          type: 'scatter',
          mode: 'lines+markers',
          line: { color: CHART_PALETTE[0], width: 2.5 },
          marker: { color: CHART_PALETTE[0], size: 6 },
          text: s1.map(v => v.toLocaleString()),
          hoverinfo: 'x+y+name'
        },
        {
          name: 'Secondary Metric',
          x: rawLabels,
          y: s2,
          type: 'scatter',
          mode: 'lines+markers',
          line: { color: CHART_PALETTE[1], width: 2.5 },
          marker: { color: CHART_PALETTE[1], size: 6 },
          yaxis: 'y2',
          text: s2.map(v => v.toLocaleString()),
          hoverinfo: 'x+y+name'
        }
      ];
    } else {
      // Single series numeric
      const cleanVals = chart.values.map(cleanNumericValue);
      const isBar = chartType.includes('bar');
      const traceType = isBar ? 'bar' : 'scatter';
      const color = chart.colors || CHART_PALETTE[0];

      traces = [
        {
          name: chart.title || 'Value',
          x: rawLabels,
          y: cleanVals,
          type: traceType,
          mode: isBar ? undefined : 'lines+markers',
          line: isBar ? undefined : { color: typeof color === 'string' ? color : CHART_PALETTE[0], width: 2.5 },
          marker: { color: color, size: isBar ? undefined : 6 },
          text: cleanVals.map(v => v.toLocaleString()),
          hoverinfo: 'x+y+name'
        }
      ];
    }
  }

  if (traces.length === 0) return null;

  // Auto-detect if secondary Y-axis is needed
  // If we have 2 or more traces and their max values differ significantly (>5x), map secondary to y2
  let hasY2 = traces.some(t => t.yaxis === 'y2');
  let y2Name = '';
  if (!hasY2 && traces.length >= 2) {
    const maxVals = traces.map(t => Math.max(...(t.y || [0])));
    const nonZeroMax = maxVals.filter(m => m > 0);
    if (nonZeroMax.length >= 2) {
      const overallMax = Math.max(...nonZeroMax);
      const minMax = Math.min(...nonZeroMax);
      if (overallMax / (minMax || 1) > 5) {
        traces.forEach((t, idx) => {
          if (maxVals[idx] > 0 && maxVals[idx] < overallMax / 5) {
            t.yaxis = 'y2';
            hasY2 = true;
            if (!y2Name) y2Name = t.name;
          }
        });
      }
    }
  }

  const textColor = isDark ? '#cbd5e1' : '#475569';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  const layout = {
    autosize: true,
    margin: hasY2 ? { l: 45, r: 45, t: traces.length > 1 ? 30 : 15, b: 35 } : { l: 45, r: 20, t: traces.length > 1 ? 30 : 15, b: 35 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    showlegend: traces.length > 1,
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.18,
      font: { size: 10, color: textColor }
    },
    hovermode: 'x unified',
    barmode: chartType === 'grouped_bar' || chart.barmode === 'group' ? 'group' : undefined,
    xaxis: {
      tickfont: { size: 10, color: textColor },
      showgrid: false
    },
    yaxis: {
      tickfont: { size: 10, color: textColor },
      showgrid: true,
      gridcolor: gridColor,
      zeroline: false
    }
  };

  if (hasY2) {
    layout.yaxis2 = {
      title: { text: y2Name, font: { size: 9, color: textColor } },
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      tickfont: { size: 9, color: textColor },
      zeroline: false
    };
  }

  return { traces, layout };
}
