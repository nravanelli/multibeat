import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTrend, trendModel, MAX_TREND_MS } from '../src/trends.js';

test('expanded history extends beyond the mini trend and remains bounded for long recordings', () => {
  const history = [];
  for (let seconds = 0; seconds <= 7200; seconds++) appendTrend(history, seconds * 1000, 70);
  assert.ok(history.length <= 1801);
  assert.equal(trendModel(history, 7200000, MAX_TREND_MS).count, 1801);
  assert.equal(trendModel(history, 7200000, 60000).count, 61);
});
test('multiple notifications in one second keep one display point without modifying samples', () => {
  const history = [];
  appendTrend(history, 1100, 72); appendTrend(history, 1900, 74); appendTrend(history, 2100, 76);
  assert.deepEqual(history, [{ at: 1900, value: 74 }, { at: 2100, value: 76 }]);
});
test('graph model leaves gaps for missing readings and omits data outside the selected window', () => {
  const history = [{ at: 0, value: 70 }, { at: 1000, value: 75 }, { at: 9000, value: 80 }];
  const model = trendModel(history, 10000, 10000);
  assert.deepEqual(model.segments.map(segment => segment.length), [2, 1]);
  assert.equal(trendModel(history, 10000, 5000).count, 1);
  assert.equal(trendModel(history, 100000, 60000).count, 0);
  assert.equal(history.length, 3, 'changing the window must not discard longer display history');
});
test('single-point and constant-value graphs have valid ranges and normalized coordinates', () => {
  const model = trendModel([{ at: 1000, value: 0 }], 2000, 60000);
  assert.ok(model.max > model.min);
  const point = model.segments[0][0];
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
});

test('RR display retains multiple beat intervals per second and uses millisecond graph limits', () => {
  const history = [];
  for (const [at, value] of [[100, 800], [500, 850], [900, 820]]) appendTrend(history, at, value, { everyMs: 0, maxPoints: 8000 });
  assert.equal(history.length, 3);
  const rr = trendModel(history, 1000, 60000, { metric: 'rr' });
  assert.equal(rr.count, 3); assert.equal(rr.min, 780); assert.equal(rr.max, 870);
});
