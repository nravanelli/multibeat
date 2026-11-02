import test from 'node:test';
import assert from 'node:assert/strict';
import { ReconnectingMonitor } from '../src/bluetooth.js';

function setup(subscribeFn) {
  const timers = new Map(), delays = [], states = []; let nextId = 0;
  const manager = new ReconnectingMonitor({}, {
    subscribeFn, onState: state => states.push(state),
    schedule: (fn, delay) => { const id = ++nextId; timers.set(id, fn); delays.push(delay); return id; },
    cancel: id => timers.delete(id)
  });
  return { manager, timers, delays, states, async next() {
    const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); await manager.attempt;
  } };
}
test('out-of-range monitors keep retrying beyond initial failures, with bounded backoff', async () => {
  let attempts = 0;
  const s = setup(async () => { if (++attempts < 10) throw new Error('out of range'); return () => {}; });
  await s.manager.start();
  for (let i = 0; i < 9; i++) await s.next();
  assert.equal(attempts, 10); assert.equal(s.manager.state, 'connected');
  assert.deepEqual(s.delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  assert.equal(s.timers.size, 0); await s.manager.stop();
});
test('a disconnect schedules a single fresh subscription and pause cancels reconnection', async () => {
  let lost, subscriptions = 0, cleanup = 0;
  const s = setup(async (device, onSample, onDisconnect) => { subscriptions++; lost = onDisconnect; return () => cleanup++; });
  await s.manager.start(); lost(); lost();
  assert.equal(s.timers.size, 1);
  await s.next(); assert.equal(subscriptions, 2); assert.equal(cleanup, 1);
  lost(); await s.manager.stop();
  assert.equal(s.timers.size, 0); assert.equal(s.manager.state, 'paused');
});
test('concurrent requests to reconnect do not create overlapping subscriptions', async () => {
  let release, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const s = setup(async () => { calls++; await pending; return () => {}; });
  const first = s.manager.start(), second = s.manager.start(); release();
  await Promise.all([first, second]);
  assert.equal(calls, 1); await s.manager.stop();
});
test('permission errors stop retries and can be retried after user restores access', async () => {
  let denied = true;
  const s = setup(async () => { if (denied) throw new DOMException('Permission revoked', 'SecurityError'); return () => {}; });
  await s.manager.start();
  assert.equal(s.manager.state, 'permission'); assert.equal(s.timers.size, 0);
  denied = false; await s.manager.start();
  assert.equal(s.manager.state, 'connected'); await s.manager.stop();
});
test('pause during a connection attempt discards a late result without scheduling retries', async () => {
  let release, cleaned = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const s = setup(async () => { await pending; return () => cleaned++; });
  const connecting = s.manager.start(); const stopping = s.manager.stop(); release();
  await Promise.all([connecting, stopping]);
  assert.equal(s.manager.state, 'paused'); assert.equal(cleaned, 1); assert.equal(s.timers.size, 0);
});
