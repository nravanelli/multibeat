import { parseHeartRate, ReconnectingMonitor, pairingRequestOptions } from './bluetooth.js';
import { setButtonLabel } from './view.js';
import { CaptureWakeLock } from './wake-lock.js';
import { Journal, Recorder } from './recorder.js';
import { CaptureSession } from './capture.js';
import { monitorDisplay } from './device-state.js';
import { appendTrend, appendRRTrend } from './trends.js';
import { TrendCharts } from './charts.js';
import { loadPairedIds, savePairedIds } from './settings.js';

export async function startDashboard(root) {
  const $ = id => root.getElementById(id);
  const devices = new Map();
  const charts = new TrendCharts();
  const journal = new Journal();
  const recorder = new Recorder(journal, updateControls);
  const capture = new CaptureSession(recorder, { metadata: sessionMetadata, onChange: updateControls });
  let dbReady = false, busy = false, destroyed = false, pausing = null;
  let lastStorageError = null;
  let chooser = null;
  let folderBrowsing = false;
  const wakeLock = new CaptureWakeLock(navigator.wakeLock, renderWakeLock,
    failure => console.warn('[MultiBeat][Wake lock]', { error: failure.name, message: failure.message }));
  function renderWakeLock(state) {
    if (destroyed) return;
    $('keep-awake').disabled = state === 'unavailable';
    $('wake-lock-state').textContent = {
      unavailable: 'Unavailable', off: 'Off', idle: 'During capture', hidden: 'Tab hidden',
      active: 'Active', requesting: 'Requesting…', released: 'Not active — toggle to retry'
    }[state];
    $('wake-lock-state').classList.toggle('wake-active', state === 'active');
  }
  let savedLabels = {}, pairedIds = [];
  try { savedLabels = JSON.parse(localStorage.getItem('hr-labels') || '{}'); } catch {}
  try { pairedIds = loadPairedIds(localStorage); } catch {}
  const error = message => { if (destroyed) return; $('error').textContent = message; $('error').hidden = !message; };

  function sessionMetadata() {
    return {
      session_id: 'multibeat-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8),
      application: 'MultiBeat', started_utc: new Date().toISOString(),
      timestamp_basis: 'Browser receipt UTC (wall clock); elapsed_ms uses monotonic performance.now(). No sensor clock synchronization.',
      format_version: 5, measurement_file: 'measurements.csv', event_file: 'events.jsonl', mode: 'bluetooth',
      devices: [...devices.values()].map(d => ({ id: d.id, name: d.name, label: d.label, simulated: d.simulated, status: d.status }))
    };
  }
  function event(kind, message, data = {}) {
    if (destroyed) return;
    const utc = new Date().toISOString();
    // Keep physiological values and participant labels out of diagnostic logs.
    console.info('[MultiBeat][Activity]', { utc, event: kind, device_id: data.device_id });
    recorder.enqueue({ type: 'event', kind, received_utc: utc, elapsed_ms: capture.recording ? +(performance.now() - capture.started).toFixed(3) : null, message, ...data });
  }
  function updateControls() {
    if (destroyed) return;
    acquireWakeLock();
    const live = [...devices.values()].some(d => monitorDisplay(d, performance.now()).live);
    const settling = busy || !!pausing || !!capture.stopping;
    const ready = dbReady && !!capture.directory && capture.enabled && !settling;
    $('connect').disabled = !ready || folderBrowsing;
    setButtonLabel($('connect'), chooser ? 'Choose in Chrome…' : 'Pair HRM', 'pair');
    $('cancel-chooser').hidden = !chooser;
    $('connect').title = ready ? 'Pair another heart rate monitor' : 'Choose an output folder and enable capture first';
    $('folder').disabled = !dbReady || settling || capture.recording || !!capture.starting || folderBrowsing;
    $('folder').textContent = capture.directory ? 'Change folder' : 'Choose folder';
    $('folder').title = capture.recording ? 'Pause capture to change the output folder' : capture.directory ? `Output folder: ${capture.directory.name}` : 'Choose where readings will be saved';
    $('folder-open').hidden = !capture.directory;
    $('folder-open').disabled = folderBrowsing || !!chooser;
    $('folder-name').textContent = capture.directory?.name || '';
    $('folder-open').title = `Browse ${capture.directory?.name || 'output folder'} in the native folder dialog. Recording destination stays unchanged; this does not launch Finder/Explorer.`;
    $('folder-open').setAttribute('aria-label', `Browse output folder ${capture.directory?.name || ''}`);
    $('record').disabled = !dbReady || !capture.directory || settling || !!capture.starting;
    setButtonLabel($('record'), pausing || capture.stopping ? 'Saving…' : capture.enabled ? 'Pause capture' : 'Resume capture', pausing || capture.stopping ? null : capture.enabled ? 'pause' : 'resume');
    const capturingLive = capture.recording && capture.enabled && live;
    const stateText = capture.recording && capture.enabled ? (live ? 'Capturing live data' : 'Waiting for monitors to return') : capture.starting ? 'Preparing recording…' : !capture.directory ? 'Choose a folder to begin' : capture.enabled ? 'Ready — connect a monitor' : 'Capture paused';
    if ($('record-state').textContent !== stateText) $('record-state').textContent = stateText;
    $('record-indicator').classList.toggle('is-recording', !!capturingLive);
    $('record-indicator').title = stateText;
    const storageError = [recorder.diskError, recorder.journalError].filter(Boolean).join('; ');
    if (storageError && storageError !== lastStorageError) console.error('[MultiBeat][Storage]', storageError);
    lastStorageError = storageError;
    $('retry').hidden = !recorder.diskError;
    const storageMessage = [
      recorder.diskError && `Folder write failed: ${recorder.diskError}. ${recorder.pending.length} records pending; retry writes.`,
      recorder.journalError && `Browser recovery journal failed: ${recorder.journalError}. Recovery may be incomplete.`
    ].filter(Boolean).join(' ');
    $('storage-state').textContent = storageMessage;
    $('storage-state').hidden = !storageMessage;
    $('storage-state').style.color = storageMessage ? '#a0432b' : '';

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
    const d = { id, name, simulated, bluetooth, label: savedLabels[id] || '', status: 'paused', last: null, history: [], rrHistory: [], rrClock: {}, node, detail, expanded: false, expandedMetric: 'hr', manuallyPaused: false, manager: null };
    devices.set(id, d); $('devices').append(fragment);
    node.querySelector('.device-name').textContent = name;
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
    const graph = detail.querySelector('.history-chart');
    const viewState = detail.querySelector('.graph-view-state');
    graph.addEventListener('chartviewchange', e => {
      const seconds = e.detail.windowMs / 1000;
      viewState.textContent = `Live · last ${seconds >= 60 ? `${+(seconds / 60).toFixed(1)} min` : `${seconds}s`}`;
    });
    detail.querySelector('.graph-zoom-in').onclick = () => charts.zoom(graph, 0.5);
    detail.querySelector('.graph-zoom-out').onclick = () => charts.zoom(graph, 2);
    detail.querySelector('.graph-live').onclick = () => charts.reset(graph);
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
        if (state !== 'connected') d.rrClock = {};
        if (state === 'connected') { d.connectedAt = performance.now(); d.hasConnected = true; d.connectionProblem = ''; }
        if (state === 'connected') event('connected', `${d.label || d.name} connected; capturing data.`, { device_id: id, label: d.label, device_name: d.name });
        if (state === 'reconnecting' && previous === 'connected') {
          if (detail.reason === 'no_data') event('stream_stalled', `${d.label || d.name}: no valid readings for 15 seconds. Refreshing the Bluetooth connection automatically.`, { device_id: id });
          else event('connection_lost', `${d.label || d.name}: signal lost. Reconnecting automatically.`, { device_id: id });
        }
        if (state === 'permission') error(`${d.name}: ${detail.message}. Restore Bluetooth permission, then reconnect.`);
        render();
      },
      onError: e => {
        d.connectionProblem = e.name === 'TimeoutError' ? 'Chrome did not complete the connection. Try Find again.' : e.message;
        event('connection_error', `${d.label || d.name}: ${e.message}`, { device_id: id });
        render();
      }
    });
    node.querySelector('.device-find').onclick = () => chooseDevice(d);
    node.querySelector('.device-action').onclick = async () => {
      if (destroyed || busy) return;
      if (d.manager?.enabled || simulated && d.status === 'connected') {
        d.manuallyPaused = true;
        if (d.manager) await d.manager.stop(); else { d.status = 'paused'; d.rrClock = {}; }
        event('monitor_paused', `${d.label || d.name} paused; automatic reconnection disabled for this monitor.`, { device_id: id });
      } else if (capture.enabled) {
        if (chooser) return error('Chrome device selection is still pending. Finish selection or use Stop waiting before reconnecting.');
        d.manuallyPaused = false;
        if (d.manager) void d.manager.start();
        else { await prepareCapture(); d.status = 'connected'; }
      }
      render();
    };
    return d;
  }
  async function chooseDevice(target = null) {
    if (!capture.directory || !capture.enabled) return error('Choose an output folder and enable capture before pairing monitors.');
    if (!navigator.bluetooth) return error('Web Bluetooth is unavailable. Use desktop Chrome or Edge on a supported computer.');
    if (chooser) return error('A Bluetooth chooser has already been requested from Chrome. Check Chrome for the dialog and press Esc to cancel it if needed.');
    const selection = chooser = { timer: null, suspended: [], abort: new AbortController() };
    error(''); updateControls();
    try {
      // Stop pending native requests BEFORE opening the chooser. Do not await here:
      // requestDevice must run within the original click's user activation.
      for (const d of devices.values()) {
        if (d.manager?.enabled && (d.manager.state !== 'connected' || d === target)) {
          const stopping = d.manager.stop();
          selection.suspended.push({ d, generation: d.manager.generation, stopping });
        }
      }
      console.info('[MultiBeat][Chooser] ' + JSON.stringify({
        event: 'requested', device_id: target?.id, suspended_attempts: selection.suspended.length,
        user_activation: navigator.userActivation?.isActive, focused: document.hasFocus(),
        visibility: document.visibilityState, secure_context: window.isSecureContext, browser: navigator.userAgent,
        bluetooth_allowed: document.permissionsPolicy?.allowsFeature('bluetooth') ?? null
      }));
      const request = navigator.bluetooth.requestDevice(pairingRequestOptions([...devices.values()].map(d => d.bluetooth), target?.bluetooth));
      selection.timer = setTimeout(() => {
        if (destroyed || chooser !== selection) return;
        console.warn('[MultiBeat][Chooser] Still waiting for Chrome to return a device selection.');
        error('Still waiting for Chrome’s Bluetooth chooser. Check for its dialog; press Esc in Chrome to cancel. Use Stop waiting to restore the app controls. This cannot dismiss Chrome’s native chooser; press Esc in Chrome. Existing recordings are preserved.');
      }, 20000);
      const device = await new Promise((resolve, reject) => {
        const abort = () => { selection.abort.signal.removeEventListener('abort', abort); reject(selection.abort.signal.reason); };
        selection.abort.signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(request).then(value => { selection.abort.signal.removeEventListener('abort', abort); resolve(value); }, failure => { selection.abort.signal.removeEventListener('abort', abort); reject(failure); });
      });
      console.info('[MultiBeat][Chooser] Device selected', { device_id: device.id });
      if (destroyed || !capture.enabled) return;
      if (target && device.id !== target.id) throw new Error('That selection has a different browser device ID. Use Pair HRM to add it; the existing participant label has not been moved.');
      if (!target && devices.has(device.id)) throw new Error('This HRM is already in the dashboard. Use its Resume or Find again button.');
      error('');
      if (!pairedIds.includes(device.id)) pairedIds.push(device.id);
      try { savePairedIds(localStorage, pairedIds); }
      catch { error('This monitor will reconnect on this page, but could not be remembered for future visits.'); }
      const existing = devices.get(device.id);
      const d = existing || makeDevice(device.id, device.name || 'Heart rate monitor', false, device);
      if (existing) {
        await d.manager.stop();
        if (destroyed || !capture.enabled) return;
        d.bluetooth = device; d.manager.device = device;
        console.info('[MultiBeat][Chooser] Restarting selected monitor connection', { device_id: device.id });
      }
      d.manuallyPaused = false;
      void d.manager.start();
    } catch (e) {
      console.warn('[MultiBeat][Chooser] ' + JSON.stringify({ error: e.name, message: e.message }));
      if (e.name === 'AbortError') error('Stopped waiting. Affected reconnects remain paused because Chrome may still have its chooser open. Press Esc in Chrome, then use Resume or Find again.');
      else if (e.name !== 'NotFoundError') error(`Bluetooth chooser: ${e.message}`);
    } finally {
      clearTimeout(selection.timer);
      if (chooser === selection) chooser = null;
      // Cancelling selection must restore retries, but never override an explicit pause.
      for (const { d, generation, stopping } of selection.suspended) {
        await stopping;
        if (!destroyed && capture.enabled && !d.manuallyPaused && !d.manager.enabled && d.manager.generation === generation) void d.manager.start();
      }
      updateControls();
    }
  }
  $('connect').onclick = () => chooseDevice();
  $('cancel-chooser').onclick = () => {
    if (!chooser) return;
    for (const { d, generation } of chooser.suspended) {
      if (d.manager.generation === generation && !d.manager.enabled) d.manuallyPaused = true;
    }
    event('chooser_wait_stopped', 'Stopped waiting for Chrome; affected reconnects remain paused until explicitly resumed.');
    chooser.abort.abort(new DOMException('Stopped waiting for Chrome device selection.', 'AbortError'));
    render();
  };
  const onConnectPointer = e => {
    const button = e.target.closest?.('#connect');
    if (!button) return;
    console.info('[MultiBeat][Controls] ' + JSON.stringify({ event: 'connect_pressed',
      disabled: button.disabled, storage_ready: dbReady, folder_selected: !!capture.directory,
      capture_enabled: capture.enabled, busy, pausing: !!pausing, saving: !!capture.stopping, chooser_pending: !!chooser
    }));
    if (button.disabled) error(pausing || capture.stopping ? 'Capture is still saving. Check the storage status and console for failures.' :
      busy ? 'Another capture operation is still in progress.' :
      !dbReady ? 'Browser storage is not ready. Check the visible storage error.' :
      !capture.directory ? 'Choose an output folder before connecting a monitor.' : 'Resume capture before connecting a monitor.');
  };
  root.addEventListener('pointerdown', onConnectPointer, true);

  function receive(d, sample) {
    if (destroyed || !capture.enabled) return;
    const monotonic = performance.now(), utc = new Date().toISOString();
    d.last = { ...sample, at: monotonic, utc };
    appendTrend(d.history, monotonic, sample.bpm);
    appendRRTrend(d.rrHistory, sample, monotonic, d.rrClock);
    capture.measurement(d, sample, { utc, monotonic });
  }
  function draw(d, now) {
    if (d.node.hidden) return;
    charts.draw(d.node.querySelector('.mini-hr'), d.history, { now, simulated: d.simulated });
    charts.draw(d.node.querySelector('.mini-rr'), d.rrHistory, { now, simulated: d.simulated, metric: 'rr' });
    if (d.expanded) charts.draw(d.detail.querySelector('.history-chart'), d.expandedMetric === 'rr' ? d.rrHistory : d.history, {
      now, simulated: d.simulated, detailed: true, metric: d.expandedMetric,
      windowMs: Number(d.detail.querySelector('.graph-range').value)
    });
    else charts.destroy(d.detail.querySelector('.history-chart'));
  }
  function render() {
    if (destroyed) return;
    const now = performance.now(), filter = $('search').value.trim().toLowerCase();
    let connected = 0;
    for (const d of devices.values()) {
      const display = monitorDisplay(d, now);
      d.updateLabelEditor();
      if (d.status === 'connected') connected++;
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
      const status = d.node.querySelector('.device-status');
      if (status.textContent !== display.text) status.textContent = display.text;
      status.className = 'device-status' + (display.offline ? ' offline' : !display.live ? ' stale' : '');
      d.node.classList.toggle('is-offline', display.offline);
      const note = d.node.querySelector('.connection-note');
      const connectionNote = [display.note, !display.live && d.connectionProblem].filter(Boolean).join(' · ');
      note.textContent = connectionNote; note.hidden = !connectionNote;
      d.node.querySelector('.reading strong').textContent = display.live ? d.last.bpm : '—';
      d.node.querySelector('.contact').textContent = display.live && d.last.contact === false ? 'No skin contact' : '';
      const action = d.node.querySelector('.device-action');
      const canPause = d.manager?.enabled || d.simulated && d.status === 'connected';
      setButtonLabel(action, canPause ? 'Pause' : 'Resume', canPause ? 'pause' : 'resume');
      action.setAttribute('aria-label', `${canPause ? 'Pause' : 'Resume'} ${d.label || d.name}`);
      action.disabled = busy || !capture.enabled;
      const find = d.node.querySelector('.device-find');
      find.hidden = d.simulated || display.live;
      find.disabled = busy || !capture.enabled;
      find.textContent = chooser ? 'Choose in Chrome…' : 'Find again';
      find.setAttribute('aria-label', 'Find ' + (d.label || d.name) + ' again in Chrome');
      draw(d, now);
    }
    $('connected').textContent = String(connected);
    $('device-count').textContent = devices.size;
    $('empty').hidden = devices.size > 0;
    const seconds = Math.floor((capture.recording ? now - capture.started : capture.elapsed) / 1000);
    $('duration').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
    updateControls();
  }
  $('search').oninput = render;
  function startMonitors() {
    if (chooser) return;
    for (const d of devices.values()) if (!d.manuallyPaused) {
      if (d.manager) void d.manager.start();
      else d.status = 'connected';
    }
  }
  $('folder').onclick = async () => {
    if (!window.showDirectoryPicker) return error('Direct folder writing is required. Use desktop Chrome or Edge with the File System Access API.');
    if (busy || folderBrowsing) return;
    busy = true; updateControls();
    try {
      const directory = await window.showDirectoryPicker({ mode: 'readwrite', id: 'hr-recordings' });
      if (destroyed) return;
      capture.setDirectory(directory); capture.resume(); error('');
      startMonitors();
    } catch (e) { if (e.name !== 'AbortError') error(`Folder access: ${e.message}`); }
    finally { busy = false; updateControls(); }
  };
  $('folder-open').onclick = async () => {
    if (!capture.directory || folderBrowsing || chooser) return;
    folderBrowsing = true; updateControls();
    try {
      // Browsing never replaces the destination, even if another folder is selected.
      await window.showDirectoryPicker({ mode: 'read', startIn: capture.directory, id: 'hr-recordings-browse' });
    } catch (failure) {
      if (failure.name !== 'AbortError') error(`Could not browse the output folder: ${failure.message}`);
    } finally { folderBrowsing = false; updateControls(); }
  };
  function acquireWakeLock() {
    wakeLock.update({ enabled: $('keep-awake').checked, recording: capture.recording && capture.enabled,
      visible: document.visibilityState === 'visible' });
  }
  $('keep-awake').onchange = acquireWakeLock;
  async function pauseCapture() {
    if (pausing) return pausing;
    console.info('[MultiBeat][Capture]', { event: 'pause_requested', pending_records: recorder.pending.length });
    if (capture.recording) event('recording_stopped', 'Capture paused; saving remaining data.');
    const saving = capture.pause();
    const stops = [...devices.values()].map(d => { if (d.manager) return d.manager.stop(); d.status = 'paused'; d.rrClock = {}; });
    pausing = (async () => {
      await Promise.all([saving, ...stops]);
      sessionStartedEvent = false;
      console.info('[MultiBeat][Capture]', { event: 'pause_completed', pending_records: recorder.pending.length });
    })().finally(() => { pausing = null; updateControls(); });
    return pausing;
  }
  const onVisibilityChange = () => {
    if (capture.recording && document.visibilityState === 'hidden') event('tab_hidden', 'Tab hidden; browser throttling or sleep can interrupt capture.');
    acquireWakeLock();
    if (document.visibilityState === 'visible') render();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  $('record').onclick = async () => {
    if (busy) return;
    busy = true; updateControls();
    try {
      error('');
      if (capture.enabled) await pauseCapture();
      else {
        console.info('[MultiBeat][Capture]', { event: 'resume_requested' });
        capture.resume();
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
  // Exposed on the mount controller and in DevTools, without a backup panel.
  const recovery = {
    async sessions() { return journal.sessions(); },
    async download(session) {
      await recorder.tail;
      const ids = session ? [session] : await journal.sessions();
      const id = ids[0];
      if (!id) throw new Error('No saved recordings');
      const rows = await journal.all(id);
      const blob = new Blob(rows.map(r => JSON.stringify(r.value) + '\n'), { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${id}-recovery.jsonl`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  };
  async function restorePairedDevices() {
    if (!pairedIds.length) return;
    if (!navigator.bluetooth?.getDevices) {
      event('restore_unavailable', 'This browser cannot restore paired monitors automatically. Choose the output folder, then use Pair HRM.');
      return;
    }
    try {
      const authorized = await navigator.bluetooth.getDevices();
      if (destroyed) return;
      for (const device of authorized) if (pairedIds.includes(device.id) && !devices.has(device.id)) makeDevice(device.id, device.name || 'Heart rate monitor', false, device);
      if (capture.enabled) startMonitors();
      event('paired_restored', 'Remembered monitors restored. Select an output folder to enable automatic capture and reconnection.');
    } catch (e) { event('restore_failed', `Could not restore paired monitors: ${e.message}. Use Pair HRM.`); }
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
  try { await journal.open(); dbReady = true; console.info('[MultiBeat][Recovery] Local recovery tools (sessions / download):', recovery); }
  catch (e) { error(`Browser recovery storage unavailable: ${e.message}. Enable site storage to capture data.`); }
  await restorePairedDevices();
  render();
  return {
    recovery,
    async destroy() {
      charts.destroyAll();
      wakeLock.destroy();
      clearInterval(renderTimer); clearInterval(flushTimer);
      if (chooser) { clearTimeout(chooser.timer); chooser.abort.abort(new DOMException('Dashboard removed.', 'AbortError')); }
      root.removeEventListener('pointerdown', onConnectPointer, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      const paused = pauseCapture();
      destroyed = true;
      await paused;
      journal.db?.close();
    }
  };
}
