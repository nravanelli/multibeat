import test from 'node:test';
import assert from 'node:assert/strict';
import { Recorder, csv, csvCell, CSV_HEADER } from '../src/recorder.js';
import { memoryDirectory } from '../test-support/memory-directory.js';
function setup() {
  const records = []; let fail = false, failJournal = false;
  const journal = { add: async (session, value) => { if (failJournal) throw new Error('quota exceeded'); records.push({ session, value }); } };
  const filesystem = memoryDirectory({ beforeOperation: operation => { if (fail && operation === 'write') throw new Error('disk unavailable'); } });
  return { recorder: new Recorder(journal), records, ...filesystem, diskFailure: b => { fail = b; }, journalFailure: b => { failJournal = b; } };
}
const sample = n => ({ type: 'measurement', row: { sequence: n, label: 'P01', heart_rate_bpm: 70 } });
test('CSV handles commas, quotes, newlines, and spreadsheet injection', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(null), '');
  assert.match(csv([{ label: 'P,01', heart_rate_bpm: 80 }]), /"P,01"/);
});
test('serial journal preserves order; folder contains one measurement CSV and one event log', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 's1' });
  s.recorder.enqueue(sample(1)); s.recorder.enqueue({ type: 'event', kind: 'label_changed' }); s.recorder.enqueue(sample(2));
  await s.recorder.stop();
  assert.equal(s.recorder.count, 2); assert.equal(s.recorder.pending.length, 0);
  assert.deepEqual(s.records.map(r => r.value.type), ['session', 'measurement', 'event', 'measurement']);
  assert.match(s.text('s1/measurements.csv'), /P01/);
  assert.equal(JSON.parse(s.text('s1/events.jsonl')).kind, 'label_changed');
  assert.equal(JSON.parse(s.text('s1/session.json')).session_id, 's1');
});
test('failed folder writes retain the batch and recovery; retry appends exactly once', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 's1' }); s.diskFailure(true);
  s.recorder.enqueue(sample(1)); await s.recorder.flush();
  assert.equal(s.recorder.pending.length, 1); assert.equal(s.recorder.savedBatches, 0); assert.match(s.recorder.diskError, /disk unavailable/);
  s.recorder.enqueue(sample(2)); s.diskFailure(false); await s.recorder.stop();
  assert.equal(s.recorder.pending.length, 0); assert.equal(s.recorder.diskError, null); assert.equal(s.recorder.savedBatches, 1);
  assert.equal(s.text('s1/measurements.csv').trim().split('\r\n').length, 3);
  assert.equal(s.records.filter(r => r.value.type === 'measurement').length, 2);
});
test('journal failure is surfaced but folder recording continues', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 's1' }); s.journalFailure(true);
  s.recorder.enqueue(sample(1)); await s.recorder.stop();
  assert.match(s.recorder.journalError, /quota exceeded/); assert.match(s.text('s1/measurements.csv'), /P01/);
});
test('recording requires a folder and cannot silently fall back to browser-only storage', async () => {
  const s = setup();
  await assert.rejects(s.recorder.start(null, { session_id: 's1' }), /output folder/);
  assert.equal(s.recorder.active, false); assert.equal(s.records.length, 0);
});
test('48 monitors over 60 seconds append all 2880 measurements to one CSV across bounded batches', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 'load' });
  for (let sec = 0; sec < 60; sec++) for (let device = 0; device < 48; device++) s.recorder.enqueue({ type: 'measurement', row: { ...sample(sec * 48 + device).row, device_id: `device-${device}` } });
  await s.recorder.stop();
  assert.equal(s.recorder.count, 2880); assert.equal(s.recorder.savedBatches, 6);
  assert.equal([...s.files.keys()].filter(k => k.endsWith('.csv')).length, 1);
  const lines = s.text('load/measurements.csv').trim().split('\r\n').slice(1);
  assert.equal(lines.length, 2880); assert.equal(new Set(lines.map(line => line.split(',')[1])).size, 2880);
});

test('a new session cannot discard pending writes from a failed session', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 's1' });
  s.diskFailure(true); s.recorder.enqueue(sample(1)); await s.recorder.stop();
  await assert.rejects(s.recorder.start(s.directory, { session_id: 's2' }), /pending folder writes/);
  assert.equal(s.recorder.id, 's1'); assert.equal(s.recorder.pending.length, 1);
});

test('successive saves append one CSV header and keep every prior reading', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 's1' });
  s.recorder.enqueue(sample(1)); await s.recorder.flush();
  const first = s.text('s1/measurements.csv');
  s.recorder.enqueue(sample(2)); await s.recorder.flush();
  s.recorder.enqueue(sample(3)); await s.recorder.stop();
  const final = s.text('s1/measurements.csv');
  assert.ok(final.startsWith(first));
  assert.equal(final, csv([sample(1).row, sample(2).row, sample(3).row]));
  assert.equal(final.split(CSV_HEADER).length - 1, 1);
  assert.deepEqual([...s.files.keys()].sort(), ['s1/events.jsonl', 's1/measurements.csv', 's1/session.json']);
});

test('event-file failure retries both files without duplicating rows or corrupting UTF-8 offsets', async () => {
  let failEvents = false;
  const filesystem = memoryDirectory({ beforeOperation: (operation, path) => {
    if (failEvents && operation === 'write' && path.endsWith('/events.jsonl')) throw new Error('event write failed');
  } });
  const recorder = new Recorder({ add: async () => {} });
  await recorder.start(filesystem.directory, { session_id: 's1' });
  const row1 = { ...sample(1).row, label: '参与者 🫀' }, row2 = { ...sample(2).row, label: 'Élodie' }, row3 = { ...sample(3).row, label: 'Participant 03' };
  recorder.enqueue({ type: 'measurement', row: row1 }); recorder.enqueue({ type: 'event', kind: 'connected' });
  await recorder.flush();
  const committed = filesystem.text('s1/measurements.csv');
  failEvents = true;
  recorder.enqueue({ type: 'measurement', row: row2 }); recorder.enqueue({ type: 'event', kind: 'label_changed', label: 'Élodie' });
  await recorder.flush();
  assert.match(recorder.diskError, /event write failed/); assert.equal(recorder.pending.length, 2);
  recorder.enqueue({ type: 'measurement', row: row3 });
  failEvents = false; await recorder.stop();
  assert.equal(filesystem.text('s1/measurements.csv'), csv([row1, row2, row3]));
  assert.ok(filesystem.text('s1/measurements.csv').startsWith(committed));
  assert.deepEqual(filesystem.text('s1/events.jsonl').trim().split('\n').map(line => JSON.parse(line).kind), ['connected', 'label_changed']);
  assert.equal(recorder.pending.length, 0);
});

for (const filename of ['measurements.csv', 'events.jsonl']) test(`retry is idempotent when ${filename} closes but reports a failure`, async () => {
  let failClose = false;
  const filesystem = memoryDirectory({ afterClose: path => {
    if (failClose && path.endsWith('/' + filename)) { failClose = false; throw new Error('ambiguous close'); }
  } });
  const recorder = new Recorder({ add: async () => {} });
  await recorder.start(filesystem.directory, { session_id: 's1' });
  recorder.enqueue(sample(1)); recorder.enqueue({ type: 'event', kind: 'connected' });
  failClose = true; await recorder.flush();
  assert.match(recorder.diskError, /ambiguous close/); assert.equal(recorder.savedBatches, 0);
  recorder.enqueue(sample(2)); recorder.enqueue({ type: 'event', kind: 'label_changed' });
  await recorder.stop();
  assert.equal(filesystem.text('s1/measurements.csv'), csv([sample(1).row, sample(2).row]));
  assert.equal(filesystem.text('s1/events.jsonl').trim().split('\n').length, 2);
  assert.equal(recorder.pending.length, 0);
});

test('a shortened recording file is reported rather than silently filled with holes', async () => {
  const s = setup(); await s.recorder.start(s.directory, { session_id: 's1' });
  s.recorder.enqueue(sample(1)); await s.recorder.flush();
  s.files.set('s1/measurements.csv', new Uint8Array());
  s.recorder.enqueue(sample(2)); await s.recorder.stop();
  assert.match(s.recorder.diskError, /shortened or replaced/);
  assert.equal(s.recorder.pending.length, 1);
  assert.equal(s.records.filter(r => r.value.type === 'measurement').length, 2);
});
