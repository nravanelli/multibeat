# Repository guide for coding agents

These instructions apply throughout this repository. Follow the user's current request when it changes the requirements below.

## Purpose and agreed architecture

Build a browser-only heart-rate acquisition dashboard for Cooling Hubs research. It should support a workflow of approximately 20 Powr Labs, Polar H10, or other monitors exposing the standard Bluetooth LE Heart Rate Service. Users need participant labels, per-device receipt timestamps, live readings, and recording to a selected local folder.

- Use plain JavaScript ES modules with `.js` filenames, HTML, and CSS with native browser APIs. Preserve the user’s preference for `.js` filenames. Optional development commands use Node.js 22.7+ for ES module syntax detection; do not add a package manifest for this purpose.
- The primary integration is importing `mountHeartRateMonitor` into an existing HTTPS website. Preserve this public entry point and its `destroy()` lifecycle.
- No npm, package installation, framework, bundler, CDN dependency, or build step is needed. Do not introduce these unless the user requests an architecture change.
- No application backend is required. Acquisition, processing, folder writes, and recovery run on the visitor's computer. Keep participant data local; do not add uploads, analytics, or external services by default.
- `server.js` is an optional static-file development helper. Never present Node or a local server as a requirement for using the app on an existing website.
- Website embedding is the default delivery format. Hosting or publishing is a separate task; ordinary repository edits should not create hosting accounts or deployments.

## Find the right file

| File | Responsibility |
| --- | --- |
| `hr-monitor.js` | Public mount API, shadow root, relative asset loading, teardown wrapper |
| `src/app.js` | Device/session state, dashboard interaction, timers, labels, demo, recovery export |
| `src/view.js` | Static dashboard markup, including control IDs and the device template |
| `styles.css` | Responsive dashboard styles, including `:host` for embedding |
| `src/bluetooth.js` | Standard BLE notification decoding and subscription cleanup |
| `src/recorder.js` | CSV serialization, IndexedDB journal, serialized folder writes and retries |
| `index.html` | Standalone example using the same public mount API |
| `test/*.test.js` | Node built-in tests; no testing dependencies |
| `scripts/smoke.js` | Optional localhost asset-loading check; starts and stops its own server |
| `server.js` | Optional development server on `127.0.0.1:5173` |
| `README.md` | User setup, import example, file schema, limitations, and protocol references |

Read only the files relevant to the change. Check `git status --short --branch` before editing and preserve unrelated work.

## Embedding and UI conventions

- Keep module imports relative. Resolve companion assets against `import.meta.url` so installation under a website subdirectory works.
- Keep dashboard queries scoped to its shadow root. Avoid global IDs, global CSS assumptions, and changes to the host page.
- Keep markup in `src/view.js`; do not create a second dashboard implementation in `index.html`.
- Use `textContent` or DOM methods for labels, advertised device names, and error messages. Never interpolate user/device data into HTML. The existing template HTML is static repository content.
- Preserve accessible labels, keyboard operation, visible errors, and responsive layouts. Do not add remote fonts or other network assets.
- Clean up connections, listeners, timers, and wake locks on teardown. Check asynchronous connection and recording transitions when changing lifecycle behavior.
- Keep the demo visibly marked, with `simulated=true` in every generated measurement. Do not silently substitute demo values for missing physical-device data.

## Bluetooth and timestamp correctness

- Use the standard Heart Rate Service (`0x180D`) and Heart Rate Measurement characteristic (`0x2A37`). Powr Labs products are not automatically Polar-specific devices.
- Honor packet flags, little-endian values, optional fields, multiple RR intervals, and malformed-packet handling.
- RR intervals are in 1/1024 seconds; convert with `ticks * 1000 / 1024`. Do not synthesize absent RR values from heart rate.
- Preserve the distinction between unsupported contact detection (`null`) and detected loss of contact (`false`).
- `received_utc` is browser wall-clock receipt time. `elapsed_ms` uses monotonic `performance.now()`. Standard notifications do not supply synchronized sensor timestamps. Do not claim precise alignment between devices or absolute beat times.
- Bluetooth selection and folder pickers need direct user gestures and browser permissions. Detect missing APIs and give actionable feedback.
- Twenty devices is a workflow target, not verified radio capacity. Never describe the simulator or recorder load tests as proof of 20 simultaneous physical connections.

## Recording and data integrity

- Preserve the IndexedDB journal and folder recording paths. Make storage failures visible and distinguish folder failure from recovery-journal failure.
- Keep write operations ordered. Do not remove pending data or advance a chunk number until the corresponding writes close successfully. Retrying a failed chunk must not duplicate measurements across completed chunks.
- The current folder format is `session.json`, numbered measurement CSV chunks, and event JSONL chunks. CSV chunks share the column schema exported by `COLUMNS` in `src/recorder.js`.
- Preserve session/device identity, measurement sequence, receipt timestamps, labels at receipt, simulation markers, and reported optional values. Record label and connection changes as events.
- Treat schema changes as compatibility changes: update metadata/versioning as needed, serialization, recovery behavior, tests, and README together. Keep existing saved sessions readable where practical.
- Preserve CSV quoting and spreadsheet formula escaping. JSONL recovery should retain original strings.
- Keep dashboard history and activity lists bounded. Avoid adding an in-memory copy of an entire recording to the acquisition path. Resolve or report backlog and export-memory limitations when changing storage behavior.
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

The smoke check needs permission to bind a localhost port and port 5173 to be free. It checks asset responses, not browser rendering or physical Bluetooth. Do not stop another process to free the port without establishing that it belongs to this task.

Use focused regression tests for protocol parsing, storage ordering/failure/retry, schema changes, and lifecycle bugs. Avoid installing a test framework or writing tests that only repeat implementation details. Documentation-only changes do not require running the application suite.

If browser verification is available and relevant, exercise the embedded page, label editing/filtering, the 20-device demo, recording start/stop, saved files, recovery export, and mount/destroy/remount. Use a temporary folder and simulated data. Real hardware testing separately needs the intended computer and monitors. Report unverified browser/hardware behavior clearly; do not invent successful checks.

## Finishing a change

- Keep changes scoped to the request; avoid unrelated refactors or reformatting.
- Update README when setup, the public import API, output formats, or user-visible behavior changes. Keep website import instructions first and local development optional.
- Review the diff for accidental data, stale file references, and unrelated changes.
- Summarize the result, commands actually run, and material verification limits. Do not claim a Git commit, remote push, or deployment unless it happened.
