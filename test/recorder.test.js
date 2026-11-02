import test from 'node:test';
import assert from 'node:assert/strict';
import { Recorder, csv, csvCell } from '../src/recorder.js';
function setup() {
  const records = [], files = new Map(); let fail = false, failJournal = false;
  const journal = { add: async (session, value) => { if (failJournal) throw new Error('quota exceeded'); records.push({ session, value }); } };
  const directory = {
    getDirectoryHandle: async () => directory,
    getFileHandle: async name => ({ createWritable: async () => {
      let data;
      return { write: async value => { if (fail) throw new Error('disk unavailable'); data = value; }, close: async () => files.set(name, data), abort: async () => {} };
    } })
  };
  return { recorder: new Recorder(journal), records, files, directory, diskFailure: b => { fail = b; }, journalFailure: b => { failJournal = b; } };
}
const sample = n => ({ type: 'measurement', row: { sequence: n, label: 'P01', heart_rate_bpm: 70 } });
test('CSV handles commas, quotes, newlines, and spreadsheet injection', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(null), '');
  assert.match(csv([{ label: 'P,01', heart_rate_bpm: 80 }]), /"P,01"/);
});
test('serial journal preserves order; folder contains closed CSV and event chunks', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 's1' });
  s.recorder.enqueue(sample(1)); s.recorder.enqueue({ type: 'event', kind: 'label_changed' }); s.recorder.enqueue(sample(2));
  await s.recorder.stop();
  assert.equal(s.recorder.count, 2); assert.equal(s.recorder.pending.length, 0);
  assert.deepEqual(s.records.map(r => r.value.type), ['session', 'measurement', 'event', 'measurement']);
  assert.match(s.files.get('measurements-000001.csv'), /P01/);
  assert.equal(JSON.parse(s.files.get('events-000001.jsonl')).kind, 'label_changed');
  assert.equal(JSON.parse(s.files.get('session.json')).session_id, 's1');
});
test('failed folder writes retain the batch and recovery; retry produces a single part', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 's1' }); s.diskFailure(true);
  s.recorder.enqueue(sample(1)); await s.recorder.flush();
  assert.equal(s.recorder.pending.length, 1); assert.equal(s.recorder.part, 0); assert.match(s.recorder.diskError, /disk unavailable/);
  s.recorder.enqueue(sample(2)); s.diskFailure(false); await s.recorder.stop();
  assert.equal(s.recorder.pending.length, 0); assert.equal(s.recorder.diskError, null); assert.equal(s.recorder.part, 1);
  assert.equal(s.files.get('measurements-000001.csv').trim().split('\r\n').length, 3);
  assert.equal(s.records.filter(r => r.value.type === 'measurement').length, 2);
});
test('journal failure is surfaced but folder recording continues', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 's1' }); s.journalFailure(true);
  s.recorder.enqueue(sample(1)); await s.recorder.stop();
  assert.match(s.recorder.journalError, /quota exceeded/); assert.match(s.files.get('measurements-000001.csv'), /P01/);
});
test('recording requires a folder and cannot silently fall back to browser-only storage', async () => {
  const s = setup();
  await assert.rejects(s.recorder.start(null, { session_id: 's1' }), /output folder/);
  assert.equal(s.recorder.active, false); assert.equal(s.records.length, 0);
});
test('48 monitors over 60 seconds persist all 2880 measurements across bounded parts', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 'load' });
  for (let sec = 0; sec < 60; sec++) for (let device = 0; device < 48; device++) s.recorder.enqueue({ type: 'measurement', row: { ...sample(sec * 48 + device).row, device_id: `device-${device}` } });
  await s.recorder.stop();
  assert.equal(s.recorder.count, 2880); assert.equal(s.recorder.part, 6);
  const lines = [...s.files.entries()].filter(([k]) => k.endsWith('.csv')).flatMap(([,v]) => v.trim().split('\r\n').slice(1));
  assert.equal(lines.length, 2880); assert.equal(new Set(lines.map(line => line.split(',')[1])).size, 2880);
});

test('a new session cannot discard pending writes from a failed session', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 's1' });
  s.diskFailure(true); s.recorder.enqueue(sample(1)); await s.recorder.stop();
  await assert.rejects(s.recorder.start(s.directory, { session_id: 's2' }), /pending folder writes/);
  assert.equal(s.recorder.id, 's1'); assert.equal(s.recorder.pending.length, 1);
});
