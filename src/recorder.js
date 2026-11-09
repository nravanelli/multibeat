export const COLUMNS = ['session_id','sequence','received_utc','elapsed_ms','device_id','device_name','label','simulated','heart_rate_bpm','contact_detected','energy_expended_kj','rr_ticks_1024','rr_ms'];
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  // Prevent spreadsheet formula execution in user-provided labels and device names.
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}
export const CSV_HEADER = COLUMNS.join(',') + '\r\n';
export const csvRows = rows => rows.map(row => COLUMNS.map(k => csvCell(row[k])).join(',') + '\r\n').join('');
export const csv = rows => CSV_HEADER + csvRows(rows);

export class Journal {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('multibeat-hr', 1);
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
  readSessions(db) {
    return new Promise((resolve, reject) => {
      const sessions = [];
      const r = db.transaction('records').objectStore('records').index('session').openKeyCursor(null, 'prevunique');
      r.onsuccess = () => { const cursor = r.result; if (!cursor) return resolve(sessions); sessions.push(cursor.key); cursor.continue(); };
      r.onerror = () => reject(r.error);
    });
  }
  readRows(db, session) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records');
      const r = session ? tx.objectStore('records').index('session').getAll(session) : tx.objectStore('records').getAll();
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  async withLegacyJournals(read) {
    // Discover prior app journals by schema and session metadata, not old brand
    // database names. Read only during recovery; never migrate/delete recordings.
    if (typeof indexedDB.databases !== 'function') return [];
    const results = [];
    for (const { name } of await indexedDB.databases()) {
      if (!name || name === this.db.name) continue;
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => request.transaction.abort(); // Do not recreate a database removed after enumeration.
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => request.error?.name === 'AbortError' ? resolve(null) : reject(request.error);
      });
      if (!db) continue;
      try {
        if (!db.objectStoreNames.contains('records')) continue;
        const store = db.transaction('records').objectStore('records');
        if (store.keyPath !== 'id' || !store.autoIncrement || !store.indexNames.contains('session') ||
            store.index('session').keyPath !== 'session') continue;
        const first = await new Promise((resolve, reject) => {
          const request = store.openCursor();
          request.onsuccess = () => resolve(request.result?.value);
          request.onerror = () => reject(request.error);
        });
        const metadata = first?.value;
        const versionedSession = typeof first?.session === 'string' && metadata?.session_id === first.session &&
          Number.isInteger(metadata.format_version) && metadata.format_version >= 1 && metadata.format_version <= 5;
        if (metadata?.type !== 'session' ||
            !(['MultiBeat', 'Beatstream'].includes(metadata.application) || versionedSession)) continue;
        for (const row of await read(db)) results.push(row);
      } finally { db.close(); }
    }
    return results;
  }
  async sessions() {
    const current = await this.readSessions(this.db);
    const legacy = await this.withLegacyJournals(db => this.readSessions(db));
    return [...new Set([...current, ...legacy])].sort().reverse();
  }
  async all(session) {
    const current = await this.readRows(this.db, session);
    const legacy = await this.withLegacyJournals(db => this.readRows(db, session));
    return [...legacy, ...current];
  }
}

export class Recorder {
  constructor(journal, onStatus = () => {}) { this.journal = journal; this.onStatus = onStatus; this.tail = Promise.resolve(); this.active = false; this.pending = []; this.savedBatches = 0; this.diskError = null; this.journalError = null; }
  async start(directory, metadata) {
    if (!directory) throw new Error('Choose an output folder before capturing data.');
    if (this.active) throw new Error('A recording session is already active.');
    if (this.pending.length) throw new Error('Save pending folder writes before starting another session.');
    this.id = metadata.session_id;
    this.directory = await directory.getDirectoryHandle(this.id, { create: true });
    this.pending = []; this.savedBatches = 0; this.diskError = null; this.journalError = null; this.count = 0;
    await this.journal.add(this.id, { type: 'session', ...metadata });
    await this.write('session.json', JSON.stringify(metadata, null, 2));
    await this.write('measurements.csv', CSV_HEADER);
    await this.write('events.jsonl', '');
    this.csvOffset = new TextEncoder().encode(CSV_HEADER).byteLength;
    this.eventOffset = 0;
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
  async appendAt(name, body, offset) {
    const handle = await this.directory.getFileHandle(name);
    if ((await handle.getFile()).size < offset) throw new Error(name + ' was shortened or replaced. Preserve the file and export browser recovery.');
    const bytes = new TextEncoder().encode(body);
    const stream = await handle.createWritable({ keepExistingData: true });
    try {
      // Retry from the last acknowledged byte offset, including after an ambiguous close.
      // Preserve all committed data; overwrite only this batch's unacknowledged tail.
      await stream.seek(offset);
      await stream.write(bytes);
      await stream.truncate(offset + bytes.byteLength);
      await stream.close();
      return offset + bytes.byteLength;
    } catch (error) { try { await stream.abort(); } catch {} throw error; }
  }
  flush() {
    this.tail = this.tail.then(async () => {
      if (!this.directory || !this.pending.length) return;
      const batch = this.pending.slice(0, 500);
      try {
        const rows = batch.filter(v => v.type === 'measurement').map(v => v.row);
        const events = batch.filter(v => v.type !== 'measurement');
        const csvOffset = rows.length ? await this.appendAt('measurements.csv', csvRows(rows), this.csvOffset) : this.csvOffset;
        const eventOffset = events.length ? await this.appendAt('events.jsonl', events.map(v => JSON.stringify(v)).join('\n') + '\n', this.eventOffset) : this.eventOffset;
        // A batch is acknowledged only after both files close successfully.
        this.csvOffset = csvOffset; this.eventOffset = eventOffset;
        this.pending.splice(0, batch.length); this.savedBatches++; this.diskError = null;
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
