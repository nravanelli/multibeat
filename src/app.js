import { parseHeartRate, subscribe } from './bluetooth.js';
import { Journal, Recorder } from './recorder.js';
const $ = id => document.getElementById(id);
const devices = new Map();
const journal = new Journal();
const recorder = new Recorder(journal, updateRecording);
let directory = null, dbReady = false, recording = false, busy = false, started = 0, stoppedElapsed = 0, sequence = 0;
let demoTimer = null, wakeLock = null;
let savedLabels = {};
try { savedLabels = JSON.parse(localStorage.getItem('hr-labels') || '{}'); } catch {}
const error = message => { $('error').textContent = message; $('error').hidden = !message; };
function event(kind, message, data = {}) {
  const utc = new Date().toISOString();
  const li = document.createElement('li');
  const time = document.createElement('time'); time.textContent = new Date(utc).toLocaleTimeString();
  li.append(time, document.createTextNode(message));
  if ($('activity').firstElementChild?.classList.contains('muted')) $('activity').replaceChildren();
  $('activity').prepend(li);
  while ($('activity').children.length > 80) $('activity').lastElementChild.remove();
  recorder.enqueue({ type: 'event', kind, received_utc: utc, elapsed_ms: recording ? +(performance.now() - started).toFixed(3) : null, message, ...data });
}
function updateRecording() {
  $('samples').textContent = (recorder.count || 0).toLocaleString();
  $('retry').hidden = !recorder.diskError;
  if (recorder.diskError || recorder.journalError) {
    $('storage-state').textContent = [recorder.diskError && `Folder write failed: ${recorder.diskError}. ${recorder.pending.length} records pending; retry writes.`, recorder.journalError && `Browser journal failed: ${recorder.journalError}. ${recorder.directory ? 'Browser recovery may be incomplete.' : 'New samples are not being saved. Stop recording and restore browser storage.'}`].filter(Boolean).join(' ');
    $('storage-state').style.color = '#a0432b';
  } else {
    $('storage-state').style.color = '';
    $('storage-state').textContent = recording || recorder.id ? (recorder.directory ? `${directory.name}/${recorder.id} · ${recorder.part} chunks saved · ${recorder.pending.length} records pending` : 'Browser recovery only · export the recording when finished') : directory ? `Output folder: ${directory.name}` : 'Choose an output folder or use browser recovery storage.';
  }
}
function makeDevice(id, name, simulated = false, bluetooth = null) {
  const node = $('device-template').content.firstElementChild.cloneNode(true);
  const d = { id, name, simulated, bluetooth, label: savedLabels[id] || '', status: 'disconnected', last: null, history: [], count: 0, node, cleanup: null, connecting: false };
  devices.set(id, d); $('devices').append(node);
  node.querySelector('.device-index').textContent = `${simulated ? 'DEMO' : 'MONITOR'} ${String(devices.size).padStart(2, '0')}`;
  node.querySelector('.device-name').textContent = `${name} · ${id}`;
  node.querySelector('.device-name').title = `${name} · ${id}`;
  const input = node.querySelector('.device-label'); input.value = d.label;
  input.addEventListener('change', () => {
    const previous = d.label; d.label = input.value.trim(); input.value = d.label;
    savedLabels[id] = d.label;
    try { localStorage.setItem('hr-labels', JSON.stringify(savedLabels)); } catch { error('Labels cannot be saved between visits. Current labels will still be recorded.'); }
    event('label_changed', `${name}: label changed to ${d.label || '(none)'}`, { device_id: id, previous_label: previous, label: d.label });
  });
  node.querySelector('.device-action').onclick = () => {
    if (d.status === 'connected') { d.cleanup?.(); d.cleanup = null; d.status = 'disconnected'; event('disconnected', `${d.label || d.name} disconnected`, { device_id: id }); render(); }
    else if (!d.simulated) connectDevice(d);
  };
  return d;
}
async function connectDevice(d) {
  if (d.connecting || d.status === 'connected') return;
  d.connecting = true; render();
  try {
    d.cleanup?.(); d.cleanup = null;
    d.cleanup = await subscribe(d.bluetooth, view => {
      try { receive(d, parseHeartRate(view)); }
      catch (e) { event('packet_error', `${d.name}: ${e.message}`, { device_id: d.id }); }
    }, () => {
      d.cleanup?.(); d.cleanup = null; d.status = 'disconnected';
      event('connection_lost', `${d.label || d.name}: connection lost. Use Reconnect.`, { device_id: d.id }); render();
    });
    d.status = 'connected';
    event('connected', `${d.label || d.name} connected`, { device_id: d.id });
  } catch (e) { d.status = 'disconnected'; error(`Could not connect ${d.name}: ${e.message}`); event('connection_error', `${d.name}: ${e.message}`, { device_id: d.id }); }
  finally { d.connecting = false; render(); }
}
async function chooseDevice() {
  if (!navigator.bluetooth) return error('Web Bluetooth is unavailable. Open this app in desktop Chrome or Edge on a supported Bluetooth computer.');
  if (demoTimer) return error('End the demo before connecting physical monitors.');
  try {
    // Must be called directly in the user gesture, once per monitor.
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    error('');
    const d = devices.get(device.id) || makeDevice(device.id, device.name || 'Heart rate monitor', false, device);
    await connectDevice(d);
  } catch (e) { if (e.name !== 'NotFoundError') error(`Bluetooth chooser: ${e.message}`); }
}
$('connect').onclick = chooseDevice; $('empty-connect').onclick = chooseDevice;
function receive(d, sample) {
  const elapsed = performance.now(); const utc = new Date().toISOString();
  d.last = { ...sample, at: elapsed, utc }; d.count++;
  d.history.push({ at: elapsed, bpm: sample.bpm });
  while (d.history.length && (d.history[0].at < elapsed - 60000 || d.history.length > 300)) d.history.shift();
  if (recording) recorder.enqueue({ type: 'measurement', row: {
    session_id: recorder.id, sequence: ++sequence, received_utc: utc,
    elapsed_ms: +(elapsed - started).toFixed(3), device_id: d.id, device_name: d.name, label: d.label,
    simulated: d.simulated, heart_rate_bpm: sample.bpm, contact_detected: sample.contact,
    energy_expended_kj: sample.energy, rr_ticks_1024: sample.rr.join(';'), rr_ms: sample.rrMs.join(';')
  } });
}
function draw(d, now) {
  const canvas = d.node.querySelector('canvas'); const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 420, 64); ctx.strokeStyle = '#eef2ed'; ctx.lineWidth = 1;
  for (const y of [16, 40, 63]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(420, y); ctx.stroke(); }
  const points = d.history.filter(p => now - p.at < 60000);
  if (!points.length) return;
  const min = Math.min(...points.map(p => p.bpm)) - 8, max = Math.max(...points.map(p => p.bpm)) + 8;
  ctx.strokeStyle = d.simulated ? '#9676ad' : '#358065'; ctx.lineWidth = 2; ctx.beginPath();
  let previous;
  for (const p of points) {
    const x = 420 * (1 - (now - p.at) / 60000), y = 58 - (p.bpm - min) / (max - min) * 50;
    if (!previous || p.at - previous.at > 5000) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    previous = p;
  }
  ctx.stroke();
}
function render() {
  const now = performance.now(), filter = $('search').value.trim().toLowerCase();
  let connected = 0; const live = [];
  for (const d of devices.values()) {
    const stale = d.last && now - d.last.at > 5000;
    if (d.status === 'connected') connected++;
    if (d.status === 'connected' && d.last && !stale && d.last.contact !== false) live.push(d.last.bpm);
    d.node.hidden = !`${d.name} ${d.label} ${d.id}`.toLowerCase().includes(filter);
    const status = d.node.querySelector('.device-status');
    status.textContent = d.connecting ? 'CONNECTING' : d.status !== 'connected' ? 'DISCONNECTED' : !d.last ? 'WAITING' : stale ? 'STALE SIGNAL' : d.simulated ? 'SIMULATED' : 'LIVE';
    status.className = 'device-status' + (d.status !== 'connected' ? ' offline' : stale || !d.last ? ' stale' : '');
    d.node.querySelector('.reading strong').textContent = d.last && !stale && d.status === 'connected' ? d.last.bpm : '—';
    d.node.querySelector('.contact').textContent = d.last?.contact === false ? 'No skin contact' : '';
    d.node.querySelector('.last-seen').textContent = d.last ? `${new Date(d.last.utc).toLocaleTimeString()} · ${Math.floor((now - d.last.at) / 1000)}s ago` : 'No samples yet';
    d.node.querySelector('.rr').textContent = d.last?.rrMs.length ? `RR ${d.last.rrMs.map(n => Math.round(n)).join(' / ')} ms` : 'RR interval unavailable';
    const action = d.node.querySelector('.device-action');
    action.textContent = d.connecting ? 'Connecting…' : d.status === 'connected' ? 'Disconnect' : 'Reconnect';
    action.disabled = d.connecting || (d.simulated && d.status !== 'connected');
    draw(d, now);
  }
  $('connected').innerHTML = `${connected} <small>/ 20 target</small>`;
  $('average').innerHTML = `${live.length ? Math.round(live.reduce((a,b) => a+b, 0) / live.length) : '—'} <small>bpm</small>`;
  $('device-count').textContent = devices.size;
  $('empty').hidden = devices.size > 0;
  const seconds = Math.floor((recording ? now - started : stoppedElapsed) / 1000);
  $('duration').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
$('search').oninput = render;
$('folder').onclick = async () => {
  if (!window.showDirectoryPicker) return error('Folder writing is unavailable in this browser. Use desktop Chrome or Edge, or record to browser storage and export recovery.');
  try { directory = await window.showDirectoryPicker({ mode: 'readwrite', id: 'hr-recordings' }); error(''); updateRecording(); }
  catch (e) { if (e.name !== 'AbortError') error(`Folder access: ${e.message}`); }
};
async function acquireWakeLock() {
  if (!recording || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* Keep the stay-awake instruction visible in the footer. */ }
}
document.addEventListener('visibilitychange', () => { if (recording && document.visibilityState === 'hidden') event('tab_hidden', 'Tab hidden; browser throttling or sleep can interrupt capture.'); acquireWakeLock(); });
$('record').onclick = async () => {
  if (busy) return; busy = true; $('record').disabled = true;
  $('folder').disabled = true; $('demo').disabled = true; $('session-label').disabled = true;
  try {
    error('');
    if (recording) {
      event('recording_stopped', 'Recording stopped'); recording = false; stoppedElapsed = performance.now() - started;
      await recorder.stop(); await wakeLock?.release(); wakeLock = null;
      $('record-state').textContent = 'Recording complete';
      $('record').textContent = '● Start recording';
      event('saved', recorder.diskError ? 'Folder incomplete. Retry writes or export browser recovery.' : 'Recording saved locally.');
      await refreshSessions();
    } else {
      if (!dbReady) throw new Error('Browser recovery storage is unavailable; recording cannot start.');
      if (recorder.diskError && recorder.pending.length) throw new Error('Retry the previous session’s folder writes before starting another session. Export recovery if folder access cannot be restored.');
      if (![...devices.values()].some(d => d.status === 'connected')) throw new Error('Connect at least one monitor, or start the demo first.');
      const id = 'hr-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8);
      started = performance.now(); sequence = 0; stoppedElapsed = 0;
      await recorder.start(directory, { session_id: id, label: $('session-label').value.trim(), started_utc: new Date().toISOString(), timestamp_basis: 'Browser receipt UTC (wall clock); elapsed_ms uses monotonic performance.now(). No sensor clock synchronization.', format_version: 1, mode: demoTimer ? 'simulation' : 'bluetooth', devices: [...devices.values()].map(d => ({ id: d.id, name: d.name, label: d.label, simulated: d.simulated, status: d.status })) });
      recording = true; acquireWakeLock();
      event('recording_started', 'Recording started', { storage: directory ? 'folder_and_browser' : 'browser_only' });
      $('record-state').textContent = demoTimer ? 'Recording simulated data' : 'Recording live data';
      $('record').textContent = '■ Stop recording';
    }
  } catch (e) { error(e.message); }
  finally {
    busy = false; $('record').disabled = false;
    $('folder').disabled = recording; $('session-label').disabled = recording; $('demo').disabled = recording;
    $('record-dot').classList.toggle('active', recording); updateRecording(); render();
  }
};
$('retry').onclick = async () => { $('retry').disabled = true; try { await recorder.flush(); if (!recording) await recorder.stop(); } finally { $('retry').disabled = false; } };
$('demo').onclick = () => {
  error('');
  if (demoTimer) {
    clearInterval(demoTimer); demoTimer = null;
    for (const [id,d] of devices) if (d.simulated) { d.node.remove(); devices.delete(id); }
    $('demo').textContent = 'Try 20-device demo'; $('demo-notice').hidden = true; $('connect').disabled = false; event('demo_stopped', 'Simulation ended.'); render(); return;
  }
  if (devices.size) return error('Reload the page with no physical monitors connected to start a clean demo.');
  for (let i = 0; i < 20; i++) {
    const d = makeDevice(`demo-${i + 1}`, `Simulated H10 ${String(i+1).padStart(2,'0')}`, true);
    d.label = `Participant ${String(i+1).padStart(2,'0')}`; d.node.querySelector('.device-label').value = d.label; d.status = 'connected';
  }
  const tick = () => {
    let i = 0;
    for (const d of devices.values()) {
      if (d.status !== 'connected') { i++; continue; }
      const bpm = Math.round(66 + i * 2 + Math.sin(performance.now() / 10000 + i) * 8 + Math.random() * 3);
      const rr = [Math.round(60 / bpm * 1024)]; receive(d, { bpm, contact: true, energy: null, rr, rrMs: rr.map(n => n * 1000 / 1024) }); i++;
    }
    render();
  };
  demoTimer = setInterval(tick, 1000); tick();
  $('demo').textContent = 'End demo'; $('demo-notice').hidden = false; $('connect').disabled = true;
  event('demo_started', '20 simulated monitors connected. No physical devices are involved.');
};
async function refreshSessions() {
  const selected = $('saved').value;
  const sessions = await journal.sessions(); $('saved').replaceChildren();
  for (const id of sessions) { const option = document.createElement('option'); option.value = id; option.textContent = id; $('saved').append(option); }
  if (!sessions.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No saved sessions'; $('saved').append(option); }
  if (sessions.includes(selected)) $('saved').value = selected;
  $('export').disabled = !sessions.length;
}
$('export').onclick = async () => {
  if (!$('saved').value) return;
  $('export').disabled = true;
  try {
    const rows = await journal.all($('saved').value);
    const blob = new Blob(rows.map(r => JSON.stringify(r.value) + '\n'), { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${$('saved').value}-recovery.jsonl`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { error(`Recovery export failed: ${e.message}`); }
  finally { $('export').disabled = false; }
};
window.addEventListener('beforeunload', e => {
  if (recording || recorder.pending.length && recorder.directory) { e.preventDefault(); e.returnValue = ''; }
});
setInterval(render, 1000);
setInterval(() => { if (recording) recorder.flush(); }, 5000);
if (!window.isSecureContext || !navigator.bluetooth || !window.showDirectoryPicker) {
  $('compatibility').hidden = false;
  $('compatibility').textContent = 'For Bluetooth and direct folder recording, use desktop Chrome or Edge on HTTPS or localhost. This browser can still run the simulation and, with IndexedDB, browser-only recording.';
}
try { await journal.open(); dbReady = true; await refreshSessions(); }
catch (e) { error(`Browser recovery storage unavailable: ${e.message}. Enable site storage to record.`); $('record').disabled = true; }
render();
