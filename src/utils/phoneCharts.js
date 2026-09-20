/**
 * Point labels for phone-width charts.
 *
 * On a ~375px screen a daily series cannot carry a label on every point: the
 * labels overlap into an unreadable band. A single series keeps only the
 * labels that matter — its minimum, its maximum and the latest point — and
 * several series drop labels altogether (hover still shows every value).
 * Traces without text labels are returned untouched.
 */
export function phoneTraces(traces) {
  if (!Array.isArray(traces) || traces.length === 0) return traces;
  return traces.map((t) => {
    if (!t || typeof t.mode !== 'string' || !t.mode.includes('text') || !Array.isArray(t.text)) return t;

    if (traces.length > 1) {
      const mode = t.mode.split('+').filter((m) => m !== 'text').join('+') || 'lines';
      return { ...t, mode, text: undefined, textposition: undefined };
    }

    const ys = (t.y || []).map(Number);
    let hi = 0;
    let lo = 0;
    ys.forEach((v, i) => {
      if (v > ys[hi]) hi = i;
      if (v < ys[lo]) lo = i;
    });
    const keep = new Set([hi, lo, ys.length - 1]);
    return { ...t, text: t.text.map((label, i) => (keep.has(i) ? label : '')) };
  });
}
