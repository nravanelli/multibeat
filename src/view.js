// Static dashboard markup, shared by the standalone page and website embed.
const buttonPaths = {
  pair: 'M7 7l10 10-5 5V2l5 5L7 17',
  pause: 'M8 4v16M16 4v16',
  resume: 'M7 4l14 8-14 8z',
  saving: 'M7 2h10M7 22h10M8 2v5l8 10v5M16 2v5L8 17v5',
  find: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6'
};

export function setButtonLabel(button, label, icon) {
  if (button.dataset.buttonLabel === label && button.dataset.buttonIcon === (icon || '')) return;
  button.replaceChildren();
  if (icon) {
    const svg = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'button-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = button.ownerDocument.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', buttonPaths[icon]);
    svg.append(path); button.append(svg);
  }
  const text = button.ownerDocument.createElement('span');
  text.textContent = label; button.append(text);
  button.dataset.buttonLabel = label; button.dataset.buttonIcon = icon || '';
}

export default `
<header>
  <div class="header-main"><div class="brand"><span id="record-indicator" class="record-indicator" title="Choose a folder to begin"><svg class="beat-heart" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><span id="record-state" class="sr-only" role="status">Choose a folder to begin</span></span><span>MULTIBEAT<small>Capturing heart rate from multiple devices, locally</small></span></div>
  <div class="capture-actions" role="group" aria-label="Capture controls">
    <div class="folder-control"><button id="folder">Choose folder</button><div class="folder-path"><a id="folder-open" class="folder-location" hidden href="#" title="Choose a recording file in the native file picker"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true" focusable="false"><path d="M3 7V4h6l3 3h9v13H3Z"/></svg><span id="folder-name"></span></a></div></div>

    <button id="cancel-chooser" hidden title="Stop waiting in MultiBeat; Chrome may still require Esc to close its chooser">Stop waiting</button>
    <button id="retry" hidden>Retry folder writes</button>

    <div class="audio-reconnect-controls"><div class="sound-controls"><label class="sound-choice sound-choice-stacked"><span class="sr-only">Alert sound for disconnects and write errors</span><select id="alert-tone"><option value="off">Silent</option><option value="chime">Chime</option><option value="ring">Ring</option><option value="beep">Double beep</option><option value="custom">My audio file…</option></select></label><button id="alert-test" type="button" disabled aria-label="Test sound" title="Test sound"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 9 5 0 5-4v14l-5-4H4ZM18 8a6 6 0 0 1 0 8"/></svg></button></div><span id="chrome-features" class="chrome-features" hidden><span id="chrome-feature-state" class="sr-only" role="status"></span><a class="chrome-flag-short" aria-label="Experimental BLE reconnect Chrome setting" href="chrome://flags/#enable-experimental-web-platform-features" title="Chrome may block this link. Open the info button for a copyable address and instructions.">Experimental BLE reconnect</a><button id="chrome-feature-info" class="info-icon" type="button" aria-label="About experimental Bluetooth features" aria-haspopup="dialog">ⓘ</button></span></div>
    <label id="alert-file-label" class="sound-choice" hidden>Audio file <input id="alert-file" type="file" accept="audio/*"></label>
    <span id="sound-state" role="status" hidden></span>
  </div>
    <div class="header-stats"><span class="capture-summary"><strong id="connected">0</strong> connected · <span id="device-count">0</span> devices</span><div class="timer-controls"><label class="keep-awake" title="Keep the screen awake during capture while this tab is visible. Cannot prevent manual sleep, lid closure, or strap sleep."><input id="keep-awake" type="checkbox" role="switch" checked aria-label="Keep awake" aria-describedby="wake-lock-state"><span class="keep-awake-copy"><span>Keep awake</span><span id="wake-lock-state" role="status">During capture</span></span></label><button id="record" type="button" aria-label="Resume capture" title="Resume capture">▶</button><span class="recording-time"><small>Recording time</small><span id="duration" class="capture-duration" aria-label="Total recording time">00:00:00</span></span></div></div>
  </div>

  <div id="storage-alert" class="storage-write-alert" hidden><p id="storage-state" role="alert" hidden></p><button id="storage-alert-dismiss" type="button">Dismiss write alert sound</button></div>
  <div id="compatibility" class="notice" hidden></div>
  <p id="error" class="notice danger" role="alert" hidden></p>
  <div id="disconnect-alert" class="disconnect-alert" hidden><span id="disconnect-message" role="status"></span><button id="alert-dismiss" type="button">Dismiss disconnect alert</button></div>
</header>
<dialog id="recorded-file-dialog" aria-labelledby="recorded-file-title"><h2 id="recorded-file-title">Selected recording file</h2><p id="recorded-file-name"></p><p>Open a text preview in your browser or download a copy. The original recording stays in its folder.</p><div class="modal-actions"><a id="recorded-file-open" target="_blank" rel="noopener">Open file</a><a id="recorded-file-download">Download copy</a><button id="recorded-file-close" type="button">Close</button></div></dialog>
<dialog id="chrome-feature-dialog" aria-labelledby="chrome-feature-title">
  <h2 id="chrome-feature-title">Experimental Bluetooth features</h2>
  <p id="chrome-feature-detail"></p>
  <p>Advertisement watching can help MultiBeat notice a returning strap and retry its connection without pressing Find again. Timed retries already run during capture. This feature cannot guarantee reconnection, restore missing permission, or run while the page is closed.</p>
  <p>A website cannot read or change Chrome’s flag setting. To try it, paste this address into Chrome, set Experimental Web Platform features to Enabled, and relaunch Chrome. Pause capture and finish saving before relaunching. Experimental features can change browser behaviour.</p>
  <a id="chrome-flag-link" href="chrome://flags/#enable-experimental-web-platform-features">chrome://flags/#enable-experimental-web-platform-features</a>
  <p>Chrome may block opening this link from a webpage. Copy the address into the address bar instead.</p>
  <div class="modal-actions"><button id="chrome-flag-copy" type="button">Copy flag address</button><button id="chrome-feature-close" type="button">Close</button></div><p id="chrome-copy-state" role="status"></p>
</dialog>
<main>
  <div class="table-tools"><div class="view-choice" role="group" aria-label="Dashboard view"><button id="view-table" type="button" aria-label="Table view" title="Table view" aria-pressed="true"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/></svg></button><button id="view-grid" type="button" aria-label="Grid view" title="Grid view" aria-pressed="false"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button></div><h1 class="sr-only">Monitor Dashboard</h1><input id="search" type="search" aria-label="Filter devices" placeholder="Filter label or device…"></div>
  <p id="order-state" class="sr-only" role="status"></p>
  <div id="monitor-dashboard" class="device-table-wrap" hidden role="region" aria-label="Monitor dashboard">
    <table id="devices" class="device-table" role="table">
      <caption class="sr-only">Heart rate monitors, participant labels, connection status, and live trends</caption>
      <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Device</th><th scope="col" role="columnheader">Participant label <button class="info-icon" type="button" aria-label="About participant labels" aria-describedby="label-help">ⓘ<span id="label-help" role="tooltip">Click Update to apply your edit to future CSV rows. Earlier rows keep their original label.</span></button></th><th scope="col" role="columnheader">Status</th><th scope="col" role="columnheader">Heart rate</th><th scope="col" role="columnheader">Heart rate · 60s</th><th scope="col" role="columnheader">RR interval (ms) · 60s</th><th scope="col" role="columnheader"><span class="sr-only">Monitor controls</span></th></tr></thead>
      <tbody id="pair-row" class="pair-device-group" role="rowgroup"><tr role="row"><td colspan="7" role="cell"></td></tr></tbody>
    </table>
  </div>
  <div id="empty" class="empty panel"><div class="empty-icon">♡</div><h2>No monitors connected yet</h2><p>Choose a folder above, then use Pair HRM to connect a monitor.<br>Each monitor appears here as a row or card.</p><div id="empty-actions"><button id="connect" class="primary" type="button">Pair HRM</button></div></div>
</main>
<footer class="dashboard-footer"><span>© 2026 Nicholas Ravanelli</span><a class="github-link" href="https://github.com/nravanelli/multibeat" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.82c.56.1.76-.24.76-.54v-2.09c-3.12.68-3.78-1.32-3.78-1.32-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.49-.28-5.11-1.24-5.11-5.54 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3 0 4.31-2.63 5.25-5.13 5.53.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z"/></svg><span>GitHub repository</span></a></footer>
<template id="device-template">
  <tr class="device" role="row">
    <th scope="row" role="rowheader" class="identity-cell"><span class="cell-label">Device</span><span class="device-identity"><button class="device-move" type="button" aria-label="Move monitor" title="Drag to reorder; use arrow keys when focused" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg></button><span class="device-name"></span></span><span class="card-actions"><button class="card-graph-toggle" type="button" aria-expanded="false" aria-label="Expand heart rate graph"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18M6 15l4-5 4 3 6-8"/></svg></button></span></th>
    <td role="cell" class="participant-cell"><span class="cell-label">Participant label <button class="info-icon" type="button" aria-label="Participant labels: click Update to apply edits to future CSV rows; earlier rows keep their original label">ⓘ<span role="tooltip">Click Update to apply edits to future CSV rows. Earlier rows keep their original label.</span></button></span><div class="label-editor"><label><span class="sr-only">Participant label</span><input class="device-label" placeholder="e.g. P01" maxlength="120" title="Type a label, then click Update to apply it to new readings"></label><button class="label-update" type="button" disabled>Update</button></div><p class="label-feedback" role="status">No label set</p></td>
    <td role="cell" class="status-cell"><span class="cell-label">Status</span><span class="device-status" role="status"></span><p class="connection-note" hidden></p></td>
    <td role="cell" class="heart-rate-cell"><span class="cell-label">Heart rate</span><div class="reading"><svg class="card-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><div class="reading-value"><strong>—</strong><button class="card-range-alert info-icon" type="button" hidden aria-label="Heart rate outside reference range"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20ZM12 9v5M12 17v1"/></svg><span class="card-range-help" role="tooltip" popover="manual"></span></button></div><span>bpm</span></div><div class="card-connection" role="status"><svg class="connection-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="connection-retry" d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/><path class="connection-offline" d="m3 3 18 18M8 8l8 8M8 16l3-3M13 11l3-3M12 3v4M12 17v4"/><path class="connection-paused" d="M8 4v16M16 4v16"/></svg><span class="card-connection-label"></span></div><span class="contact"></span><span class="hr-range" role="status" title="Reference bands for resting adults. Activity and fitness affect heart rate; these flags are not a diagnosis."></span><span class="last-received"></span></td>
    <td role="cell" class="hr-trend-cell"><span class="cell-label">Heart rate · 60s</span><button class="trend-toggle" data-metric="hr" aria-expanded="false" title="Expand heart rate history"><div class="mini-trend mini-hr" role="img" aria-label="Heart rate trend over the last 60 seconds"></div></button></td>
    <td role="cell" class="rr-trend-cell"><span class="cell-label">RR interval (ms) · 60s</span><button class="trend-toggle" data-metric="rr" aria-expanded="false" title="Expand RR interval history"><div class="mini-trend mini-rr" role="img" aria-label="RR interval trend in milliseconds over the last 60 seconds"></div></button></td>
    <td role="cell" class="monitor-controls"><button class="device-action">Pause</button><button class="device-find" type="button" hidden title="Cancel this connection attempt and select the same strap again in Chrome">Find again</button></td>
  </tr>
  <tr class="device-detail" role="row" hidden><td role="cell" colspan="7">
    <section class="expanded-trend" aria-label="Expanded monitor history">
      <div class="graph-heading"><h3 class="graph-title">Heart rate history</h3><div class="graph-actions"><label>Metric <select class="graph-metric" aria-label="Graph metric"><option value="hr">Heart rate</option><option value="rr">RR intervals</option></select></label><label>Show <select class="graph-range" aria-label="Heart rate history time window"><option value="60000">Last minute</option><option value="300000">Last 5 minutes</option><option value="1800000">Last 30 minutes</option><option value="3600000" selected>Last 60 minutes</option></select></label><button class="graph-zoom-in" type="button" aria-label="Zoom in on graph">＋</button><button class="graph-zoom-out" type="button" aria-label="Zoom out on graph">−</button><button class="graph-live" type="button" title="Restore the selected live time window">Reset zoom</button><button class="graph-close">Close graph</button></div></div>
      <div class="history-chart" role="group" tabindex="0" aria-label="Heart rate history with time and beats per minute axes" aria-keyshortcuts="+ - Home"></div><p class="graph-view-state" role="status">Live view</p>
      <p class="graph-note">Graphs always follow live data. Hover to inspect values; use ＋/− to change the live time span, and Reset zoom or Home to restore it. Up to 60 minutes of history from this page. Gaps indicate missing readings. RR times are reconstructed from intervals and anchored to browser receipt.</p>
    </section>
  </td></tr>
</template>
`;
