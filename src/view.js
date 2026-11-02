// Static dashboard markup, shared by the standalone page and website embed.
export default `
<header><a class="brand" href="./"><span class="brand-icon">∿</span><span>PULSEDECK<small>HEART RATE / LIVE CAPTURE</small></span></a><span class="local"><i></i> Browser-local data</span></header>
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
    <div><h2>Monitor Dashboard <span id="device-count" class="count">0</span></h2><p>Live readings and a 60-second trend for each monitor.</p></div>
    <div class="toolbar-actions"><input id="search" type="search" aria-label="Filter devices" placeholder="Filter label or device…"><button id="demo">Try demo</button></div>
  </div>
  <div id="demo-notice" class="notice demo" hidden>SIMULATION MODE · Generated data only. Simulation is marked in every recorded row.</div>
  <section id="devices" class="devices" aria-label="Heart rate monitors"></section>
  <div id="empty" class="empty panel"><div class="empty-icon">♡</div><h2>No monitors connected yet</h2><p>Choose a folder above, then connect a heart rate monitor.<br>Each monitor appears here as a card.</p><button id="empty-connect" class="primary">Connect your first monitor</button></div>
  <details class="tools">
    <summary>Activity &amp; recovery</summary>
    <section class="bottom-grid">
      <div class="panel events"><div class="section-heading"><h2>Capture activity</h2><span class="eyebrow">LOCAL TIME</span></div><ol id="activity" aria-live="polite"><li class="muted">Waiting for your first connection.</li></ol></div>
      <div class="panel recovery"><h2>Browser backup</h2><p>A local backup helps recover readings if folder saving is interrupted.</p><div class="recovery-controls"><select id="saved" aria-label="Saved recordings"><option value="">No saved recordings</option></select><button id="export">Export recovery</button></div><small>Downloads a JSONL backup. Clearing site data removes browser backups.</small></div>
    </section>
  </details>
  <footer><span>PULSEDECK</span><span>Keep this tab open during capture. Data stays on your computer.</span></footer>
</main>
<template id="device-template"><article class="device panel"><div class="device-top"><span class="device-index"></span><span class="device-status"></span></div><label class="label-wrap"><span class="sr-only">Participant label</span><input class="device-label" placeholder="Add participant label" maxlength="120"></label><p class="device-name"></p><div class="reading"><strong>—</strong><span>bpm</span><span class="contact"></span></div><canvas width="420" height="64" aria-label="Heart rate trend over the last 60 seconds" role="img"></canvas><div class="device-footer"><span class="last-seen">No samples yet</span><button class="device-action">Pause monitor</button></div><div class="rr">RR interval —</div></article></template>
`;
