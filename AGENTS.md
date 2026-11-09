# Repository guide for coding agents

These instructions apply throughout this repository. Follow the user's current request when it changes the requirements below.

## Purpose and agreed architecture

Build MultiBeat, a generic browser-only heart-rate acquisition dashboard for Powr Labs, Polar H10, or other monitors exposing the standard Bluetooth LE Heart Rate Service. Support as many monitors as the browser and Bluetooth hardware permit; impose no application connection cap or target denominator. Users need participant labels, per-device receipt timestamps, live readings, and recording to a selected local folder.

- Use plain JavaScript ES modules with `.js` filenames, HTML, and CSS with native browser APIs. Preserve the user’s preference for `.js` filenames. Optional development commands use Node.js 22.7+ for ES module syntax detection; do not add a package manifest for this purpose.
- The primary integration is importing `mountHeartRateMonitor` into an existing HTTPS website. Preserve this public entry point and its `destroy()` lifecycle.
- No npm, package installation, framework, bundler, CDN dependency, or build step is needed. The user authorized uPlot for charting: keep its pinned ES module, CSS and MIT license bundled locally in `vendor/uplot/`, with no runtime CDN access. Do not introduce these unless the user requests an architecture change.
- No application backend is required. Acquisition, processing, folder writes, and recovery run on the visitor's computer. Keep participant data local; do not add uploads, analytics, or external services by default.
- `server.js` is an optional static-file development helper. Never present Node or a local server as a requirement for using the app on an existing website.
- Website embedding is the default delivery format. Hosting or publishing is a separate task; ordinary repository edits should not create hosting accounts or deployments.

## Find the right file

| File | Responsibility |
| --- | --- |
| `hr-monitor.js` | Public mount API, shadow root, relative asset loading, teardown wrapper |
| `src/app.js` | Dashboard interaction, paired-device restoration, timers, labels, recovery export |
| `src/capture.js` | Required output folder, automatic session setup, measurement sequence, pause/resume |
| `src/charts.js` | uPlot instances, always-live zoom/hover, resize and teardown |
| `src/settings.js` | Pairing settings and legacy-list discovery |
| `src/trends.js` | Bounded 60-minute HR/RR display history and interval reconstruction |
| `src/wake-lock.js` | Capture-only screen wake lock, toggle state, visibility and teardown |
| `src/device-state.js` | Row freshness/offline status and first-reading timeout |
| `src/view.js` | Static dashboard markup, including control IDs and the device template |
| `styles.css` | Responsive dashboard styles, including `:host` for embedding |
| `src/bluetooth.js` | Standard BLE decoding, cancellable subscriptions, automatic reconnection with backoff |
| `src/recorder.js` | CSV serialization, IndexedDB journal, serialized folder writes and retries |
| `index.html` | Standalone example using the same public mount API |
| `test/*.test.js` | Node built-in tests; no testing dependencies |
| `scripts/smoke.js` | Optional localhost asset-loading check; starts and stops its own server |
| `server.js` | Optional development server on `127.0.0.1:5173` |
| `README.md` | User setup, import example, file schema, limitations, and protocol references |

Read only the files relevant to the change. Check `git status --short --branch` before editing and preserve unrelated work.

## Embedding and UI conventions

- Keep Choose/Change folder, Pair HRM, Pause/Resume capture, Keep awake, counts, and a prominent duration timer inline with the logo in the header (wrap on narrow screens); keep filtering immediately above the table; the main area contains monitor data. Do not restore the removed demo button. Do not add a session label field or a separate output-folder card. Combine device counts and capture duration with those controls in the header. Visible graphs always follow incoming data; zoom changes the lookback duration and must not freeze the timeline or enable historical panning. Use the brand heart as the capture indicator (pulse only with fresh readings; honor reduced motion), with no separate capture-status row. Show the selected folder name; its browse action opens a native picker without changing the destination or claiming to launch Finder/Explorer. Show storage messages only for errors; hide routine saving/up-to-date messages. Do not add a hero heading, group average, readings counter, activity panel, or browser-backup card. Keep activity/Bluetooth diagnostics and recovery tools in the developer console; retain recovery on the mount controller. Put label instructions in the participant-label column’s info tooltip. Fit the monitor table to its container without horizontal scrolling; reflow each row into labelled fields in narrow embeds and keep all measurements, trends and controls available.

- Participant label edits remain drafts until the adjacent Update label button is activated. Do not apply changes on input, blur, or change events. Show the applied value and unapplied state; only committed changes affect CSV rows, saved settings, and label-change events.
- Keep module imports relative. Resolve companion assets against `import.meta.url` so installation under a website subdirectory works.
- Keep dashboard queries scoped to its shadow root. Avoid global IDs, global CSS assumptions, and changes to the host page.
- Keep markup in `src/view.js`; do not create a second dashboard implementation in `index.html`.
- Use `textContent` or DOM methods for labels, advertised device names, and error messages. Never interpolate user/device data into HTML. The existing template HTML is static repository content.
- Keep disconnected or silent monitor rows visible with an explicit OFFLINE badge, last-reading time, and reconnection/pause reason. Do not display old heart rate or RR values as current readings.
- Preserve accessible labels, keyboard operation, visible errors, and responsive layouts. Do not add remote fonts or other network assets.
- Clean up connections, listeners, timers, and wake locks on teardown. Check asynchronous connection and recording transitions when changing lifecycle behavior.
- The demo UI has been removed. Preserve `simulated=true` for synthetic test measurements and existing saved data. Do not silently substitute demo values for missing physical-device data.

## Bluetooth and timestamp correctness

- Use the standard Heart Rate Service (`0x180D`) and Heart Rate Measurement characteristic (`0x2A37`). Powr Labs products are not automatically Polar-specific devices.
- Honor packet flags, little-endian values, optional fields, multiple RR intervals, and malformed-packet handling.
- RR intervals are in 1/1024 seconds; convert with `ticks * 1000 / 1024`. Do not synthesize absent RR values from heart rate.
- Preserve the distinction between unsupported contact detection (`null`) and detected loss of contact (`false`).
- `received_utc` is browser wall-clock receipt time. `elapsed_ms` uses monotonic `performance.now()`. Standard notifications do not supply synchronized sensor timestamps. Do not claim precise alignment between devices or absolute beat times.
- Bluetooth selection and folder pickers need direct user gestures and browser permissions. Detect missing APIs and give actionable feedback.
- Do not display a fixed connection target or cap. Actual capacity is hardware/browser dependent. Simulation and recorder tests do not establish physical radio capacity.
- Restore only monitors paired through MultiBeat when `getDevices()` is available. Retry dropped/out-of-range connections with capped backoff while capture is enabled. A connection without valid notifications must be refreshed after 15 seconds; do not rely only on the browser disconnect event. Allow 60 seconds for native GATT connection and 15 seconds for each subsequent native Bluetooth setup step and log setup stages, errors, and retry delays to the console without raw readings or participant labels. Explicitly pausing a monitor or capture must cancel pending application waits, retries and the no-data watchdog even when a native GATT promise never settles; late completions must not install stale listeners or disconnect a fresh subscription. Do not promise reconnection while the page is closed or permission is unavailable. Offline rows must offer Find again. Before opening the Bluetooth chooser, synchronously request cancellation of pending/retrying connections, preserving direct user activation by calling requestDevice before awaiting anything. Keep healthy links recording. Restore suspended retries on chooser cancellation unless explicitly paused; do not silently move participant labels to a different browser device ID. While a chooser is pending, block manual and automatic connection starts. Stop waiting must release the local wait, leave affected reconnects paused for explicit user retry, and ignore any late selection without overriding explicit pauses. A stuck native chooser cannot be dismissed by application JavaScript; show its pending state and do not claim synthetic tests repaired the operating-system Bluetooth stack.

## Recording and data integrity

- An output folder is required before pairing/connecting for capture. Automatically prepare a recording when the first monitor connects, before enabling notifications, so its first sample is captured. Do not add a separate manual start step or a browser-only recording mode. Keep a session open across temporary device dropouts; explicit pause stops capture and reconnection.
- Preserve the IndexedDB journal and folder recording paths. Make storage failures visible and distinguish folder failure from recovery-journal failure.
- Keep write operations ordered. Do not remove pending data or advance acknowledged file byte offsets until the corresponding measurement and event writes both close successfully. A failed or ambiguous close must be retried at the same byte offsets without duplicating rows. Use UTF-8 byte lengths, not JavaScript string lengths.
- The current version-5 folder format is `session.json`, one `measurements.csv` for all devices in the session, and one `events.jsonl`. Append and close periodically, with one CSV header. Record only reported HR, RR and optional device values. Respiratory estimation and its UI have been removed; do not reintroduce them without a user request. Existing version 1–4 files and journal records must remain readable and untouched. The CSV schema is exported by `COLUMNS` in `src/recorder.js`.
- Keep reported RR and contact flags unchanged in recordings. RR graph units are milliseconds; plot reported intervals only, without deriving additional physiological estimates.
- Preserve session/device identity, measurement sequence, receipt timestamps, labels at receipt, simulation markers, and reported optional values. Record label and connection changes as events.
- Treat schema changes as compatibility changes: update metadata/versioning as needed, serialization, recovery behavior, tests, and README together. Keep existing saved sessions readable where practical.
- Preserve CSV quoting and spreadsheet formula escaping. JSONL recovery should retain original strings.
- Keep dashboard history bounded; do not accumulate activity logs in application memory. Avoid adding an in-memory copy of an entire recording to the acquisition path. Resolve or report backlog and export-memory limitations when changing storage behavior.
- Do not clear IndexedDB, overwrite recordings, or delete recovery sessions as part of a routine fix or test. Use synthetic test data and temporary output directories.
- Never commit participant recordings, exports, browser-profile data, credentials, or personal labels. `recordings/` is ignored; prefer output folders outside the checkout.

## Verification

For functional JavaScript changes, run the dependency-free suite from the repository root:

```sh
node --test
```

Check syntax for changed modules, for example:

```sh
node --check hr-monitor.js
node --check src/app.js
```

When entry points, imports, asset paths, MIME handling, or the server change, run:

```sh
node scripts/smoke.js
```

If the preview is already running, use `node scripts/smoke.js --reuse-server` to check it without starting or stopping a server. Otherwise, the smoke check needs permission to bind a localhost port and port 5173 to be free. It checks asset responses, not browser rendering or physical Bluetooth. Do not stop another process to free the port without establishing that it belongs to this task.

Use focused regression tests for protocol parsing, storage ordering/failure/retry, schema changes, and lifecycle bugs. Avoid installing a test framework or writing tests that only repeat implementation details. Documentation-only changes do not require running the application suite.

If browser verification is available and relevant, exercise the embedded page, label editing/filtering, simulated device input, automatic capture, folder gating, reconnection and pause/resume, saved files, recovery export, and mount/destroy/remount. Use a temporary folder and simulated data. Real hardware testing separately needs the intended computer and monitors. Report unverified browser/hardware behavior clearly; do not invent successful checks.

## Finishing a change

- Keep changes scoped to the request; avoid unrelated refactors or reformatting.
- Update README when setup, the public import API, output formats, or user-visible behavior changes. Keep website import instructions first and local development optional.
- Review the diff for accidental data, stale file references, and unrelated changes.
- Summarize the result, commands actually run, and material verification limits. Do not claim a Git commit, remote push, or deployment unless it happened.
