import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeBluetoothFeatures, heartRateRange, DisconnectEpisodes, DisconnectSound, WriteErrorAlert } from '../src/dashboard-options.js';

test('Chrome status checks API exposure without inferring a flag setting', () => {
  const nav = { userAgentData: { brands: [{ brand: 'Google Chrome' }] }, bluetooth: { getDevices() {} } };
  assert.deepEqual(chromeBluetoothFeatures(nav, class { watchAdvertisements() {} }), { chrome: true, restore: true, advertisements: true });
  assert.deepEqual(chromeBluetoothFeatures({ userAgent: 'Chrome/140' }), { chrome: true, restore: false, advertisements: false });
  for (const userAgent of ['Chrome/140 Edg/140', 'Chrome/140 OPR/140', 'Safari/605']) assert.equal(chromeBluetoothFeatures({ userAgent }).chrome, false);
});

test('requested resting HR bands include boundaries and never colour stale readings', () => {
  for (const bpm of [60, 100]) assert.equal(heartRateRange(bpm, true).state, 'normal');
  assert.equal(heartRateRange(59, true).state, 'low');
  assert.equal(heartRateRange(101, true).state, 'high');
  for (const bpm of [59, 101, undefined, NaN]) assert.equal(heartRateRange(bpm, false).state, 'unavailable');
});

test('outage dismissal covers current straps, allows new outages and rearms after recovery', () => {
  const episodes = new DisconnectEpisodes();
  assert.deepEqual(episodes.update(['a']), ['a']);
  episodes.dismiss();
  assert.deepEqual(episodes.update(['a']), []);
  assert.deepEqual(episodes.update(['a', 'b']), ['b']);
  episodes.dismiss();
  assert.deepEqual(episodes.update(['b']), []);
  assert.deepEqual(episodes.update(['a', 'b']), ['a']);
  episodes.update([]); // capture pause/recovery clears current outages
  assert.deepEqual(episodes.update(['b']), ['b']);
});

test('stopping sound cancels scheduled voices; teardown blocks later playback', async t => {
  let stopped = 0, closed = 0, started = 0;
  class AudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; }
    async resume() {}
    async close() { closed++; }
    createOscillator() { return { frequency: {}, connect() {}, disconnect() {}, start() { started++; }, stop() { stopped++; } }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  t.mock.method(globalThis, 'setInterval', () => 123);
  t.mock.method(globalThis, 'clearInterval', () => {});
  const original = globalThis.AudioContext;
  globalThis.AudioContext = AudioContext;
  try {
    const sound = new DisconnectSound(message => assert.fail(message));
    await sound.select('ring');
    sound.play();
    const scheduledStops = stopped;
    sound.update(false);
    assert.equal(stopped, scheduledStops, 'dashboard refresh preserves a built-in preview');
    sound.stop(); started = 0; stopped = 0;
    sound.update(true);
    assert.equal(started, 4);
    sound.update(true); assert.equal(started, 4, 'render ticks do not start overlapping tones');
    sound.stop(); assert.equal(stopped, 8, 'all four scheduled oscillators stopped immediately');
    sound.update(true); assert.equal(started, 8);
    sound.destroy(); assert.equal(closed, 1);
    sound.update(true); sound.play(); assert.equal(started, 8);
  } finally { if (original === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = original; }
});

test('custom audio preview plays the selected clip and survives dashboard refreshes without an outage', async t => {
  const original = globalThis.Audio;
  let played = 0, paused = 0, source;
  globalThis.Audio = class {
    constructor(url) { source = url; this.currentTime = 12; }
    play() { played++; return Promise.resolve(); }
    pause() { paused++; }
    removeAttribute() {}
    load() {}
  };
  let clipTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { assert.equal(delay, 4000); clipTimeout = callback; return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  try {
    const sound = new DisconnectSound(message => assert.fail(message));
    sound.setFile(new Blob(['synthetic audio fixture'], { type: 'audio/wav' }));
    await sound.select('custom');
    sound.play();
    const pausesBeforeRefresh = paused;
    assert.ok(source.startsWith('blob:'), 'uses the chosen local clip');
    assert.equal(played, 1);
    assert.equal(sound.audio.currentTime, 0, 'preview starts at the beginning');
    sound.update(false); sound.update(false);
    assert.equal(paused, pausesBeforeRefresh, 'inactive alert updates do not stop a preview');
    clipTimeout(); assert.equal(paused, pausesBeforeRefresh + 1, 'custom clip playback remains bounded');
    sound.destroy();
  } finally { if (original === undefined) delete globalThis.Audio; else globalThis.Audio = original; }
});

test('write alert dismissal persists across repeated failures and rearms only after success', () => {
  const alert = new WriteErrorAlert();
  alert.update(null); assert.equal(alert.active, false);
  alert.update('disk unavailable'); assert.equal(alert.active, true);
  alert.dismiss(); assert.equal(alert.active, false); assert.equal(alert.failed, true);
  alert.update('disk unavailable'); assert.equal(alert.active, false);
  alert.update('permission denied'); assert.equal(alert.active, false, 'changed errors in one failing episode stay dismissed');
  alert.update(null); assert.equal(alert.failed, false);
  alert.update('disk unavailable'); assert.equal(alert.active, true);
});
