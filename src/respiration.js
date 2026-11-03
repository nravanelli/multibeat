/**
 * Experimental RSA frequency estimate, implemented directly from generalized
 * Lomb–Scargle least squares (sin + cos + floating mean), not third-party code.
 * Math: https://doi.org/10.1051/0004-6361:200811296
 * RSA background: https://pubmed.ncbi.nlm.nih.gov/18188703/
 * Thresholds below are engineering heuristics, not clinically validated limits.
 */
export const RESPIRATION_CONFIG = Object.freeze({
  method: 'rsa-gls-v1', experimental: true, window_ms: 120000, update_ms: 5000,
  min_intervals: 60, min_rr_ms: 250, max_rr_ms: 2500, gap_ms: 5000,
  min_breaths_min: 6, max_breaths_min: 30, min_sd_ms: 3,
  max_outlier_fraction: 0.1, max_median_deviation: 0.2,
  min_explained_variance: 0.35, min_peak_ratio: 1.5,
  sampling_guard: 0.45, max_points: 512
});
const median = values => {
  const sorted = [...values].sort((a,b) => a-b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
};
const unavailable = (status, windowS = 0, quality = null) => ({ rate: null, status, quality, windowS, computedAt: null });

export function estimateRespiration(points) {
  const c = RESPIRATION_CONFIG;
  if (points.length < c.min_intervals) return unavailable('warming_up');
  const span = (points.at(-1).at - points[0].at) / 1000;
  if (span < (c.window_ms - c.max_rr_ms) / 1000) return unavailable('warming_up', span);
  if (points.some(p => !Number.isFinite(p.rrMs) || p.rrMs < c.min_rr_ms || p.rrMs > c.max_rr_ms)) return unavailable('invalid_rr', span);
  const centre = median(points.map(p => p.rrMs));
  const clean = points.filter(p => Math.abs(p.rrMs - centre) <= centre * c.max_median_deviation);
  if (1 - clean.length / points.length > c.max_outlier_fraction || clean.length < c.min_intervals) return unavailable('rr_artifacts', span);
  const times = clean.map(p => (p.at - points[0].at) / 1000);
  const meanT = times.reduce((a,b) => a+b, 0) / times.length;
  const meanY = clean.reduce((a,p) => a+p.rrMs, 0) / clean.length;
  let tt = 0, ty = 0;
  for (let i = 0; i < times.length; i++) { tt += (times[i]-meanT)**2; ty += (times[i]-meanT) * (clean[i].rrMs-meanY); }
  const values = clean.map((p,i) => p.rrMs - meanY - (tt ? ty/tt : 0) * (times[i]-meanT));
  const variance = values.reduce((a,y) => a+y*y, 0);
  if (Math.sqrt(variance / values.length) < c.min_sd_ms) return unavailable('weak_rr_variation', span);
  const low = c.min_breaths_min / 60;
  // Conservative guard against beat-sampling ambiguity; irregular data has no strict Nyquist limit.
  const high = Math.min(c.max_breaths_min / 60, c.sampling_guard * 1000 / centre);
  const step = 1 / (4 * span);
  if (high - low < 4 / span) return unavailable('sampling_limited', span);
  const spectrum = [];
  for (let frequency = low; frequency <= high + step / 10; frequency += step) {
    let cs = 0, ss = 0, cc = 0, sc = 0, cross = 0, yc = 0, ys = 0;
    for (let i = 0; i < times.length; i++) {
      const phase = 2 * Math.PI * frequency * times[i], cos = Math.cos(phase), sin = Math.sin(phase);
      cs += cos; ss += sin; cc += cos*cos; sc += sin*sin; cross += cos*sin;
      yc += values[i]*cos; ys += values[i]*sin;
    }
    cc -= cs*cs / times.length; sc -= ss*ss / times.length; cross -= cs*ss / times.length;
    const determinant = cc*sc - cross*cross;
    const power = determinant > 1e-10 ? ((yc*sc - ys*cross)*yc + (ys*cc - yc*cross)*ys) / determinant / variance : 0;
    spectrum.push({ frequency, power: Math.max(0, Math.min(1, power)) });
  }
  const peak = spectrum.reduce((a,b) => b.power > a.power ? b : a);
  const quality = +peak.power.toFixed(3);
  if (peak.frequency - low < 1 / span || high - peak.frequency < 1 / span) return unavailable('band_edge', span, quality);
  if (peak.power < c.min_explained_variance) return unavailable('weak_periodicity', span, quality);
  const other = Math.max(0, ...spectrum.filter(p => Math.abs(p.frequency - peak.frequency) > 2 / span).map(p => p.power));
  if (other && peak.power / other < c.min_peak_ratio) return unavailable('ambiguous_peak', span, quality);
  return { rate: +(peak.frequency * 60).toFixed(1), status: 'ok', quality, windowS: +span.toFixed(1), computedAt: null };
}

export class RespirationEstimator {
  constructor() { this.reset(); }
  reset(status = 'warming_up') {
    this.points = []; this.lastBatch = []; this.beatTime = null;
    this.lastReceipt = null; this.lastRRReceipt = null; this.lastEstimate = -Infinity;
    this.result = unavailable(status);
  }
  add(sample, at) {
    const c = RESPIRATION_CONFIG;
    this.lastBatch = [];
    if (sample.contact === false) { this.reset('no_contact'); this.lastReceipt = at; return this.result; }
    if (this.lastReceipt !== null && (at - this.lastReceipt > c.gap_ms || at < this.lastReceipt)) this.reset('gap_reset');
    this.lastReceipt = at;
    const intervals = sample.rrMs;
    if (!intervals.length) {
      if (this.lastRRReceipt === null || at - this.lastRRReceipt > c.gap_ms) { this.reset('no_rr'); this.lastReceipt = at; }
      return this.result;
    }
    if (intervals.some(rr => !Number.isFinite(rr) || rr <= 0)) { this.reset('invalid_rr'); this.lastReceipt = at; return this.result; }
    const sum = intervals.reduce((a,b) => a+b, 0);
    if (this.beatTime !== null && Math.abs(this.beatTime + sum - at) > c.gap_ms) this.reset('timing_gap');
    this.lastReceipt = at; this.lastRRReceipt = at;
    if (this.beatTime === null) this.beatTime = at - sum;
    for (const rrMs of intervals) {
      this.beatTime += rrMs;
      const point = { at: this.beatTime, rrMs };
      this.points.push(point); this.lastBatch.push(point);
    }
    while (this.points.length && (this.points[0].at < this.beatTime - c.window_ms || this.points.length > c.max_points)) this.points.shift();
    if (intervals.some(rr => rr < c.min_rr_ms || rr > c.max_rr_ms)) {
      this.result = unavailable('invalid_rr'); this.lastEstimate = -Infinity;
    } else if (at - this.lastEstimate >= c.update_ms) {
      this.result = estimateRespiration(this.points);
      this.result.computedAt = at;
      this.lastEstimate = at;
    }
    return this.result;
  }
}
