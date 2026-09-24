/**
 * Plot.jsx — the one Plotly component every chart in the app renders through.
 *
 * Why a wrapper exists: plotly.js (2.35) throws away the computed autorange
 * when Plotly.react receives a new layout object while the trace arrays are
 * unchanged. That is exactly what a theme toggle, a table page change or any
 * other re-render does here, because every chart builds its layout as an
 * inline literal. The axes then fall back to Plotly's empty defaults — a date
 * axis shows 2000-01-01..2001-01-01, a linear axis -1..4 — with the points
 * drawn off-screen. `layout.uirevision` makes Plotly keep the current axis
 * state across such redraws; new data still autoranges and explicit ranges
 * still apply (verified with a headless plotly repro, 2026-09-20). A chart can
 * still set its own uirevision.
 *
 * `lockZoom` removes every zoom / pan interaction — box-zoom drag, axis drag,
 * scroll and pinch zoom, double-click reset — while hover keeps working. The
 * line, area and column charts use it; the geo map keeps its zoom.
 */
import React from 'react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

const BasePlot = createPlotlyComponent(Plotly);

const AXIS_KEY = /^[xy]axis\d*$/;

// The dashboard's typeface (DM Sans, set on body and in Tailwind). Plotly
// defaults to Open Sans, so every chart gets this unless its layout says
// otherwise; a chart's own `font` values still win.
const CHART_FONT_FAMILY = '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export default function Plot({ layout, config, lockZoom = false, ...rest }) {
  let mergedLayout = {
    uirevision: 'et-prime',
    ...(layout || {}),
    font: { family: CHART_FONT_FAMILY, ...((layout && layout.font) || {}) },
  };
  let mergedConfig = config;

  if (lockZoom) {
    mergedLayout = { ...mergedLayout, dragmode: false };
    Object.keys(mergedLayout).forEach((key) => {
      if (AXIS_KEY.test(key)) mergedLayout[key] = { ...(mergedLayout[key] || {}), fixedrange: true };
    });
    if (!mergedLayout.xaxis) mergedLayout.xaxis = { fixedrange: true };
    if (!mergedLayout.yaxis) mergedLayout.yaxis = { fixedrange: true };
    mergedConfig = { ...(config || {}), scrollZoom: false, doubleClick: false };
  }

  return <BasePlot layout={mergedLayout} config={mergedConfig} {...rest} />;
}
