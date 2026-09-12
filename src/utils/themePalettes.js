/**
 * themePalettes.js
 * Dark-mode color translation for chart identity colors.
 *
 * Light mode keeps the original warm (amber/ember) families — approved as-is.
 * Dark mode maps each warm step to the blue step of equivalent lightness
 * (matching the Marketing dashboard's dark treatment), so stacked layers and
 * ordered ramps keep their visual hierarchy, just in blue.
 *
 * Semantic/status colors (the renewal-rate traffic-light bands, greens, reds)
 * are deliberately NOT mapped — they carry meaning, not theme.
 */

// Injective: warm colors that appear TOGETHER in one chart's colorMap must map
// to DISTINCT blues, or series become indistinguishable in dark mode. The blue
// and sky ramps interleave to give enough distinct steps at each lightness.
const WARM_TO_BLUE = {
  '#FEF3C7': '#DBEAFE', // amber-100   -> blue-100
  '#FEF08A': '#BFDBFE', // pale ember  -> blue-200
  '#FDE68A': '#BAE6FD', // amber-200   -> sky-200
  '#FCD34D': '#93C5FD', // amber-300   -> blue-300
  '#FACC15': '#7DD3FC', // yellow-400  -> sky-300
  '#FBBF24': '#38BDF8', // amber-400   -> sky-400
  '#F59E0B': '#60A5FA', // amber-500   -> blue-400
  '#F97316': '#0EA5E9', // orange-500  -> sky-500
  '#D97706': '#3B82F6', // amber-600   -> blue-500
  '#EA580C': '#2563EB', // ember       -> blue-600
  '#B45309': '#1D4ED8', // amber-700   -> blue-700
  '#C2410C': '#1E40AF', // burnt ember -> blue-800
  '#9A3412': '#1E3A8A', // russet      -> blue-900
  '#92400E': '#1E3A8A', // amber-800   -> blue-900
  '#854D0E': '#0C4A6E', // bronze      -> sky-900
  '#78350F': '#172554', // amber-900   -> blue-950
  '#7C2D12': '#172554', // orange-900  -> blue-950
};

/** Translate one hex: warm -> blue in dark mode, unchanged otherwise. */
export function themedHex(hex, isDark) {
  if (!isDark || typeof hex !== 'string') return hex;
  return WARM_TO_BLUE[hex.toUpperCase()] || hex;
}

/** Translate a {seriesName: hex} map for dark mode. */
export function themedColorMap(colorMap, isDark) {
  if (!isDark || !colorMap) return colorMap;
  const out = {};
  for (const [key, value] of Object.entries(colorMap)) {
    out[key] = themedHex(value, isDark);
  }
  return out;
}

/** Translate an ordered color array for dark mode. */
export function themedColorList(colors, isDark) {
  if (!isDark || !Array.isArray(colors)) return colors;
  return colors.map(c => themedHex(c, isDark));
}
