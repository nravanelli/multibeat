import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDeviceOrder, moveDevice } from '../src/device-order.js';

test('saved order validates IDs, removes duplicates and tolerates unavailable settings', () => {
  const storage = value => ({ getItem: () => value });
  assert.deepEqual(loadDeviceOrder(storage('["b","a","b","not-yet-restored"]')), ['b', 'a', 'not-yet-restored']);
  for (const value of [null, '{', '{}', '[1]', '[""]']) assert.deepEqual(loadDeviceOrder(storage(value)), []);
  assert.deepEqual(loadDeviceOrder({ getItem() { throw new Error('denied'); } }), []);
});

test('drag and keyboard moves preserve all IDs and move forwards and backwards without mutating input', () => {
  const original = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveDevice(original, 'a', 'c'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveDevice(original, 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(original, ['a', 'b', 'c', 'd']);
  for (const [id, target] of [['a', 'a'], ['missing', 'b'], ['a', 'missing']]) assert.equal(moveDevice(original, id, target), original);
});
