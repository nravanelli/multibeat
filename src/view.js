// Static dashboard markup, shared by the standalone page and website embed.
export default `
<header><a class="brand" href="./"><span class="brand-icon">∿</span><span>BEATSTREAM<small>HEART RATE / LIVE CAPTURE</small></span></a><span class="local"><i></i> Browser-local data</span></header>
<main>
  <div class="heading">
    <div><h1>Live heart rate</h1><p class="subtitle">Choose a folder, then connect your monitors. Capture starts automatically.</p></div>
    <div class="capture-actions" role="group" aria-label="Capture controls">
      <button id="folder">Choose folder</button>
      <button id="connect" class="primary">＋ Connect monitor</button>
      <button id="record">▶ Resume capture</button>
      <button id="retry" hidden>Retry folder writes</button>
    </div>
  </div>
  <div class="capture-status">
    <span class="capture-state"><span id="record-dot" class="dot" aria-hidden="true"></span><span id="record-state" role="status">Choose a folder to begin</span></span>
    <span id="storage-state">An output folder is required before capture.</span>
  </div>
  <div id="compatibility" class="notice" hidden></div>
  <p id="error" class="notice danger" role="alert" hidden></p>
  <section class="stats" aria-label="Capture statistics">
    <div><span>CONNECTED</span><strong id="connected">0</strong></div>
    <div><span>GROUP AVERAGE</span><strong id="average">— <small>bpm</small></strong></div>
    <div><span>READINGS CAPTURED</span><strong id="samples">0</strong></div>
    <div><span>CAPTURE DURATION</span><strong id="duration">00:00:00</strong></div>
  </section>
  <div class="toolbar">
    <div><h2>Monitor Dashboard <span id="device-count" class="count">0</span></h2><p>Use Update label to apply participant changes to new CSV rows. Click a trend to expand.</p></div>
    <div class="toolbar-actions"><input id="search" type="search" aria-label="Filter devices" placeholder="Filter label or device…"><button id="demo">Try demo</button></div>
  </div>
  <div id="demo-notice" class="notice demo" hidden>SIMULATION MODE · Generated data only. Simulation is marked in every recorded row.</div>
  <div class="device-table-wrap" tabindex="0" role="region" aria-label="Monitor dashboard table, scroll horizontally on smaller screens">
    <table class="device-table">
      <caption class="sr-only">Heart rate monitors, participant labels, connection status, and live trends</caption>
      <thead><tr><th scope="col">Device</th><th scope="col">Participant label</th><th scope="col">Status</th><th scope="col">Heart rate</th><th scope="col">Heart rate · 60s</th><th scope="col">RR interval (ms) · 60s</th><th scope="col">Last reading</th><th scope="col"><span class="sr-only">Monitor controls</span></th></tr></thead>
      <tbody id="devices"></tbody>
    </table>
  </div>
  <div id="empty" class="empty panel"><div class="empty-icon">♡</div><h2>No monitors connected yet</h2><p>Choose a folder above, then connect a heart rate monitor.<br>Each monitor appears here as a row.</p><button id="empty-connect" class="primary">Connect your first monitor</button></div>
  <details class="tools">
    <summary>Activity &amp; recovery</summary>
    <section class="bottom-grid">
      <div class="panel events"><div class="section-heading"><h2>Capture activity</h2><span class="eyebrow">LOCAL TIME</span></div><ol id="activity" aria-live="polite"><li class="muted">Waiting for your first connection.</li></ol></div>
      <div class="panel recovery"><h2>Browser backup</h2><p>A local backup helps recover readings if folder saving is interrupted.</p><div class="recovery-controls"><select id="saved" aria-label="Saved recordings"><option value="">No saved recordings</option></select><button id="export">Export recovery</button></div><small>Downloads a JSONL backup. Clearing site data removes browser backups.</small></div>
    </section>
  </details>
  <footer><span>BEATSTREAM</span><span>Keep this tab open during capture. Data stays on your computer.</span></footer>
</main>
<template id="device-template">
  <tr class="device">
    <th scope="row"><span class="device-index"></span><span class="device-name"></span></th>
    <td><div class="label-editor"><label><span class="sr-only">Participant label</span><input class="device-label" placeholder="e.g. P01" maxlength="120" title="Type a label, then click Update label to apply it to new readings"></label><button class="label-update" type="button" disabled>Update label</button></div><p class="label-feedback" role="status">No label set</p></td>
    <td class="status-cell"><span class="device-status" role="status"></span><p class="connection-note" hidden></p></td>
    <td><div class="reading"><strong>—</strong><span>bpm</span></div><span class="contact"></span></td>
    <td><button class="trend-toggle" data-metric="hr" aria-expanded="false" title="Expand heart rate history"><canvas class="mini-trend mini-hr" width="300" height="64" role="img" aria-label="Heart rate trend over the last 60 seconds"></canvas><span class="trend-hint">Expand graph ↗</span></button></td>
    <td><button class="trend-toggle" data-metric="rr" aria-expanded="false" title="Expand RR interval history"><canvas class="mini-trend mini-rr" width="300" height="64" role="img" aria-label="RR interval trend in milliseconds over the last 60 seconds"></canvas><span class="trend-hint">Expand RR graph ↗</span></button></td>
    <td class="last-seen">No samples yet</td>
    <td><button class="device-action">Pause monitor</button></td>
  </tr>
  <tr class="device-detail" hidden><td colspan="8">
    <section class="expanded-trend" aria-label="Expanded monitor history">
      <div class="graph-heading"><h3 class="graph-title">Heart rate history</h3><div class="graph-actions"><label>Metric <select class="graph-metric" aria-label="Graph metric"><option value="hr">Heart rate</option><option value="rr">RR intervals</option></select></label><label>Show <select class="graph-range" aria-label="Heart rate history time window"><option value="60000">Last minute</option><option value="300000">Last 5 minutes</option><option value="1800000" selected>Last 30 minutes</option></select></label><button class="graph-close">Close graph</button></div></div>
      <canvas class="history-chart" width="1100" height="280" role="img" aria-label="Heart rate history with time and beats per minute axes"></canvas>
      <p class="respiration-note">Experimental respiration estimate: collecting RR history.</p>
      <p class="graph-note">Up to 30 minutes of history from this page. Gaps indicate missing readings. RR times are reconstructed from intervals and anchored to browser receipt.</p>
    </section>
  </td></tr>
</template>
`;
