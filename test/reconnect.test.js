import test from 'node:test';
import assert from 'node:assert/strict';
import { ReconnectingMonitor, NO_DATA_RECOVERY_MS, BLUETOOTH_CONNECT_TIMEOUT_MS, BLUETOOTH_STEP_TIMEOUT_MS, pairingRequestOptions } from '../src/bluetooth.js';

test('new HRM pairing excludes known names while Find again requires the target name and heart-rate service', () => {
  const devices = [{ name: 'Strap A' }, { name: 'Strap A' }, { name: '' }, null, { name: 'Strap B' }];
  assert.deepEqual(pairingRequestOptions(devices), {
    filters: [{ services: ['heart_rate'] }], exclusionFilters: [{ name: 'Strap A' }, { name: 'Strap B' }]
  });
  assert.deepEqual(pairingRequestOptions(devices, { name: 'Strap A' }), { filters: [{ services: ['heart_rate'], name: 'Strap A' }] });
  assert.deepEqual(pairingRequestOptions([]), { filters: [{ services: ['heart_rate'] }] });
});

test('Find again for an unnamed strap keeps the HRM filter without excluding existing devices', () => {
  const devices = [{ name: 'Other strap' }];
  for (const target of [{}, { name: '' }, { name: null }]) {
    assert.deepEqual(pairingRequestOptions(devices, target), { filters: [{ services: ['heart_rate'] }] });
  }
});

function setup(subscribeFn, device = {}) {
  const timers = new Map(), delays = [], states = []; let nextId = 0;
  const manager = new ReconnectingMonitor(device, {
    onLog: () => {},
    subscribeFn, onState: (state, detail) => { states.push(state); if (state === 'reconnecting') delays.push(detail.delay); },
    schedule: (fn, delay) => { const id = ++nextId; timers.set(id, fn); return id; },
    cancel: id => timers.delete(id)
  });
  return { manager, timers, delays, states, async next() {
    const id = manager.timer; const fn = timers.get(id); timers.delete(id); fn(); await manager.attempt;
  } };
}

test('an advertisement from a returning strap reconnects before the backoff expires', async () => {
  const device = new EventTarget(); let signal, attempts = 0, lost;
  device.watchAdvertisements = async options => { signal = options.signal; };
  const s = setup(async (device, sample, disconnected) => {
    if (++attempts === 1) throw new DOMException('No longer in range', 'NetworkError');
    lost = disconnected; return () => {};
  }, device);
  await s.manager.start();
  assert.equal(s.manager.state, 'reconnecting'); assert.ok(signal); assert.equal(signal.aborted, false);
  device.dispatchEvent(new Event('advertisementreceived'));
  device.dispatchEvent(new Event('advertisementreceived'));
  await s.manager.attempt;
  assert.equal(attempts, 2); assert.equal(signal.aborted, true);
  assert.equal(s.manager.state, 'connected'); assert.equal(s.manager.timer, null);
  assert.equal(s.timers.size, 1, 'only the notification watchdog remains');
  lost(); assert.equal(signal.aborted, false, 'a subsequent dropout starts watching again');
  await s.manager.stop(); assert.equal(signal.aborted, true);
});

test('pausing cancels a pending advertisement watch and late results cannot reconnect', async () => {
  const device = new EventTarget(); let signal, release, attempts = 0;
  device.watchAdvertisements = options => { signal = options.signal; return new Promise(resolve => { release = resolve; }); };
  const s = setup(async () => { attempts++; throw new Error('Absent'); }, device);
  await s.manager.start(); await s.manager.stop();
  assert.equal(signal.aborted, true); assert.equal(s.timers.size, 0);
  release(); await Promise.resolve();
  device.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(attempts, 1); assert.equal(s.manager.state, 'paused');
});

test('a rejected advertisement API keeps normal retry recovery available', async () => {
  const device = new EventTarget(); let watches = 0, attempts = 0;
  device.watchAdvertisements = async () => { watches++; throw new DOMException('Unavailable', 'NotSupportedError'); };
  const s = setup(async () => { if (++attempts < 3) throw new Error('Absent'); return () => {}; }, device);
  await s.manager.start(); await s.next(); await s.next();
  assert.equal(watches, 1); assert.equal(s.manager.state, 'connected');
  assert.deepEqual(s.delays, [1000, 2000]);
  await s.manager.stop(); assert.equal(s.timers.size, 0);
});

test('timed retries continue when an advertisement watch never becomes ready', async () => {
  const device = new EventTarget(); let signal, attempts = 0;
  device.watchAdvertisements = options => { signal = options.signal; return new Promise(() => {}); };
  const s = setup(async () => { if (++attempts === 1) throw new Error('Absent'); return () => {}; }, device);
  await s.manager.start(); await s.next();
  assert.equal(attempts, 2); assert.equal(signal.aborted, true);
  assert.equal(s.manager.state, 'connected');
  await s.manager.stop();
});
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
    onLog: () => {},
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
    onLog: () => {},
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

test('pause settles even when a subscription never resolves, and resume can connect', async () => {
  let calls = 0;
  const s = setup(() => ++calls === 1 ? new Promise(() => {}) : Promise.resolve(() => {}));
  const connecting = s.manager.start();
  await s.manager.stop(); await connecting;
  assert.equal(s.manager.attempt, null);
  await s.manager.start();
  assert.equal(s.manager.state, 'connected'); assert.equal(calls, 2);
  await s.manager.stop(); assert.equal(s.timers.size, 0);
});

for (const hungStage of ['gatt.connect', 'getPrimaryService', 'getCharacteristic', 'startNotifications']) {
  test(`a hung ${hungStage} times out, retries, and ignores its late completion`, async () => {
    const timers = new Map(), logs = [];
    let id = 0, blocked = true, release, disconnects = 0, samples = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const characteristic = new EventTarget();
    const gate = async (stage, result) => { if (blocked && stage === hungStage) await pending; return result; };
    characteristic.startNotifications = () => gate('startNotifications', characteristic);
    const service = { getCharacteristic: () => gate('getCharacteristic', characteristic) };
    const server = { getPrimaryService: () => gate('getPrimaryService', service) };
    const device = new EventTarget(); device.id = 'synthetic';
    device.gatt = { connect: () => gate('gatt.connect', server), disconnect: () => disconnects++ };
    const manager = new ReconnectingMonitor(device, {
      onLog: entry => logs.push(entry), onSample: () => samples++,
      schedule: (fn, delay) => { const key = ++id; timers.set(key, { fn, delay }); return key; },
      cancel: key => timers.delete(key)
    });
    const connecting = manager.start();
    for (let i = 0; i < 50 && !logs.some(e => e.stage === hungStage); i++) await Promise.resolve();
    assert.equal(logs.at(-1).stage, hungStage);
    const limit = hungStage === 'gatt.connect' ? BLUETOOTH_CONNECT_TIMEOUT_MS : BLUETOOTH_STEP_TIMEOUT_MS;
    const timeout = [...timers.values()].find(t => t.delay === limit);
    assert.ok(timeout); timeout.fn(); await connecting;
    assert.equal(manager.state, 'reconnecting');
    assert.ok(logs.some(e => e.error === 'TimeoutError' && e.message.includes(hungStage)));
    blocked = false;
    const retry = timers.get(manager.timer); timers.delete(manager.timer); retry.fn(); await manager.attempt;
    assert.equal(manager.state, 'connected');
    const before = disconnects;
    release(); for (let i = 0; i < 20; i++) await Promise.resolve();
    characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    assert.equal(samples, 1, 'only the fresh subscription receives the notification');
    assert.equal(disconnects, before, 'old completion cannot disconnect the new subscription');
    await manager.stop(); assert.equal(timers.size, 0);
  });
}

test('a slow native connection can finish after 30 seconds without the former 15-second cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release, disconnects = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const characteristic = new EventTarget(); characteristic.startNotifications = async () => characteristic;
  const server = { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) };
  const device = new EventTarget();
  device.gatt = { connect: () => pending, disconnect: () => disconnects++ };
  const logs = [];
  const manager = new ReconnectingMonitor(device, { onLog: entry => logs.push(entry) });
  t.after(() => manager.stop());
  const connecting = manager.start();
  t.mock.timers.tick(30000);
  assert.equal(manager.state, 'connecting'); assert.equal(disconnects, 0);
  assert.ok(logs.some(e => e.status === 'still_pending' && e.stage === 'gatt.connect'));
  assert.ok(logs.some(e => e.status === 'started' && e.timeout_ms === 60000));
  release(server); await connecting;
  assert.equal(manager.state, 'connected');
  await manager.stop();
});
