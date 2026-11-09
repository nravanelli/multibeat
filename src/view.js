// Static dashboard markup, shared by the standalone page and website embed.
const buttonPaths = {
  pair: 'M7 7l10 10-5 5V2l5 5L7 17',
  pause: 'M8 4v16M16 4v16',
  resume: 'M7 4l14 8-14 8z'
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
    <button id="folder">Choose folder</button>
    <button id="folder-open" class="folder-location" hidden type="button" title="Browse the selected output folder in the native folder dialog"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true" focusable="false"><path d="M3 7V4h6l3 3h9v13H3Z"/></svg><span id="folder-name"></span></button>
    <button id="connect" class="primary">Pair HRM</button>
    <button id="record">▶ Resume capture</button>
    <label class="keep-awake" title="Keep the screen awake during capture while this tab is visible. Cannot prevent manual sleep, lid closure, or strap sleep."><input id="keep-awake" type="checkbox" role="switch" checked aria-label="Keep awake" aria-describedby="wake-lock-state"><span class="keep-awake-copy"><span>Keep awake</span><span id="wake-lock-state" role="status">During capture</span></span></label>
    <button id="cancel-chooser" hidden title="Stop waiting in MultiBeat; Chrome may still require Esc to close its chooser">Stop waiting</button>
    <button id="retry" hidden>Retry folder writes</button>
  </div>
    <div class="header-stats"><span class="capture-summary"><strong id="connected">0</strong> connected · <span id="device-count">0</span> devices</span><span class="recording-time"><small>Recording time</small><span id="duration" class="capture-duration" aria-label="Total recording time">00:00:00</span></span></div>
  </div>
  <p id="storage-state" role="alert" hidden></p>
  <div id="compatibility" class="notice" hidden></div>
  <p id="error" class="notice danger" role="alert" hidden></p>
</header>
<main>
  <div class="table-tools"><h1 class="sr-only">Monitor Dashboard</h1><input id="search" type="search" aria-label="Filter devices" placeholder="Filter label or device…"></div>
  <div class="device-table-wrap" role="region" aria-label="Monitor dashboard">
    <table class="device-table" role="table">
      <caption class="sr-only">Heart rate monitors, participant labels, connection status, and live trends</caption>
      <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Device</th><th scope="col" role="columnheader">Participant label <button class="info-icon" type="button" aria-label="About participant labels" aria-describedby="label-help">ⓘ<span id="label-help" role="tooltip">Click Update to apply your edit to future CSV rows. Earlier rows keep their original label.</span></button></th><th scope="col" role="columnheader">Status</th><th scope="col" role="columnheader">Heart rate</th><th scope="col" role="columnheader">Heart rate · 60s</th><th scope="col" role="columnheader">RR interval (ms) · 60s</th><th scope="col" role="columnheader"><span class="sr-only">Monitor controls</span></th></tr></thead>
      <tbody id="devices" role="rowgroup"></tbody>
    </table>
  </div>
  <div id="empty" class="empty panel"><div class="empty-icon">♡</div><h2>No monitors connected yet</h2><p>Choose a folder above, then connect a heart rate monitor.<br>Each monitor appears here as a row.</p></div>
</main>
<template id="device-template">
  <tr class="device" role="row">
    <th scope="row" role="rowheader" class="identity-cell"><span class="cell-label">Device</span><span class="device-name"></span></th>
    <td role="cell" class="participant-cell"><span class="cell-label">Participant label <button class="info-icon" type="button" aria-label="Participant labels: click Update to apply edits to future CSV rows; earlier rows keep their original label">ⓘ<span role="tooltip">Click Update to apply edits to future CSV rows. Earlier rows keep their original label.</span></button></span><div class="label-editor"><label><span class="sr-only">Participant label</span><input class="device-label" placeholder="e.g. P01" maxlength="120" title="Type a label, then click Update to apply it to new readings"></label><button class="label-update" type="button" disabled>Update</button></div><p class="label-feedback" role="status">No label set</p></td>
    <td role="cell" class="status-cell"><span class="cell-label">Status</span><span class="device-status" role="status"></span><p class="connection-note" hidden></p></td>
    <td role="cell" class="heart-rate-cell"><span class="cell-label">Heart rate</span><div class="reading"><strong>—</strong><span>bpm</span></div><span class="contact"></span></td>
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
