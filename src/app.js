import { parseHeartRate, ReconnectingMonitor, pairingRequestOptions } from './bluetooth.js';
import { setButtonLabel } from './view.js';
import { CaptureWakeLock } from './wake-lock.js';
import { Recorder } from './recorder.js';
import { CaptureSession } from './capture.js';
import { monitorDisplay } from './device-state.js';
import { appendTrend, appendRRTrend } from './trends.js';
import { TrendCharts } from './charts.js';
import { loadPairedIds, savePairedIds } from './settings.js';
import { loadDeviceOrder, moveDevice } from './device-order.js';
import { chromeBluetoothFeatures, heartRateRange, DisconnectEpisodes, DisconnectSound, WriteErrorAlert } from './dashboard-options.js';

export async function startDashboard(root) {
  const $ = id => root.getElementById(id);
  const devices = new Map();
  let deviceOrder;
  try { deviceOrder = loadDeviceOrder(localStorage); } catch { deviceOrder = []; }
  let moving = null;
  const charts = new TrendCharts();
  const recorder = new Recorder(updateControls);
  const capture = new CaptureSession(recorder, { metadata: sessionMetadata, onChange: updateControls });
  let busy = false, destroyed = false, pausing = null;
  let lastStorageError = null;
  let chooser = null;
  let folderBrowsing = false;
  let recordedFileUrl = null;
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

  const outages = new DisconnectEpisodes();
  const writeAlert = new WriteErrorAlert();
  let disconnectAlertActive = false;
  const sound = new DisconnectSound(message => {
    $('sound-state').textContent = message; $('sound-state').hidden = false;
  });
  const features = chromeBluetoothFeatures(navigator, globalThis.BluetoothDevice);
  $('chrome-features').hidden = !features.chrome;
  const reconnectSupport = features.restore && features.advertisements ? 'Reconnect helpers available' : 'Reconnect helpers limited';
  $('chrome-feature-state').textContent = reconnectSupport;
  $('chrome-features').title = reconnectSupport + ' · Open info for details';
  $('chrome-feature-info').setAttribute('aria-label', reconnectSupport + '. About experimental Bluetooth features');
  $('chrome-features').classList.toggle('is-limited', !features.restore || !features.advertisements);
  $('chrome-feature-detail').textContent = `Paired-device restoration: ${features.restore ? 'available' : 'unavailable'}. Advertisement watching: ${features.advertisements ? 'available' : 'unavailable'}. This checks API availability, not the flag value.`;
  $('chrome-feature-info').onclick = () => $('chrome-feature-dialog').showModal();
  $('chrome-feature-close').onclick = () => $('chrome-feature-dialog').close();
  $('chrome-flag-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText('chrome://flags/#enable-experimental-web-platform-features');
      if (!destroyed) $('chrome-copy-state').textContent = 'Copied. Paste into Chrome’s address bar.';
    } catch { if (!destroyed) $('chrome-copy-state').textContent = 'Copy unavailable. Select and copy the address above.'; }
  };
  const tableHead = $('devices').tHead;
  let grid = false;
  try { grid = localStorage.getItem('multibeat-view') === 'grid'; } catch {}
  function setView(view = grid ? 'grid' : 'table') {
    finishMove();
    grid = view === 'grid';
    $('view-table').setAttribute('aria-pressed', String(!grid));
    $('view-grid').setAttribute('aria-pressed', String(grid));
    $('devices').classList.toggle('grid-view', grid);
    if (grid) tableHead.remove();
    else $('devices').insertBefore(tableHead, $('devices').querySelector('tbody'));
    // Grid cards have their own structure; table semantics are restored in table view.
    $('devices').setAttribute('role', grid ? 'list' : 'table');
    $('pair-row').setAttribute('role', grid ? 'listitem' : 'rowgroup');
    $('pair-row').querySelector('tr').setAttribute('role', grid ? 'presentation' : 'row');
    $('pair-row').querySelector('td').setAttribute('role', grid ? 'presentation' : 'cell');
    for (const d of devices.values()) {
      d.hideRangeTooltip();
      d.group.setAttribute('role', grid ? 'listitem' : 'rowgroup');
      const action = d.node.querySelector('.device-action');
      const find = d.node.querySelector('.device-find');
      if (grid) d.node.querySelector('.card-actions').append(find, action);
      else d.node.querySelector('.monitor-controls').append(action, find);
      for (const element of [d.node, d.detail, ...d.node.children, ...d.detail.children]) {
        if (!element.dataset.tableRole) element.dataset.tableRole = element.getAttribute('role');
        element.setAttribute('role', grid ? 'presentation' : element.dataset.tableRole);
      }
    }
    try { localStorage.setItem('multibeat-view', grid ? 'grid' : 'table'); } catch {}
    charts.destroyAll(); render();
  }
  $('view-table').onclick = () => setView('table');
  $('view-grid').onclick = () => setView('grid');
  $('devices').classList.toggle('grid-view', grid);
  if (grid) tableHead.remove();
  $('monitor-dashboard').hidden = devices.size === 0;
  $('alert-tone').onchange = async () => {
    $('sound-state').hidden = true;
    const tone = $('alert-tone').value;
    $('alert-file-label').hidden = tone !== 'custom'; $('alert-test').disabled = tone === 'off';
    await sound.select(tone);
    if (!destroyed) render();
  };
  $('alert-test').onclick = async () => {
    $('sound-state').hidden = true;
    await sound.select($('alert-tone').value);
    if (!destroyed) { render(); if (!sound.active) sound.play(); }
  };
  $('alert-file').onchange = () => {
    const file = $('alert-file').files[0];
    if (!file) return;
    try { sound.setFile(file); $('sound-state').hidden = true; render(); }
    catch (e) { $('sound-state').textContent = e.message; $('sound-state').hidden = false; }
  };
  $('alert-dismiss').onclick = () => { outages.dismiss(); render(); };
  $('storage-alert-dismiss').onclick = () => { writeAlert.dismiss(); updateControls(); };

  function applyDeviceOrder() {
    const rank = new Map(deviceOrder.map((id, index) => [id, index]));
    const ordered = [...devices.values()].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    let before = $('pair-row');
    for (const d of ordered.reverse()) {
      if (d.group.nextElementSibling !== before) $('devices').insertBefore(d.group, before);
      before = d.group;
    }
  }
  function reorderDevice(d, target) {
    const next = moveDevice(deviceOrder, d.id, target.id);
    if (next === deviceOrder) return;
    deviceOrder = next; applyDeviceOrder();
    hideRangeTooltips();
    const visibleOrder = [...$('devices').querySelectorAll('.device-group')].filter(group => !group.hidden);
    $('order-state').textContent = `${d.name} moved to position ${visibleOrder.indexOf(d.group) + 1} of ${visibleOrder.length}.`;
  }
  function saveDeviceOrder() {
    try { localStorage.setItem('multibeat-device-order', JSON.stringify(deviceOrder)); }
    catch { error('Monitor order could not be remembered for future visits. The current order still applies.'); }
  }
  function finishMove(e) {
    if (!moving || e && e.pointerId !== moving.pointerId) return;
    const current = moving; moving = null;
    current.d.group.classList.remove('is-moving');
    if (current.moved) saveDeviceOrder();
    try { current.handle.releasePointerCapture(current.pointerId); } catch {}
  }
  function onMovePointer(e) {
    if (!moving || e.pointerId !== moving.pointerId) return;
    if (!moving.moved && Math.hypot(e.clientX - moving.x, e.clientY - moving.y) < 5) return;
    e.preventDefault(); moving.moved = true;
    moving.d.group.classList.add('is-moving');
    const group = root.elementFromPoint(e.clientX, e.clientY)?.closest('.device-group');
    const target = [...devices.values()].find(d => d.group === group);
    if (target && target !== moving.d) {
      reorderDevice(moving.d, target);
      try { moving.handle.setPointerCapture(e.pointerId); } catch {}
    }
  }
  root.ownerDocument.addEventListener('pointermove', onMovePointer, { passive: false });
  root.ownerDocument.addEventListener('pointerup', finishMove);
  root.ownerDocument.addEventListener('pointercancel', finishMove);
  const finishMoveOnBlur = () => finishMove();
  window.addEventListener('blur', finishMoveOnBlur);

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
    const ready = !!capture.directory && capture.enabled && !settling;
    $('connect').disabled = !ready || folderBrowsing;
    setButtonLabel($('connect'), chooser ? 'Choose in Chrome…' : 'Pair HRM', 'pair');
    $('cancel-chooser').hidden = !chooser;
    $('connect').title = ready ? 'Pair another heart rate monitor' : 'Choose an output folder and enable capture first';
    $('folder').disabled = settling || capture.recording || !!capture.starting || folderBrowsing;
    $('folder').textContent = capture.directory ? 'Change folder' : 'Choose folder';
    $('folder').title = capture.recording ? 'Pause capture to change the output folder' : capture.directory ? `Output folder: ${capture.directory.name}` : 'Choose where readings will be saved';
    $('folder-open').hidden = !capture.directory;
    $('folder-open').setAttribute('aria-disabled', String(folderBrowsing || !!chooser));
    $('folder-name').textContent = capture.directory?.name || '';
    $('folder-open').title = `Open a recording file from ${capture.directory?.name || 'output folder'} using the native file picker. This does not launch Finder/Explorer.`;
    $('folder-open').setAttribute('aria-label', `Browse recording files in ${capture.directory?.name || ''}`);
    $('record').disabled = !capture.directory || settling || !!capture.starting;
    const captureLabel = pausing || capture.stopping ? 'Saving…' : capture.enabled ? 'Pause capture' : 'Resume capture';
    setButtonLabel($('record'), captureLabel, pausing || capture.stopping ? 'saving' : capture.enabled ? 'pause' : 'resume');
    $('record').setAttribute('aria-label', captureLabel); $('record').title = captureLabel;
    const capturingLive = capture.recording && capture.enabled && live;
    const stateText = capture.recording && capture.enabled ? (live ? 'Capturing live data' : 'Waiting for monitors to return') : capture.starting ? 'Preparing recording…' : !capture.directory ? 'Choose a folder to begin' : capture.enabled ? 'Ready — connect a monitor' : 'Capture paused';
    if ($('record-state').textContent !== stateText) $('record-state').textContent = stateText;
    $('record-indicator').classList.toggle('is-recording', !!capturingLive);
    $('record-indicator').title = stateText;
    const storageError = recorder.diskError;
    if (storageError && storageError !== lastStorageError) console.error('[MultiBeat][Storage]', storageError);
    lastStorageError = storageError;
    $('retry').hidden = !recorder.diskError || recorder.setupFailed;
    writeAlert.update(recorder.diskError);
    const storageMessage = recorder.diskError ? recorder.setupFailed ? `Recording setup failed: ${recorder.diskError}. Resume capture to retry before connecting monitors.` : `Folder write failed: ${recorder.diskError}. ${recorder.pending.length} records pending; retry writes before leaving this page.` : '';
    if ($('storage-state').textContent !== storageMessage) $('storage-state').textContent = storageMessage;
    $('storage-alert').hidden = !storageMessage;
    $('storage-alert-dismiss').disabled = !writeAlert.active;
    $('storage-alert-dismiss').textContent = writeAlert.active ? 'Dismiss write alert sound' : 'Write alert sound dismissed';
    $('storage-state').hidden = !storageMessage;
    sound.update(disconnectAlertActive || writeAlert.active);

  }
  async function prepareCapture() {
    if (destroyed) throw new DOMException('Dashboard removed.', 'AbortError');
    const wasRecording = capture.recording;
    try {
      await capture.prepare();
      if (!wasRecording && capture.recording && !sessionStartedEvent) {
        sessionStartedEvent = true;
        event('recording_started', 'Capture started automatically.', { storage: 'folder' });
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
    const group = root.ownerDocument.createElement('tbody');
    group.className = 'device-group'; group.setAttribute('role', 'rowgroup');
    group.append(fragment); d.group = group;
    devices.set(id, d); $('devices').insertBefore(group, $('pair-row'));
    if (!deviceOrder.includes(id)) deviceOrder.push(id);
    applyDeviceOrder();
    const moveHandle = node.querySelector('.device-move');
    moveHandle.setAttribute('aria-label', `Move ${name}. Use arrow keys to reorder.`);
    moveHandle.onpointerdown = e => {
      if (e.button !== 0 || moving) return;
      moving = { d, handle: moveHandle, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      moveHandle.focus({ preventScroll: true });
      try { moveHandle.setPointerCapture(e.pointerId); } catch {}
    };
    moveHandle.onkeydown = e => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const ordered = [...$('devices').querySelectorAll('.device-group')].filter(group => !group.hidden);
      const from = ordered.indexOf(group);
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? ordered.length - 1 : Math.max(0, Math.min(ordered.length - 1, from + (['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 1)));
      const target = [...devices.values()].find(device => device.group === ordered[to]);
      if (target) { reorderDevice(d, target); saveDeviceOrder(); moveHandle.focus({ preventScroll: true }); }
    };
    node.querySelector('.device-name').textContent = name;
    node.querySelector('.device-name').title = `${name} · ${id}`;
    const rangeAlert = node.querySelector('.card-range-alert');
    const rangeHelp = rangeAlert.querySelector('.card-range-help');
    rangeHelp.id = detail.id + '-range-help';
    rangeAlert.setAttribute('aria-describedby', rangeHelp.id);
    let rangePinned = false;
    d.hideRangeTooltip = () => {
      rangePinned = false;
      if (rangeHelp.matches(':popover-open')) rangeHelp.hidePopover();
      rangeHelp.removeAttribute('data-open');
    };
    const showRangeTooltip = () => {
      if (rangeAlert.hidden || d.node.hidden) return;
      rangeHelp.setAttribute('data-open', 'true');
      if (typeof rangeHelp.showPopover === 'function' && !rangeHelp.matches(':popover-open')) rangeHelp.showPopover();
      const anchor = node.querySelector('.reading-value').getBoundingClientRect();
      const bounds = rangeHelp.getBoundingClientRect();
      const left = Math.max(8, Math.min(window.innerWidth - bounds.width - 8, (anchor.left + anchor.right - bounds.width) / 2));
      const below = anchor.bottom + 6;
      const preferredTop = below + bounds.height <= window.innerHeight - 8 ? below : anchor.top - bounds.height - 6;
      const top = Math.max(8, Math.min(window.innerHeight - bounds.height - 8, preferredTop));
      rangeHelp.style.left = left + 'px'; rangeHelp.style.top = top + 'px';
    };
    d.repositionRangeTooltip = () => { if (rangeHelp.hasAttribute('data-open')) showRangeTooltip(); };
    rangeAlert.onpointerenter = showRangeTooltip;
    rangeAlert.onpointerleave = () => { if (!rangePinned && root.activeElement !== rangeAlert) d.hideRangeTooltip(); };
    rangeAlert.onfocus = showRangeTooltip;
    rangeAlert.onclick = () => { if (rangePinned) d.hideRangeTooltip(); else { rangePinned = true; showRangeTooltip(); } };
    rangeAlert.onblur = d.hideRangeTooltip;
    rangeAlert.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); d.hideRangeTooltip(); } };
    const toggles = [...node.querySelectorAll('.trend-toggle')];
    const cardToggle = node.querySelector('.card-graph-toggle');
    cardToggle.setAttribute('aria-controls', detail.id);
    cardToggle.onclick = () => {
      d.expanded = !d.expanded;
      if (d.expanded) { d.expandedMetric = 'hr'; detail.querySelector('.graph-metric').value = 'hr'; }
      render();
    };
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
      (grid ? node.querySelector('.card-graph-toggle') : toggles.find(toggle => toggle.dataset.metric === d.expandedMetric)).focus();
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
    setView();
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
      disabled: button.disabled, folder_selected: !!capture.directory,
      capture_enabled: capture.enabled, busy, pausing: !!pausing, saving: !!capture.stopping, chooser_pending: !!chooser
    }));
    if (button.disabled) error(pausing || capture.stopping ? 'Capture is still saving. Check the storage status and console for failures.' :
      busy ? 'Another capture operation is still in progress.' :
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
    if (!grid) {
      charts.draw(d.node.querySelector('.mini-hr'), d.history, { now, simulated: d.simulated });
      charts.draw(d.node.querySelector('.mini-rr'), d.rrHistory, { now, simulated: d.simulated, metric: 'rr' });
    }
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
      d.node.querySelector('.device-move').setAttribute('aria-label', `Move ${d.label || d.name}. Use arrow keys to reorder.`);
      d.updateLabelEditor();
      if (d.status === 'connected') connected++;
      d.node.hidden = !`${d.name} ${d.label} ${d.id}`.toLowerCase().includes(filter);
      d.detail.hidden = !d.expanded || d.node.hidden;
      d.group.hidden = d.node.hidden;
      d.group.classList.toggle('has-graph', d.expanded);
      d.group.classList.toggle('is-offline', display.offline);
      const cardToggle = d.node.querySelector('.card-graph-toggle');
      cardToggle.setAttribute('aria-expanded', String(d.expanded));
      cardToggle.setAttribute('aria-label', `${d.expanded ? 'Collapse' : 'Expand'} graph for ${d.label || d.name}`);
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
      d.node.classList.toggle('is-live', display.live);
      const note = d.node.querySelector('.connection-note');
      const connectionNote = [display.note, !display.live && d.connectionProblem].filter(Boolean).join(' · ');
      note.textContent = connectionNote; note.hidden = !connectionNote;
      const connection = d.node.querySelector('.card-connection');
      const paused = !capture.enabled || d.manuallyPaused || d.status === 'paused';
      const retrying = ['connecting', 'reconnecting'].includes(d.status);
      connection.dataset.state = paused ? 'paused' : retrying || !display.offline ? 'connecting' : 'offline';
      connection.title = connectionNote;
      const connectionLabel = paused ? !capture.enabled ? 'Capture paused' : 'Monitor paused' : retrying ? d.hasConnected ? 'Reconnecting…' : 'Connecting…' : d.status === 'permission' ? 'Permission needed' : display.offline ? 'OFFLINE · No readings' : 'Waiting for readings…';
      const connectionText = connection.querySelector('.card-connection-label');
      const cardStatus = display.offline && !connectionLabel.startsWith('OFFLINE') ? 'OFFLINE · ' + connectionLabel : connectionLabel;
      if (connectionText.textContent !== cardStatus) connectionText.textContent = cardStatus;
      d.node.querySelector('.reading strong').textContent = display.live ? d.last.bpm : '—';
      const range = heartRateRange(d.last?.bpm, display.live);
      d.node.querySelector('.heart-rate-cell').dataset.range = range.state;
      d.group.dataset.cardState = display.live ? range.state : d.status === 'connecting' || d.status === 'connected' && !display.offline ? 'connecting' : 'offline';
      const rangeFlag = d.node.querySelector('.hr-range');
      if (rangeFlag.textContent !== range.text) rangeFlag.textContent = range.text;
      const rangeAlert = d.node.querySelector('.card-range-alert');
      rangeAlert.hidden = !['low', 'high'].includes(range.state);
      const rangeReason = `${d.last?.bpm} bpm is ${range.state === 'low' ? 'below 60 (bradycardia range)' : 'above 100 (tachycardia range)'}. Reference bands are for resting adults; activity and fitness affect interpretation. This is not a diagnosis.`;
      rangeAlert.setAttribute('aria-label', `Heart rate alert for ${d.label || d.name}`);
      const rangeHelp = rangeAlert.querySelector('.card-range-help');
      if (rangeHelp.textContent !== rangeReason) rangeHelp.textContent = rangeReason;
      if (rangeAlert.hidden || d.node.hidden) d.hideRangeTooltip();
      d.node.querySelector('.last-received').textContent = d.last ? 'Last received ' + new Date(d.last.utc).toLocaleTimeString() : 'No readings received';
      d.node.querySelector('.contact').textContent = display.live && d.last.contact === false ? 'No skin contact' : '';
      const action = d.node.querySelector('.device-action');
      const canPause = d.manager?.enabled || d.simulated && d.status === 'connected';
      setButtonLabel(action, canPause ? 'Pause' : 'Resume', canPause ? 'pause' : 'resume');
      action.setAttribute('aria-label', `${canPause ? 'Pause' : 'Resume'} ${d.label || d.name}`);
      const streaming = capture.recording && capture.enabled && display.live;
      action.classList.toggle('is-streaming', !!streaming);
      action.title = `${streaming ? 'Recording live readings · ' : ''}${canPause ? 'Pause' : 'Resume'} ${d.label || d.name}`;
      action.setAttribute('aria-label', action.title);
      action.disabled = busy || !capture.enabled;
      const find = d.node.querySelector('.device-find');
      find.hidden = d.simulated || display.live;
      find.disabled = busy || !capture.enabled;
      setButtonLabel(find, chooser ? 'Choose in Chrome…' : 'Find again', 'find');
      find.setAttribute('aria-label', 'Find ' + (d.label || d.name) + ' again in Chrome');
      draw(d, now);
    }
    const disconnected = [...devices.values()].filter(d => {
      const display = monitorDisplay(d, now);
      return capture.enabled && !d.manuallyPaused && d.status !== 'paused' && d.hasConnected &&
        (display.offline || outages.current.has(d.id) && !display.live);
    });
    const pendingAlerts = outages.update(disconnected.map(d => d.id));
    $('disconnect-alert').hidden = !pendingAlerts.length;
    const alertMessage = `${pendingAlerts.length} monitor${pendingAlerts.length === 1 ? '' : 's'} offline. Check straps and connection status.`;
    if ($('disconnect-message').textContent !== alertMessage) $('disconnect-message').textContent = alertMessage;
    disconnectAlertActive = pendingAlerts.length > 0;
    $('connected').textContent = String(connected);
    $('device-count').textContent = devices.size;
    $('empty').hidden = devices.size > 0;
    $('monitor-dashboard').hidden = devices.size === 0;
    const pairButton = $('connect');
    const pairTarget = devices.size ? $('pair-row').querySelector('td') : $('empty-actions');
    if (pairButton.parentElement !== pairTarget) pairTarget.append(pairButton);
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
  function releaseRecordedFile() {
    if (recordedFileUrl) URL.revokeObjectURL(recordedFileUrl);
    recordedFileUrl = null;
    $('recorded-file-open').removeAttribute('href'); $('recorded-file-download').removeAttribute('href');
  }
  $('recorded-file-close').onclick = () => $('recorded-file-dialog').close();
  $('recorded-file-dialog').onclose = releaseRecordedFile;
  $('folder-open').onclick = async e => {
    e?.preventDefault();
    if (!capture.directory || folderBrowsing || chooser) return;
    if (!window.showOpenFilePicker) return error('Opening recording files requires a browser with the File System Access API. Open the selected folder in your file manager manually.');
    folderBrowsing = true; updateControls();
    try {
      const [handle] = await window.showOpenFilePicker({ startIn: capture.directory, id: 'hr-recordings-browse',
        types: [{ description: 'Recording files', accept: { 'text/plain': ['.csv', '.json', '.jsonl', '.txt'] } }] });
      if (destroyed) return;
      const file = await handle.getFile();
      if (destroyed) return;
      releaseRecordedFile();
      // Preview as inert text, including files with an unexpected MIME type.
      recordedFileUrl = URL.createObjectURL(new Blob([file], { type: 'text/plain;charset=utf-8' }));
      $('recorded-file-name').textContent = file.name;
      $('recorded-file-open').href = recordedFileUrl;
      $('recorded-file-download').href = recordedFileUrl; $('recorded-file-download').download = file.name;
      $('recorded-file-dialog').showModal();
    } catch (failure) {
      if (failure.name !== 'AbortError') error(`Could not open a recording file: ${failure.message}`);
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
  const hideRangeTooltips = () => { for (const d of devices.values()) d.hideRangeTooltip(); };
  const repositionRangeTooltips = () => { for (const d of devices.values()) d.repositionRangeTooltip(); };
  window.addEventListener('resize', repositionRangeTooltips);
  window.addEventListener('scroll', repositionRangeTooltips, true);
  root.addEventListener('scroll', repositionRangeTooltips, true);
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
  await restorePairedDevices();
  setView();
  return {
    async destroy() {
      finishMove();
      root.ownerDocument.removeEventListener('pointermove', onMovePointer);
      root.ownerDocument.removeEventListener('pointerup', finishMove);
      root.ownerDocument.removeEventListener('pointercancel', finishMove);
      window.removeEventListener('blur', finishMoveOnBlur);
      hideRangeTooltips();
      window.removeEventListener('resize', repositionRangeTooltips);
      window.removeEventListener('scroll', repositionRangeTooltips, true);
      root.removeEventListener('scroll', repositionRangeTooltips, true);
      sound.destroy();
      $('chrome-feature-dialog').close();
      $('recorded-file-dialog').onclose = null;
      $('recorded-file-dialog').close(); releaseRecordedFile();
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
    }
  };
}
