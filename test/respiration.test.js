import test from 'node:test';
import assert from 'node:assert/strict';
import { RespirationEstimator, estimateRespiration, RESPIRATION_CONFIG } from '../src/respiration.js';

function synthetic(rate, { seconds = 180, amplitude = 40, noise = 0, secondRate = null } = {}) {
  const points = []; let time = 0, seed = 37;
  while (time < seconds) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const rrMs = 900 + amplitude * Math.sin(2*Math.PI*rate/60*time) + (secondRate ? amplitude*Math.sin(2*Math.PI*secondRate/60*time) : 0) + noise*(seed/2**32-0.5);
    time += rrMs/1000; points.push({ at: time*1000, rrMs });
  }
  return points;
}
const windowed = points => points.filter(p => p.at >= points.at(-1).at - RESPIRATION_CONFIG.window_ms);
const sample = rrMs => ({ contact: true, rrMs });

for (const rate of [9, 12, 18, 24]) test(`published spectral method recovers a synthetic ${rate} breaths/min RR modulation`, () => {
  const result = estimateRespiration(windowed(synthetic(rate, { noise: 10 })));
  assert.equal(result.status, 'ok');
  assert.ok(Math.abs(result.rate - rate) < 0.3, `got ${result.rate}`);
  assert.ok(result.quality > 0.8);
});
test('flat or linearly drifting RR intervals do not fabricate a respiration estimate', () => {
  for (const points of [Array.from({ length: 121 }, (_,i) => ({ at: i*1000, rrMs: 1000 })), Array.from({ length: 121 }, (_,i) => ({ at: i*1000, rrMs: 800+i }))]) {
    const result = estimateRespiration(points); assert.equal(result.rate, null); assert.equal(result.status, 'weak_rr_variation');
  }
});
test('noise, ambiguous peaks, band edges and heavy artifacts withhold estimated values', () => {
  const noise = estimateRespiration(windowed(synthetic(12, { amplitude: 0, noise: 100 })));
  assert.equal(noise.rate, null); assert.equal(noise.status, 'weak_periodicity');
  const ambiguous = estimateRespiration(windowed(synthetic(12, { amplitude: 30, secondRate: 18 })));
  assert.equal(ambiguous.rate, null); assert.equal(ambiguous.status, 'ambiguous_peak');
  assert.equal(estimateRespiration(windowed(synthetic(6))).rate, null);
  const artifacts = windowed(synthetic(12));
  artifacts.forEach((p,i) => { if (i % 4 === 0) p.rrMs = 1600; });
  assert.equal(estimateRespiration(artifacts).status, 'rr_artifacts');
});
test('estimator waits for a continuous window and uses every RR value in a batch', () => {
  const estimator = new RespirationEstimator();
  let result;
  const points = synthetic(12);
  for (let i = 0; i < points.length; i += 3) {
    const batch = points.slice(i, i+3);
    result = estimator.add(sample(batch.map(p => p.rrMs)), batch.at(-1).at);
    if (batch.at(-1).at < 117500) assert.equal(result.rate, null);
  }
  assert.equal(result.status, 'ok'); assert.ok(Math.abs(result.rate - 12) < 0.3);
  assert.ok(estimator.lastBatch.length > 0 && estimator.lastBatch.length <= 3);
});
test('contact loss, missing RR, timing discontinuities and explicit resets clear previous estimates', () => {
  const estimator = new RespirationEstimator();
  const points = synthetic(12);
  for (const p of points) estimator.add(sample([p.rrMs]), p.at);
  assert.equal(estimator.result.status, 'ok');
  const last = points.at(-1).at;
  assert.equal(estimator.add({ contact: false, rrMs: [900] }, last+1000).status, 'no_contact');
  assert.equal(estimator.result.rate, null); assert.equal(estimator.points.length, 0); assert.equal(estimator.lastBatch.length, 0);
  assert.equal(estimator.add(sample([]), last+2000).status, 'no_rr');
  estimator.add(sample([900]), last+3000);
  assert.equal(estimator.add(sample([900]), last+12000).rate, null);
  assert.equal(estimator.points.length, 1);
  estimator.reset('label_changed'); assert.equal(estimator.points.length, 0); assert.equal(estimator.result.rate, null);
});
test('invalid RR is retained as raw data upstream but does not produce an estimate', () => {
  const estimator = new RespirationEstimator();
  assert.equal(estimator.add(sample([100]), 1000).status, 'invalid_rr');
  assert.equal(estimator.add(sample([NaN]), 2000).status, 'invalid_rr');
});
test('analysis history stays bounded and recomputes at most every five seconds', () => {
  const estimator = new RespirationEstimator();
  estimator.add(sample([1000]), 1000);
  const first = estimator.result;
  estimator.add(sample([1000]), 2000);
  assert.equal(estimator.result, first);
  for (let seconds = 3; seconds <= 2000; seconds++) estimator.add(sample([1000]), seconds*1000);
  assert.ok(estimator.points.length <= RESPIRATION_CONFIG.max_points);
  assert.ok(estimator.points.at(-1).at - estimator.points[0].at <= RESPIRATION_CONFIG.window_ms);
});
