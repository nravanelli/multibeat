import test from 'node:test';
import assert from 'node:assert/strict';
import { ReconnectingMonitor, NO_DATA_RECOVERY_MS } from '../src/bluetooth.js';

function setup(subscribeFn) {
  const timers = new Map(), delays = [], states = []; let nextId = 0;
  const manager = new ReconnectingMonitor({}, {
    subscribeFn, onState: (state, detail) => { states.push(state); if (state === 'reconnecting') delays.push(detail.delay); },
    schedule: (fn, delay) => { const id = ++nextId; timers.set(id, fn); return id; },
    cancel: id => timers.delete(id)
  });
  return { manager, timers, delays, states, async next() {
    const id = manager.timer; const fn = timers.get(id); timers.delete(id); fn(); await manager.attempt;
  } };
}
test('out-of-range monitors keep retrying beyond initial failures, with bounded backoff', async () => {
  let attempts = 0;
  const s = setup(async () => { if (++attempts < 10) throw new Error('out of range'); return () => {}; });
  await s.manager.start();
  for (let i = 0; i < 9; i++) await s.next();
  assert.equal(attempts, 10); assert.equal(s.manager.state, 'connected');
  assert.deepEqual(s.delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  assert.equal(s.timers.size, 1, 'Only the no-data watchdog should remain'); await s.manager.stop();
  assert.equal(s.timers.size, 0);
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

function silentLink() {
  const callbacks = [], states = [], timers = new Map();
  let now = 0, id = 0, connections = 0, cleanup = 0, received = 0, available = true;
  const manager = new ReconnectingMonitor({}, {
    schedule: (fn, delay) => { const key = ++id; timers.set(key, { fn, due: now + delay }); return key; },
    cancel: key => timers.delete(key),
    onState: (state, detail) => states.push({ state, ...detail }),
    onSample: valid => { if (valid === false) return false; received++; return true; },
    subscribeFn: async (device, onSample) => {
      connections++;
      if (!available) throw new Error('Strap asleep');
      callbacks.push(onSample);
      return () => cleanup++;
    }
  });
  return {
    manager, states, timers, callbacks,
    available: value => { available = value; },
    counts: () => ({ connections, cleanup, received }),
    packet: valid => callbacks.at(-1)(valid),
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a,b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [key, timer] = next; now = timer.due; timers.delete(key); timer.fn();
        await manager.attempt;
      }
      now = target;
    }
  };
}

test('a connected but silent strap is disconnected and resubscribed automatically', async () => {
  const s = silentLink(); await s.manager.start(); s.packet();
  await s.advance(NO_DATA_RECOVERY_MS - 1);
  assert.equal(s.counts().connections, 1);
  await s.advance(1);
  assert.equal(s.manager.state, 'reconnecting'); assert.equal(s.counts().cleanup, 1);
  assert.equal(s.states.at(-1).reason, 'no_data');
  await s.advance(1000);
  assert.equal(s.counts().connections, 2); assert.equal(s.manager.state, 'connected');
  s.packet(); assert.equal(s.counts().received, 2);
  await s.manager.stop(); assert.equal(s.timers.size, 0);
});
test('a sleeping strap keeps retrying after the silent link is reset and reconnects when it wakes', async () => {
  const s = silentLink(); await s.manager.start(); s.packet(); s.available(false);
  await s.advance(NO_DATA_RECOVERY_MS + 7000); // Reset, then failed retries at 1, 3, and 7 seconds.
  assert.equal(s.manager.state, 'reconnecting'); assert.equal(s.counts().connections, 4);
  s.available(true); await s.advance(8000); s.packet();
  assert.equal(s.manager.state, 'connected'); assert.equal(s.counts().received, 2);
  await s.manager.stop();
});
test('valid readings reset the watchdog, while malformed notifications do not', async () => {
  const s = silentLink(); await s.manager.start();
  for (let i = 0; i < 20; i++) { await s.advance(1000); s.packet(); }
  assert.equal(s.counts().connections, 1);
  for (let i = 0; i < 14; i++) { await s.advance(1000); s.packet(false); }
  assert.equal(s.manager.state, 'connected');
  await s.advance(1000); assert.equal(s.manager.state, 'reconnecting');
  await s.manager.stop();
});
test('an explicit pause cancels silent-link recovery and ignores notifications from old subscriptions', async () => {
  const s = silentLink(); await s.manager.start(); s.packet();
  const previous = s.callbacks[0]; await s.manager.stop();
  await s.advance(NO_DATA_RECOVERY_MS * 3);
  assert.equal(s.counts().connections, 1); assert.equal(s.timers.size, 0);
  await s.manager.start();
  previous(); assert.equal(s.counts().received, 1, 'late old readings must be ignored');
  s.packet(); assert.equal(s.counts().received, 2);
  await s.manager.stop();
});

test('default timers use the browser global receiver for both retry and watchdog timers', async t => {
  const timers = new Map(); let id = 0, disconnected;
  t.mock.method(globalThis, 'setTimeout', function (fn) {
    assert.equal(this, globalThis, 'Browser timers reject an instance receiver with Illegal invocation');
    const key = ++id; timers.set(key, fn); return key;
  });
  t.mock.method(globalThis, 'clearTimeout', function (key) {
    assert.equal(this, globalThis); timers.delete(key);
  });
  const manager = new ReconnectingMonitor({}, {
    subscribeFn: async (device, onSample, onDisconnect) => { disconnected = onDisconnect; return () => {}; }
  });
  await manager.start();
  assert.equal(manager.state, 'connected'); assert.equal(timers.size, 1);
  disconnected();
  assert.equal(manager.state, 'reconnecting'); assert.equal(timers.size, 1);
  const retry = timers.get(manager.timer); timers.delete(manager.timer); retry(); await manager.attempt;
  assert.equal(manager.state, 'connected');
  await manager.stop(); assert.equal(timers.size, 0);
});
