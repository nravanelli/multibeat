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

export class Recorder {
  constructor(onStatus = () => {}) { this.onStatus = onStatus; this.tail = Promise.resolve(); this.active = false; this.pending = []; this.savedBatches = 0; this.diskError = null; this.setupFailed = false; }
  async start(directory, metadata) {
    if (!directory) throw new Error('Choose an output folder before capturing data.');
    if (this.active) throw new Error('A recording session is already active.');
    if (this.pending.length) throw new Error('Save pending folder writes before starting another session.');
    this.diskError = null; this.setupFailed = false;
    try {
      this.id = metadata.session_id;
      this.directory = await directory.getDirectoryHandle(this.id, { create: true });
      this.pending = []; this.savedBatches = 0; this.count = 0;
      await this.write('session.json', JSON.stringify(metadata, null, 2));
      await this.write('measurements.csv', CSV_HEADER);
      await this.write('events.jsonl', '');
      this.csvOffset = new TextEncoder().encode(CSV_HEADER).byteLength;
      this.eventOffset = 0;
      this.active = true;
    } catch (failure) {
      this.diskError = failure.message; this.setupFailed = true;
      this.onStatus(); throw failure;
    }
  }

  enqueue(value) {
    if (!this.active) return;
    this.tail = this.tail.then(() => {
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
    if ((await handle.getFile()).size < offset) throw new Error(name + ' was shortened or replaced. Preserve the file and resolve the folder error before continuing.');
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
