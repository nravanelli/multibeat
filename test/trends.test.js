import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTrend, appendRRTrend, MAX_TREND_MS } from '../src/trends.js';
import { chartData } from '../src/charts.js';

test('expanded history extends beyond the mini trend and remains bounded for long recordings', () => {
  const history = [];
  for (let seconds = 0; seconds <= 7200; seconds++) appendTrend(history, seconds * 1000, 70);
  assert.ok(history.length <= 3601);
  assert.equal(MAX_TREND_MS, 3600000);
  assert.equal(history[0].at, 3600000, 'retain the entire last hour, including data older than 30 minutes');
  assert.equal(chartData(history, 7200000, MAX_TREND_MS)[0].length, 3601);
  assert.equal(chartData(history, 7200000, 60000)[0].length, 61);
});

test('RR graphs retain a full hour of beat intervals and expire older data', () => {
  const history = [], clock = {};
  for (let i = 0; i <= 14400; i++) appendRRTrend(history, { contact: true, rrMs: [500] }, i * 500, clock);
  assert.equal(history.length, 7201);
  assert.equal(history[0].at, 3600000);
  assert.equal(history.at(-1).at, 7200000);
  assert.equal(chartData(history, 7200000, MAX_TREND_MS)[0].length, 7201);
});
test('multiple notifications in one second keep one display point without modifying samples', () => {
  const history = [];
  appendTrend(history, 1100, 72); appendTrend(history, 1900, 74); appendTrend(history, 2100, 76);
  assert.deepEqual(history, [{ at: 1900, value: 74 }, { at: 2100, value: 76 }]);
});
test('plot data leaves gaps for missing readings and omits points outside the selected window', () => {
  const history = [{ at: 0, value: 70 }, { at: 1000, value: 75 }, { at: 9000, value: 80 }];
  assert.deepEqual(chartData(history, 10000, 10000), [[0, 1000, 5000, 9000], [70, 75, null, 80]]);
  assert.equal(chartData(history, 10000, 5000)[0].length, 1);
  assert.equal(chartData(history, 100000, 60000)[0].length, 0);
  assert.equal(history.length, 3, 'changing the window must not discard longer display history');
});
test('zero and constant readings remain values rather than being replaced with missing data', () => {
  assert.deepEqual(chartData([{ at: 1000, value: 0 }], 2000, 60000), [[1000], [0]]);
  assert.deepEqual(chartData([{ at: 1000, value: 72 }, { at: 2000, value: 72 }], 2000, 60000)[1], [72, 72]);
});

test('RR display retains multiple beat intervals per second without converting their millisecond values', () => {
  const history = [];
  for (const [at, value] of [[100, 800], [500, 850], [900, 820]]) appendTrend(history, at, value, { everyMs: 0, maxPoints: 8000 });
  assert.equal(history.length, 3);
  assert.deepEqual(chartData(history, 1000, 60000)[1], [800, 850, 820]);
});

test('RR timeline plots every reported interval and reanchors after contact loss or a gap', () => {
  const history = [], clock = {};
  appendRRTrend(history, { contact: true, rrMs: [1000, 500] }, 1500, clock);
  assert.deepEqual(history, [{ at: 1000, value: 1000 }, { at: 1500, value: 500 }]);
  appendRRTrend(history, { contact: null, rrMs: [800] }, 2300, clock);
  assert.deepEqual(history.at(-1), { at: 2300, value: 800 });
  appendRRTrend(history, { contact: false, rrMs: [1000] }, 3300, clock);
  assert.equal(history.length, 3);
  appendRRTrend(history, { contact: true, rrMs: [900] }, 4300, clock);
  assert.deepEqual(history.at(-1), { at: 4300, value: 900 });
  appendRRTrend(history, { contact: true, rrMs: [1000] }, 12000, clock);
  assert.deepEqual(history.at(-1), { at: 12000, value: 1000 });
  const before = history.length;
  appendRRTrend(history, { contact: true, rrMs: [0, NaN] }, 13000, clock);
  assert.equal(history.length, before);
});

test('raw RR graph history remains bounded without downsampling intervals', () => {
  const history = [], clock = {};
  for (let i = 1; i <= 32000; i++) appendRRTrend(history, { contact: true, rrMs: [100] }, i * 100, clock);
  assert.equal(history.length, 24001);
  assert.equal(history.at(-1).at, 3200000);
});
