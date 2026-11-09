import test from 'node:test';
import assert from 'node:assert/strict';
import { chartData, liveRange } from '../src/charts.js';

test('chart data retains raw values, inserts missing-data gaps, and does not mutate history', () => {
  const history = [{ at: 1000, value: 70 }, { at: 2000, value: 71 }, { at: 10000, value: 75 }];
  const before = structuredClone(history);
  assert.deepEqual(chartData(history, 10000, 10000), [[1000, 2000, 6000, 10000], [70, 71, null, 75]]);
  assert.deepEqual(history, before);
  assert.deepEqual(chartData(history, 10000, 5000), [[10000], [75]]);
  assert.deepEqual(chartData(history, 100000, 60000), [[], []]);
});

test('plot preparation orders reconstructed RR times and handles duplicate times without altering recordings', () => {
  const history = [{ at: 1500, value: 500.25 }, { at: 1000, value: 1000 }, { at: 1500, value: 501 }, { at: 2000, value: NaN }];
  assert.deepEqual(chartData(history, 2000, 60000), [[1000, 1500], [1000, 501]]);
  assert.equal(history.length, 4); assert.equal(history[0].value, 500.25);
});

test('zoom bounds always end at now and follow new readings while retaining the chosen duration', () => {
  assert.deepEqual(liveRange(60000, 60000, 30000), { min: 30000, max: 60000 });
  assert.deepEqual(liveRange(61000, 60000, 30000), { min: 31000, max: 61000 });
  assert.deepEqual(liveRange(60000, 60000, 600000), { min: 0, max: 60000 });
  assert.deepEqual(liveRange(60000, 60000, 100), { min: 59000, max: 60000 });
  assert.deepEqual(liveRange(60000, 60000, null), { min: 0, max: 60000 });
});
