# Cooling Hubs · Multi-device heart rate monitor

A dependency-free JavaScript web application for receiving standard Bluetooth LE heart-rate notifications from multiple monitors, showing a live dashboard, and recording to a user-selected local folder. Acquisition, processing, storage, and recovery run in the browser. No account, backend, cloud upload, analytics, CDN, or build step.

## Import into an existing website

No local server, Node.js, npm, framework, or build tools are needed to use the app on your website. Upload `hr-monitor.js`, `styles.css`, and the `src/` directory together, preserving their relative paths. On your HTTPS page, add:

```html
<div id="heart-rate-monitor"></div>
<script type="module">
  import { mountHeartRateMonitor } from '/cooling-hubs/hr-monitor.js';

  const monitor = await mountHeartRateMonitor(
    document.getElementById('heart-rate-monitor')
  );
</script>
```

Replace `/cooling-hubs/` with the uploaded directory. The entry module loads its own dashboard markup and stylesheet; you do not need to copy the dashboard HTML into your page. The dashboard uses a shadow root to isolate its IDs and styles from the rest of your site. Mount one dashboard per page. For a single-page application, call `await monitor.destroy()` before removing its container; this stops capture, flushes pending writes, releases connections, and removes timers and page listeners.

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

1. Wear/activate each strap and disconnect competing apps if needed.
2. Click **Connect monitor**, select one monitor in the browser chooser, and repeat for every device. Browsers require a separate user action to authorize each new device.
3. Set participant labels on each card. Labels are remembered in this browser profile. A label change during recording is saved as an event; measurements carry the label in effect when received. Prefer participant codes to personal names.
4. Choose an output folder and enter a session label. Without a folder, recording uses browser recovery storage only.
5. Start recording. Keep the page open and the computer awake. The app requests a screen wake lock when supported, but this does not guarantee background operation or prevent all system sleep.
6. Stop recording and check for folder errors before closing the page. Use **Retry folder writes** after restoring folder/disk access. A failed batch is retained for retry. Starting another session is blocked while that batch remains pending.
7. **Export recovery** downloads any saved session as JSONL, including session metadata, measurement rows, and events. Recovery remains in IndexedDB across reloads in the same browser profile and origin; it is not automatically resumed into a folder after a reload.

**Try 20-device demo** generates labelled simulated monitors without Bluetooth hardware. It exercises the dashboard and recording path; every generated measurement has `simulated=true` and session metadata identifies simulation mode. End the demo before connecting real monitors.

## Device compatibility and the 20-monitor requirement

The app uses the Bluetooth SIG Heart Rate Service (`0x180D`) and Heart Rate Measurement characteristic (`0x2A37`). Powr Labs documents standard Bluetooth Smart heart-rate profiles; Polar H10 also supports Bluetooth heart rate. Powr Labs and Polar are separate products, so a Powr Labs model should not be assumed to offer Polar-specific features. RR intervals, contact detection, and energy values are recorded only when supplied by the monitor. An absent RR interval is not synthesized from heart rate.

The dashboard accommodates approximately 20 devices and imposes no artificial connection cap. **Twenty simultaneous physical Bluetooth connections are not verified or guaranteed.** The practical limit depends on the operating system, adapter, drivers, browser, radio environment, and other active Bluetooth connections. Browser code cannot force the adapter to accept more links or select an adapter. Test the actual intended computer and all monitors together for the full planned collection duration, checking stale signals, disconnect events, and the resulting files. Simulation tests validate software behavior, not radio capacity.

The app detects missing browser APIs. Safari, Firefox, iOS, and embedded browser frames should not be assumed to support this workflow. Use a top-level desktop Chrome/Edge page with Web Bluetooth and the File System Access API available. A secure context (HTTPS or localhost) and user permissions are required. The chooser filters for devices advertising the standard heart-rate service; proprietary-only devices are outside this implementation.

If a single computer cannot sustain your required link count, a browser-only single-adapter solution cannot guarantee the target. A practical fallback is dividing monitors across computers, with independently recorded sessions. This app does not synchronize clocks between computers or combine their sessions.

## Recording files

Each session creates a unique subfolder such as:

```text
selected-folder/
  hr-2026-10-30T03-00-00-000Z-a1b2c3d4/
    session.json
    measurements-000001.csv
    events-000001.jsonl
    measurements-000002.csv
    ...
```

All devices share measurement CSV chunks, identified by `device_id` and `label`. A chunk is written about every 5 seconds, with a maximum of 500 queued records in each flush. Stop drains remaining batches. Event files are only created for batches containing events, and measurement files only for batches containing measurements, so sequence gaps in either file type are normal. Every CSV repeats its header; sort by the `sequence` column when combining chunks. Folder handles and session files are never automatically uploaded.

Each chunk is closed before being marked saved. Previously closed chunks remain readable after a tab crash; the unfinished interval may be missing from the folder. Every measurement is also queued to an IndexedDB journal before folder batching. Data is only durable after the corresponding IndexedDB transaction or folder write completes, so a crash can still lose the most recently received samples. There is no guarantee against OS/disk failure. Failed writes are reported in recording status. Browser storage quota failures are reported; folder writing continues if it is available. A browser journal failure is retained as a warning for the rest of the session because recovery may have gaps.

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

The standard heart-rate notification does **not** contain a sensor timestamp. `received_utc` records the time the browser processes a notification, including Bluetooth and scheduling latency. RR intervals are intervals, not absolute heartbeat timestamps; multiple RR values within one notification share a receipt timestamp. Devices are not synchronized at the sensor level. Do not interpret these values as precisely aligned ECG or beat times. `elapsed_ms` uses `performance.now()` so wall-clock corrections do not change elapsed durations; `received_utc` can jump if the system clock changes. Stale means no notification for more than 5 seconds. The group average excludes stale, disconnected, and explicitly detached sensors.

This implementation captures standard heart rate and available RR intervals. Polar-specific raw ECG/accelerometer streaming, device clock commands, ANT+, automatic background reconnection, and OS-level recording are outside its scope. Disconnected devices have a manual **Reconnect** button, with connection changes recorded as session events.

## Recovery and long sessions

IndexedDB stores session metadata, original measurement rows, and connection/label/visibility events. It is local to the browser profile and origin (including port). Closing the tab does not delete saved records, but clearing site data, private browsing, or browser eviction may do so. Browser-only recording and recovery exports should not substitute for checked folder files in long collections. Recovery export reads the selected session into memory; very large exports may exceed browser memory. Dashboard history is bounded to 60 seconds (at most 300 notifications per device), and the activity list to 80 entries. Folder-write backlogs remain in memory until retried; resolve disk errors promptly. Old recovery records are retained until site data is cleared; export needed recordings before clearing it.

## Repository

This directory is a local Git repository. It has no remote configured. To create a hosted copy, create a remote repository and add its URL with `git remote add origin <url>`, then push your chosen branch. Recorded participant data is not part of the repository; `recordings/` is ignored as a convenience, and an output folder outside the source checkout is recommended.

Source layout: `hr-monitor.js` is the website import entry point; `src/view.js` contains static dashboard markup; `src/bluetooth.js` decodes/subscribes to BLE notifications; `src/recorder.js` implements journal and folder writing; `src/app.js` manages UI and sessions; `server.js` is the optional local static server. Standard browser modules make the app easy to inspect and modify without a toolchain.

## Verification limits

Automated tests cover packet formats and malformed packets, subscription cleanup, CSV escaping, journaling order, folder-write failure/retry, browser storage failure, browser-only recording, and a 20-device/1,200-measurement recorder workload. These do not establish physical device compatibility or simultaneous Bluetooth capacity. Real straps, browser permission prompts, IndexedDB durability, and folder API integration require testing on the collection computer.

## Protocol and browser references

- [Bluetooth SIG Heart Rate Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/HRS_v1.0/out/en/index-en.html)
- [Chrome: Communicating with Bluetooth devices](https://developer.chrome.com/docs/capabilities/bluetooth)
- [Chrome: File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Powr Labs chest strap profile](https://www.powr-labs.com/products/chest-heart-rate-monitor)
- [Polar H10 documentation](https://github.com/polarofficial/polar-ble-sdk/blob/master/documentation/products/PolarH10.md)
