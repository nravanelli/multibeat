import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureSession } from '../src/capture.js';
import { Recorder } from '../src/recorder.js';
import { ReconnectingMonitor } from '../src/bluetooth.js';

const sample = { bpm: 72, contact: true, energy: null, rr: [1024], rrMs: [1000] };
const device = { id: 'one', name: 'HRM', label: 'P01', simulated: false };
function setup() {
  const records = [], files = new Map(); let starts = 0;
  const journal = { add: async (session, value) => records.push({ session, value }) };
  const directory = { name: 'output', getDirectoryHandle: async () => directory,
    getFileHandle: async name => ({ createWritable: async () => {
      let data; return { write: async value => { data = value; }, close: async () => files.set(name, data), abort: async () => {} };
    } }) };
  const recorder = new Recorder(journal);
  const capture = new CaptureSession(recorder, { metadata: () => ({ session_id: `session-${++starts}` }) });
  return { capture, recorder, directory, records, files };
}
test('capture cannot be enabled or started without an output folder', async () => {
  const { capture, records } = setup();
  assert.throws(() => capture.resume(), /output folder/);
  await assert.rejects(capture.prepare(), /output folder/);
  assert.equal(capture.measurement(device, sample), false);
  assert.equal(records.length, 0);
});
test('concurrent monitors share one automatic session and capture their first samples', async () => {
  const s = setup(); s.capture.setDirectory(s.directory); s.capture.resume();
  assert.equal(s.records.length, 0, 'Choosing a folder alone should not start recording');
  const managers = Array.from({ length: 32 }, (_, i) => {
    const d = { ...device, id: `hrm-${i}` };
    return new ReconnectingMonitor(d, {
      beforeNotifications: () => s.capture.prepare(),
      onSample: () => s.capture.measurement(d, sample),
      subscribeFn: async (device, onSample, onDisconnect, { beforeNotifications }) => {
        await beforeNotifications();
        onSample(); // A monitor may notify before startNotifications() resolves.
        return () => {};
      }
    });
  });
  await Promise.all(managers.map(manager => manager.start()));
  await s.recorder.tail;
  assert.equal(s.records.filter(r => r.value.type === 'session').length, 1);
  const rows = s.records.filter(r => r.value.type === 'measurement').map(r => r.value.row);
  assert.equal(rows.length, 32); assert.equal(new Set(rows.map(r => r.device_id)).size, 32);
  assert.deepEqual(rows.map(r => r.sequence), Array.from({ length: 32 }, (_, i) => i + 1));
  await Promise.all(managers.map(manager => manager.stop())); await s.capture.pause();
});
test('a returning monitor continues the same session and measurement sequence', async () => {
  const s = setup(); s.capture.setDirectory(s.directory); s.capture.resume();
  let lost, retry;
  const manager = new ReconnectingMonitor(device, {
    beforeNotifications: () => s.capture.prepare(), onSample: () => s.capture.measurement(device, sample),
    schedule: fn => { retry = fn; return 1; }, cancel: () => {},
    subscribeFn: async (device, onSample, onDisconnect, { beforeNotifications }) => {
      lost = onDisconnect; await beforeNotifications(); onSample(); return () => {};
    }
  });
  await manager.start(); lost(); retry(); await manager.attempt;
  await s.capture.pause(); await manager.stop();
  const rows = s.records.filter(r => r.value.type === 'measurement');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => [r.session, r.value.row.sequence]), [['session-1', 1], ['session-1', 2]]);
});
test('pause during output setup prevents capture and waits for setup to settle', async () => {
  const s = setup(); let release;
  const deferred = new Promise(resolve => { release = resolve; });
  s.directory.getDirectoryHandle = async () => { await deferred; return s.directory; };
  s.capture.setDirectory(s.directory); s.capture.resume();
  const preparing = s.capture.prepare(); const rejected = assert.rejects(preparing, { name: 'AbortError' });
  const paused = s.capture.pause(); release(); await Promise.all([rejected, paused]);
  assert.equal(s.capture.recording, false); assert.equal(s.recorder.active, false);
  assert.equal(s.capture.measurement(device, sample), false);
});
test('a failed folder setup disables capture until explicitly resumed', async () => {
  const s = setup(); s.directory.getDirectoryHandle = async () => { throw new Error('permission revoked'); };
  s.capture.setDirectory(s.directory); s.capture.resume();
  await assert.rejects(s.capture.prepare(), /permission revoked/);
  assert.equal(s.capture.enabled, false); assert.equal(s.recorder.active, false);
  assert.equal(s.capture.measurement(device, sample), false);
});
test('pause drains files; resume prepares a new session with fresh labels and sequence', async () => {
  const s = setup(); s.capture.setDirectory(s.directory); s.capture.resume(); await s.capture.prepare();
  s.capture.measurement(device, sample); await s.capture.pause();
  assert.equal(s.capture.measurement(device, sample), false);
  assert.match(s.files.get('measurements-000001.csv'), /P01/);
  s.capture.resume(); await s.capture.prepare();
  s.capture.measurement({ ...device, label: 'P02' }, sample); await s.capture.pause();
  const rows = s.records.filter(r => r.value.type === 'measurement');
  assert.deepEqual(rows.map(r => [r.session, r.value.row.sequence, r.value.row.label]), [['session-1', 1, 'P01'], ['session-2', 1, 'P02']]);
});
