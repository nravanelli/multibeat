import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorDisplay } from '../src/device-state.js';

const connected = { status: 'connected', connectionStarted: 100, connectedAt: 200, hasConnected: true, last: { at: 300 } };

test('a silent monitor becomes offline after five seconds and becomes live on new data', () => {
  assert.equal(monitorDisplay(connected, 5300).text, 'LIVE');
  const offline = monitorDisplay(connected, 5301);
  assert.equal(offline.text, 'OFFLINE'); assert.equal(offline.live, false);
  assert.match(offline.note, /Bluetooth still connected/);
  const returned = monitorDisplay({ ...connected, last: { at: 5400 } }, 5400);
  assert.equal(returned.offline, false); assert.equal(returned.live, true);
});
test('disconnected cards stay offline throughout reconnection, even with a recent old reading', () => {
  for (const status of ['disconnected', 'reconnecting', 'connecting', 'permission', 'paused']) {
    const d = { ...connected, status };
    const display = monitorDisplay(d, 400);
    assert.equal(display.text, 'OFFLINE'); assert.equal(display.live, false);
    assert.deepEqual(d.last, { at: 300 }, 'last-reading data must be retained');
  }
  assert.match(monitorDisplay({ ...connected, status: 'reconnecting' }, 400).note, /reconnecting automatically/);
});
test('a new link gets a first-reading grace period, then reports offline if nothing arrives', () => {
  const d = { ...connected, last: null };
  assert.equal(monitorDisplay(d, 5200).text, 'WAITING');
  assert.equal(monitorDisplay(d, 5201).text, 'OFFLINE');
});
test('reconnecting cannot make a previous connection’s reading look live', () => {
  const d = { ...connected, connectionStarted: 400, connectedAt: 450 };
  assert.equal(monitorDisplay(d, 500).text, 'WAITING');
  assert.equal(monitorDisplay(d, 5451).text, 'OFFLINE');
  assert.equal(monitorDisplay({ ...d, last: { at: 5460 } }, 5460).text, 'LIVE');
});
test('the first notification can precede subscription completion and still be live', () => {
  assert.equal(monitorDisplay({ ...connected, connectedAt: 400 }, 450).text, 'LIVE');
});
test('initial connection, explicit pause, permissions, and simulation have distinct feedback', () => {
  assert.equal(monitorDisplay({ status: 'connecting' }, 100).text, 'CONNECTING');
  assert.equal(monitorDisplay({ status: 'paused', manuallyPaused: true }, 100).note, 'Monitor paused');
  assert.match(monitorDisplay({ status: 'permission' }, 100).note, /permission needed/);
  assert.equal(monitorDisplay({ ...connected, simulated: true }, 400).text, 'SIMULATED');
});

test('a silent-link refresh is explained on the offline row', () => {
  const display = monitorDisplay({ ...connected, status: 'reconnecting', reconnectReason: 'no_data' }, 16000);
  assert.equal(display.text, 'OFFLINE');
  assert.match(display.note, /No readings.*reconnecting automatically/);
});
