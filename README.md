# Beatstream · Browser heart-rate capture

A dependency-free JavaScript web application for receiving standard Bluetooth LE heart-rate notifications from multiple monitors, showing a live dashboard, and recording to a user-selected local folder. Acquisition, processing, storage, and recovery run in the browser. No account, backend, cloud upload, analytics, CDN, or build step.

## Import into an existing website

No local server, Node.js, npm, framework, or build tools are needed to use the app on your website. Upload `hr-monitor.js`, `styles.css`, and the `src/` directory together, preserving their relative paths. On your HTTPS page, add:

```html
<div id="heart-rate-monitor"></div>
<script type="module">
  import { mountHeartRateMonitor } from '/beatstream/hr-monitor.js';

  const monitor = await mountHeartRateMonitor(
    document.getElementById('heart-rate-monitor')
  );
</script>
```

Replace `/beatstream/` with the uploaded directory. The entry module loads its own dashboard markup and stylesheet; you do not need to copy the dashboard HTML into your page. The dashboard uses a shadow root to isolate its IDs and styles from the rest of your site. Mount one dashboard per page. For a single-page application, call `await monitor.destroy()` before removing its container; this stops capture, flushes pending writes, releases connections, and removes timers and page listeners.

Your website serves ordinary static assets. All Bluetooth acquisition and file writing happen in the visitor's browser, to a folder that visitor selects on their computer. There is no application backend or data upload. Configure your hosting to serve `.js` as `text/javascript` (or another valid JavaScript MIME type). Use desktop Chrome or Edge with the required browser APIs available. The page's Content Security Policy must permit these modules and the stylesheet; use an external entry script if inline modules are disallowed. The site's Permissions Policy must permit Bluetooth on its own origin, and should not disable folder pickers. Load in the main page rather than an iframe.

Bluetooth and folder access require a secure context and user permission. An existing HTTPS website supplies that context; `file://` is not a supported launch method for this module application. Importing the module renders the controls but does not bypass the connection or folder permission dialogs.

## Use as a standalone website

Upload `index.html`, `hr-monitor.js`, `styles.css`, and `src/` to any HTTPS static website, preserving the directory layout. Open that page directly in desktop Chrome or Edge. Files such as `server.js`, `scripts/`, `test/`, and Git metadata do not need to be uploaded.

## Optional local development

Only if you want to preview the app locally without using your website, Node.js 22.7+ can serve these static files:

```sh
node server.js
```

Then open **http://localhost:5173**. This optional development helper does not participate in Bluetooth acquisition or receive recordings. It is not required on the website or on users' computers.

Maintainers can run automated tests with `node --test`. No npm, package manager, dependency installation, or build step is required. All JavaScript files use `.js`. The optional development commands use Node.js 22.7+ to recognize ES module syntax without a package manifest. Browser imports use native modules and need no Node flags.

## Collect data

1. Choose an output folder and grant read/write permission. A folder is mandatory for both physical monitors and the demo; there is no browser-only recording mode. Folder selection, Connect monitor, and Pause/Resume capture are grouped at the top. There is no session label to enter.
2. Wear/activate each strap and disconnect competing apps if needed. Click **Connect monitor** and select a device in the Bluetooth chooser. Repeat for additional devices. There is no application-imposed connection limit or fixed target count.
3. Capture starts automatically when the first monitor establishes its heart-rate service connection. Beatstream prepares the session files before enabling notifications, so the first readings are included. Later monitors join the same session. There is no separate Start recording step.
4. Type a participant label in the table’s **Participant label** column, then click the adjacent **Update label** button to apply it. Typing, pressing Enter in the input, or leaving the field does not change the applied label. An unapplied draft is marked and the currently applied value remains visible below it. Each measurement CSV row contains that label in its `label` column. Applying a new label affects subsequent measurements, not existing rows or filenames. Labels are remembered in this browser profile. Measurements carry the label in effect at receipt; changes are logged as events. Prefer participant codes to personal names.
5. If a monitor goes out of range, Beatstream keeps the recording session open and retries the connection automatically. Readings resume in the same session when the connection succeeds. No missing measurements are fabricated or backfilled.
6. Use **Pause monitor** to stop one monitor and its retries. Use **Reconnect** in that row to enable it again. **Pause capture** disconnects all monitors, cancels retries, and drains remaining writes. **Resume capture** enables automatic connections again; the next successful connection begins a new session. Monitors individually paused stay paused until explicitly reconnected.
7. Open **Activity & recovery** below the monitor table for capture events and browser backup export. Check folder errors before closing the page. **Retry folder writes** retries retained batches. Pending failed writes must be saved before a new session can start. **Export recovery** downloads the selected session as JSONL, including metadata, measurements, and events.

Keep the page open and the computer awake. The app requests a screen wake lock when supported, but cannot guarantee operation during sleep, background throttling, or a closed tab. Folder writes are batched every five seconds; recovery is also journaled in this browser.

**Try demo** creates twelve labelled simulated monitors, using the same folder requirement and automatic capture path. Twelve is only the example dataset size, not a physical-device limit. All generated measurements have `simulated=true`, and session metadata identifies simulation mode. Use a fresh page without restored monitors for the isolated demo, and end it before connecting real devices.

## Monitor table and expanded graphs

Each monitor has a row showing its device name/ID, editable participant label, status, current heart rate and available RR intervals, a rolling 60-second trend, last-reading time, and pause/reconnect control. Offline rows stay visible. On small screens, scroll the table horizontally.

Click the mini trend (or focus it and press Enter/Space) to expand a larger graph directly below that row. Choose **Last minute**, **Last 5 minutes**, or **Last 30 minutes**. The graph updates live with time and bpm axes, preserves visible gaps longer than five seconds, and shows only history collected since the page was opened. Close it with **Close graph** or the mini trend again. Filtering hides both the device row and its expanded graph together. Display downsampling does not change recording frequency or values in the CSV files.

## Automatic reconnection

While capture is enabled and the page is open, disconnected or out-of-range monitors retry indefinitely with delays of 1, 2, 4, 8, 16, then at most 30 seconds between completed failed attempts. Each successful return creates a fresh notification subscription. Only one connection attempt runs per monitor at a time. Explicitly pausing a monitor, pausing capture, or destroying the dashboard cancels its retries. Permission/security errors require restoring browser access and using **Reconnect**; an unsupported service may require choosing a compatible monitor.

Beatstream remembers the IDs of monitors selected through its Bluetooth chooser. On a later visit, where `navigator.bluetooth.getDevices()` is available, it restores only those remembered devices still authorized for the same origin. Choose an output folder again to enable their connections and automatic capture; folder permission is not assumed across reloads. If this API is unavailable, or site/device permissions have been cleared, use **Connect monitor** again. Operating-system pairing alone does not authorize a website.

Reconnection is a best effort within browser Bluetooth capabilities. Radio availability, existing links to other apps, revoked permissions, background suspension, device firmware, and system sleep can prevent or delay it. Nothing runs after the page is closed. Beatstream does not continuously scan arbitrary unpaired devices, bypass permission prompts, or promise an exact range-detection time.

## Device compatibility and capacity

The app uses the Bluetooth SIG Heart Rate Service (`0x180D`) and Heart Rate Measurement characteristic (`0x2A37`). Powr Labs documents standard Bluetooth Smart heart-rate profiles; Polar H10 also supports Bluetooth heart rate. Powr Labs and Polar are separate products, so a Powr Labs model should not be assumed to offer Polar-specific features. RR intervals, contact detection, and energy values are recorded only when supplied by the monitor. An absent RR interval is not synthesized from heart rate.

The connection count shows the actual number connected, with no target denominator. Connect as many monitors as your actual setup can sustain. Practical capacity depends on the operating system, adapter, drivers, browser, radio environment, and other active connections. Browser code cannot force the adapter to accept more links or select an adapter. Test all intended monitors together for the planned collection duration, checking dropouts, stale signals, reconnection events, and saved files. Simulated load tests establish software behavior, not physical radio capacity.

Use a top-level desktop Chrome/Edge page with Web Bluetooth, IndexedDB, and the File System Access API available. HTTPS or localhost and user permissions are required. Missing capabilities are reported; browsers without folder writing cannot capture. The chooser filters for devices advertising the standard heart-rate service; proprietary-only devices are outside this implementation.

## Recording files

Each session creates a unique subfolder such as:

```text
selected-folder/
  beatstream-2026-11-02T03-00-00-000Z-a1b2c3d4/
    session.json
    measurements.csv
    events.jsonl
```

All devices append to **one `measurements.csv` per recording session**, identified by `device_id` and participant `label`. The header is written once. Data is saved about every five seconds, processing up to 500 queued records per batch; a batch is an internal write unit, not a separate file. Pause drains remaining batches. Reconnecting devices continue the same CSV while that session remains open. Explicitly pausing and resuming capture starts a new session folder and CSV.

Connection and label events append to one `events.jsonl`; `session.json` identifies format version 2 and the output filenames. Earlier version-1 recordings used numbered CSV/event chunks; existing files and browser recovery remain readable and are not rewritten.

Each append reopens the existing file, seeks to the last acknowledged byte offset, writes the new rows, and closes the file to commit them. Retries overwrite only the unacknowledged tail at that same byte offset, so partial batch failures cannot duplicate rows. Files are not kept as one uncommitted stream until capture ends. Do not edit or replace a recording file while capture is active. Because the browser may copy existing content into a temporary file for each append, saving can become slower as a recording grows; validate long sessions on the target storage.

Every measurement is also queued to an IndexedDB journal before folder saving. Data is durable only after the corresponding browser transaction or file close completes, so a crash can still lose the most recently received samples. Failed writes are reported and retained for retry. Browser storage failures are reported separately; folder writing continues when available. Folder handles and session files are never automatically uploaded.

| CSV field | Meaning |
| --- | --- |
| `session_id` | Unique recording session identifier |
| `sequence` | Global session measurement order, starting at 1 |
| `received_utc` | Browser wall-clock receipt time, ISO 8601 UTC |
| `elapsed_ms` | Monotonic time since recording initialization, in milliseconds |
| `device_id` | Browser-provided opaque device ID, not a Bluetooth MAC address |
| `device_name` | Advertised device name |
| `label` | Participant code at receipt time |
| `simulated` | `true` for generated demo data |
| `heart_rate_bpm` | Reported heart rate |
| `contact_detected` | `true` / `false` when supported; empty otherwise |
| `energy_expended_kj` | Reported cumulative energy value; empty if absent |
| `rr_ticks_1024` | Ordered RR values, semicolon-separated, in 1/1024 seconds |
| `rr_ms` | Same RR intervals converted to milliseconds |

CSV text is quoted when necessary and spreadsheet formula prefixes are escaped with an apostrophe. JSONL recovery preserves the original strings.

## Timestamp interpretation

The standard heart-rate notification does **not** contain a sensor timestamp. `received_utc` records the time the browser processes a notification, including Bluetooth and scheduling latency. RR intervals are intervals, not absolute heartbeat timestamps; multiple RR values within one notification share a receipt timestamp. Devices are not synchronized at the sensor level. Do not interpret these values as precisely aligned ECG or beat times. `elapsed_ms` uses `performance.now()` so wall-clock corrections do not change elapsed durations; `received_utc` can jump if the system clock changes. A device row stays visible and shows **OFFLINE** when Bluetooth disconnects or no notifications arrive for more than five seconds. Its label and last-reading time are retained, and a note distinguishes automatic reconnection, a paused monitor, permission problems, and a Bluetooth link that remains connected but sends no readings. A newly connected monitor gets a five-second grace period to send its first reading. Live heart rate and RR values are hidden while offline and return automatically with fresh data. The group average excludes offline and explicitly detached sensors. The connected counter counts Bluetooth links, so a silent-but-connected monitor can count as connected while its row correctly reports offline readings.

This implementation captures standard heart rate and available RR intervals. Polar-specific raw ECG/accelerometer streaming, device clock commands, ANT+, and OS-level recording are outside its scope. Connection changes are logged as session events; automatic retries operate only while the page and browser permit them.

## Recovery and long sessions

IndexedDB stores session metadata, original measurement rows, and connection/label/visibility events. It is local to the browser profile and origin (including port). Closing the tab does not delete saved records, but clearing site data, private browsing, or browser eviction may do so. Recovery exports should not substitute for checked folder files in long collections. To preserve recordings saved by earlier versions, Beatstream retains the internal IndexedDB name `cooling-hubs-hr`; this is a storage compatibility identifier, not the application name. The legacy `pulsedeck-paired` setting is also retained so remembered monitors remain available on the same origin. Recovery export reads the selected session into memory; very large exports may exceed browser memory. Display history is bounded to 30 minutes with at most one point per second (up to 1,801 points per device); every notification is still recorded. The activity list is limited to 80 entries. Folder-write backlogs remain in memory until retried; resolve disk errors promptly. Old recovery records are retained until site data is cleared; export needed recordings before clearing it.

## Repository

The application and suggested repository name are **Beatstream** (`beatstream`). This directory is a local Git repository. It has no remote configured. To create a hosted copy, create a remote repository and add its URL with `git remote add origin <url>`, then push your chosen branch. Recorded participant data is not part of the repository; `recordings/` is ignored as a convenience, and an output folder outside the source checkout is recommended.

Source layout: `hr-monitor.js` is the website import entry point; `src/view.js` contains static dashboard markup; `src/bluetooth.js` handles BLE notifications and reconnection; `src/capture.js` coordinates required-folder automatic capture; `src/recorder.js` implements journal and folder writing; `src/app.js` manages UI and sessions; `server.js` is the optional local static server. Standard browser modules make the app easy to inspect and modify without a toolchain.

## Verification limits

Automated tests cover packet formats and malformed packets, subscription cleanup, CSV escaping, journaling order, append ordering and failure/retry without duplicate rows, UTF-8 byte offsets, browser storage failure, required-folder gating, concurrent automatic setup, first-sample capture, pause/resume, retry backoff and cancellation, and a 48-device/2,880-measurement recorder workload. These do not establish physical device compatibility or simultaneous Bluetooth capacity. Real straps, browser permission prompts, IndexedDB durability, and folder API integration require testing on the collection computer.

## Protocol and browser references

- [Bluetooth SIG Heart Rate Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/HRS_v1.0/out/en/index-en.html)
- [Chrome: Communicating with Bluetooth devices](https://developer.chrome.com/docs/capabilities/bluetooth)
- [Chrome: File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Powr Labs chest strap profile](https://www.powr-labs.com/products/chest-heart-rate-monitor)
- [Polar H10 documentation](https://github.com/polarofficial/polar-ble-sdk/blob/master/documentation/products/PolarH10.md)

Reconnection references: [Chrome automatic reconnect example](https://googlechrome.github.io/samples/web-bluetooth/automatic-reconnect.html) and [Web Bluetooth specification](https://bluetooth.spec.whatwg.org/).
