import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureSession } from '../src/capture.js';
import { Recorder, COLUMNS } from '../src/recorder.js';
import { ReconnectingMonitor } from '../src/bluetooth.js';
import { memoryDirectory } from '../test-support/memory-directory.js';

const sample = { bpm: 72, contact: true, energy: null, rr: [1024], rrMs: [1000] };
const device = { id: 'one', name: 'HRM', label: 'P01', simulated: false };
function setup() {
  let starts = 0;
  const { directory, files, text } = memoryDirectory();
  const recorder = new Recorder();
  const capture = new CaptureSession(recorder, { metadata: () => ({ session_id: `session-${++starts}` }) });
  return { capture, recorder, directory, files, text,
    // Read actual output files; these fixtures use simple, comma-free field values.
    get records() {
      const records = [];
      for (const path of files.keys()) {
        const session = path.split('/')[0];
        if (path.endsWith('/session.json')) records.push({ session, value: { type: 'session', ...JSON.parse(text(path)) } });
        if (!path.endsWith('/measurements.csv')) continue;
        for (const line of text(path).trim().split('\r\n').slice(1)) {
          const values = line.split(',');
          const row = Object.fromEntries(COLUMNS.map((key, i) => {
            const raw = values[i];
            const value = key === 'contact_detected' ? raw === '' ? null : raw === 'true' :
              ['sequence', 'elapsed_ms', 'heart_rate_bpm', 'energy_expended_kj'].includes(key) ? raw === '' ? null : Number(raw) : raw;
            return [key, value];
          }));
          records.push({ session, value: { type: 'measurement', row } });
        }
      }
      return records;
    }
  };
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
      onLog: () => {},
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
  await s.recorder.flush();
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
    onLog: () => {},
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
  assert.match(s.text('session-1/measurements.csv'), /P01/);
  s.capture.resume(); await s.capture.prepare();
  s.capture.measurement({ ...device, label: 'P02' }, sample); await s.capture.pause();
  const rows = s.records.filter(r => r.value.type === 'measurement');
  assert.deepEqual(rows.map(r => [r.session, r.value.row.sequence, r.value.row.label]), [['session-1', 1, 'P01'], ['session-2', 1, 'P02']]);
});

test('participant label changes are saved on subsequent CSV rows without rewriting earlier rows', async () => {
  const s = setup(); s.capture.setDirectory(s.directory); s.capture.resume(); await s.capture.prepare();
  const participant = { ...device, label: 'P01' };
  s.capture.measurement(participant, sample);
  participant.label = 'P02';
  s.capture.measurement(participant, sample);
  await s.capture.pause();
  const rows = s.records.filter(r => r.value.type === 'measurement').map(r => r.value.row);
  assert.deepEqual(rows.map(r => r.label), ['P01', 'P02']);
  assert.match(s.text('session-1/measurements.csv'), /P01/);
  assert.match(s.text('session-1/measurements.csv'), /P02/);
});

test('silent-link recovery keeps the recording session, participant label, and CSV sequence', async () => {
  const s = setup(); s.capture.setDirectory(s.directory); s.capture.resume();
  const timers = new Map(); let id = 0;
  const manager = new ReconnectingMonitor(device, {
    onLog: () => {},
    beforeNotifications: () => s.capture.prepare(), onSample: () => s.capture.measurement(device, sample),
    schedule: fn => { const key = ++id; timers.set(key, fn); return key; }, cancel: key => timers.delete(key),
    subscribeFn: async (device, onSample, onDisconnect, { beforeNotifications }) => {
      await beforeNotifications(); onSample(); return () => {};
    }
  });
  await manager.start(); await s.recorder.flush();
  const watchdog = timers.get(manager.watchdogTimer); timers.delete(manager.watchdogTimer); watchdog();
  const retry = timers.get(manager.timer); timers.delete(manager.timer); retry(); await manager.attempt;
  await manager.stop(); await s.capture.pause();
  const rows = s.records.filter(r => r.value.type === 'measurement').map(r => r.value.row);
  assert.deepEqual(rows.map(row => [row.session_id, row.sequence, row.label]), [['session-1', 1, 'P01'], ['session-1', 2, 'P01']]);
  assert.equal(s.text('session-1/measurements.csv').trim().split('\r\n').length, 3);
  assert.equal(s.records.filter(r => r.value.type === 'session').length, 1);
});

test('raw HR/RR capture preserves optional values and contact states without derived fields', async () => {
  const s = setup(); s.capture.setDirectory(s.directory); s.capture.resume(); await s.capture.prepare();
  for (const contact of [true, false, null]) s.capture.measurement(device, { ...sample, contact, rr: [1024, 512], rrMs: [1000, 500], energy: 7 });
  await s.capture.pause();
  const rows = s.records.filter(r => r.value.type === 'measurement').map(r => r.value.row);
  assert.deepEqual(rows.map(r => r.contact_detected), [true, false, null]);
  for (const row of rows) {
    assert.equal(row.rr_ticks_1024, '1024;512'); assert.equal(row.rr_ms, '1000;500');
    assert.equal(row.energy_expended_kj, 7); assert.equal(row.heart_rate_bpm, 72);
    assert.equal(Object.keys(row).length, 13);
  }
  const lines = s.text('session-1/measurements.csv').trim().split('\r\n');
  assert.equal(lines[0], 'session_id,sequence,received_utc,elapsed_ms,device_id,device_name,label,simulated,heart_rate_bpm,contact_detected,energy_expended_kj,rr_ticks_1024,rr_ms');
  assert.equal(lines.length, 4);
});
