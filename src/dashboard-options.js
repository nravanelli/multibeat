/** Browser capabilities are observable; Chrome's actual flag value is private. */
export function chromeBluetoothFeatures(nav, Device) {
  const brands = nav.userAgentData?.brands;
  const chrome = brands ? brands.some(b => b.brand === 'Google Chrome') : /Chrome\//.test(nav.userAgent || '') && !/Edg\/|OPR\//.test(nav.userAgent || '');
  return { chrome, restore: typeof nav.bluetooth?.getDevices === 'function', advertisements: typeof Device?.prototype?.watchAdvertisements === 'function' };
}

export function heartRateRange(bpm, live) {
  if (!live || !Number.isFinite(bpm)) return { state: 'unavailable', text: '' };
  if (bpm < 60) return { state: 'low', text: 'Below 60 · bradycardia range' };
  if (bpm > 100) return { state: 'high', text: 'Above 100 · tachycardia range' };
  return { state: 'normal', text: '60–100 bpm' };
}

/** Dismiss each current outage, rearming a strap only after it recovers. */
export class DisconnectEpisodes {
  constructor() { this.dismissed = new Set(); this.current = new Set(); }
  update(ids) {
    this.current = new Set(ids);
    for (const id of this.dismissed) if (!this.current.has(id)) this.dismissed.delete(id);
    return [...this.current].filter(id => !this.dismissed.has(id));
  }
  dismiss() { for (const id of this.current) this.dismissed.add(id); }
}

/** Acknowledging a failed-write episode silences it until a successful write clears it. */
export class WriteErrorAlert {
  constructor() { this.failed = false; this.dismissed = false; }
  update(error) {
    this.failed = Boolean(error);
    if (!this.failed) this.dismissed = false;
  }
  dismiss() { if (this.failed) this.dismissed = true; }
  get active() { return this.failed && !this.dismissed; }
}

/** Local synthesized tones or one user-selected audio file, with bounded playback. */
export class DisconnectSound {
  constructor(onError) {
    this.onError = onError; this.tone = 'off'; this.context = null; this.audio = null;
    this.url = null; this.timer = null; this.previewTimer = null; this.voices = new Set(); this.active = false; this.closed = false;
  }
  async select(tone) {
    this.stop(); this.tone = tone;
    try {
      if (tone !== 'off' && tone !== 'custom') {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) throw new Error('Audio playback is unavailable in this browser.');
        this.context ||= new AudioContext();
        await this.context.resume();
      }
    } catch (e) { if (!this.closed) this.onError(e.message); }
  }
  setFile(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose an audio file smaller than 10 MB.');
    if (!file.type.startsWith('audio/')) throw new Error('Choose an audio file supported by this browser.');
    this.stop();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(file); this.audio = new Audio(this.url);
    this.audio.preload = 'auto'; this.audio.onerror = () => { if (!this.closed) this.onError('This audio file could not be played. Choose another file.'); };
  }
  play() {
    if (this.closed || this.tone === 'off') return;
    if (this.tone === 'custom') {
      if (!this.audio) return this.onError('Choose an audio file first.');
      clearTimeout(this.previewTimer);
      this.previewTimer = setTimeout(() => { this.audio?.pause(); }, 4000);
      this.audio.currentTime = 0;
      void this.audio.play().catch(() => { if (!this.closed) this.onError('Sound was blocked. Press Test sound to enable playback.'); });
      return;
    }
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return this.onError('Sound is not ready. Press Test sound to enable playback.');
    const notes = this.tone === 'ring' ? [880, 1100, 880, 1100] : this.tone === 'chime' ? [523.25, 659.25, 783.99] : [740, 740];
    notes.forEach((frequency, i) => {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.22;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.20);
      oscillator.connect(gain); gain.connect(ctx.destination);
      this.voices.add(oscillator);
      oscillator.start(start); oscillator.stop(start + 0.21);
      oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    });
  }
  update(active) {
    if (this.closed || this.tone === 'off') { this.stop(); return; }
    // Ordinary dashboard renders must not cancel a manually requested preview.
    if (!active) { if (this.active) this.stop(); return; }
    if (this.active) return;
    this.active = true; this.play(); this.timer = setInterval(() => this.play(), 8000);
  }
  stop() {
    clearInterval(this.timer); clearTimeout(this.previewTimer); this.timer = null; this.active = false;
    for (const oscillator of this.voices) { try { oscillator.stop(); } catch {} }
    this.voices.clear();
    if (this.audio) { this.audio.pause(); this.audio.currentTime = 0; }
  }
  destroy() {
    this.closed = true; this.stop();
    if (this.audio) { this.audio.onerror = null; this.audio.removeAttribute('src'); this.audio.load(); }
    if (this.url) URL.revokeObjectURL(this.url);
    void this.context?.close().catch(() => {});
  }
}
