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

export const BLUETOOTH_STEP_TIMEOUT_MS = 15000;
export const BLUETOOTH_CONNECT_TIMEOUT_MS = 60000;

// The chooser supports advertised-name exclusions, not browser device-ID filters.
// ID checks after selection remain necessary for unnamed devices/older browsers.
export function pairingRequestOptions(devices, rediscoverDevice = null) {
  const options = { filters: [{ services: ['heart_rate'] }] };
  if (rediscoverDevice) {
    if (typeof rediscoverDevice.name === 'string' && rediscoverDevice.name.length) {
      options.filters[0].name = rediscoverDevice.name;
    }
    return options;
  }
  const names = [...new Set(devices.map(device => device?.name).filter(name => typeof name === 'string' && name.length))];
  if (names.length) options.exclusionFilters = names.map(name => ({ name }));
  return options;
}

// Native Bluetooth promises do not necessarily settle when disconnect() is called.
// Settle our own wait on cancellation; late native results must never install listeners.
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal?.removeEventListener('abort', aborted);
      reject(signal.reason || new DOMException('Cancelled', 'AbortError'));
    };
    if (signal?.aborted) { aborted(); Promise.resolve(promise).catch(() => {}); return; }
    signal?.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal?.removeEventListener('abort', aborted));
  });
}

export async function subscribe(device, onSample, onDisconnect, {
  beforeNotifications = async () => {}, signal, onProgress = () => {},
  schedule = (fn, delay) => globalThis.setTimeout(fn, delay),
  cancel = timer => globalThis.clearTimeout(timer)
} = {}) {
  let characteristic, lost = false, cleaned = false;
  const local = new AbortController();
  const notify = e => { if (!cleaned) onSample(e.target.value); };
  const disconnected = () => { lost = true; onDisconnect(); local.abort(new DOMException('Bluetooth disconnected', 'NetworkError')); };
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    local.abort();
    characteristic?.removeEventListener('characteristicvaluechanged', notify);
    device.removeEventListener('gattserverdisconnected', disconnected);
    signal?.removeEventListener('abort', cleanup);
    device.gatt.disconnect();
  };
  const check = () => {
    signal?.throwIfAborted(); local.signal.throwIfAborted();
    if (lost) throw new Error('Monitor disconnected during subscription.');
  };
  async function step(stage, operation) {
    check();
    const timeoutMs = stage === 'gatt.connect' ? BLUETOOTH_CONNECT_TIMEOUT_MS : BLUETOOTH_STEP_TIMEOUT_MS;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    onProgress(stage, 'started', { timeout_ms: timeoutMs });
    let progressTimer;
    const pending = () => {
      onProgress(stage, 'still_pending', { elapsed_ms: elapsed(), timeout_ms: timeoutMs });
      progressTimer = schedule(pending, 10000);
    };
    progressTimer = schedule(pending, 10000);
    const timer = schedule(() => local.abort(new DOMException(`${stage} timed out after ${timeoutMs / 1000} seconds (MultiBeat timeout; Chrome did not complete this step)`, 'TimeoutError')), timeoutMs);
    try {
      const result = await abortable(operation(), local.signal); check();
      onProgress(stage, 'completed', { elapsed_ms: elapsed() }); return result;
    } catch (error) {
      onProgress(stage, 'failed', { elapsed_ms: elapsed(), error: error.name, message: error.message });
      throw error;
    } finally { cancel(timer); cancel(progressTimer); }
  }
  device.addEventListener('gattserverdisconnected', disconnected);
  signal?.addEventListener('abort', cleanup, { once: true });
  try {
    const server = await step('gatt.connect', () => device.gatt.connect());
    const service = await step('getPrimaryService', () => server.getPrimaryService('heart_rate'));
    characteristic = await step('getCharacteristic', () => service.getCharacteristic('heart_rate_measurement'));
    // Folder preparation has its own lifecycle; do not time out a durable write.
    onProgress('prepare_capture', 'started');
    await abortable(beforeNotifications(), local.signal); check();
    onProgress('prepare_capture', 'completed');
    characteristic.addEventListener('characteristicvaluechanged', notify);
    await step('startNotifications', () => characteristic.startNotifications());
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}

export const NO_DATA_RECOVERY_MS = 15000;

/** Reconnect indefinitely with capped backoff while enabled and the page is alive. */
export class ReconnectingMonitor {
  constructor(device, { onSample, beforeNotifications, onState = () => {}, onError = () => {},
    subscribeFn = subscribe, onLog = detail => console.info('[MultiBeat][Bluetooth] ' + JSON.stringify(detail)),
    schedule = (fn, delay) => globalThis.setTimeout(fn, delay),
    cancel = timer => globalThis.clearTimeout(timer) } = {}) {
    Object.assign(this, { device, onSample, beforeNotifications, onState, onError, subscribeFn, onLog, schedule, cancel });
    this.enabled = false;
    this.state = 'paused';
    this.timer = null;
    this.attempt = null;
    this.cleanup = null;
    this.generation = 0;
    this.failures = 0;
    this.watchdogTimer = null;
    this.connectionToken = null;
    this.attemptNumber = 0;
    this.advertisementWatch = null;
    this.watchUnavailableDevice = null;
  }
  log(event, detail = {}) { this.onLog({ utc: new Date().toISOString(), device_id: this.device.id, event, attempt: this.attemptNumber, gatt_connected: this.device.gatt?.connected, ...detail }); }
  setState(state, detail = {}) { this.state = state; this.log(state, detail); this.onState(state, detail); }
  start() {
    this.enabled = true;
    if (this.timer !== null) { this.cancel(this.timer); this.timer = null; }
    if (this.state === 'connected') return Promise.resolve();
    if (this.attempt) return this.attempt.then(() => this.enabled && this.state !== 'connected' ? this.connect() : undefined);
    return this.connect();
  }
  clearWatchdog() {
    if (this.watchdogTimer !== null) this.cancel(this.watchdogTimer);
    this.watchdogTimer = null;
  }
  stopAdvertisementWatch() {
    const watch = this.advertisementWatch;
    if (!watch) return;
    this.advertisementWatch = null;
    watch.device.removeEventListener('advertisementreceived', watch.received);
    watch.controller.abort();
  }
  watchForReturn() {
    const device = this.device;
    if (!this.enabled || this.advertisementWatch || this.watchUnavailableDevice === device) return;
    if (typeof device.watchAdvertisements !== 'function') {
      this.watchUnavailableDevice = device;
      this.log('advertisement_watch_unavailable', { reason: 'API unavailable; using timed retries and Find again' });
      return;
    }
    const watch = { device, controller: new AbortController(), received: null };
    watch.received = () => {
      if (this.advertisementWatch !== watch || !this.enabled || this.attempt) return;
      this.log('advertisement_received', { action: 'retry_connection' });
      this.stopAdvertisementWatch();
      void this.start();
    };
    this.advertisementWatch = watch;
    device.addEventListener('advertisementreceived', watch.received);
    this.log('advertisement_watch_started');
    const failed = error => {
      if (this.advertisementWatch !== watch) return;
      this.stopAdvertisementWatch();
      this.watchUnavailableDevice = device;
      this.log('advertisement_watch_failed', { error: error.name, message: error.message, fallback: 'timed_retries' });
    };
    try {
      Promise.resolve(device.watchAdvertisements({ signal: watch.controller.signal })).then(() => {
        if (this.advertisementWatch === watch) this.log('advertisement_watch_ready');
      }, failed);
    } catch (error) { failed(error); }
  }
  armWatchdog() {
    this.clearWatchdog();
    if (!this.enabled || this.state !== 'connected') return;
    const token = this.connectionToken;
    this.watchdogTimer = this.schedule(() => {
      this.watchdogTimer = null;
      if (!this.enabled || this.state !== 'connected' || token !== this.connectionToken) return;
      this.log('no_data_watchdog', { silence_ms: NO_DATA_RECOVERY_MS });
      this.connectionToken = null;
      this.abort?.abort(); this.cleanup?.(); this.cleanup = null;
      this.retry('no_data');
    }, NO_DATA_RECOVERY_MS);
  }
  retry(reason = 'disconnected') {
    this.clearWatchdog();
    if (!this.enabled || this.timer !== null) return;
    const delay = Math.min(1000 * 2 ** Math.min(this.failures++, 5), 30000);
    this.setState('reconnecting', { delay, reason });
    this.timer = this.schedule(() => { this.timer = null; if (this.enabled) this.start(); }, delay);
    this.watchForReturn();
  }
  connect() {
    if (!this.enabled || this.attempt) return this.attempt || Promise.resolve();
    this.stopAdvertisementWatch();
    const generation = this.generation;
    const token = this.connectionToken = Symbol();
    const controller = this.abort = new AbortController();
    this.attemptNumber++;
    let received = false;
    this.setState('connecting');
    this.attempt = (async () => {
      try {
        const subscription = this.subscribeFn(this.device, value => {
          if (!this.enabled || this.connectionToken !== token || generation !== this.generation) return;
          // The consumer returns false for malformed or ignored notifications.
          if (this.onSample?.(value) !== false) {
            if (!received) { received = true; this.log('first_valid_notification'); }
            this.armWatchdog();
          }
        }, () => {
          if (!this.enabled || this.connectionToken !== token || generation !== this.generation) return;
          this.connectionToken = null;
          controller.abort();
          this.cleanup?.(); this.cleanup = null;
          this.retry();
        }, { beforeNotifications: this.beforeNotifications, signal: controller.signal,
          schedule: this.schedule, cancel: this.cancel,
          onProgress: (stage, status, detail) => this.log('setup', { stage, status, ...detail }) });
        // Also protect stop() from custom subscriptions that ignore AbortSignal.
        Promise.resolve(subscription).then(cleanup => {
          if (controller.signal.aborted) cleanup();
        }, () => {});
        const cleanup = await abortable(subscription, controller.signal);
        if (!this.enabled || generation !== this.generation || this.connectionToken !== token) return;
        this.cleanup = cleanup; this.failures = 0;
        this.setState('connected');
        this.armWatchdog();
      } catch (error) {
        if (!this.enabled || generation !== this.generation || this.connectionToken !== token) return;
        this.connectionToken = null;
        this.log('attempt_failed', { error: error.name, message: error.message });
        controller.abort();
        this.onError(error);
        if (!this.enabled || generation !== this.generation) return;
        if (['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) {
          this.enabled = false; this.setState('permission', { message: error.message });
        } else this.retry(error.name === 'TimeoutError' ? 'setup_timeout' : 'connection_error');
      }
    })().finally(() => { this.attempt = null; });
    return this.attempt;
  }
  async stop() {
    this.enabled = false; this.generation++;
    this.stopAdvertisementWatch();
    this.connectionToken = null; this.clearWatchdog();
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.abort?.abort(); this.cleanup?.(); this.cleanup = null;
    this.setState('paused');
    await this.attempt;
  }
}
