# Workspace and Clinical Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a researcher point SpineContour at a folder of radiographs and an optional clinical-data CSV, load the folder as queued studies, capture clinical fields for a study on the Analysis screen, and delete a study they no longer want — all against real local files, with no network calls and no fabricated data.

**Architecture:** Four new local-only IPC channels (`choose-folder`, `scan-folder`, `choose-csv`, `read-csv`) plus a fifth, `delete-prediction`, let the renderer read and prune the filesystem without Node integration in the renderer process; each is exposed by `preload.js` and wrapped in `renderer/api.js` through the existing `invoke()` so every rejection reaches a caller display-ready. A dependency-free recursive scanner, `scan-folder.js`, is a CommonJS module at the repo root (it uses `node:fs`, which `renderer/` cannot resolve) that only `main.js` requires; it is listed in **both** electron-builder allowlists in the same task that creates it. `renderer/data/csv.js` owns the pure logic — `parse`, `autoMap`, the `study_id` join (`joinClinical`) and `clinicalFieldNames` — all unit-tested with `node --test`. The Workspace screen is a vanilla DOM screen that turns a folder scan plus an optional CSV into study records with `newStudy` and commits them with ONE new-array `setState`; the plan-05 store subscriber (`createStudySaver` over the `loadStudies`/`saveStudies` API) persists that single reference change. **Nothing in this plan calls `saveStudies` directly.** The clinical-data drawer is a component mounted on the Analysis screen — `mountClinicalData(host) → { update }`, the same shape as `mountMeasurements` — whose every edit is one new study record committed through `setState`, persisted by the same saver. Deleting a study removes its record (the saver writes the new list), removes its prediction sidecar through `deletePrediction`, and clears every id-keyed renderer cache so a reused id cannot inherit the deleted film.

**Tech Stack:** Vanilla ES modules in the renderer, CommonJS in the main process (`main.js`, `preload.js`, `store-io.js`, `scan-folder.js`), Electron `ipcMain.handle`/`dialog`/`contextBridge`, Node's `node:fs/promises`, Node's built-in test runner (`node --test`), and the CDP smoke harness (`tools/smoke/`) for the DOM paths that `node --test` cannot reach. No new npm dependencies.

**Amended 2026-09-03 against the live code at `d335ea0`** (plans 01–05 complete; unit baseline 201/201 with `node --test test/*.test.js`). The original text assumed plan 02's state of the world — a `render(container)` screen convention, a bare `setState({toast})`, direct `saveStudies` calls, a CommonJS test tree — none of which survives in the live code; every task below was rewritten against what actually exists. The pre-flight scan (68 confirmed findings), the controller's rulings and the binding interface sheet are in the plan's SDD ledger: `.superpowers/sdd/2026-08-31-06-workspace-clinical-data/progress.md`, `preflight-findings.md` and `amendment-brief.md`. The contract amendments this plan carries are listed at the end of this preamble; the architecture contract remains binding and wins over any task text. The unit suite lands at 259 (201 → 208 after Task 1 → 212 after Task 2 → 246 after Task 3 → 254 after Task 4 → 257 after Task 5 → 257 after Task 6 → 259 after Task 7; Tasks 8 and 9 add none).

## What plans 03–05 already built that this plan builds on

- **The router mounts what a screen module returns.** `renderer/router.js` keeps a `SCREENS` map (`workspace`, `studies`, `analysis` — lines 9–13) and calls `renderScreen(state)` (lines 223–224, 232–241), swapping the RETURNED node into the shell; it never passes a container. The live `renderer/screens/workspace.js` is a five-line placeholder whose `render()` returns `el('main', { class: 'placeholder-screen' }, …)` — Task 4 replaces it and keeps the export name `render`. `SCREEN_KEYS = ['screen', 'ack']` (line 85) is the ONLY thing that remounts the screen host; a screen that reads any other key (`wsFolder`, `wsFiles`, `wsCsv`, `studies`, `fields`) refreshes itself. The Workspace screen refreshes from its own DOM handlers after their `setState`; the drawer subscribes through the Analysis screen's `update()`. `SIDEBAR_KEYS` already includes `wsFolder`, `wsFiles`, `wsCsvRows` (lines 58–68), so the sidebar's workspace status line updates on its own.
- **`renderer/store.js` forbids `setState` inside a subscriber** (it throws: "setState() must not be called from a subscriber"). Every `setState` in this plan runs from a DOM event handler or an `await` continuation, never from `update()` or a subscriber. Initial state already carries every key this plan reads: `wsFolder: null`, `wsFiles: []`, `wsCsv: null`, `wsCsvHeaders: []`, `wsCsvRows: []`, `wsMapping: []`, `fields: []`, `dataOpen: true`. No key is added.
- **Persistence is one store subscriber.** `renderer/main.js` (lines 44–52) builds `createStudySaver({ save: saveStudies, initial: studies, disabledReason, onError })` and subscribes `saver.notify`; whenever `state.studies` changes reference the saver writes the REAL studies (demo records filtered) to `userData/studies.json`. A refused store (newer `version`, bad record identity) leaves persistence disabled for the session: `saveStudies`/`savePrediction` reject through `assertWritable()`, and `persistenceDisabledReason()` (`renderer/api.js` lines 81–83) tells a caller so. Bootstrap seeds only `setState({ studies })` today (line 31); Task 6 adds `fields`.
- **Study records come from `newStudy`, ids from `nextId`.** `renderer/screens/studies.js` exports `newStudy({ id, fileName, filePath })` (lines 44–49: `source: 'real'`, `measurements: null`, `geometry: null`, `qc: null`, `clinical: {}`, `thumbnail: null`, `view: 'Standing lateral'`, `addedAt` ISO) and imports `nextId` from `renderer/data/persistence.js` (max + 1 over real studies, `SP-1000` first). `FRESH_VIEW` (line 54: `{ selectedLevel: null, zoom: 1, panX: 0, panY: 0, panMode: false, editing: false, selection: null }`) is module-private to `studies.js`; every writer that changes `openId` also sets `screen` and spreads `FRESH_VIEW`. `addStudy` (line 61) is the entry point for ONE film arriving interactively and inserts at the front; a folder scan does not call it in a loop. `FILM_EXTENSIONS` (line 83) is `/\.(dcm|dicom|png|jpe?g|tiff?|bmp)$/i`.
- **`renderer/api.js` wraps every bridge call through one `invoke(channel, ...args)`** (lines 30–39): a missing bridge or method rejects with `The application bridge is unavailable. Try restarting Spine Contour.` (line 5), and `cleanMessage` strips the IPC prefix `Error invoking remote method '<channel>': <Type>Error: ` (line 6) so the main process's `throw new Error('…')` text reaches the renderer verbatim. `readFile` is the last wrapper (lines 132–135); new wrappers follow it. `test/api.test.js` already tests every wrapper by stubbing `globalThis.window` (`withWindow(...)`), so the four new wrappers and `deletePrediction` are unit-tested the same way.
- **`test/` is ESM and imports root CommonJS modules by their named exports.** `test/package.json` is `{"type":"module"}`; `test/store-io.test.js` line 6 does `import { STORE_VERSION, readStudyStore, … } from '../store-io.js';` and tracks temp dirs in an array removed in `after()`. `test/scan-folder.test.js` follows that file exactly. The command is `node --test test/*.test.js`; sixteen files, 201 tests at `d335ea0`.
- **Both packaging allowlists are guarded by CI.** `package.json` `build.files` (lines 22–31) and `electron-builder.preview.yml` `files:` (the block after the "MUST stay in sync" comment) list `store-io.js` today; `.github/workflows/windows-preview.yml` lines 137–164 ("Assert packaging allowlists agree") parses both, `\r?\n` tolerant, and fails the build when they diverge. A root file `main.js` requires that is missing from either ships an installer that opens a blank window — the parity check is the only thing that catches it.
- **`main.js` facts the IPC task edits against.** Requires at lines 1–7 (`electron` destructures `app, BrowserWindow, dialog, ipcMain, shell`; `fs`, `fsPromises`, `net`, `path`; `./store-io.js` at line 7). `SPINE_CONTOUR_USER_DATA` is honoured only when `!app.isPackaged` (lines 19–21); `studiesPath()` (line 27) and `predictionPath(id)` (line 36, id-validated) live under `app.getPath('userData')`. `MAX_UPLOAD_BYTES = 50 * 1024 * 1024` (line 39). The `select-file` filter (line 52) is `['dcm', 'dicom', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp']`. Handlers run `select-file` (48), `predict` (65), `measure` (89), `open-external` (103), `save-csv` (110, passes `mainWindow` so the dialog is modal), `load-studies` (142), `save-studies` (161), `load-prediction` (166), `save-prediction` (168), `read-file` (175); `function createWindow()` is at line 183. `preload.js` exposes the bridge as one object whose `readFile:` entry is at line 13.
- **The verification harness is `tools/smoke/`.** `launch.mjs` starts the app from source, detached, on a scratch `SPINE_CONTOUR_USER_DATA` (`<tmp>/spine-contour-smoke`) with CDP on 9222, WIPES that directory unless `SMOKE_KEEP_PROFILE=1`, refuses a CDP port another instance already holds (exit 3), and gates `ready` on a real page target. `cdp.mjs "<expr>"` evaluates an expression in the page; `cdp.mjs --quit` shuts down cleanly. `cdp-lib.mjs` `connect()` and the `check()`/results/exit pattern of `smoke-studies.mjs` are what Task 8's suite copies. Baselines at `d335ea0` (README "Known baseline"): `smoke-studies` 56/56, `smoke-persist --phase run` 33/33 and `--phase restart` 44/44, parity 15/15, gate1 25/25, gate2 32/32, gate3 23/23 (fresh precondition), chip 20/20. Never run `smoke-studies` between the two persist phases.
- **The dev profile IS the production profile on Windows.** `%APPDATA%\spine-contour` (from source) and `%APPDATA%\Spine-Contour` (production build) are the same directory, case-insensitively. Anything launched with bare `npm run dev` reads and WRITES the researcher's real `studies.json` and `predictions\`. Every manual gate in this plan says **"copy `studies.json` and `predictions\` aside first"**; every controller step uses the scratch profile.
- **`styles/components.css` already defines the shared classes this plan reuses:** `.card`, `.btn`, `.btn-primary` (`--accent` background, `--on-accent` label), `.btn-small`, `.btn:disabled`, `.icon-btn`, `.eyebrow`, `.pill-demo`, `.badge*`, `.dropzone*`, `.toast*`. `styles/screens/` holds `analysis.css`, `landing.css`, `studies.css` — no `workspace.css` yet, and no rule for any `workspace-*` or `clinical-*` class. `index.html` links six sheets (lines 12–17: tokens, base, components, landing, studies, analysis); Task 4 adds `workspace.css` after `studies.css`. `analysis.css` opens with a four-line header comment listing its numbered sections (01 shell/header, 02 stage, 03 panel); Task 5 appends section 04. `.app-shell` is `display:flex; height:100vh; overflow:hidden`, so a screen root needs `flex:1; min-width:0; overflow-y:auto` (as `.studies-page` has).
- **`renderer/screens/analysis.js` owns the screen lifecycle the drawer joins.** `render(state)` builds `const root = el('main', { class: 'analysis-screen' }, header, body);` at line 326, mounts the viewer and `mountMeasurements(measurementsHost)` (lines 328–329), defines `function update()` (lines 363–387: header meta, confidence, tabs, `viewer.updateViewer(open)`, `measurementsPanel.updateMeasurements(open)`), and records `mounted = { viewer, update, studyId }` (line 396). A module-scope subscriber (lines 94–101) calls `mounted.update()` on EVERY store notification while `screen === 'analysis'` — including pan frames — and tears down on leaving; so anything `update()` calls must be cheap when nothing it reads changed. Run completion is one `setState` at lines 207–214 that today clears `editing`/`selection` globally. `filePayloads` (line 27, `Map` by study id) and `imageCache` (line 38, one entry, kept across navigation and re-handed by id at line 341) are the id-keyed caches Task 7's `releaseStudy` clears; `mounted` (line 55, `{ viewer, update, studyId }`) is the identity check it makes before disposing bitmaps; `locating` (line 62) is a boolean, not a cache — the window it opens (a study deleted while its relocate picker is up) is closed by Task 7's gone-study guard in `runSegmentation`. `renderer/components/measurements.js` `mountMeasurements(host)` and its `sameKey` gate are the pattern the drawer copies.
- **`renderer/components/viewer.js` holds the other id-keyed caches:** `predictions` (line 54, a `Map` written by `recordPrediction` at line 56 — it gates `RESET TO PREDICTION`) and `measureQueue` (line 47, `createMeasureQueue(...)` with per-study `revisions`/`measured` superseded only by `measureQueue.replaceMeasured(studyId, geometry)`, lines 64 and 516). Task 7's `forgetPrediction(studyId)` clears both.
- **`renderer/data/csv.js`** exports only `toCsv` today (`test/csv.test.js` has 8 tests). `KNOWN_FIELDS` is bound by the contract to the nine strings `Age`, `Sex`, `BMI`, `Diagnosis`, `ODI`, `Treatment plan`, `Surgical history`, `Follow-up`, `Notes` — the contract's csv.js block lists it without a plan-06 marker, but the live file does not export it yet; Task 3 adds the export alongside `parse`, `autoMap`, `fileStem`, `findJoinHeader`, `joinClinical` and `clinicalFieldNames` (seven new exports). `study.clinical` is `Object<string,string>` on the record, preserved by `validate`.
- **Toasts are `showToast(message)` from `renderer/components/toast.js`** (auto-dismissing; used by `studies.js`, `analysis.js`, `renderer/main.js`). Inside a store notification it must be deferred with `queueMicrotask` (as `renderer/main.js` line 50 does); from a DOM handler it is called directly.
- **`renderer/dom.js` `el(tag, props, ...children)`** (lines 1–23): a prop whose value is `undefined` is skipped; any `on*` key with a function value becomes `addEventListener(key.slice(2).toLowerCase(), fn)` (so `onClick`, `onChange`, `onKeydown` work); `class` is set as an attribute; any other key that exists on the node is assigned as a PROPERTY (`disabled`, `value`, `title`, `placeholder`, `innerHTML`, `type`), and the rest become attributes (`aria-*`, `role`). `disabled: ''` therefore coerces to `false` — pass booleans. Never pass `style` or `dataset` (both exist on the node and would be assigned wholesale); set CSS variables with `node.style.setProperty(...)` after construction. Children that are `null`/`undefined`/`false` are dropped, so conditional children can be written inline. `mount(host, node)` clears the host and appends `node`.

## Global Constraints

- **No bundler, no framework, no npm runtime dependencies.** Vanilla ES modules only.
  `package.json` `dependencies` stays empty; `devDependencies` stays exactly
  `electron` and `electron-builder`.
- **CSP is `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'`.**
  It must not be loosened. No CDN, no Google Fonts, no remote anything. `connect-src 'none'` also blocks `fetch` of the app's own files — bytes come through IPC, never `fetch`.
- **Fonts are self-hosted** from `assets/fonts/`. Source Sans 3 and Chivo Mono, both SIL OFL.
- **Never display a fabricated measurement.** Absent values render the em dash `—`,
  never `0`, never `N/A`, never a guess.
- **Never label a value with a name it isn't.** See the `SS` rename (plan 02) and the
  `FEMORAL FIT CONFIDENCE` badge (plan 03).
- **No fabricated status.** `Processing` means no measurements yet or a run in flight; nothing else.
- **Never mutate the store's geometry in place.** Every write to `state.studies` is a new array; every geometry that reaches the store is a new reference (a fresh `/predict` or `/measure` result, a `structuredClone`, or a record read from disk).
- **`renderer/router.js` `SCREEN_KEYS` stays `['screen', 'ack']`.** Interaction-rate and typing-rate keys never go in a host key set.
- **All stage pointer and keyboard wiring lives in `renderer/components/viewer.js`.** `renderer/viewer/interactions.js` is pure. Do not add DOM code to it.
- **`state.selectedLevel` is a construction target** (`'L1'`…`'L5'|'S1'|'PI'|'PT'|'SS'|'L1PA'|null`); anything switching on it handles the non-level values explicitly.
- **`renderer/` cannot import `node:` modules.** Disk I/O lives in root-level `store-io.js`, imported only by `main.js`.
- **Both electron-builder allowlists stay in sync** (`package.json` `build.files` and `electron-builder.preview.yml` `files`). A new root file that `main.js` requires must be added to both, or the packaged app opens a blank window while CI stays green.
- **Node's built-in test runner only.** The command is `node --test test/*.test.js`.
- **Every `<script>` is `type="module"`.** No global scope leakage.
- Target Electron 44 / Chromium — modern syntax is fine. No transpilation.
- Toasts go through `showToast` from `renderer/components/toast.js` (auto-dismissing), never a bare `setState({toast})`.
- Commit after every task. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).

Added for this plan (every task carries these too):

- The test command is `node --test test/*.test.js`; `test/` is ESM (`test/package.json` = `{"type":"module"}`); a root
  CommonJS module is imported by its named exports (pattern: `test/store-io.test.js`).
- Toasts go through `showToast` from `renderer/components/toast.js`, never `setState({toast})`.
- **Nothing calls `saveStudies` directly.** Persistence is the store subscriber in `renderer/main.js`; every write to
  `state.studies` is ONE new array and the saver persists the real studies. A folder scan commits its records with one
  `setState`; a drawer edit commits `{ ...study, clinical: { …, [field]: value } }` as a new record (an emptied cell deletes the key instead of storing `''` — see Task 5).
- `renderer/router.js` `SCREEN_KEYS` stays `['screen','ack']`; screens that read other keys refresh themselves.
- `el()` props: booleans for `disabled`, never `''`; no `style`/`dataset` props; set CSS variables with
  `node.style.setProperty(...)` after construction; `class` is a string.
- No colour literal outside `styles/tokens.css` and `viewer/canvas.js`; sage/accent tints are `color-mix(in srgb, var(--sage) N%, var(--border) | transparent)`.
- Any new root file `main.js` requires goes in BOTH allowlists in the same task that creates it.
- Verification launches: see "Launching for verification" below; never bare `npm run dev`.
- Copy: never claim a status or a feature the code does not have (no "queues automatically", no "flagged in the studies list").
- Never `git push` in Tasks 1–8; Task 9 pushes to `fork` only. Never touch `main`.

## Contract amendments carried by this plan

Applied to `2026-08-31-00-architecture-contract.md` in the same pass as this amendment; listed here so a task brief can cite them. Nothing else in the contract changes.

1. **File structure.** The root block gains `scan-folder.js  (plan 06) recursive film discovery for the Workspace folder scan — CommonJS, node:fs only, required by main.js; listed in BOTH electron-builder allowlists`. The `renderer/components/clinical-data.js` line gains the note `mountClinicalData(host) → {update}` (plan 06) — rows from `visibleStudies(state)`, `[open]` until plan 07. The bare `screens/workspace.js` line gains, in the same annotation column as its neighbours, `exports render(state), loadWorkspaceStudies(state), workspaceLoadedMessage({added, known, updated, join, mapping}) (plan 06)`. The test list gains `scan-folder.test.js workspace.test.js clinical-data.test.js`.
2. **`renderer/api.js`.** The table gains `export async function deletePrediction(id) // → void (plan 06) removes predictions/<id>.json; ENOENT is not an error; rejects for the session after disablePersistence`. Below the table: `scanFolder`'s `skipped` counts unsupported files, links not followed, and unreadable subfolders; the root folder rejects with a display-ready message. `chooseFolder`/`chooseCsv` resolve `null` on cancel (not an error).
3. **`renderer/data/csv.js`.** `parse` strips a UTF-8 BOM and treats a quote as opening only at field start, leading whitespace allowed — a quote after other text is literal. The `autoMap` sentence becomes: "matches case-insensitively after stripping non-alphanumerics, treating the known field's stripped name as a prefix of the stripped header, so `odi_base` → `ODI` and `age_yrs` → `Age`; each known field is claimed by at most one column — the first matching header wins". New exports: `fileStem(name)`, `findJoinHeader(headers)`, `joinClinical({files, headers, rows, mapping}) → {joinHeader, byFile, matched, unmatched, duplicates, ambiguous}`, `clinicalFieldNames(studies)`.
4. **`renderer/components/viewer.js`** note: `exports forgetPrediction(studyId)` (plan 06). **`renderer/screens/analysis.js`** gains a line in the file structure: `exports setFilePayload, releaseStudy(studyId)` (plan 06).
5. **State shape.** The comment on `fields: []` becomes `seeded at bootstrap with clinicalFieldNames(studies) (plan 06); session-only otherwise`.
6. **Persistence.** A new bullet: deleting a study removes its record (the saver writes the new list) and its sidecar through `deletePrediction`; a load-time orphan sweep of `predictions/` is deliberately not performed (a refused store must never lose data); ids are max+1 so a deleted highest id is reused, which is why every id-keyed renderer cache is cleared on delete.
7. **Nothing else changes:** state shape keys, `SCREEN_KEYS`, `KNOWN_FIELDS`, and the signatures of every existing function stay as they are.

---

## Design notes specific to this plan

Behaviours the spec describes in prose need a concrete mechanism; each is decided here so every task implements the same thing.

**The `study_id` join key is not one of the nine clinical fields.** `autoMap` (Task 3) only ever matches a CSV header against `KNOWN_FIELDS` — `Age`, `Sex`, `BMI`, `Diagnosis`, `ODI`, `Treatment plan`, `Surgical history`, `Follow-up`, `Notes` — exactly as bound by the architecture contract. A `study_id` column therefore comes back `dest: null` ("Unmapped") in the column-mapping chips, and that is correct: it is not a clinical field, it is the join key. `findJoinHeader(headers)` (Task 3) finds it independently of `autoMap`, by normalising every header the same way (lowercase, strip non-alphanumerics) and taking the first one that reads `studyid` — so `study_id`, `Study ID` and `studyId` all qualify. A CSV with no such column is reported the moment it is chosen (`This CSV has no study_id column — rows cannot be linked to films.`), card 02 says `no study_id column — rows cannot be matched`, and the post-load toast says `CSV has no study_id column — N rows not linked` rather than "linked".

**A raw film on disk has no ID yet — IDs are assigned at load time, and the join is by filename stem.** The only identity a scanned file has before it becomes a `Study` is its filename. `joinClinical` (Task 3) matches a CSV row's `study_id` value (trimmed, lowercased) against each film's stem — `fileStem(name)`: basename without its last extension — case-insensitively, so `SP001.dcm` joins a row whose `study_id` is `SP001` or `sp001`. Rows whose key matches no film are counted `unmatched` and reported in the toast; they are not written anywhere (there is no `wsUnmatched*` store key — that would exceed the state shape the contract fixes). Two rows with the same key: the FIRST wins, the rest are counted `duplicates` and reported. A key that matches MORE than one film (the same stem in two subfolders) is attached to none and counted `ambiguous` — guessing which film a row belongs to would be a fabricated association. Only mappings with a `dest` are copied; values are trimmed and empty values skipped, so a study never carries a blank clinical key. Ids come from `nextId(state.studies)` once and are then assigned consecutively in scan order (`SP-1000`, `SP-1001`, …), with the new records front-inserted so the newest sit at the top of Studies. Loading is idempotent and **fill-only**: a film whose `filePath` (compared case-insensitively) already belongs to a real study is skipped and counted `already in the library`; if the CSV carries clinical data for it, only the keys that record does not already hold (absent, or an empty string) are filled onto a NEW object, counted `clinical data updated`. A value already on the record — typed in the drawer or imported earlier — is never overwritten by a Load, and a known film with nothing to fill keeps its record by reference and is not counted at all, so the toast never reports work that did not happen. The explicit overwrite path is `Import from CSV` in the Analysis drawer (Task 5), where the user is acting on one visible study. So a second Load, or an overlapping folder, never creates duplicate records and never rewrites data behind the user.

**`autoMap` is a prefix match on stripped, lowercased strings — not a synonym table — and each known field is claimed once.** `odi_base` → `ODI` and `age_yrs` → `Age` work because the known field's stripped name (`odi`, `age`) is a literal prefix of the stripped header (`odibase`, `ageyrs`). `tx_plan` stays unmapped because `txplan` is not a prefix of `treatmentplan` (or the reverse). `dx_text` likewise stays unmapped: `dxtext` is not a prefix of `diagnosis`, and a `dx`-means-diagnosis special case cannot be added without also adding a `tx`-means-treatment case, which the contract explicitly forbids — Task 3 asserts this with a comment explaining why. When two headers both match the same field (`odi_base`, `odi_6mo`), the first header wins and the later one comes back `dest: null`; the chip dropdown lets the user reassign either. The prefix rule has a known cost, recorded in Task 3's tests: a header `agent` maps to `Age`. That is the trade the contract's "convenience, not an authority" wording accepts — the mapping is visible and editable before anything loads.

**`SUPPORTED_EXTENSIONS` is a one-item superset of spec §9.3.** The scanner accepts `.dcm`, `.dicom`, `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.bmp` (case-insensitively). Spec §9.3 lists seven; `.dicom` is added because the native picker (`main.js` line 52) and the Studies dropzone (`studies.js` `FILM_EXTENSIONS`, line 83) both accept it, and the three ingestion paths must agree or the skipped-file count is wrong for accepted input. Symlinks and junctions (every reparse point on Windows) are never followed and are counted as skipped; an unreadable subfolder is counted as skipped; only the ROOT folder rejects, with a display-ready message. The real skipped count survives navigation because it lives in a module-scope `lastScan = { folder, skipped }` keyed to `state.wsFolder`, not in a closure the router discards.

**Load navigates to Studies and never sets `openId`.** Spec §9.3 says Load "then navigates to Studies", so the one `setState` that commits the records also sets `screen: 'studies'`. HANDOFF item 1's "leaving `openId`/`screen` alone" is read as "do not open a study" — a scan must not drive Analysis the way `addStudy` does for a single film — and Task 9 narrows that sentence to `openId`. `FRESH_VIEW` is not spread because `openId` does not change. The load hint reads `New films are added to Studies as Processing. Open one and run segmentation from its Analysis screen.` — the true sentence; nothing queues a run, and `Processing` is the derived status of a record whose `measurements` is `null`.

**Deleting a study, id reuse, and why there is no orphan sweep.** HANDOFF decision 13 assigns delete and sidecar pruning to this plan; Task 7 builds it. Ids are max + 1 over the real studies, so deleting the highest id means the next film REUSES it. Every id-keyed cache in the renderer therefore forgets the id on delete — `filePayloads` and `imageCache` (`releaseStudy`, analysis.js), the viewer's `predictions` snapshot and the measure queue's per-study revisions (`forgetPrediction`, viewer.js) — so the new record cannot inherit the old film's bytes, bitmaps, `RESET TO PREDICTION` target or a pending `/measure` correction. The sidecar `predictions/<id>.json` is removed through `deletePrediction` BEFORE the record leaves the store (ENOENT is not an error); a refused delete keeps the record and toasts. `predictions/` is pruned on delete only: a load-time sweep of orphaned sidecars is deliberately NOT done, because a refused store (a newer build's data) hides the real library and a sweep would then destroy every sidecar it cannot see. Delete is refused while that study's segmentation is running, and a study deleted while its relocate picker is open never runs. The confirm is two-step inline (`Delete this study?` · Delete · Cancel) — never `window.confirm`, which wedges CDP.

**The `/measure` persist window is DEFERRED, with the design named.** HANDOFF records that a landmark correction's geometry is persisted by the saver while its 150 ms `/measure` debounce is still pending, so an abrupt quit inside that window makes `geometry_new` + `measurements_old` durable together. This plan does not fix it. Option A (hold the commit until `/measure` returns) is not viable — the viewer draws handles from store geometry, so a held commit snaps the dragged handle back. Option B is the design: the record gains an optional `measurementsStale` flag set on commit and cleared on the `/measure` result, `validate` preserves it, the Measurements panel marks stale numbers, and `status.js` rule 2 gains "or `measurementsStale`". It touches `measure-queue.js`, `persistence.js`, `components/measurements.js`, `status.js` and three test files — a fix-wave task, not a workspace task — and needs two contract amendments (the `Study` typedef and the status rule) that are applied only when it is built. Task 9 carries it into HANDOFF as a named post-06 item.

**Demo studies are visible in the drawer but not editable.** The drawer mounts for every study, demo included, so the Analysis screen has one shape. A demo record's cells render `disabled` with the title `Demo studies are not saved`, and `Import from CSV` is disabled with the same title — the saver never writes demo records, so an edit would be a silent session-only illusion. For a real study with no workspace CSV loaded, `Import from CSV` is disabled with the title `Load a CSV in the Workspace first`.

**`fields` is session state, seeded at bootstrap.** `state.fields` is not persisted (persisting it would change the version-1 store shape). Values persist on `study.clinical`; the field list that makes them visible is rebuilt at every launch by `renderer/main.js` from `clinicalFieldNames(studies)` — the union of every real study's clinical keys, `KNOWN_FIELDS` order first, then custom names in first-seen order. Dropping a field in the drawer is therefore session-only: it hides the column, does not delete values, and the column returns on the next launch if any study still holds a value for it. The control says so — its `aria-label` is `Hide <name>` and its tooltip `Hide field — values are kept` (the internal function is still `removeField`); "Remove" would claim a deletion the code does not perform.

**The drawer's `max-height` is an addition to the design.** The design's drawer section is `flex-shrink: 0` with a top border and card background; this plan adds `max-height: 40vh; overflow-y: auto` so an open drawer at the 900 px default window cannot squeeze the stage and clip the measurements panel. It is a deliberate deviation, recorded here.

---

## Launching for verification

Every manual and CDP step in this plan refers to this block.

```
Set-Location "C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign"
$env:SPINE_CONTOUR_PYTHON = "C:\Users\codyj\spine contour\.venv\Scripts\python.exe"
node tools/smoke/launch.mjs            # scratch profile, CDP on 9222; refuses a held port (quit first)
node tools/smoke/cdp.mjs --quit        # when done
```
Relaunch to test persistence: `$env:SMOKE_KEEP_PROFILE = "1"; node tools/smoke/launch.mjs` (launch.mjs WIPES the
scratch profile otherwise). After launch, poll until `getState().studies.length > 0` before asserting.
Real-profile (Gate) launches: `npm.cmd run dev -- --remote-debugging-port=9222` from the worktree with
`SPINE_CONTOUR_PYTHON` set (quit any scratch instance first with `node tools/smoke/cdp.mjs --quit`, or the port is
held); any gate step that overwrites or deletes a file in the profile says **"copy it aside first"**
(`%APPDATA%\spine-contour\studies.json` and `predictions\`). "Process alive" is not "ready".

---

## Task list

| # | Title | Files | Gate |
|---|---|---|---|
| 1 | Folder scanner `scan-folder.js` (CommonJS), ESM tests, both packaging allowlists | scan-folder.js, test/scan-folder.test.js, package.json, electron-builder.preview.yml | — |
| 2 | IPC channels, preload, `api.js` wrappers through `invoke()`, api tests | main.js, preload.js, renderer/api.js, test/api.test.js | — (pickers verified at Gate 1) |
| 3 | CSV parse, auto-map, and the `study_id` join as pure, tested logic | renderer/data/csv.js, test/csv.test.js | — |
| 4 | Workspace screen with its stylesheet | renderer/screens/workspace.js (MODIFY — replaces the plan-02 placeholder), styles/screens/workspace.css (CREATE), index.html, test/workspace.test.js | **GATE 1** |
| 5 | Clinical data drawer component with its styles | renderer/components/clinical-data.js, styles/screens/analysis.css (append block), test/clinical-data.test.js | — |
| 6 | Mount the drawer on Analysis; seed `fields` at bootstrap; run completion no longer tears down another study's edit | renderer/screens/analysis.js, renderer/main.js | — (controller CDP walkthrough) |
| 7 | Delete a study (record + sidecar), and the caches that must forget it | renderer/screens/studies.js, styles/screens/studies.css, renderer/screens/analysis.js, renderer/components/viewer.js, main.js, preload.js, renderer/api.js, test/api.test.js, test/api-persistence.test.js | — |
| 8 | `tools/smoke/smoke-workspace.mjs`, README entry, end-to-end verification | tools/smoke/smoke-workspace.mjs, tools/smoke/README.md | **GATE 2** |
| 9 | Docs and handoff; push to `fork`; preview-installer test | docs/superpowers/HANDOFF.md, CLAUDE.md, README.md, the contract's tense | user installs the preview |

Unit suite after each task (`node --test test/*.test.js`): 201 at `d335ea0` → **208** (Task 1, +7) → **212** (Task 2, +4) → **246** (Task 3, +34) → **254** (Task 4, +8) → **257** (Task 5, +3) → 257 (Task 6, +0) → **259** (Task 7, +2) → 259 (Tasks 8–9, +0). Task 1's junction test reads `pass 207` + `skipped 1` only on a machine that refuses to create a junction; on this machine and on `windows-latest` it passes.

Commit after every task with the exact message its final step gives, conventional prefixes. Never `git push` in Tasks 1–8; Task 9 pushes to `fork` only.

---

## Task 1 — Folder scanner `scan-folder.js` (CommonJS), ESM tests, both packaging allowlists

**Files:**
- Create: `scan-folder.js` (repo root, **CommonJS**)
- Create: `test/scan-folder.test.js` (ESM — `test/package.json` is `{"type":"module"}`)
- Modify: `package.json` (`build.files`)
- Modify: `electron-builder.preview.yml` (`files:`)

**Interfaces:**
- Consumes: Node built-ins only — `node:fs/promises`, `node:path`. No Electron, no other plan's code, nothing from another task.
- Produces: `scanFolder(dirPath) → Promise<{files: string[], skipped: number}>` and `SUPPORTED_EXTENSIONS: Set<string>`, exported as the static literal `module.exports = { scanFolder, SUPPORTED_EXTENSIONS };`. Task 2 requires it from `main.js` as `const { scanFolder } = require('./scan-folder.js');` and wraps it in the `scan-folder` IPC handler; the contract fixes the renderer-facing signature as `scanFolder(dirPath) → {files: string[], skipped: number}` (contract line 312).

This is the one new file in plan 06 that touches `node:fs`, so it lives at the repo root next to `store-io.js`, not under `renderer/` (the browser cannot resolve `node:` specifiers). The root is CommonJS (`package.json` has no `"type"`), so the module is written with `require`/`module.exports` **because `main.js` requires it**; the test tree is ESM and imports its named exports — the pattern `test/store-io.test.js` lines 1–6 already use against `store-io.js`. That only works when `module.exports` is a static object literal (cjs-module-lexer reads the names out of it), so the export line is written exactly as shown and never built dynamically. The scanner reads the ROOT folder outside any swallow — a missing, deleted or unreadable chosen folder rejects, and Task 2's handler turns that into a display-ready message — while a nested subfolder that cannot be read is swallowed and counted as skipped. Links (any entry whose `Dirent.isSymbolicLink()` is true — on Windows that is every reparse point: symlink or junction) are never followed and are counted as skipped, so a whole tree that vanishes behind a junction shows up in the card's skipped count instead of disappearing silently. Entries are sorted by name in every directory and walked depth-first, so the file order — and therefore the `SP-nnnn` ids Task 4 assigns in scan order — is the same on NTFS, FAT/exFAT sticks, SMB shares, ext4 and APFS. `SUPPORTED_EXTENSIONS` mirrors the native picker filter in `main.js` (line 52) and the Studies dropzone regex `FILM_EXTENSIONS` in `renderer/screens/studies.js` (line 83); it includes `.dicom`, a deliberate one-item superset of spec 9.3's seven, so the three ingestion paths (picker, drop, folder scan) accept the same files. (That design note is already recorded in "Design notes specific to this plan" above; nothing to add here.)

- [ ] **Step 1: Write the failing ESM test file**

Create `test/scan-folder.test.js`. Temp directories are collected in a module-level array and removed in one `after()` hook regardless of outcome (mirroring `test/store-io.test.js` lines 8–23), so a failing assertion — including the deliberately red run in Step 2 and CI — leaves nothing under the OS temp folder, not even the junction. `after` removes the junction as a link (Node's `rm` uses `lstat` and unlinks the reparse point without following it), so the target directory is not deleted twice.

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanFolder, SUPPORTED_EXTENSIONS } from '../scan-folder.js';

const dirs = [];

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spine-contour-scan-'));
  dirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

test('scanFolder finds supported image extensions and counts every other file as skipped', async () => {
  const dir = await tempDir();
  await writeFile(path.join(dir, 'film1.dcm'), 'x');
  await writeFile(path.join(dir, 'film2.PNG'), 'x');
  await writeFile(path.join(dir, 'notes.txt'), 'x');
  await writeFile(path.join(dir, 'readme.md'), 'x');

  const result = await scanFolder(dir);

  assert.deepEqual(result.files, [path.join(dir, 'film1.dcm'), path.join(dir, 'film2.PNG')]);
  assert.equal(result.skipped, 2);
});

test('scanFolder recurses into subfolders and returns full paths', async () => {
  const dir = await tempDir();
  const sub = path.join(dir, 'batch1', 'nested');
  await mkdir(sub, { recursive: true });
  await writeFile(path.join(dir, 'top.jpg'), 'x');
  await writeFile(path.join(sub, 'deep.tiff'), 'x');

  const result = await scanFolder(dir);

  assert.deepEqual(result.files, [path.join(sub, 'deep.tiff'), path.join(dir, 'top.jpg')]);
  assert.equal(result.skipped, 0);
});

test('scanFolder matches all eight supported extensions case-insensitively', async () => {
  const dir = await tempDir();
  const names = ['a.dcm', 'b.PNG', 'c.Jpg', 'd.JPEG', 'e.tif', 'f.TIFF', 'g.bmp', 'h.DICOM'];
  for (const name of names) {
    await writeFile(path.join(dir, name), 'x');
  }

  const result = await scanFolder(dir);

  assert.equal(SUPPORTED_EXTENSIONS.size, 8);
  assert.deepEqual(result.files, names.map((name) => path.join(dir, name)));
  assert.equal(result.skipped, 0);
  // The set is the contract with main.js's select-file filter and studies.js's FILM_EXTENSIONS.
  assert.deepEqual([...SUPPORTED_EXTENSIONS].sort(), ['.bmp', '.dcm', '.dicom', '.jpeg', '.jpg', '.png', '.tif', '.tiff']);
});

test('scanFolder never follows a junction back into a cycle and counts it as one skipped entry', async (t) => {
  const dir = await tempDir();
  await writeFile(path.join(dir, 'real.dcm'), 'x');
  const linkPath = path.join(dir, 'loop');
  try {
    await symlink(dir, linkPath, 'junction');
  } catch (_error) {
    t.skip('symlink/junction creation is not permitted in this environment');
    return;
  }

  const result = await scanFolder(dir);

  assert.deepEqual(result.files, [path.join(dir, 'real.dcm')]);
  assert.equal(result.skipped, 1);
});

test('scanFolder on an empty folder returns no files and no skips', async () => {
  const dir = await tempDir();

  const result = await scanFolder(dir);

  assert.deepEqual(result, { files: [], skipped: 0 });
});

test('scanFolder rejects when the root folder is missing or is not a folder', async () => {
  const dir = await tempDir();
  await writeFile(path.join(dir, 'film.png'), 'x');

  await assert.rejects(scanFolder(path.join(dir, 'missing')), { code: 'ENOENT' });
  await assert.rejects(scanFolder(path.join(dir, 'film.png')));
});

test('scanFolder returns a sorted, deterministic order regardless of creation order', async () => {
  const dir = await tempDir();
  await mkdir(path.join(dir, 'z'));
  await mkdir(path.join(dir, 'a'));
  // Created deliberately out of name order, across two subfolders and the root.
  await writeFile(path.join(dir, 'z', '2.png'), 'x');
  await writeFile(path.join(dir, 'b.dcm'), 'x');
  await writeFile(path.join(dir, 'a', '1.png'), 'x');
  await writeFile(path.join(dir, 'a', '0.png'), 'x');
  await writeFile(path.join(dir, 'c.jpg'), 'x');
  await writeFile(path.join(dir, 'z', '1.png'), 'x');
  // Mixed case on purpose: 'B' < 'a' in code-unit order but sorts AFTER 'a' under
  // localeCompare, so this is the one pair that fails if byName ever goes locale-aware.
  await writeFile(path.join(dir, 'B.png'), 'x');

  const first = await scanFolder(dir);
  const second = await scanFolder(dir);

  assert.deepEqual(first.files, [
    path.join(dir, 'B.png'),
    path.join(dir, 'a', '0.png'),
    path.join(dir, 'a', '1.png'),
    path.join(dir, 'b.dcm'),
    path.join(dir, 'c.jpg'),
    path.join(dir, 'z', '1.png'),
    path.join(dir, 'z', '2.png'),
  ]);
  assert.deepEqual(second, first);
  assert.equal(first.skipped, 0);
});
```

Why `'junction'`: on Windows a directory junction is created without Developer Mode or admin rights (a plain directory symlink needs one of them), and on macOS/Linux the type argument is ignored and a normal symlink is created — so the same test runs on every developer machine and on the `windows-latest` CI runner. **On this runtime (Node 24.19 / libuv 1.52.1 on Windows) a junction comes back from `readdir(..., { withFileTypes: true })` with `isSymbolicLink() === true` and `isDirectory() === false`** — libuv reports every `FILE_ATTRIBUTE_REPARSE_POINT` entry as a link — which is exactly why the scanner tests `isSymbolicLink()` before `isDirectory()` and why the expected `skipped` here is `1`, not `0`. If the junction cannot be created (a locked-down sandbox), the test skips itself with `t.skip` and the `after()` hook still removes the directory.

One branch of the scanner is deliberately left without a unit test: the swallowed NESTED `readdir` failure (an unreadable subfolder counted as one skipped). Making a directory genuinely unreadable on Windows means editing its ACL with `icacls`, which needs privileges the test suite must not assume and leaves a folder the `after()` hook may then be unable to delete; stubbing `fs.promises.readdir` to throw would test the stub, not the scanner. The branch is three lines inside one `try/catch` and is covered by review instead — read it in Step 3 and confirm it increments `skipped` and continues rather than rejecting.

- [ ] **Step 2: Run the test file and verify it fails for the right reason**

Run: `node --test test/scan-folder.test.js`

Expected: FAIL at import time — the file cannot load because the module does not exist yet. The error is an ESM resolution failure, **not** a CommonJS one:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\...\ui-redesign\scan-folder.js' imported from C:\...\ui-redesign\test\scan-folder.test.js
```

The runner reports the file itself as one failing entry and executes none of the seven tests (`tests 1`, `fail 1`). If you see `ReferenceError: require is not defined in ES module scope` instead, the header was written in CommonJS — `test/` is ESM; rewrite it as the imports above.

- [ ] **Step 3: Implement `scan-folder.js`**

Create `scan-folder.js` at the repo root:

```js
/**
 * Recursive film discovery for the Workspace folder scan (spec 9.3). Deliberately at the repo
 * root and CommonJS: it touches node:fs, which renderer/ cannot resolve, and main.js requires
 * it (the ESM tests import its named exports from the static module.exports literal below).
 *
 * Contract: scanFolder(dirPath) → Promise<{files: string[], skipped: number}>.
 *  - The ROOT readdir is not swallowed: a missing, deleted or unreadable chosen folder rejects
 *    (ENOENT / ENOTDIR / EACCES) and the IPC handler turns that into a display-ready message.
 *    An empty folder and an unreadable folder must never look the same on the Workspace card.
 *  - Entries are sorted by name in every directory and walked depth-first, so the order — and
 *    the SP-nnnn ids the Workspace assigns in that order — does not depend on the filesystem.
 *  - Links are never followed and count as skipped. Dirent.isSymbolicLink() is true for every
 *    reparse point on Windows (symlink or junction), so this is also the cycle guard.
 *  - A NESTED readdir failure is swallowed and counts as one skipped entry.
 *  - A file with a supported extension (case-insensitive) is collected; any other entry counts
 *    as skipped.
 */
const fsPromises = require('node:fs/promises');
const path = require('node:path');

// Mirrors main.js's select-file filter (line 52) and renderer/screens/studies.js FILM_EXTENSIONS
// (line 83) so the picker, the dropzone and the folder scan accept the same files. One-item
// superset of spec 9.3: `.dicom` is included because the other two paths already accept it.
const SUPPORTED_EXTENSIONS = new Set(['.dcm', '.dicom', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp']);

// Plain code-unit comparison, never localeCompare: deterministic on every machine and locale.
function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

async function readSortedEntries(dir) {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  entries.sort(byName);
  return entries;
}

async function scanFolder(dirPath) {
  const files = [];
  let skipped = 0;

  async function walk(currentDir, entries) {
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        // Never followed — directory or file, symlink or junction. Counted so a tree that
        // sits behind a link is reported on the card instead of vanishing silently.
        skipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        let nested;
        try {
          nested = await readSortedEntries(entryPath);
        } catch (_error) {
          // A subfolder that cannot be read (permissions, removed mid-scan) is reported as
          // one skipped entry; only the root folder's failure rejects the whole scan.
          skipped += 1;
          continue;
        }
        await walk(entryPath, nested);
        continue;
      }
      if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      } else {
        skipped += 1;
      }
    }
  }

  // Outside any try/catch on purpose: the chosen folder must be readable or the scan rejects.
  const rootEntries = await readSortedEntries(dirPath);
  await walk(dirPath, rootEntries);
  return { files, skipped };
}

// Static object literal: cjs-module-lexer exposes these names to the ESM test imports.
module.exports = { scanFolder, SUPPORTED_EXTENSIONS };
```

`path.join`/`path.extname` are used instead of manual string splitting so Windows backslash paths are handled the way `path` handles them everywhere else in this codebase; `files` therefore carries absolute paths under the chosen folder, which is what Task 4 stores as `Study.filePath`.

- [ ] **Step 4: Run the test file and verify it passes**

Run: `node --test test/scan-folder.test.js`

Expected: `tests 7`, `pass 7`, `fail 0` — or `pass 6`, `skipped 1` on a machine where a junction cannot be created (the skip prints `symlink/junction creation is not permitted in this environment`). On this Windows machine and on `windows-latest` the junction is created and all 7 pass. No `spine-contour-scan-*` directories are left in `%TEMP%` afterwards.

- [ ] **Step 5: Add `scan-folder.js` to BOTH packaging allowlists**

`main.js` will `require('./scan-folder.js')` at module scope in Task 2. A root file `main.js` requires that is missing from either allowlist does not fail the build — it ships an installer whose `main.js` throws `MODULE_NOT_FOUND` before `app.whenReady()`, so no window opens, while CI stays green (its parity check only compares the two lists with each other). Add the entry in the same task that creates the file.

In `package.json`, insert `"scan-folder.js",` after `"store-io.js",` (currently line 27). The resulting `build.files` array is:

```json
    "files": [
      "assets/**/*",
      "index.html",
      "main.js",
      "preload.js",
      "store-io.js",
      "scan-folder.js",
      "renderer/**/*",
      "styles/**/*",
      "package.json"
    ],
```

In `electron-builder.preview.yml`, insert `  - scan-folder.js` after `  - store-io.js` (currently line 18). The resulting `files:` block is:

```yaml
files:
  - assets/**/*
  - index.html
  - main.js
  - preload.js
  - store-io.js
  - scan-folder.js
  - renderer/**/*
  - styles/**/*
  - package.json
```

Nothing else in either file changes (`appId`, `productName`, `artifactName`, `extraMetadata`, `extraResources`, `win`, `nsis` stay as they are).

- [ ] **Step 6: Run the CI allowlist parity check locally**

Run, from the worktree root, the same comparison `.github/workflows/windows-preview.yml` runs in its "Assert packaging allowlists agree" step (lines 140–164 — the `\r?\n` form that tolerates CRLF checkouts). In a bash shell (Git Bash is fine):

```bash
node - <<'NODE'
const fs = require('fs');
const prod = JSON.parse(fs.readFileSync('package.json', 'utf8')).build.files;
const yml = fs.readFileSync('electron-builder.preview.yml', 'utf8');
// windows-latest checks the repo out with CRLF line endings (no .gitattributes
// rule forces LF for .yml), so a bare \n here made this match fail on every run
// and it never actually guarded anything.
const block = yml.match(/^files:\r?\n((?:[ \t]+- .*\r?\n)+)/m);
if (!block) {
  console.error('FAIL: no files: block found in electron-builder.preview.yml');
  process.exit(1);
}
const prev = block[1].trimEnd().split('\n')
  .map(s => s.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, ''));
console.log('package.json build.files       :', JSON.stringify(prod));
console.log('electron-builder.preview files :', JSON.stringify(prev));
const a = JSON.stringify([...prod].sort());
const b = JSON.stringify([...prev].sort());
if (a !== b) {
  console.error('FAIL: the two packaging allowlists have diverged.');
  console.error('A missing entry does not fail the build - it ships an installer that opens a blank window.');
  console.error('Add the entry to BOTH package.json build.files and electron-builder.preview.yml files:.');
  process.exit(1);
}
console.log('OK: allowlists match');
NODE
```

Expected output (the two arrays print in file order; the comparison is order-insensitive):

```
package.json build.files       : ["assets/**/*","index.html","main.js","preload.js","store-io.js","scan-folder.js","renderer/**/*","styles/**/*","package.json"]
electron-builder.preview files : ["assets/**/*","index.html","main.js","preload.js","store-io.js","scan-folder.js","renderer/**/*","styles/**/*","package.json"]
OK: allowlists match
```

If your shell refuses the heredoc, save the script body (everything between the `<<'NODE'` and `NODE` lines) to a file in your scratch directory and run `node <that file>` from the worktree root — the output is the same. Also confirm by eye that `"scan-folder.js"` appears in BOTH printed arrays: the check proves the lists agree with each other, not that the new file is in them.

- [ ] **Step 7: Run the full unit suite**

Run: `node --test test/*.test.js`

Expected: `tests 208`, `pass 208`, `fail 0` — the 201 tests of the plan-05 baseline plus the 7 in `test/scan-folder.test.js` (201 + 7 = 208). On a machine where the junction cannot be created the summary is `tests 208`, `pass 207`, `skipped 1`, `fail 0`. Any `fail` count other than 0 stops the task.

- [ ] **Step 8: Commit**

```bash
git add scan-folder.js test/scan-folder.test.js package.json electron-builder.preview.yml
git commit -m "feat: add the workspace folder scanner and ship it in both installers"
```

Do not push.

---

## Task 2 — IPC channels, preload, `api.js` wrappers through `invoke()`, api tests

The renderer has no Node integration, so the Workspace screen (Task 4) reaches the filesystem the same way every other screen does: a `main.js` handler, a one-line `contextBridge` entry, and a `renderer/api.js` wrapper that goes through the live `invoke()` helper. This task adds the four channels the Workspace needs — pick a folder, scan it, pick a CSV, read it — and nothing else. Both pickers resolve `null` on cancel (not an error, so the renderer stays quiet, exactly as `saveCsv` does); every failure the handlers can produce is thrown as a **display-ready sentence** so a Workspace toast can show `error.message` verbatim. The `scan-folder` handler never reports an unreadable folder as an empty one: `scanFolder`'s success shape has no error field, so a folder that cannot be read *rejects* — "0 radiographs found" must never describe a permissions failure or a drive that vanished between the pick and the scan. The `read-csv` handler mirrors the live `read-file` handler (existence check, the 50 MB cap, then the read) except that a missing CSV is an error, because the contract gives `readCsv` no `null` outcome and there is no relocate flow for a CSV. The `main.js` and `preload.js` halves cannot run under `node --test` (`main.js` calls `app.whenReady()` at module scope); the `api.js` wrappers can and do — `test/api.test.js` already stubs `globalThis.window` for every other wrapper, and the four new ones get the same coverage. The wiring is then exercised end to end over CDP by the controller; the native pickers themselves are human steps at GATE 1.

**Files:**
- Modify: `main.js` (one `require` after line 7; four `ipcMain.handle` blocks after the `read-file` handler, live lines 175–181 at `d335ea0` — 176–182 once this task's own `require` line is in — before `function createWindow()` at line 183, 184 after that line; anchor on the text, not the number)
- Modify: `preload.js` (four lines inserted after `readFile:` at line 13 — the file is NOT rewritten)
- Modify: `renderer/api.js` (four wrappers inserted after `readFile`, which ends at line 135, before the `pathForFile` comment at line 137)
- Modify: `test/api.test.js` (extend the import at line 3; append four tests)

No allowlist change in this task: `scan-folder.js` was added to `package.json` `build.files` and `electron-builder.preview.yml` `files` by Task 1, in the same commit that created it. This task assumes Task 1 has landed (root `scan-folder.js` exists and `node --test test/*.test.js` is at 208).

**Interfaces:**
- Consumes:
  - Root `scan-folder.js` (Task 1, CommonJS): `module.exports = { scanFolder, SUPPORTED_EXTENSIONS }` with `scanFolder(dirPath) → Promise<{files: string[], skipped: number}>`. Its ROOT `readdir` is not swallowed (ENOENT/ENOTDIR/EACCES reject — this task's handler turns them display-ready); entries are sorted by name per directory, depth-first; `skipped` counts unsupported files, links not followed, and unreadable subfolders; `files` are `path.join(dir, name)` absolute paths.
  - Live `main.js` bindings already in scope: `dialog`, `ipcMain` (line 1), `fs` (line 3), `fsPromises` (line 4), `MAX_UPLOAD_BYTES` (line 39), module-scope `mainWindow` (line 45, assigned in `createWindow`).
  - Live `renderer/api.js` `async function invoke(channel, ...args)` (lines 30–40): throws the bridge-unavailable message when `window.spineContour[channel]` is not a function, and strips Electron's `Error invoking remote method '<channel>': <XError>: ` prefix from a rejection through `cleanMessage` (lines 6, 17–24).
  - Live `test/api.test.js` `withWindow(windowValue, fn)` (lines 14–24) and its `BRIDGE_UNAVAILABLE_MESSAGE` constant (lines 6–7).
- Produces:
  - IPC channels `choose-folder`, `scan-folder`, `choose-csv`, `read-csv`.
  - Bridge functions `window.spineContour.chooseFolder()`, `.scanFolder(dirPath)`, `.chooseCsv()`, `.readCsv(filePath)`.
  - `renderer/api.js` (contract signatures, consumed by Task 4's `renderer/screens/workspace.js` and Task 8's smoke suite through `import('./renderer/api.js')`):
    ```js
    export async function chooseFolder()            // → string|null   null on cancel — not an error
    export async function scanFolder(dirPath)       // → {files: string[], skipped: number}
    export async function chooseCsv()               // → string|null   null on cancel — not an error
    export async function readCsv(filePath)         // → string  (raw text)
    ```
    Rejection messages a caller can receive (all display-ready, no IPC prefix): `scanFolder` → `No folder was selected.` | `The folder was not found.` | `The folder could not be read. Check that you still have permission to open it.`; `readCsv` → `No CSV file was selected.` | `The CSV file was not found.` | `The CSV file exceeds 50 MB.` | `The CSV file could not be read. Check that you still have permission to open it.`; all four → `The application bridge is unavailable. Try restarting Spine Contour.` when the bridge is missing. Task 4 composes its toasts as `` `Could not read folder: ${error.message}` `` / `` `Could not read CSV: ${error.message}` `` on top of these.

- [ ] **Step 1: Write the failing tests**

Open `test/api.test.js`. Replace line 3 — the import — with:

```js
import { predict, measure, loadStudies, readFile, pathForFile, storeLoadNotice, persistenceDisabledReason, chooseFolder, scanFolder, chooseCsv, readCsv } from '../renderer/api.js';
```

Append these four tests at the end of the file (after the `pathForFile` test that ends at line 229). They use the file's existing `withWindow` helper and its `BRIDGE_UNAVAILABLE_MESSAGE` constant; nothing else in the file changes.

```js
// Workspace pickers and readers (plan 06). The two pickers resolve null on cancel, which the
// renderer treats as "nothing happened" -- the wrapper must hand that null through untouched.
test('chooseFolder and chooseCsv pass a cancelled picker (bridge null) through as null, and a chosen path as-is', async () => {
  await withWindow({ spineContour: { chooseFolder: async () => null, chooseCsv: async () => null } }, async () => {
    assert.equal(await chooseFolder(), null);
    assert.equal(await chooseCsv(), null);
  });
  await withWindow({ spineContour: { chooseFolder: async () => 'C:/films', chooseCsv: async () => 'C:/films/clinical.csv' } }, async () => {
    assert.equal(await chooseFolder(), 'C:/films');
    assert.equal(await chooseCsv(), 'C:/films/clinical.csv');
  });
});

test('scanFolder forwards the path and strips the IPC wrapper down to the handler message', async () => {
  const seen = [];
  await withWindow({
    spineContour: {
      scanFolder: async (dirPath) => {
        seen.push(dirPath);
        if (!dirPath) throw new Error("Error invoking remote method 'scan-folder': Error: No folder was selected.");
        return { files: [`${dirPath}/a.png`], skipped: 1 };
      },
    },
  }, async () => {
    assert.deepEqual(await scanFolder('C:/films'), { files: ['C:/films/a.png'], skipped: 1 });
    await assert.rejects(scanFolder(''), (err) => {
      assert.equal(err.message, 'No folder was selected.');
      return true;
    });
    assert.deepEqual(seen, ['C:/films', '']);
  });
});

test('readCsv forwards the path and strips the IPC wrapper down to the handler message', async () => {
  const seen = [];
  await withWindow({
    spineContour: {
      readCsv: async (filePath) => {
        seen.push(filePath);
        if (filePath.endsWith('missing.csv')) throw new Error("Error invoking remote method 'read-csv': Error: The CSV file was not found.");
        return 'study_id,age\r\na,58\r\n';
      },
    },
  }, async () => {
    assert.equal(await readCsv('C:/films/clinical.csv'), 'study_id,age\r\na,58\r\n');
    await assert.rejects(readCsv('C:/films/missing.csv'), (err) => {
      assert.equal(err.message, 'The CSV file was not found.');
      return true;
    });
    assert.deepEqual(seen, ['C:/films/clinical.csv', 'C:/films/missing.csv']);
  });
});

test('without the bridge, chooseFolder, scanFolder, chooseCsv and readCsv all reject with the bridge-unavailable message', async () => {
  await withWindow({}, async () => {
    // Thunks, not promises: a rejected promise created before its handler is attached would
    // trip Node's unhandled-rejection check while an earlier assert.rejects is still awaiting.
    const calls = [() => chooseFolder(), () => scanFolder('C:/films'), () => chooseCsv(), () => readCsv('C:/films/clinical.csv')];
    for (const call of calls) {
      await assert.rejects(call, (err) => {
        assert.equal(err.message, BRIDGE_UNAVAILABLE_MESSAGE);
        return true;
      });
    }
  });
});
```

- [ ] **Step 2: Verify the tests fail (RED)**

Run: `node --test test/api.test.js`

Expected: the file fails to link — `SyntaxError: The requested module '../renderer/api.js' does not provide an export named 'chooseFolder'` — so none of its tests execute; Node reports the file itself as one failing test (`ℹ pass 0`, `ℹ fail 1`). The full suite `node --test test/*.test.js` shows the same single failure with the other files unchanged: 189 pass (208 from Task 1 minus the 19 tests of `test/api.test.js` that could not run), 1 fail. On a machine where Task 1's junction test skipped itself, the line reads 188 pass, 1 skipped, 1 fail; either is the expected RED.

- [ ] **Step 3: Require the scanner in `main.js`**

In `main.js`, directly after live line 7

```js
const { readStudyStore, writeStudyStore, readJsonOrNull, writeJsonAtomic } = require('./store-io.js');
```

add this one line (the `.js` extension matches line 7's root-CommonJS convention):

```js
const { scanFolder } = require('./scan-folder.js');
```

Leave the `electron` destructure on line 1 alone — it already carries `shell`, which `open-external` uses, and `dialog`, which the new pickers use. Do not paste a "full require block" from anywhere; the only change to the top of the file is the one added line.

- [ ] **Step 4: Add the four IPC handlers to `main.js`**

Insert the following block after the `read-file` handler (live lines 175–181 at `d335ea0`, 176–182 after Step 3's added `require` line — anchor on the text, which ends with `});`) and before `function createWindow() {` (live line 183, 184 after Step 3). Nothing else in `main.js` changes.

```js
// Workspace pickers and readers (plan 06). Local filesystem and native dialogs only: none of
// these touch backendBaseUrl or fetch, so nothing leaves the machine. Both pickers are parented
// on mainWindow so they are modal, like save-csv above; cancelling resolves null, which the
// renderer treats as "nothing happened", never as an error. Every throw below is display-ready:
// renderer/api.js strips the IPC prefix and the Workspace hands the message to a toast verbatim.
ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// scanFolder's success shape is {files, skipped} with no error field, so a folder that cannot
// be read REJECTS rather than reporting an empty folder: "0 radiographs found" must never
// describe a permissions failure or a drive that went away between the pick and the scan.
// scan-folder.js lets its root readdir propagate for exactly this reason.
ipcMain.handle('scan-folder', async (_event, dirPath) => {
  if (typeof dirPath !== 'string' || !dirPath) throw new Error('No folder was selected.');
  if (!fs.existsSync(dirPath)) throw new Error('The folder was not found.');
  try {
    return await scanFolder(dirPath);
  } catch {
    throw new Error('The folder could not be read. Check that you still have permission to open it.');
  }
});

ipcMain.handle('choose-csv', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'CSV files', extensions: ['csv'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Mirrors read-file above (existence, the 50 MB cap, then the read), except that a missing CSV
// is an error here: the contract gives readCsv no null outcome and there is no relocate flow
// for a CSV -- the user simply picks it again. A raw ENOENT/EACCES string is not display-ready,
// so stat and read are both mapped.
ipcMain.handle('read-csv', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) throw new Error('No CSV file was selected.');
  if (!fs.existsSync(filePath)) throw new Error('The CSV file was not found.');
  let stat;
  try {
    stat = await fsPromises.stat(filePath);
  } catch {
    throw new Error('The CSV file could not be read. Check that you still have permission to open it.');
  }
  if (stat.size > MAX_UPLOAD_BYTES) throw new Error('The CSV file exceeds 50 MB.');
  try {
    return await fsPromises.readFile(filePath, 'utf8');
  } catch {
    throw new Error('The CSV file could not be read. Check that you still have permission to open it.');
  }
});
```

`mainWindow` is the module-scope variable from line 45; it is assigned before any renderer can invoke a channel, and the live `save-csv` handler (line 112) already parents its dialog the same way. Electron tolerates a `null` first argument if the window has been closed, so no guard is needed.

- [ ] **Step 5: Expose the four channels in `preload.js`**

**Do not rewrite `preload.js`.** The live file imports `webUtils` alongside `contextBridge` and `ipcRenderer` (line 1) and already exposes `selectFile`, `predict`, `measure`, `openExternal`, `saveCsv`, `loadStudies`, `saveStudies`, `loadPrediction`, `savePrediction`, `readFile` and `pathForFile` (lines 4–16); replacing it with a shorter listing would make the bootstrap's `loadStudies()` reject and disable persistence for the session. Insert exactly these four lines inside the existing `exposeInMainWorld` object, after the `readFile:` line (live line 13) and before the `// Electron >= 32 removed File.path` comment:

```js
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  scanFolder: (dirPath) => ipcRenderer.invoke('scan-folder', dirPath),
  chooseCsv: () => ipcRenderer.invoke('choose-csv'),
  readCsv: (filePath) => ipcRenderer.invoke('read-csv', filePath),
```

After the edit, lines 13–21 of the file read (for orientation only — this is the tail of the existing object, not a file to paste):

```js
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  scanFolder: (dirPath) => ipcRenderer.invoke('scan-folder', dirPath),
  chooseCsv: () => ipcRenderer.invoke('choose-csv'),
  readCsv: (filePath) => ipcRenderer.invoke('read-csv', filePath),
  // Electron >= 32 removed File.path; this is the sanctioned replacement, and File objects
  // cross the context bridge. Used by the Studies dropzone so a dropped film keeps a real path.
  pathForFile: (file) => webUtils.getPathForFile(file),
});
```

- [ ] **Step 6: Add the four wrappers to `renderer/api.js`**

Every async wrapper in the live `renderer/api.js` is `return invoke('<bridge name>', ...args)` — `selectFile`/`predict`/`measure` (lines 42–52) and `readFile` (lines 132–135) alike. `invoke` (lines 30–40) is what makes a missing bridge the bridge-unavailable message and strips Electron's `Error invoking remote method '…': Error: ` prefix from a handler's throw; a wrapper that called `window.spineContour.x()` directly would leak that prefix into a toast and turn an absent bridge into a `TypeError`. Route the new wrappers through `invoke()` exactly like `readFile`.

Insert the following after `readFile` — that function ends at live line 135 — and before the `// Synchronous: the absolute path of a dropped File` comment at line 137 that introduces `pathForFile`. Nothing else in the file changes.

```js
// Workspace pickers and readers (plan 06). Through invoke() like every other wrapper: a
// missing bridge is the bridge-unavailable message, and the main process's display-ready
// throws ("No folder was selected.", "The CSV file was not found.") arrive without Electron's
// "Error invoking remote method" prefix. The two pickers resolve null on cancel; that is not
// an error and callers stay quiet on it, as with saveCsv.
export async function chooseFolder() {
  return invoke('chooseFolder');
}

// {files: string[], skipped: number} -- skipped counts unsupported files, links not followed,
// and unreadable subfolders. A root folder that cannot be read rejects; it is never {files: []}.
export async function scanFolder(dirPath) {
  return invoke('scanFolder', dirPath);
}

export async function chooseCsv() {
  return invoke('chooseCsv');
}

// The CSV's raw text. Parsing is renderer/data/csv.js's job (Task 3).
export async function readCsv(filePath) {
  return invoke('readCsv', filePath);
}
```

- [ ] **Step 7: Verify the tests pass (GREEN)**

Run: `node --test test/api.test.js`

Expected: `ℹ tests 23`, `ℹ pass 23`, `ℹ fail 0` (the file's 19 existing tests plus the four from Step 1).

Run: `node --test test/*.test.js`

Expected: `ℹ tests 212`, `ℹ pass 212`, `ℹ fail 0` — Task 1's 208 plus this task's 4. If Task 1's junction test skipped on this machine the line reads `ℹ pass 211` with `ℹ skipped 1`; either is green. Any `fail` count other than 0 stops the task.

- [ ] **Step 8: CONTROLLER VERIFICATION over CDP (not the implementer; no user gate)**

The unit tests prove the `api.js` layer against a stubbed bridge; this step proves the real chain — preload entry → `ipcMain` handler → `scan-folder.js` — on a scratch-profile launch. Launch as in "Launching for verification" (the plan preamble):

```powershell
Set-Location "C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign"
$env:SPINE_CONTOUR_PYTHON = "C:\Users\codyj\spine contour\.venv\Scripts\python.exe"
node tools/smoke/launch.mjs            # scratch profile, CDP on 9222; refuses a held port (quit first)
```

Wait for its `{"ready": true, …}` line — a live process is not a ready app. Then build a small fixture under the gitignored `tools/smoke/out/` (which `launch.mjs` has just created). The scanner reads names only, so one-byte contents are fine; the CSV gets exact bytes so its read-back can be asserted:

```powershell
$fx = "C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign\tools\smoke\out\task2-fixture"
New-Item -ItemType Directory -Force "$fx\batch" | Out-Null
[IO.File]::WriteAllText("$fx\a.png", "x")
[IO.File]::WriteAllText("$fx\b.PNG", "x")
[IO.File]::WriteAllText("$fx\batch\c.jpg", "x")
[IO.File]::WriteAllText("$fx\fixture.csv", "study_id,age`r`na,58`r`n")
$abs = $fx -replace '\\', '/'
```

`$fx` is absolute on purpose. `[IO.File]::…` is a .NET call and resolves a relative path against the .NET current directory, which `Set-Location` does NOT change and which does not carry between shell invocations — with a relative `$fx` the `New-Item` would create the folder while all four writes threw `DirectoryNotFoundException`, leaving an empty fixture that makes check 5 report `{"files": [], "skipped": 0}` and check 6 fail with `The CSV file was not found.`, both of which read as defects in `scan-folder.js` or the new handlers. Always pass `[IO.File]::…` an absolute path (Gate 1 and Task 6 already do).

Evaluate each expression with `node tools/smoke/cdp.mjs "<expr>"` (module instances are shared with the running page, so `import('./renderer/api.js')` is the page's own `api.js`). `cdp.mjs` prints the result as pretty-printed JSON and, if the page logged any error during the call, a `page errors during call:` line — expect none anywhere below.

1. The bridge carries the four entries (preload wiring):
   `node tools/smoke/cdp.mjs "['chooseFolder', 'scanFolder', 'chooseCsv', 'readCsv'].map((k) => typeof window.spineContour[k])"`
   → `["function", "function", "function", "function"]`
2. Empty argument, through `api.js` — the handler's message arrives without the IPC prefix:
   `node tools/smoke/cdp.mjs "import('./renderer/api.js').then((m) => m.scanFolder('')).catch((e) => e.message)"`
   → `"No folder was selected."`
3. Missing CSV:
   `node tools/smoke/cdp.mjs "import('./renderer/api.js').then((m) => m.readCsv('C:/does/not/exist.csv')).catch((e) => e.message)"`
   → `"The CSV file was not found."`
4. Missing folder:
   `node tools/smoke/cdp.mjs "import('./renderer/api.js').then((m) => m.scanFolder('C:/does/not/exist')).catch((e) => e.message)"`
   → `"The folder was not found."`
5. The fixture's counts — three films in sorted, depth-first order (`b.PNG` before `batch` because `.` sorts before `a`), the CSV counted as skipped:
   `node tools/smoke/cdp.mjs "import('./renderer/api.js').then((m) => m.scanFolder('$abs'))"`
   → `{"files": ["<abs>\\a.png", "<abs>\\b.PNG", "<abs>\\batch\\c.jpg"], "skipped": 1}` where `<abs>` is the fixture's absolute path with backslashes (JSON-escaped as `\\`) — `path.join` normalises the forward slashes the expression passed in.
6. A real CSV read back byte for byte:
   `node tools/smoke/cdp.mjs "import('./renderer/api.js').then((m) => m.readCsv('$abs/fixture.csv'))"`
   → `"study_id,age\r\na,58\r\n"`
7. Quit cleanly: `node tools/smoke/cdp.mjs --quit`

**The native pickers are not verified here.** `chooseFolder()` and `chooseCsv()` open OS dialogs that cannot be driven over CDP; the user exercises them at **GATE 1** (Task 4): the folder picker and the CSV picker open modal over the window, a chosen path lands on the card, and cancelling either leaves the screen unchanged with no toast. No DevTools console script is part of this task's verification.

- [ ] **Step 9: Commit**

```bash
git add main.js preload.js renderer/api.js test/api.test.js
git commit -m "feat: add chooseFolder, scanFolder, chooseCsv and readCsv channels"
```

## Task 3 — CSV parse, auto-map, and the `study_id` join as pure, tested logic

**Files:**
- Modify: `renderer/data/csv.js` (created in plan 03; today it holds only `toCsv` at lines 45–68 — append after line 68, do not touch `toCsv` or anything above it)
- Modify: `test/csv.test.js` (8 `toCsv` tests today; extend the import on line 3 and append after line 155, keep every existing test)

**Interfaces:**
- Consumes: nothing beyond the JS standard library. Pure — no `fs`, no Electron, no DOM — safe in the browser and under `node --test`.
- Produces, all from `renderer/data/csv.js` (consumed by Task 4 `workspace.js`, Task 5 `clinical-data.js`, Task 6 `main.js`):
  - `export const KNOWN_FIELDS` — `['Age','Sex','BMI','Diagnosis','ODI','Treatment plan','Surgical history','Follow-up','Notes']`
  - `export function parse(text) → {headers: string[], rows: Object<string,string>[]}`
  - `export function autoMap(headers) → Mapping[]` where `Mapping = {src: string, dest: string|null}`
  - `export function fileStem(name) → string`
  - `export function findJoinHeader(headers) → string|null`
  - `export function joinClinical({ files, headers, rows, mapping }) → { joinHeader: string|null, byFile: Map<string, Object<string,string>>, matched: number, unmatched: number, duplicates: number, ambiguous: number }`
  - `export function clinicalFieldNames(studies) → string[]`

Everything the Workspace screen and the clinical drawer do with a CSV is decided here, as pure functions with real assertions, so Task 4 and Task 5 only wire results into the DOM. Three rules from the plan's design notes are implemented exactly once: `study_id` is the join key and never a clinical field (`autoMap` only ever matches `KNOWN_FIELDS`, so a `study_id` header comes back `dest: null`; `findJoinHeader` finds the join column separately); a film on disk has no id before it is loaded, so a CSV row joins a film on the film's filename stem, case-insensitively; and `autoMap` is a prefix rule on stripped, lowercased strings, not a synonym table — `odi_base` → `ODI` and `age_yrs` → `Age`, but `tx_plan` and `dx_text` stay unmapped because neither `txplan` nor `dxtext` is a prefix of any known field's stripped name (nor the reverse), and a rule that knew `dx` would have to know `tx`, which the contract forbids. The rule's known cost — `agent` → `Age` — is pinned by a test so nobody later "fixes" it into a synonym table by accident; the user corrects it in the mapping chip, which is the contract's answer ("a convenience, not an authority").

What the parser guarantees beyond the contract's list (quoted fields, embedded commas, doubled quotes, CRLF), each with a test: a leading UTF-8 BOM (Excel's "CSV UTF-8") is stripped so the first header is `study_id`, not `\uFEFFstudy_id`; a double quote opens quoted mode **only while the field so far is empty or whitespace-only** (RFC 4180, plus the leading-space tolerance a hand-edited `1, "Doe, Jane"` needs — that padding is discarded when the quote opens), so a quote that arrives after any other text — a stray inch mark in free text (`5'11"`) — is a literal character rather than the start of a quoted run that would swallow every following row into one cell; a lone `\r` ends a line; blank and whitespace-only lines are dropped (a whitespace-only line would otherwise become a header or a data row); a data row longer than the header drops its extra cells and a shorter one fills `''`; and when two header cells carry the same name the **first** column's value wins in the row object — the same first-wins rule `autoMap` uses when two headers would claim one known field, so the chip the user sees mapped is the column whose value is stored. Values are never trimmed by `parse` — trimming is the join's job, so the raw text is available to whoever needs it — and `joinClinical` trims both the join key and every copied value.

- [ ] **Step 1: Write the failing tests**

Open `test/csv.test.js`. Replace line 3

```js
import { toCsv } from '../renderer/data/csv.js';
```

with exactly

```js
import { toCsv, parse, autoMap, KNOWN_FIELDS, fileStem, findJoinHeader, joinClinical, clinicalFieldNames } from '../renderer/data/csv.js';
```

Lines 1–2 (`import { test } from 'node:test';` and `import assert from 'node:assert/strict';`) already exist — do not add them again. Then append the following after the last existing test (line 155, the end of `toCsv exports a real measured 0 as 0, not an empty cell`):

```js
// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

test('parse handles quoted fields with embedded commas and doubled quotes', () => {
  const { headers, rows } = parse('name,note\n"Doe, Jane","Says ""hi"" often"\n');
  assert.deepEqual(headers, ['name', 'note']);
  assert.deepEqual(rows, [{ name: 'Doe, Jane', note: 'Says "hi" often' }]);
});

test('parse handles embedded newlines inside quoted fields', () => {
  const { headers, rows } = parse('id,notes\r\n1,"line one\nline two"\r\n2,plain\r\n');
  assert.deepEqual(headers, ['id', 'notes']);
  assert.deepEqual(rows, [
    { id: '1', notes: 'line one\nline two' },
    { id: '2', notes: 'plain' },
  ]);
});

test('parse handles CRLF line endings', () => {
  const { headers, rows } = parse('a,b\r\n1,2\r\n3,4\r\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});

test("parse fills '' for a trailing empty cell and for a row shorter than the header", () => {
  const { headers, rows } = parse('a,b,c\n1,2,\n');
  assert.deepEqual(headers, ['a', 'b', 'c']);
  assert.deepEqual(rows, [{ a: '1', b: '2', c: '' }]);
  // A row that simply stops short of the header fills '' too, never undefined.
  assert.deepEqual(parse('a,b,c\n1,2\n').rows, [{ a: '1', b: '2', c: '' }]);
});

test('parse on a header-only file returns zero data rows, with or without a trailing newline', () => {
  const withNewline = parse('study_id,age,sex\n');
  assert.deepEqual(withNewline.headers, ['study_id', 'age', 'sex']);
  assert.deepEqual(withNewline.rows, []);
  const withoutNewline = parse('study_id,age,sex');
  assert.deepEqual(withoutNewline.headers, ['study_id', 'age', 'sex']);
  assert.deepEqual(withoutNewline.rows, []);
});

test('parse strips a leading UTF-8 BOM so the first header is clean', () => {
  // Excel's "CSV UTF-8" writes U+FEFF first; Node's readFile(path, 'utf8') keeps it.
  const { headers, rows } = parse('\uFEFFa,b\r\n1,2\r\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});

test('parse treats a double quote inside an unquoted field as a literal character', () => {
  // A quote opens quoted mode only while the field so far is empty or whitespace (RFC 4180
  // plus a leading-space tolerance). An inch mark arrives after real text, so it must not
  // swallow every following row into one cell.
  const { headers, rows } = parse('a,b\n1,5\'11"\n2,x\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '5\'11"' }, { a: '2', b: 'x' }]);
});

test('parse opens a quoted field after leading whitespace and discards the padding', () => {
  // Hand-edited and Excel-exported CSVs both write `, "Doe, Jane"`. The space before the
  // quote is padding, not data: the quote still opens, and the value carries no leading space.
  assert.deepEqual(parse('a,b\n1, "Doe, Jane"\n').rows, [{ a: '1', b: 'Doe, Jane' }]);
});

test('parse drops the extra cells of a row longer than the header', () => {
  const { headers, rows } = parse('a,b\n1,2,3\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});

test('parse drops blank and whitespace-only lines instead of treating them as data', () => {
  const { headers, rows } = parse('a,b\n   \n1,2\n\n3,4\n\t\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});

test('parse keeps the first column when two headers share a name', () => {
  const { headers, rows } = parse('a,a\n1,2\n');
  assert.deepEqual(headers, ['a', 'a']);
  assert.deepEqual(rows, [{ a: '1' }]);
});

test('parse treats a lone CR as a line ending', () => {
  const { headers, rows } = parse('a,b\r1,2\r3,4\r');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});

// ---------------------------------------------------------------------------
// autoMap
// ---------------------------------------------------------------------------

test('autoMap matches odi_base -> ODI and age_yrs -> Age and leaves STUDY_ID unmapped', () => {
  const mapping = autoMap(['odi_base', 'age_yrs', 'STUDY_ID']);
  assert.deepEqual(mapping, [
    { src: 'odi_base', dest: 'ODI' },
    { src: 'age_yrs', dest: 'Age' },
    { src: 'STUDY_ID', dest: null },
  ]);
});

test('autoMap leaves tx_plan unmapped — txplan is not a prefix of treatmentplan', () => {
  assert.deepEqual(autoMap(['tx_plan']), [{ src: 'tx_plan', dest: null }]);
});

test('autoMap leaves dx_text unmapped — there is no synonym table', () => {
  // "dx" is a common clinical abbreviation for diagnosis, but autoMap only tests whether
  // the stripped, lowercased known-field name is a literal prefix of the stripped header.
  // "dxtext" is not a prefix of "diagnosis", nor the reverse, so this column comes back
  // unmapped like any other unrecognised header. Teaching it dx would force teaching it tx.
  assert.deepEqual(autoMap(['dx_text']), [{ src: 'dx_text', dest: null }]);
});

test('autoMap matches an exact, case-insensitive field name', () => {
  assert.deepEqual(autoMap(['diagnosis', 'NOTES']), [
    { src: 'diagnosis', dest: 'Diagnosis' },
    { src: 'NOTES', dest: 'Notes' },
  ]);
});

test('autoMap returns an empty array for an empty header list', () => {
  assert.deepEqual(autoMap([]), []);
});

test('autoMap lets the first header claim a known field; a later match comes back unmapped', () => {
  assert.deepEqual(autoMap(['odi_base', 'odi_6mo']), [
    { src: 'odi_base', dest: 'ODI' },
    { src: 'odi_6mo', dest: null },
  ]);
});

test('autoMap leaves a blank header unmapped', () => {
  // A trailing comma in the header line yields a '' column; it cannot be mapped honestly.
  assert.deepEqual(autoMap(['', 'age']), [
    { src: '', dest: null },
    { src: 'age', dest: 'Age' },
  ]);
});

test('autoMap maps agent -> Age: the known cost of the prefix rule, corrected in the mapping chip', () => {
  // "age" is a prefix of "agent". This is documented, not a bug: the rule has no word
  // boundaries and no synonym table, and the user overrides it in the Workspace chip.
  assert.deepEqual(autoMap(['agent']), [{ src: 'agent', dest: 'Age' }]);
});

// ---------------------------------------------------------------------------
// KNOWN_FIELDS
// ---------------------------------------------------------------------------

test('KNOWN_FIELDS lists exactly the nine clinical fields in order', () => {
  assert.deepEqual(KNOWN_FIELDS, ['Age', 'Sex', 'BMI', 'Diagnosis', 'ODI',
    'Treatment plan', 'Surgical history', 'Follow-up', 'Notes']);
});

// ---------------------------------------------------------------------------
// fileStem
// ---------------------------------------------------------------------------

test('fileStem returns the basename without its last extension, for either path separator', () => {
  assert.equal(fileStem('C:\\films\\batch\\a.b.dcm'), 'a.b');
  assert.equal(fileStem('/films/batch/SP001.PNG'), 'SP001');
  assert.equal(fileStem('SP002.jpeg'), 'SP002');
});

test('fileStem returns a name without an extension unchanged', () => {
  assert.equal(fileStem('noext'), 'noext');
  assert.equal(fileStem('C:/films/noext'), 'noext');
});

// ---------------------------------------------------------------------------
// findJoinHeader
// ---------------------------------------------------------------------------

test('findJoinHeader finds the study_id column under any spelling', () => {
  assert.equal(findJoinHeader(['age', 'study_id']), 'study_id');
  assert.equal(findJoinHeader(['Study ID', 'age']), 'Study ID');
  assert.equal(findJoinHeader(['studyId']), 'studyId');
});

test('findJoinHeader returns null when no header normalises to studyid', () => {
  assert.equal(findJoinHeader(['id', 'age', 'patient_id']), null);
  assert.equal(findJoinHeader([]), null);
});

// ---------------------------------------------------------------------------
// joinClinical
// ---------------------------------------------------------------------------

const JOIN_MAPPING = [
  { src: 'study_id', dest: null },
  { src: 'age_yrs', dest: 'Age' },
];

test('joinClinical matches a row to the film whose stem equals its study_id, case-insensitively', () => {
  const files = ['C:\\films\\SP001.dcm', 'C:\\films\\sub\\sp002.PNG'];
  const join = joinClinical({
    files,
    headers: ['study_id', 'age_yrs'],
    rows: [{ study_id: 'sp001', age_yrs: '58' }, { study_id: 'SP002', age_yrs: '61' }],
    mapping: JOIN_MAPPING,
  });
  assert.equal(join.joinHeader, 'study_id');
  assert.equal(join.matched, 2);
  assert.equal(join.unmatched, 0);
  assert.equal(join.duplicates, 0);
  assert.equal(join.ambiguous, 0);
  assert.deepEqual(join.byFile.get('C:\\films\\SP001.dcm'), { Age: '58' });
  assert.deepEqual(join.byFile.get('C:\\films\\sub\\sp002.PNG'), { Age: '61' });
});

test('joinClinical counts a row with a blank study_id as unmatched', () => {
  const join = joinClinical({
    files: ['a.png'],
    headers: ['study_id', 'age_yrs'],
    rows: [{ study_id: '   ', age_yrs: '58' }, { study_id: '', age_yrs: '61' }],
    mapping: JOIN_MAPPING,
  });
  assert.equal(join.matched, 0);
  assert.equal(join.unmatched, 2);
  assert.equal(join.byFile.size, 0);
});

test('joinClinical with no study_id column links nothing and counts every row as unmatched', () => {
  const join = joinClinical({
    files: ['a.png', 'b.png'],
    headers: ['id', 'age_yrs'],
    rows: [{ id: 'a', age_yrs: '58' }, { id: 'b', age_yrs: '61' }, { id: 'c', age_yrs: '70' }],
    mapping: [{ src: 'id', dest: null }, { src: 'age_yrs', dest: 'Age' }],
  });
  assert.deepEqual(join, {
    joinHeader: null, byFile: new Map(), matched: 0, unmatched: 3, duplicates: 0, ambiguous: 0,
  });
});

test('joinClinical keeps the first row for a repeated study_id and counts the rest as duplicates', () => {
  const join = joinClinical({
    files: ['a.png'],
    headers: ['study_id', 'age_yrs'],
    rows: [{ study_id: 'a', age_yrs: '58' }, { study_id: 'A', age_yrs: '99' }],
    mapping: JOIN_MAPPING,
  });
  assert.equal(join.matched, 1);
  assert.equal(join.duplicates, 1);
  assert.equal(join.unmatched, 0);
  assert.deepEqual(join.byFile.get('a.png'), { Age: '58' });
});

test('joinClinical attaches a row to no film when two films share its stem, and counts it ambiguous', () => {
  const join = joinClinical({
    files: ['C:\\films\\batch1\\SP001.dcm', 'C:\\films\\batch2\\SP001.png'],
    headers: ['study_id', 'age_yrs'],
    rows: [{ study_id: 'SP001', age_yrs: '58' }],
    mapping: JOIN_MAPPING,
  });
  assert.equal(join.ambiguous, 1);
  assert.equal(join.matched, 0);
  assert.equal(join.unmatched, 0);
  assert.equal(join.byFile.size, 0);
});

test('joinClinical copies only mapped columns under their dest names and trims key and values', () => {
  const join = joinClinical({
    files: ['a.png'],
    headers: ['study_id', 'age_yrs', 'sex', 'tx_plan'],
    rows: [{ study_id: ' a ', age_yrs: ' 58 ', sex: 'F', tx_plan: 'Fusion' }],
    mapping: [
      { src: 'study_id', dest: null },
      { src: 'age_yrs', dest: 'Age' },
      { src: 'sex', dest: 'Sex' },
      { src: 'tx_plan', dest: null },
    ],
  });
  assert.equal(join.matched, 1);
  assert.deepEqual(join.byFile.get('a.png'), { Age: '58', Sex: 'F' });
});

test('joinClinical skips empty and whitespace-only values so absent data stays absent', () => {
  const join = joinClinical({
    files: ['a.png'],
    headers: ['study_id', 'age_yrs', 'sex'],
    rows: [{ study_id: 'a', age_yrs: '', sex: '  ' }],
    mapping: [
      { src: 'study_id', dest: null },
      { src: 'age_yrs', dest: 'Age' },
      { src: 'sex', dest: 'Sex' },
    ],
  });
  assert.equal(join.matched, 1);
  assert.deepEqual(join.byFile.get('a.png'), {});
  assert.equal('Age' in join.byFile.get('a.png'), false);
});

// ---------------------------------------------------------------------------
// clinicalFieldNames
// ---------------------------------------------------------------------------

test('clinicalFieldNames lists known fields in KNOWN_FIELDS order, then custom fields in first-seen order', () => {
  const studies = [
    { id: 'SP-1000', clinical: { Notes: 'x', Zeta: '1' } },
    { id: 'SP-1001', clinical: { Age: '58', Alpha: '2' } },
    { id: 'SP-1002', clinical: {} },
  ];
  assert.deepEqual(clinicalFieldNames(studies), ['Age', 'Notes', 'Zeta', 'Alpha']);
});

test('clinicalFieldNames returns [] with no clinical data and never repeats a field', () => {
  assert.deepEqual(clinicalFieldNames([]), []);
  assert.deepEqual(clinicalFieldNames([{ id: 'SP-1000', clinical: {} }, { id: 'SP-0042' }]), []);
  assert.deepEqual(
    clinicalFieldNames([{ id: 'SP-1000', clinical: { Age: '58' } }, { id: 'SP-1001', clinical: { Age: '61' } }]),
    ['Age'],
  );
});
```

That is 34 new tests: parse ×12, autoMap ×8, KNOWN_FIELDS ×1, fileStem ×2, findJoinHeader ×2, joinClinical ×7, clinicalFieldNames ×2. `test/csv.test.js` goes from 8 to 42.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test test/csv.test.js`
Expected: FAIL at module load — `SyntaxError: The requested module '../renderer/data/csv.js' does not provide an export named 'KNOWN_FIELDS'` (V8 names whichever missing binding it resolves first, not the first in source order; any of the seven new names is the same failure) — reported as one failing file, `ℹ tests 1`, `ℹ pass 0`, `ℹ fail 1`, zero tests executed (the eight `toCsv` tests do not run either, because the import line fails before any `test()` registers).

- [ ] **Step 3: Append the parser, mapper, join and field-name helpers to `renderer/data/csv.js`**

Open `renderer/data/csv.js`. Line 45 is `export function toCsv(studies, fields, opts = {}) {` and line 68 is its closing `}`. Append the following after line 68 — do not modify `toCsv`, `escapeField`, `measurementValue`, `round1` or `MEASUREMENT_COLUMNS`:

```js

// ---------------------------------------------------------------------------
// CSV import: parse, auto-map, and the study_id join (plan 06). All pure.
// ---------------------------------------------------------------------------

/** @typedef {{src: string, dest: string|null}} Mapping */

export const KNOWN_FIELDS = ['Age', 'Sex', 'BMI', 'Diagnosis', 'ODI',
  'Treatment plan', 'Surgical history', 'Follow-up', 'Notes'];

// Hand-written RFC 4180 reader. Beyond quoted fields, embedded commas/newlines, doubled
// quotes and CRLF it also: strips a leading UTF-8 BOM (Excel "CSV UTF-8"); opens quoted mode
// ONLY while the field so far is empty or whitespace (that leading padding is discarded), so a
// quote after any other text — a stray inch mark in free text (5'11") — is a literal character
// rather than the start of a quoted run that would swallow every following row;
// ends a line on a lone CR; drops blank and whitespace-only lines; drops the extra cells of
// a row longer than the header and fills '' for a shorter one; and keeps the FIRST column
// when two headers share a name (the same first-wins rule autoMap applies to known fields).
// Values are not trimmed here — joinClinical trims what it copies.
export function parse(text) {
  const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = src.length;

  function pushField() {
    row.push(field);
    field = '';
  }

  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < len) {
    const char = src[i];

    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field.trim() === '') {
      // Field start, or only whitespace so far: `1, "Doe, Jane"` is the quoted form Excel and
      // hand-edited CSVs both produce. The padding before the quote is not data, so drop it.
      field = '';
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }

    if (char === '\r' && src[i + 1] === '\n') {
      pushRow();
      i += 2;
      continue;
    }

    if (char === '\n' || char === '\r') {
      pushRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // A blank or whitespace-only line parses to a single field with no text — drop those rather
  // than letting one become the header row or a data row. (This also drops a legitimate
  // single-column data row whose only value is whitespace; acceptable for this tool.)
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0];
  // First column wins for a duplicated header name. Indexed by NAME, not by `h in obj`: `{}`
  // inherits Object.prototype, so `'toString' in obj` is already true before anything is
  // written and a column headed `constructor`/`toString`/`valueOf`/`hasOwnProperty` would be
  // silently dropped from every row while `headers` still advertised it.
  const firstIndex = new Map();
  headers.forEach((h, idx) => { if (!firstIndex.has(h)) firstIndex.set(h, idx); });
  const dataRows = nonEmpty.slice(1).map((r) => {
    const obj = {};
    for (const [h, idx] of firstIndex) obj[h] = r[idx] !== undefined ? r[idx] : '';
    return obj;
  });

  return { headers, rows: dataRows };
}

function normalizeFieldName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A known field matches a header when the field's normalised name equals, or is a prefix of,
// the header's normalised name: odi_base → ODI, age_yrs → Age, "Diagnosis date" → Diagnosis.
// It is a convenience, not an authority — no synonym table (dx_text and tx_plan stay
// unmapped) and no word boundaries (agent → Age; the user corrects it in the mapping chip).
// Each known field is claimed by at most one header; the first matching header wins and any
// later match comes back unmapped, so one clinical value is never fed by two columns.
export function autoMap(headers) {
  const known = KNOWN_FIELDS.map((field) => ({ field, key: normalizeFieldName(field) }));
  const claimed = new Set();
  return headers.map((src) => {
    const key = normalizeFieldName(src);
    if (key === '') return { src, dest: null };
    const match = known.find((f) => key === f.key || key.startsWith(f.key));
    if (!match || claimed.has(match.field)) return { src, dest: null };
    claimed.add(match.field);
    return { src, dest: match.field };
  });
}

// Basename (either separator) without its last extension: 'a.b.dcm' → 'a.b', 'noext' → 'noext'.
// A leading dot is not an extension ('.hidden' → '.hidden').
export function fileStem(name) {
  const base = String(name).split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

// The join column is whichever header normalises to 'studyid' (study_id, Study ID, studyId…).
// It is found independently of autoMap: study_id is the join key, never a clinical field.
export function findJoinHeader(headers) {
  const found = headers.find((h) => normalizeFieldName(h) === 'studyid');
  return found === undefined ? null : found;
}

// Joins CSV rows to films on the film's filename stem, case-insensitively. A film has no id
// before it is loaded, so its filename is the only identity a row can name. Per row, in
// order: a blank study_id is unmatched; a study_id already seen is a duplicate (the first
// row wins); a stem no film carries is unmatched; a stem two or more films carry is
// ambiguous and attaches to none (a patient's data is never attached to an arbitrary film);
// otherwise the row is matched and every mapping with a dest copies row[src], trimmed,
// skipping empty values so absent data stays absent. byFile is keyed by the exact string
// given in `files`, so the caller reads it back with the same paths it passed in.
export function joinClinical({ files, headers, rows, mapping }) {
  const joinHeader = findJoinHeader(headers);
  if (joinHeader === null) {
    return { joinHeader: null, byFile: new Map(), matched: 0, unmatched: rows.length, duplicates: 0, ambiguous: 0 };
  }

  const filmsByStem = new Map();
  for (const filePath of files) {
    const stem = fileStem(filePath).toLowerCase();
    const list = filmsByStem.get(stem);
    if (list) list.push(filePath);
    else filmsByStem.set(stem, [filePath]);
  }

  const mapped = mapping.filter((m) => m.dest);
  const seen = new Set();
  const byFile = new Map();
  let matched = 0;
  let unmatched = 0;
  let duplicates = 0;
  let ambiguous = 0;

  for (const row of rows) {
    const key = String(row[joinHeader] ?? '').trim().toLowerCase();
    if (key === '') {
      unmatched += 1;
      continue;
    }
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    const films = filmsByStem.get(key);
    if (!films) {
      unmatched += 1;
      continue;
    }
    if (films.length > 1) {
      ambiguous += 1;
      continue;
    }
    matched += 1;
    const clinical = {};
    for (const m of mapped) {
      const value = String(row[m.src] ?? '').trim();
      if (value !== '') clinical[m.dest] = value;
    }
    byFile.set(films[0], clinical);
  }

  return { joinHeader, byFile, matched, unmatched, duplicates, ambiguous };
}

// The union of clinical field names over the studies: KNOWN_FIELDS order first, then custom
// names in first-seen order. Bootstrap seeds state.fields with it so persisted values are
// visible after a restart. A study without a clinical object contributes nothing.
export function clinicalFieldNames(studies) {
  const present = new Set();
  for (const study of studies) {
    const clinical = study && study.clinical;
    if (!clinical || typeof clinical !== 'object') continue;
    for (const name of Object.keys(clinical)) present.add(name);
  }
  const known = KNOWN_FIELDS.filter((name) => present.has(name));
  const custom = [...present].filter((name) => !KNOWN_FIELDS.includes(name));
  return [...known, ...custom];
}
```

Notes for the implementer, each traced against the tests above:

- `parse` reads `src`, not `text`, everywhere after the BOM strip — `charCodeAt(0)` on an empty string is `NaN`, so `parse('')` returns `{ headers: [], rows: [] }` without a branch of its own.
- The quote rule is `char === '"' && field.trim() === ''`, and the opening branch clears `field` so the discarded padding never reaches the value. In `1,5'11"` the quote arrives with `field === "5'11"` — not whitespace-only — so it falls through the three checks below it and is appended literally; the following `\n` still ends the row. In `1, "Doe, Jane"` the quote arrives with `field === ' '`, opens quoted mode, and the row reads `{ a: '1', b: 'Doe, Jane' }`. An empty quoted field `""` still works: the first quote opens (field empty), the second closes because the character after it is not another quote. A field that is only whitespace and carries no quote is untouched — `parse` still never trims.
- Header-only input: with a trailing newline the loop pushes the header row and ends with `field === ''` and `row.length === 0`, so nothing else is pushed; without one the final `pushRow()` flushes the header. Both give `rows: []`.
- The row builder iterates the `firstIndex` map built from `headers`, so a data row's extra cells are never read (`1,2,3` under `a,b` → `{ a: '1', b: '2' }`) and a missing cell reads `undefined` → `''`. `firstIndex` makes `a,a` over `1,2` produce `{ a: '1' }` (first column wins); `headers` itself still reports both names so Task 4 can warn about duplicates. The map is what keeps a header named after an `Object.prototype` member working — a bare `h in obj` test would report `true` for `toString` before anything was written and drop that column's values from every row. A header literally named `__proto__` is still not stored as an own key; that would need `Object.defineProperty`, and no clinical CSV carries it.
- `autoMap` claims per call: `['odi_base', 'odi_6mo']` → `odi6mo` starts with `odi` but `ODI` is already claimed, so the second entry is `{ src: 'odi_6mo', dest: null }`. No stripped `KNOWN_FIELDS` key is a prefix of another (`age sex bmi diagnosis odi treatmentplan surgicalhistory followup notes`), so `find` order never matters. The blank guard makes `''` explicit rather than relying on `''.startsWith('age')` being false.
- `joinClinical` adds a key to `seen` before looking up the film, so the second row of an id that matches no film counts as a duplicate, not a second unmatched — Task 8's fixture (`a`, `b`, `zzz`, `A` over films `a`, `b`) therefore reports `2 matched · 1 unmatched · 1 duplicate`. The `seen` check runs on the trimmed, lowercased key, so `a` and `A` are the same id.
- `joinClinical` never mutates `files`, `rows` or `mapping`; each matched film gets a fresh `clinical` object, which is what Task 4 spreads into a new study record and Task 5 merges into the open study — neither ever holds a reference the join still owns.
- `clinicalFieldNames` does not filter by `source`: demo records carry `clinical: {}` (`renderer/data/demo-studies.js`) and contribute nothing, and `validate` (`renderer/data/persistence.js:137`) guarantees a real record's `clinical` is an object, so the missing-object guard is only defensive.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test test/csv.test.js`
Expected: PASS — `# tests 42`, `# pass 42`, `# fail 0` (the 8 existing `toCsv` tests plus the 34 new ones).

Run: `node --test test/*.test.js`
Expected: every file passes, `# fail 0`; total `# pass 246` (212 after Task 2 + 34 from this task). If Task 1's junction test skipped on this machine the line reads `# pass 245` with `# skipped 1`; either is green.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/csv.js test/csv.test.js
git commit -m "feat: parse CSVs, auto-map columns, and join rows to films by study_id"
```

---

## Task 4 — Workspace screen with its stylesheet

**Files:**
- Modify: `renderer/screens/workspace.js` — replace the plan-02 placeholder (live lines 1–5: `import { el } …; export function render() { return el('main', { class: 'placeholder-screen' }, …) }`) in full; the export name `render` stays.
- Create: `styles/screens/workspace.css`
- Modify: `index.html` — one `<link>` line after live line 16 (`styles/screens/studies.css`)
- Create: `test/workspace.test.js`

**Interfaces:**
- Consumes: `renderer/dom.js` — `el(tag, props, ...children) → HTMLElement`, `mount(node, child)` (clears `node`, appends `child`); `renderer/store.js` — `getState() → frozen state`, `setState(patchOrFn)`; `renderer/api.js` (Task 2) — `chooseFolder() → Promise<string|null>` (null on cancel), `scanFolder(dirPath) → Promise<{files: string[], skipped: number}>` (rejects with a display-ready message), `chooseCsv() → Promise<string|null>`, `readCsv(filePath) → Promise<string>`; `renderer/data/csv.js` (Task 3) — `parse(text) → {headers: string[], rows: Object<string,string>[]}`, `autoMap(headers) → Mapping[]` (`{src, dest: string|null}`), `KNOWN_FIELDS`, `findJoinHeader(headers) → string|null`, `joinClinical({files, headers, rows, mapping}) → {joinHeader: string|null, byFile: Map<string, Object<string,string>>, matched, unmatched, duplicates, ambiguous}` (`byFile` is keyed by the exact strings passed in `files`; a `joinHeader` of `null` means every row is `unmatched`); `renderer/data/persistence.js` — `nextId(studies) → 'SP-1000'` or higher, real studies only; `renderer/screens/studies.js` — `newStudy({id, fileName, filePath}) → Study` (unsegmented real record, `clinical: {}`); `renderer/components/toast.js` — `showToast(message)` (auto-dismissing). **No `saveStudies`**: the store subscriber in `renderer/main.js` (live lines 44–52) persists every new `state.studies` reference and filters demo records itself.
- Produces: `render(state) → HTMLElement`, mounted by `renderer/router.js`'s `SCREENS` table (live line 10, unchanged). Exported for `test/workspace.test.js` only: `loadWorkspaceStudies(state) → { studies, added, known, updated, join }` and `workspaceLoadedMessage({ added, known, updated, join, mapping }) → string`. DOM hooks Task 8 drives: `.workspace-card-meta`, `.workspace-chip`, `.workspace-chip-src`, `.workspace-chip-mapped` / `.workspace-chip-unmapped`, `select.workspace-chip-select[aria-label="Map <src>"]`, `.workspace-card-note`, `button.workspace-load`, `.workspace-load-hint`, and the toast strings below. Nothing else in plan 06 imports this module.

**Why `render(state)` returns a node and refreshes itself:** `router.js` calls `SCREENS[state.screen](state)` and hands the return value to `swap()`/`replaceChild` (live lines 223–224, 240); a `render(container)` that mounts into its argument receives the frozen state object and throws inside `mount()` (F3). `SCREEN_KEYS` is `['screen','ack']` (live line 85) and must stay so, so no `ws*` change remounts this screen: every handler calls `refresh()` after its own `setState`, including the mapping `<select>`'s `onChange` (F32) — handlers run from DOM events, never inside a store subscriber, so the store's re-entrancy guard is never tripped.

**Why the skipped count lives at module scope:** navigating away and back re-runs `render()` while `wsFolder`/`wsFiles` survive in the store, so a closure-local count would come back as `0` — a fabricated number (F13). `lastScan = { folder, skipped }` is module state keyed to the folder it describes; the clause renders only while `lastScan.folder === state.wsFolder`, otherwise the meta line shows the film count alone. Adding a `wsSkipped` key would change the contract's state shape, which this plan does not do.

**Why loading is idempotent and front-inserts:** `filePath` is a film's identity (HANDOFF item 4), so a second Load, or an overlapping folder, must not create a second record (F19): known paths are skipped (case-insensitively — Windows paths) and counted, and a CSV row that matches a known film **fills only the clinical keys that record is missing** (absent or `''`) onto a NEW object so the saver and the router see a reference change. Load never overwrites a value that is already on a record — the user typed or imported it, and a re-Load with a stale CSV must not quietly replace it; a known film with nothing to fill is returned by reference and is not counted in `updated`, so the toast reports only real work. `Import from CSV` in the drawer (Task 5) stays the explicit, per-study overwrite. New records are built with `newStudy` and committed in ONE new-array `setState`, front-inserted in scan order (HANDOFF item 1, F38, F52 — `nextId` is read once and incremented locally). `screen: 'studies'` is set because spec 9.3 says loading "then navigates to Studies"; the handoff's "leaving `openId`/`screen` alone" means "do not open a study", and nothing here touches `openId`.

**Why the copy says what it says:** no run is queued for a scanned film — the only `/predict` path is the Analysis run card — so the hint states the true status (F15); the mapping note describes what the code does with unmatched rows and shows the live join numbers instead of a Studies-list flag that does not exist (F33); a CSV without a `study_id` column is said so in card 02, in a toast, and in the load message rather than reported as "linked" (F18); duplicate `study_id` rows and ambiguous filename stems are counted by `joinClinical` (Task 3) and surface in the note and the load message (F17, F20).

- [ ] **Step 1: Write the failing test file `test/workspace.test.js`**

  The import chain `workspace.js → studies.js → analysis.js → viewer.js → canvas.js` is import-safe under `node --test`: `test/studies.test.js` (live line 3) already imports `screens/studies.js` and passes, and `api.js` guards `window` (live line 27). `csv.js` and `persistence.js` are pure.

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { loadWorkspaceStudies, workspaceLoadedMessage } from '../renderer/screens/workspace.js';

  // A persisted real record, the shape validate() returns (renderer/data/persistence.js).
  function real(id, filePath, clinical = {}) {
    return {
      id, source: 'real', filePath, fileName: filePath.split(/[\\/]/).pop(),
      addedAt: '2026-08-21T12:00:00.000Z', view: 'Standing lateral', thumbnail: null,
      measurements: null, geometry: null, qc: null, clinical,
    };
  }

  const DEMO = { id: 'SP-0042', source: 'demo', view: 'Standing lateral', clinical: {} };

  function baseState(overrides) {
    return {
      studies: [], wsFolder: 'C:\\films', wsFiles: [],
      wsCsv: null, wsCsvHeaders: [], wsCsvRows: [], wsMapping: [],
      ...overrides,
    };
  }

  test('loadWorkspaceStudies front-inserts new films in scan order with consecutive ids from nextId', () => {
    const old = real('SP-1002', 'C:\\films\\old.png');
    const state = baseState({
      studies: [old, DEMO],
      wsFiles: ['C:\\films\\a.png', 'C:\\films\\b.PNG', 'C:\\films\\batch\\c.jpg'],
    });
    const result = loadWorkspaceStudies(state);
    assert.equal(result.added, 3);
    assert.equal(result.known, 0);
    assert.equal(result.updated, 0);
    assert.equal(result.join, null);
    assert.equal(result.studies.length, 5);
    assert.notEqual(result.studies, state.studies);
    assert.deepEqual(result.studies.slice(0, 3).map((s) => s.id), ['SP-1003', 'SP-1004', 'SP-1005']);
    assert.deepEqual(result.studies.slice(0, 3).map((s) => s.fileName), ['a.png', 'b.PNG', 'c.jpg']);
    assert.equal(result.studies[2].filePath, 'C:\\films\\batch\\c.jpg');
    assert.equal(result.studies[0].source, 'real');
    assert.equal(result.studies[0].measurements, null);
    assert.equal(result.studies[3], old);
    assert.equal(result.studies[4], DEMO);
  });

  test('loadWorkspaceStudies skips films already in the library, matching filePath case-insensitively, and counts them', () => {
    const known = real('SP-1000', 'C:\\Films\\A.PNG');
    const state = baseState({
      studies: [known, DEMO],
      wsFiles: ['c:\\films\\a.png', 'C:\\films\\b.png'],
    });
    const result = loadWorkspaceStudies(state);
    assert.equal(result.added, 1);
    assert.equal(result.known, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.studies.length, 3);
    assert.equal(result.studies[0].id, 'SP-1001');
    assert.equal(result.studies[0].filePath, 'C:\\films\\b.png');
    assert.equal(result.studies[1], known);
    assert.equal(result.studies[2], DEMO);
  });

  test('loadWorkspaceStudies fills only the blank clinical keys of a known record and never overwrites', () => {
    // `a` already carries Age (typed in the drawer) and an emptied Sex. The CSV row has both,
    // plus BMI. Load must fill Sex and BMI, leave Age alone, and replace the record with a NEW
    // object; `b` has nothing to fill and must come back by reference, uncounted.
    const a = real('SP-1000', 'C:\\films\\a.png', { Notes: 'keep me', Age: '61', Sex: '' });
    const b = real('SP-1002', 'C:\\films\\b.png', { Age: '44' });
    const other = real('SP-1001', 'C:\\films\\other.png');
    const state = baseState({
      studies: [other, a, b, DEMO],
      wsFiles: ['C:\\films\\a.png', 'C:\\films\\b.png'],
      wsCsv: 'C:\\films\\clinical.csv',
      wsCsvHeaders: ['study_id', 'age_yrs', 'sex', 'bmi'],
      wsCsvRows: [
        { study_id: 'A', age_yrs: '58', sex: 'F', bmi: '27' },
        { study_id: 'b', age_yrs: '30', sex: '', bmi: '' },
      ],
      wsMapping: [{ src: 'study_id', dest: null }, { src: 'age_yrs', dest: 'Age' },
        { src: 'sex', dest: 'Sex' }, { src: 'bmi', dest: 'BMI' }],
    });
    const result = loadWorkspaceStudies(state);
    assert.equal(result.added, 0);
    assert.equal(result.known, 2);
    // Only `a` had something to fill; `b`'s single CSV key (Age) is already set on the record.
    assert.equal(result.updated, 1);
    assert.equal(result.join.matched, 2);
    assert.equal(result.studies.length, 4);
    const merged = result.studies[1];
    assert.notEqual(merged, a);
    // (a) absent and empty keys are filled; (b) the existing Age is NOT overwritten by the CSV's 58.
    assert.deepEqual(merged.clinical, { Notes: 'keep me', Age: '61', Sex: 'F', BMI: '27' });
    assert.deepEqual(a.clinical, { Notes: 'keep me', Age: '61', Sex: '' });
    // (c) nothing to fill -> the same object, and no `updated` count for it.
    assert.equal(result.studies[2], b);
    assert.equal(result.studies[0], other);
    assert.equal(result.studies[3], DEMO);
  });

  test('loadWorkspaceStudies attaches {} without a CSV, and the matched row values with one', () => {
    const files = ['C:\\films\\a.png', 'C:\\films\\b.png'];
    const noCsv = loadWorkspaceStudies(baseState({ wsFiles: files }));
    assert.equal(noCsv.join, null);
    assert.deepEqual(noCsv.studies.map((s) => s.clinical), [{}, {}]);
    const withCsv = loadWorkspaceStudies(baseState({
      wsFiles: files,
      wsCsv: 'C:\\films\\clinical.csv',
      wsCsvHeaders: ['study_id', 'age_yrs'],
      wsCsvRows: [{ study_id: 'a', age_yrs: '58' }],
      wsMapping: [{ src: 'study_id', dest: null }, { src: 'age_yrs', dest: 'Age' }],
    }));
    assert.equal(withCsv.join.matched, 1);
    assert.equal(withCsv.join.unmatched, 0);
    assert.deepEqual(withCsv.studies.map((s) => s.clinical), [{ Age: '58' }, {}]);
    assert.notEqual(withCsv.studies[0].clinical, withCsv.studies[1].clinical);
  });

  test('workspaceLoadedMessage pluralises the added count', () => {
    assert.equal(workspaceLoadedMessage({ added: 1, known: 0, updated: 0, join: null, mapping: [] }),
      'Workspace loaded — 1 study added');
    assert.equal(workspaceLoadedMessage({ added: 3, known: 0, updated: 0, join: null, mapping: [] }),
      'Workspace loaded — 3 studies added');
    assert.equal(workspaceLoadedMessage({ added: 0, known: 0, updated: 0, join: null, mapping: [] }),
      'Workspace loaded — 0 studies added');
  });

  test('workspaceLoadedMessage reports films already in the library and clinical updates', () => {
    assert.equal(workspaceLoadedMessage({ added: 0, known: 4, updated: 0, join: null, mapping: [] }),
      'Workspace loaded — 0 studies added · 4 already in the library');
    assert.equal(workspaceLoadedMessage({ added: 1, known: 4, updated: 2, join: null, mapping: [] }),
      'Workspace loaded — 1 study added · 4 already in the library (clinical data updated for 2)');
  });

  test('workspaceLoadedMessage says when the CSV could not be linked or nothing was mapped', () => {
    const noJoin = { joinHeader: null, byFile: new Map(), matched: 0, unmatched: 3, duplicates: 0, ambiguous: 0 };
    assert.equal(workspaceLoadedMessage({ added: 2, known: 0, updated: 0, join: noJoin, mapping: [{ src: 'age', dest: 'Age' }] }),
      'Workspace loaded — 2 studies added · CSV has no study_id column — 3 rows not linked');
    const joined = { joinHeader: 'study_id', byFile: new Map(), matched: 2, unmatched: 0, duplicates: 0, ambiguous: 0 };
    const nothingMapped = [{ src: 'study_id', dest: null }, { src: 'age_yrs', dest: null }];
    assert.equal(workspaceLoadedMessage({ added: 2, known: 0, updated: 0, join: joined, mapping: nothingMapped }),
      'Workspace loaded — 2 studies added · no columns mapped');
  });

  test('workspaceLoadedMessage lists matched, unmatched, duplicate and ambiguous counts, omitting zeros', () => {
    const mapping = [{ src: 'study_id', dest: null }, { src: 'age_yrs', dest: 'Age' }];
    const full = { joinHeader: 'study_id', byFile: new Map(), matched: 2, unmatched: 1, duplicates: 1, ambiguous: 1 };
    assert.equal(workspaceLoadedMessage({ added: 4, known: 0, updated: 0, join: full, mapping }),
      'Workspace loaded — 4 studies added · clinical data linked (2 matched, 1 unmatched, 1 duplicate study_id, 1 ambiguous filename)');
    const clean = { joinHeader: 'study_id', byFile: new Map(), matched: 2, unmatched: 0, duplicates: 0, ambiguous: 0 };
    assert.equal(workspaceLoadedMessage({ added: 2, known: 0, updated: 0, join: clean, mapping }),
      'Workspace loaded — 2 studies added · clinical data linked (2 matched)');
  });
  ```

- [ ] **Step 2: Verify the tests fail**

  `node --test test/workspace.test.js` → `SyntaxError: The requested module '../renderer/screens/workspace.js' does not provide an export named 'loadWorkspaceStudies'` (the placeholder exports only `render`).

- [ ] **Step 3: Replace `renderer/screens/workspace.js` in full**

  ```js
  /**
   * Workspace screen (spec 9.3). Three step cards -- image folder, optional clinical CSV, column
   * mapping -- and one Load workspace button that turns every scanned film into an unsegmented
   * real Study in a single setState. render(state) returns the screen's root; because
   * router.js remounts this host only on screen/ack, every handler refreshes the screen itself
   * after its setState. Persistence is the store subscriber in renderer/main.js: nothing here
   * calls saveStudies.
   */

  import { el, mount } from '../dom.js';
  import { getState, setState } from '../store.js';
  import { chooseFolder, scanFolder, chooseCsv, readCsv } from '../api.js';
  import { parse, autoMap, KNOWN_FIELDS, findJoinHeader, joinClinical } from '../data/csv.js';
  import { nextId } from '../data/persistence.js';
  import { newStudy } from './studies.js';
  import { showToast } from '../components/toast.js';

  // Icon wells, lifted from the design (design-reference/template.html) the way sidebar.js and
  // landing.js do. FOLDER_SVG is the sidebar's Workspace icon path at the card-well size.
  const FOLDER_SVG = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7 C3.5 5.6 4.6 5 5.5 5 H9.5 L11.5 7.5 H18.5 C19.6 7.5 20.5 8.4 20.5 9.5 V17 C20.5 18.1 19.6 19 18.5 19 H5.5 C4.4 19 3.5 18.1 3.5 17 Z"></path></svg>';
  const CSV_SVG = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 H14 L18.5 8 V20.5 H6 Z"></path><path d="M13.5 3.5 V8.5 H18.5"></path><path d="M9 13 H15.5"></path><path d="M9 16.5 H13"></path></svg>';
  const ARROW_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12 H18"></path><path d="M12.5 6 L18.5 12 L12.5 18"></path></svg>';

  // The last folder scan's skipped count, keyed to the folder it describes. Module scope, not
  // a render() local: the router re-runs render() on every navigation while wsFolder/wsFiles
  // survive in the store, and a count that came back as 0 would be a fabricated number. The
  // clause renders only while lastScan.folder === state.wsFolder.
  let lastScan = null; // { folder, skipped }

  // Pure: the studies list a Load would commit, plus the counts the toast reports. Known films
  // (same filePath, case-insensitively -- Windows paths) are never added twice; when the CSV has
  // a row for a known film, the keys that record is MISSING (absent or empty) are filled onto a
  // NEW object -- an existing value is never overwritten, and a record with nothing to fill is
  // kept by reference and not counted. New records are front-inserted in scan order with
  // consecutive ids; nextId is read once.
  export function loadWorkspaceStudies(state) {
    const join = state.wsCsv
      ? joinClinical({ files: state.wsFiles, headers: state.wsCsvHeaders, rows: state.wsCsvRows, mapping: state.wsMapping })
      : null;

    const knownByPath = new Map();
    for (const study of state.studies) {
      if (study.source === 'real' && typeof study.filePath === 'string' && study.filePath) {
        knownByPath.set(study.filePath.toLowerCase(), study);
      }
    }

    let next = Number(nextId(state.studies).slice(3));
    const added = [];
    const replacements = new Map(); // study id -> the updated record
    let known = 0;
    let updated = 0;

    for (const filePath of state.wsFiles) {
      const existing = knownByPath.get(filePath.toLowerCase());
      if (existing) {
        known += 1;
        const fromCsv = join ? join.byFile.get(filePath) : undefined;
        // Load FILLS BLANKS; it never overwrites. A value already on the record was either
        // typed in the drawer or imported deliberately, and a second Load -- or an overlapping
        // folder scanned with a stale CSV -- must not silently replace it. Only the keys whose
        // current value is absent or empty are taken; if none is, the record is kept BY
        // REFERENCE and not counted, so `updated` never reports work that did not happen.
        // The explicit overwrite path is `Import from CSV` in the drawer (Task 5).
        const fills = {};
        for (const [key, value] of Object.entries(fromCsv ?? {})) {
          const current = existing.clinical ? existing.clinical[key] : undefined;
          if (current == null || current === '') fills[key] = value;
        }
        if (Object.keys(fills).length > 0) {
          replacements.set(existing.id, { ...existing, clinical: { ...existing.clinical, ...fills } });
          updated += 1;
        }
        continue;
      }
      const id = `SP-${String(next++).padStart(4, '0')}`;
      added.push({
        ...newStudy({ id, fileName: filePath.split(/[\\/]/).pop(), filePath }),
        // Spread, never the join's own object: Task 3's note guarantees the store never holds
        // a reference the join still owns.
        clinical: { ...(join?.byFile.get(filePath) ?? {}) },
      });
    }

    const existingWithUpdates = state.studies.map((study) => replacements.get(study.id) ?? study);
    return { studies: [...added, ...existingWithUpdates], added: added.length, known, updated, join };
  }

  // The post-load toast. Every clause describes something the load actually did.
  export function workspaceLoadedMessage({ added, known, updated, join, mapping }) {
    return `Workspace loaded — ${added} ${added === 1 ? 'study' : 'studies'} added`
      + (known ? ` · ${known} already in the library` : '')
      + (updated ? ` (clinical data updated for ${updated})` : '')
      + (join
        ? (join.joinHeader === null
          ? ` · CSV has no study_id column — ${join.unmatched} row${join.unmatched === 1 ? '' : 's'} not linked`
          : (mapping.every((m) => !m.dest)
            ? ' · no columns mapped'
            : ` · clinical data linked (${join.matched} matched`
              + (join.unmatched ? `, ${join.unmatched} unmatched` : '')
              + (join.duplicates ? `, ${join.duplicates} duplicate study_id` : '')
              + (join.ambiguous ? `, ${join.ambiguous} ambiguous filename` : '')
              + ')'))
        : '');
  }

  export function render(state) {
    const inner = el('div', { class: 'workspace-page-inner' });
    const root = el('main', { class: 'workspace-page' }, inner);

    // SCREEN_KEYS carries no ws* key, so this screen rebuilds itself after each of its own
    // setState calls. Every caller is a DOM event handler, never a store subscriber.
    function refresh(live = getState()) {
      mount(inner, buildScreen(live));
    }

    async function onChooseFolder() {
      try {
        const folder = await chooseFolder();
        if (!folder) return;
        const { files, skipped } = await scanFolder(folder);
        lastScan = { folder, skipped };
        setState({ wsFolder: folder, wsFiles: files });
        refresh();
      } catch (error) {
        showToast(`Could not read folder: ${error.message}`);
      }
    }

    async function onChooseCsv() {
      try {
        const csvPath = await chooseCsv();
        if (!csvPath) return;
        const text = await readCsv(csvPath);
        const { headers, rows } = parse(text);
        // A fresh file means fresh defaults: manual overrides never leak across loads.
        setState({ wsCsv: csvPath, wsCsvHeaders: headers, wsCsvRows: rows, wsMapping: autoMap(headers) });
        refresh();
        if (!findJoinHeader(headers)) {
          showToast('This CSV has no study_id column — rows cannot be linked to films.');
        }
        if (new Set(headers).size !== headers.length || headers.includes('')) {
          showToast('The CSV has duplicate or blank column names; those columns cannot be mapped reliably.');
        }
      } catch (error) {
        showToast(`Could not read CSV: ${error.message}`);
      }
    }

    // One new-array setState; the subscribed saver persists it. screen: 'studies' is spec 9.3
    // ("then navigates to Studies"); openId is left alone -- no study is opened.
    function onLoadWorkspace() {
      const live = getState();
      if (!live.wsFolder) return;
      const result = loadWorkspaceStudies(live);
      setState({ studies: result.studies, screen: 'studies' });
      showToast(workspaceLoadedMessage({ ...result, mapping: live.wsMapping }));
    }

    function buildFolderCard(live) {
      const hasFolder = Boolean(live.wsFolder);
      const n = live.wsFiles.length;
      let meta = 'DICOM, PNG, JPG · subfolders included';
      if (hasFolder) {
        meta = `${n} radiograph${n === 1 ? '' : 's'} found`;
        if (lastScan && lastScan.folder === live.wsFolder) {
          meta += ` · ${lastScan.skipped} skipped (unsupported files or links)`;
        }
      }
      return el('div', { class: `card workspace-card${hasFolder ? ' workspace-card-set' : ''}` },
        el('div', { class: 'workspace-card-icon', 'aria-hidden': 'true', innerHTML: FOLDER_SVG }),
        el('div', { class: 'workspace-card-text' },
          el('div', { class: 'eyebrow' }, '01 — IMAGE FOLDER'),
          el('div', { class: 'workspace-card-value' }, hasFolder ? live.wsFolder : 'No folder selected'),
          el('div', { class: 'workspace-card-meta' }, meta)),
        el('button', { type: 'button', class: 'btn btn-small', onClick: onChooseFolder },
          hasFolder ? 'Change…' : 'Choose folder…'));
    }

    function buildCsvCard(live) {
      const hasCsv = Boolean(live.wsCsv);
      let meta = 'One row per study, with a study_id column';
      if (hasCsv) {
        const rows = live.wsCsvRows.length;
        const cols = live.wsCsvHeaders.length;
        const joinHeader = findJoinHeader(live.wsCsvHeaders);
        meta = `${rows} row${rows === 1 ? '' : 's'} · ${cols} column${cols === 1 ? '' : 's'} · `
          + (joinHeader ? `matched on ${joinHeader}` : 'no study_id column — rows cannot be matched');
      }
      return el('div', { class: `card workspace-card${hasCsv ? ' workspace-card-set' : ''}` },
        el('div', { class: 'workspace-card-icon', 'aria-hidden': 'true', innerHTML: CSV_SVG }),
        el('div', { class: 'workspace-card-text' },
          el('div', { class: 'eyebrow' }, '02 — CLINICAL DATA CSV · OPTIONAL'),
          el('div', { class: 'workspace-card-value' }, hasCsv ? live.wsCsv : 'No file selected'),
          el('div', { class: 'workspace-card-meta' }, meta)),
        el('button', { type: 'button', class: 'btn btn-small', onClick: onChooseCsv },
          hasCsv ? 'Change…' : 'Choose CSV…'));
    }

    // Each chip's destination is a <select>, not static text. autoMap is a convenience, not an
    // authority: it cannot know that `dx_text` means Diagnosis without a synonym table that
    // would guess wrong elsewhere, so the user gets the final say. Read state.wsMapping (not
    // autoMap) so manual overrides survive a re-render.
    function buildMappingCard(live) {
      const mapping = live.wsMapping;
      const chips = mapping.map((m, index) => {
        const select = el('select', {
          class: 'workspace-chip-select',
          'aria-label': `Map ${m.src}`,
          onChange: (event) => {
            const dest = event.target.value === '' ? null : event.target.value;
            setState((s) => ({
              wsMapping: s.wsMapping.map((row, i) => (i === index ? { ...row, dest } : row)),
            }));
            // Sibling selects drop or re-offer the field this chip just claimed or released,
            // and this chip's own mapped/unmapped styling changes; the change event has
            // already committed, so rebuilding (and losing focus) is acceptable.
            refresh();
          },
        });
        select.append(el('option', { value: '' }, 'Unmapped'));
        for (const field of KNOWN_FIELDS) {
          // A field already claimed by another column is not offered twice.
          const takenElsewhere = mapping.some((other, i) => i !== index && other.dest === field);
          if (takenElsewhere && m.dest !== field) continue;
          select.append(el('option', { value: field }, field));
        }
        select.value = m.dest ?? '';
        return el('div', { class: `workspace-chip ${m.dest ? 'workspace-chip-mapped' : 'workspace-chip-unmapped'}` },
          el('span', { class: 'workspace-chip-src' }, m.src),
          el('span', { class: 'workspace-chip-arrow' }, '→'),
          select);
      });

      // Live preview of the join this mapping would make. Pure, no new state: the same call
      // onLoadWorkspace makes, against the same files, headers, rows and mapping.
      const join = joinClinical({ files: live.wsFiles, headers: live.wsCsvHeaders, rows: live.wsCsvRows, mapping });
      const rows = live.wsCsvRows.length;
      const preview = join.joinHeader === null
        ? 'This CSV has no study_id column, so no row can be linked.'
        : `${join.matched} of ${rows} rows match a film`
          + (join.unmatched ? ` · ${join.unmatched} unmatched` : '')
          + (join.duplicates ? ` · ${join.duplicates} duplicate study_id` : '')
          + (join.ambiguous ? ` · ${join.ambiguous} ambiguous filename` : '')
          + '. Rows that match no film are counted when the workspace loads and are not attached to any study.';

      return el('div', { class: 'card workspace-card workspace-card-stack' },
        el('div', { class: 'eyebrow' }, '03 — COLUMN MAPPING'),
        el('div', { class: 'workspace-chip-row' }, ...chips),
        el('div', { class: 'workspace-card-note' },
          'Rows are matched to films by ',
          el('span', { class: 'workspace-card-code' }, 'study_id'),
          '. ',
          preview));
    }

    // Returns a fragment so the heading, copy, cards and load row are direct children of
    // .workspace-page-inner (the stylesheet's margin-top rules are sibling rules); mount()
    // appends a fragment's children and clears them again on the next refresh.
    function buildScreen(live) {
      const cards = [buildFolderCard(live), buildCsvCard(live)];
      if (live.wsCsv) cards.push(buildMappingCard(live));
      const loadDisabled = !live.wsFolder;

      const fragment = document.createDocumentFragment();
      fragment.append(
        el('h1', { class: 'workspace-heading' }, 'Workspace'),
        el('div', { class: 'workspace-copy' },
          'Point SpineContour at a folder of radiographs and, optionally, a CSV of clinical data. Nothing is uploaded — files are read from disk on this workstation.'),
        el('div', { class: 'workspace-cards' }, ...cards),
        el('div', { class: 'workspace-load-row' },
          el('button', {
            type: 'button', class: 'btn btn-primary workspace-load',
            disabled: loadDisabled, // boolean: el() assigns node.disabled, and '' would coerce to false
            onClick: onLoadWorkspace,
          }, 'Load workspace', el('span', { class: 'btn-icon', innerHTML: ARROW_SVG })),
          el('div', { class: 'workspace-load-hint' },
            loadDisabled
              ? 'Choose an image folder to continue.'
              : 'New films are added to Studies as Processing. Open one and run segmentation from its Analysis screen.')),
      );
      return fragment;
    }

    refresh(state);
    return root;
  }
  ```

  Notes for the implementer: `el()` sets `disabled` as a property (dom.js live lines 10–11), so the value must be the boolean `loadDisabled`, exactly as `landing.js` line 37 does; `'aria-label'`/`'aria-hidden'` fall through to `setAttribute`; `innerHTML` is a property. The `onChange` handler's `setState` takes a function (store.js live line 57 supports the updater form) and produces a NEW `wsMapping` array. Both `onChooseCsv` toasts are independent `if`s per the sheet; when both apply, the second replaces the first (`showToast` resets the dismiss timer), and card 02's meta line still shows the missing-`study_id` state.

- [ ] **Step 4: Create `styles/screens/workspace.css`**

  Tokens only — no colour literal; the sage tints are `color-mix` on `--sage` against `--border`/`transparent`, the same expression `analysis.css` uses for the confidence pill (live lines 44–45). Shared classes (`.card`, `.btn`, `.btn-primary`, `.btn-small`, `.btn-icon`, `.eyebrow`) come from `components.css`; `.btn:focus-visible` is already defined there (live lines 392–397).

  ```css
  /* Workspace screen (spec 9.3). Tokens only -- every colour is a var() or a color-mix of one. */

  .workspace-page {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }

  .workspace-page-inner {
    max-width: 900px;
    margin: 0 auto;
    padding: 34px 36px 60px;
  }

  .workspace-heading {
    font: 650 26px/1.2 'Source Sans 3', sans-serif;
    color: var(--ink);
    letter-spacing: -0.01em;
  }

  .workspace-copy {
    margin-top: 5px;
    font: 400 15px/1.55 'Source Sans 3', sans-serif;
    color: var(--body);
    max-width: 600px;
  }

  .workspace-cards {
    margin-top: 26px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* Cards 01 and 02: icon well, text block, button in one row. */
  .workspace-card {
    padding: 20px 22px;
    display: flex;
    align-items: center;
    gap: 18px;
  }

  /* Card 03 stacks its eyebrow, chip row and note. */
  .workspace-card-stack {
    display: block;
  }

  .workspace-card-set {
    border-color: color-mix(in srgb, var(--sage) 45%, var(--border));
  }

  .workspace-card-icon {
    width: 42px;
    height: 42px;
    flex-shrink: 0;
    border-radius: 13px;
    background: var(--well);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }

  .workspace-card-set .workspace-card-icon {
    color: var(--sage);
  }

  .workspace-card-text {
    flex: 1;
    min-width: 0;
  }

  .workspace-card-value {
    margin-top: 6px;
    font: 600 15.5px 'Source Sans 3', sans-serif;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .workspace-card-set .workspace-card-value {
    color: var(--ink);
  }

  .workspace-card-meta {
    margin-top: 3px;
    font: 400 13px 'Source Sans 3', sans-serif;
    color: var(--muted);
  }

  /* Column-mapping chips */
  .workspace-chip-row {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .workspace-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 12px 6px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    font: 600 12.5px 'Source Sans 3', sans-serif;
    color: var(--ink);
  }

  .workspace-chip-mapped {
    border-color: color-mix(in srgb, var(--sage) 40%, var(--border));
    background: color-mix(in srgb, var(--sage) 8%, transparent);
  }

  .workspace-chip-unmapped {
    color: var(--muted);
  }

  .workspace-chip-src {
    font-family: 'Chivo Mono', monospace;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.12em;
    color: var(--muted);
  }

  .workspace-chip-arrow {
    color: var(--muted);
    font-size: 11px;
  }

  /* The select inherits the chip's font and colour, so an unmapped chip's select reads muted. */
  .workspace-chip-select {
    font: inherit;
    color: inherit;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px 6px;
    cursor: pointer;
  }

  .workspace-chip-select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .workspace-card-note {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    font: 400 13px/1.5 'Source Sans 3', sans-serif;
    color: var(--muted);
  }

  .workspace-card-code {
    font-family: 'Chivo Mono', monospace;
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    color: var(--ink);
  }

  /* Load row */
  .workspace-load-row {
    margin-top: 22px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .workspace-load-hint {
    font: 400 13.5px 'Source Sans 3', sans-serif;
    color: var(--muted);
  }
  ```

  `styles/**/*` is already in both electron-builder allowlists (`package.json` `build.files`, `electron-builder.preview.yml` `files`), so the new sheet ships without an allowlist change.

- [ ] **Step 5: Link the stylesheet in `index.html`**

  Insert one line after live line 16 (`<link rel="stylesheet" href="styles/screens/studies.css" />`) and before line 17 (`analysis.css`). The contract's `styles/screens/` block lists `workspace.css` *before* `studies.css`, but that block is a file inventory, not a cascade order: the two sheets share no selector, so either position renders identically, and grouping the two new-screen sheets last keeps the diff to one line:

  ```html
      <link rel="stylesheet" href="styles/screens/studies.css" />
      <link rel="stylesheet" href="styles/screens/workspace.css" />
      <link rel="stylesheet" href="styles/screens/analysis.css" />
  ```

  Nothing else in `index.html` changes; the CSP line stays exactly as it is.

- [ ] **Step 6: Verify**

  `node --test test/workspace.test.js` → 8 pass. `node --test test/*.test.js` → **254 pass** (246 after Task 3, + 8 here), 0 fail.

- [ ] **Step 7: CDP pre-gate pass (the controller runs it on a scratch launch; the implementer reads it for the expected values).** This is the sketch Task 8 turns into `tools/smoke/smoke-workspace.mjs`. Native pickers cannot be driven over CDP, so the store is seeded through the page's own modules and only the Load button is clicked.

  1. Fixture. Write `tools/smoke/out/make-ws-fixture.mjs` (`tools/smoke/out/` is gitignored) and run `node tools/smoke/out/make-ws-fixture.mjs` from the worktree. The CSV lives BESIDE the folder, not in it, so the folder scan counts exactly 3 films and 1 skipped:

     ```js
     import fs from 'node:fs';
     import path from 'node:path';
     const root = path.resolve('tools/smoke/out/workspace-fixture');
     fs.rmSync(root, { recursive: true, force: true });
     fs.mkdirSync(path.join(root, 'batch'), { recursive: true });
     // A 1x1 PNG; the scanner checks extensions only and nothing decodes these in this pass.
     const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
     fs.writeFileSync(path.join(root, 'a.png'), png);
     fs.writeFileSync(path.join(root, 'b.PNG'), png);
     fs.writeFileSync(path.join(root, 'batch', 'c.jpg'), png);
     fs.writeFileSync(path.join(root, 'notes.txt'), 'not a film\n');
     // BOM + CRLF, the way Excel's "CSV UTF-8" save writes it.
     fs.writeFileSync(path.resolve('tools/smoke/out/workspace-fixture.csv'),
       '\uFEFFstudy_id,age_yrs,sex,tx_plan\r\na,58,F,Fusion\r\nb,61,M,Observation\r\nzzz,70,F,Fusion\r\nA,99,F,dup\r\n');
     console.log(root);
     ```

  2. Launch (preamble): `Set-Location` to the worktree, set `SPINE_CONTOUR_PYTHON`, `node tools/smoke/launch.mjs` (fresh scratch profile, so the first new id is `SP-1000`).

  3. Seed the store through the page's modules. Write the expression to `tools/smoke/out/ws-load.js` and run `node tools/smoke/cdp.mjs --file tools/smoke/out/ws-load.js`:

     ```js
     (async () => {
       const api = await import('./renderer/api.js');
       const csv = await import('./renderer/data/csv.js');
       const store = await import('./renderer/store.js');
       const folder = String.raw`C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign\tools\smoke\out\workspace-fixture`;
       const csvPath = folder + '.csv';
       const scan = await api.scanFolder(folder);
       const { headers, rows } = csv.parse(await api.readCsv(csvPath));
       const mapping = csv.autoMap(headers);
       store.setState({ wsFolder: folder, wsFiles: scan.files, wsCsv: csvPath, wsCsvHeaders: headers, wsCsvRows: rows, wsMapping: mapping });
       // ws* keys never remount the screen host: bounce through Studies so render() runs.
       store.setState({ ack: true, screen: 'studies' });
       store.setState({ screen: 'workspace' });
       return { scan, headers, rowCount: rows.length, dests: mapping.map((m) => m.dest) };
     })()
     ```

     Expected: `scan.files` is `[…\workspace-fixture\a.png, …\b.PNG, …\batch\c.jpg]` (byte-order sort, depth-first) and `scan.skipped` is `1`; `headers` is `["study_id","age_yrs","sex","tx_plan"]` (the BOM stripped — the first header is exactly `study_id`); `rowCount` 4; `dests` `[null,"Age","Sex",null]`.

  4. Assert the screen. `tools/smoke/out/ws-assert.js`:

     ```js
     (() => {
       const metas = [...document.querySelectorAll('.workspace-card-meta')].map((e) => e.textContent);
       const chips = [...document.querySelectorAll('.workspace-chip')].map((c) => ({
         src: c.querySelector('.workspace-chip-src').textContent,
         dest: c.querySelector('select').value,
         mapped: c.classList.contains('workspace-chip-mapped'),
       }));
       const txOptions = [...document.querySelector('select[aria-label="Map tx_plan"]').options].map((o) => o.textContent);
       return {
         set: [...document.querySelectorAll('.workspace-card')].map((c) => c.classList.contains('workspace-card-set')),
         metas, chips, txOptions,
         note: document.querySelector('.workspace-card-note').textContent,
         loadDisabled: document.querySelector('.workspace-load').disabled,
         hint: document.querySelector('.workspace-load-hint').textContent,
       };
     })()
     ```

     Expected: `set` `[true,true,false]`; `metas` `["3 radiographs found", "4 rows · 4 columns · matched on study_id"]` — no skipped clause on card 01 because this pass bypassed the button and `lastScan` is module-private; the skipped clause is a Gate 1 human step (Task 8 must not assert it either); `chips` `[{study_id,"",false},{age_yrs,"Age",true},{sex,"Sex",true},{tx_plan,"",false}]`; `txOptions` `["Unmapped","BMI","Diagnosis","ODI","Treatment plan","Surgical history","Follow-up","Notes"]` (Age and Sex are claimed); `note` is `Rows are matched to films by study_id. 2 of 4 rows match a film · 1 unmatched · 1 duplicate study_id. Rows that match no film are counted when the workspace loads and are not attached to any study.`; `loadDisabled` `false`; `hint` `New films are added to Studies as Processing. Open one and run segmentation from its Analysis screen.`

  5. Override a mapping through the select. This one goes in a `--file`, as steps 3–4 do, and not on the command line: the expression needs double quotes inside an `aria-label` selector, and PowerShell's escape character is the backtick, so `\"` closes the argument string and `cdp.mjs` receives a fragment that cannot parse. Write `tools/smoke/out/ws-select.js`:

     ```js
     (() => {
       const s = document.querySelector('select[aria-label="Map tx_plan"]');
       s.value = 'Treatment plan';
       s.dispatchEvent(new Event('change'));
       return {
         mapped: [...document.querySelectorAll('.workspace-chip')].map((c) => c.classList.contains('workspace-chip-mapped')),
         ageOffersTx: [...document.querySelector('select[aria-label="Map age_yrs"]').options].some((o) => o.value === 'Treatment plan'),
       };
     })()
     ```

     and run `node tools/smoke/cdp.mjs --file tools/smoke/out/ws-select.js` → `{ mapped: [false,true,true,true], ageOffersTx: false }`. Then, as a one-liner (no nested double quotes, so it passes through intact): `node tools/smoke/cdp.mjs "import('./renderer/store.js').then((m) => m.getState().wsMapping[3].dest)"` → `Treatment plan`. Then `node tools/smoke/cdp.mjs --screenshot tools/smoke/out/workspace.png` and look: sage borders and sage icon wells on cards 01/02, ink path text, muted `study_id` chip, tinted mapped chips, the accent Load button with its arrow.

  6. Load. **Step 5 must have run**: the `Treatment plan` values below come from its override, and without it `top` carries only `Age` and `Sex`. `node tools/smoke/cdp.mjs "import('./renderer/store.js').then((m) => { const before = m.getState().studies.length; document.querySelector('.workspace-load').click(); const s = m.getState(); return { screen: s.screen, toast: s.toast, grew: s.studies.length - before, top: s.studies.slice(0, 3).map((x) => [x.id, x.fileName, x.measurements, x.clinical]) }; })"` → `screen` `studies`; `toast` `Workspace loaded — 3 studies added · clinical data linked (2 matched, 1 unmatched, 1 duplicate study_id)`; `grew` `3`; `top` `[["SP-1000","a.png",null,{"Age":"58","Sex":"F","Treatment plan":"Fusion"}],["SP-1001","b.PNG",null,{"Age":"61","Sex":"M","Treatment plan":"Observation"}],["SP-1002","c.jpg",null,{}]]`. On the Studies screen: three `.badge-proc` rows at the top, summary `12 STUDIES · 3 IN QUEUE`.

  7. Load again: `node tools/smoke/cdp.mjs "import('./renderer/store.js').then((m) => { m.setState({ screen: 'workspace' }); const before = m.getState().studies.length; document.querySelector('.workspace-load').click(); const s = m.getState(); return { toast: s.toast, grew: s.studies.length - before }; })"` → `toast` `Workspace loaded — 0 studies added · 3 already in the library · clinical data linked (2 matched, 1 unmatched, 1 duplicate study_id)`; `grew` `0`. **No `(clinical data updated for …)` clause**: `a.png` and `b.PNG` were created with those CSV values on the first load, so this Load has nothing to fill — Load never overwrites a value that is already there.

  8. Persisted by the saver, real records only: `node tools/smoke/cdp.mjs "new Promise((r) => setTimeout(r, 300)).then(() => window.spineContour.loadStudies()).then((raw) => raw.studies.map((s) => [s.id, s.source, s.clinical]))"` → the three `SP-100x` records with the clinical objects above, every `source` `real`, and no `SP-00xx` id.

  9. Error paths through the bridge: `import('./renderer/api.js').then((m) => m.scanFolder('C:/does/not/exist')).catch((e) => e.message)` → `The folder was not found.`; `readCsv('C:/does/not/exist.csv')` → `The CSV file was not found.` (Task 2's messages; the screen's handlers would toast them as `Could not read folder: …` / `Could not read CSV: …`).

  10. No console errors during the pass (cdp.mjs prints `page errors during call` otherwise). `node tools/smoke/cdp.mjs --quit`.

- [ ] **Step 8: Commit**

  ```
  git add renderer/screens/workspace.js styles/screens/workspace.css index.html test/workspace.test.js
  git commit -m "feat: build the Workspace screen — folder scan, CSV mapping, one-shot load into Studies"
  ```

---

- [ ] **GATE 1 — MANUAL VERIFICATION (user at the app).** Controller first, from the worktree (`Set-Location` to it, `$env:SPINE_CONTOUR_PYTHON` set): `node --test test/*.test.js` → 254 pass; then Task 4 Step 7's CDP pass on a scratch launch (`node tools/smoke/launch.mjs`), every expected value matched and the screenshot eyeballed; `node tools/smoke/cdp.mjs --quit`; all green before asking. Then the user, from source on the real dev profile. **Copy `%APPDATA%\spine-contour\studies.json` and `%APPDATA%\spine-contour\predictions\` aside first** — this gate writes new records into the real library, and step 8 opens `studies.json`:

  ```
  $p = "$env:APPDATA\spine-contour"
  if ((Test-Path "$p\studies.json") -and -not (Test-Path "$p\studies.json.gate1-backup")) { Copy-Item "$p\studies.json" "$p\studies.json.gate1-backup" }
  if (Test-Path "$p\predictions") {
    if (-not (Test-Path "$p\predictions.gate1-backup")) { Copy-Item "$p\predictions" "$p\predictions.gate1-backup" -Recurse }
  } else { "no predictions\ yet — nothing to back up" }
  ```

  `predictions\` may not exist yet — it appears the first time a study is segmented, and this gate segments nothing — so its absence is expected and not an error. The `-not (Test-Path …gate1-backup)` guards matter if you re-run the gate: `Copy-Item` overwrites a file destination silently, so an unguarded second run would replace the pristine backup with the already-modified library.

  Then launch (all three lines, from a fresh shell; the process staying alive is not a launch — wait for the window):

  ```
  Set-Location "C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign"
  $env:SPINE_CONTOUR_PYTHON = "C:\Users\codyj\spine contour\.venv\Scripts\python.exe"
  npm.cmd run dev -- --remote-debugging-port=9222
  ```

  (Quit any scratch instance first with `node tools/smoke/cdp.mjs --quit`, or the port is held.)

  Fixture (prepare before launching; contents do not matter to this gate — nothing is segmented here). Run in PowerShell:

  ```
  $g = "$env:USERPROFILE\Desktop\sc-gate1"
  New-Item -ItemType Directory -Force "$g\films\batch1" | Out-Null
  foreach ($n in 'a.dcm','b.PNG','c.jpg','notes.txt','readme.md') { Set-Content -Path "$g\films\$n" -Value 'x' }
  Set-Content -Path "$g\films\batch1\d.tif" -Value 'x'
  $rows = "study_id,age_yrs,sex,tx_plan`na,58,F,Fusion`nb,61,M,Observation`nzzz-no-match,70,F,Fusion`n"
  [IO.File]::WriteAllText("$g\fixture.csv", $rows, (New-Object Text.UTF8Encoding $false))
  [IO.File]::WriteAllText("$g\fixture-excel.csv", ($rows -replace "`n", "`r`n"), (New-Object Text.UTF8Encoding $true))
  ```

  `fixture-excel.csv` is what Excel's **Save As → CSV UTF-8 (Comma delimited)** produces: a UTF-8 BOM and CRLF line ends. (Saving `fixture.csv` from Excel that way gives the same file, if you prefer to make it by hand.) `films\` scans to 4 radiographs (`a.dcm`, `b.PNG`, `c.jpg`, `batch1\d.tif`) and 2 skipped (`notes.txt`, `readme.md`); the CSVs sit beside `films\`, not inside it. Stems `a` and `b` match two of the films; `zzz-no-match` matches none.

  1. Landing → Enter → sidebar **Workspace**. Expected: heading `Workspace`, the copy `Point SpineContour at a folder of radiographs and, optionally, a CSV of clinical data. Nothing is uploaded — files are read from disk on this workstation.`; card 01 with a muted folder icon in a well, `01 — IMAGE FOLDER`, `No folder selected` in muted text, `DICOM, PNG, JPG · subfolders included`, a `Choose folder…` button; card 02 with a muted document icon, `02 — CLINICAL DATA CSV · OPTIONAL`, `No file selected`, `One row per study, with a study_id column`, `Choose CSV…`; no card 03; the accent `Load workspace` button greyed and unclickable, hint `Choose an image folder to continue.`; sidebar sub-label `NOT SET`. Toggle the theme in Settings: the wells, borders and text follow the dark tokens; toggle back.
  2. Click `Choose folder…` and **Cancel** the picker. Expected: nothing changes — no toast, no card change. Click it again and pick `sc-gate1\films`. Expected: card 01's border and icon turn sage, the path renders in ink (ellipsised if long), meta `4 radiographs found · 2 skipped (unsupported files or links)`, the button now reads `Change…`; `Load workspace` is enabled and the hint reads `New films are added to Studies as Processing. Open one and run segmentation from its Analysis screen.`; sidebar `4 FILMS · 0 ROWS`.
  3. Sidebar **Studies**, then sidebar **Workspace** again. Expected: card 01 still shows the path and `4 radiographs found · 2 skipped (unsupported files or links)` — the same 2, not 0 — and Load is still enabled.
  4. Click `Choose CSV…` and **Cancel**. Expected: nothing changes. Click it again and pick `sc-gate1\fixture.csv`. Expected: card 02 turns sage, shows the path and `3 rows · 4 columns · matched on study_id`, button `Change…`; card 03 `03 — COLUMN MAPPING` appears with four chips, each ending in a dropdown: `study_id → [Unmapped]` (muted), `age_yrs → [Age]` (tinted), `sex → [Sex]` (tinted), `tx_plan → [Unmapped]` (muted); below the chips: `Rows are matched to films by study_id. 2 of 3 rows match a film · 1 unmatched. Rows that match no film are counted when the workspace loads and are not attached to any study.`; sidebar `4 FILMS · 3 ROWS`. Then the override, which is the point of the dropdown:
     - a. Open the `tx_plan` dropdown. Expected: `Unmapped` plus every known field **except** `Age` and `Sex`: `BMI`, `Diagnosis`, `ODI`, `Treatment plan`, `Surgical history`, `Follow-up`, `Notes`.
     - b. Select `Treatment plan`. Expected: the chip switches to the tinted mapped styling and reads `tx_plan → [Treatment plan]`; the note's numbers are unchanged (mapping does not change which rows match).
     - c. Open the `age_yrs` dropdown. Expected: `Treatment plan` is no longer offered.
     - d. Set `tx_plan` back to `Unmapped`, then re-open `age_yrs`. Expected: `Treatment plan` is offered again; the `tx_plan` chip is muted again.
     - e. Set `age_yrs` and `sex` both to `Unmapped`. Expected: the note still reads `2 of 3 rows match a film · 1 unmatched`. (Loading now would toast `· no columns mapped` — do not load yet.) Click `Change…` on card 02 and pick the same `fixture.csv` again. Expected: the chips reset to `autoMap`'s defaults (`age_yrs → [Age]`, `sex → [Sex]`) — a fresh file means fresh defaults, and manual overrides do not leak across loads.
  5. Click `Change…` on card 02 and pick `sc-gate1\fixture-excel.csv` (the BOM + CRLF variant). Expected: identical to step 4 — `3 rows · 4 columns · matched on study_id`, the first chip reads `study_id` (no stray character before it), the same four chips with the same defaults, the same note numbers. Set `tx_plan → [Treatment plan]` again so step 6 can show it.
  6. Click `Load workspace`. Expected: the app navigates to Studies; a toast `Workspace loaded — 4 studies added · clinical data linked (2 matched, 1 unmatched)` appears and clears by itself after about 2 s; the four new rows are at the **top** of the table, above every row the profile already held, each with a `Processing` badge, patient `—`, lordosis `—`, and no `DEMO` pill; their ids continue from the highest real id already in the profile (`SP-1000` if it held none); the summary reads 4 more studies and 4 more in queue than before. Open the `a.dcm` row: the Analysis screen shows the run card (no film cached, no measurements — `—` everywhere); do not run it. Back.
  7. Sidebar **Workspace**. Expected: folder, CSV and mapping are exactly as you left them. Click `Load workspace` again. Expected: Studies again, toast `Workspace loaded — 0 studies added · 4 already in the library · clinical data linked (2 matched, 1 unmatched)` — no `(clinical data updated for …)` clause, because the two matched records already carry those values and a Load only ever fills blanks; **no** new rows — the same four at the top, the count unchanged.
  8. Quit the app (close the window), relaunch with the same command, Enter → Studies. Expected: the four rows are still at the top as `Processing`. Then open `%APPDATA%\spine-contour\studies.json` in an editor. Expected: the four records are present with `"source": "real"`, absolute `filePath`s under `sc-gate1\films`, `"clinical": {"Age": "58", "Sex": "F", "Treatment plan": "Fusion"}` on `a.dcm`, `{"Age": "61", "Sex": "M", "Treatment plan": "Observation"}` on `b.PNG`, `{}` on the other two; Ctrl+F `SP-00` finds **nothing** — no demo record was ever written.
  9. DevTools (Ctrl+Shift+I) console: no red lines during any of the above.
  10. **Restore the library.** This gate wrote four fixture records into the real profile, and there is no in-app delete until Task 7 — putting the backup back **is** how they leave the library. Quit the app first (close the window; the saver must not be running while the file is replaced), then, in PowerShell:

      ```
      $p = "$env:APPDATA\spine-contour"
      Move-Item "$p\studies.json.gate1-backup" "$p\studies.json" -Force
      if (Test-Path "$p\predictions.gate1-backup") {
        if (Test-Path "$p\predictions") { Remove-Item "$p\predictions" -Recurse -Force }
        Move-Item "$p\predictions.gate1-backup" "$p\predictions"
      }
      Remove-Item "$env:USERPROFILE\Desktop\sc-gate1" -Recurse -Force
      ```

      The `Move-Item` names are exactly the `.gate1-backup` names the backup block above created. If the backup block printed `no predictions\ yet — nothing to back up`, the `if` does nothing and there is nothing to undo — this gate segments nothing, so it creates no sidecars. If the profile held **no** `studies.json` before the gate (so no `.gate1-backup` exists and the first `Move-Item` errors), delete the one the gate created instead: `Remove-Item "$p\studies.json"`. Relaunch once and confirm Studies is back to what it was before step 1; the `sc-gate1` folder, both fixture CSVs included, is gone.

---

## Task 5 — Clinical data drawer component with its styles

**Files:** `renderer/components/clinical-data.js` (create), `styles/screens/analysis.css` (modify — the header comment at lines 1–4 and a block appended after line 581), `test/clinical-data.test.js` (create)

**Interfaces:**
- Consumes: `renderer/dom.js` — `el(tag, props, ...children) → HTMLElement`, `clear(node)`; `renderer/store.js` — `getState() → State` (frozen shallow copy), `setState(patchOrFn)`; `renderer/components/toast.js` — `showToast(message)`; `renderer/data/csv.js` (Task 3) — `KNOWN_FIELDS` (`['Age','Sex','BMI','Diagnosis','ODI','Treatment plan','Surgical history','Follow-up','Notes']`) and `joinClinical({ files, headers, rows, mapping }) → { joinHeader, byFile: Map<string, Object<string,string>>, matched, unmatched, duplicates, ambiguous }` (films are keyed by the lowercased filename stem; `byFile` maps each entry of `files` back to the clinical object built from every mapping with a `dest`, values trimmed, empty values skipped). Shared classes from `styles/components.css`: `.icon-btn` (36–53), `.btn`/`.btn-small` (2–29), `.btn-icon` (31–33), `.eyebrow` (131–138) and their `:focus-visible` rings (392–398). **Not** `saveStudies` — nothing in this module writes to disk.
- Produces: `mountClinicalData(host) → { update }` — the sibling shape of `mountMeasurements(container) → { updateMeasurements }` (`renderer/components/measurements.js:82-184`). `host` is the `section.clinical-data` that Task 6 creates in `renderer/screens/analysis.js` and appends as the third child of `main.analysis-screen`; Task 6 calls `update()` from that screen's `update()` on every store notification. Exported pure helper `fieldCountLabel(fieldCount, studyCount) → string`, unit-tested. Module-private `visibleStudies(state) → Study[]` (`[open]` in this plan) is the ONE expression plan 07 swaps for the open + comparison pair; every data row and the count label derive from that array. CSS: the `/* 04 — CLINICAL DATA DRAWER */` block in `styles/screens/analysis.css` (classes `clinical-*`).

The drawer is spec 9.5's collapsible strip below the viewer: a header (chevron, "Clinical data", the field/study count, "Import from CSV"), an `ADD FIELD` chip row with a custom-field input, and an editable grid with one column per active field and one row per visible study. Its state lives on the store (`state.fields`, `state.dataOpen`, and `study.clinical` on each record), so it is a pure function of `getState()` plus a handful of DOM handlers. Three rules shape the code below and answer the pre-flight findings tagged for this task:

- **Persistence is the store subscriber, never this module** (F4, C5). A cell edit commits `{ ...study, clinical: { …, [field]: value } }` as a new record inside ONE new `studies` array through `setState` (an emptied cell deletes the key rather than storing `''`, so a cleared column cannot come back at the next launch — Step 3's `setValue`); `renderer/main.js`'s subscribed saver writes the real-only list and reports failures once. There is no `saveStudies` import and no "check disk permissions" toast. Demo studies are never written, so their cells are rendered disabled with `title: 'Demo studies are not saved'` and Import is disabled the same way (F23) — nothing pretends a demo edit will survive.
- **Rebuilds are reference-gated** (F25, F53). Task 6 calls `update()` from analysis.js's `update()`, which runs on every store notification including pointermove pan frames; without a gate every frame would tear down the grid's `<input>`s and drop focus and uncommitted text. `update()` computes the key `[state.studies, state.fields, state.dataOpen, state.openId, state.compareId, state.wsCsv]` and rebuilds only when it changed — the same `sameKey` as `measurements.js:78-80, 97-99`. Focus is snapshotted and restored across a rebuild the way `measurements.js:114-115, 168-180` does it, keyed on a flat `data-focus-key` attribute, and the custom-field input is explicitly re-focused after Enter so several custom fields can be added in a row. The same snapshot carries the **uncommitted text**: when the focused node is a `.clinical-cell` (identified by its `data-study-id` + `data-field`) or the `.clinical-custom` input, `rebuild` remembers its live `value` and `selectionStart`/`selectionEnd`, finds the same control afterwards, writes the value back, restores the caret and focuses it — so a rebuild driven from outside the drawer (a run finishing, another screen's `setState`) no longer discards what the user was typing; the store value only wins once `change` has committed it. The one thing that snapshot cannot cover is the component's own cell write, because `change` fires while `document.activeElement` is already `<body>`: `setValue` therefore pre-arms the gate so its own notification rebuilds nothing at all (Step 3).
- **"Import from CSV" reads the workspace CSV** (F24, F34). It joins the open study's `fileName` against `state.wsCsvRows` through Task 3's `joinClinical`, so a study added by the picker, or a CSV chosen after the folder was loaded, imports correctly; and because bootstrap seeds `state.fields` from the saved clinical keys (Task 6), values persisted on the record are visible after a restart. When no CSV is loaded the button is disabled with `title: 'Load a CSV in the Workspace first'`. Every message goes through `showToast` (F16). Cell values render `String(value)` for any non-null value, so a numeric `0` is shown, not blanked (F55). The chevron is a real `button.icon-btn` with an SVG chevron and `aria-expanded`, and chips and the `×` hide control are `<button type="button">` elements with labels (F26). That control is labelled **Hide**, not Remove — `aria-label: \`Hide ${name}\``, `title: 'Hide field — values are kept'` — because it only drops the name from `state.fields`: every value stays on its record and on disk, and the column comes back at the next launch if any study still holds a value for it (Task 6 seeds `fields` from `clinicalFieldNames(studies)`). The function is still called `removeField`; it removes a column, not data. The stylesheet exists (F12, F22): flat `clinical-*` class names, tokens only, the accent `+` in every chip, an upload icon on Import, and `--clinical-cols` set through `style.setProperty` after construction because `style` is a forbidden `el()` prop.

Scope is exactly one visible study — the one open on the Analysis screen. Comparison mode is plan 07's job and needs to change only `visibleStudies`.

- [ ] **Step 1: Write the failing test file `test/clinical-data.test.js`**

  The test tree is ESM (`test/package.json` = `{"type":"module"}`); import the component by its named exports. Importing the module is itself the DOM-safety check: `node --test` has no `document`, so the module must not touch the DOM at load time (icons are string constants; `el()` runs only inside `mountClinicalData`).

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { fieldCountLabel, mountClinicalData } from '../renderer/components/clinical-data.js';

  test('fieldCountLabel reads NO FIELDS when no field is active, whatever the study count', () => {
    assert.equal(fieldCountLabel(0, 0), 'NO FIELDS');
    assert.equal(fieldCountLabel(0, 1), 'NO FIELDS');
    assert.equal(fieldCountLabel(0, 2), 'NO FIELDS');
  });

  test('fieldCountLabel uses the singular for one field and for one study', () => {
    assert.equal(fieldCountLabel(1, 1), '1 FIELD · 1 STUDY');
    assert.equal(fieldCountLabel(1, 2), '1 FIELD · 2 STUDIES');
    assert.equal(fieldCountLabel(3, 1), '3 FIELDS · 1 STUDY');
  });

  test('fieldCountLabel uses the plural for several fields and studies, and the module is import-safe', () => {
    assert.equal(fieldCountLabel(2, 2), '2 FIELDS · 2 STUDIES');
    assert.equal(fieldCountLabel(9, 3), '9 FIELDS · 3 STUDIES');
    // The import at the top of this file already proved the module loads without a DOM;
    // pin both facts so a later refactor that reads `document` at module scope fails here.
    assert.equal(typeof globalThis.document, 'undefined');
    assert.equal(typeof mountClinicalData, 'function');
  });
  ```

- [ ] **Step 2: Verify the tests fail**

  ```
  node --test test/clinical-data.test.js
  ```

  Expected: the file errors at import with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…\renderer\components\clinical-data.js'` and the run reports `ℹ fail 1`.

- [ ] **Step 3: Create `renderer/components/clinical-data.js`**

  ```js
  /**
   * Clinical data drawer (spec 9.5). Mounted by screens/analysis.js into its
   * `section.clinical-data` host and driven from that screen's update() on every store
   * notification, exactly like components/measurements.js. Rows come from
   * visibleStudies(state) -- [open] in this plan; plan 07 swaps that one expression for the
   * open study plus the comparison study and nothing else here changes.
   *
   * Persistence: this module never imports saveStudies. A cell edit commits ONE new
   * `studies` array through setState and renderer/main.js's subscribed saver writes the
   * real-only list (architecture contract, Persistence). `fields` and `dataOpen` are session
   * state on the store; bootstrap seeds `fields` from the saved clinical keys (Task 6).
   */

  import { el, clear } from '../dom.js';
  import { getState, setState } from '../store.js';
  import { showToast } from './toast.js';
  import { KNOWN_FIELDS, joinClinical } from '../data/csv.js';

  // 12x12 chevron pointing UP (the drawer is open by default); .clinical-toggle-closed rotates
  // it 180deg in CSS. Same construction as sidebar.js's CHEVRON_SVG.
  const CHEVRON_UP_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14 L12 8 L18 14"></path></svg>';
  // 11x11 upload arrow for the Import button (design-reference/template.html:582).
  const UPLOAD_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15 V4"></path><path d="M7.5 8.5 L12 4 L16.5 8.5"></path><path d="M5 19.5 H19"></path></svg>';

  const EMPTY_COPY = 'No clinical fields yet — add the fields you want above, or import from the CSV.';
  const DEMO_TITLE = 'Demo studies are not saved';
  const NO_CSV_TITLE = 'Load a CSV in the Workspace first';

  export function fieldCountLabel(fieldCount, studyCount) {
    if (!fieldCount) return 'NO FIELDS';
    return `${fieldCount} FIELD${fieldCount === 1 ? '' : 'S'} · ${studyCount} STUD${studyCount === 1 ? 'Y' : 'IES'}`;
  }

  function openStudy(state) {
    return state.studies.find((s) => s.id === state.openId) ?? null;
  }

  // The studies the grid shows, one row each, in row order. Plan 07 replaces this one
  // expression with the open study plus the comparison study; every row, and the count
  // label, is derived from the array so nothing else in this module assumes a count.
  function visibleStudies(state) {
    const open = openStudy(state);
    return open ? [open] : [];
  }

  function sameKey(a, b) {
    return a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);
  }

  export function mountClinicalData(host) {
    clear(host);
    let lastKey = null;

    // ---- actions. All run from DOM events, never inside a store subscriber. ----------

    function addField(name) {
      const state = getState();
      if (state.fields.includes(name)) return;
      setState({ fields: [...state.fields, name] });
      refresh();
    }

    // Hides a COLUMN, never data: the name leaves the session's `fields`, every value stays on
    // its record and on disk, and bootstrap seeds `fields` from the stored keys again at the
    // next launch. That is why the control is labelled "Hide" rather than "Remove".
    function removeField(name) {
      setState((s) => ({ fields: s.fields.filter((f) => f !== name) }));
      refresh();
    }

    // ONE new-array write; the record is replaced, never mutated. The saver subscribed in
    // renderer/main.js persists this reference change on its own. The grid must NOT rebuild
    // here: `change` on a text input is dispatched during the BLUR half of the focus update,
    // when document.activeElement is already <body>, so rebuild()'s focus snapshot would come
    // back null and clear(host) would destroy the very cell the user is tabbing or clicking
    // into -- focus would end on <body>, where viewer.js's window keydown handler (its
    // input/select/textarea guard no longer matching) would turn the next arrow key into a
    // landmark nudge. The input already shows the typed value, so pre-arm the gate with the
    // array update() is about to see; any LATER external change to studies still rebuilds.
    function setValue(studyId, field, value) {
      setState((s) => {
        const studies = s.studies.map((study) => {
          if (study.id !== studyId) return study;
          const clinical = { ...study.clinical };
          // An emptied cell removes the key rather than storing '': joinClinical never writes
          // a blank key either, and Task 6 seeds state.fields from the keys that exist, so a
          // stored '' would resurrect the column at every launch with no way to drop it.
          // Non-empty text is stored exactly as typed -- clinical values are never reformatted
          // (the join stores its own values trimmed; typed text keeps whatever spacing it has).
          if (value.trim() === '') delete clinical[field];
          else clinical[field] = value;
          return { ...study, clinical };
        });
        if (lastKey !== null) lastKey = [studies, ...lastKey.slice(1)];
        return { studies };
      });
    }

    function onToggleOpen() {
      setState((s) => ({ dataOpen: !s.dataOpen }));
      refresh();
    }

    // Populates from the workspace CSV in the store (spec 9.5: the button "must not be lying").
    // The join is the same stem rule the Workspace load uses, run for this one film, so a study
    // added through the picker, or a CSV chosen after the folder was loaded, still imports.
    function onImportFromCsv() {
      const state = getState();
      const study = openStudy(state);
      if (!study || study.source !== 'real' || !state.wsCsv) return;
      const join = joinClinical({
        files: [study.fileName],
        headers: state.wsCsvHeaders,
        rows: state.wsCsvRows,
        mapping: state.wsMapping,
      });
      const fromCsv = join.byFile.get(study.fileName);
      if (!fromCsv) {
        showToast(`No CSV row matches ${study.fileName}.`);
        return;
      }
      // A matched row whose mapped cells are all empty imports zero fields; the toast says 0
      // rather than claiming no row matched.
      const keys = Object.keys(fromCsv);
      setState((s) => ({
        studies: s.studies.map((x) => (x.id === study.id
          ? { ...x, clinical: { ...x.clinical, ...fromCsv } }
          : x)),
        fields: [...s.fields, ...keys.filter((key) => !s.fields.includes(key))],
        dataOpen: true,
      }));
      refresh();
      showToast(`Imported ${keys.length} field${keys.length === 1 ? '' : 's'} from CSV`);
    }

    // ---- builders. Pure functions of the state they are handed. ------------------------

    function buildHeader(state, studies, open) {
      const isDemo = open !== null && open.source === 'demo';
      const canImport = open !== null && !isDemo && Boolean(state.wsCsv);
      // No tooltip on the enabled button (screens/analysis.js's Export CSV precedent).
      const importTitle = isDemo ? DEMO_TITLE : (canImport ? '' : NO_CSV_TITLE);
      return el('div', { class: 'clinical-header' },
        el('button', {
          type: 'button',
          class: `icon-btn clinical-toggle${state.dataOpen ? '' : ' clinical-toggle-closed'}`,
          'aria-label': 'Toggle clinical data',
          'aria-expanded': String(state.dataOpen),
          title: 'Toggle clinical data',
          'data-focus-key': 'toggle',
          innerHTML: CHEVRON_UP_SVG,
          onClick: onToggleOpen,
        }),
        el('div', { class: 'clinical-title' }, 'Clinical data'),
        el('div', { class: 'eyebrow clinical-count' }, fieldCountLabel(state.fields.length, studies.length)),
        el('div', { class: 'clinical-spacer' }),
        el('button', {
          type: 'button',
          class: 'btn btn-small clinical-import',
          disabled: !canImport,
          title: importTitle,
          'data-focus-key': 'import',
          onClick: onImportFromCsv,
        },
          el('span', { class: 'btn-icon', innerHTML: UPLOAD_SVG }),
          'Import from CSV'));
    }

    function buildChipRow(state) {
      const available = KNOWN_FIELDS.filter((name) => !state.fields.includes(name));
      const custom = el('input', {
        type: 'text',
        class: 'clinical-custom',
        placeholder: '+ Custom field…',
        'aria-label': 'Add a custom field',
        'data-focus-key': 'custom',
        onKeydown: (event) => {
          if (event.key !== 'Enter') return;
          const name = custom.value.trim();
          if (!name) return;
          addField(name);
          // addField's refresh() rebuilt the row, so `custom` is now the detached old node.
          // Clear and focus the LIVE input so several custom fields can be added in a row;
          // for a duplicate name (no rebuild) this is the same node and just clears it.
          const live = host.querySelector('.clinical-custom');
          if (live) { live.value = ''; live.focus(); }
        },
      });
      return el('div', { class: 'clinical-chip-row' },
        el('div', { class: 'eyebrow' }, 'ADD FIELD'),
        ...available.map((name) => el('button', {
          type: 'button',
          class: 'clinical-chip',
          'data-focus-key': `chip:${name}`,
          onClick: () => addField(name),
        }, el('span', { class: 'clinical-chip-plus' }, '+'), name)),
        custom);
    }

    function buildGrid(state, studies) {
      if (state.fields.length === 0) return el('div', { class: 'clinical-empty' }, EMPTY_COPY);

      const head = el('div', { class: 'clinical-grid-row clinical-grid-head' },
        el('div', { class: 'clinical-grid-cell' }, 'STUDY'),
        ...state.fields.map((name) => el('div', { class: 'clinical-grid-cell' },
          el('span', {}, name.toUpperCase()),
          el('button', {
            type: 'button',
            class: 'clinical-remove',
            'aria-label': `Hide ${name}`,
            title: 'Hide field — values are kept',
            'data-focus-key': `remove:${name}`,
            onClick: () => removeField(name),
          }, '×'))));

      const rows = studies.map((study) => {
        // Demo records are never written (the saver filters them), so an edit would silently
        // vanish at the next launch. Say so instead of accepting it.
        const isDemo = study.source === 'demo';
        return el('div', { class: 'clinical-grid-row' },
          el('div', { class: 'clinical-grid-cell clinical-grid-id' }, study.id),
          ...state.fields.map((name) => el('input', {
            type: 'text',
            class: 'clinical-cell',
            // A present value renders as itself -- String() keeps a numeric 0 from a hand-edited
            // store visible; only null/undefined is absent, and absent shows the placeholder.
            value: study.clinical?.[name] != null ? String(study.clinical[name]) : '',
            placeholder: '—',
            'aria-label': `${study.id} ${name}`,
            'data-focus-key': `cell:${study.id}:${name}`,
            // The cell's identity, readable back off the node after a rebuild replaced it.
            // Both go through setAttribute (they are not node properties), which is why they
            // are written as attribute names and not as a forbidden `dataset` prop.
            'data-study-id': study.id,
            'data-field': name,
            disabled: isDemo,
            title: isDemo ? DEMO_TITLE : undefined,
            onChange: (event) => setValue(study.id, name, event.target.value),
          })));
      });

      const grid = el('div', { class: 'clinical-grid' }, head, ...rows);
      // A CSS custom property set AFTER construction. `style` must never be an el() prop: the
      // `key in node` branch would assign to the read-only CSSStyleDeclaration and throw.
      grid.style.setProperty('--clinical-cols', `110px repeat(${state.fields.length}, minmax(150px, 1fr))`);
      return grid;
    }

    // ---- rebuild -------------------------------------------------------------------------

    function rebuild(state) {
      const studies = visibleStudies(state);
      const open = openStudy(state);

      // Focus snapshot. clear(host) destroys the focused node and the HTML focus spec then
      // drops document.activeElement to <body>; same fix as measurements.js: remember the
      // node's stable data-focus-key, rebuild, focus the node that now carries it. Only when
      // focus is inside this host -- a rebuild must never steal focus from elsewhere.
      // A focused TEXT FIELD carries more than focus: `change` has not fired yet, so what the
      // user has typed is on the node and nowhere else, and the rebuilt cell would render the
      // older store value. Snapshot the live value and the caret for the two editable controls
      // and put them back below, so a rebuild triggered from OUTSIDE this component (a run
      // finishing, another screen's setState) cannot eat a half-typed cell.
      const active = document.activeElement;
      const inHost = host.contains(active);
      const focusKey = inHost ? active.getAttribute('data-focus-key') : null;
      let typed = null;
      if (inHost && active.classList.contains('clinical-cell')) {
        typed = {
          studyId: active.getAttribute('data-study-id'),
          field: active.getAttribute('data-field'),
          value: active.value,
          selectionStart: active.selectionStart,
          selectionEnd: active.selectionEnd,
        };
      } else if (inHost && active.classList.contains('clinical-custom')) {
        typed = {
          custom: true,
          value: active.value,
          selectionStart: active.selectionStart,
          selectionEnd: active.selectionEnd,
        };
      }

      clear(host);
      host.append(buildHeader(state, studies, open));
      if (state.dataOpen) {
        host.append(el('div', { class: 'clinical-body' }, buildChipRow(state), buildGrid(state, studies)));
      }

      // The typing restore runs first and wins: it is the only path that carries a value the
      // store does not have yet. Nodes are compared attribute by attribute rather than through
      // a built selector -- a custom field name is user text and could carry a quote.
      if (typed) {
        let field = null;
        if (typed.custom) {
          field = host.querySelector('.clinical-custom');
        } else {
          for (const candidate of host.querySelectorAll('.clinical-cell')) {
            if (candidate.getAttribute('data-study-id') === typed.studyId
              && candidate.getAttribute('data-field') === typed.field) { field = candidate; break; }
          }
        }
        if (field && !field.disabled) {
          field.value = typed.value;
          // Both controls are type="text", so setSelectionRange is supported; a null selection
          // (never seen on a text input, but cheap to tolerate) just skips the caret restore.
          if (typed.selectionStart !== null && typed.selectionEnd !== null) {
            field.setSelectionRange(typed.selectionStart, typed.selectionEnd);
          }
          field.focus();
          return;
        }
        // The cell or the field is gone (the study left visibleStudies, the column was hidden,
        // the drawer collapsed): fall through to the plain focus-key restore below.
      }

      if (focusKey !== null) {
        let target = null;
        for (const candidate of host.querySelectorAll('[data-focus-key]')) {
          if (candidate.getAttribute('data-focus-key') === focusKey) { target = candidate; break; }
        }
        // The focused control itself may be gone (a clicked chip, the × of the hidden field,
        // the body of a collapsed drawer); the toggle always exists.
        if (!target) target = host.querySelector('.clinical-toggle');
        if (target && typeof target.focus === 'function') target.focus();
      }
    }

    // Rebuild gate. screens/analysis.js calls this on EVERY store notification, including
    // every pointermove pan frame; without it a pan would tear down the grid's inputs per
    // frame. rebuild() carries focus, the typed value and the caret across a rebuild that does
    // happen, but not rebuilding at all is cheaper and steadier. Compared by reference:
    // `studies` and `fields` are replaced wholesale, never mutated. `wsCsv` is in the key because the
    // Import button's disabled state reads it.
    function update() {
      const state = getState();
      const key = [state.studies, state.fields, state.dataOpen, state.openId, state.compareId, state.wsCsv];
      if (sameKey(key, lastKey)) return;
      lastKey = key;
      rebuild(state);
    }

    // Forced rebuild after this component's own actions. When the drawer is mounted through
    // screens/analysis.js the store notification has usually rebuilt already (each action
    // changes a key); this pass is the guarantee that does not depend on who is subscribed.
    function refresh() {
      lastKey = null;
      update();
    }

    return { update };
  }
  ```

  Notes on `el()` props used above, against `renderer/dom.js:1-23`: `disabled` is always a boolean (property assignment; `''` would coerce to `false`); `title: undefined` is skipped entirely; `'aria-label'`, `'aria-expanded'`, `'data-focus-key'`, `'data-study-id'` and `'data-field'` are not node properties and go through `setAttribute` (which is why the cell's identity is written as two attribute props and never as a forbidden `dataset` prop); `innerHTML` and `value` are properties; `class` is a plain string built with a template literal. No `style` or `dataset` prop anywhere.

- [ ] **Step 4: Style the drawer in `styles/screens/analysis.css`**

  First replace the header comment, lines 1–4 of the live file, with the five-line version:

  ```css
  /* Study Analysis screen.
     01 — screen shell and header  (Task 9 appends here)
     02 — viewer stage             (this task)
     03 — measurements panel       (Task 8 appends here)
     04 — clinical data drawer     (plan 06 Task 5 appends here) */
  ```

  Then append the block below after the last rule (`.meas-warning { color: var(--accent); }`, line 581). Tokens only — no hex or rgb literal; the drawer is DOM over the theme, not the stage, so it reads the theme tokens, never the `.viewer-stage` literals. Two additions to the design, both deliberate: `max-height: 40vh; overflow-y: auto` on `.clinical-data` — at the 900px default window (`main.js`) all nine fields open would otherwise take their height from `.analysis-body` and clip the 400px measurements panel — and `flex-shrink: 0`, which is what keeps the third child of the column-flex `.analysis-screen` from squeezing the stage at all.

  ```css

  /* ===== 04 — CLINICAL DATA DRAWER ======================================
     Mounted by screens/analysis.js as the third child of .analysis-screen (a column flex),
     under .analysis-body. flex-shrink:0 keeps it from stealing height from the stage.
     max-height:40vh + overflow-y:auto is an ADDITION to the design for the 900px default
     window: with all nine fields open the drawer would otherwise clip the 400px
     measurements panel. Tokens only; this is DOM over the theme, not over the stage. */
  .clinical-data {
    flex-shrink: 0;
    max-height: 40vh;
    overflow-y: auto;
    border-top: 1px solid var(--border);
    background: var(--card);
  }

  .clinical-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
  }
  .clinical-toggle svg { display: block; transition: transform .2s ease; }
  .clinical-toggle-closed svg { transform: rotate(180deg); }
  .clinical-title {
    font: 650 15px 'Source Sans 3', sans-serif;
    color: var(--ink);
  }
  .clinical-count { white-space: nowrap; }
  .clinical-spacer { flex: 1; }
  /* .btn.btn-small sizing, brought down to the design's 12.5px header button. */
  .clinical-import {
    gap: 7px;
    padding: 6px 12px;
    border-radius: 9px;
    background: transparent;
    font-size: 12.5px;
  }
  .clinical-import:hover:not(:disabled) { background: var(--well); }

  .clinical-body {
    padding: 2px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .clinical-chip-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .clinical-chip-row .eyebrow { margin-right: 4px; }
  .clinical-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 11px 5px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    font: 600 12px 'Source Sans 3', sans-serif;
    color: var(--body);
    cursor: pointer;
    transition: background .15s ease, color .15s ease;
  }
  .clinical-chip:hover { background: var(--well); color: var(--ink); }
  .clinical-chip-plus { color: var(--accent); font-weight: 700; }
  .clinical-custom {
    width: 130px;
    padding: 4px 11px 5px;
    border: 1.5px dashed var(--border);
    border-radius: 999px;
    background: transparent;
    font: 600 12px 'Source Sans 3', sans-serif;
    color: var(--ink);
  }
  .clinical-custom::placeholder { color: var(--muted); }
  .clinical-custom:focus {
    outline: none;
    border-style: solid;
    border-color: var(--accent);
  }

  .clinical-grid {
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow-x: auto;
  }
  /* --clinical-cols is set on .clinical-grid by the component (style.setProperty) and
     inherited by every row: 110px for the id, then minmax(150px, 1fr) per field. */
  .clinical-grid-row {
    display: grid;
    grid-template-columns: var(--clinical-cols);
  }
  .clinical-grid-row + .clinical-grid-row { border-top: 1px solid var(--border); }
  .clinical-grid-head { background: var(--well); }
  .clinical-grid-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 8px 12px;
    border-left: 1px solid var(--border);
  }
  .clinical-grid-cell:first-child { border-left: none; }
  .clinical-grid-head .clinical-grid-cell {
    font-family: 'Chivo Mono', monospace;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.13em;
    color: var(--muted);
  }
  .clinical-grid-head .clinical-grid-cell span {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .clinical-grid-id {
    font-family: 'Chivo Mono', monospace;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.08em;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .clinical-remove {
    padding: 0 2px;
    border: none;
    background: transparent;
    color: var(--muted);
    font: 600 13px/1 'Source Sans 3', sans-serif;
    cursor: pointer;
  }
  .clinical-remove:hover { color: var(--accent); }

  .clinical-cell {
    border: none;
    border-left: 1px solid var(--border);
    background: transparent;
    padding: 9px 12px;
    font: 400 13px 'Source Sans 3', sans-serif;
    color: var(--ink);
    width: 100%;
    min-width: 0;
  }
  .clinical-cell::placeholder { color: var(--muted); }
  .clinical-cell:disabled { color: var(--muted); cursor: not-allowed; }

  .clinical-empty {
    padding: 14px;
    border: 1.5px dashed var(--border);
    border-radius: 12px;
    text-align: center;
    font: 400 13px 'Source Sans 3', sans-serif;
    color: var(--muted);
  }

  /* Focus rings. .icon-btn and .btn already have theirs in components.css. */
  .clinical-chip:focus-visible,
  .clinical-remove:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .clinical-cell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  ```

  `analysis.css` is linked from `index.html` already and `styles/**/*` is in both electron-builder allowlists, so no other file changes.

- [ ] **Step 5: Verify**

  ```
  node --test test/clinical-data.test.js
  ```

  Expected: `ℹ tests 3`, `ℹ pass 3`, `ℹ fail 0`.

  ```
  node --test test/*.test.js
  ```

  Expected: `ℹ tests 257`, `ℹ pass 257`, `ℹ fail 0` — Task 4's 254 plus the three above. Then a quick grep discipline check that must return nothing (the first pattern is anchored on `import ` on purpose: the file's own header comment says "this module never imports saveStudies", and a bare `saveStudies` pattern would match that deliberate line):

  ```
  grep -n "import .*saveStudies\|setState({ toast\|style:" renderer/components/clinical-data.js
  grep -n "#[0-9A-Fa-f]\{3,6\}\|rgb(" styles/screens/analysis.css | grep -v "stage-\|on-accent"
  ```

  (The second grep's only legitimate hex/rgb lines in `analysis.css` are the `.viewer-stage` token block, lines 163–174, and the `.run-button` `#FFFFFF` at line 387, both pre-existing and both contract-granted stage literals; the new block must add none.)

- [ ] **Step 6: No standalone manual verification**

  The component has no host until Task 6 mounts it into `screens/analysis.js`, and a DevTools scratch mount would exercise it against `state.fields` that nothing seeds and a demo study that is deliberately read-only. Task 6's controller CDP walkthrough on a scratch profile is where the drawer is verified end to end (Import from CSV against a fixture workspace, chip add, type + blur → `study.clinical` and `studies.json`, chevron collapse/expand, demo inputs disabled with their title, relaunch with `SMOKE_KEEP_PROFILE=1` showing the seeded fields), and Task 8's `smoke-workspace.mjs` makes it repeatable. Nothing to do here.

- [ ] **Step 7: Commit**

  ```bash
  git add renderer/components/clinical-data.js styles/screens/analysis.css test/clinical-data.test.js
  git commit -m "feat: build the clinical data drawer component"
  ```

---

## Task 6 — Mount the drawer on Analysis; seed fields at bootstrap; run completion keeps another study's edit

**Files:**
- Modify: `renderer/screens/analysis.js` (imports at lines 1–10; the run-completion `setState` at lines 207–214; the screen root at line 326 and the component mounts at lines 328–329; `update()` at lines 363–387; `teardown()` at lines 70–75 is **not** changed)
- Modify: `renderer/main.js` (imports at lines 1–5; the bootstrap `setState({ studies })` at line 31)

**Interfaces:**
- Consumes, from Task 5 (`renderer/components/clinical-data.js`): `mountClinicalData(host) → { update }` — `host` is an `HTMLElement` this task creates (`section.clinical-data`); `update()` takes no arguments, reads `getState()` itself, computes the key `[state.studies, state.fields, state.dataOpen, state.openId, state.compareId, state.wsCsv]` and rebuilds the drawer's DOM only when that key changed by reference, so it is safe to call on every store notification, pan frames included. The component never calls `setState` from inside `update()` (it is called from a store subscriber, where `setState` throws — `renderer/store.js:52-56`), never subscribes to the store, and disables its inputs and its Import button for a `source === 'demo'` study.
- Consumes, from Task 3 (`renderer/data/csv.js`): `clinicalFieldNames(studies) → string[]` — the union of `Object.keys(study.clinical)` over `studies`, `KNOWN_FIELDS` order first, then custom names in first-seen order; demo records carry `clinical: {}` and contribute nothing.
- Consumes, existing: `el(tag, props, ...children)` from `renderer/dom.js`; `getState`, `setState` from `renderer/store.js`; `mountViewer`, `mountMeasurements` (already imported in `analysis.js`).
- Produces: `section.clinical-data` as the **last child** of `main.analysis-screen`, live for every open study (Task 8's `smoke-workspace.mjs` and Gate 2 assert on `.clinical-data`); `state.fields` seeded at bootstrap from the persisted clinical values (contract amendment 5: "seeded at bootstrap with `clinicalFieldNames(studies)` (plan 06); session-only otherwise"); a run completion that clears `editing`/`selection` only when the finished study is the open one (HANDOFF's "rough edges for plan 06").

Task 5 built the drawer as a component with a host and an `update()`; this task gives it its host on the Analysis screen and its heartbeat, in exactly the shape `mountMeasurements` already has, so the two panels are wired identically. Two small things ride along because they are needed for the drawer to be honest and are two lines each in files this task already edits. First, the values a user types into the drawer persist on `study.clinical` (plan 05's saver writes the record), but `state.fields` — which columns the grid shows — is session state that `renderer/store.js:35` resets to `[]` on every launch, so after a restart the values are on disk and invisible until someone clicks Import or a chip. Seeding `fields` once at bootstrap from the names that actually have stored values fixes that without persisting `fields` (which would change the version-1 store shape — a contract change this plan does not make). Second, `runSegmentation`'s completion `setState` clears `editing` and `selection` unconditionally; with a Studies list a user can open study B and enter edit mode while A's `/predict` is in flight (the viewer only disables Edit when `state.running === study.id`, `renderer/components/viewer.js:727`), and A finishing must not throw B out of edit mode. `editing` and `selection` always belong to `openId` — every writer of `openId` resets them (`renderer/screens/studies.js:52-66`, `FRESH_VIEW`) — so gating both on `state.openId === studyId` keeps today's behaviour for the run's own study and leaves any other study alone. No new unit tests: mounting a component into a screen and a bootstrap `setState` are DOM and Electron paths that `node --test` cannot reach; the controller's CDP walkthrough in Step 7 is the verification, and Task 8 turns its core into `smoke-workspace.mjs`.

- [ ] **Step 1: Import the drawer in `renderer/screens/analysis.js`**

Lines 9–10 read

```js
import { mountViewer, recordPrediction } from '../components/viewer.js';
import { mountMeasurements } from '../components/measurements.js';
```

Replace those two lines with

```js
import { mountViewer, recordPrediction } from '../components/viewer.js';
import { mountMeasurements } from '../components/measurements.js';
import { mountClinicalData } from '../components/clinical-data.js';
```

Lines 1–8 (`el`, the store, the api functions, `showToast`, `toCsv`, the canvas helpers) stay exactly as they are.

- [ ] **Step 2: Give the drawer a host as the last child of the screen root, and mount it**

Lines 324–329 read

```js
  const viewerHost = el('div', { class: 'analysis-viewer-host' });
  const body = el('div', { class: 'analysis-body' }, viewerHost, panel);
  const root = el('main', { class: 'analysis-screen' }, header, body);

  const viewer = mountViewer(viewerHost);
  const measurementsPanel = mountMeasurements(measurementsHost);
```

Replace that whole block with

```js
  const viewerHost = el('div', { class: 'analysis-viewer-host' });
  const body = el('div', { class: 'analysis-body' }, viewerHost, panel);
  // The clinical data drawer is the screen's LAST child, full width below the viewer/panel row
  // (spec 9.5). .analysis-screen is a flex column and .analysis-body is flex:1/min-height:0, so
  // the stage shrinks to make room and the drawer is always in view -- the app shell cannot
  // scroll (.app-shell is height:100vh/overflow:hidden), and it must not: the stage's
  // client-to-image hit-testing assumes a fixed stage. Mounted for demo studies too; the
  // component disables its inputs and its Import button for them.
  const clinicalHost = el('section', { class: 'clinical-data' });
  const root = el('main', { class: 'analysis-screen' }, header, body, clinicalHost);

  const viewer = mountViewer(viewerHost);
  const measurementsPanel = mountMeasurements(measurementsHost);
  const clinical = mountClinicalData(clinicalHost);
```

Leave line 267 — the no-study placeholder branch `return el('main', { class: 'placeholder-screen' }, el('p', {}, 'No study is open.'));` — untouched: with no open study there is nothing for the drawer to show. Do not call `clinical.update()` here in `render()`; the screen's own `update()` (Step 3) is called once at the end of `render()` (line 397, `update();`) and that first call builds the drawer. `mountClinicalData` runs inside `render()`, which runs inside the router's store subscriber — it constructs DOM only and writes no state, which is why it is safe there.

- [ ] **Step 3: Drive the drawer from the screen's `update()`**

Lines 363–387 read

```js
  function update() {
    const live = getState();
    const open = currentStudy(live);
    if (!open) return;

    // `open.pt` is the demo-set PATIENT label, not the PT pelvic-tilt measurement
    // (that is open.measurements.PT). Do not "fix" this to a number.
    headerMeta.textContent = `${open.id} · ${(open.view ?? '').toUpperCase()} · ${open.pt ?? '—'}`;
    confidenceValue.textContent = formatConfidence(open.qc);

    // toCsv already drops demo rows, so exporting a demo study would write a header and no
    // data. Disabling the button says why instead of handing back an empty file.
    const isDemo = open.source === 'demo';
    exportButton.disabled = isDemo;
    // No tooltip on the enabled button: it would only repeat the label it sits on.
    exportButton.title = isDemo ? 'Demo studies are not exported' : '';

    tabMeas.classList.toggle('is-active', live.tab === 'meas');
    tabSim.classList.toggle('is-active', live.tab === 'sim');
    measurementsHost.classList.toggle('is-hidden', live.tab !== 'meas');
    similarHost.classList.toggle('is-hidden', live.tab !== 'sim');

    viewer.updateViewer(open);
    measurementsPanel.updateMeasurements(open);
  }
```

Replace the whole function with

```js
  function update() {
    const live = getState();
    const open = currentStudy(live);
    if (!open) return;

    // `open.pt` is the demo-set PATIENT label, not the PT pelvic-tilt measurement
    // (that is open.measurements.PT). Do not "fix" this to a number.
    headerMeta.textContent = `${open.id} · ${(open.view ?? '').toUpperCase()} · ${open.pt ?? '—'}`;
    confidenceValue.textContent = formatConfidence(open.qc);

    // toCsv already drops demo rows, so exporting a demo study would write a header and no
    // data. Disabling the button says why instead of handing back an empty file.
    const isDemo = open.source === 'demo';
    exportButton.disabled = isDemo;
    // No tooltip on the enabled button: it would only repeat the label it sits on.
    exportButton.title = isDemo ? 'Demo studies are not exported' : '';

    tabMeas.classList.toggle('is-active', live.tab === 'meas');
    tabSim.classList.toggle('is-active', live.tab === 'sim');
    measurementsHost.classList.toggle('is-hidden', live.tab !== 'meas');
    similarHost.classList.toggle('is-hidden', live.tab !== 'sim');

    viewer.updateViewer(open);
    measurementsPanel.updateMeasurements(open);
    // Same contract as updateMeasurements: this runs on EVERY store notification, pan frames
    // included, and the component's own reference-keyed gate decides whether to rebuild. It
    // reads the store itself, so it takes no argument.
    clinical.update();
  }
```

The only change is the `clinical.update();` line and its comment after `measurementsPanel.updateMeasurements(open);`. The `if (!open) return;` guard above it stays: a study that disappears from `state.studies` while this screen is mounted (Task 7's delete sets `screen: 'studies'` in the same `setState`, but the module-scope subscriber at lines 94–101 runs before the router swaps the node) must not reach the panels.

**`teardown()` (lines 70–75) needs no change.** It detaches the viewer because the viewer installs document-level pointer and keyboard listeners that would outlive the screen node. The drawer installs none: every listener it has is bound with `el()` to nodes inside `clinicalHost`, which leaves the document with the screen when the router swaps it; it has no store subscription of its own (its only external heartbeat is `clinical.update()` above, which stops the moment `teardown()` sets `mounted = null` because the subscriber at line 99 returns on `!mounted`); and the closures it holds (`host`, its last key) are garbage with the node. There is nothing to detach.

- [ ] **Step 4: Gate the run-completion reset on the open study**

Lines 207–214 read

```js
    setState((state) => ({
      running: null,
      editing: false,
      selection: null,
      studies: state.studies.map((s) => (s.id === studyId
        ? { ...s, measurements: response.measurements, geometry: response.geometry, qc: response.qc ?? null, thumbnail }
        : s)),
    }));
```

Replace that whole `setState` call with

```js
    // The finished study's own edit mode ends -- its geometry was just replaced under the
    // handles -- but ONLY if it is the study on screen. `editing` and `selection` belong to
    // `openId` (every writer of openId resets both, screens/studies.js FRESH_VIEW), and with a
    // Studies list the user may have opened study B and entered edit mode while A's /predict
    // was in flight: the viewer disables Edit only for the running study itself. A's completion
    // must not drop B out of edit mode. The error path below never touched either key.
    setState((state) => ({
      running: null,
      editing: state.openId === studyId ? false : state.editing,
      selection: state.openId === studyId ? null : state.selection,
      studies: state.studies.map((s) => (s.id === studyId
        ? { ...s, measurements: response.measurements, geometry: response.geometry, qc: response.qc ?? null, thumbnail }
        : s)),
    }));
```

The `studies` mapping is unchanged and still produces one new array — the saver in `renderer/main.js` persists it; nothing here calls `saveStudies`. The `catch` at lines 215–220 (`setState({ running: null })` and the `Could not segment` toast) stays as it is.

- [ ] **Step 5: Seed `fields` at bootstrap in `renderer/main.js`**

Lines 3–5 read

```js
import { loadStudies, saveStudies, disablePersistence, storeLoadNotice, persistenceDisabledReason } from './api.js';
import { merge, createStudySaver } from './data/persistence.js';
import { showToast } from './components/toast.js';
```

Replace those three lines with

```js
import { loadStudies, saveStudies, disablePersistence, storeLoadNotice, persistenceDisabledReason } from './api.js';
import { merge, createStudySaver } from './data/persistence.js';
import { clinicalFieldNames } from './data/csv.js';
import { showToast } from './components/toast.js';
```

Lines 30–31 read

```js
const studies = merge(real);
setState({ studies });
```

Replace them with

```js
const studies = merge(real);
// `fields` (which clinical columns the drawer shows) is session state and is never written to
// disk -- the version-1 store holds Study records only. The VALUES are on each record's
// `clinical`, so seed the columns once from every name that has a stored value: after a
// restart the drawer opens showing what was typed, without a click. Removing a field later in
// the session stays session-only; the next launch seeds it again if a value is still stored.
// Demo records carry clinical: {} and add nothing. Only the module-scope subscribers of
// screens/analysis.js and screens/studies.js are live at this point (router.js imports both);
// each returns immediately because screen is still 'landing'. The saver and the renderer
// subscribe below.
setState({ studies, fields: clinicalFieldNames(studies) });
```

Everything else in `main.js` is untouched. The saver is still primed with `initial: studies` (line 46), so this `setState` causes no write; on a fresh scratch profile `clinicalFieldNames(studies)` is `[]`, exactly today's initial value. `renderer/data/csv.js` is pure (no DOM, no `node:` imports), and `main.js` already imports a pure data module (`./data/persistence.js`), so this adds no new kind of dependency to the bootstrap.

- [ ] **Step 6: Run the full unit suite**

Run: `node --test test/*.test.js`

Expected: every file passes, `# fail 0`; total `# pass 257` — unchanged from Task 5's 257 (257 + 0 = 257; this task adds no tests). If Task 1's junction test skipped on this machine the line reads `# pass 256` with `# skipped 1`; either is green. The existing `test/analysis.test.js` (`formatConfidence`) still imports `renderer/screens/analysis.js`'s pure export unchanged, and `test/clinical-data.test.js` from Task 5 still proves the component module is import-safe without a DOM.

- [ ] **Step 7: Controller CDP walkthrough (scratch profile) — this is the task's verification**

No user step; the human walkthrough is Gate 2 (Task 8). Launch as the preamble says:

```
Set-Location "C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign"
$env:SPINE_CONTOUR_PYTHON = "C:\Users\codyj\spine contour\.venv\Scripts\python.exe"
node tools/smoke/launch.mjs            # scratch profile, CDP on 9222; refuses a held port (quit first)
```

Wait for `{"ready":true,…}`, then poll `node tools/smoke/cdp.mjs "import('./renderer/store.js').then((m) => m.getState().studies.length)"` until it prints a number `> 0` (the nine demo studies; "process alive" is not "ready"). Do the whole walkthrough in this one session up to check 10; `launch.mjs` wipes the scratch profile on every launch that does not set `SMOKE_KEEP_PROFILE`. Every expression below is evaluated with `node tools/smoke/cdp.mjs "<expr>"` — single quotes only inside the expression; PowerShell does not pass `\"` through to node — or, when it is more than a line or needs a double quote, written to a scratch file under `tools/smoke/out/` (git-ignored) and run with `node tools/smoke/cdp.mjs --file <path>`. `cdp.mjs` prints `page errors during call:` after any call that raised a console error — that line must never appear.

1. **Fixture.** Create `tools/smoke/out/workspace-fixture/` holding three copies of the repository film `design-reference/design_src/13462cd9-a59f-4aab-9256-cbd723fb978c.jpg` (the one `tools/smoke/inject-study.js` segments — real films, so a run in check 9 can actually complete) named `a.jpg`, `b.JPG` and `batch/c.jpg`, plus a `notes.txt` with any text. Write the CSV **beside** the folder, not inside it — `tools/smoke/out/workspace-fixture.csv` — so the scan's `skipped` counts only `notes.txt`; with a UTF-8 BOM and CRLF line endings:

   ```
   study_id,age_yrs,sex,tx_plan
   a,58,F,Fusion
   b,61,M,Observation
   zzz,70,F,Fusion
   A,99,F,dup
   ```

   In PowerShell — **remove the folder first**. `tools/smoke/out/` is gitignored but never wiped (`launch.mjs` clears only the scratch profile), so Task 4 Step 7's `a.png`/`b.PNG` fixture is still sitting in this exact directory; without the removal the scan finds 5 films with two ambiguous stems and every expected value in check 2 is wrong. `-Force` on `New-Item` does not clean up — it only suppresses the "already exists" error.

   ```powershell
   $f = "C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign\tools\smoke\out\workspace-fixture"
   Remove-Item -Recurse -Force $f -ErrorAction SilentlyContinue
   New-Item -ItemType Directory -Force "$f\batch" | Out-Null
   $src = "C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign\design-reference\design_src\13462cd9-a59f-4aab-9256-cbd723fb978c.jpg"
   Copy-Item $src "$f\a.jpg"; Copy-Item $src "$f\b.JPG"; Copy-Item $src "$f\batch\c.jpg"
   Set-Content "$f\notes.txt" 'not a film'
   [System.IO.File]::WriteAllText("$f.csv", "`u{FEFF}study_id,age_yrs,sex,tx_plan`r`na,58,F,Fusion`r`nb,61,M,Observation`r`nzzz,70,F,Fusion`r`nA,99,F,dup`r`n")
   "$f".Replace('\','/')   # this is <F> for check 2
   ```

   Both paths are absolute on purpose: `[System.IO.File]::…` resolves a relative path against the .NET current directory, which `Set-Location` does not change.

2. **Load the workspace the way Task 4's CDP pass does** (no native picker over CDP; the pickers are Gate steps). One `--file` script, `<F>` being the fixture's absolute path with forward slashes:

   ```js
   (async () => {
     const api = await import('./renderer/api.js');
     const csv = await import('./renderer/data/csv.js');
     const store = await import('./renderer/store.js');
     const { files, skipped } = await api.scanFolder('<F>');
     const text = await api.readCsv('<F>.csv');
     const { headers, rows } = csv.parse(text);
     store.setState({ ack: true, screen: 'studies' });
     store.setState({ wsFolder: '<F>', wsFiles: files, wsCsv: '<F>.csv', wsCsvHeaders: headers, wsCsvRows: rows, wsMapping: csv.autoMap(headers) });
     store.setState({ screen: 'workspace' });
     const before = store.getState().studies.length;
     document.querySelector('.workspace-load').click();
     await new Promise((resolve) => setTimeout(resolve, 50));
     const s = store.getState();
     return { files: files.length, skipped, headers, mapping: s.wsMapping, screen: s.screen, added: s.studies.length - before,
       top: s.studies.slice(0, 3).map((x) => [x.id, x.fileName, x.clinical]), toast: s.toast };
   })()
   ```

   Expected: `files: 3`, `skipped: 1`; `headers: ["study_id","age_yrs","sex","tx_plan"]` (no BOM on the first header); `mapping` has `age_yrs → "Age"`, `sex → "Sex"`, `study_id → null`, `tx_plan → null`; `screen: "studies"`; `added: 3`; `top` is `SP-1000 a.jpg {Age:"58",Sex:"F"}`, `SP-1001 b.JPG {Age:"61",Sex:"M"}`, `SP-1002 c.jpg {}`; `toast` starts `Workspace loaded — 3 studies added · clinical data linked (2 matched, 1 unmatched, 1 duplicate study_id)`. `fields` is still `[]` (Task 4 does not seed it; bootstrap ran on an empty store).

3. **The drawer is there, below the body.** Open `SP-1000` as the UI does — `node tools/smoke/cdp.mjs "(() => { document.querySelector('.studies-row[data-study-id=SP-1000]').click(); return null; })()"` (`SP-1000` is a valid CSS identifier, so the attribute value needs no quotes) — then evaluate:

   ```js
   (() => { const root = document.querySelector('.analysis-screen'); const d = root.lastElementChild; const body = d.previousElementSibling;
     return { isSection: d.tagName === 'SECTION' && d.classList.contains('clinical-data'), afterBody: body.classList.contains('analysis-body'),
       below: d.getBoundingClientRect().top >= body.getBoundingClientRect().bottom - 1, count: document.querySelector('.clinical-count').textContent,
       expanded: document.querySelector('.clinical-toggle').getAttribute('aria-expanded'), empty: Boolean(document.querySelector('.clinical-empty')),
       importDisabled: document.querySelector('.clinical-import').disabled, stageHeight: document.querySelector('.analysis-body').getBoundingClientRect().height }; })()
   ```

   Expected: `isSection: true`, `afterBody: true`, `below: true`, `count: "NO FIELDS"`, `expanded: "true"`, `empty: true`, `importDisabled: false` (a CSV is loaded and the study is real), `stageHeight` a positive number smaller than the window height — the body shrank; nothing scrolls. Screenshot for the record: `node tools/smoke/cdp.mjs --screenshot tools/smoke/out/task6-drawer.png`.

4. **Import from CSV.** One command — the toast must be read in the SAME expression that clicks, because `showToast` clears it about 2 s later and a second `cdp.mjs` invocation is a new node process that starts well after that: `node tools/smoke/cdp.mjs "import('./renderer/store.js').then((m) => { document.querySelector('.clinical-import').click(); const h = [...document.querySelectorAll('.clinical-grid-head .clinical-grid-cell span')].map((e) => e.textContent); const v = [...document.querySelectorAll('.clinical-cell')].map((e) => e.value); return { h, v, count: document.querySelector('.clinical-count').textContent, fields: m.getState().fields, toast: m.getState().toast }; })"`.

   Expected: `h: ["AGE","SEX"]`, `v: ["58","F"]`, `count: "2 FIELDS · 1 STUDY"`, `fields: ["Age","Sex"]`, `toast: "Imported 2 fields from CSV"` (read synchronously, inside `showToast`'s 2.2 s window).

5. **Add a field with a chip, type a value, blur.** Click the Notes chip: `node tools/smoke/cdp.mjs "(() => { [...document.querySelectorAll('.clinical-chip')].find((b) => b.textContent.trim().endsWith('Notes')).click(); return [...document.querySelectorAll('.clinical-grid-head .clinical-grid-cell span')].map((e) => e.textContent); })()"` → `["AGE","SEX","NOTES"]`. Then, from a script saved as `tools/smoke/out/task6-notes.mjs` that uses `cdp-lib.mjs` directly (trusted input, so the `change` event is the browser's own). The `.mjs` extension is required: the repo root `package.json` has no `"type": "module"`, so a `.js` file here is CommonJS and the `import` line throws before the first assertion.

   ```js
   import { connect } from '../cdp-lib.mjs';   // path relative to tools/smoke/out/
   const cdp = await connect();
   const r = await cdp.rect('.clinical-grid-row:not(.clinical-grid-head) .clinical-cell:nth-of-type(3)');
   await cdp.click(r.cx, r.cy);
   await cdp.typeText('Reviewed');
   await cdp.evaluate('document.activeElement.blur()');
   await cdp.settle(100);
   const s = await cdp.state();
   console.log(JSON.stringify({ notes: s.studies.find((x) => x.id === 'SP-1000').clinical.Notes, errors: cdp.errors }));
   cdp.close();
   ```

   (Run it as `node tools/smoke/out/task6-notes.mjs` — plain `node`, not through `cdp.mjs`; if `nth-of-type` misses because the id cell precedes the inputs, use `.clinical-cell` inside the data row and take index 2 with `querySelectorAll`.) Expected: `notes: "Reviewed"`, `errors: []`. Then, with the drawer still showing three columns, check that a committed edit does not strand focus: click the AGE cell, type a character, press Tab, and type in the SEX cell — the text must land in that cell, not vanish. Then the record on disk, real studies only — `node tools/smoke/cdp.mjs "window.spineContour.loadStudies().then((raw) => ({ ids: raw.studies.map((s) => s.id), notes: raw.studies.find((s) => s.id === 'SP-1000').clinical }))"` — expected `ids` containing `SP-1000`, `SP-1001`, `SP-1002` and **no** `SP-00xx` id; `notes: {Age:"58",Sex:"F",Notes:"Reviewed"}`. Poll up to a few seconds if the saver's write is still in flight.

6. **Chevron collapse and expand keep the values.** `node tools/smoke/cdp.mjs "(() => { document.querySelector('.clinical-toggle').click(); const closed = { grid: Boolean(document.querySelector('.clinical-grid')), expanded: document.querySelector('.clinical-toggle').getAttribute('aria-expanded'), header: Boolean(document.querySelector('.clinical-title')) }; document.querySelector('.clinical-toggle').click(); const open = { values: [...document.querySelectorAll('.clinical-cell')].map((e) => e.value), expanded: document.querySelector('.clinical-toggle').getAttribute('aria-expanded') }; return { closed, open }; })()"`.

   Expected: `closed: { grid: false, expanded: "false", header: true }` (the header row with its title, count and Import button stays; the body is gone), `open: { values: ["58","F","Reviewed"], expanded: "true" }`.

7. **A demo study: mounted, disabled, and honest about it.** Back to the list and open `SP-0042`: `node tools/smoke/cdp.mjs "import('./renderer/store.js').then((m) => { m.setState({ screen: 'studies', editing: false, selection: null }); document.querySelector('.studies-row[data-study-id=SP-0042]').click(); return { cells: [...document.querySelectorAll('.clinical-cell')].map((e) => [e.disabled, e.title]), importBtn: [document.querySelector('.clinical-import').disabled, document.querySelector('.clinical-import').title], count: document.querySelector('.clinical-count').textContent, rowId: document.querySelector('.clinical-grid-id').textContent }; })"`.

   Expected: three `cells`, each `[true, "Demo studies are not saved"]`; `importBtn: [true, "Demo studies are not saved"]`; `count: "3 FIELDS · 1 STUDY"` (`fields` is session-global, so the columns are the same; the demo row's cells are empty and disabled); `rowId: "SP-0042"`.

8. **A run for the "run A while editing B" check.** Segment `SP-1001` (study B) first so it has geometry to edit: back to the list, open `SP-1001` (as in check 3), then `node tools/smoke/cdp.mjs --file tools/smoke/run-and-wait.js` → `result: "done"`, `running: null`, `measurements` present. (~10–20 s; the Python backend must be up.)

9. **Run A while editing B — B keeps edit mode.** One `cdp-lib.mjs` script, saved as `tools/smoke/out/task6-run-a-edit-b.mjs` and run with `node tools/smoke/out/task6-run-a-edit-b.mjs` (same shape as check 5's; `.mjs` for the same reason):

   ```js
   import { connect } from '../cdp-lib.mjs';
   const cdp = await connect();
   const open = async (id) => { await cdp.setState("{ screen: 'studies', editing: false, selection: null }"); await cdp.settle();
     await cdp.evaluate(`document.querySelector('.studies-row[data-study-id="${id}"]').click()`); await cdp.settle(150); };
   const waitFor = async (pred, ms) => { const end = Date.now() + ms; while (Date.now() < end) {
     if (await cdp.evaluate(`import('./renderer/store.js').then((m) => { const s = m.getState(); return Boolean(${pred}); })`)) return true; await cdp.settle(150); } return false; };
   await open('SP-1000');                                                     // A: not yet segmented
   await cdp.evaluate("document.querySelector('.run-button').click()");
   const started = await waitFor("s.running === 'SP-1000'", 3000);
   await open('SP-1001');                                                     // B: segmented in check 8
   const editEnabled = await cdp.evaluate("!document.querySelector('.viewer-tool[aria-label=\"Edit landmarks\"]').disabled");
   await cdp.evaluate("document.querySelector('.viewer-tool[aria-label=\"Edit landmarks\"]').click()");
   const editingBefore = (await cdp.state()).editing;
   await cdp.setState("{ selection: { kind: 'landmark', level: 'L3', corner: 'SA' } }");
   const runningAtEdit = (await cdp.state()).running;   // A must STILL be in flight here
   const finished = await waitFor("s.running === null", 240000);
   const s = await cdp.state();
   console.log(JSON.stringify({ started, editEnabled, editingBefore, runningAtEdit, finished, openId: s.openId,
     editingAfter: s.editing, selectionAfter: s.selection,
     aSegmented: Boolean(s.studies.find((x) => x.id === 'SP-1000').measurements), toast: s.toast, errors: cdp.errors }));
   cdp.close();
   ```

   Expected: `started: true`, `editEnabled: true` (Edit is disabled only for the running study), `editingBefore: true`, `runningAtEdit: "SP-1000"` (proof the race was live — if A had already finished, `finished` would be trivially true and the check would prove nothing), `finished: true`, `openId: "SP-1001"`, **`editingAfter: true`**, **`selectionAfter: { kind: "landmark", level: "L3", corner: "SA" }`** (Step 4 gates `selection` on `openId === studyId` too, and only this assertion covers that half), `aSegmented: true`, `toast` not starting with `Could not`, `errors: []`. Before this task `editingAfter` is `false` and `selectionAfter` is `null` — those are the two lines this check exists for. Leave edit mode afterwards (`cdp.setState("{ editing: false, selection: null }")` or click Done) so nothing is left half-edited.

10. **Relaunch: fields seeded, values visible.** `node tools/smoke/cdp.mjs --quit`, then

    ```
    $env:SMOKE_KEEP_PROFILE = "1"; node tools/smoke/launch.mjs
    ```

    poll `studies.length > 0` as before, then `node tools/smoke/cdp.mjs "import('./renderer/store.js').then((m) => ({ fields: m.getState().fields, real: m.getState().studies.filter((s) => s.source === 'real').map((s) => [s.id, s.clinical]) }))"`.

    Expected: `fields: ["Age","Sex","Notes"]` — `KNOWN_FIELDS` order, seeded from the three records' stored values without any click; `real` lists `SP-1000` with `{Age:"58",Sex:"F",Notes:"Reviewed"}`, `SP-1001` with `{Age:"61",Sex:"M"}`, `SP-1002` with `{}`. Then `node tools/smoke/cdp.mjs "import('./renderer/store.js').then((m) => { m.setState({ ack: true, screen: 'studies' }); document.querySelector('.studies-row[data-study-id=SP-1000]').click(); return { count: document.querySelector('.clinical-count').textContent, values: [...document.querySelectorAll('.clinical-cell')].map((e) => e.value) }; })"` → `count: "3 FIELDS · 1 STUDY"`, `values: ["58","F","Reviewed"]`. Optionally, hide SEX — `node tools/smoke/cdp.mjs "import('./renderer/store.js').then((m) => { [...document.querySelectorAll('.clinical-remove')].find((b) => b.getAttribute('aria-label') === 'Hide Sex').click(); return { fields: m.getState().fields, sex: m.getState().studies.find((s) => s.id === 'SP-1000').clinical.Sex }; })"` → `fields: ["Age","Notes"]`, `sex: "F"` — the value stays on the record and on disk; hiding is session-only, as the seed comment says, which is exactly what the control's `Hide field — values are kept` tooltip promises. Finish with `node tools/smoke/cdp.mjs --quit` and clear `$env:SMOKE_KEEP_PROFILE`.

Any `page errors during call:` line, any `errors` array that is not empty, or any expected value that differs stops the task; fix the code, rerun the unit suite, and repeat from the check that failed (a relaunch without `SMOKE_KEEP_PROFILE` starts the walkthrough over from check 2).

- [ ] **Step 8: Commit**

```bash
git add renderer/screens/analysis.js renderer/main.js
git commit -m "feat: mount the clinical data drawer on Analysis and seed its fields from the saved studies"
```

---

## Task 7 — Delete a study (record + sidecar), and the caches that must forget it

**Files:**
- Modify: `main.js` (one IPC handler after `save-prediction`)
- Modify: `preload.js` (one bridge line after `savePrediction`)
- Modify: `renderer/api.js` (`deletePrediction` after `savePrediction`)
- Modify: `test/api.test.js` (+1), `test/api-persistence.test.js` (+1)
- Modify: `renderer/components/viewer.js` (export `forgetPrediction`)
- Modify: `renderer/screens/analysis.js` (export `releaseStudy`; one guard in `runSegmentation`; one gone-study guard in `restoreFilm`, the second re-park path)
- Modify: `renderer/screens/studies.js` (action column, two-step confirm, `deleteStudy`)
- Modify: `styles/screens/studies.css` (seventh grid column, prompt and confirm rules)

**Interfaces:**
- Consumes (all live at `d335ea0`, none changed by Tasks 1–6): `renderer/api.js` `persistenceDisabledReason() → string|null` (synchronous) and its private `assertWritable()` / `invoke(channel, ...args)`; `main.js` `predictionPath(id)` (throws `Invalid study id.` for anything but `/^SP-\d{4,}$/` ≥ 1000); `renderer/viewer/measure-queue.js` `replaceMeasured(studyId, geometry)`; `renderer/viewer/canvas.js` `disposeStudyImages(images)`; `renderer/components/toast.js` `showToast(message)`; `renderer/store.js` `getState()`, `setState(patchOrFn)`, `subscribe(fn)`; `renderer/dom.js` `el`, `mount`. Nothing from Tasks 1–6.
- Produces: `renderer/api.js` `export async function deletePrediction(id) // → void` — removes `predictions/<id>.json`, ENOENT is not an error, rejects for the session after `disablePersistence`; `renderer/components/viewer.js` `export function forgetPrediction(studyId)`; `renderer/screens/analysis.js` `export function releaseStudy(studyId)`; `main.js` IPC `delete-prediction`; preload `deletePrediction(id)`. Task 8's suite drives the delete flow over CDP; Task 9 records the id-reuse rule and the "pruned on delete only" rule in HANDOFF and the README. The contract amendments for these (api.js table row, the viewer.js/analysis.js export notes, the Persistence bullet) are the contract drafter's, not this task's.

HANDOFF decision 13 gave this plan "deleting a study (and pruning `predictions/`)", and the pre-flight scan (F29) found why it cannot be a one-line `filter`: `nextId` is max+1 over the real studies, so deleting the highest id and adding a film **reuses that id**, and five id-keyed caches would hand the new record the old study's data — `filePayloads` and `imageCache` in `analysis.js` (its bytes and bitmaps), the viewer's `predictions` snapshot (`RESET TO PREDICTION` would write the deleted study's measurements onto the new record — a fabricated measurement), the measure queue's `measured`/`revisions` (a late `/measure` response could land on the reused id), and the sidecar `predictions/<id>.json` on disk (a restart would draw the deleted film under the new record). This task removes the record through the persistence subscriber (nothing calls `saveStudies`), removes the sidecar through a validated IPC channel, and clears every renderer cache — in an order where a failure leaves everything as it was. The confirm is an inline two-step in the row, not a native dialog: `window.confirm` wedges CDP (HANDOFF "Known gap"), so Task 8 could never exercise it.

**Design note (Task 9 carries this into HANDOFF "Resume plan 07 here" and the README).** Ids are max+1 (`renderer/data/persistence.js` `nextId`), so a deleted highest id is reused by the next film added. Every id-keyed cache above is therefore cleared on delete so the new record cannot inherit the old film's bytes, bitmaps, prediction snapshot or pending correction. `predictions/` is pruned **on delete only**; a load-time orphan sweep is deliberately not done, because a refused store (a newer version's `studies.json`, HANDOFF item 5) leaves the app running over a library it cannot see, and "a sidecar with no record" is indistinguishable from "a sidecar whose record this build cannot read" — a sweep would destroy the newer build's data. For the same reason, when persistence is disabled the delete skips `deletePrediction` entirely (a sidecar under that id may belong to the invisible library) and only drops the in-memory record, which the disabled saver never writes. One accessibility limitation is accepted here rather than hidden: the Studies row keeps the `role="button"` it was given in plan 05, so some screen readers flatten the row into a single control and do not announce the in-row delete, Delete and Cancel buttons as separate targets; the flow works with a mouse and with Tab, and reshaping the row (a real `<tr>`/link, or moving the action out of the row) is recorded for a later accessibility pass rather than attempted mid-plan.

- [ ] **Step 1: Write the two failing api tests**

  In `test/api.test.js`, replace the import at live line 3 (after Task 2 it also names `chooseFolder`, `scanFolder`, `chooseCsv`, `readCsv`; keep those and add `deletePrediction`):

  ```js
  import { predict, measure, loadStudies, readFile, pathForFile, storeLoadNotice, persistenceDisabledReason, chooseFolder, scanFolder, chooseCsv, readCsv, deletePrediction } from '../renderer/api.js';
  ```

  Append at the end of the file:

  ```js
  test('deletePrediction hands the id to the bridge and strips the IPC prefix from a rejection', async () => {
    const calls = [];
    await withWindow({ spineContour: { deletePrediction: async (id) => { calls.push(id); } } }, async () => {
      assert.equal(await deletePrediction('SP-1000'), undefined);
      assert.deepEqual(calls, ['SP-1000']);
    });
    await withWindow({
      spineContour: {
        deletePrediction: async () => {
          throw new Error("Error invoking remote method 'delete-prediction': Error: Invalid study id.");
        },
      },
    }, async () => {
      await assert.rejects(deletePrediction('SP-0030'), (err) => {
        assert.equal(err.message, 'Invalid study id.');
        return true;
      });
    });
  });
  ```

  `test/api-persistence.test.js` runs its tests in file order and its first test has already called `disablePersistence`; that is the state the new test relies on. Append at the end of the file:

  ```js
  // Appended by plan 06 Task 7. Runs after the two tests above, so persistence is already off.
  test('after disablePersistence, deletePrediction rejects without touching the bridge', async () => {
    const { deletePrediction, persistenceDisabledReason } = await import('../renderer/api.js');
    assert.ok(persistenceDisabledReason(), 'precondition: persistence is already disabled by the first test');
    let touched = 0;
    await withWindow({ spineContour: { deletePrediction: async () => { touched += 1; } } }, async () => {
      await assert.rejects(deletePrediction('SP-1000'), /not being saved/);
    });
    assert.equal(touched, 0);
  });
  ```

  Run `node --test test/*.test.js`. Expected: red. `test/api.test.js` fails to link — `SyntaxError: The requested module '../renderer/api.js' does not provide an export named 'deletePrediction'` — and the new `api-persistence` test fails with `TypeError: deletePrediction is not a function`. Do not proceed on green.

- [ ] **Step 2: The `delete-prediction` IPC handler**

  In `main.js`, insert after the `save-prediction` handler — live lines 168–171 at `d335ea0`, one line lower once Task 2's `require('./scan-folder.js')` is in at line 8; anchor on the text, not the number — and before the `read-file` comment block:

  ```js
  // Removing a sidecar that is already gone is the outcome the caller wanted, not an error:
  // a study that never completed a run has no sidecar, and neither does one whose run failed
  // to write it. predictionPath validates the id, so nothing outside predictions/ is reachable.
  ipcMain.handle('delete-prediction', async (_event, id) => {
    try {
      await fsPromises.unlink(predictionPath(id));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  });
  ```

  `predictionPath` throws synchronously inside the `try`, and the rethrow passes it on — an invalid id still rejects with `Invalid study id.`; only ENOENT from the unlink is swallowed. No new root file, so the packaging allowlists do not change.

- [ ] **Step 3: The bridge line**

  In `preload.js`, insert one line after `savePrediction:` (live line 12), inside the existing object. Do not rewrite the file (it also exposes `readFile`, `pathForFile` and, after Task 2, the four Workspace channels):

  ```js
    deletePrediction: (id) => ipcRenderer.invoke('delete-prediction', id),
  ```

- [ ] **Step 4: `deletePrediction` in `renderer/api.js`**

  Insert after `savePrediction` (live lines 126–129) and before the `readFile` comment:

  ```js
  // Removes predictions/<id>.json. A missing sidecar resolves (the main process treats ENOENT as
  // done). Gated like every other write: after disablePersistence nothing on disk is touched,
  // because a sidecar under a reused id may belong to the library this build cannot read.
  export async function deletePrediction(id) {
    assertWritable();
    return invoke('deletePrediction', id);
  }
  ```

  Run `node --test test/*.test.js`. Expected: `# tests 259`, `# pass 259`, `# fail 0` (Task 6 left the suite at 257; `test/api.test.js` goes from 23 to 24 and `test/api-persistence.test.js` from 2 to 3).

- [ ] **Step 5: `forgetPrediction` in `renderer/components/viewer.js`**

  Insert after `recordPrediction` (live lines 56–65), before the `toolButton` comment:

  ```js
  // The inverse of recordPrediction, for a deleted study. Drop its snapshot so RESET TO
  // PREDICTION cannot write the deleted study's numbers onto a record that later reuses the
  // id, and orphan any correction of it still pending or in flight so a late /measure
  // response cannot land on that reused id either (HANDOFF plan-04 item 3).
  export function forgetPrediction(studyId) {
    predictions.delete(studyId);
    measureQueue.replaceMeasured(studyId, null);
  }
  ```

  `replaceMeasured` bumps the study's revision (superseding anything in flight), cancels the debounce if it holds this study, and records `null` as the measured geometry — so a failed late response has nothing to "restore". The viewer's other per-study state, `labelOffsets`/`labelStudyId`, needs nothing: `detach()` (live line 677) already resets it on every navigation, and a delete happens from the Studies screen.

- [ ] **Step 6: `releaseStudy` and the run guard in `renderer/screens/analysis.js`**

  Insert after `let mounted = null;` (live line 55 at `d335ea0`; one line lower after Task 6's import line — anchor on the text), so it sits after the three names it reads (`filePayloads`, `imageCache`, `mounted`):

  ```js
  // Every id-keyed cache this module holds for one study, dropped when the study is deleted.
  // Ids are max+1, so the next film added can reuse a deleted id; without this the new record
  // would inherit the old film's bytes and decoded bitmaps.
  export function releaseStudy(studyId) {
    filePayloads.delete(studyId);
    if (imageCache && imageCache.studyId === studyId) {
      // The entry always goes -- the next film can reuse this id. The bitmaps are CLOSED only
      // when no live viewer draws them (the same identity check cacheImages makes); a viewer
      // that still holds them keeps its own reference and repaints correctly until it detaches.
      if (!(mounted && mounted.studyId === studyId)) disposeStudyImages(imageCache.images);
      imageCache = null;
    }
  }
  ```

  The two decisions are deliberately separate. A delete normally happens from the Studies screen, where `mounted` is null — but `deleteStudy` awaits `deletePrediction` before calling this, and the confirming row's id/patient/view cells still open the study on a click (only the action cell stops propagation), so `mounted` CAN be this study. Dropping the cache entry unconditionally is what stops a populated `imageCache` outliving the record under an id `nextId` will hand to the next film.

  Then the same hazard on the other side, in `restoreFilm`. It is guarded only by `restoreRevision` and `runRevision`, neither of which a delete bumps, and its two awaits (the sidecar read plus three `createImageBitmap` decodes) are a window of hundreds of milliseconds in which the user can go Back and delete the study. Replace live lines 239–243 at `d335ea0` (from `const images = await loadStudyImages(sidecar);` through the `recordPrediction(...)` call; a line or two lower after Task 6's import — anchor on the text) with:

  ```js
    const images = await loadStudyImages(sidecar);
    const study = getState().studies.find((s) => s.id === studyId);
    // Deleted while the sidecar was being read and decoded: releaseStudy has already cleared
    // this id's caches, and nothing may be re-parked under an id the next film can reuse --
    // cacheImages + recordPrediction would restore the film, the snapshot AND the measured
    // geometry under a dead id, and the reusing record would open on the deleted study's film
    // with RESET TO PREDICTION live over its numbers.
    if (!study || revision !== restoreRevision || runAtStart !== runRevision) { disposeStudyImages(images); return; }
    cacheImages(studyId, images);
    recordPrediction(studyId, sidecar, study.geometry ? study.geometry : sidecar.geometry);
  ```

  (The `study` lookup already existed on the `recordPrediction` line; it only moves above the guard, and the `study &&` in its third argument becomes unnecessary.) While here, correct the stale doc comment above `restoreFilm` (live lines 223–226, the sentence ending on line 226 — anchor on the text): it claims "a newer restore, a run started meanwhile, or **navigation away** drops this one's result", but navigation bumps neither revision — it should read "a newer restore, a run started meanwhile, or the study being deleted drops this one's result; navigation does not, and `imageCache` deliberately survives it."

  Then in `runSegmentation`, replace the block at live lines 144–153 (from `if (!data || revision !== runRevision) return;` through `setState({ running: studyId });` — one line lower after Task 6) with:

  ```js
    if (!data || revision !== runRevision) return;
    // After a relocation the record carries the NEW name; the `study` binding above is stale.
    // The filename matters: its extension drives the backend's decoder, so relocating a .jpg
    // to a .png has to send the new name with the new bytes.
    const current = getState().studies.find((s) => s.id === studyId);
    // Deleted while the bytes were being read or the relocate picker was open: nothing runs
    // for a record that is gone. The read above (filmBytes/relocateFilm) may have re-parked
    // the bytes under this id AFTER releaseStudy cleared them, so drop them again -- the next
    // film can reuse the id. runRevision is deliberately not bumped anywhere on delete.
    if (!current) {
      filePayloads.delete(studyId);
      return;
    }

    // The id, not a boolean: with a Studies list the user can open study B while A's /predict
    // is in flight, and the viewer and the list have to be able to ask WHICH study is running.
    // Every existing truthiness check still reads "a run is in flight" (one run at a time).
    setState({ running: studyId });
  ```

  The `?? study` fallback is gone on purpose: it existed to survive a record that vanished mid-read, which before this task could not happen. `running` is never set for a gone study, so no card reads RUNNING for it. `deleteStudy` (Step 7) refuses a study whose `running === id`; the case this guard covers is the one the sheet names — `running` is still `null` while the relocate picker is open (`locating` is not a run), and the native picker from `select-file` has no parent window, so the user can reach the Studies list and delete the study while it is open.

- [ ] **Step 7: The action column, the two-step confirm, and `deleteStudy` in `renderer/screens/studies.js`**

  Tasks 1–6 do not modify this file (Task 4 only imports `newStudy` from it), so live line numbers hold. Replace the imports at live lines 8–14 with:

  ```js
  import { el, mount } from '../dom.js';
  import { getState, setState, subscribe } from '../store.js';
  import { selectFile, pathForFile, deletePrediction, persistenceDisabledReason } from '../api.js';
  import { showToast } from '../components/toast.js';
  import { deriveStatus, statusLabel } from '../data/status.js';
  import { nextId } from '../data/persistence.js';
  import { setFilePayload, releaseStudy } from './analysis.js';
  import { forgetPrediction } from '../components/viewer.js';
  ```

  `viewer.js` is already in this module's import graph through `analysis.js`, so `test/studies.test.js` (which imports this file under `node --test`) keeps loading exactly as it does today.

  After `UPLOAD_SVG` (live line 16) add:

  ```js
  // Same 24-unit stroke-icon convention as UPLOAD_SVG and components/viewer.js's toolbar.
  const TRASH_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7 H20"></path><path d="M9 7 V4 H15 V7"></path><path d="M6 7 L7 20 H17 L18 7"></path><path d="M10 11 V16"></path><path d="M14 11 V16"></path></svg>';
  ```

  Replace live lines 139–174 (the `runningId` comment, `buildRow`, and `buildTable`) with:

  ```js
  // The trailing cell of a row: a delete button for a real study, the two-step prompt while
  // that study is the one being confirmed, an empty cell for a demo study (compiled in, never
  // written -- there is nothing to delete). Every click inside stops at the cell so the row's
  // own click cannot open the study underneath the prompt.
  function actionCell(study, confirming) {
    if (study.source !== 'real') return el('div', { class: 'studies-cell-actions' });
    if (!confirming) {
      return el('div', { class: 'studies-cell-actions' },
        el('button', {
          type: 'button', class: 'icon-btn studies-delete',
          'aria-label': `Delete ${study.id}`, title: 'Delete study', innerHTML: TRASH_SVG,
          onClick: (event) => { event.stopPropagation(); askToDelete(study.id); },
        }));
    }
    return el('div', {
      class: 'studies-cell-actions studies-cell-actions-confirming',
      onClick: (event) => event.stopPropagation(),
    },
      el('span', { class: 'studies-delete-prompt' }, 'Delete this study?'),
      el('button', {
        type: 'button', class: 'btn btn-small studies-delete-confirm', onClick: () => deleteStudy(study.id),
      }, 'Delete'),
      el('button', {
        type: 'button', class: 'btn btn-small studies-delete-cancel', onClick: () => cancelDelete(),
      }, 'Cancel'));
  }

  // `runningId` is state.running: the id of the study whose /predict is in flight, or null.
  // The "or currently running" half of spec 13.1's Processing rule lives here rather than in
  // deriveStatus, which stays a pure function of the record and knows nothing about the store.
  function buildRow(study, runningId) {
    const status = runningId === study.id ? 'proc' : deriveStatus(study);
    const lordosis = study.measurements?.LL?.['L1-S1'];
    const hasLordosis = typeof lordosis === 'number' && Number.isFinite(lordosis);
    const patientChildren = [study.pt || '—'];
    if (study.source === 'demo') patientChildren.push(el('span', { class: 'pill-demo' }, 'DEMO'));
    // While this row is confirming a delete, the prompt takes the DATE, STATUS and LORDOSIS
    // cells' columns (see .studies-cell-actions-confirming); the id and patient stay visible.
    const confirming = confirmingId === study.id;
    const row = el('div', {
      class: 'studies-row', role: 'button', tabindex: '0', 'data-study-id': study.id,
      onClick: () => openStudy(study),
      onKeydown: (event) => {
        // Escape anywhere in the row (its prompt buttons included) withdraws the prompt.
        if (event.key === 'Escape' && confirmingId === study.id) { event.preventDefault(); cancelDelete(); return; }
        // Enter/Space on the row itself opens the study. On one of the action buttons they are
        // that button's own activation and must reach it (the dropzone makes the same check).
        if (event.target !== row) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openStudy(study); }
      },
    },
      el('div', { class: 'studies-cell-id' }, study.id),
      el('div', { class: 'studies-cell-patient' }, ...patientChildren),
      el('div', { class: 'studies-cell-view' }, study.view || '—'),
      confirming ? null : el('div', { class: 'studies-cell-date' }, formatDate(study.addedAt)),
      confirming ? null : el('div', {}, statusBadge(status)),
      confirming ? null : el('div', { class: hasLordosis && lordosis >= LORDOSIS_ACCENT_DEGREES ? 'studies-lordosis studies-lordosis-high' : 'studies-lordosis' },
        hasLordosis ? `${Math.round(lordosis)}°` : '—'),
      actionCell(study, confirming));
    return row;
  }

  function buildTable(studies, runningId) {
    // An explicit arrow, not `studies.map(buildRow)`: map passes the index as the second
    // argument, so every row would receive its own position as `runningId` and the running
    // study would silently never be badged Processing. The arrow is load-bearing.
    const body = studies.length > 0
      ? studies.map((study) => buildRow(study, runningId))
      : [el('div', { class: 'studies-empty' }, 'No studies match that search.')];
    return el('div', { class: 'studies-table card' },
      el('div', { class: 'studies-table-head' },
        el('div', {}, 'STUDY ID'), el('div', {}, 'PATIENT'), el('div', {}, 'VIEW'),
        el('div', {}, 'DATE'), el('div', {}, 'STATUS'), el('div', { class: 'studies-col-lordosis' }, 'LORDOSIS'),
        el('div', {})),
      ...body);
  }
  ```

  `el()` drops `null` children, so a confirming row has four cells and the grid places the spanning one by its own `grid-column`. `innerHTML` is a property of the node, so `el` assigns it (the same route `viewer.js`'s `toolButton` uses); `disabled` is never passed here.

  Replace live lines 180–187 (`let mounted = null;` and the subscription) with:

  ```js
  // The live mount, or null when this screen is not on screen. See screens/analysis.js for why
  // the subscription is module-scope and registered once: render() runs on every navigation.
  // `host` is the table's container, so the delete helpers can hand focus back after a repaint.
  let mounted = null;

  // The id of the real study whose row shows the two-step delete prompt, or null. Module scope,
  // not the store: it is one screen's transient UI, and a new key would change the contract's
  // state shape. The store cannot see it, so update() lists it in its key explicitly and every
  // change to it below repaints through refreshTable().
  let confirmingId = null;

  subscribe((state) => {
    // Navigation withdraws an open prompt along with the mount.
    if (state.screen !== 'studies') { mounted = null; confirmingId = null; return; }
    if (mounted) mounted.update(state);
  });

  // Repaint the table from the current store after confirmingId changes. Called from DOM event
  // handlers only, never from inside a subscriber. The repaint replaces the row's nodes, which
  // drops keyboard focus onto the body; `focusSelector` names the node that gets it back.
  function refreshTable(focusSelector) {
    if (!mounted) return;
    mounted.update(getState());
    if (focusSelector) {
      const target = mounted.host.querySelector(focusSelector);
      if (target) target.focus();
    }
  }

  // Focus lands on CANCEL, not Delete. The repaint drops focus to <body>, so something must
  // take it; the safe half of a destructive pair is the one that may be triggered by a stray
  // Enter or Space. Delete is one Tab (or one click) away, and its own :focus-visible ring
  // makes the difference visible before it is pressed.
  function askToDelete(id) {
    confirmingId = id;
    refreshTable('.studies-delete-cancel');
  }

  function cancelDelete() {
    const id = confirmingId;
    confirmingId = null;
    refreshTable(id ? `.studies-row[data-study-id="${id}"] .studies-delete` : null);
  }

  // Confirmed. The order is load-bearing: refuse a study whose run is in flight; the sidecar
  // first, so a failure there leaves the record, its film and every cache exactly as they were;
  // then the renderer caches keyed by this id (the viewer's snapshot and /measure bookkeeping,
  // then bytes and bitmaps); then ONE setState that removes the record -- the persistence
  // subscriber in renderer/main.js writes the new list, nothing here calls saveStudies. With
  // persistence disabled the sidecar is left alone on purpose: a sidecar under this id may
  // belong to the newer library this build cannot read, and the disabled saver writes nothing.
  async function deleteStudy(id) {
    confirmingId = null;
    if (getState().running === id) {
      showToast('Wait for the segmentation to finish before deleting this study.');
      // The row is still there, so hand focus back to its trash button, as cancelDelete does;
      // a bare refreshTable() would drop the keyboard user onto <body>.
      refreshTable(`.studies-row[data-study-id="${id}"] .studies-delete`);
      return;
    }
    if (!persistenceDisabledReason()) {
      try {
        await deletePrediction(id);
      } catch (error) {
        showToast(`Could not delete the saved segmentation: ${error.message}`);
        refreshTable(`.studies-row[data-study-id="${id}"] .studies-delete`);
        return;
      }
    }
    forgetPrediction(id);
    releaseStudy(id);
    // The screen is already 'studies'. Naming it again is a no-op for the router (same value,
    // no remount) and covers the one gap the await above opens: the open study deleted from
    // the list must not stay on an Analysis screen that has no record behind it.
    setState((s) => ({
      studies: s.studies.filter((x) => x.id !== id),
      ...(s.openId === id ? { openId: null, screen: 'studies', ...FRESH_VIEW } : {}),
    }));
    showToast(`Deleted ${id}`);
  }
  ```

  Replace `render` (live lines 189–225) with:

  ```js
  export function render(state) {
    confirmingId = null;
    const summary = el('div', { class: 'studies-summary' });
    const search = el('input', {
      type: 'search', class: 'studies-search', value: state.query || '',
      placeholder: 'Search ID, patient, diagnosis…', 'aria-label': 'Search studies',
      // A keystroke here can filter the confirming row out of the table; clearing the prompt
      // first stops it reappearing, primed on Delete, when the search is cleared again.
      // The setState notification repaints through the same gate (confirmingId is in the key),
      // so no extra refreshTable() is needed.
      onInput: (event) => { confirmingId = null; setState({ query: event.target.value }); },
    });
    const tableHost = el('div', { class: 'studies-table-host' });
    let lastKey = null;

    function update(live) {
      // live.running is in the key so the table repaints when a run starts or ends: the row
      // badge is derived from it, and nothing else in the key changes at either moment.
      // confirmingId is module scope, not store state; listing it here is what lets a
      // refreshTable() after a change to it get past the gate, while a notification that
      // changed nothing the table shows (a pan frame, a toast) still returns early.
      const key = [live.studies, live.query, live.running, confirmingId];
      if (sameKey(key, lastKey)) return;
      lastKey = key;
      const studies = live.studies || [];
      // The summary always describes the whole library, not the filtered view, and counts the
      // queue with exactly the rule buildRow badges it with.
      const queued = studies.filter((study) => (live.running === study.id ? 'proc' : deriveStatus(study)) === 'proc').length;
      summary.textContent = `${studies.length} STUDIES · ${queued} IN QUEUE`;
      const query = (live.query || '').trim().toLowerCase();
      mount(tableHost, buildTable(studies.filter((study) => matchesQuery(study, query)), live.running));
    }

    const root = el('main', { class: 'studies-page' },
      el('div', { class: 'studies-page-inner' },
        el('div', { class: 'studies-header' },
          el('div', {}, el('h1', { class: 'studies-heading' }, 'Studies'), summary),
          el('div', { class: 'studies-header-spacer' }),
          search),
        dropzone(),
        tableHost));
    mounted = { update, host: tableHost };
    update(state);
    return root;
  }
  ```

  How the clearing rules land: **Escape** — the row's `keydown` (the prompt's buttons are inside the row, so their Escape bubbles to it); **Cancel** — `cancelDelete`, focus returns to that row's trash button; **navigation** — the subscription clears `confirmingId` whenever `screen` leaves `'studies'`, and `render()` starts clean; **clicking elsewhere** — a click on the row opens the study (navigation), a click on another row's trash moves the prompt there (`askToDelete` overwrites the id), and a click on the confirming cell itself is stopped at the cell; **a search keystroke** — the `onInput` handler clears `confirmingId` before its `setState`, so a prompt cannot be filtered out of view and then reappear when the query is cleared. There is no document-level click listener: it would need its own teardown, and every other "elsewhere" on this screen is one of the four above. Keyboard: Enter/Space on the row still opens; the trash, Delete and Cancel buttons are real `<button>`s in tab order, and the `event.target !== row` check keeps the row's handler from swallowing their activation (the live handler at line 151 has no such check, which is why `buildRow` is replaced whole). When the prompt opens, `askToDelete` hands focus to **Cancel** — the repaint would otherwise leave focus on `<body>`, and the button a stray Enter or Space can reach must be the one that does nothing. Delete is one Tab away (or a click), which is the whole point of a two-step confirm.

- [ ] **Step 8: The seventh column and the prompt rules in `styles/screens/studies.css`**

  Replace the shared head/row rule (live lines 61–68) with:

  ```css
  .studies-table-head,
  .studies-row {
    display: grid;
    grid-template-columns: 112px 1.15fr 1.2fr 0.9fr 1.05fr 110px 44px;
    gap: 16px;
    align-items: center;
    padding: 13px 22px;
  }
  ```

  Append at the end of the file:

  ```css
  /* Delete (plan 06 Task 7). The action cell is the trailing 44px column; while a row is
     confirming, the prompt takes the DATE, STATUS and LORDOSIS columns as well. */
  .studies-cell-actions {
    display: flex;
    justify-content: flex-end;
  }

  .studies-delete:hover,
  .studies-delete:focus-visible {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .studies-cell-actions-confirming {
    grid-column: 4 / -1;
    align-items: center;
    gap: 8px;
    cursor: default;
  }

  .studies-delete-prompt {
    font: 400 13.5px 'Source Sans 3', sans-serif;
    color: var(--body);
    white-space: nowrap;
  }

  .studies-delete-confirm {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .studies-delete-confirm:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  ```

  Tokens and `color-mix` only, no literals. `.icon-btn` (components.css line 36) already gives the trash button its 24px box, `var(--muted)` colour and focus outline; `.btn.btn-small` gives the two prompt buttons their shape, and `.btn:disabled` never applies (nothing here is disabled).

- [ ] **Step 9: Full suite, then the verification this task defers**

  Run `node --test test/*.test.js`. Expected: `# tests 259`, `# pass 259`, `# fail 0` — Steps 5–8 change DOM and canvas code, which gets no unit test (CLAUDE.md: manual verification, stated plainly rather than a fake test). The controller does not launch the app for this task; the delete flow is verified by Task 8's suite and at Gate 2, which make these checks over CDP on a scratch profile (launch per the preamble's "Launching for verification"):

  - `smoke-workspace.mjs` (Task 8): after the workspace load, the `b.PNG` row's `.studies-delete` click shows `.studies-delete-prompt` with the text `Delete this study?`; `.studies-delete-confirm` click → `getState().studies.length` shrinks by one, the toast reads `Deleted <id>`, and `window.spineContour.loadPrediction('<id>')` resolves `null`; console errors 0. The plan-04 suites (`smoke-parity`, `gate1`, `gate2`, `gate3`, `chip`) re-run green after the `viewer.js` change.
  - Gate 2 (user, real profile, `studies.json` and `predictions\` copied aside first): delete a segmented study (confirm) → its row is gone, it stays gone after a relaunch, and `predictions\<id>.json` is gone.

- [ ] **Step 10: Commit**

  ```
  git add main.js preload.js renderer/api.js renderer/components/viewer.js renderer/screens/analysis.js renderer/screens/studies.js styles/screens/studies.css test/api.test.js test/api-persistence.test.js
  git commit -m "feat: delete a study and its saved segmentation"
  ```

---

## Task 8 — `smoke-workspace.mjs`, README entry, GATE 2

**Files:** `tools/smoke/smoke-workspace.mjs` (create), `tools/smoke/README.md` (modify — add a section after "Running the plan-05 suites")

**Interfaces:**
- Consumes (Task 2, through the page's own module instance): `renderer/api.js` `export async function scanFolder(dirPath) → {files: string[], skipped: number}` (rejects `'No folder was selected.'` for `''`), `export async function readCsv(filePath) → string` (raw text, BOM and CRLF intact; rejects `'The CSV file was not found.'`); the bridge as `window.spineContour.loadStudies() → {version, studies}` (raw, real records only), `savePrediction(id, response)`, `loadPrediction(id) → object|null`.
- Consumes (Task 3): `renderer/data/csv.js` `parse(text) → {headers, rows}`, `autoMap(headers) → Mapping[]` (`{src, dest}`), `findJoinHeader(headers) → string|null`, `KNOWN_FIELDS`; `renderer/data/persistence.js` `nextId(studies) → 'SP-1000'`-style id.
- Consumes (Task 4 DOM): `.workspace-page`, `.workspace-heading`, `.workspace-card[.workspace-card-set]` with `.eyebrow`, `.workspace-card-value`, `.workspace-card-meta`, `button.btn.btn-small`; `.workspace-chip[.workspace-chip-mapped|.workspace-chip-unmapped]` > `.workspace-chip-src`, `select.workspace-chip-select[aria-label="Map <src>"]` (option value `''` for `Unmapped`, else the field name; the handler is `onChange`); `.workspace-card-note`; `button.workspace-load` (boolean `disabled`); `.workspace-load-hint`. State keys `wsFolder, wsFiles, wsCsv, wsCsvHeaders, wsCsvRows, wsMapping`. `loadWorkspaceStudies` front-inserts in scan order with consecutive ids from `nextId`; `workspaceLoadedMessage` builds the toast.
- Consumes (Task 5/6 DOM): `section.clinical-data` as the third child of `main.analysis-screen`; `.clinical-toggle[aria-expanded][.clinical-toggle-closed]`, `.clinical-title`, `.clinical-count`, `button.clinical-import`, `button.clinical-chip` (`+` then the name), `input.clinical-custom`, `.clinical-grid` (`--clinical-cols` set with `style.setProperty`), `.clinical-grid-row.clinical-grid-head` > `.clinical-grid-cell` (`span` uppercased name + `button.clinical-remove[aria-label="Hide <name>"]`), data rows `.clinical-grid-row` > `.clinical-grid-id` + `input.clinical-cell` (`change` → one `setState`), `.clinical-empty`; `fieldCountLabel` → `NO FIELDS` | `${n} FIELD(S) · ${k} STUD(Y|IES)`; toast `Imported ${n} field${s} from CSV`.
- Consumes (Task 7 DOM): `button.icon-btn.studies-delete[aria-label="Delete <id>"]` on real rows only; after the first click the row's action cell shows `span.studies-delete-prompt` "Delete this study?", `button.btn.btn-small.studies-delete-confirm` "Delete", `button.btn.btn-small.studies-delete-cancel` "Cancel" (which takes focus when the prompt opens); confirm → `deletePrediction(id)` (sidecar unlinked, ENOENT tolerated), caches cleared, ONE `setState` filtering `studies`, toast `Deleted ${id}`.
- Consumes (harness): `tools/smoke/cdp-lib.mjs` `connect() → { evaluate, click, key, typeText, state, setState, rect, settle, errors, close }`; `tools/smoke/launch.mjs` (scratch profile, CDP 9222).
- Produces: the plan-06 CDP suite every later change to the Workspace, the drawer or delete is checked against; the README run order and its `N/N` baseline placeholder, which Task 9 copies into `HANDOFF.md`; the Gate 2 script.

Why a suite and not only a walkthrough: every app-level defect in plans 03–05 was caught by `tools/smoke/` or by the user, none by the unit suite, and Tasks 4–7 are almost entirely DOM. The native pickers (`chooseFolder`, `chooseCsv`) cannot be driven over CDP — same class as the dropzone in `smoke-studies.mjs` — so the suite seeds `wsFolder/wsFiles/wsCsv…` from a fixture it writes itself, reaches the rest of the flow through the store exactly as the handlers would, and leaves the pickers, the cancel path and card 01's skipped clause (which only the folder handler records) to Gate 2. Every count is relative to the starting `n` and the ids are computed from `nextId` at run time, so the suite is correct on a profile `smoke-studies.mjs` has already populated with `SP-9000`.

- [ ] **Step 1: Create `tools/smoke/smoke-workspace.mjs`**

  ```js
  // Workspace + clinical data smoke (Task 8 of plan 06). Drives, on a launched app over CDP:
  // the folder scan and CSV read through renderer/api.js (display-ready rejections included),
  // the Workspace screen seeded from a fixture (cards, chips, the mapping override, the note
  // preview), Load workspace twice (added, then already-in-the-library), the clinical data
  // drawer on Analysis (Import from CSV, a chip, typing, collapse/expand), the persisted store
  // through the bridge, and the two-step delete with its sidecar. Ends with the console-error
  // assertion every suite carries. Fixture: tools/smoke/out/workspace-fixture/ (a.png, b.PNG,
  // batch/c.jpg, notes.txt) plus tools/smoke/out/workspace-fixture.csv beside it.
  //
  // PRECONDITIONS
  //   * A FRESH scratch profile from `node tools/smoke/launch.mjs` (SPINE_CONTOUR_PYTHON set; the
  //     backend must come up for the window to exist, although nothing here segments). The
  //     drawer's count label is asserted as NO FIELDS, which holds only when no persisted record
  //     carries clinical values -- true on a fresh profile, before or after smoke-studies.mjs.
  //   * NEVER between `smoke-persist.mjs --phase run` and `--phase restart`: this suite writes the
  //     store through the saver (three records added, one deleted).
  //   * It leaves the app on Studies with two fixture studies (a.png, batch/c.jpg) unsegmented and
  //     nothing mounted on Analysis.
  //
  // NOT DRIVEABLE HERE (Gate 2 human steps): the native folder and CSV pickers, cancelling them,
  // and card 01's ` · N skipped (unsupported files or links)` clause -- workspace.js records the
  // skipped count in module scope only when ITS folder handler ran the scan, and the suite seeds
  // the state directly, so the meta reads `3 radiographs found` without the clause.
  import fs from 'node:fs';
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { connect } from './cdp-lib.mjs';

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const FIXTURE = path.join(__dirname, 'out', 'workspace-fixture');
  // BESIDE the scanned folder, not inside it: a .csv inside would be a second skipped file and
  // the scan would read "3 films, 2 skipped". Same placement as Task 4's and Task 6's fixtures.
  const CSV_PATH = path.join(__dirname, 'out', 'workspace-fixture.csv');

  // A 1x1 transparent RGBA PNG, 70 bytes. Nothing in this suite decodes a film: the scanner keys on
  // the extension, the join on the filename stem, and no fixture study is ever segmented.
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  // Recreated on every run so a stale file can never skew a count. `b.PNG` is upper-case on
  // purpose (case-insensitive extensions and stems); `batch/c.jpg` proves recursion; `notes.txt`
  // is the one skipped file. The CSV lives beside the folder (see CSV_PATH) and is written the
  // way Excel's "CSV UTF-8" writes it -- a BOM and CRLF -- and its rows are: two matches (a, b),
  // one row with no film (zzz), and one duplicate study_id (`A` repeats `a` case-insensitively;
  // first row wins, the duplicate is counted).
  function writeFixture() {
    fs.rmSync(FIXTURE, { recursive: true, force: true });
    fs.mkdirSync(path.join(FIXTURE, 'batch'), { recursive: true });
    const png = Buffer.from(PNG_1X1, 'base64');
    fs.writeFileSync(path.join(FIXTURE, 'a.png'), png);
    fs.writeFileSync(path.join(FIXTURE, 'b.PNG'), png);
    fs.writeFileSync(path.join(FIXTURE, 'batch', 'c.jpg'), png); // the extension is all the scanner reads
    fs.writeFileSync(path.join(FIXTURE, 'notes.txt'), 'not a film\r\n');
    const csv = '\uFEFFstudy_id,age_yrs,sex,tx_plan\r\n'
      + 'a,58,F,Fusion\r\n'
      + 'b,61,M,Observation\r\n'
      + 'zzz,70,F,Fusion\r\n'
      + 'A,99,F,dup\r\n';
    fs.writeFileSync(CSV_PATH, csv, 'utf8');
  }

  const EXPECTED_HEADERS = ['study_id', 'age_yrs', 'sex', 'tx_plan'];
  const EXPECTED_MAPPING = [
    { src: 'study_id', dest: null },
    { src: 'age_yrs', dest: 'Age' },
    { src: 'sex', dest: 'Sex' },
    { src: 'tx_plan', dest: null },
  ];
  const KNOWN_FIELDS = ['Age', 'Sex', 'BMI', 'Diagnosis', 'ODI', 'Treatment plan', 'Surgical history', 'Follow-up', 'Notes'];

  // The join for this fixture: a and b match, zzz is unmatched, A is a duplicate of a.
  const NOTE_PREVIEW = '2 of 4 rows match a film · 1 unmatched · 1 duplicate study_id';
  const LINKED_CLAUSE = 'clinical data linked (2 matched, 1 unmatched, 1 duplicate study_id)';
  // workspaceLoadedMessage: added=3, known=0, updated=0, join present, tx_plan mapped by then.
  const TOAST_FIRST_LOAD = `Workspace loaded — 3 studies added · ${LINKED_CLAUSE}`;
  // Second load: added=0, known=3, updated=0 -- a and b already carry every CSV key from the
  // first load and Load only fills BLANKS, so there is no `(clinical data updated for K)` clause.
  const TOAST_SECOND_LOAD = `Workspace loaded — 0 studies added · 3 already in the library · ${LINKED_CLAUSE}`;
  const CLINICAL_A = { Age: '58', Sex: 'F', 'Treatment plan': 'Fusion' };
  const CLINICAL_B = { Age: '61', Sex: 'M', 'Treatment plan': 'Observation' };
  const NOTE_TEXT = 'smoke note';

  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok: Boolean(ok), detail });
  }

  // Key-order-insensitive deep equality: clinical objects reach us in mapping order from the
  // store and in whatever order JSON.parse kept from the file.
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
      return out;
    }
    return value;
  }
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const idPlus = (base, k) => `SP-${String(Number(base.slice(3)) + k).padStart(4, '0')}`;

  const cdp = await connect();

  const text = (selector) => cdp.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.textContent : null; })()`);
  const rowCount = () => cdp.evaluate("document.querySelectorAll('.studies-row').length");
  const summaryParts = async () => {
    const m = /^(\d+) STUDIES · (\d+) IN QUEUE$/.exec(((await text('.studies-summary')) || '').trim());
    return m ? { studies: Number(m[1]), queued: Number(m[2]) } : null;
  };
  // Client-space centre of the element a page-side finder returns, scrolled into view first (the
  // drawer sits at the bottom of Analysis and the load row at the bottom of Workspace).
  const rectBy = (finderSource) => cdp.evaluate(`(() => {
    const e = (${finderSource})();
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width, height: r.height };
  })()`);

  // Polls the store through the page's own module instance, the way smoke-studies.mjs does.
  async function waitForState(predicateSource, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await cdp.evaluate(`import('./renderer/store.js').then((m) => { const s = m.getState(); return Boolean(${predicateSource}); })`)) return true;
      await cdp.settle(150);
    }
    return false;
  }

  // The raw store through the bridge, polled until `predicate` holds on it (the saver writes
  // asynchronously after each studies change) or the deadline passes; returns the last store read.
  async function waitForStore(predicateSource, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let raw = null;
    while (Date.now() < deadline) {
      raw = await cdp.evaluate('window.spineContour.loadStudies()');
      const studies = (raw && raw.studies) || [];
      if ((new Function('studies', `return Boolean(${predicateSource});`))(studies)) return { ok: true, raw };
      await cdp.settle(150);
    }
    return { ok: false, raw };
  }

  const chipsSnapshot = () => cdp.evaluate(`[...document.querySelectorAll('.workspace-chip')].map((c) => ({
    src: c.querySelector('.workspace-chip-src')?.textContent ?? null,
    mapped: c.classList.contains('workspace-chip-mapped'),
    unmapped: c.classList.contains('workspace-chip-unmapped'),
    value: c.querySelector('.workspace-chip-select')?.value ?? null,
    label: c.querySelector('.workspace-chip-select')?.getAttribute('aria-label') ?? null,
    options: [...c.querySelectorAll('.workspace-chip-select option')].map((o) => o.textContent),
  }))`);

  // The drawer as it reads: head cells (field names, upper-cased by the component), one entry per
  // data row with its inputs in head order, the count label, and the grid's column template.
  const drawerGrid = () => cdp.evaluate(`(() => {
    const d = document.querySelector('.clinical-data');
    if (!d) return null;
    const heads = [...d.querySelectorAll('.clinical-grid-head .clinical-grid-cell')].map((c) => (c.querySelector('span') ? c.querySelector('span').textContent : c.textContent));
    const rows = [...d.querySelectorAll('.clinical-grid-row')].filter((r) => !r.classList.contains('clinical-grid-head')).map((r) => ({
      id: r.querySelector('.clinical-grid-id')?.textContent ?? null,
      cells: [...r.querySelectorAll('.clinical-cell')].map((i) => ({ value: i.value, disabled: i.disabled, placeholder: i.placeholder, title: i.title })),
    }));
    return {
      heads,
      rows,
      count: d.querySelector('.clinical-count')?.textContent ?? null,
      cols: d.querySelector('.clinical-grid')?.style.getPropertyValue('--clinical-cols').trim() ?? null,
      removeLabels: [...d.querySelectorAll('.clinical-remove')].map((b) => b.getAttribute('aria-label')),
      chips: [...d.querySelectorAll('.clinical-chip')].map((b) => b.textContent.replace(/^\\+/, '')),
      gridPresent: Boolean(d.querySelector('.clinical-grid')),
      emptyPresent: Boolean(d.querySelector('.clinical-empty')),
    };
  })()`);
  // { FIELD NAME (upper-cased) -> cell } for the first data row.
  function cellsByField(grid) {
    const out = {};
    if (!grid || !grid.rows[0]) return out;
    const fields = grid.heads.slice(1); // heads[0] is STUDY
    fields.forEach((name, i) => { out[name] = grid.rows[0].cells[i] ?? null; });
    return out;
  }

  try {
    writeFixture();

    // 0. Ready means renderer/main.js's top-level `await loadStudies()` has resolved -- a page target
    // alone is not enough (HANDOFF "three layers of alive is not ready"). The demo studies are
    // merged in at bootstrap, so a resolved store is never empty.
    check('precondition: the store has loaded (studies.length > 0)', await waitForState('s.studies.length > 0', 30000), (await cdp.state()).studies.length);

    // 1. scanFolder through renderer/api.js (the invoke() path, which strips the IPC prefix).
    const scan = await cdp.evaluate(`import('./renderer/api.js').then((m) => m.scanFolder(${JSON.stringify(FIXTURE)}))`);
    check('scanFolder finds 3 films and skips 1 file', scan && scan.files.length === 3 && scan.skipped === 1, scan);
    const scanNames = (scan?.files || []).map((f) => f.split(/[\\/]/).pop());
    check('scan order is a.png, b.PNG, batch/c.jpg (sorted by name, depth-first)',
      same(scanNames, ['a.png', 'b.PNG', 'c.jpg']) && /[\\/]batch[\\/]c\.jpg$/.test(scan?.files?.[2] || ''), scan?.files);
    const emptyFolderMessage = await cdp.evaluate("import('./renderer/api.js').then((m) => m.scanFolder('')).then(() => null, (e) => e.message)");
    check("scanFolder('') rejects with the display-ready message, no IPC prefix", emptyFolderMessage === 'No folder was selected.', emptyFolderMessage);
    const missingCsvMessage = await cdp.evaluate(`import('./renderer/api.js').then((m) => m.readCsv(${JSON.stringify(path.join(FIXTURE, 'missing.csv'))})).then(() => null, (e) => e.message)`);
    check('readCsv on a missing file rejects with the display-ready message', missingCsvMessage === 'The CSV file was not found.', missingCsvMessage);

    // 2. readCsv + parse/autoMap/findJoinHeader in the page, on the BOM + CRLF file.
    const csv = await cdp.evaluate(`(async () => {
      const api = await import('./renderer/api.js');
      const csvMod = await import('./renderer/data/csv.js');
      const raw = await api.readCsv(${JSON.stringify(CSV_PATH)});
      const parsed = csvMod.parse(raw);
      return {
        bom: raw.charCodeAt(0) === 0xFEFF,
        crlf: raw.includes('\\r\\n'),
        headers: parsed.headers,
        rows: parsed.rows,
        mapping: csvMod.autoMap(parsed.headers),
        joinHeader: csvMod.findJoinHeader(parsed.headers),
      };
    })()`);
    check('readCsv returns the raw text (BOM and CRLF intact)', csv.bom === true && csv.crlf === true, { bom: csv.bom, crlf: csv.crlf });
    check('parse strips the BOM: headers are study_id, age_yrs, sex, tx_plan', same(csv.headers, EXPECTED_HEADERS), csv.headers);
    check('parse yields 4 rows; the first is a/58/F/Fusion and the last has study_id A',
      csv.rows.length === 4 && same(csv.rows[0], { study_id: 'a', age_yrs: '58', sex: 'F', tx_plan: 'Fusion' }) && csv.rows[3].study_id === 'A', csv.rows);
    check('autoMap claims Age and Sex, leaves study_id and tx_plan unmapped', same(csv.mapping, EXPECTED_MAPPING), csv.mapping);
    check('findJoinHeader finds study_id', csv.joinHeader === 'study_id', csv.joinHeader);

    // 3. Seed the workspace state the way the two handlers would, then mount the screen. The
    // router remounts only on SCREEN_KEYS, so the ws* keys go in first and `screen` last; starting
    // from Studies also bounces the screen if the app were already on Workspace.
    await cdp.setState('{ ack: true, screen: "studies", query: "" }');
    await cdp.settle();
    const startState = await cdp.state();
    const startCount = startState.studies.length;
    const startSummary = await summaryParts();
    check('precondition: on Studies with a readable summary', startState.screen === 'studies' && startSummary !== null && startSummary.studies === startCount, { screen: startState.screen, startSummary, startCount });
    const baseId = await cdp.evaluate("Promise.all([import('./renderer/store.js'), import('./renderer/data/persistence.js')]).then(([s, p]) => p.nextId(s.getState().studies))");
    check('nextId yields a real id to assign to the first film', /^SP-\d{4,}$/.test(baseId || ''), baseId);
    const ID_A = baseId;
    const ID_B = idPlus(baseId, 1);
    const ID_C = idPlus(baseId, 2);

    await cdp.setState(JSON.stringify({
      wsFolder: FIXTURE, wsFiles: scan.files,
      wsCsv: CSV_PATH, wsCsvHeaders: csv.headers, wsCsvRows: csv.rows, wsMapping: csv.mapping,
    }));
    await cdp.setState('{ screen: "workspace" }');
    await cdp.settle(100);
    let s = await cdp.state();
    check('the Workspace screen mounts', s.screen === 'workspace' && Boolean(await cdp.rect('.workspace-page')), s.screen);
    check('heading reads Workspace', ((await text('.workspace-heading')) || '').trim() === 'Workspace', await text('.workspace-heading'));

    const cards = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.workspace-card')];
      const read = (c) => (c ? {
        set: c.classList.contains('workspace-card-set'),
        eyebrow: c.querySelector('.eyebrow')?.textContent ?? null,
        value: c.querySelector('.workspace-card-value')?.textContent ?? null,
        meta: c.querySelector('.workspace-card-meta')?.textContent ?? null,
        button: c.querySelector('button.btn')?.textContent ?? null,
      } : null);
      const load = document.querySelector('.workspace-load');
      return {
        count: cards.length, c1: read(cards[0]), c2: read(cards[1]), c3Eyebrow: cards[2]?.querySelector('.eyebrow')?.textContent ?? null,
        loadDisabled: load ? load.disabled : null, loadText: load ? load.textContent.trim() : null,
        hint: document.querySelector('.workspace-load-hint')?.textContent ?? null,
        note: document.querySelector('.workspace-card-note')?.textContent ?? null,
      };
    })()`);
    check('three cards render with the folder and CSV cards in the set state', cards.count === 3 && cards.c1?.set === true && cards.c2?.set === true, cards);
    check('card 01: eyebrow, the folder path, 3 radiographs found, and a Change… button',
      cards.c1?.eyebrow === '01 — IMAGE FOLDER' && cards.c1?.value === FIXTURE && cards.c1?.meta === '3 radiographs found' && cards.c1?.button === 'Change…', cards.c1);
    check('card 02: eyebrow, the CSV path, 4 rows · 4 columns · matched on study_id',
      cards.c2?.eyebrow === '02 — CLINICAL DATA CSV · OPTIONAL' && cards.c2?.value === CSV_PATH && cards.c2?.meta === '4 rows · 4 columns · matched on study_id' && cards.c2?.button === 'Change…', cards.c2);
    check('card 03 is the column mapping card', cards.c3Eyebrow === '03 — COLUMN MAPPING', cards.c3Eyebrow);
    check('the note preview reads the fixture join numbers', typeof cards.note === 'string' && cards.note.includes(NOTE_PREVIEW), cards.note);
    check('Load workspace is enabled (boolean disabled) and the hint describes what happens next',
      cards.loadDisabled === false && cards.loadText === 'Load workspace'
      && cards.hint === 'New films are added to Studies as Processing. Open one and run segmentation from its Analysis screen.', cards);

    let chips = await chipsSnapshot();
    check('four chips in header order', same(chips.map((c) => c.src), EXPECTED_HEADERS), chips.map((c) => c.src));
    check('age_yrs and sex are mapped chips selecting Age and Sex',
      chips[1]?.mapped && !chips[1]?.unmapped && chips[1]?.value === 'Age' && chips[2]?.mapped && chips[2]?.value === 'Sex', [chips[1], chips[2]]);
    check('study_id and tx_plan are unmapped chips with an empty selection',
      chips[0]?.unmapped && !chips[0]?.mapped && chips[0]?.value === '' && chips[3]?.unmapped && chips[3]?.value === '', [chips[0], chips[3]]);
    check('each select is labelled Map <src>', chips.every((c) => c.label === `Map ${c.src}`), chips.map((c) => c.label));
    check('the tx_plan select offers Unmapped plus every known field not claimed elsewhere (no Age, no Sex)',
      same(chips[3]?.options, ['Unmapped', ...KNOWN_FIELDS.filter((f) => f !== 'Age' && f !== 'Sex')]), chips[3]?.options);
    check('the age_yrs select keeps its own Age and omits the Sex claimed by another chip',
      same(chips[1]?.options, ['Unmapped', ...KNOWN_FIELDS.filter((f) => f !== 'Sex')]), chips[1]?.options);

    // The override, dispatched as the DOM would: set the value, fire `change`.
    await cdp.evaluate(`(() => {
      const chip = [...document.querySelectorAll('.workspace-chip')].find((c) => c.querySelector('.workspace-chip-src')?.textContent === 'tx_plan');
      const select = chip.querySelector('.workspace-chip-select');
      select.value = 'Treatment plan';
      select.dispatchEvent(new Event('change'));
    })()`);
    await cdp.settle(100);
    s = await cdp.state();
    check('changing tx_plan to Treatment plan updates wsMapping', s.wsMapping[3]?.src === 'tx_plan' && s.wsMapping[3]?.dest === 'Treatment plan', s.wsMapping);
    chips = await chipsSnapshot();
    check('the tx_plan chip re-renders as mapped and selected', chips[3]?.mapped && !chips[3]?.unmapped && chips[3]?.value === 'Treatment plan', chips[3]);
    check('Treatment plan is no longer offered on the age_yrs select', Array.isArray(chips[1]?.options) && !chips[1].options.includes('Treatment plan'), chips[1]?.options);
    check('the note preview is unchanged by the mapping (the join is by study_id)', ((await text('.workspace-card-note')) || '').includes(NOTE_PREVIEW), await text('.workspace-card-note'));

    // 4. Load workspace: one setState, Studies, the toast, three new records at the top.
    const loadRect = await rectBy("() => document.querySelector('.workspace-load')");
    check('Load workspace has layout', Boolean(loadRect), loadRect);
    await cdp.click(loadRect.cx, loadRect.cy);
    await cdp.settle(150);
    s = await cdp.state();
    check('Load navigates to Studies', s.screen === 'studies', s.screen);
    check('the toast reports 3 studies added and the join numbers', s.toast === TOAST_FIRST_LOAD, s.toast);
    check('studies grew by exactly 3', s.studies.length === startCount + 3, { before: startCount, after: s.studies.length });
    const top = s.studies.slice(0, 3);
    check('the three new records are at the top, in scan order, with consecutive ids from nextId',
      same(top.map((x) => x.id), [ID_A, ID_B, ID_C]) && same(top.map((x) => x.fileName), ['a.png', 'b.PNG', 'c.jpg']) && same(top.map((x) => x.filePath), scan.files), top.map((x) => [x.id, x.fileName, x.filePath]));
    check('each new record is real and unsegmented', top.every((x) => x.source === 'real' && x.measurements === null && x.geometry === null), top.map((x) => [x.source, x.measurements]));
    check('a.png and b.PNG carry their CSV row (Age, Sex, Treatment plan); c.jpg carries {}',
      same(top[0]?.clinical, CLINICAL_A) && same(top[1]?.clinical, CLINICAL_B) && same(top[2]?.clinical, {}), top.map((x) => x.clinical));
    const listAfterLoad = await cdp.evaluate(`(() => {
      const rows = [...document.querySelectorAll('.studies-row')];
      const row = (id) => document.querySelector('.studies-row[data-study-id="' + id + '"]');
      return {
        firstThree: rows.slice(0, 3).map((r) => ({ id: r.dataset.studyId, proc: Boolean(r.querySelector('.badge-proc')), badge: r.querySelector('.badge')?.textContent ?? null })),
        deleteA: row(${JSON.stringify(ID_A)})?.querySelector('.studies-delete')?.getAttribute('aria-label') ?? null,
        deleteDemo: Boolean(row('SP-0042')?.querySelector('.studies-delete')),
      };
    })()`);
    check('the first three rows are the new studies, badged Processing',
      same(listAfterLoad.firstThree.map((r) => r.id), [ID_A, ID_B, ID_C]) && listAfterLoad.firstThree.every((r) => r.proc && r.badge === 'Processing'), listAfterLoad.firstThree);
    const summaryAfterLoad = await summaryParts();
    check('the summary grew by 3 studies and 3 in queue', summaryAfterLoad && summaryAfterLoad.studies === startCount + 3 && summaryAfterLoad.queued === startSummary.queued + 3, { startSummary, summaryAfterLoad });
    check('a real row has a Delete <id> button; a demo row has none', listAfterLoad.deleteA === `Delete ${ID_A}` && listAfterLoad.deleteDemo === false, listAfterLoad);

    // 5. Load again from the same state: idempotent -- nothing added, the three counted as known.
    await cdp.setState('{ screen: "workspace" }');
    await cdp.settle(100);
    const loadRect2 = await rectBy("() => document.querySelector('.workspace-load')");
    check('Load workspace is back with layout for the second load', Boolean(loadRect2), loadRect2);
    await cdp.click(loadRect2.cx, loadRect2.cy);
    await cdp.settle(150);
    s = await cdp.state();
    check('the second load reports 0 added · 3 already in the library, with the join clause and no clinical-update clause', s.screen === 'studies' && s.toast === TOAST_SECOND_LOAD, s.toast);
    check('the second load adds nothing and keeps the same top three', s.studies.length === startCount + 3 && same(s.studies.slice(0, 3).map((x) => x.id), [ID_A, ID_B, ID_C]), s.studies.slice(0, 4).map((x) => x.id));
    check('a.png still carries exactly its CSV row after the second load', same(s.studies[0]?.clinical, CLINICAL_A), s.studies[0]?.clinical);

    // 6. Open a.png: the drawer sits below the viewer/panel row, open, with no fields yet.
    const rowA = await cdp.rect(`.studies-row[data-study-id="${ID_A}"]`);
    check('the a.png row has layout', Boolean(rowA), rowA);
    await cdp.click(rowA.cx, rowA.cy);
    await cdp.settle(150);
    s = await cdp.state();
    check('clicking the row opens it on Analysis', s.screen === 'analysis' && s.openId === ID_A, { screen: s.screen, openId: s.openId });
    const drawer = await cdp.evaluate(`(() => {
      const d = document.querySelector('.clinical-data');
      const body = document.querySelector('.analysis-body');
      const toggle = d?.querySelector('.clinical-toggle');
      const imp = d?.querySelector('.clinical-import');
      return {
        present: Boolean(d),
        afterBody: Boolean(body) && body.nextElementSibling === d,
        inScreen: Boolean(d) && Boolean(d.parentElement) && d.parentElement.classList.contains('analysis-screen'),
        title: d?.querySelector('.clinical-title')?.textContent ?? null,
        count: d?.querySelector('.clinical-count')?.textContent ?? null,
        expanded: toggle?.getAttribute('aria-expanded') ?? null,
        closedClass: toggle ? toggle.classList.contains('clinical-toggle-closed') : null,
        importDisabled: imp ? imp.disabled : null,
        importText: imp ? imp.textContent.trim() : null,
        empty: Boolean(d?.querySelector('.clinical-empty')),
        grid: Boolean(d?.querySelector('.clinical-grid')),
        chips: [...(d ? d.querySelectorAll('.clinical-chip') : [])].map((b) => b.textContent.replace(/^\\+/, '')),
        custom: d?.querySelector('.clinical-custom')?.placeholder ?? null,
      };
    })()`);
    check('.clinical-data is the third child of the Analysis screen, directly after .analysis-body', drawer.present && drawer.afterBody && drawer.inScreen, drawer);
    check('the drawer header reads Clinical data · NO FIELDS, expanded', drawer.title === 'Clinical data' && drawer.count === 'NO FIELDS' && drawer.expanded === 'true' && drawer.closedClass === false, drawer);
    check('Import from CSV is enabled for a real study with a workspace CSV', drawer.importDisabled === false && drawer.importText === 'Import from CSV', { importDisabled: drawer.importDisabled, importText: drawer.importText });
    check('with no fields the empty state shows and there is no grid', drawer.empty === true && drawer.grid === false, { empty: drawer.empty, grid: drawer.grid });
    check('ADD FIELD offers all nine known fields plus the custom input', same(drawer.chips, KNOWN_FIELDS) && drawer.custom === '+ Custom field…', { chips: drawer.chips, custom: drawer.custom });

    // 7. Import from CSV: the matched row's mapped columns become fields with values.
    const importRect = await rectBy("() => document.querySelector('.clinical-import')");
    check('Import from CSV has layout', Boolean(importRect), importRect);
    await cdp.click(importRect.cx, importRect.cy);
    await cdp.settle(150);
    s = await cdp.state();
    check('the import toast counts 3 fields', s.toast === 'Imported 3 fields from CSV', s.toast);
    check('state.fields holds Age, Sex and Treatment plan', same([...s.fields].sort(), ['Age', 'Sex', 'Treatment plan']), s.fields);
    let grid = await drawerGrid();
    let cells = cellsByField(grid);
    check('the grid has one row, for the open study', grid && grid.rows.length === 1 && grid.rows[0].id === ID_A, grid?.rows);
    check('the head row is STUDY then the three fields, each with a Hide button',
      grid && grid.heads[0] === 'STUDY' && same([...grid.heads.slice(1)].sort(), ['AGE', 'SEX', 'TREATMENT PLAN']) && same([...grid.removeLabels].sort(), ['Hide Age', 'Hide Sex', 'Hide Treatment plan']), { heads: grid?.heads, removeLabels: grid?.removeLabels });
    check('AGE, SEX and TREATMENT PLAN cells hold the CSV values, enabled',
      cells.AGE?.value === '58' && cells.SEX?.value === 'F' && cells['TREATMENT PLAN']?.value === 'Fusion' && [cells.AGE, cells.SEX, cells['TREATMENT PLAN']].every((c) => c && c.disabled === false), cells);
    check('the count label reads 3 FIELDS · 1 STUDY', grid?.count === '3 FIELDS · 1 STUDY', grid?.count);
    check('--clinical-cols is set for three fields', grid?.cols === '110px repeat(3, minmax(150px, 1fr))', grid?.cols);
    check('the imported fields leave the ADD FIELD row', same(grid?.chips, KNOWN_FIELDS.filter((f) => !['Age', 'Sex', 'Treatment plan'].includes(f))), grid?.chips);

    // 8. Add the Notes field from its chip.
    const notesChipRect = await rectBy("() => [...document.querySelectorAll('.clinical-chip')].find((b) => b.textContent.replace(/^\\+/, '') === 'Notes')");
    check('the + Notes chip has layout', Boolean(notesChipRect), notesChipRect);
    await cdp.click(notesChipRect.cx, notesChipRect.cy);
    await cdp.settle(100);
    s = await cdp.state();
    grid = await drawerGrid();
    cells = cellsByField(grid);
    check('adding Notes appends it to state.fields', s.fields.length === 4 && s.fields.includes('Notes'), s.fields);
    check('a NOTES column appears, empty, with the — placeholder', cells.NOTES && cells.NOTES.value === '' && cells.NOTES.placeholder === '—', cells.NOTES);
    check('the count label reads 4 FIELDS · 1 STUDY and Notes leaves the chip row', grid?.count === '4 FIELDS · 1 STUDY' && !grid?.chips.includes('Notes'), { count: grid?.count, chips: grid?.chips });

    // 9. Type into the Notes cell and leave it (Tab): `change` commits ONE new record to the store.
    const notesCellRect = await rectBy(`() => {
      const d = document.querySelector('.clinical-data');
      const heads = [...d.querySelectorAll('.clinical-grid-head .clinical-grid-cell')].map((c) => (c.querySelector('span') ? c.querySelector('span').textContent : c.textContent));
      const i = heads.indexOf('NOTES') - 1;
      const row = [...d.querySelectorAll('.clinical-grid-row')].find((r) => !r.classList.contains('clinical-grid-head'));
      return i >= 0 && row ? row.querySelectorAll('.clinical-cell')[i] : null;
    }`);
    check('the NOTES cell has layout', Boolean(notesCellRect), notesCellRect);
    await cdp.click(notesCellRect.cx, notesCellRect.cy);
    await cdp.typeText(NOTE_TEXT);
    await cdp.key('Tab');
    const noteCommitted = await waitForState(`(s.studies.find((x) => x.id === ${JSON.stringify(ID_A)}) || {}).clinical?.Notes === ${JSON.stringify(NOTE_TEXT)}`, 3000);
    s = await cdp.state();
    const recordA = s.studies.find((x) => x.id === ID_A);
    check('leaving the cell writes study.clinical.Notes on the record', noteCommitted === true && recordA?.clinical?.Notes === NOTE_TEXT, recordA?.clinical);
    check('the other fields on the record and the other records are untouched',
      same(recordA?.clinical, { ...CLINICAL_A, Notes: NOTE_TEXT }) && same(s.studies.find((x) => x.id === ID_B)?.clinical, CLINICAL_B) && same(s.studies.find((x) => x.id === ID_C)?.clinical, {}), s.studies.slice(0, 3).map((x) => x.clinical));
    grid = await drawerGrid();
    cells = cellsByField(grid);
    // setValue pre-arms the rebuild gate, so the commit does NOT tear the grid down (a rebuild
    // during the blur-dispatched `change` would strand focus on <body>); the cell the user typed
    // into keeps its value and the next cell keeps the focus Tab just gave it.
    check('the cell still shows the typed note after the commit', cells.NOTES?.value === NOTE_TEXT, cells.NOTES);

    // 10. The persisted store, through the bridge: real records only, with the clinical values.
    const persisted = await waitForStore(`studies.some((x) => x.id === ${JSON.stringify(ID_A)} && x.clinical && x.clinical.Notes === ${JSON.stringify(NOTE_TEXT)})`, 5000);
    const stored = (persisted.raw && persisted.raw.studies) || [];
    check('loadStudies() shows the note persisted on a.png', persisted.ok === true, stored.find((x) => x.id === ID_A)?.clinical);
    check('the store holds real records only (no demo ids, every source real)', stored.length > 0 && stored.every((x) => x.source === 'real' && !/^SP-00\d\d$/.test(x.id)), stored.map((x) => [x.id, x.source]));
    check('the store carries the three fixture records with their clinical values',
      same(stored.find((x) => x.id === ID_A)?.clinical, { ...CLINICAL_A, Notes: NOTE_TEXT }) && same(stored.find((x) => x.id === ID_B)?.clinical, CLINICAL_B) && same(stored.find((x) => x.id === ID_C)?.clinical, {}), [ID_A, ID_B, ID_C].map((id) => stored.find((x) => x.id === id)?.clinical));

    // 11. Chevron: collapse hides the body, expand brings the values back.
    const toggleRect = await rectBy("() => document.querySelector('.clinical-toggle')");
    check('the chevron has layout', Boolean(toggleRect), toggleRect);
    await cdp.click(toggleRect.cx, toggleRect.cy);
    await cdp.settle(100);
    s = await cdp.state();
    const collapsed = await cdp.evaluate(`(() => { const d = document.querySelector('.clinical-data'); const t = d?.querySelector('.clinical-toggle'); return { grid: Boolean(d?.querySelector('.clinical-grid')), body: Boolean(d?.querySelector('.clinical-body')), title: d?.querySelector('.clinical-title')?.textContent ?? null, expanded: t?.getAttribute('aria-expanded') ?? null, closedClass: t ? t.classList.contains('clinical-toggle-closed') : null, count: d?.querySelector('.clinical-count')?.textContent ?? null }; })()`);
    check('collapsing sets dataOpen false, hides the body and keeps the header', s.dataOpen === false && collapsed.grid === false && collapsed.body === false && collapsed.title === 'Clinical data' && collapsed.expanded === 'false' && collapsed.closedClass === true && collapsed.count === '4 FIELDS · 1 STUDY', { dataOpen: s.dataOpen, ...collapsed });
    const toggleRect2 = await rectBy("() => document.querySelector('.clinical-toggle')");
    await cdp.click(toggleRect2.cx, toggleRect2.cy);
    await cdp.settle(100);
    s = await cdp.state();
    grid = await drawerGrid();
    cells = cellsByField(grid);
    check('expanding restores the grid with every value, the note included', s.dataOpen === true && grid?.gridPresent === true && cells.AGE?.value === '58' && cells.NOTES?.value === NOTE_TEXT, { dataOpen: s.dataOpen, cells });

    // 11b. A demo study's cells are disabled and say why (Task 6's walkthrough item, kept here so
    // it is checked on every run). Back to Studies first, the way a user would.
    const backRect = await cdp.rect('.icon-btn[aria-label="Back to studies"]');
    check('back button has layout', Boolean(backRect), backRect);
    await cdp.click(backRect.cx, backRect.cy);
    await cdp.settle(100);
    const demoRow = await cdp.rect('.studies-row[data-study-id="SP-0042"]');
    check('the SP-0042 row has layout', Boolean(demoRow), demoRow);
    await cdp.click(demoRow.cx, demoRow.cy);
    await cdp.settle(150);
    const demoDrawer = await cdp.evaluate(`(() => {
      const d = document.querySelector('.clinical-data');
      const imp = d?.querySelector('.clinical-import');
      const cells = [...(d ? d.querySelectorAll('.clinical-cell') : [])].map((i) => ({ disabled: i.disabled, title: i.title }));
      return { present: Boolean(d), importDisabled: imp ? imp.disabled : null, importTitle: imp ? imp.title : null, cells, count: d?.querySelector('.clinical-count')?.textContent ?? null };
    })()`);
    check('a demo study mounts the drawer with every cell disabled and titled Demo studies are not saved',
      demoDrawer.present && demoDrawer.cells.length === 4 && demoDrawer.cells.every((c) => c.disabled === true && c.title === 'Demo studies are not saved') && demoDrawer.count === '4 FIELDS · 1 STUDY', demoDrawer);
    check('Import from CSV is disabled on a demo study and says why', demoDrawer.importDisabled === true && demoDrawer.importTitle === 'Demo studies are not saved', { importDisabled: demoDrawer.importDisabled, importTitle: demoDrawer.importTitle });
    const backRect2 = await cdp.rect('.icon-btn[aria-label="Back to studies"]');
    await cdp.click(backRect2.cx, backRect2.cy);
    await cdp.settle(100);
    s = await cdp.state();
    check('back on Studies with the three fixture rows still listed', s.screen === 'studies' && (await rowCount()) === startCount + 3, { screen: s.screen, rows: await rowCount() });

    // 12. Delete b.PNG, two steps. A sidecar is written first through the bridge so "the sidecar
    // is gone" is a real assertion: b.PNG was never segmented, and without this the file would be
    // absent before AND after the delete. The stub is never read -- restoreFilm only reads a
    // sidecar for a record with measurements and geometry, and b.PNG has neither.
    const sidecarBefore = await cdp.evaluate(`window.spineContour.savePrediction(${JSON.stringify(ID_B)}, { smoke: 'sidecar' }).then(() => window.spineContour.loadPrediction(${JSON.stringify(ID_B)}))`);
    check('precondition: a sidecar exists for b.PNG', sidecarBefore && sidecarBefore.smoke === 'sidecar', sidecarBefore);
    const countBeforeDelete = (await cdp.state()).studies.length;
    const summaryBeforeDelete = await summaryParts();

    const deleteRect = await rectBy(`() => document.querySelector('.studies-delete[aria-label="Delete ${ID_B}"]')`);
    check('the b.PNG row has a Delete button with layout', Boolean(deleteRect), deleteRect);
    await cdp.click(deleteRect.cx, deleteRect.cy);
    await cdp.settle(100);
    const promptState = () => cdp.evaluate(`(() => {
      const row = document.querySelector('.studies-row[data-study-id="${ID_B}"]');
      if (!row) return null;
      const buttons = [...row.querySelectorAll('button.btn')].map((b) => b.textContent.trim());
      return {
        prompt: row.querySelector('.studies-delete-prompt')?.textContent ?? null,
        confirm: row.querySelector('.studies-delete-confirm')?.textContent.trim() ?? null,
        cancel: buttons.includes('Cancel'),
        deleteButton: Boolean(row.querySelector('.studies-delete')),
      };
    })()`);
    let prompt = await promptState();
    check('the first click shows Delete this study? with Delete and Cancel in place of the action cell',
      prompt && prompt.prompt === 'Delete this study?' && prompt.confirm === 'Delete' && prompt.cancel === true && prompt.deleteButton === false, prompt);
    s = await cdp.state();
    check('the first click deletes nothing and stays on Studies', s.screen === 'studies' && s.studies.length === countBeforeDelete, { screen: s.screen, count: s.studies.length });

    const cancelRect = await rectBy(`() => [...document.querySelector('.studies-row[data-study-id="${ID_B}"]').querySelectorAll('button.btn')].find((b) => b.textContent.trim() === 'Cancel')`);
    check('Cancel has layout', Boolean(cancelRect), cancelRect);
    await cdp.click(cancelRect.cx, cancelRect.cy);
    await cdp.settle(100);
    prompt = await promptState();
    check('Cancel restores the Delete button and removes the prompt', prompt && prompt.prompt === null && prompt.confirm === null && prompt.deleteButton === true, prompt);
    check('the record is still there after Cancel', (await cdp.state()).studies.some((x) => x.id === ID_B), ID_B);

    const deleteRect2 = await rectBy(`() => document.querySelector('.studies-delete[aria-label="Delete ${ID_B}"]')`);
    await cdp.click(deleteRect2.cx, deleteRect2.cy);
    await cdp.settle(100);
    const confirmRect = await rectBy(`() => document.querySelector('.studies-row[data-study-id="${ID_B}"] .studies-delete-confirm')`);
    check('the confirm button has layout', Boolean(confirmRect), confirmRect);
    await cdp.click(confirmRect.cx, confirmRect.cy);
    const removed = await waitForState(`!s.studies.some((x) => x.id === ${JSON.stringify(ID_B)})`, 5000);
    await cdp.settle(150);
    s = await cdp.state();
    check('confirming removes the record from the store', removed === true && s.studies.length === countBeforeDelete - 1, { removed, count: s.studies.length });
    check('the toast reads Deleted <id> and the app stays on Studies', s.toast === `Deleted ${ID_B}` && s.screen === 'studies', { toast: s.toast, screen: s.screen });
    check('a.png and c.jpg survive the delete with their clinical values',
      same(s.studies.find((x) => x.id === ID_A)?.clinical, { ...CLINICAL_A, Notes: NOTE_TEXT }) && s.studies.some((x) => x.id === ID_C), s.studies.slice(0, 3).map((x) => x.id));
    const rowsAfterDelete = await cdp.evaluate(`[...document.querySelectorAll('.studies-row')].map((r) => r.dataset.studyId)`);
    const summaryAfterDelete = await summaryParts();
    check('the row is gone and the summary shrank by one study and one in queue',
      !rowsAfterDelete.includes(ID_B) && rowsAfterDelete.length === countBeforeDelete - 1 && summaryAfterDelete && summaryBeforeDelete
      && summaryAfterDelete.studies === summaryBeforeDelete.studies - 1 && summaryAfterDelete.queued === summaryBeforeDelete.queued - 1, { rowsAfterDelete, summaryBeforeDelete, summaryAfterDelete });
    const sidecarAfter = await cdp.evaluate(`window.spineContour.loadPrediction(${JSON.stringify(ID_B)})`);
    check('loadPrediction returns null for the deleted study (the sidecar is gone)', sidecarAfter === null, sidecarAfter);
    const storeAfterDelete = await waitForStore(`!studies.some((x) => x.id === ${JSON.stringify(ID_B)})`, 5000);
    const storedAfter = (storeAfterDelete.raw && storeAfterDelete.raw.studies) || [];
    check('loadStudies() no longer lists the deleted study and still lists a.png and c.jpg',
      storeAfterDelete.ok === true && storedAfter.some((x) => x.id === ID_A) && storedAfter.some((x) => x.id === ID_C), storedAfter.map((x) => x.id));

    // 13. No console errors or exceptions during the run.
    check('no console errors or exceptions during the run', cdp.errors.length === 0, cdp.errors);
  } finally {
    cdp.close();
  }

  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${JSON.stringify(r.detail)}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
  ```

  Notes for the implementer, so the suite is not "fixed" into a false green:
  - Card 01's meta is asserted **without** the skipped clause on purpose (see the header comment). Do not seed `lastScan` from the suite; the clause is Gate 2's.
  - The two toast strings are derived from `workspaceLoadedMessage` exactly as Task 4 specifies it (first load: `added 3`; second load: `known 3`, `updated 0` — Load fills only blank clinical keys, and `a.png` and `b.PNG` were created with every CSV value they match, so the second pass has nothing to fill and the message carries no `(clinical data updated for K)` clause). If a toast check fails, the message builder or `loadWorkspaceStudies` is wrong, not the expectation.
  - `waitForStore` builds its predicate with `new Function` on the suite's own literal strings, never on page data.
  - `savePrediction` for `b.PNG` is the one write the suite makes outside the UI; `predictionPath` accepts it because the id is `SP-1000` or higher. If the suite dies before the delete, the leftover `predictions/<id>.json` is inert (never read for an unsegmented record) and the next `launch.mjs` without `SMOKE_KEEP_PROFILE` wipes it.

- [ ] **Step 2: Syntax-check the suite**

  Run: `node --check tools/smoke/smoke-workspace.mjs`

  Expected: no output, exit 0. Do **not** launch the app from the implementer session — the controller runs the suite (Step 4).

- [ ] **Step 3: Add the plan-06 section to `tools/smoke/README.md`**

  Insert the following after the "Running the plan-05 suites" section (before "## Library"). The block below is fenced with FOUR backticks so the three-backtick command fence inside it survives; the three-backtick fence is part of the README text and is inserted verbatim, and the four-backtick lines are not:

  ````markdown
  ## Running the plan-06 suite

  `smoke-workspace.mjs` drives the Workspace screen, the clinical data drawer and the two-step
  delete end to end on a launched app: the folder scan and CSV read through `renderer/api.js`
  (display-ready rejections included), the screen seeded from a fixture, the mapping override,
  `Load workspace` twice, `Import from CSV`, a chip, typing into a cell, collapse/expand, the
  persisted store through the bridge, and deleting a study with its sidecar. It never segments.

  ```
  node tools/smoke/launch.mjs
  node tools/smoke/smoke-workspace.mjs
  node tools/smoke/cdp.mjs --quit
  ```

  It writes its own fixture under `tools/smoke/out/workspace-fixture/` (git-ignored) on every
  run — two 1×1 PNGs `a.png` and `b.PNG`, a nested `batch/c.jpg`, a `notes.txt` that is skipped —
  and, beside that folder (not inside it, so the scan skips exactly one file), an Excel-style
  `tools/smoke/out/workspace-fixture.csv` (BOM + CRLF) with two matching rows, one unmatched row
  and one duplicate `study_id`.

  Preconditions:

  - **A fresh scratch profile.** The drawer's count label is asserted as `NO FIELDS` on the first
    open, which holds only while no persisted record carries clinical values. `smoke-studies.mjs`
    may run before it on the same profile (the plan's order: studies, then workspace) — every
    count is relative to the starting `n` and the fixture ids come from `nextId` at run time, so
    `SP-9000` being present is fine.
  - **The backend up**, because `launch.mjs` does not report ready until the window exists, even
    though this suite runs nothing through it.
  - **Never between `smoke-persist.mjs --phase run` and `--phase restart`.** It writes the store
    through the saver (three records added, one deleted); `--phase restart` compares against a
    store it did not expect to change.
  - It ends on Studies with two fixture studies (`a.png`, `batch/c.jpg`) unsegmented and nothing
    mounted on Analysis.

  **What it cannot drive — Gate 2 human steps.** The native folder and CSV pickers
  (`chooseFolder`, `chooseCsv`) are dialogs, the same class as the dropzone click in
  `smoke-studies.mjs`; the suite seeds `wsFolder/wsFiles/wsCsv…` from the fixture through the
  store instead. Two consequences: the pickers themselves (including cancelling one, which must
  change nothing) are human steps, and so is card 01's ` · N skipped (unsupported files or
  links)` clause — `screens/workspace.js` records the skipped count in module scope only when
  its own folder handler ran the scan, so a state-seeded scan renders `3 radiographs found`
  without the clause, and that is what the suite asserts.

  **Known baseline** (fresh scratch profile, this branch tip): unit 259/259
  (`node --test test/*.test.js`); `smoke-workspace.mjs` 94/94 — confirm against the first green
  run before Gate 2, and copy it into `docs/superpowers/HANDOFF.md`'s baseline paragraph (plan 06
  Task 9). Every check in the suite runs unconditionally; there is no skip path.
  ````

  Confirm `94/94` against the real count the first time the suite is green (Step 4): the suite as written makes 94 `check(` calls on a run that reaches the end, all at one level inside the single `try` and none behind a conditional, and a run that dies early prints fewer.

- [ ] **Step 4: CONTROLLER VERIFICATION (not the implementer)**

  On a fresh scratch profile, from the worktree (`Set-Location` first; `$env:SPINE_CONTOUR_PYTHON` set):

  ```
  node tools/smoke/launch.mjs
  node tools/smoke/smoke-workspace.mjs
  node tools/smoke/cdp.mjs --quit
  ```

  Expected: every line `PASS`, `94/94 checks passed` (the suite makes 94 `check(` calls on a run that reaches the end; a smaller total means it died early, which is a failure even with no `FAIL` line), exit 0, and the app log (`tools/smoke/out/app.log`) shows no renderer error. Confirm that count against the README's plan-06 baseline (Step 3) before committing. A `FAIL` line is a product defect in Tasks 2–7 or a wrong expectation in the suite — read the `-> detail` and fix the right one; never loosen a check to pass.

- [ ] **Step 5: Run the unit suite**

  Run: `node --test test/*.test.js`

  Expected: `pass 259`, `fail 0` — unchanged from Task 7 (this task adds no unit test; DOM and CDP coverage is the suite above).

- [ ] **Step 6: Commit**

  ```
  git add tools/smoke/smoke-workspace.mjs tools/smoke/README.md
  git commit -m "test: smoke suite for the Workspace flow and the clinical data drawer"
  ```

- [ ] **GATE 2 — MANUAL VERIFICATION (user at the app), the acceptance criterion in full.** Controller first, on a fresh scratch profile (`Set-Location` to the worktree, `$env:SPINE_CONTOUR_PYTHON` set): `node --test test/*.test.js` (259/259); `node tools/smoke/launch.mjs`; `smoke-studies.mjs`; `smoke-workspace.mjs`; `smoke-persist.mjs --phase run`; `cdp.mjs --quit`; `$env:SMOKE_KEEP_PROFILE = "1"; node tools/smoke/launch.mjs`; `smoke-persist.mjs --phase restart`; then, because Task 7 changed `renderer/components/viewer.js` AND Task 6 added the clinical drawer as the Analysis screen's last child, which shortens `.viewer-stage`, the plan-04 suites in the README's order on that relaunched instance — `cdp.mjs --file tools/smoke/inject-study.js`, `cdp.mjs --file tools/smoke/run-and-wait.js > tools/smoke/out/last-run.json`, `smoke-parity`, `smoke-gate1`, `smoke-gate2`, a fresh `inject-study.js` + `run-and-wait.js` pair, `smoke-gate3`, `smoke-chip` — against these baselines: parity 15/15, gate1 25/25, gate2 32/32, gate3 23/23, chip 20/20 and studies 56/56 (`tools/smoke/README.md`), persist 33/33 and 44/44 (`docs/superpowers/HANDOFF.md` lines 54–55 — they are not in the README), workspace 94/94 as recorded in Step 4. Note that on this relaunch `state.fields` is seeded from the clinical values `smoke-workspace.mjs` persisted, so the drawer renders a four-column grid rather than its empty state; if a plan-04 suite misses its baseline here, check stage geometry before `viewer.js`. All green before asking; `cdp.mjs --quit` when done, then `Remove-Item Env:\SMOKE_KEEP_PROFILE` — leaving it set makes the next `launch.mjs` in this shell reuse the profile, and `smoke-studies`/`smoke-workspace` both require a fresh one. Then the user, from source on the **real dev profile**:

  **Copy the profile aside first** — the steps below add records, write clinical values and delete a study in `%APPDATA%\spine-contour`, which is the production profile on Windows:

  ```
  $p = "$env:APPDATA\spine-contour"
  if ((Test-Path "$p\studies.json") -and -not (Test-Path "$p\studies.json.gate2-backup")) { Copy-Item "$p\studies.json" "$p\studies.json.gate2-backup" }
  if (Test-Path "$p\predictions") {
    if (-not (Test-Path "$p\predictions.gate2-backup")) { Copy-Item "$p\predictions" "$p\predictions.gate2-backup" -Recurse }
  } else { "no predictions\ yet — nothing to back up" }
  ```

  `predictions\` may not exist yet: Gate 1 segmented nothing, and step 8 below says so itself. Its absence is expected and not an error. The `-not (Test-Path …gate2-backup)` guards stop a re-run of this gate from overwriting the backup you took the first time — `Copy-Item` replaces a file destination silently and nests a directory destination.

  Then launch (all three lines, from a fresh shell; the process staying alive is not a launch — wait for the window):

  ```
  Set-Location "C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign"
  $env:SPINE_CONTOUR_PYTHON = "C:\Users\codyj\spine contour\.venv\Scripts\python.exe"
  npm.cmd run dev -- --remote-debugging-port=9222
  ```

  (Quit any scratch instance first with `node tools/smoke/cdp.mjs --quit`, or the port is held.)

  Prepare beforehand: a folder of real lateral radiographs with at least one subfolder holding one more film and one non-image file (a `.txt`); and a CSV **saved from Excel as "CSV UTF-8"** (BOM + CRLF) with a `study_id` column whose values are the filename stems (without extension) of two of those films, plus one row that matches no film, and columns named `age_yrs`, `sex`, `tx_plan`.

  1. Landing → Enter → Workspace (sidebar). Expected: heading `Workspace`; card 01 `01 — IMAGE FOLDER` reads `No folder selected` / `DICOM, PNG, JPG · subfolders included` with `Choose folder…`; card 02 `02 — CLINICAL DATA CSV · OPTIONAL` reads `No file selected` / `One row per study, with a study_id column`; no card 03; `Load workspace` disabled; hint `Choose an image folder to continue.`
  2. `Choose folder…` → the native folder picker → pick the prepared folder. Expected: card 01 shows the folder path, switches to the set (sage-edged) state, and reads `N radiographs found · 1 skipped (unsupported files or links)` where N counts the subfolder's film too; the sidebar's Workspace line reads `N FILMS · 0 ROWS`; `Load workspace` enabled; hint `New films are added to Studies as Processing. Open one and run segmentation from its Analysis screen.` Click `Change…` and **cancel** the picker: nothing changes.
  3. `Choose CSV…` → pick the Excel CSV. Expected: card 02 set, the file path, `R rows · 4 columns · matched on study_id` (the BOM did not corrupt the first header); card 03 `03 — COLUMN MAPPING` with four chips `study_id → Unmapped`, `age_yrs → Age`, `sex → Sex`, `tx_plan → Unmapped`; the note under them reads `Rows are matched to films by study_id. 2 of R rows match a film · <R−2> unmatched. Rows that match no film are counted when the workspace loads and are not attached to any study.` Then the override (2a–2e from Gate 1, briefly): open the `tx_plan` dropdown — `Unmapped` plus every known field except `Age` and `Sex`; pick `Treatment plan` — the chip turns mapped; the `age_yrs` dropdown no longer offers `Treatment plan`; set `tx_plan` back to `Unmapped` — it is offered again; pick `Treatment plan` once more and leave it. `Choose CSV…` → cancel: the mapping is unchanged.
  4. `Load workspace`. Expected: Studies; toast `Workspace loaded — N studies added · clinical data linked (2 matched, <R−2> unmatched)`; the N new rows at the **top**, `Processing`, lordosis `—`, each with a trash button at the row's right end (demo rows have none); summary `IN QUEUE` grew by N.
  5. Workspace (sidebar) — the folder and CSV are still set — `Load workspace` again. Expected: toast `Workspace loaded — 0 studies added · N already in the library · clinical data linked (2 matched, <R−2> unmatched)` — no `(clinical data updated for …)` clause, since the two matched records already hold those values and a Load only fills blanks; Studies shows no new rows.
  6. Open one of the two matched studies (its filename stem is a `study_id` in the CSV). Expected: Analysis with the `Clinical data` drawer below the viewer/panel row, open, `NO FIELDS` (or the fields already on your library's records), `Import from CSV` enabled. Click `Import from CSV`: toast `Imported 3 fields from CSV`; columns `AGE`, `SEX`, `TREATMENT PLAN` with that row's values; `3 FIELDS · 1 STUDY`. Click `+ Notes`: a `NOTES` column, `4 FIELDS · 1 STUDY`. Type a note and click anywhere else. Click the chevron: the body hides, the header stays; click it again: every value is back, the note included. Add a custom field: type `Surgeon` in `+ Custom field…`, Enter — a `SURGEON` column, the input keeps focus; hover its `×` (tooltip `Hide field — values are kept`) and click it — the column goes.
  7. **Quit the app completely** (close the window; the process exits). Relaunch with the three lines above. Studies → open the same study. Expected: the drawer shows `AGE`, `SEX`, `TREATMENT PLAN`, `NOTES` with the same values (the fields were seeded from the saved record); `Surgeon` is not back (it was hidden, and no study carries that key — hiding is session-only and deletes nothing). Open a **demo** study (`SP-0042`): the same columns, every cell disabled with the tooltip `Demo studies are not saved`, `Import from CSV` disabled with the same tooltip. Back.
  8. Delete: pick a study that **has a sidecar** — one segmented in an earlier session (Gate 1 segmented nothing; check that `%APPDATA%\spine-contour\predictions\<id>.json` exists first), or, if the library holds none, run segmentation on one of the workspace rows now and wait for it to finish. Click its trash button: the row shows `Delete this study?` with `Delete` and `Cancel`, and the focus ring is on **Cancel** — pressing Enter or Space right now must dismiss the prompt, not delete anything (Delete is one Tab further on); press Escape — the prompt clears; click the trash again, then `Cancel` — clears; a third time, then `Delete`. Expected: the row is gone, toast `Deleted <id>`, summary down by one, `predictions\<id>.json` gone. Quit and relaunch: still gone. Then delete one of the unsegmented workspace rows the same way — no error although it never had a sidecar.
  9. Run A while editing B: open an unsegmented workspace study A → `Run segmentation` → Back while it runs (A's row reads `Processing`) → open a segmented study B → `Edit landmarks` → drag a handle a visible distance. Wait longer than a run takes (5–60 s; A's badge on Studies is the tell if you peek and come back — but do not leave B's edit mode yourself). Expected: B **stays in edit mode** throughout — the toolbar still reads `DONE` with `RETRACE` / `FIT` / `RESET TO PREDICTION`, the handle stays where you dragged it, no snap out of editing when A completes. Press `DONE`. Back: A reads `Segmented` or `Needs review` with a lordosis value; B's correction is kept when you reopen it.
  10. DevTools (`Ctrl+Shift+I`) → Console: no red lines during any of the above. In the console, `(await window.spineContour.loadStudies()).studies.map(s => [s.id, s.clinical])` lists only real records (no `SP-00xx`), with the clinical values you entered and imported, and none for the deleted ids.

  Afterwards, keep or restore the profile as you prefer: to restore, quit, delete `studies.json` and `predictions\`, and rename back whichever `.gate2-backup` copies exist — there is only one if the profile had no `predictions\` when you started.

---

## Task 9 — Docs and handoff; push to fork; preview-installer test

Plan 06 is implemented and verified (Tasks 1–8, Gate 1 after Task 4, Gate 2 after Task 8). This task closes it the way plan 05 was closed: the handoff records what plan 06 changed under plan 07 — every new export, channel, rule and deferral a later session will meet — the status lines in `CLAUDE.md` and the README catch up, and the architecture contract's prose stops speaking of plan 06 in the future tense while keeping every `(plan 06)` marker. Then the branch goes to `fork` (never `origin`, never `main`), which rebuilds the preview installer, and the user repeats Gate 2's core steps on that installer before anything can touch `main` (decision 16). Nothing in this task touches source code or tests; the unit count does not move (259 → 259). The last two steps need the human.

**Files:**
- Modify: `docs/superpowers/HANDOFF.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-31-00-architecture-contract.md` (two prose lines, tense only — every `(plan 06)` marker stays)

**Interfaces:**
- Consumes (documented here, produced by Tasks 1–8):
  - `scan-folder.js` (CommonJS root): `scanFolder(dirPath) → Promise<{files: string[], skipped: number}>`, `SUPPORTED_EXTENSIONS` — listed in `package.json` `build.files` and `electron-builder.preview.yml` `files` (Task 1).
  - `renderer/api.js`: `chooseFolder() → Promise<string|null>`, `scanFolder(dirPath) → Promise<{files, skipped}>`, `chooseCsv() → Promise<string|null>`, `readCsv(filePath) → Promise<string>` (Task 2); `deletePrediction(id) → Promise<void>` (Task 7).
  - `renderer/data/csv.js`: `KNOWN_FIELDS` (now exported), `parse(text) → {headers, rows}`, `autoMap(headers) → Mapping[]`, `fileStem(name) → string`, `findJoinHeader(headers) → string|null`, `joinClinical({files, headers, rows, mapping}) → {joinHeader, byFile, matched, unmatched, duplicates, ambiguous}`, `clinicalFieldNames(studies) → string[]` (Task 3).
  - `renderer/screens/workspace.js`: `render(state) → HTMLElement`, `loadWorkspaceStudies(state) → {studies, added, known, updated, join}`, `workspaceLoadedMessage({added, known, updated, join, mapping}) → string` (Task 4).
  - `renderer/components/clinical-data.js`: `mountClinicalData(host) → {update}`, `fieldCountLabel(fieldCount, studyCount) → string` (Task 5); mounted by `renderer/screens/analysis.js` with `fields` seeded in `renderer/main.js` by `clinicalFieldNames(studies)` (Task 6).
  - `renderer/components/viewer.js`: `forgetPrediction(studyId)`; `renderer/screens/analysis.js`: `releaseStudy(studyId)`; the delete flow in `renderer/screens/studies.js` (Task 7).
  - `tools/smoke/smoke-workspace.mjs` and its N/N baseline recorded in `tools/smoke/README.md` (Task 8).
- Produces: the handoff's "Resume plan 07 here — what plan 06 changed under you" section; the plan-06 DONE record; the branch on `fork`; the user's preview-installer report.

- [ ] **Step 1: Confirm the branch is closed before writing about it**

  Run from the worktree:

  ```
  Set-Location "C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign"
  git status --short
  git branch --show-current
  node --test test/*.test.js
  git log --oneline d335ea0..HEAD
  ```

  Expected: `git status --short` prints nothing except `?? .claude/` (the git-ignored SDD workspace — never `git add` it); the branch is `ui-redesign-cw`; the suite ends `# pass 259` / `# fail 0` (`# skipped 1` and `# pass 258` only if the Task 1 junction test skipped on this machine — it does not on Windows); the log shows plan 06's eight task commits plus any fix commits, newest first, and nothing else. Write down the hash of the **oldest** line (Task 1, `feat: add the workspace folder scanner and ship it in both installers`) and the **newest** line (Task 8, `test: smoke suite for the Workspace flow and the clinical data drawer`, or the last fix commit after it) — these are `<T1>` and `<T8>` below. Also open `tools/smoke/README.md` and copy the `smoke-workspace.mjs` baseline Task 8 recorded there (`N/N` below), and take the Gate 1 / Gate 2 dates from the SDD ledger (`<gate-1-date>`, `<gate-2-date>` below). If any of these is missing, stop: Task 8 or a gate is not actually done.

- [ ] **Step 2: HANDOFF.md — "Where things stand" says plan 06 is done**

  First set line 3 to `**Last updated:** <the date of this commit>`; line 4 (`**Branch:** `ui-redesign-cw``) and line 5 (the worktree path) are unchanged. Then replace the opening paragraph of `## Where things stand` (live lines 11–23, from `**Plans 01 through 05 are complete.**` to `…what plan 05 changed under it.`) with:

  ```markdown
  **Plans 01 through 06 are complete.** Plan 06's implementation (Tasks 1–8, commit range
  `<T1>..<T8>` plus the docs commit that closes it out) and its automated verification are
  done — the unit suite (259/259) and every `tools/smoke/` suite are green, `smoke-workspace.mjs`
  (N/N) joined the harness, and Gate 1 (after Task 4) and **Gate 2 (after Task 8), the final
  manual verification at the running app, both passed** (Gate 1 on <gate-1-date>, Gate 2 on
  <gate-2-date>); see "Tasks that need the human" below for the record. **The docs commit that
  closes plan 06 is pushed to `fork`** (never `origin`, never `main`) as Task 9's Step 10, which
  rebuilds the preview installer; that push and the user's test of the installer (decision 16)
  are the last two steps of plan 06, and both results are recorded under "Tasks that need the
  human" when they arrive. Plan 07 is deferred past the first release
  (decision 15) — see "Resume plan 07 here" below for what plan 06 changed under it, and
  "Release prerequisites" for what stands between this branch and `latest-windows`.
  ```

  Then add a plan-06 bullet directly after the **Plan 05** bullet (live line 59 ends `…pushed to `fork` the same day.`):

  ```markdown
  - **Plan 06** (`<T1>`..`<T8>`, plus the closing docs commit) — the Workspace screen and clinical
    data: `scan-folder.js` (recursive, sorted and deterministic, links and junctions never followed)
    behind four new IPC channels; a real CSV parser (BOM, CRLF, lone CR, quotes only at field start)
    with prefix auto-mapping and a user-editable column map; rows joined to films on the filename
    stem = `study_id`, case-insensitively; a one-shot, idempotent load into Studies as `Processing`
    that never touches the film bytes; the clinical-data drawer on Analysis with `Import from CSV`,
    its `fields` seeded from the saved studies at bootstrap; delete a study together with its sidecar
    and every id-keyed cache; run completion no longer clears another study's edit mode. Unit
    259/259 (201 → 259 across `scan-folder`, `api`, `csv`, `workspace`, `clinical-data` and
    `api-persistence`); `smoke-workspace.mjs` N/N; the plan-05 and plan-04 suites re-run clean. Gate 1
    (after Task 4, <gate-1-date>) and Gate 2 (after Task 8, <gate-2-date>) both passed.
  ```

- [ ] **Step 3: HANDOFF.md — three corrections inside "Resume plan 06 here" (now historical)**

  This section stays as the record of what plan 06 started from; only what it got wrong is corrected.

  1. Item 1: a substring edit inside live lines 222–223, **not** a whole-line replacement. Replace the text

     ```markdown
     leaving `openId`/`screen` alone — the saver persists that single reference change on its own.
     ```

     with

     ```markdown
     leaving `openId` alone — "do not open a study"; the Load handler does set `screen: 'studies'`
     (spec 9.3) — the saver persists that single reference change on its own.
     ```

     The sentence that follows on live line 223 (`Bytes are not parked for a scan; a scanned study runs later through the normal re-run path, which reads from `filePath`. No new `/predict` path.`) stays exactly as it is — replacing the line range wholesale would delete it.

  2. The harness paragraph (live line 289) says `unit 194/194`. The branch tip plan 06 started from had 201 (line 54 already says so — the two baselines contradicted each other, pre-flight F59). Change `unit 194/194` to `unit 201/201`.

  3. Prefix the **Rough edges for plan 06 to know about** paragraph (live line 310) with one sentence so nobody re-reports a fixed edge:

     ```markdown
     (Historical — plan 06 fixed the run-completion clear and now prunes `predictions/` on delete; the
     other edges still stand and are carried forward in "Resume plan 07 here".)
     ```

     Step 4's "Rough edges for plan 07 to know about" paragraph must therefore carry every edge that is not fixed here, the quarantine-toast wording included; that sentence is written as a fenced block because it contains backticks and a quoted section name.

- [ ] **Step 4: HANDOFF.md — the "Resume plan 07 here" section**

  Insert the following as a new `###` section immediately after the paragraph that ends `…Found in plan 05's final whole-branch review.` (live line 328) and before `### Distributing a build from this branch` (live line 330). Fill `N/N`, and the plan-04/05 suite counts from the Gate 2 controller run (they are expected to equal the plan-05 baseline; write what was measured).

  ```markdown
  ### Resume plan 07 here — what plan 06 changed under you

  Plan 06 added the Workspace screen, the clinical-data drawer and study deletion. The contract
  was amended in the same pass (its `(plan 06)` markers), so the interfaces below are already in
  it; this list is the *consequences* plan 07 inherits. Plan 07's own document was written
  before plan 06 and was not amended — where it names a function plan 06 does not export, the
  behaviour it specifies is normative and the name is not (plan 07's own dependency note).

  **1. `renderer/data/csv.js` grew seven exports and two rules.** `KNOWN_FIELDS` (the nine names
  the contract fixes) is now exported. `parse(text)` strips a UTF-8 BOM,
  accepts CRLF, LF and a lone CR, drops blank lines, and treats `"` as opening a quoted field
  **only at field start, leading whitespace allowed and discarded** (`1, "Doe, Jane"` is quoted;
  `5'11"` stays literal); duplicate header names keep the first column.
  `autoMap(headers)` is a prefix match on lowercased, non-alphanumeric-stripped names
  (`age_yrs` → `Age`, `odi_base` → `ODI`; `agent` → `Age` is the rule's known cost) and each known
  field is claimed by at most one column, first wins. New: `fileStem(name)`,
  `findJoinHeader(headers)` (the first header normalising to `studyid`, else `null`),
  `joinClinical({files, headers, rows, mapping}) → {joinHeader, byFile, matched, unmatched,
  duplicates, ambiguous}` and `clinicalFieldNames(studies)` (union of `clinical` keys,
  `KNOWN_FIELDS` order first, then custom names first-seen). `toCsv` is unchanged and
  `KNOWN_FIELDS`' nine strings are exactly the contract's. Plan 07's cards read `sim.clinical?.Notes || sim.clinical?.Diagnosis` — those keys
  are exactly the `KNOWN_FIELDS` names, and every value is a trimmed string.

  **2. Five new bridge methods, all through `invoke()`.** `chooseFolder()` and `chooseCsv()`
  resolve `null` on cancel (not an error, no toast); `scanFolder(dirPath)` and `readCsv(filePath)`
  reject with display-ready messages (`No folder was selected.`, `The folder was not found.`,
  `The folder could not be read. Check that you still have permission to open it.`,
  `No CSV file was selected.`, `The CSV file was not found.`, `The CSV file exceeds 50 MB.`,
  `The CSV file could not be read. Check that you still have permission to open it.`); `deletePrediction(id)`
  removes `predictions/<id>.json`, treats ENOENT as success, validates the id in the main process
  like every other sidecar path, and rejects for the session after `disablePersistence`. The
  native pickers cannot be driven over CDP; every suite sets `ws*` state directly.

  **3. `scan-folder.js` is a CommonJS root module in BOTH packaging allowlists** (`package.json`
  `build.files`, `electron-builder.preview.yml`), like `store-io.js`. It walks depth-first with
  entries sorted by name, so the ids a load assigns are the same on every filesystem; it never
  follows a symlink or junction (each counts as one `skipped`), swallows a nested `readdir` failure
  as one `skipped`, and rejects on the root. `SUPPORTED_EXTENSIONS` is exactly the native picker's
  set (`main.js:52`) and the Studies dropzone's `FILM_EXTENSIONS` (`screens/studies.js:83`) — spec
  9.3's seven plus `.dicom`, so all three ingestion paths accept the same files. The preview-installer run after plan 06 is the first CI run that exercises this
  allowlist entry.

  **4. The join rule: a film's identity before it has an id is its filename stem.** A CSV row
  joins the film whose `fileStem(fileName)` equals the row's `study_id`, both trimmed and
  lowercased. Rows that match no film are counted (`unmatched`) and stored nowhere; a second row
  with the same `study_id` is `duplicates` (first wins); a stem shared by two films is `ambiguous`
  (attached to neither). `study_id` is the join key, never a clinical field — `autoMap` leaves it
  `Unmapped` on purpose. `loadWorkspaceStudies(state)` is idempotent on `filePath`
  (case-insensitive): a known film is counted, not re-added, and the CSV **fills only its blank
  clinical keys** (absent or `''`) onto a new record — an existing value is never overwritten by a
  Load, and a known film with nothing to fill is returned by reference and not counted in
  `updated`; `Import from CSV` in the drawer is the explicit overwrite path. New films get
  consecutive ids from `nextId` in scan order and are front-inserted. The Load handler commits ONE `setState({ studies, screen: 'studies' })` — no
  `saveStudies` anywhere, the saver persists it — and toasts `workspaceLoadedMessage(...)`.
  `wsFolder/wsFiles/wsCsv…` survive navigation (no `wsLoaded` key exists), so Load can be pressed
  again and reports `Workspace loaded — 0 studies added · N already in the library` — followed by
  `(clinical data updated for K)` only when the CSV actually filled K records' blanks (a plain
  second Load of the same folder and CSV fills nothing, so the clause is absent), and by the same
  `clinical data linked (…)` clause as the first load whenever a CSV is set.

  **5. `state.fields` is seeded at bootstrap.** `renderer/main.js` calls
  `setState({ studies, fields: clinicalFieldNames(studies) })` after the store loads, so persisted
  clinical values are visible after a restart. `fields` stays session-only otherwise: the `×` in a
  column head is labelled **Hide** (`aria-label: Hide <name>`, `title: Hide field — values are
  kept`) because it only drops the name from `fields` — the values stay on the record, and the
  next launch re-seeds the column if any study still carries the key.

  **6. `mountClinicalData(host) → {update}` is the drawer; `visibleStudies(state)` is the one
  expression plan 07 replaces.** `analysis.js` creates `section.clinical-data` as the third child
  of `main.analysis-screen` (after `.analysis-body`) and calls `clinical.update()` from its own
  `update()` on every store notification; the drawer rebuilds only when its key
  `[studies, fields, dataOpen, openId, compareId, wsCsv]` changes — `compareId` is already in the
  key, so setting it re-renders the grid with no further wiring. Every row and the count label
  (`fieldCountLabel(fieldCount, studyCount)` → `N FIELDS · K STUDIES`) derive from
  `visibleStudies(state)`, which returns `[open]` today. Plan 07 Task 6 names the replacement
  `visibleStudiesForGrid(state)`; implement it as that expression's body (or rename
  `visibleStudies`) — nothing else in the drawer assumes one row. Cells for a demo study are
  disabled with the title `Demo studies are not saved`; `Import from CSV` joins
  `[study.fileName]` against the session's workspace CSV and is disabled with a reason when there
  is none. The drawer is capped at `max-height: 40vh` (an addition to the design for the 900px
  window).

  **7. Delete exists, and ids are reused.** The Studies table has a trailing action column; a real
  row's trash button opens an inline two-step confirm (`Delete this study?` / `Delete` / `Cancel`,
  no native dialog — `window.confirm` wedges CDP), cleared by Escape, Cancel, a click elsewhere
  or navigation. `deleteStudy(id)` refuses while `running === id`, awaits `deletePrediction(id)`
  when persistence is on, then `forgetPrediction(id)` (viewer snapshot + `replaceMeasured(id,
  null)`), `releaseStudy(id)` (`filePayloads`, and `imageCache` unless it is mounted), then ONE
  `setState` that filters `studies` and, if the study was open, resets `openId` and the view.
  `nextId` is max+1, so a deleted highest id is reused by the next film — which is why every
  id-keyed cache is cleared: the new record must not inherit the old film, bitmaps, snapshot or
  pending correction. **Plan 07 adds caches keyed by id (`activePanes`, comparison bitmaps) and a
  second id in state (`compareId`): clear them in the same place, and null `compareId` in the same
  `setState` when the deleted study is the comparison study** — a `compareId` that names no
  study must render as "not comparing", never throw. A study deleted while its relocate picker is
  open never runs (`runSegmentation` re-checks membership before `setState({ running })`). When the
  prompt opens, focus goes to **Cancel** (`.studies-delete-cancel`), not Delete — the repaint
  would otherwise drop focus to `<body>`, and the button a stray Enter or Space reaches must be
  the harmless one. **Accepted limitation, for a later accessibility pass:** the Studies row keeps
  `role="button"` from plan 05, so some screen readers flatten the row and do not announce the
  in-row delete controls as separate targets; mouse and Tab both work, and reshaping the row was
  deliberately left out of plan 06.

  **8. `predictions/` is pruned on delete only.** A load-time orphan sweep is deliberately not
  done: a refused (newer-version) store must never lose data, and an orphan sidecar beside a
  refused store is exactly the case where the app cannot tell an orphan from a study it cannot
  see. The plan-05 quarantine (`predictions.corrupt-<ts>` beside `studies.json.corrupt-<ts>`) is
  unchanged.

  **9. Run completion keeps another study's edit mode.** `runSegmentation`'s completion now
  resets `editing`/`selection` only when `state.openId === studyId`; a user mid-edit on study B
  keeps edit mode when study A finishes. The error path was already study-local. A comparison
  pane that shows study A while B is open and edited inherits this rule — do not reintroduce a
  global clear.

  **10. The `/measure` persist window is DEFERRED — a named post-06 fix-wave item, not plan 07's.**
  The window recorded above (a corrected geometry is committed and persisted ~150 ms plus one
  round trip before `/measure` returns, so an abrupt quit makes `geometry_new` + `measurements_old`
  durable together) is unchanged by plan 06. Option A (hold the commit until `/measure` returns)
  is not viable: the viewer draws handles from the store's geometry, so a held commit snaps the
  dragged handle back. **Option B is the design when it is fixed:** an optional
  `measurementsStale` flag on the record, set `true` by `commitGeometry` when it writes geometry
  ahead of the round trip and cleared when `recalculate` writes the measurements it produced;
  `validate` keeps the flag; the measurements panel marks stale numbers; `deriveStatus` treats a
  stale record as needing a re-measure. It touches `viewer/measure-queue.js`,
  `data/persistence.js` (`validate`), `components/measurements.js`, `data/status.js` and three test
  files — a fix-wave task, not a workspace one. It needs exactly two contract amendments, to be
  applied only when it lands: (a) the `Study` typedef gains `measurementsStale?: boolean`;
  (b) the status derivation's rule 2 (`Needs review`) gains "or `measurementsStale`".

  **11. The Workspace screen's shape, for anyone who touches it.** `render(state)` returns
  `main.workspace-page`; a module-scope `refresh()` remounts `.workspace-page-inner` after each
  handler's `setState` (handlers run from DOM events, never inside a subscriber; `SCREEN_KEYS` is
  still `['screen','ack']`). The skipped-file count lives in a module-scope `lastScan` and
  renders only while `lastScan.folder === state.wsFolder`, so it is never a fabricated `0`.
  `styles/screens/workspace.css` is linked from `index.html` after `studies.css`; the sage "set"
  tint is `color-mix` over tokens, no literals.

  **Verification harness, worth keeping.** `tools/smoke/smoke-workspace.mjs` (Task 8) drives the
  whole flow on a scratch profile from a fixture it writes under `tools/smoke/out/workspace-fixture/`
  (two PNGs, a nested JPG, a `notes.txt`) with a BOM+CRLF `workspace-fixture.csv` beside the
  folder: scan counts, parse/autoMap in
  page, the cards and chips, a select change, the note preview, Load, the toast, the drawer,
  `Import from CSV`, a typed value reaching `studies.json`, the two-step delete. See
  `tools/smoke/README.md` for its place in the run order; like `smoke-studies.mjs` it must never
  run between the two `smoke-persist` phases. Baseline at this branch's tip: unit 259/259;
  `smoke-workspace.mjs` N/N; `smoke-studies.mjs` 56/56; `smoke-persist.mjs --phase run` 33/33 and
  `--phase restart` 44/44; `smoke-parity` 15/15, `gate1` 25/25, `gate2` 32/32, `gate3` 23/23,
  `chip` 20/20 (re-run after Task 7's `viewer.js` change). The native folder and CSV pickers are
  the one thing no suite can press; Gate 1 covered them by hand.

  **Rough edges for plan 07 to know about.** While the relocate picker is open the Re-run buttons
  still render enabled and a click is swallowed by `locating` (unchanged from plan 05). The `DEMO`
  pill on Analysis is still built in `render()`, not `update()` — safe because every writer of
  `openId`, Load included, also sets `screen`. `autoMap`'s prefix rule maps `agent` → `Age`
  (documented, tested, accepted: the dropdown fixes it). The two-step delete confirm is
  module-scope state cleared on navigation; a plan-07 list that re-renders rows from another
  subscriber must not resurrect it. `SUPPORTED_EXTENSIONS` accepts `.dicom` but the backend still
  decides what it can decode. The quarantine toast still tells the user to rename both
  `.corrupt-<ts>` artefacts back, which only helps when the quarantined bytes are partially
  recoverable; the wording was not revisited in plan 06.
  ```

- [ ] **Step 5: HANDOFF.md — the tables and the decisions**

  1. **Execution order** (live lines 423 and 426). Replace the plan-06 row and the totals line:

     ```markdown
     | 06 | `2026-08-31-06-workspace-clinical-data.md` | 9 | **DONE** (Gate 2 passed <gate-2-date>) — folder scan, CSV import, clinical grid, delete |
     ```

     ```markdown
     82 tasks total (plan 05 grew from 10 to 12 tasks in its 2026-09-02 amendment; plan 06 from 6 to 9
     in its amendment, which added delete, the smoke suite and this closing task).
     ```

  2. **Tasks that need the human** (after the plan-05 Gate 2 bullet, live line 462). Add:

     ```markdown
     - ~~**Plan 06, Gate 1 (after Task 4)**~~ — done (<gate-1-date>). Covered the native folder and
       CSV pickers (the one thing no suite can press), the card counts, the chips and dropdown
       overrides, the note preview, Load into Studies with the new rows at the top as `Processing`,
       the idempotent second Load, a cancelled picker changing nothing, and the rows surviving a
       relaunch with no `SP-00xx` id in `studies.json`. From source on the real dev profile, with
       `studies.json` and `predictions\` copied aside first.
     - ~~**Plan 06, Gate 2 (after Task 8)**~~ — passed (<gate-2-date>). The acceptance criterion in
       full: Workspace → real folder + CSV → Load → Studies; a matched study's drawer, `Import from
       CSV`, a field added and typed, collapse/expand, quit, relaunch, the fields and values back;
       delete a study — gone after relaunch, its sidecar gone; run A while editing B — B keeps edit
       mode; no red lines in DevTools. The controller ran the unit suite and every `tools/smoke/`
       suite first (unit 259/259, `smoke-workspace` N/N, the plan-05 and plan-04 suites at their
       baselines).
     - **Plan 06, Task 9 — the preview-installer test** (decision 16): after the docs commit is
       pushed to `fork`, the user installs `Spine-Contour-Preview-Windows.exe` from the
       `preview-windows` prerelease beside production and repeats Gate 2's core steps on it. Pending
       until the user reports; record the outcome here, then the release-prerequisites bullet.
     - **Plan 07's gates can delete their throwaway studies.** Since plan 06 a real study can be
       deleted from the Studies list (trash button, inline confirm) and its sidecar goes with it, so
       a gate step on the real profile no longer has to hand-edit `studies.json` to clean up.
       "Copy it aside first" still applies to any step that overwrites or corrupts the store.
     ```

  3. **Decisions already made.** Decision 13 (live lines 502–504): append ` **Done in plan 06 (Task 7).**` after `…are plan 06's.` Decision 15 (live lines 509–510) becomes:

     ```markdown
     15. **Plan 06 (Workspace & clinical data) is done (<gate-2-date>); plan 07 (Find similar &
         comparison) is deferred past the first release.**
     ```

  4. **Release prerequisites** — the heading, the lead-in and the last bullet. The section's own
     heading and lead-in still scope the list against a plan that is now finished, while Step 2's
     new paragraph sends the reader here for what stands between this branch and `latest-windows`.
     Replace live line 514 with `## Release prerequisites — before a production release`, replace
     live lines 516–517 with

     ```markdown
     These are about shipping `latest-windows`, not about any remaining plan work; plan 07 is
     deferred past the first release (decision 15). They must not be forgotten before a
     production release:
     ```

     and make the last bullet (live lines 530–531):

     ```markdown
     - **Test the branch through the preview installer before pushing to the fork's `main`.**
       (decision 16 above). Plan 06's run of this test is the last step of its Task 9; the result is
       recorded under "Tasks that need the human" and this bullet is struck only when it passes.
     ```

- [ ] **Step 6: CLAUDE.md — the status line**

  Replace the status paragraph (live lines 7–13):

  ```markdown
  **Currently mid-redesign — plans 01–05 of 07 are done, user-verified (Gates 1 and 2 passed
  2026-09-03) and pushed to `fork`; plan 06 is next.** The preview installer is being built from
  `ui-redesign-cw` for the first time — its CI parity check had failed on every earlier run
  (CRLF checkouts; fixed in `8d8efe9`) — and the user tests that installer before anything
  touches `main`. See `docs/superpowers/HANDOFF.md` before doing anything: its "Resume plan 06
  here" section lists what plan 05 changed under the later plans (the contract was amended in
  step; the documents for plans 06–07 were not).
  ```

  with:

  ```markdown
  **Currently mid-redesign — plans 01–06 of 07 are done and user-verified (plan 06's Gate 1 on
  <gate-1-date>, Gate 2 on <gate-2-date>); plan 07 is deferred past the first release.** Plans
  01–05 are on `fork`; plan 06's closing docs commit goes there as Task 9's last steps. Every
  push of `ui-redesign-cw` rebuilds the preview installer, and the user tests that installer before
  anything touches `main`. See `docs/superpowers/HANDOFF.md` before doing anything: its "Resume
  plan 07 here" section lists what plan 06 changed under plan 07 (the contract was amended in
  step; the plan-07 document was not), and "Release prerequisites" lists what stands between this
  branch and a production release.
  ```

  Nothing else in `CLAUDE.md` changes: the non-negotiables, commands, and the Git section are still true.

- [ ] **Step 7: README.md — the "Workspace" subsection**

  Insert the following between the installer paragraph (live line 3) and `## Test data` (live line 5). Every sentence describes what the code does; none promises a queue, a flag in the list, or a format the backend has not been shown to decode.

  ```markdown
  ## Workspace

  The Workspace screen is part of the redesigned app on this branch; it is not in the current
  `latest-windows` installer linked above.

  It loads a folder of radiographs into the Studies library in one step, with an optional
  clinical-data CSV.

  - **Choose folder…** scans the folder and its subfolders for `.dcm`, `.dicom`, `.png`, `.jpg`,
    `.jpeg`, `.tif`, `.tiff` and `.bmp` files in any letter case. Other files, links and junctions
    are skipped and counted; links are never followed.
  - **Choose CSV…** (optional) reads a file with one row per study and a `study_id` column. Rows
    join films on the film's filename without its extension, case-insensitively — `SP001.dcm`
    takes the row whose `study_id` is `SP001` or `sp001`. Rows that match no film are counted in
    the load message and not stored; when two rows share a `study_id` the first wins; when two
    films share a stem the row is attached to neither.
  - Only the nine known clinical fields auto-map — Age, Sex, BMI, Diagnosis, ODI, Treatment plan,
    Surgical history, Follow-up, Notes — by prefix on the column name (`age_yrs` → Age,
    `odi_base` → ODI). Any other column can be mapped from the dropdown on its chip or left
    unmapped. `study_id` itself is the join key, not a field.
  - **Load workspace** adds each new film to Studies as `Processing` and attaches its CSV
    values. Films already in the library (same path) are not added again; the CSV only **fills
    in** clinical fields they are missing and never overwrites a value that is already there
    (use **Import from CSV** on the study's Analysis screen to replace values deliberately).
    Open a study and run segmentation from its Analysis screen; nothing runs automatically.
  - On the Analysis screen the **Clinical data** drawer shows the study's fields. **Import from
    CSV** pulls the matching row from the workspace CSV loaded this session. Values are saved
    with the study; demo studies are not saved and their cells are read-only. The `×` on a
    column head **hides** that column for the session — the values stay on the studies, and the
    column comes back at the next launch if any study still holds a value for it.
  - Deleting a study from the Studies list removes its record and its saved segmentation
    (`predictions/<id>.json` in the app's data folder). The film on disk is not touched.
  ```

- [ ] **Step 8: Contract — tense only, markers kept**

  The contract already carries plan 06's interfaces (the `(plan 06)` markers at live lines 68, 109, 111, 119, 122–123, 288, 311, 315, 338, 543–546, 551, 556 and 713 were applied with the amendment). Two lines of the file-structure block still speak of plan 06 as future. Edit exactly these, keeping the column alignment:

  Live line 65:
  ```
  main.js                           Electron main; gains IPC handlers in plans 05–06
  ```
  becomes
  ```
  main.js                           Electron main; gained its IPC handlers in plans 05–06
  ```

  Live line 66:
  ```
  preload.js                        contextBridge surface; grows in plans 05–06
  ```
  becomes
  ```
  preload.js                        contextBridge surface; grew in plans 05–06
  ```

  Leave alone: line 123's `[open] until plan 07` (still ahead), line 513's `what plan 06's workspace load produces` (present tense), line 344's `Pulled forward from plan 06` (history), and line 61's `Files marked **(new)** do not exist yet` with its `(new)` markers (a plan-02-era note outside this plan's remit — see the open calls). Prove the markers survived:

  ```
  git diff --stat docs/superpowers/plans/2026-08-31-00-architecture-contract.md
  git diff -U0 docs/superpowers/plans/2026-08-31-00-architecture-contract.md | grep -c "(plan 06)"
  ```

  Expected: `1 file changed, 2 insertions(+), 2 deletions(-)` and `0` — no changed line carries a `(plan 06)` marker (`-U0` drops the context lines; without it line 68's marker would be counted as context). If the diff touches any line other than 65 and 66, revert the file and redo the edit.

- [ ] **Step 9: Commit**

  ```
  git add docs/superpowers/HANDOFF.md CLAUDE.md README.md docs/superpowers/plans/2026-08-31-00-architecture-contract.md
  git commit -m "docs: plan 06 is done; record what it changed for plan 07"
  ```

  The subject line is fixed by the amendment sheet. If the session's harness requires its `Co-Authored-By` trailer, add it as a second `-m` argument; do not change the subject. `git status --short` afterwards prints only `?? .claude/`.

- [ ] **Step 10: NEEDS THE HUMAN — push to `fork`, and only `fork`**

  Push only with the user's explicit go-ahead in chat; the branch has been pushed to `fork` before (`8d8efe9`, `6592228`), never to `origin`, never as `main`. First prove the target:

  ```
  git remote -v
  git branch --show-current
  git log --oneline -1
  ```

  Expected: `fork` resolves to `github.com/Feches/Spine-Contour` (`origin` is `mjayasur/Spine-Contour`, read-only in practice); the branch is `ui-redesign-cw`; the top commit is Step 9's. Then:

  ```
  git push fork ui-redesign-cw
  ```

  No `--force`, no `origin`, no `main`, no tags. Pushing `ui-redesign-cw` triggers only `.github/workflows/windows-preview.yml`, which publishes `Spine-Contour-Preview-Windows.exe` to the `preview-windows` prerelease and cannot touch `latest-windows`. Watch it:

  ```
  gh run list --repo Feches/Spine-Contour --workflow windows-preview.yml --branch ui-redesign-cw --limit 1
  gh run watch --repo Feches/Spine-Contour <run-id> --exit-status
  ```

  Expected: the run completes green. Two steps carry plan-06 weight and deserve a look in the log: **Assert packaging allowlists agree** (this is the first CI run that sees `scan-folder.js` in both allowlists — a mismatch fails here, a file missing from *both* would not, which is why Task 1 ran the parity snippet locally) and **Test renderer** (`pass 259`). If the run fails, do not re-push blindly: read the failing step, fix on the branch with its own `ci:`/`fix:` commit, and push again. Then tell the user the installer is published and hand them Step 11.

- [ ] **Step 11: NEEDS THE HUMAN — install the preview beside production and repeat Gate 2's core steps on it (decision 16)**

  The user, on their machine:

  1. Open https://github.com/Feches/Spine-Contour/releases/tag/preview-windows. The release notes must read `PREVIEW BUILD — not the production release. Built from commit <sha> on branch ui-redesign-cw`, where `<sha>` is Step 9's commit (the asset is replaced with `--clobber`, so an older `<sha>` means the run has not finished or failed). Download `Spine-Contour-Preview-Windows.exe` (about 650 MB last time).
  2. Install it. It installs **beside** production, not over it: a separate uninstall entry (`Spine-Contour Preview`), a separate install directory, and its own data folder `%APPDATA%\Spine-Contour Preview\` (production's is `%APPDATA%\Spine-Contour\`; the two were proved distinct by inode in plan 01). The preview's data folder still holds the studies from the 2026-09-03 preview test — copy its `studies.json` and `predictions\` aside first if you want to keep them; this test deletes one study.
  3. Launch **Spine-Contour Preview** (its window title says so). Landing → the sidebar shows Workspace. Production is not opened during the test.
  4. **Workspace.** Choose folder… → a real folder of films (a handful is enough; a subfolder and a non-image file make the count meaningful). Expected: card 01 turns to the set state with the path and `N radiographs found · M skipped (unsupported files or links)`. Choose CSV… → a CSV with a `study_id` column whose values are the films' filename stems. Expected: card 02 shows `R rows · C columns · matched on study_id`; card 03 shows one chip per column with the auto-mapped ones filled; the note reads `K of R rows match a film` with any unmatched/duplicate counts. Load workspace. Expected: Studies opens with the new films at the top as `Processing` and a toast beginning `Workspace loaded — N studies added` and ending `clinical data linked (K matched…)`.
  5. **Drawer.** Open a matched study. Expected: the Clinical data drawer sits under the viewer with `J FIELDS · 1 STUDY` and the CSV values in its cells. Click Import from CSV. Expected: a toast `Imported n fields from CSV` (or, if every field was already present, the same values and the count). Add a field with a chip (e.g. `+ Notes`), type a value, click elsewhere. Collapse the drawer with the chevron, expand it. Expected: the field and value are still there.
  6. **Run and persist.** Run segmentation on that study; it completes. Quit the app completely. Relaunch the preview. Expected: Studies lists the same rows; the study opens with its film, its numbers, and the drawer's fields and values back.
  7. **Delete.** On Studies, click the trash button on one of the films you added. Expected: the row shows `Delete this study?` with Delete and Cancel; Cancel restores the row; the trash button again, then Delete. Expected: a toast `Deleted SP-xxxx`, the row is gone and the summary count shrinks. Quit, relaunch. Expected: still gone, and `%APPDATA%\Spine-Contour Preview\predictions\` has no `SP-xxxx.json` for it.
  8. **Edit mode across a run.** Open study A and start a run. While it runs, go back, open study B (already segmented) and enter edit mode. Wait for A to finish (the studies list or a toast shows it). Expected: B is still in edit mode with its selection; nothing snapped back.
  9. **Console.** Ctrl+Shift+I opens DevTools in the packaged build (the default Electron menu is kept). Expected: no red lines from the session. If DevTools does not open, say so in the report rather than reporting "clean".
  10. Quit the preview. Launch **production** Spine-Contour once and measure any film. Expected: it still works and shows none of the preview's studies.

  Report back, step by step: the `<sha>` from the release notes and the installer size; for each of 4–10 pass/fail with the text actually seen (the toast wording, the count label, the deleted id); the DevTools result or that it could not be opened. Anything that differs from "Expected" is a defect in the packaged build even if it passed from source — report it, do not work around it.

  When the report arrives, the controller records it in HANDOFF (the plan-06 Task 9 bullet under "Tasks that need the human", and the release-prerequisites bullet struck only on a pass) in a short follow-up docs commit — `docs: record the plan 06 preview-installer test` — pushed the same way as Step 10, fork only. That same commit updates Step 2's "Where things stand" sentence to name the pushed sha — `**`ui-redesign-cw` is pushed to `fork` at `<sha>`**, exactly as plan 05's own follow-up commit named `8d8efe9` — and CLAUDE.md's status line with it. Until then the two documents say the push is Task 9's last step, which is true when they are written. A failed report opens a fix wave on this branch before any further push; nothing merges to `main` either way — that is a release task with its own prerequisites (demo studies gated on build channel, the `windows.yml` repository guard).
