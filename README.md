# MultiBeat

**Capturing heart rate from multiple devices, locally.**

MultiBeat is a browser-only dashboard for collecting heart-rate data from multiple Bluetooth LE monitors, including compatible Powr Labs straps and Polar H10 devices. Connect monitors, assign participant labels, view live heart rate and RR intervals, and record to a folder on your computer.

Plain JavaScript, HTML, and CSS. **No npm, package installation, build step, application backend, account, or data uploads.** Graphs use a locally bundled copy of [uPlot](https://github.com/leeoniya/uPlot), with no CDN requests. Connect as many monitors as your browser and Bluetooth hardware support; MultiBeat imposes no connection cap.

## Embed in an existing website

Upload `hr-monitor.js`, `styles.css`, and the complete `src/` and `vendor/` directories together. Preserve their relative paths and load them from an HTTPS website:

```html
<div id="heart-rate-monitor"></div>
<script type="module">
  import { mountHeartRateMonitor } from '/multiBeat/hr-monitor.js';

  const monitor = await mountHeartRateMonitor(
    document.getElementById('heart-rate-monitor')
  );
</script>
```

Replace `/multiBeat/` with your uploaded directory. The mount API loads the dashboard and stylesheet into a shadow root, keeping its styles and IDs separate from the host page. Mount one dashboard per page. Before removing it, call:

```js
await monitor.destroy();
```

Teardown stops capture, saves pending data where possible, releases connections and wake locks, and removes timers and listeners. Surface any rejected teardown promise so a storage failure is not mistaken for a successful save.

The host must serve `.js` files with a JavaScript MIME type and allow the modules and stylesheet through its Content Security Policy. If inline scripts are prohibited, put the import in a separate `.js` module. Use a top-level page; its Permissions Policy must allow Bluetooth and folder access.

For a standalone website, also upload `index.html` and open that page. Node.js and `server.js` are not needed on the host or on visitors' computers.

## What you need

- Desktop Chrome or Edge with Web Bluetooth, direct folder access, and IndexedDB available.
- An HTTPS website, or `http://localhost` for local testing. Double-clicking `index.html` through `file://` is not supported.
- Monitors exposing the standard **Heart Rate Service** (`0x180D`) and **Heart Rate Measurement** characteristic (`0x2A37`). A brand name alone does not establish protocol compatibility.
- Permission to use each monitor and write to a local output folder.

Standard heart-rate notifications are supported. Polar-specific ECG/accelerometer streaming and ANT+ are outside the current scope. RR intervals, skin-contact detection, and energy expenditure are recorded only when reported by the monitor; missing RR values are never calculated from heart rate. There is no respiratory-rate estimation.

## Record data

1. Select **Choose folder** and grant read/write access. An output folder is required before pairing or capture.
2. Wear or activate the strap, then click **Pair HRM** and select it. Repeat for additional monitors.
3. Recording starts automatically when the first monitor connects. Session files are prepared before notifications are enabled so the first sample can be captured. Later monitors join that session.
4. Enter a participant code and click **Update**. Edits remain drafts until you activate the button. Committed changes apply to future CSV rows; earlier rows and filenames remain unchanged. The applied label is shown below the field.
5. Click a heart-rate or RR trend to expand the device's graph. Choose the metric and a window of 1, 5, 30, or **60 minutes**. Mini graphs show the latest 60 seconds. Visible graphs always follow incoming data. Hover to inspect values or use the ＋/− buttons to change the live lookback duration; the right edge stays at now even when zoomed. **Reset zoom** restores the selected time window. With the chart focused, use +/− to zoom and Home to reset. There is no frozen or historical pan mode. History is collected while this page is open; it is not loaded from old recordings.
6. Use a row's **Pause / Resume** control for one monitor. **Pause capture** stops all connections and retries and saves queued data. **Resume capture** starts a new session when the next monitor connects. Individually paused monitors remain paused.
7. Before closing or refreshing, pause capture and resolve any visible storage errors. **Retry folder writes** retries retained data after a folder failure.

The header contains the pairing and folder controls, Keep awake switch, connected/device counts, and recording timer. The filter sits above the table. Offline devices stay in the table with their participant labels and an explanation; old readings are not displayed as live data.

The heart beside MultiBeat pulses only while capture is enabled and at least one monitor has fresh readings. Reduced-motion preferences disable the animation. This indicates acquisition, not confirmation that every pending disk write has completed.

The selected folder name stays visible. Clicking it opens the native folder dialog with that folder as the suggested starting location. Browsing or selecting another folder in this dialog does not change the recording destination. Browsers cannot directly launch Finder/Explorer or expose the folder's absolute path. Pause and use **Change folder** to change the destination.

### Keep awake

The larger **Keep awake** switch is enabled by default. During visible capture, it requests a screen wake lock:

| Status | Meaning |
| --- | --- |
| Active | The browser granted the screen wake lock. |
| During capture | Enabled; waiting for a recording to start. |
| Off | Disabled by the user. |
| Tab hidden | The page is not visible; the lock is released. |
| Not active | The browser rejected or released the lock; switch off/on to retry. |
| Unavailable | This browser does not provide the API. |

Pause releases the lock. Returning to the visible tab requests it again if capture and the switch remain enabled. It cannot override manual sleep, closing the laptop lid, browser suspension, or the strap's own power management.

## Recording format

Each session creates a unique subfolder under the selected output folder:

```text
selected-folder/
  multibeat-2026-11-09T03-00-00-000Z-a1b2c3d4/
    session.json
    measurements.csv
    events.jsonl
```

- **`session.json`**: application name, session identity, format version, start time, devices known when the session was created, and timestamp basis.
- **`measurements.csv`**: one shared CSV for all devices in the session, with one header. Use `device_id` to separate device streams and `label` for the participant label at receipt.
- **`events.jsonl`**: connection, label, and recording events, one JSON object per line. Devices joining later are represented in measurements and connection events.

The current format version is **5**. Existing version 1–4 recordings and browser recovery records remain untouched and readable; earlier files may have different columns, including retired respiratory estimates. Rebranding does not rewrite existing files. New metadata uses `application: "MultiBeat"` and session folders use the `multibeat-` prefix.

### Measurement columns

| Column | Contents |
| --- | --- |
| `session_id` | Unique recording identity. |
| `sequence` | Increasing measurement sequence within the session. |
| `received_utc` | Browser wall-clock receipt time in UTC. |
| `elapsed_ms` | Monotonic elapsed milliseconds since session start. |
| `device_id` | Browser-provided device identity. |
| `device_name` | Device name at receipt. |
| `label` | Committed participant label at receipt. |
| `simulated` | Whether the measurement was simulated; retained for tests and legacy data. |
| `heart_rate_bpm` | Reported heart rate. |
| `contact_detected` | `true`, `false`, or blank when contact detection is unsupported. |
| `energy_expended_kj` | Reported energy expenditure, or blank when absent. |
| `rr_ticks_1024` | Reported RR intervals in 1/1024-second ticks, separated by semicolons. |
| `rr_ms` | Those RR intervals converted to milliseconds, separated by semicolons. |

The schema is exported as `COLUMNS` in `src/recorder.js`. CSV serialization quotes special characters and escapes leading spreadsheet-formula characters in text. JSONL recovery retains the original strings. Contact flags and reported RR intervals are preserved in recordings even when no skin contact is detected.

### Timestamps and long recordings

Standard notifications do not provide synchronized sensor timestamps. `received_utc` is when the browser receives the notification, including transport and scheduling latency. Wall-clock corrections can change it; `elapsed_ms` uses `performance.now()`. Multiple RR intervals in one notification share a receipt timestamp. Do not interpret recordings as precisely synchronized ECG or absolute beat times across devices.

Files are appended and closed about every five seconds, using bounded write batches rather than creating a new file for each batch. Temporary dropouts keep the same session and CSV sequence. Explicitly pausing and resuming capture creates a new session folder. A notification is not durable until the corresponding storage operation completes; an abrupt crash can lose recent data.

Display history is bounded to 60 minutes: at most 3,601 HR points and 24,001 RR points per device. RR graphs use reported intervals on a receipt-anchored relative timeline and leave gaps where readings are absent. Graph filtering and display bounds do not remove recorded measurements. Folder-write failures can leave an in-memory backlog; resolve errors promptly during long collections.

## Reconnection and browser limits

MultiBeat retries disconnected monitors while capture is enabled and the page is open. Delays increase from 1 to 2, 4, 8, 16, then at most 30 seconds between failed attempts. A link that sends no valid readings for 15 seconds is refreshed even if Chrome has not reported a disconnect. Connection setup has a 60-second GATT timeout and 15-second timeouts for subsequent Bluetooth steps. Application cancellation cannot guarantee that a stuck native operation has ended.

Already authorized monitors can reconnect through `device.gatt.connect()` without a chooser. Where `navigator.bluetooth.getDevices()` is available, MultiBeat restores only devices previously paired through MultiBeat. Selecting an output folder enables capture; restoration does not bypass that requirement. These APIs do not guarantee that a strap is currently discoverable or connectable.

Where available, `watchAdvertisements()` listens for returning devices and triggers another connection attempt when an advertisement arrives. Some Chrome configurations do not expose this experimental API. You can check availability in the console:

```js
typeof BluetoothDevice.prototype.watchAdvertisements
```

`"undefined"` means the advertisement-watching path is unavailable. Normal retries continue. Receiving an advertisement is not a guarantee that GATT connection setup will succeed. See the [Web Bluetooth implementation status](https://github.com/whatwg/bluetooth/blob/main/implementation-status.md) for browser and flag limitations.

If retries repeatedly fail, use **Find again** on the existing row. It requires a real click and selection, filters by the strap's exact advertised name when available, and verifies the selected device ID. A different ID does not inherit the participant label. **Pair HRM** excludes known advertised names where supported and rejects duplicate IDs; a new strap sharing a known name may also be hidden.

While a chooser is pending, pending/retrying connections are suspended; healthy links keep recording. Cancelling the chooser restores eligible retries. **Stop waiting** releases the application's wait and leaves affected reconnects paused for explicit Resume/Find again. It cannot dismiss Chrome's native chooser; close that dialog with Esc if needed.

Physical capacity and reconnection reliability depend on the monitor, Bluetooth adapter, operating system, browser, competing connections, and radio environment. Test the intended monitors together on the collection computer. Nothing runs after the page is closed, and neither wake locks nor synthetic tests guarantee uninterrupted hardware acquisition.

## Local recovery and privacy

Measurements and events are also journaled in IndexedDB in this browser profile and origin. Folder and journal failures are reported separately. Keep the profile: private browsing, clearing site data, or browser eviction can remove recovery records. Moving from localhost to GitHub Pages creates a different origin, so device permissions, participant labels, and recovery records do not automatically transfer.

New recovery records use the `multibeat-hr` browser database. Recovery also discovers earlier app journals by their schema and session metadata when the browser supports database enumeration; it reads them without copying, modifying, or deleting them. In browsers without enumeration, older journals remain stored but cannot be listed by the new recovery tools. Paired IDs now use `multibeat-paired`. When that key is absent, one unambiguous prior `-paired` list is copied to it without deleting the original; conflicting lists are not automatically restored. Participant labels remain under `hr-labels`.

Open Developer Tools → Console and filter for **MultiBeat**. The `[MultiBeat][Recovery]` entry exposes `sessions()` and `download(sessionId)`; use Chrome's **Store object as global variable** action on that object to call them. Embeddings can use the mount controller:

```js
const sessions = await monitor.recovery.sessions();
if (sessions.length) await monitor.recovery.download(sessions[0]);
```

Recovery downloads JSONL containing original session metadata, measurements, and events. Exporting reads the selected journal session into memory, so very large exports can exceed browser memory. Recovery complements checked folder files; it is not a guarantee against storage loss. Bluetooth diagnostics include IDs, stages, errors, and retry delays, without raw measurements or participant labels.

Keep recordings, exports, browser profiles, and participant labels out of the repository. `recordings/` is ignored; choose an output folder outside the checkout.

## Test locally without Node

From the repository root, if Python 3 is installed:

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Open **http://localhost:5173/** in desktop Chrome or Edge. Leave the terminal running; Ctrl+C stops the preview. Pause and save before refreshing to load source changes.

This only serves static website files. All acquisition and recording still happen in the browser. Alternatively, maintainers with Node.js 22.7+ can run `node server.js` for the optional static preview helper.

## Optional GitHub Pages hosting

You can host the standalone app directly from an existing GitHub repository:

1. In the `multiBeat` repository, open **Settings → Pages**.
2. Choose **Deploy from a branch**, branch **main**, folder **/(root)**, and save.
3. Open the URL GitHub displays, typically `https://YOUR_USERNAME.github.io/multiBeat/`.

The included `.nojekyll` file allows the plain static assets to be served without Jekyll processing. There is no npm install, Node application, or application build step. Relative imports support the `/multiBeat/` subdirectory. Hosting publishes the app's source files; participant recordings remain on each visitor's computer. Keep recordings outside the repository before pushing or enabling Pages.

See [GitHub's Pages publishing instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site). Hosting configuration is separate from editing this repository; these instructions do not create a remote or deploy anything automatically.

## Development

Use Node.js 22.7+ for the optional checks without installing packages. `.js` modules use Node's syntax detection; no package manifest is required.

```sh
node --test
node --check hr-monitor.js
node --check src/app.js
node scripts/smoke.js
```

If a static preview is already running on port 5173, use `node scripts/smoke.js --reuse-server`. The smoke check verifies asset responses, not browser rendering or physical Bluetooth. Tests use synthetic data; they do not establish radio capacity or hardware reliability. Follow [AGENTS.md](AGENTS.md) when modifying the repository.

| Path | Responsibility |
| --- | --- |
| `hr-monitor.js` | Public mount API, relative asset loading, teardown. |
| `index.html` | Standalone website using the same mount API. |
| `src/view.js`, `styles.css` | Dashboard markup, icons, and responsive styles. |
| `src/app.js` | Interaction, device restoration, labels, and recovery tools. |
| `src/bluetooth.js` | Packet parsing, notifications, cancellation, and reconnection. |
| `src/capture.js`, `src/recorder.js` | Session lifecycle, CSV writes, and journal. |
| `src/trends.js`, `src/device-state.js` | Bounded display history and live/offline status. |
| `src/charts.js`, `vendor/uplot/` | Interactive HR/RR plots and pinned uPlot 1.6.32 with its MIT license. |
| `src/settings.js` | Pairing settings and compatibility with earlier saved choices. |
| `src/wake-lock.js` | Capture-only screen wake lock and its toggle. |
| `test/`, `test-support/` | Node built-in tests and synthetic storage helpers. |
| `server.js`, `scripts/smoke.js` | Optional local preview and asset verification. |

## AI development disclosure

MultiBeat was developed with assistance from AI tools, including OpenAI Codex, for code, interface design, documentation, testing, and troubleshooting. Project requirements and development decisions were directed by the human maintainer. AI assistance and automated tests do not establish clinical validity or guarantee compatibility with every monitor, browser, or Bluetooth adapter.

## Third-party graph library

[uPlot 1.6.32](https://github.com/leeoniya/uPlot/tree/1.6.32) is bundled under `vendor/uplot/` and loaded from the same origin as MultiBeat. Its MIT license and upstream source/checksums are included in that directory. Deploy `vendor/` alongside `src/`, `styles.css`, and `hr-monitor.js`. There is no npm installation or runtime CDN dependency.

## References

- [Bluetooth SIG Heart Rate Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/HRS_v1.0/out/en/index-en.html)
- [Chrome: Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)
- [Chrome: Automatic reconnection](https://googlechrome.github.io/samples/web-bluetooth/automatic-reconnect-async-await.html)
- [Chrome: Advertisement discovery and connection](https://googlechrome.github.io/samples/web-bluetooth/watch-advertisements-and-connect-async-await.html)
- [Chrome: File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Chrome: Screen Wake Lock API](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock)
