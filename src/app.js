import { parseHeartRate, ReconnectingMonitor } from './bluetooth.js';
import { Journal, Recorder } from './recorder.js';
import { CaptureSession } from './capture.js';
import { monitorDisplay } from './device-state.js';
import { appendTrend, drawTrend } from './trends.js';
import { RespirationEstimator, RESPIRATION_CONFIG } from './respiration.js';

export async function startDashboard(root) {
  const $ = id => root.getElementById(id);
  const devices = new Map();
  const journal = new Journal();
  const recorder = new Recorder(journal, updateControls);
  const capture = new CaptureSession(recorder, { metadata: sessionMetadata, onChange: updateControls });
  let dbReady = false, busy = false, destroyed = false, pausing = null;
  let demoMode = false, demoTimer = null, wakeLock = null;
  let savedLabels = {}, pairedIds = [];
  try { savedLabels = JSON.parse(localStorage.getItem('hr-labels') || '{}'); } catch {}
  // Keep the legacy storage key so rebranding preserves previously authorized monitors.
  try { const ids = JSON.parse(localStorage.getItem('pulsedeck-paired') || '[]'); if (Array.isArray(ids)) pairedIds = ids; } catch {}
  const error = message => { if (destroyed) return; $('error').textContent = message; $('error').hidden = !message; };

  function sessionMetadata() {
    return {
      session_id: 'beatstream-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8),
      application: 'Beatstream', started_utc: new Date().toISOString(),
      timestamp_basis: 'Browser receipt UTC (wall clock); elapsed_ms uses monotonic performance.now(). No sensor clock synchronization.',
      format_version: 3, respiration_estimation: RESPIRATION_CONFIG, measurement_file: 'measurements.csv', event_file: 'events.jsonl', mode: demoMode ? 'simulation' : 'bluetooth',
      devices: [...devices.values()].map(d => ({ id: d.id, name: d.name, label: d.label, simulated: d.simulated, status: d.status }))
    };
  }
  function event(kind, message, data = {}) {
    if (destroyed) return;
    const utc = new Date().toISOString();
    const li = document.createElement('li');
    const time = document.createElement('time'); time.textContent = new Date(utc).toLocaleTimeString();
    li.append(time, document.createTextNode(message));
    if ($('activity').firstElementChild?.classList.contains('muted')) $('activity').replaceChildren();
    $('activity').prepend(li);
    while ($('activity').children.length > 80) $('activity').lastElementChild.remove();
    recorder.enqueue({ type: 'event', kind, received_utc: utc, elapsed_ms: capture.recording ? +(performance.now() - capture.started).toFixed(3) : null, message, ...data });
  }
  function updateControls() {
    if (destroyed) return;
    const connected = [...devices.values()].some(d => d.status === 'connected');
    const settling = busy || !!pausing || !!capture.stopping;
    const ready = dbReady && !!capture.directory && capture.enabled && !settling;
    $('connect').disabled = !ready || demoMode;
    $('empty-connect').disabled = !ready || demoMode;
    $('connect').title = ready ? 'Pair another heart rate monitor' : 'Choose an output folder and enable capture first';
    $('folder').disabled = !dbReady || settling || capture.recording || !!capture.starting;
    $('folder').textContent = capture.directory ? 'Change folder' : 'Choose folder';
    $('folder').title = capture.recording ? 'Pause capture to change the output folder' : capture.directory ? `Output folder: ${capture.directory.name}` : 'Choose where readings will be saved';
    $('demo').disabled = settling || !dbReady || !capture.directory || !demoMode && (!capture.enabled || capture.recording);
    $('record').disabled = !dbReady || !capture.directory || settling || !!capture.starting;
    $('record').textContent = capture.enabled ? 'Ⅱ Pause capture' : '▶ Resume capture';
    const stateText = capture.recording ? (connected ? demoMode ? 'Capturing simulated data' : 'Capturing live data' : 'Waiting for monitors to return') : capture.starting ? 'Preparing recording…' : !capture.directory ? 'Choose a folder to begin' : capture.enabled ? 'Ready — connect a monitor' : 'Capture paused';
    if ($('record-state').textContent !== stateText) $('record-state').textContent = stateText;
    $('record-dot').classList.toggle('active', capture.recording);
    $('samples').textContent = (recorder.count || 0).toLocaleString();
    $('retry').hidden = !recorder.diskError;
    $('storage-state').style.color = recorder.diskError || recorder.journalError ? '#a0432b' : '';
    if (recorder.diskError || recorder.journalError) {
      $('storage-state').textContent = [recorder.diskError && `Folder write failed: ${recorder.diskError}. ${recorder.pending.length} records pending; retry writes.`, recorder.journalError && `Browser recovery journal failed: ${recorder.journalError}. Recovery may be incomplete.`].filter(Boolean).join(' ');
    } else if (capture.recording && recorder.directory && recorder.id) {
      $('storage-state').textContent = `Folder: ${capture.directory.name} · ${recorder.pending.length ? 'Saving readings…' : recorder.savedBatches ? 'Up to date' : 'Waiting for readings'}`;
    } else $('storage-state').textContent = capture.directory ? `Folder: ${capture.directory.name}` : 'An output folder is required before capture.';
  }
  async function prepareCapture() {
    if (destroyed) throw new DOMException('Dashboard removed.', 'AbortError');
    const wasRecording = capture.recording;
    try {
      await capture.prepare();
      if (!wasRecording && capture.recording && !sessionStartedEvent) {
        sessionStartedEvent = true;
        event('recording_started', 'Capture started automatically.', { storage: 'folder_and_browser' });
        acquireWakeLock();
        refreshSessions().catch(e => error(`Could not list recovery sessions: ${e.message}`));
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        error(`Capture could not start: ${e.message}. Check the output folder, then resume capture.`);
        void pauseCapture().catch(failure => error(`Could not finish pausing capture: ${failure.message}`));
      }
      throw e;
    }
  }
  let sessionStartedEvent = false;
  function makeDevice(id, name, simulated = false, bluetooth = null) {
    const fragment = $('device-template').content.cloneNode(true);
    const node = fragment.querySelector('.device');
    const detail = fragment.querySelector('.device-detail');
    detail.id = 'trend-' + crypto.randomUUID();
    const d = { id, name, simulated, bluetooth, label: savedLabels[id] || '', status: 'paused', last: null, history: [], rrHistory: [], respiration: new RespirationEstimator(), respiratoryEstimate: null, node, detail, expanded: false, expandedMetric: 'hr', manuallyPaused: false, manager: null };
    devices.set(id, d); $('devices').append(fragment);
    node.querySelector('.device-index').textContent = `${simulated ? 'DEMO' : 'MONITOR'} ${String(devices.size).padStart(2, '0')}`;
    node.querySelector('.device-name').textContent = `${name} · ${id}`;
    node.querySelector('.device-name').title = `${name} · ${id}`;
    const toggles = [...node.querySelectorAll('.trend-toggle')];
    for (const toggle of toggles) {
      toggle.setAttribute('aria-controls', detail.id);
      toggle.onclick = () => {
        d.expanded = !(d.expanded && d.expandedMetric === toggle.dataset.metric);
        d.expandedMetric = toggle.dataset.metric;
        detail.querySelector('.graph-metric').value = d.expandedMetric;
        render();
      };
    }
    detail.querySelector('.graph-close').onclick = () => {
      d.expanded = false; render();
      toggles.find(toggle => toggle.dataset.metric === d.expandedMetric).focus();
    };
    detail.querySelector('.graph-range').onchange = render;
    detail.querySelector('.graph-metric').onchange = e => { d.expandedMetric = e.target.value; render(); };
    const input = node.querySelector('.device-label'); input.value = d.label;
    input.setAttribute('aria-label', 'Participant label for ' + name);
    const update = node.querySelector('.label-update');
    const feedback = node.querySelector('.label-feedback');
    update.setAttribute('aria-label', 'Update participant label for ' + name);
    d.updateLabelEditor = () => {
      const changed = input.value.trim() !== d.label;
      update.disabled = !changed;
      const applied = d.label ? 'Applied: ' + d.label : 'No label set';
      const message = changed ? 'Not applied · ' + applied : applied;
      if (feedback.textContent !== message) feedback.textContent = message;
      feedback.classList.toggle('pending', changed);
    };
    input.addEventListener('input', d.updateLabelEditor);
    update.onclick = () => {
      if (destroyed || input.value.trim() === d.label) return;
      const previous = d.label; d.label = input.value.trim(); input.value = d.label;
      d.respiration.reset('label_changed'); d.respiratoryEstimate = d.respiration.result;
      savedLabels[id] = d.label;
      try { localStorage.setItem('hr-labels', JSON.stringify(savedLabels)); } catch { error('Labels cannot be saved between visits. Current labels will still be recorded.'); }
      event('label_changed', `${name}: label changed to ${d.label || '(none)'}`, { device_id: id, previous_label: previous, label: d.label });
      d.updateLabelEditor();
      render();
    };
    d.updateLabelEditor();
    if (!simulated) d.manager = new ReconnectingMonitor(bluetooth, {
      beforeNotifications: prepareCapture,
      onSample: view => {
        if (destroyed || !capture.enabled) return false;
        try { receive(d, parseHeartRate(view)); return true; }
        catch (e) { event('packet_error', `${d.name}: ${e.message}`, { device_id: d.id }); return false; }
      },
      onState: (state, detail) => {
        if (destroyed) return;
        const previous = d.status; d.status = state; d.reconnectReason = detail.reason;
        if (state === 'connecting') d.connectionStarted = performance.now();
        if (state !== 'connected') { d.respiration.reset(state === 'paused' ? 'paused' : 'gap_reset'); d.respiratoryEstimate = d.respiration.result; }
        if (state === 'connected') { d.connectedAt = performance.now(); d.hasConnected = true; }
        if (state === 'connected') event('connected', `${d.label || d.name} connected; capturing data.`, { device_id: id, label: d.label, device_name: d.name });
        if (state === 'reconnecting' && previous === 'connected') {
          if (detail.reason === 'no_data') event('stream_stalled', `${d.label || d.name}: no valid readings for 15 seconds. Refreshing the Bluetooth connection automatically.`, { device_id: id });
          else event('connection_lost', `${d.label || d.name}: signal lost. Reconnecting automatically.`, { device_id: id });
        }
        if (state === 'permission') error(`${d.name}: ${detail.message}. Restore Bluetooth permission, then reconnect.`);
        render();
      },
      onError: e => event('connection_error', `${d.label || d.name}: ${e.message}`, { device_id: id })
    });
    node.querySelector('.device-action').onclick = async () => {
      if (destroyed || busy) return;
      if (d.manager?.enabled || simulated && d.status === 'connected') {
        d.manuallyPaused = true;
        if (d.manager) await d.manager.stop(); else { d.status = 'paused'; d.respiration.reset('paused'); d.respiratoryEstimate = d.respiration.result; }
        event('monitor_paused', `${d.label || d.name} paused; automatic reconnection disabled for this monitor.`, { device_id: id });
      } else if (capture.enabled) {
        d.manuallyPaused = false;
        if (d.manager) void d.manager.start();
        else { await prepareCapture(); d.status = 'connected'; }
      }
      render();
    };
    return d;
  }
  async function chooseDevice() {
    if (!capture.directory || !capture.enabled) return error('Choose an output folder and enable capture before pairing monitors.');
    if (!navigator.bluetooth) return error('Web Bluetooth is unavailable. Use desktop Chrome or Edge on a supported computer.');
    if (demoMode) return error('End the demo before connecting physical monitors.');
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
      if (destroyed || !capture.enabled) return;
      error('');
      if (!pairedIds.includes(device.id)) pairedIds.push(device.id);
      try { localStorage.setItem('pulsedeck-paired', JSON.stringify(pairedIds)); }
      catch { error('This monitor will reconnect on this page, but could not be remembered for future visits.'); }
      const d = devices.get(device.id) || makeDevice(device.id, device.name || 'Heart rate monitor', false, device);
      d.manuallyPaused = false;
      void d.manager.start();
    } catch (e) { if (e.name !== 'NotFoundError') error(`Bluetooth chooser: ${e.message}`); }
  }
  $('connect').onclick = chooseDevice; $('empty-connect').onclick = chooseDevice;
  function receive(d, sample) {
    if (destroyed || !capture.enabled) return;
    const monotonic = performance.now(), utc = new Date().toISOString();
    d.last = { ...sample, at: monotonic, utc };
    appendTrend(d.history, monotonic, sample.bpm);
    d.respiratoryEstimate = d.respiration.add(sample, monotonic);
    for (const point of d.respiration.lastBatch) appendTrend(d.rrHistory, point.at, point.rrMs, { everyMs: 0, maxPoints: 8000 });
    capture.measurement(d, sample, { utc, monotonic });
  }
  function draw(d, now) {
    if (d.node.hidden) return;
    drawTrend(d.node.querySelector('.mini-hr'), d.history, { now, simulated: d.simulated });
    drawTrend(d.node.querySelector('.mini-rr'), d.rrHistory, { now, simulated: d.simulated, metric: 'rr' });
    if (d.expanded) drawTrend(d.detail.querySelector('.history-chart'), d.expandedMetric === 'rr' ? d.rrHistory : d.history, {
      now, simulated: d.simulated, detailed: true, metric: d.expandedMetric,
      windowMs: Number(d.detail.querySelector('.graph-range').value)
    });
  }
  function respirationText(d, live) {
    if (!live) return 'Experimental respiration estimate unavailable while the monitor is offline.';
    const result = d.respiratoryEstimate;
    if (result?.status === 'ok') return 'Estimated respiration: ' + result.rate + ' breaths/min · experimental RR-based estimate, not a direct breathing measurement.';
    if (result?.status === 'no_contact') return 'Respiration estimate unavailable: no skin contact.';
    if (result?.status === 'no_rr') return 'Respiration estimate unavailable: the monitor has not supplied RR intervals.';
    if (!result || ['warming_up', 'gap_reset', 'label_changed', 'timing_gap', 'paused'].includes(result.status)) return 'Experimental respiration estimate: collecting approximately two minutes of continuous RR history.';
    return 'Respiration estimate withheld: RR data do not meet the experimental signal-quality checks.';
  }
  function render() {
    if (destroyed) return;
    const now = performance.now(), filter = $('search').value.trim().toLowerCase();
    let connected = 0; const live = [];
    for (const d of devices.values()) {
      const display = monitorDisplay(d, now);
      d.updateLabelEditor();
      if (d.status === 'connected') connected++;
      if (display.live && d.last.contact !== false) live.push(d.last.bpm);
      d.node.hidden = !`${d.name} ${d.label} ${d.id}`.toLowerCase().includes(filter);
      d.detail.hidden = !d.expanded || d.node.hidden;
      for (const toggle of d.node.querySelectorAll('.trend-toggle')) {
        const active = d.expanded && d.expandedMetric === toggle.dataset.metric;
        toggle.setAttribute('aria-expanded', String(active));
        toggle.setAttribute('aria-label', (active ? 'Collapse' : 'Expand') + (toggle.dataset.metric === 'rr' ? ' RR interval' : ' heart rate') + ' history for ' + (d.label || d.name));
      }
      const metricName = d.expandedMetric === 'rr' ? 'RR interval' : 'Heart rate';
      d.detail.querySelector('.graph-title').textContent = (d.label || d.name) + ' · ' + metricName + ' history';
      d.detail.querySelector('.history-chart').setAttribute('aria-label', metricName + ' history with time and ' + (d.expandedMetric === 'rr' ? 'milliseconds' : 'beats per minute') + ' axes');
      d.detail.querySelector('.respiration-note').textContent = respirationText(d, display.live);
      const status = d.node.querySelector('.device-status');
      if (status.textContent !== display.text) status.textContent = display.text;
      status.className = 'device-status' + (display.offline ? ' offline' : !display.live ? ' stale' : '');
      d.node.classList.toggle('is-offline', display.offline);
      const note = d.node.querySelector('.connection-note');
      note.textContent = display.note; note.hidden = !display.note;
      d.node.querySelector('.reading strong').textContent = display.live ? d.last.bpm : '—';
      d.node.querySelector('.contact').textContent = display.live && d.last.contact === false ? 'No skin contact' : '';
      d.node.querySelector('.last-seen').textContent = d.last ? `${new Date(d.last.utc).toLocaleTimeString()} · ${Math.floor((now - d.last.at) / 1000)}s ago` : 'No samples yet';
      const action = d.node.querySelector('.device-action');
      action.textContent = d.manager?.enabled || d.simulated && d.status === 'connected' ? 'Pause monitor' : 'Reconnect';
      action.disabled = busy || !capture.enabled;
      draw(d, now);
    }
    $('connected').textContent = String(connected);
    $('average').innerHTML = `${live.length ? Math.round(live.reduce((a,b) => a+b, 0) / live.length) : '—'} <small>bpm</small>`;
    $('device-count').textContent = devices.size;
    $('empty').hidden = devices.size > 0;
    const seconds = Math.floor((capture.recording ? now - capture.started : capture.elapsed) / 1000);
    $('duration').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
    updateControls();
  }
  $('search').oninput = render;
  function startMonitors() {
    for (const d of devices.values()) if (!d.manuallyPaused) {
      if (d.manager) void d.manager.start();
      else d.status = 'connected';
    }
  }
  $('folder').onclick = async () => {
    if (!window.showDirectoryPicker) return error('Direct folder writing is required. Use desktop Chrome or Edge with the File System Access API.');
    if (busy) return;
    busy = true; updateControls();
    try {
      const directory = await window.showDirectoryPicker({ mode: 'readwrite', id: 'hr-recordings' });
      if (destroyed) return;
      capture.setDirectory(directory); capture.resume(); error('');
      if (demoMode) await prepareCapture();
      startMonitors();
    } catch (e) { if (e.name !== 'AbortError') error(`Folder access: ${e.message}`); }
    finally { busy = false; updateControls(); }
  };
  async function acquireWakeLock() {
    if (!capture.recording || wakeLock && !wakeLock.released || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (destroyed || !capture.recording) await lock.release(); else wakeLock = lock;
    } catch { /* Computer sleep can still interrupt capture. */ }
  }
  async function pauseCapture() {
    if (pausing) return pausing;
    if (capture.recording) event('recording_stopped', 'Capture paused; saving remaining data.');
    const saving = capture.pause();
    const stops = [...devices.values()].map(d => { if (d.manager) return d.manager.stop(); d.status = 'paused'; d.respiration.reset('paused'); d.respiratoryEstimate = d.respiration.result; });
    pausing = (async () => {
      await Promise.all([saving, ...stops]);
      sessionStartedEvent = false;
      await wakeLock?.release(); wakeLock = null;
      if (dbReady && !destroyed) await refreshSessions();
    })().finally(() => { pausing = null; updateControls(); });
    return pausing;
  }
  const onVisibilityChange = () => {
    if (capture.recording && document.visibilityState === 'hidden') event('tab_hidden', 'Tab hidden; browser throttling or sleep can interrupt capture.');
    acquireWakeLock();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  $('record').onclick = async () => {
    if (busy) return;
    busy = true; updateControls();
    try {
      error('');
      if (capture.enabled) await pauseCapture();
      else {
        capture.resume();
        if (demoMode) await prepareCapture();
        startMonitors();
      }
    } catch (e) { error(e.message); }
    finally { busy = false; render(); }
  };
  $('retry').onclick = async () => {
    $('retry').disabled = true;
    try { await recorder.flush(); if (!capture.recording) await recorder.stop(); }
    finally { $('retry').disabled = false; }
  };
  $('demo').onclick = async () => {
    if (busy) return;
    busy = true; updateControls(); error('');
    try {
      if (demoMode) {
        await pauseCapture(); clearInterval(demoTimer); demoTimer = null; demoMode = false;
        for (const [id,d] of devices) if (d.simulated) { d.node.remove(); d.detail.remove(); devices.delete(id); }
        $('demo').textContent = 'Try demo'; $('demo-notice').hidden = true;
        capture.resume(); event('demo_stopped', 'Simulation ended.');
        return;
      }
      if (devices.size) throw new Error('Use a fresh page with no remembered monitors to run the isolated demo.');
      if (!capture.directory || !capture.enabled) throw new Error('Choose an output folder before running the demo.');
      demoMode = true;
      for (let i = 0; i < 12; i++) {
        const d = makeDevice(`demo-${i + 1}`, `Simulated HRM ${String(i+1).padStart(2,'0')}`, true);
        d.label = `Participant ${String(i+1).padStart(2,'0')}`; d.node.querySelector('.device-label').value = d.label; d.status = 'connected';
      }
      await prepareCapture();
      const tick = () => {
        if (!capture.recording || !capture.enabled) return;
        let i = 0;
        for (const d of devices.values()) {
          if (d.status !== 'connected') { i++; continue; }
          const now = performance.now();
          if (d.demoNextBeat == null || now - d.demoNextBeat > 5000) {
            d.demoNextBeat = now; d.demoRR = Math.round(60 / (66 + i*2) * 1024);
          }
          const rr = [];
          while (d.demoNextBeat <= now && rr.length < 20) {
            rr.push(d.demoRR);
            const hr = 66 + i*2 + 3*Math.sin(2*Math.PI*(0.18+i*0.005)*d.demoNextBeat/1000);
            d.demoRR = Math.round(60/hr*1024); d.demoNextBeat += d.demoRR*1000/1024;
          }
          const bpm = Math.round(60*1024/d.demoRR);
          receive(d, { bpm, contact: true, energy: null, rr, rrMs: rr.map(n => n * 1000 / 1024) }); i++;
        }
        render();
      };
      demoTimer = setInterval(tick, 1000); tick();
      $('demo').textContent = 'End demo'; $('demo-notice').hidden = false;
      event('demo_started', 'Simulated monitors connected. No physical devices are involved.');
    } catch (e) {
      if (demoMode && demoTimer === null) {
        demoMode = false;
        for (const [id, d] of devices) if (d.simulated) { d.node.remove(); d.detail.remove(); devices.delete(id); }
        $('demo-notice').hidden = true;
        $('demo').textContent = 'Try demo';
      }
      error(e.message);
    }
    finally { busy = false; render(); }
  };
  async function refreshSessions() {
    const selected = $('saved').value;
    const sessions = await journal.sessions();
    if (destroyed) return;
    $('saved').replaceChildren();
    for (const id of sessions) { const option = document.createElement('option'); option.value = id; option.textContent = id; $('saved').append(option); }
    if (!sessions.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No saved recordings'; $('saved').append(option); }
    if (sessions.includes(selected)) $('saved').value = selected;
    $('export').disabled = !sessions.length;
  }
  $('export').onclick = async () => {
    if (!$('saved').value) return;
    $('export').disabled = true;
    try {
      const session = $('saved').value;
      await recorder.tail;
      const rows = await journal.all(session);
      const blob = new Blob(rows.map(r => JSON.stringify(r.value) + '\n'), { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${session}-recovery.jsonl`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { error(`Recovery export failed: ${e.message}`); }
    finally { if (!destroyed) $('export').disabled = false; }
  };
  async function restorePairedDevices() {
    if (!pairedIds.length) return;
    if (!navigator.bluetooth?.getDevices) {
      event('restore_unavailable', 'This browser cannot restore paired monitors automatically. Choose the output folder, then use Connect monitor.');
      return;
    }
    try {
      const authorized = await navigator.bluetooth.getDevices();
      if (destroyed) return;
      for (const device of authorized) if (pairedIds.includes(device.id) && !devices.has(device.id)) makeDevice(device.id, device.name || 'Heart rate monitor', false, device);
      if (capture.enabled) startMonitors();
      event('paired_restored', 'Remembered monitors restored. Select an output folder to enable automatic capture and reconnection.');
    } catch (e) { event('restore_failed', `Could not restore paired monitors: ${e.message}. Use Connect monitor.`); }
  }
  const onBeforeUnload = e => {
    if (capture.recording || recorder.pending.length) { e.preventDefault(); e.returnValue = ''; }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  const renderTimer = setInterval(render, 1000);
  const flushTimer = setInterval(() => { if (capture.recording) recorder.flush(); }, 5000);
  if (!window.isSecureContext || !navigator.bluetooth || !window.showDirectoryPicker) {
    $('compatibility').hidden = false;
    $('compatibility').textContent = 'Capture requires direct folder access. Use desktop Chrome or Edge on HTTPS with Web Bluetooth and the File System Access API. No folder means no recording.';
  }
  updateControls();
  try { await journal.open(); dbReady = true; await refreshSessions(); }
  catch (e) { error(`Browser recovery storage unavailable: ${e.message}. Enable site storage to capture data.`); }
  await restorePairedDevices();
  render();
  return {
    async destroy() {
      clearInterval(renderTimer); clearInterval(flushTimer); clearInterval(demoTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      const paused = pauseCapture();
      destroyed = true;
      await paused;
      journal.db?.close();
    }
  };
}
