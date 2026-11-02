// Bluetooth SIG Heart Rate Measurement (0x2A37).
export function parseHeartRate(view) {
  let offset = 0;
  const read8 = () => { if (offset + 1 > view.byteLength) throw new Error('Truncated heart rate packet'); return view.getUint8(offset++); };
  const read16 = () => { if (offset + 2 > view.byteLength) throw new Error('Truncated heart rate packet'); const n = view.getUint16(offset, true); offset += 2; return n; };
  const flags = read8();
  const bpm = flags & 1 ? read16() : read8();
  const contact = flags & 4 ? Boolean(flags & 2) : null;
  const energy = flags & 8 ? read16() : null;
  const rr = [];
  if (flags & 16) { if (offset === view.byteLength) throw new Error('Missing RR interval'); while (offset < view.byteLength) rr.push(read16()); }
  if (offset !== view.byteLength) throw new Error('Unexpected heart rate packet length');
  return { bpm, contact, energy, rr, rrMs: rr.map(n => n * 1000 / 1024) };
}

export async function subscribe(device, onSample, onDisconnect, { beforeNotifications = async () => {}, signal } = {}) {
  let characteristic, lost = false;
  const notify = e => onSample(e.target.value);
  const disconnected = () => { lost = true; onDisconnect(); };
  const cleanup = () => {
    characteristic?.removeEventListener('characteristicvaluechanged', notify);
    device.removeEventListener('gattserverdisconnected', disconnected);
    signal?.removeEventListener('abort', cleanup);
    device.gatt.disconnect();
  };
  const check = () => {
    signal?.throwIfAborted();
    if (lost) throw new Error('Monitor disconnected during subscription.');
  };
  device.addEventListener('gattserverdisconnected', disconnected);
  signal?.addEventListener('abort', cleanup, { once: true });
  try {
    check();
    const server = await device.gatt.connect(); check();
    const service = await server.getPrimaryService('heart_rate'); check();
    characteristic = await service.getCharacteristic('heart_rate_measurement'); check();
    // Prepare durable output before the device can send its first notification.
    await beforeNotifications(); check();
    characteristic.addEventListener('characteristicvaluechanged', notify);
    await characteristic.startNotifications(); check();
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}

/** Reconnect indefinitely with capped backoff while enabled and the page is alive. */
export class ReconnectingMonitor {
  constructor(device, { onSample, beforeNotifications, onState = () => {}, onError = () => {},
    subscribeFn = subscribe, schedule = setTimeout, cancel = clearTimeout } = {}) {
    Object.assign(this, { device, onSample, beforeNotifications, onState, onError, subscribeFn, schedule, cancel });
    this.enabled = false;
    this.state = 'paused';
    this.timer = null;
    this.attempt = null;
    this.cleanup = null;
    this.generation = 0;
    this.failures = 0;
  }
  setState(state, detail = {}) { this.state = state; this.onState(state, detail); }
  start() {
    this.enabled = true;
    if (this.timer !== null) { this.cancel(this.timer); this.timer = null; }
    if (this.state === 'connected') return Promise.resolve();
    if (this.attempt) return this.attempt.then(() => this.enabled && this.state !== 'connected' ? this.connect() : undefined);
    return this.connect();
  }
  retry() {
    if (!this.enabled || this.timer !== null) return;
    const delay = Math.min(1000 * 2 ** Math.min(this.failures++, 5), 30000);
    this.setState('reconnecting', { delay });
    this.timer = this.schedule(() => { this.timer = null; this.connect(); }, delay);
  }
  connect() {
    if (!this.enabled || this.attempt) return this.attempt || Promise.resolve();
    const generation = this.generation;
    this.abort = new AbortController();
    this.setState('connecting');
    this.attempt = (async () => {
      try {
        const cleanup = await this.subscribeFn(this.device, this.onSample, () => {
          this.cleanup?.(); this.cleanup = null;
          if (generation === this.generation) this.retry();
        }, { beforeNotifications: this.beforeNotifications, signal: this.abort.signal });
        if (!this.enabled || generation !== this.generation) { cleanup(); return; }
        this.cleanup = cleanup; this.failures = 0;
        this.setState('connected');
      } catch (error) {
        if (!this.enabled || generation !== this.generation) return;
        this.onError(error);
        if (!this.enabled || generation !== this.generation) return;
        if (['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) {
          this.enabled = false; this.setState('permission', { message: error.message });
        } else this.retry();
      }
    })().finally(() => { this.attempt = null; });
    return this.attempt;
  }
  async stop() {
    this.enabled = false; this.generation++;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.abort?.abort(); this.cleanup?.(); this.cleanup = null;
    this.setState('paused');
    await this.attempt;
  }
}
