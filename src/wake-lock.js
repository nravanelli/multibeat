// A screen wake lock is only held during capture in a visible document.
export class CaptureWakeLock {
  constructor(api, onChange = () => {}, onError = () => {}) {
    Object.assign(this, { api, onChange, onError });
    this.enabled = true;
    this.recording = false;
    this.visible = true;
    this.lock = null;
    this.pending = null;
    this.blocked = false;
    this.generation = 0;
    this.destroyed = false;
  }
  get state() {
    return !this.api ? 'unavailable' : !this.enabled ? 'off' : !this.recording ? 'idle' : !this.visible ? 'hidden' :
      this.lock && !this.lock.released ? 'active' : this.pending ? 'requesting' : this.blocked ? 'released' : 'idle';
  }
  release(lock) {
    try { Promise.resolve(lock.release()).catch(this.onError); } catch (error) { this.onError(error); }
  }
  update({ enabled = this.enabled, recording = this.recording, visible = this.visible } = {}) {
    if (this.destroyed) return;
    if (enabled !== this.enabled || recording !== this.recording || visible !== this.visible) this.blocked = false;
    Object.assign(this, { enabled, recording, visible });
    if (!enabled || !recording || !visible) {
      this.generation++;
      this.pending = null;
      const lock = this.lock; this.lock = null;
      if (lock) this.release(lock);
    } else if (this.api && !this.lock && !this.pending && !this.blocked) {
      const generation = this.generation;
      const request = this.pending = {};
      // Set pending before calling the native API, including synchronous failures.
      const failed = error => {
        if (this.pending !== request || generation !== this.generation || this.destroyed) return;
        this.pending = null; this.blocked = true;
        this.onError(error); this.onChange(this.state);
      };
      try {
        Promise.resolve(this.api.request('screen')).then(lock => {
          if (this.pending !== request || generation !== this.generation || this.destroyed) {
            this.release(lock); return;
          }
          this.pending = null; this.lock = lock;
          lock.addEventListener('release', () => {
            if (this.lock !== lock) return;
            this.lock = null; this.blocked = true;
            this.onChange(this.state);
          }, { once: true });
          if (lock.released) { this.lock = null; this.blocked = true; }
          this.onChange(this.state);
        }, failed);
      } catch (error) { failed(error); }
    }
    this.onChange(this.state);
  }
  destroy() {
    this.update({ enabled: false });
    this.destroyed = true;
  }
}
