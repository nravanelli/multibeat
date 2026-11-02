/** Coordinates automatic capture without losing the first notification during setup. */
export class CaptureSession {
  constructor(recorder, { metadata, onChange = () => {}, now = () => performance.now() } = {}) {
    this.recorder = recorder;
    this.metadata = metadata;
    this.onChange = onChange;
    this.now = now;
    this.enabled = false;
    this.recording = false;
    this.directory = null;
    this.starting = null;
    this.stopping = null;
    this.generation = 0;
    this.started = 0;
    this.elapsed = 0;
    this.sequence = 0;
  }
  setDirectory(directory) {
    if (this.recording || this.starting || this.stopping) throw new Error('Pause capture before changing the output folder.');
    if (!directory) throw new Error('Choose an output folder before capturing data.');
    this.directory = directory;
  }
  resume() {
    if (!this.directory) throw new Error('Choose an output folder before capturing data.');
    if (this.stopping) throw new Error('Wait for the previous session to finish saving.');
    if (this.recorder.pending.length) throw new Error('Retry pending folder writes before starting another session.');
    this.enabled = true;
    this.onChange();
  }
  prepare() {
    if (!this.enabled || !this.directory) return Promise.reject(new Error('Choose an output folder and enable capture first.'));
    if (this.starting) return this.starting;
    if (this.recording) return Promise.resolve();
    const generation = this.generation;
    this.starting = (async () => {
      const metadata = this.metadata();
      const started = this.now();
      await this.recorder.start(this.directory, metadata);
      if (generation !== this.generation || !this.enabled) {
        await this.recorder.stop();
        throw new DOMException('Capture was paused during setup.', 'AbortError');
      }
      this.started = started;
      this.elapsed = 0;
      this.sequence = 0;
      this.recording = true;
    })().catch(error => {
      if (generation === this.generation) this.enabled = false;
      throw error;
    }).finally(() => { this.starting = null; this.onChange(); });
    return this.starting;
  }
  measurement(device, sample, { utc = new Date().toISOString(), monotonic = this.now() } = {}) {
    if (!this.recording || !this.enabled) return false;
    this.recorder.enqueue({ type: 'measurement', row: {
      session_id: this.recorder.id, sequence: ++this.sequence, received_utc: utc,
      elapsed_ms: +(monotonic - this.started).toFixed(3), device_id: device.id,
      device_name: device.name, label: device.label, simulated: device.simulated,
      heart_rate_bpm: sample.bpm, contact_detected: sample.contact,
      energy_expended_kj: sample.energy, rr_ticks_1024: sample.rr.join(';'), rr_ms: sample.rrMs.join(';')
    } });
    return true;
  }
  pause() {
    if (this.stopping) return this.stopping;
    this.enabled = false;
    this.generation++;
    this.elapsed = this.recording ? this.now() - this.started : this.elapsed;
    this.recording = false;
    this.stopping = (async () => {
      try { await this.starting; } catch { /* Setup error is reported by its caller. */ }
      await this.recorder.stop();
    })().finally(() => { this.stopping = null; this.onChange(); });
    this.onChange();
    return this.stopping;
  }
}
