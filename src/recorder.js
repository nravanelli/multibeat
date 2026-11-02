export const COLUMNS = ['session_id','sequence','received_utc','elapsed_ms','device_id','device_name','label','simulated','heart_rate_bpm','contact_detected','energy_expended_kj','rr_ticks_1024','rr_ms'];
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  // Prevent spreadsheet formula execution in user-provided labels and device names.
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}
export const csv = rows => COLUMNS.join(',') + '\r\n' + rows.map(row => COLUMNS.map(k => csvCell(row[k])).join(',')).join('\r\n') + '\r\n';

export class Journal {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      // Retain this storage name so existing recordings remain recoverable after rebranding.
      const r = indexedDB.open('cooling-hubs-hr', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('records', { keyPath: 'id', autoIncrement: true }); s.createIndex('session', 'session'); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  add(session, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('records', 'readwrite');
      tx.objectStore('records').add({ session, value });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Local storage transaction aborted'));
    });
  }
  sessions() {
    return new Promise((resolve, reject) => {
      const sessions = [];
      const r = this.db.transaction('records').objectStore('records').index('session').openKeyCursor(null, 'prevunique');
      r.onsuccess = () => { const cursor = r.result; if (!cursor) return resolve(sessions); sessions.push(cursor.key); cursor.continue(); };
      r.onerror = () => reject(r.error);
    });
  }
  all(session) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('records');
      const r = session ? tx.objectStore('records').index('session').getAll(session) : tx.objectStore('records').getAll();
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
}

export class Recorder {
  constructor(journal, onStatus = () => {}) { this.journal = journal; this.onStatus = onStatus; this.tail = Promise.resolve(); this.active = false; this.pending = []; this.part = 0; this.diskError = null; this.journalError = null; }
  async start(directory, metadata) {
    if (!directory) throw new Error('Choose an output folder before capturing data.');
    if (this.active) throw new Error('A recording session is already active.');
    if (this.pending.length) throw new Error('Save pending folder writes before starting another session.');
    this.id = metadata.session_id;
    this.directory = await directory.getDirectoryHandle(this.id, { create: true });
    this.pending = []; this.part = 0; this.diskError = null; this.journalError = null; this.count = 0;
    await this.journal.add(this.id, { type: 'session', ...metadata });
    if (this.directory) await this.write('session.json', JSON.stringify(metadata, null, 2));
    this.active = true;
  }
  enqueue(value) {
    if (!this.active) return;
    const session = this.id;
    this.tail = this.tail.then(async () => {
      try { await this.journal.add(session, value); }
      catch (e) { this.journalError = e.message; this.onStatus(); }
      if (this.directory) this.pending.push(value);
      if (value.type === 'measurement') this.count++;
      this.onStatus();
    });
  }
  async write(name, body) {
    const handle = await this.directory.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    try { await stream.write(body); await stream.close(); }
    catch (error) { try { await stream.abort(); } catch {} throw error; }
  }
  flush() {
    this.tail = this.tail.then(async () => {
      if (!this.directory || !this.pending.length) return;
      // Fixed part name on retry makes a failed batch idempotent.
      const batch = this.pending.slice(0, 500);
      const part = String(this.part + 1).padStart(6, '0');
      try {
        const rows = batch.filter(v => v.type === 'measurement').map(v => v.row);
        const events = batch.filter(v => v.type !== 'measurement');
        if (rows.length) await this.write(`measurements-${part}.csv`, csv(rows));
        if (events.length) await this.write(`events-${part}.jsonl`, events.map(v => JSON.stringify(v)).join('\n') + '\n');
        this.pending.splice(0, batch.length); this.part++; this.diskError = null;
      } catch (e) { this.diskError = e.message; }
      this.onStatus();
    });
    return this.tail;
  }
  async stop() {
    this.active = false;
    await this.tail;
    while (this.directory && this.pending.length) { await this.flush(); if (this.diskError) break; }
    this.onStatus();
  }
}
