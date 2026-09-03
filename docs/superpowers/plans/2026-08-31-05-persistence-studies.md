# Persistence and Studies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local persistence for measured studies and build the full Studies screen, so a radiograph measured in this app is still there — with its measurements, its film and segmentation, its thumbnail, and its derived status — after the app is closed and reopened.

**Architecture:** Two pure renderer modules — `renderer/data/status.js` (status derivation) and `renderer/data/persistence.js` (ids, shape validation, demo/real merge, and the save-on-change coalescer) — are consumed by a fixture module (`renderer/data/demo-studies.js`, the nine fabricated studies), the full `renderer/screens/studies.js`, and the renderer bootstrap. Disk I/O is isolated in a root-level, CommonJS `store-io.js` (atomic write, corrupt-store recovery, per-study prediction sidecars) that only `main.js`'s IPC handlers touch, so every module the browser loads via `<script type="module">` stays free of Node built-ins. Status is computed from `measurements`/`qc` on every read — it is never stored as a field.

Persistence is **one store subscriber**, not a second `/predict` path: whenever `state.studies` changes reference, the real studies are written to `studies.json`. That single mechanism covers choosing a film, a completed run, every `/measure` correction, and a relocated source file, because plans 03 and 04 already write each of those into the store as a new array. The film and segmentation a study was measured on live beside the record as a **prediction sidecar** — the raw `/predict` response, written once per run — which is what makes a persisted study reviewable (the stage shows the film, the overlay, and the corrected geometry) and its corrections reversible (`RESET TO PREDICTION` has a target after a restart).

**Tech Stack:** Vanilla ES modules in the renderer, CommonJS in the main process (`main.js`, `preload.js`, `store-io.js`), `node --test` for the pure-logic modules, Electron's `ipcMain.handle`/`contextBridge`/`webUtils`, Canvas APIs for thumbnail generation, and the CDP smoke harness (`tools/smoke/`) for the DOM and canvas paths that `node --test` cannot reach.

**Amended 2026-09-02 against the live code at `7d4ab6e`** (plans 01–04 complete). The original text assumed plan 02's state of the world; every task below was rewritten against what actually exists. The pre-flight scan and its rulings are in the plan's SDD ledger (`.superpowers/sdd/2026-08-31-05-persistence-studies/progress.md`). The contract amendments this plan carries are listed at the end of this preamble; the architecture contract remains binding and wins over any task text.

## What plans 03 and 04 already built that this plan builds on

- `renderer/screens/studies.js` exists: a heading, the dropzone (`.dropzone*` classes from `styles/components.css`) and a `Choose radiograph` button whose `handleChoose` creates an **unsegmented** real study, parks the file bytes off the record (`setFilePayload` in `screens/analysis.js`), resets the per-study view state, and navigates to Analysis, where the run card's `Run segmentation` button calls `/predict`. **That flow is user-verified and stays.** This plan generalises it (the picker and a drop both feed one `addStudy`) and persists what it produces. It does not add a second `/predict` path inside the Studies screen.
- `select-file` already returns `{name, data, path}`. `renderer/api.js` wraps every bridge call through one `invoke` that normalises error messages; new functions follow that pattern. `preload.js` exposes `selectFile`, `predict`, `measure`, `openExternal`, `saveCsv`.
- `renderer/router.js` remounts the screen host only when `SCREEN_KEYS = ['screen','ack']` change. **That set does not grow.** A screen that reads a key which changes at typing rate (`query`) or on every `/measure` result (`studies`) subscribes to the store itself and updates in place — exactly what `screens/analysis.js` does with its module-scope `subscribe`.
- `renderer/components/viewer.js` owns the run card, every stage listener, the `/measure` queue (`viewer/measure-queue.js`) and the session-only prediction snapshot (`recordPrediction`). `screens/analysis.js` owns `runSegmentation`, the one-entry `imageCache`, and `filePayloads`. Geometry is never mutated in place; every write to `state.studies` is a new array.
- `styles/components.css` already defines `.badge` ("compact status label, used from plan 05 onward"), `.dropzone*`, `.btn.btn-primary.btn-small`, and `--on-accent`. `styles/screens/studies.css` styles `.studies-page`, `.studies-page-inner`, `.studies-header`, `.studies-heading`. `index.html` already links `styles/screens/studies.css`.
- `renderer/data/measurements.js` carries a private `RESIDUAL_LIMIT` and a comment saying plan 05 owes the guard that keeps it equal to `status.js`'s. It also marks a row absent only when `measurements` is `null` — a demo study with no `L1PA` key would throw `undefined.toFixed` inside the panel's subscriber.
- The repo root is CommonJS (`package.json` has no `"type"`); `renderer/package.json` and `test/package.json` are `{"type":"module"}`. A root-level `.js` file is parsed as CommonJS.
- Verification tooling: `.superpowers/sdd/2026-08-31-04-landmark-editing/` holds the CDP harness (`cdp-lib.mjs`, `cdp.mjs`, `inject-study.js`, `run-and-wait.js`, `smoke-parity/gate1/gate2/gate3/label/chip.mjs`) that caught every canvas defect in plans 03–04. Task 0 promotes it into the repo.

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

## Contract amendments carried by this plan

Applied to `2026-08-31-00-architecture-contract.md` in the same pass as this amendment; listed here so a task brief can cite them.

1. `state.running` is `string|null` — the id of the study whose `/predict` is in flight — not a boolean. One run at a time. (Handoff item 7.)
2. `renderer/api.js` gains `loadPrediction(id)`, `savePrediction(id, response)`, `readFile(filePath)`, the synchronous `pathForFile(file)`, and `disablePersistence(reason)` / `persistenceDisabledReason()` — after `disablePersistence`, `saveStudies` and `savePrediction` reject for the rest of the session. `loadStudies()` returns **validated** studies (it calls `validate` on the raw store the IPC returns).
3. `store-io.js` is CommonJS. Its interface is `STORE_VERSION`, `isValidStoreShape`, `readStudyStore(storePath) → {version, studies}`, `writeStudyStore(storePath, studies)`, `readJsonOrNull(path)`, `writeJsonAtomic(path, value)`.
4. `renderer/data/persistence.js` gains `createStudySaver(...)`. `validate` throws on a bad record identity or an unsupported `version`, and **nulls** a malformed `measurements`/`geometry` pair (both together) rather than throwing, so one corrupted payload cannot discard a whole store.
5. `renderer/components/viewer.js`'s `recordPrediction(studyId, response, measuredGeometry = response.geometry)` takes an optional third argument: the geometry the study's *current* measurements describe (a corrected study restored from disk). The returned viewer object gains `setFilmStatus(status)` (`'loading' | 'missing' | null`).
6. `renderer/data/measurements.js` exports `RESIDUAL_LIMIT`; `status.js` re-exports it, so there is one literal.
7. File structure: `store-io.js` (root, CommonJS, in both allowlists), `tools/smoke/` (dev harness, not packaged), and `userData/predictions/<id>.json` sidecars beside `userData/studies.json`.
8. `main.js` honours `SPINE_CONTOUR_USER_DATA` (development only) so smoke runs use a scratch profile.
9. The `Measurements` typedef marks `L1PA` and `LL['L2-S1']`…`['L5-S1']` optional, and the `Qc` typedef marks everything but `femoral.confidence` optional: demo studies omit them, `validate` accepts them absent, and the panel renders `—`.

Deviations from plan text that are **not** contract changes: the plan's `sourceAvailable` derived field is dropped (availability is checked when the film is needed); the plan's `runPrediction`/`buildStudy`/`generateThumbnail` in `studies.js` are replaced by the existing run flow plus a thumbnail generated at run completion; the relocate flow triggers from a re-run, not from a row click; and the plan's `Use sample film` button with its bundled radiograph is dropped (user decision, 2026-09-02: no film ships with the app; the README links public datasets for testing instead), so spec §9.4's sample-film button is not built and the existing `Choose radiograph` button stays. Deviation from spec §13 that the user is asked to accept at the amendment review: the prediction sidecar stores the model's `image_png`/masks per study under `userData/predictions/`, not inside `studies.json`.

---

## Task 0 — Promote the CDP verification harness into `tools/smoke/`

**Files:** `tools/smoke/README.md` (new), `tools/smoke/cdp-lib.mjs`, `tools/smoke/cdp.mjs`, `tools/smoke/launch.mjs` (new), `tools/smoke/inject-study.js`, `tools/smoke/run-and-wait.js`, `tools/smoke/smoke-parity.mjs`, `tools/smoke/smoke-gate1.mjs`, `tools/smoke/smoke-gate2.mjs`, `tools/smoke/smoke-gate3.mjs`, `tools/smoke/smoke-label.mjs`, `tools/smoke/smoke-chip.mjs` (all copied from `.superpowers/sdd/2026-08-31-04-landmark-editing/`), `.gitignore` (modify)

**Interfaces:**
- Consumes: the running app's `--remote-debugging-port=9222`, `node_modules/electron` (for the launcher's executable path). No npm dependencies — Node 24's global `fetch` and `WebSocket`.
- Produces: the harness every later task's smoke suite imports (`import { connect } from './cdp-lib.mjs'`), a launcher that starts the app on a scratch profile, and a README that says how to run everything.

Why now: every defect found at the app in plan 04 was caught by these scripts or by the user; none by the unit suite. `tools/smoke/` is outside both packaging allowlists (`assets/**`, `renderer/**`, `styles/**`, root files by name), so nothing here ships.

- [ ] Copy the harness files verbatim from `.superpowers/sdd/2026-08-31-04-landmark-editing/` into `tools/smoke/`: `cdp-lib.mjs`, `cdp.mjs`, `inject-study.js`, `run-and-wait.js`, `smoke-parity.mjs`, `smoke-gate1.mjs`, `smoke-gate2.mjs`, `smoke-gate3.mjs`, `smoke-label.mjs`, `smoke-chip.mjs`. Their relative imports (`./cdp-lib.mjs`) keep working because they move together. Do not copy the screenshots, reports, or `inject-study-2.js`/`inject-study-3.js`.

- [ ] In `tools/smoke/cdp-lib.mjs`, add one helper to the object `connect()` returns, beside `key`:

  ```js
  // Types into the focused element with Input.insertText, which fires the same input events a
  // keyboard does. Needed for the Studies search box.
  const typeText = (text) => send('Input.insertText', { text });
  ```

  and include `typeText` in the returned object. `screenshot(path)` stays as it is; suite authors write screenshots under `tools/smoke/out/`.

- [ ] In the copied `tools/smoke/inject-study.js`, change the injected id from `'SP-1000'` to `'SP-9000'` (one line: `const id = 'SP-9000';`). From Task 6 on, the store saver persists whatever the harness injects, and a film added through the picker on a fresh profile also produces `SP-1000` — the verbatim script would replace a segmented, persisted `SP-1000` with an unsegmented one. A reserved id keeps the plan-04 suites and the plan-05 suites from writing over each other in one profile. Say so in the README.

- [ ] Create `tools/smoke/launch.mjs`:

  ```js
  // Starts the app from source for smoke runs, detached, on a SCRATCH user-data directory so
  // smoke studies never land in the developer's real studies.json, and waits for the CDP port.
  //
  //   node tools/smoke/launch.mjs            (SPINE_CONTOUR_PYTHON must point at the venv python)
  //   node tools/smoke/cdp.mjs --quit        (clean shutdown through Browser.close)
  //
  // Env: CDP_PORT (default 9222), SPINE_CONTOUR_USER_DATA (default <tmp>/spine-contour-smoke;
  // main.js honours it from Task 5 onward), SMOKE_KEEP_PROFILE=1 to keep the scratch profile.
  import { spawn } from 'node:child_process';
  import fs from 'node:fs';
  import os from 'node:os';
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  import electron from 'electron';

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const port = process.env.CDP_PORT || '9222';
  const userData = process.env.SPINE_CONTOUR_USER_DATA || path.join(os.tmpdir(), 'spine-contour-smoke');
  const outDir = path.join(root, 'tools', 'smoke', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  if (!process.env.SMOKE_KEEP_PROFILE) fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });

  if (!process.env.SPINE_CONTOUR_PYTHON) {
    console.error('set SPINE_CONTOUR_PYTHON to the venv python first (see docs/superpowers/HANDOFF.md)');
    process.exit(2);
  }

  const log = fs.openSync(path.join(outDir, 'app.log'), 'w');
  const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
    cwd: root,
    env: { ...process.env, SPINE_CONTOUR_USER_DATA: userData },
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      console.log(JSON.stringify({ ready: true, pid: child.pid, port: Number(port), userData, browser: version.Browser }));
      process.exit(0);
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  console.error(`the app did not open port ${port} within 180 s; see ${path.join(outDir, 'app.log')}`);
  process.exit(1);
  ```

  `import electron from 'electron'` resolves to the executable path (that is what the `electron` npm package exports). Spawning the exe directly avoids `npm.cmd` (PowerShell's execution policy blocks `npm.ps1`, and Node refuses to spawn `.cmd` files without a shell).

- [ ] Add to `.gitignore`:

  ```
  tools/smoke/out/
  ```

- [ ] Write `tools/smoke/README.md` (short): what the harness is for (trusted-input smoke checks over CDP; the unit suite covers pure logic only), the launch/quit commands above, the order to run the plan-04 suites (`inject-study.js` through `cdp.mjs --file`, then `run-and-wait.js`, then `smoke-parity`, `gate1`, `gate2`, `gate3`, `label`, `chip`), the note that `inject-study.js` embeds the 157×280 `design_src/13462cd9` sample and segments it in ~7 s, the "process alive is not a launch" warning from the handoff, and the rule that every suite exits non-zero on a failed check and asserts no console errors.

- [ ] Syntax-check every script: `node --check tools/smoke/launch.mjs tools/smoke/cdp.mjs tools/smoke/cdp-lib.mjs tools/smoke/smoke-*.mjs`. Do **not** launch the app from the implementer session — the controller runs the suites.

- [ ] CONTROLLER VERIFICATION (not the implementer): launch with `tools/smoke/launch.mjs`, inject and segment the sample, run all six plan-04 suites. Expected: every suite green at `7d4ab6e` + this task. This is the regression baseline every later viewer change is checked against.

- [ ] Commit.

  ```
  git add tools/smoke .gitignore
  git commit -m "chore: promote the CDP smoke harness into tools/smoke"
  ```

---

## Task 1 — `renderer/data/status.js`: status derivation

**Files:** `renderer/data/status.js` (new), `renderer/data/measurements.js` (modify: export `RESIDUAL_LIMIT`), `test/status.test.js` (new)

**Interfaces:**
- Consumes: `renderer/data/measurements.js` — `piResidual`, `RESIDUAL_LIMIT`.
- Produces: `RESIDUAL_LIMIT` (re-exported), `CONFIDENCE_LIMIT`, `deriveStatus(study)`, `statusLabel(status)`, exactly per the architecture contract's `renderer/data/status.js` section.

`measurements.js` keeps a private `RESIDUAL_LIMIT` today with a comment that plan 05 owes the guard against it drifting from `status.js`'s. The guard is structural: one exported literal, imported by both consumers.

- [ ] In `renderer/data/measurements.js`, replace the private constant and its "PLAN 05 OWES THIS ONE GUARD" comment block with:

  ```js
  // The one residual threshold. data/status.js re-exports it, so deriveStatus() and
  // isConsistent() can never disagree about the same study.
  export const RESIDUAL_LIMIT = 1.0;
  ```

  `isConsistent` keeps using it unchanged.

- [ ] Write the failing test file `test/status.test.js`. Use the original plan's fourteen cases verbatim (limits; `null`/`undefined` study → `proc`; null measurements → `proc`; both pass → `seg`; residual fail, confidence fail, both fail → `rev`; residual exactly `1.0` and confidence exactly `0.6` → `seg`; `1.01` and `0.59` → `rev`; missing `qc` and missing `qc.femoral` → `seg`; `statusLabel` for all three) and add one:

  ```js
  import { isConsistent } from '../renderer/data/measurements.js';

  test('deriveStatus and isConsistent agree at the residual boundary (one RESIDUAL_LIMIT)', () => {
    const at = { PI: 20 + 30 + RESIDUAL_LIMIT, PT: 20, SS: 30 };
    const over = { PI: 20 + 30 + RESIDUAL_LIMIT + 0.01, PT: 20, SS: 30 };
    const qc = { femoral: { confidence: 0.9 } };
    assert.equal(deriveStatus({ measurements: at, qc }), 'seg');
    assert.equal(isConsistent(at), true);
    assert.equal(deriveStatus({ measurements: over, qc }), 'rev');
    assert.equal(isConsistent(over), false);
  });
  ```

- [ ] Verify the test fails: `node --test test/status.test.js` → `ERR_MODULE_NOT_FOUND` for `status.js`, zero tests executed.

- [ ] Implement `renderer/data/status.js`:

  ```js
  /**
   * Status derivation (spec 13.1, architecture contract "renderer/data/status.js").
   * Status is never stored on a Study — it is computed from measurements and qc
   * every time it is needed. Pure. The residual threshold is measurements.js's,
   * re-exported, so the panel's consistency warning and the list's status can never
   * disagree.
   */

  import { piResidual, RESIDUAL_LIMIT } from './measurements.js';

  export { RESIDUAL_LIMIT };
  export const CONFIDENCE_LIMIT = 0.6;

  /** @returns {'seg'|'rev'|'proc'} */
  export function deriveStatus(study) {
    if (!study || study.measurements == null) return 'proc';
    const residual = piResidual(study.measurements);
    const confidence = study.qc && study.qc.femoral ? study.qc.femoral.confidence : null;
    if (residual > RESIDUAL_LIMIT) return 'rev';
    if (typeof confidence === 'number' && confidence < CONFIDENCE_LIMIT) return 'rev';
    return 'seg';
  }

  export function statusLabel(status) {
    if (status === 'seg') return 'Segmented';
    if (status === 'rev') return 'Needs review';
    return 'Processing';
  }
  ```

  "Currently running" (spec 13.1's second `proc` condition) is a property of `state.running`, not of the study, so the Studies screen applies it (Task 9); `deriveStatus` stays a pure function of the record as the contract signature requires.

- [ ] Verify: `node --test test/status.test.js` → 15 pass; `node --test test/*.test.js` → all pass (measurements tests unchanged).

- [ ] Commit.

  ```
  git add renderer/data/status.js renderer/data/measurements.js test/status.test.js
  git commit -m "feat: add status derivation with one shared residual threshold"
  ```

---

## Task 2 — `renderer/data/demo-studies.js`: the nine fabricated studies, and absent rows for missing keys

**Files:** `renderer/data/demo-studies.js` (new), `renderer/data/measurements.js` (modify: per-row absence), `test/demo-studies.test.js` (new), `test/measurements.test.js` (modify)

**Interfaces:**
- Consumes: nothing at runtime. Its test imports `deriveStatus` (Task 1).
- Produces: `DEMO_STUDIES` — exactly nine `Study` objects, `source: 'demo'`, `filePath: null`, `geometry: null`, ids `SP-0030`–`SP-0042`, never written to disk. And `sagittalRows`/`lordosisRows` that mark a row absent when its value is missing or not a finite number.

The data is transcribed from the `STUDIES` array in `design-reference/template.html` (line 655). `p:[a,b,c,d,e]` maps `a → LL['L1-S1']`, `b → PI`, `c → PT`, `d → SS`; `e` is the design's precomputed PI−LL, used only to cross-check. `PI = PT + SS` holds for all nine. `L1PA` and `LL['L2-S1']`…`['L5-S1']` are not in the design data and are **omitted as keys** — never invented. `qc` carries only `{ femoral: { confidence } }` (the design's `conf` ÷ 100); the other Qc fields have no source and are left absent rather than fabricated. All nine derive to `Segmented`; the mockup's `rev`/`proc` labels were arbitrary (see the handoff's "Decisions already made", item 10).

**Why measurements.js changes here:** a demo study's `measurements` has no `L1PA` and no `LL['L2-S1']`. `sagittalRows` today sets `absent` only when `measurements` is `null`, so the L1PA row comes back `{ value: undefined, absent: false }` and `components/measurements.js`'s `formatRowValue` calls `undefined.toFixed(1)` — a TypeError inside a store subscriber, which blanks the panel with a `console.error` the moment a demo study is opened. The fix is the absent rule the contract already states for the value: a row whose value is not a finite number is absent and renders `—`.

- [ ] Write the failing tests. `test/demo-studies.test.js`: the original plan's eight tests verbatim (nine unique ids in `SP-0030..SP-0042`; `source: 'demo'` and `filePath: null`; no `L1PA` key; `LL` has `L1-S1` only; residual ≤ 0.1; `qc.femoral.confidence` in (0, 1]; every study derives `seg`; `pt`/`sex`/`age`/`dx`/`conf` present with the expected types) plus:

  ```js
  test('every demo study has null geometry and a null thumbnail (no film to show)', () => {
    for (const study of DEMO_STUDIES) {
      assert.equal(study.geometry, null);
      assert.equal(study.thumbnail, null);
    }
  });
  ```

  Add to `test/measurements.test.js`:

  ```js
  test('sagittalRows marks a row absent when its key is missing, leaving the others present', () => {
    const rows = sagittalRows({ PI: 54.1, PT: 18.3, SS: 35.8, LL: { 'L1-S1': 48.2 } });
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    assert.equal(byKey.L1PA.absent, true);
    assert.equal(byKey.L1PA.value, null);
    assert.equal(byKey.LL.absent, false);
    assert.equal(byKey.PILL.absent, false);
    assert.ok(Math.abs(byKey.PILL.value - 5.9) < 1e-9);
  });

  test('sagittalRows marks a row absent when its value is not a finite number', () => {
    const rows = sagittalRows({ PI: Number.NaN, PT: 18.3, SS: 35.8, LL: { 'L1-S1': 48.2 } });
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    assert.equal(byKey.PI.absent, true);
    assert.equal(byKey.PILL.absent, true); // derived from PI
    assert.equal(byKey.SS.absent, false);
  });

  test('lordosisRows marks a missing level absent and keeps present levels', () => {
    const rows = lordosisRows({ LL: { 'L1-S1': 48.2, 'L3-S1': 40.0 } });
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    assert.equal(byKey['L2-S1'].absent, true);
    assert.equal(byKey['L2-S1'].value, null);
    assert.equal(byKey['L3-S1'].absent, false);
    assert.equal(byKey['L3-S1'].value, 40.0);
  });
  ```

- [ ] Verify the tests fail: `node --test test/demo-studies.test.js` → module not found; `node --test test/measurements.test.js` → the three new tests fail (`absent` is `false`, `value` is `undefined`).

- [ ] In `renderer/data/measurements.js`, make absence per row. Add a helper and use it in both row builders:

  ```js
  // A row is absent when its value is missing or not a finite number. This is what lets a
  // record without a key (a demo study has no L1PA and no L2-S1..L5-S1) render "—" instead
  // of throwing undefined.toFixed inside the panel. Never turns an absent value into 0.
  function present(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }
  ```

  `sagittalValue` must tolerate a missing `LL`: `measurements.LL?.['L1-S1']`, and PILL `measurements.PI - measurements.LL?.['L1-S1']` (NaN → absent). Each row: `const value = absentAll ? null : sagittalValue(def.key, measurements); ... value: present(value) ? value : null, absent: !present(value)`. Same for `lordosisRows` (`measurements.LL?.[key]`). The six-row order, labels, `unit`, and `highlight` are unchanged.

- [ ] Implement `renderer/data/demo-studies.js` with the nine records. Per record: `id`, `source: 'demo'`, `filePath: null`, `fileName: '<id>.jpg'`, `addedAt` (noon UTC on the design's date — the exact values are listed below the table), `view`, `thumbnail: null`, `measurements: { PI, PT, SS, LL: { 'L1-S1' } }`, `geometry: null`, `qc: { femoral: { confidence } }`, `clinical: {}`, and the display fields `pt`, `sex`, `age`, `bmi`, `odi`, `dx`, `plan`, `hx`, `outcome`, `conf`. Values, verbatim from the original plan's transcription (which matches template.html line 655):

  | id | view | PI | PT | SS | LL L1-S1 | conf | pt | sex | age | bmi | odi |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | SP-0042 | Standing lateral | 54.1 | 18.3 | 35.8 | 48.2 | 96 | P-8841 | F | 62 | '27.4' | '46' |
  | SP-0041 | Flexion lateral | 48.9 | 22.6 | 26.3 | 31.7 | 88 | P-3306 | M | 57 | '31.2' | '52' |
  | SP-0039 | Standing lateral | 49.8 | 12.1 | 37.7 | 52.4 | 97 | P-7712 | F | 15 | '20.8' | '51' |
  | SP-0038 | Extension lateral | 52.3 | 29.8 | 22.5 | 24.9 | 92 | P-1054 | M | 71 | '29.6' | '58' |
  | SP-0036 | Standing lateral | 55.6 | 21.4 | 34.2 | 44.7 | 94 | P-6420 | F | 44 | '24.1' | '42' |
  | SP-0035 | Lateral lumbar | 46.2 | 25.1 | 21.1 | 27.9 | 82 | P-9013 | M | 66 | '28.3' | '49' |
  | SP-0033 | Standing lateral | 53.0 | 19.7 | 33.3 | 44.1 | 93 | P-2287 | F | 58 | '26.0' | '38' |
  | SP-0031 | Lateral lumbar | 57.1 | 10.2 | 46.9 | 58.3 | 95 | P-5561 | M | 23 | '22.5' | '29' |
  | SP-0030 | Standing lateral | 44.8 | 28.4 | 16.4 | 18.3 | 91 | P-4178 | F | 69 | '30.1' | '61' |

  `dx`/`plan`/`hx`/`outcome` strings are in the original plan text (kept in git history at `7d4ab6e`, `docs/superpowers/plans/2026-08-31-05-persistence-studies.md` Task 2) and in `design-reference/template.html` lines 656–691; transcribe them exactly, including the `·`, `–` and `→` glyphs. `bmi` and `odi` are strings, `age` and `conf` numbers, as in the design. `addedAt` is the design's date at **noon UTC** — `2026-08-21T12:10:00.000Z` for SP-0042 and `2026-08-21T12:00:00.000Z` for SP-0041 (same day, ten minutes apart so the order holds), then `2026-08-20T12:00:00.000Z`, `08-19`, `08-18`, `08-17`, `08-15`, `08-14`, `08-12`, all at `12:00:00.000Z`. Noon keeps the rendered day stable in every timezone from UTC−12 to UTC+11; the original plan's `09:00Z`/`14:00Z` rendered a different day in Honolulu and Sydney.

- [ ] Verify: `node --test test/demo-studies.test.js test/measurements.test.js` → all pass; full suite passes.

- [ ] Commit.

  ```
  git add renderer/data/demo-studies.js renderer/data/measurements.js test/demo-studies.test.js test/measurements.test.js
  git commit -m "feat: add the nine demo studies; a missing measurement key renders absent"
  ```

---

## Task 3 — `renderer/data/persistence.js`: ids, validation, merge, and the save coalescer

**Files:** `renderer/data/persistence.js` (new), `test/persistence.test.js` (new)

**Interfaces:**
- Consumes: `renderer/data/demo-studies.js` (Task 2) — `DEMO_STUDIES`.
- Produces: `STORE_VERSION`, `nextId(studies)`, `merge(realStudies)`, `validate(raw)` per the contract, plus `createStudySaver({ save, onError, disabledReason, initial })`.

Pure — no `fs`, no Electron, no DOM — safe in the browser and under `node --test`. Disk I/O is `store-io.js` (Task 4).

**What `validate` guarantees.** The draw code and the measurements panel read these shapes unguarded (a bad record now blanks a layer with a `console.error` instead of freezing the app, thanks to store subscriber isolation — but blank is still wrong):

- `measurements`: `PI`, `PT`, `SS` finite numbers; `LL` an object whose `'L1-S1'` is a finite number; `L1PA` and `LL['L2-S1']`…`['L5-S1']` each either absent or a finite number.
- `geometry`: `vertebrae.L1`…`L5` each with `superior` (2 points), `inferior` (2 points), `quadrilateral` (4 points); `s1_superior` (2 points); `l1_center` and `hip_midpoint` points; `femoral_circles` exactly two `[cx, cy, r]` with finite numbers and `r > 0`. A point is `[x, y]` with two finite numbers.

Rule: **identity fields throw, payloads are nulled.** A record whose `id`/`source`/`fileName`/`addedAt`/`view` is wrong, or a store whose `version` is not `STORE_VERSION`, throws — the caller (Task 6) then runs on demo studies only and disables saving for the session, so the file on disk is never overwritten with less than it held. A record whose `measurements` **or** `geometry` fails the shape check gets **both** set to `null` (numbers without a drawable geometry cannot be corrected, and a geometry without numbers means nothing) with one `console.warn` naming the study; its status derives to `Processing` and a re-run restores it. `qc` is passed through when it is an object, else `null`. `thumbnail` must be a `data:image/` string or becomes `null`. `filePath` a string or `null`. `clinical` an object or `{}`. Unknown keys are dropped.

- [ ] Write the failing test file `test/persistence.test.js`. Keep the original plan's cases for `STORE_VERSION`, `nextId` (empty → `SP-1000`; demo-only → `SP-1000`; out-of-order real ids → `SP-1005`; merged demo set → `SP-1000`), `merge` (real first then the nine demo in fixture order; `[]`; `undefined`), and `validate` (non-object roots throw; missing `studies` throws; missing required fields throw; `source: 'demo'` throws; defaults filled in; a fully populated study preserved — adjust that fixture so its `geometry` is a **valid** full geometry, e.g. built by a small `fullGeometry()` helper in the test, and its `measurements` `{ PI: 50, PT: 20, SS: 30, LL: { 'L1-S1': 45 } }`). Add:

  ```js
  test('validate throws when the store version is not STORE_VERSION', () => {
    assert.throws(() => validate({ version: STORE_VERSION + 1, studies: [] }), /version/);
    assert.throws(() => validate({ studies: [] }), /version/);
  });

  test('validate nulls both measurements and geometry when the geometry shape is wrong, and warns', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const raw = { version: STORE_VERSION, studies: [{ ...identity('SP-1000'),
      measurements: { PI: 50, PT: 20, SS: 30, LL: { 'L1-S1': 45 } }, geometry: { vertebrae: {} } }] };
    const [study] = validate(raw);
    assert.equal(study.measurements, null);
    assert.equal(study.geometry, null);
    assert.equal(warn.mock.callCount(), 1);
  });

  test('validate nulls both when measurements are malformed even though the geometry is fine', (t) => {
    t.mock.method(console, 'warn', () => {});
    const raw = { version: STORE_VERSION, studies: [{ ...identity('SP-1000'),
      measurements: { PI: 'fifty', PT: 20, SS: 30, LL: { 'L1-S1': 45 } }, geometry: fullGeometry() }] };
    const [study] = validate(raw);
    assert.equal(study.measurements, null);
    assert.equal(study.geometry, null);
  });

  test('validate accepts measurements with L1PA and the extra lordosis levels absent', () => {
    const raw = { version: STORE_VERSION, studies: [{ ...identity('SP-1000'),
      measurements: { PI: 50, PT: 20, SS: 30, LL: { 'L1-S1': 45 } }, geometry: fullGeometry() }] };
    const [study] = validate(raw);
    assert.deepEqual(study.measurements, raw.studies[0].measurements);
    assert.deepEqual(study.geometry, raw.studies[0].geometry);
  });

  test('validate rejects a femoral circle with a non-positive radius and a quadrilateral with three points', (t) => {
    t.mock.method(console, 'warn', () => {});
    const badRadius = fullGeometry(); badRadius.femoral_circles[1][2] = 0;
    const threePoints = fullGeometry(); threePoints.vertebrae.L3.quadrilateral.pop();
    for (const geometry of [badRadius, threePoints]) {
      const [study] = validate({ version: STORE_VERSION, studies: [{ ...identity('SP-1000'),
        measurements: { PI: 50, PT: 20, SS: 30, LL: { 'L1-S1': 45 } }, geometry }] });
      assert.equal(study.geometry, null);
    }
  });

  test('validate drops a thumbnail that is not a data:image URI and unknown keys', () => {
    const [study] = validate({ version: STORE_VERSION, studies: [{ ...identity('SP-1000'), thumbnail: 'http://x/y.jpg', sourceAvailable: true }] });
    assert.equal(study.thumbnail, null);
    assert.equal('sourceAvailable' in study, false);
  });
  ```

  where `identity(id)` returns `{ id, source: 'real', fileName: 'film.dcm', addedAt: '2026-08-31T12:00:00.000Z', view: 'Standing lateral' }` and `fullGeometry()` builds five vertebrae (each `superior`/`inferior` two points, `quadrilateral` four points), `s1_superior`, `l1_center`, `hip_midpoint`, and two circles with positive radii — plain numbers, any values.

  And for the saver:

  ```js
  import { createStudySaver } from '../renderer/data/persistence.js';

  function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

  test('createStudySaver saves only real studies when the studies reference changes', async () => {
    const calls = [];
    const saver = createStudySaver({ save: async (studies) => { calls.push(studies); }, onError: () => {} });
    const real = { id: 'SP-1000', source: 'real' };
    const demo = { id: 'SP-0042', source: 'demo' };
    saver.notify({ studies: [real, demo] });
    await saver.flush();
    assert.deepEqual(calls, [[real]]);
  });

  test('createStudySaver ignores a notification whose studies reference is unchanged', async () => {
    const calls = [];
    const studies = [{ id: 'SP-1000', source: 'real' }];
    const saver = createStudySaver({ save: async (s) => { calls.push(s); }, onError: () => {} });
    saver.notify({ studies });
    saver.notify({ studies });
    await saver.flush();
    assert.equal(calls.length, 1);
  });

  test('createStudySaver does not save the initial reference it was primed with', async () => {
    const calls = [];
    const initial = [{ id: 'SP-1000', source: 'real' }];
    const saver = createStudySaver({ save: async (s) => { calls.push(s); }, onError: () => {}, initial });
    saver.notify({ studies: initial });
    await saver.flush();
    assert.equal(calls.length, 0);
  });

  test('createStudySaver coalesces changes made while a save is in flight into one trailing save of the latest', async () => {
    const calls = [];
    const first = deferred();
    let n = 0;
    const saver = createStudySaver({ save: (s) => { calls.push(s); n += 1; return n === 1 ? first.promise : Promise.resolve(); }, onError: () => {} });
    saver.notify({ studies: [{ id: 'SP-1000', source: 'real', v: 1 }] });
    saver.notify({ studies: [{ id: 'SP-1000', source: 'real', v: 2 }] });
    saver.notify({ studies: [{ id: 'SP-1000', source: 'real', v: 3 }] });
    assert.equal(calls.length, 1);
    first.resolve();
    await saver.flush();
    assert.equal(calls.length, 2);
    assert.equal(calls[1][0].v, 3);
  });

  test('createStudySaver reports a failed save through onError and keeps working afterward', async () => {
    const errors = [];
    let fail = true;
    const saver = createStudySaver({ save: async () => { if (fail) throw new Error('disk full'); }, onError: (e) => errors.push(e.message) });
    saver.notify({ studies: [{ id: 'SP-1000', source: 'real' }] });
    await saver.flush();
    fail = false;
    saver.notify({ studies: [{ id: 'SP-1001', source: 'real' }] });
    await saver.flush();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^Could not save studies: disk full$/);
  });

  test('createStudySaver with a disabledReason never saves and reports once', async () => {
    const calls = [];
    const errors = [];
    const saver = createStudySaver({ save: async (s) => { calls.push(s); }, onError: (e) => errors.push(e.message), disabledReason: 'the store was written by a newer version' });
    saver.notify({ studies: [{ id: 'SP-1000', source: 'real' }] });
    saver.notify({ studies: [{ id: 'SP-1001', source: 'real' }] });
    await saver.flush();
    assert.equal(calls.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /not being saved/);
    assert.match(errors[0], /newer version/);
  });
  ```

- [ ] Verify the tests fail: module not found, zero tests executed.

- [ ] Implement `renderer/data/persistence.js`. `nextId` and `merge` as in the original plan (`nextId` scans `source === 'real'` ids matching `/^SP-(\d+)$/`, starts at `SP-1000`, pads to four digits). `validate(raw)`:

  ```js
  export function validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Study store is not an object.');
    if (raw.version !== STORE_VERSION) {
      throw new Error(`Study store version ${raw.version ?? 'missing'} is not supported by this build (expected ${STORE_VERSION}).`);
    }
    if (!Array.isArray(raw.studies)) throw new Error('Study store is missing a "studies" array.');
    return raw.studies.map((entry, index) => validateStudy(entry, index));
  }
  ```

  `validateStudy` throws for the identity fields as in the original plan, then normalises the payload:

  ```js
  const measurements = isValidMeasurements(entry.measurements) ? entry.measurements : null;
  const geometry = isValidGeometry(entry.geometry) ? entry.geometry : null;
  const complete = measurements !== null && geometry !== null;
  if (!complete && (entry.measurements != null || entry.geometry != null)) {
    console.warn(`persistence: ${entry.id} has a malformed measurements/geometry payload; it will need to be re-run.`);
  }
  return {
    id: entry.id, source: 'real',
    filePath: typeof entry.filePath === 'string' ? entry.filePath : null,
    fileName: entry.fileName, addedAt: entry.addedAt, view: entry.view,
    thumbnail: typeof entry.thumbnail === 'string' && entry.thumbnail.startsWith('data:image/') ? entry.thumbnail : null,
    measurements: complete ? measurements : null,
    geometry: complete ? geometry : null,
    qc: entry.qc && typeof entry.qc === 'object' ? entry.qc : null,
    clinical: entry.clinical && typeof entry.clinical === 'object' && !Array.isArray(entry.clinical) ? entry.clinical : {},
  };
  ```

  `isValidMeasurements` and `isValidGeometry` implement the shapes listed above (helpers `finite(n)`, `point(p)`, `points(list, n)`). Export nothing beyond the contract's four names plus `createStudySaver`.

  `createStudySaver({ save, onError, disabledReason = null, initial = null })`:

  ```js
  // Save-on-change with coalescing: one save in flight at a time; changes that arrive meanwhile
  // collapse into one trailing save of the latest list. No timers, so the last change before quit
  // is written as soon as the previous write finishes. Demo studies are filtered out here, so the
  // main process never sees them.
  export function createStudySaver({ save, onError, disabledReason = null, initial = null }) {
    let lastSeen = initial;
    let latest = null;      // the real studies waiting to be written, or null
    let inFlight = null;    // the promise of the write loop, or null
    let reported = false;

    async function drain() {
      while (latest !== null) {
        const batch = latest;
        latest = null;
        try { await save(batch); } catch (error) { onError(new Error(`Could not save studies: ${error.message}`)); }
      }
      inFlight = null;
    }

    function notify(state) {
      if (state.studies === lastSeen) return;
      lastSeen = state.studies;
      if (disabledReason) {
        if (!reported) { reported = true; onError(new Error(`Studies are not being saved: ${disabledReason}`)); }
        return;
      }
      latest = state.studies.filter((study) => study.source === 'real');
      if (!inFlight) inFlight = drain();
    }

    const flush = () => inFlight ?? Promise.resolve();
    return { notify, flush };
  }
  ```

  `notify` is called from inside a store notification (Task 6), so it must never call `setState`. Every `onError` receives an Error whose message is display-ready (`Could not save studies: <cause>` or `Studies are not being saved: <reason>`); the disabled-reason report is the one synchronous `onError`, so Task 6 defers its toast with `queueMicrotask`. Accepted limitation, to be stated in the module comment: there is no flush at quit, so a change committed and the window closed inside the same write cycle (two sub-millisecond writes) loses the trailing write.

- [ ] Verify: `node --test test/persistence.test.js` → all pass, output pristine (the warn mock keeps the console clean); full suite passes.

- [ ] Commit.

  ```
  git add renderer/data/persistence.js test/persistence.test.js
  git commit -m "feat: study ids, shape validation, demo/real merge, and the save coalescer (data/persistence.js)"
  ```

---

## Task 4 — `store-io.js`: atomic JSON I/O with corrupt-store recovery, in both allowlists

**Files:** `store-io.js` (new, repo root, **CommonJS**), `test/store-io.test.js` (new), `package.json` (modify: `build.files`), `electron-builder.preview.yml` (modify: `files`)

**Interfaces:**
- Consumes: `node:fs/promises`, `node:path`.
- Produces: `STORE_VERSION`, `isValidStoreShape(parsed)`, `readStudyStore(storePath) → Promise<{version, studies}>`, `writeStudyStore(storePath, studies)`, `readJsonOrNull(path)`, `writeJsonAtomic(path, value)`.

This file lives at the repo root next to `main.js` — the one place in the persistence stack that touches `node:fs`. The root is CommonJS (`package.json` has no `"type"`), so this file uses `require`/`module.exports`; `main.js` requires it. The ESM test imports its named exports, which Node resolves from the `module.exports = { … }` object literal. `STORE_VERSION` mirrors `renderer/data/persistence.js`'s; the test cross-checks they stay equal.

- [ ] Write the failing test file `test/store-io.test.js`. Its imports are `import { test, after } from 'node:test';`, `import assert from 'node:assert/strict';`, `import { mkdtemp, readFile, writeFile, access, readdir, rm } from 'node:fs/promises';`, `import path from 'node:path';`, `import os from 'node:os';`, and `import { STORE_VERSION, readStudyStore, writeStudyStore, readJsonOrNull, writeJsonAtomic } from '../store-io.js';` (the original plan's cases obtained `writeFile` through a dynamic import inside one test; import it statically instead). Adapt the original plan's eight cases to the object-returning `readStudyStore` (a missing file → `{ version: STORE_VERSION, studies: [] }`; round-trip → `loaded.studies` deep-equals what was written and `loaded.version === STORE_VERSION`; the on-disk JSON carries `version`; no `.tmp` left behind; an unparseable file is quarantined as `studies.json.corrupt-<timestamp>` with its bytes intact and replaced by a fresh empty store; well-formed JSON of the wrong shape is quarantined; a root array is quarantined). Add:

  ```js
  test('readStudyStore passes an unknown version through untouched (the renderer decides)', async () => {
    const storePath = await tempStorePath();
    await writeFile(storePath, JSON.stringify({ version: 99, studies: [] }), 'utf8');
    const loaded = await readStudyStore(storePath);
    assert.equal(loaded.version, 99);
    const entries = await readdir(path.dirname(storePath));
    assert.equal(entries.some((name) => name.includes('corrupt')), false);
  });

  test('writeJsonAtomic creates missing parent directories and readJsonOrNull round-trips', async () => {
    const dir = await tempDir('spine-contour-json-');
    const file = path.join(dir, 'predictions', 'SP-1000.json');
    await writeJsonAtomic(file, { hello: 'world' });
    assert.deepEqual(await readJsonOrNull(file), { hello: 'world' });
    const tmpLeft = await access(`${file}.tmp`).then(() => true).catch(() => false);
    assert.equal(tmpLeft, false);
  });

  test('readJsonOrNull is null for a missing file and for unparseable JSON, without quarantining', async () => {
    const dir = await tempDir('spine-contour-json-');
    const file = path.join(dir, 'x.json');
    assert.equal(await readJsonOrNull(file), null);
    await writeFile(file, '{ nope', 'utf8');
    assert.equal(await readJsonOrNull(file), null);
    assert.deepEqual((await readdir(dir)), ['x.json']);
  });
  ```

  One helper creates every temp directory: `async function tempDir(prefix) { const dir = await mkdtemp(path.join(os.tmpdir(), prefix)); dirs.push(dir); return dir; }` over a module-level `const dirs = [];`. `tempStorePath()` calls `tempDir('spine-contour-store-')` and the two JSON tests call it directly, and an `after(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); })` hook removes them all, so runs leave nothing under the temp folder.

- [ ] Verify the tests fail: `Cannot find module '../store-io.js'`, zero tests executed.

- [ ] Implement `store-io.js` (CommonJS):

  ```js
  /**
   * Atomic JSON read/write for the study store and the per-study prediction sidecars, with
   * corrupt-store recovery (spec 13, 13.1). Deliberately outside renderer/ — the only file in
   * the persistence stack that touches node:fs — and CommonJS, because the repo root is
   * CommonJS and main.js requires it. Mirrors renderer/data/persistence.js's STORE_VERSION;
   * test/store-io.test.js asserts they stay equal.
   */
  const { readFile, writeFile, rename, mkdir } = require('node:fs/promises');
  const path = require('node:path');

  const STORE_VERSION = 1;

  function isValidStoreShape(parsed) {
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.studies);
  }

  // Write to <path>.tmp then rename over the target, so a crash mid-write leaves the previous
  // file intact. rename() replaces an existing file on Windows as well as POSIX.
  async function writeJsonAtomic(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmpPath, filePath);
  }

  // Missing or unparseable → null. No quarantine: a sidecar is derived data that a re-run recreates.
  async function readJsonOrNull(filePath) {
    let raw;
    try { raw = await readFile(filePath, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try { return JSON.parse(raw); } catch (_error) { return null; }
  }

  function writeStudyStore(storePath, studies) {
    return writeJsonAtomic(storePath, { version: STORE_VERSION, studies });
  }

  // The store as parsed. A missing file is an empty store. An unparseable file, or JSON without a
  // studies array, is renamed aside to <storePath>.corrupt-<timestamp> and replaced with an empty
  // store rather than crashing the caller. `version` is passed through untouched: a store written
  // by a newer build is shape-valid, and the renderer refuses it without overwriting it.
  async function readStudyStore(storePath) {
    let raw;
    try { raw = await readFile(storePath, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return { version: STORE_VERSION, studies: [] };
      throw error;
    }
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_error) { parsed = null; }
    if (!isValidStoreShape(parsed)) {
      await rename(storePath, `${storePath}.corrupt-${Date.now()}`);
      await writeStudyStore(storePath, []);
      return { version: STORE_VERSION, studies: [] };
    }
    return parsed;
  }

  module.exports = { STORE_VERSION, isValidStoreShape, readStudyStore, writeStudyStore, readJsonOrNull, writeJsonAtomic };
  ```

- [ ] Add `"store-io.js"` to `package.json` `build.files` (after `"preload.js"`) **and** to `electron-builder.preview.yml` `files:` in the same position. Confirm the two lists are identical by running the same comparison `.github/workflows/windows-preview.yml` runs (the inline node script at its lines 140–162); expected: `OK: allowlists match`.

- [ ] Verify: `node --test test/store-io.test.js` → 11 pass; full suite passes.

- [ ] Commit.

  ```
  git add store-io.js test/store-io.test.js package.json electron-builder.preview.yml
  git commit -m "feat: atomic study-store and sidecar I/O with corrupt-store recovery (store-io.js)"
  ```

---

## Task 5 — IPC, preload, and `renderer/api.js`: the study store, prediction sidecars, file bytes

**Files:** `main.js` (modify), `preload.js` (modify), `renderer/api.js` (modify), `test/api.test.js` (modify)

**Interfaces:**
- Consumes: `store-io.js` (Task 4); `renderer/data/persistence.js` (Task 3) — `validate`; Electron `webUtils` (preload).
- Produces: IPC channels `load-studies`, `save-studies`, `load-prediction`, `save-prediction`, `read-file`; bridge functions `loadStudies`, `saveStudies`, `loadPrediction`, `savePrediction`, `readFile`, `pathForFile`; `renderer/api.js` wrappers of the same names (`loadStudies` returns **validated** `Study[]`; `pathForFile` is synchronous) plus `disablePersistence(reason)` and `persistenceDisabledReason()`; after `disablePersistence`, `saveStudies` and `savePrediction` reject without touching the bridge. `main.js` honours `SPINE_CONTOUR_USER_DATA` in development.

  The disabled-persistence test must run last in `test/api.test.js` or in its own file (`test/api-persistence.test.js`): `disablePersistence` is module state and there is no re-enable — by design, since a session that refused its store must never start writing later.

Paths: `studies.json` and `predictions/<id>.json` both live under `app.getPath('userData')`. In development that is `%APPDATA%\spine-contour`; the production build's `productName` gives `%APPDATA%\Spine-Contour`, which on Windows' case-insensitive filesystem is the **same directory** — a development run and a future production install share one store. The preview build (`Spine-Contour Preview`) has its own. Smoke runs use the env override so they never touch either.

- [ ] Modify `preload.js`:

  ```js
  const { contextBridge, ipcRenderer, webUtils } = require('electron');

  contextBridge.exposeInMainWorld('spineContour', {
    selectFile: () => ipcRenderer.invoke('select-file'),
    predict: (request) => ipcRenderer.invoke('predict', request),
    measure: (geometry) => ipcRenderer.invoke('measure', geometry),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    saveCsv: (request) => ipcRenderer.invoke('save-csv', request),
    loadStudies: () => ipcRenderer.invoke('load-studies'),
    saveStudies: (studies) => ipcRenderer.invoke('save-studies', studies),
    loadPrediction: (id) => ipcRenderer.invoke('load-prediction', id),
    savePrediction: (id, response) => ipcRenderer.invoke('save-prediction', id, response),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    // Electron >= 32 removed File.path; this is the sanctioned replacement, and File objects
    // cross the context bridge. Used by the Studies dropzone so a dropped film keeps a real path.
    pathForFile: (file) => webUtils.getPathForFile(file),
  });
  ```

- [ ] Modify `main.js`. Near the other requires:

  ```js
  const { readStudyStore, writeStudyStore, readJsonOrNull, writeJsonAtomic } = require('./store-io.js');
  ```

  Immediately after `APP_TITLE` is defined (before anything reads `userData`):

  ```js
  // Development only: point a run at a scratch profile so smoke runs never write into the
  // developer's real studies.json. Ignored in packaged builds. setPath throws on a directory
  // that does not exist, so create it first.
  if (!app.isPackaged && process.env.SPINE_CONTOUR_USER_DATA) {
    fs.mkdirSync(process.env.SPINE_CONTOUR_USER_DATA, { recursive: true });
    app.setPath('userData', process.env.SPINE_CONTOUR_USER_DATA);
  }

  const REAL_STUDY_ID = /^SP-\d{4,}$/;

  function storePath() {
    return path.join(app.getPath('userData'), 'studies.json');
  }

  // Sidecar ids come from the renderer; the pattern check keeps them inside predictions/, and
  // the range check keeps demo ids (SP-0030..SP-0042, which have no film) out of it.
  function predictionPath(id) {
    if (typeof id !== 'string' || !REAL_STUDY_ID.test(id) || Number(id.slice(3)) < 1000) {
      throw new Error('Invalid study id.');
    }
    return path.join(app.getPath('userData'), 'predictions', `${id}.json`);
  }
  ```

  Handlers, next to the existing ones:

  ```js
  ipcMain.handle('load-studies', () => readStudyStore(storePath()));

  ipcMain.handle('save-studies', async (_event, studies) => {
    if (!Array.isArray(studies)) throw new Error('Nothing to save.');
    await writeStudyStore(storePath(), studies);
  });

  ipcMain.handle('load-prediction', (_event, id) => readJsonOrNull(predictionPath(id)));

  ipcMain.handle('save-prediction', async (_event, id, response) => {
    if (!response || typeof response !== 'object') throw new Error('Nothing to save.');
    await writeJsonAtomic(predictionPath(id), response);
  });

  // The film bytes for a persisted study. Resolves null when the file is gone — that is an
  // outcome the renderer handles (relocate), not an error. Other failures throw.
  ipcMain.handle('read-file', async (_event, filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0) return null;
    if (!fs.existsSync(filePath)) return null;
    const stat = await fsPromises.stat(filePath);
    if (stat.size > MAX_UPLOAD_BYTES) throw new Error('The file exceeds 50 MB.');
    return fsPromises.readFile(filePath);
  });
  ```

- [ ] Modify `renderer/api.js`. Let `invoke` forward every argument (`async function invoke(channel, ...args)` → `bridge[channel](...args)`), import `validate`, and add:

  ```js
  import { validate } from './data/persistence.js';

  // Set once, by the bootstrap, when the store on disk could not be loaded (a newer version, a
  // record with a broken identity). From then on NOTHING is written for the session -- not
  // studies.json and not a prediction sidecar -- because nextId() restarts at SP-1000 over a
  // library it cannot see, and a sidecar write would replace another study's film.
  let disabledReason = null;

  export function disablePersistence(reason) {
    disabledReason = reason;
  }

  // The reason persistence is off this session, or null. Callers that would otherwise report a
  // rejected write can say the plain thing instead of nesting three messages.
  export function persistenceDisabledReason() {
    return disabledReason;
  }

  function assertWritable() {
    if (disabledReason) throw new Error(`Studies are not being saved: ${disabledReason}`);
  }

  // The raw store crosses the bridge; validation happens here so every caller receives
  // Study[] with the shapes the viewer and panel read unguarded. A throw from validate is
  // display-ready and deliberately NOT wrapped: it is not an IPC failure.
  export async function loadStudies() {
    return validate(await invoke('loadStudies'));
  }

  export async function saveStudies(studies) {
    assertWritable();
    return invoke('saveStudies', studies);
  }

  export async function loadPrediction(id) {
    return invoke('loadPrediction', id);
  }

  export async function savePrediction(id, response) {
    assertWritable();
    return invoke('savePrediction', id, response);
  }

  // Uint8Array of the file's bytes, or null when the file no longer exists.
  export async function readFile(filePath) {
    const bytes = await invoke('readFile', filePath);
    return bytes == null ? null : bytes;
  }

  // Synchronous: the absolute path of a dropped File, or null when the bridge cannot provide
  // one (an unavailable webUtils, an empty path). A null path never blocks a drop.
  export function pathForFile(file) {
    const bridge = getBridge();
    if (!bridge || typeof bridge.pathForFile !== 'function') return null;
    try {
      const filePath = bridge.pathForFile(file);
      return typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
    } catch (_error) {
      return null;
    }
  }
  ```

- [ ] Add to `test/api.test.js` (using its existing `withWindow` helper):

  ```js
  import { loadStudies, readFile, pathForFile } from '../renderer/api.js';

  const IDENTITY = { id: 'SP-1000', source: 'real', fileName: 'film.dcm', addedAt: '2026-08-31T12:00:00.000Z', view: 'Standing lateral' };

  test('loadStudies validates the raw store the bridge returns and fills in defaults', async () => {
    await withWindow({ spineContour: { loadStudies: async () => ({ version: 1, studies: [IDENTITY] }) } }, async () => {
      const studies = await loadStudies();
      assert.equal(studies.length, 1);
      assert.equal(studies[0].measurements, null);
      assert.deepEqual(studies[0].clinical, {});
    });
  });

  test('loadStudies rejects with a display-ready message when the store is not usable', async () => {
    await withWindow({ spineContour: { loadStudies: async () => ({ version: 2, studies: [] }) } }, async () => {
      await assert.rejects(loadStudies(), /version 2 is not supported/);
    });
    await withWindow({ spineContour: { loadStudies: async () => [] } }, async () => {
      await assert.rejects(loadStudies(), /not an object/);
    });
  });

  test('after disablePersistence, saveStudies and savePrediction reject without touching the bridge', async () => {
    const { disablePersistence, persistenceDisabledReason, saveStudies, savePrediction } = await import('../renderer/api.js');
    let touched = 0;
    await withWindow({ spineContour: { saveStudies: async () => { touched += 1; }, savePrediction: async () => { touched += 1; } } }, async () => {
      assert.equal(persistenceDisabledReason(), null);
      disablePersistence('the store was written by a newer version');
      assert.equal(persistenceDisabledReason(), 'the store was written by a newer version');
      await assert.rejects(saveStudies([]), /not being saved: the store was written by a newer version/);
      await assert.rejects(savePrediction('SP-1000', {}), /not being saved/);
      assert.equal(touched, 0);
    });
  });

  test('readFile passes a null (missing file) through as null', async () => {
    await withWindow({ spineContour: { readFile: async () => null } }, async () => {
      assert.equal(await readFile('C:/missing.dcm'), null);
    });
  });

  test('pathForFile returns the bridge path, and null for a missing bridge, an empty path, or a throw', async () => {
    await withWindow({ spineContour: { pathForFile: () => 'C:/films/a.dcm' } }, async () => { assert.equal(pathForFile({}), 'C:/films/a.dcm'); });
    await withWindow({ spineContour: { pathForFile: () => '' } }, async () => { assert.equal(pathForFile({}), null); });
    await withWindow({ spineContour: { pathForFile: () => { throw new Error('nope'); } } }, async () => { assert.equal(pathForFile({}), null); });
    await withWindow({}, async () => { assert.equal(pathForFile({}), null); });
  });
  ```

- [ ] Verify: `node --test test/api.test.js` → all pass; full suite passes.

- [ ] CONTROLLER VERIFICATION over CDP (no user gate): on a scratch profile, `window.spineContour.loadStudies()` → `{version: 1, studies: []}`; `saveStudies([record])` then `loadStudies()` → the record; `loadPrediction('SP-1000')` → `null`; `savePrediction('SP-1000', {a: 1})` then `loadPrediction` → `{a: 1}`; `loadPrediction('../x')` rejects; `readFile('C:/does/not/exist.dcm')` → `null`; `readFile(<absolute path of design-reference/design_src/13462cd9-a59f-4aab-9256-cbd723fb978c.jpg>)` → a `Uint8Array` of 7059 bytes. Corrupt-store recovery: quit, overwrite the scratch profile's `studies.json` with `not json at all`, relaunch, `loadStudies()` → empty store and a `studies.json.corrupt-<n>` file beside a fresh `studies.json`.

- [ ] Commit.

  ```
  git add main.js preload.js renderer/api.js test/api.test.js
  git commit -m "feat: IPC for the study store, prediction sidecars, and film bytes"
  ```

---

## Task 6 — Bootstrap: load studies before the first paint, save on change, guard stray drops

**Files:** `renderer/main.js` (modify)

**Interfaces:**
- Consumes: `renderer/api.js` (Task 5) — `loadStudies`, `saveStudies`; `renderer/data/persistence.js` (Task 3) — `merge`, `createStudySaver`; `renderer/components/toast.js` — `showToast`; `renderer/store.js`.
- Produces: `state.studies` populated with real + demo studies before the first render; a store subscriber that persists every change to the real studies; document-level drag/drop guards.

Per the contract, `renderer/main.js` is exactly "bootstrap: load studies, mount, subscribe". Loading happens **before** the first paint (top-level `await` in the module), so `nextId()` and the Studies list see the persisted records from the first frame — a film chosen before the load resolved could otherwise take an id the store already holds.

- [ ] Replace `renderer/main.js` with:

  ```js
  import { getState, setState, subscribe } from './store.js';
  import { renderRoute } from './router.js';
  import { loadStudies, saveStudies, disablePersistence } from './api.js';
  import { merge, createStudySaver } from './data/persistence.js';
  import { showToast } from './components/toast.js';

  const root = document.querySelector('#app');

  function applyTheme(state) {
    document.body.toggleAttribute('data-dark', state.theme === 'dark');
  }

  function render(state) {
    applyTheme(state);
    renderRoute(root, state);
  }

  // Load before the first paint. A store that cannot be read (a newer version, a record with a
  // broken identity) is left exactly as it is on disk: the app runs on the demo studies and
  // persistence is disabled for the session -- the saver reports once, and every later
  // saveStudies/savePrediction rejects -- so nothing on disk is overwritten with less than it held.
  let loadError = null;
  let real = [];
  try {
    real = await loadStudies();
  } catch (error) {
    loadError = error;
    disablePersistence(error.message);
  }
  const studies = merge(real);
  setState({ studies });

  const saver = createStudySaver({
    save: saveStudies,
    initial: studies,
    disabledReason: loadError ? loadError.message : null,
    // notify() runs inside a store notification, where setState is forbidden; the toast is
    // deferred one microtask so it never re-enters the store.
    onError: (error) => queueMicrotask(() => showToast(error.message)),
  });
  subscribe(saver.notify);
  subscribe(render);
  render(getState());
  if (loadError) showToast(`Saved studies could not be loaded: ${loadError.message}`);

  // A film dropped anywhere but the Studies dropzone would navigate the window to that file.
  // The dropzone handles its own drop first (target phase); these catch everything else.
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => event.preventDefault());
  ```

  Ordering note (mirrors `screens/analysis.js`'s): the screen modules' module-scope subscriptions are registered at import time, before this module's body runs, so on every `setState` they run first, then the saver, then the router. The saver never touches the DOM or the store, so its position only has to be before `render` for the record to be written before the frame that shows it.

- [ ] No unit test: this module is the bootstrap and has no pure logic of its own (the saver's is tested in Task 3). Verify with the full suite still green and the controller's CDP check.

- [ ] CONTROLLER VERIFICATION over CDP: fresh scratch profile → `getState().studies.length === 9`, all `source: 'demo'`; `setState` a real study into `studies` (new array) → `window.spineContour.loadStudies()` within 500 ms shows it; quit, relaunch with `SMOKE_KEEP_PROFILE=1` → `studies.length === 10` and the real one first. Load-failure path: write `{ "version": 2, "studies": [] }` to the profile's `studies.json`, relaunch → the toast text mentions `version 2`, `studies.length === 9`, and after `setState` with a new real study the file on disk is **unchanged** (still version 2), a second toast says studies are not being saved, and `import('./renderer/api.js').then((m) => m.savePrediction('SP-1000', {}))` rejects with the same message (so a run in this session cannot overwrite a sidecar either).

- [ ] Commit.

  ```
  git add renderer/main.js
  git commit -m "feat: load persisted studies before the first paint and save them on change"
  ```

---

## Task 7 — Studies screen: summary, search, table, status and DEMO pills, dropzone with browse and drop

**Files:** `renderer/screens/studies.js` (rewrite), `styles/screens/studies.css` (modify), `styles/components.css` (modify), `test/studies.test.js` (new), `tools/smoke/smoke-studies.mjs` (new)

**Interfaces:**
- Consumes: `renderer/store.js` — `getState`, `setState`, `subscribe`; `renderer/dom.js` — `el`, `mount`; `renderer/data/status.js` (Task 1) — `deriveStatus`, `statusLabel`; `renderer/data/persistence.js` (Task 3) — `nextId`; `renderer/api.js` (Task 5) — `selectFile`, `pathForFile`; `renderer/components/toast.js` — `showToast`; `renderer/screens/analysis.js` — `setFilePayload`.
- Produces: `render(state) → HTMLElement`; exported for tests: `formatDate(iso)`, `matchesQuery(study, query)`, `newStudy({id, fileName, filePath})`. A module-scope subscription that updates the summary and the table in place while the screen is mounted.

**Why in-place updates:** `router.js` remounts the screen host only for `SCREEN_KEYS = ['screen','ack']`, and that set must not grow — `query` changes per keystroke (a remount would rebuild the input and move the caret) and `studies` changes on every `/measure` result. So `render()` builds the shell once per navigation and keeps references to the summary node and the table host; a module-scope `subscribe` (the `screens/analysis.js` pattern) rebuilds only those when `studies` or `query` changes. The search input is never rebuilt while the screen is up.

**Why one `addStudy`:** the picker and a drop both produce `{name, data, path}`; each becomes an **unsegmented** real study, its bytes parked in `filePayloads`, and the app navigates to Analysis where the run card starts `/predict` — the plan-03 flow the user verified, with the store subscriber (Task 6) persisting the new record. New studies go at the **front** of the list (real first, newest first).

- [ ] Write the failing test file `test/studies.test.js`:

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { formatDate, matchesQuery, newStudy } from '../renderer/screens/studies.js';

  test('formatDate renders a short month/day/year', () => {
    // Noon UTC renders as the same calendar day from UTC-12 to UTC+11, so this holds on the
    // developer's machine and on CI alike.
    assert.equal(formatDate('2026-08-21T12:00:00.000Z'), 'Aug 21, 2026');
  });

  test('formatDate renders an em dash for a missing or invalid date', () => {
    assert.equal(formatDate(null), '\u2014');
    assert.equal(formatDate(undefined), '\u2014');
    assert.equal(formatDate('not a date'), '\u2014');
  });

  test('matchesQuery matches on id, patient, diagnosis, and view, case-insensitively', () => {
    const study = { id: 'SP-0042', pt: 'P-8841', dx: 'Anterior slip of L4 on L5', view: 'Standing lateral' };
    assert.equal(matchesQuery(study, 'sp-0042'), true);
    assert.equal(matchesQuery(study, 'p-8841'), true);
    assert.equal(matchesQuery(study, 'anterior slip'), true);
    assert.equal(matchesQuery(study, 'standing'), true);
    assert.equal(matchesQuery(study, 'flexion'), false);
  });

  test('matchesQuery tolerates studies with no patient or diagnosis fields', () => {
    const study = { id: 'SP-1000', view: 'Standing lateral' };
    assert.equal(matchesQuery(study, 'sp-1000'), true);
    assert.equal(matchesQuery(study, 'nonexistent'), false);
  });

  test('matchesQuery treats an empty query as matching everything', () => {
    assert.equal(matchesQuery({ id: 'SP-1000', view: 'Standing lateral' }, ''), true);
  });

  test('newStudy builds an unsegmented real study with nulls, never zeros', () => {
    const study = newStudy({ id: 'SP-1000', fileName: 'film.dcm', filePath: 'C:/films/film.dcm' });
    assert.equal(study.id, 'SP-1000');
    assert.equal(study.source, 'real');
    assert.equal(study.fileName, 'film.dcm');
    assert.equal(study.filePath, 'C:/films/film.dcm');
    assert.equal(study.view, 'Standing lateral');
    assert.equal(study.thumbnail, null);
    assert.equal(study.measurements, null);
    assert.equal(study.geometry, null);
    assert.equal(study.qc, null);
    assert.deepEqual(study.clinical, {});
    assert.ok(!Number.isNaN(new Date(study.addedAt).getTime()));
  });

  test('newStudy stores a missing path as null', () => {
    assert.equal(newStudy({ id: 'SP-1001', fileName: 'a.png', filePath: undefined }).filePath, null);
  });
  ```

- [ ] Verify the tests fail: `node --test test/studies.test.js` → `does not provide an export named 'formatDate'`.

- [ ] Rewrite `renderer/screens/studies.js`:

  ```js
  /**
   * Studies screen (spec 9.4). Heading, the {n} STUDIES · {m} IN QUEUE summary, search, the
   * dropzone (click, drop, Choose radiograph), and the table with derived status pills and the DEMO
   * pill. render(state) builds the shell; the summary and table update in place from a
   * module-scope subscription, because router.js remounts this host only on screen/ack.
   */

  import { el, mount } from '../dom.js';
  import { getState, setState, subscribe } from '../store.js';
  import { selectFile, pathForFile } from '../api.js';
  import { showToast } from '../components/toast.js';
  import { deriveStatus, statusLabel } from '../data/status.js';
  import { nextId } from '../data/persistence.js';
  import { setFilePayload } from './analysis.js';

  const UPLOAD_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16 V4"></path><path d="M7.5 8.5 L12 4 L16.5 8.5"></path><path d="M4.5 19.5 H19.5"></path></svg>';

  // Spec 9.4: lordosis switches to the accent colour at >= 40 degrees.
  const LORDOSIS_ACCENT_DEGREES = 40;

  const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  export function formatDate(iso) {
    if (!iso) return '\u2014';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '\u2014';
    return dateFormatter.format(date);
  }

  // Case-insensitive substring match over id, patient, diagnosis and view. Normalises the query
  // itself, so the export is safe to call with raw input.
  export function matchesQuery(study, query) {
    const needle = (query ?? '').trim().toLowerCase();
    if (!needle) return true;
    return [study.id, study.pt, study.dx, study.view]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLowerCase()
      .includes(needle);
  }

  // An unsegmented real Study. Bytes are NOT on the record (screens/analysis.js's payload map);
  // measurements, geometry, qc and thumbnail arrive when the run completes.
  export function newStudy({ id, fileName, filePath }) {
    return {
      id, source: 'real', filePath: filePath ?? null, fileName,
      addedAt: new Date().toISOString(), view: 'Standing lateral', thumbnail: null,
      measurements: null, geometry: null, qc: null, clinical: {},
    };
  }

  // Every path that changes openId resets the per-study view state, so a study never inherits
  // the previous one's zoom, pan, selection or edit mode (handoff item 6).
  const FRESH_VIEW = { selectedLevel: null, zoom: 1, panX: 0, panY: 0, panMode: false, editing: false, selection: null };

  function openStudy(study) {
    setState({ screen: 'analysis', openId: study.id, ...FRESH_VIEW });
  }

  // The one entry point for the picker and a drop. Inserts at the front.
  function addStudy({ name, data, path }) {
    const id = nextId(getState().studies);
    setFilePayload(id, data);
    setState((state) => ({
      studies: [newStudy({ id, fileName: name, filePath: path ?? null }), ...state.studies],
      openId: id,
      screen: 'analysis',
      ...FRESH_VIEW,
    }));
  }

  async function handleChoose() {
    try {
      const chosen = await selectFile();
      if (!chosen) return;
      addStudy(chosen);
    } catch (error) {
      showToast(`Could not open file: ${error.message}`);
    }
  }

  // The same extensions the native picker offers (main.js's select-file filter).
  const FILM_EXTENSIONS = /\.(dcm|dicom|png|jpe?g|tiff?|bmp)$/i;

  async function handleDrop(files) {
    if (files.length > 1) {
      showToast('Drop one film at a time.');
      return;
    }
    const file = files[0];
    if (!FILM_EXTENSIONS.test(file.name)) {
      showToast(`${file.name} is not a radiograph file type.`);
      return;
    }
    try {
      const path = pathForFile(file);
      const buffer = await file.arrayBuffer();
      addStudy({ name: file.name, data: new Uint8Array(buffer), path });
    } catch (error) {
      showToast(`Could not open file: ${error.message}`);
    }
  }
  ```

  The dropzone keeps the existing `.dropzone*` markup, copy, and `Choose radiograph` button (plan 03's affordance; the design's `Use sample film` button is not built because no radiograph ships with the app). The whole zone is also the click-to-browse control (spec 9.4: "Drop and click both accept files"), keyboard-reachable through `tabindex` and an `aria-label` (no `role="button"` — it contains a real button, and nested interactive content inside a button role is invalid ARIA); the button stops propagation so one click opens one picker, not two; the zone's own keydown ignores keys that came from the button:

  ```js
  function dropzone() {
    const chooseButton = el('button', {
      type: 'button', class: 'btn btn-primary btn-small',
      onClick: (event) => { event.stopPropagation(); handleChoose(); },
    }, 'Choose radiograph');
    const zone = el('div', {
      class: 'dropzone dropzone-clickable', tabindex: '0', 'aria-label': 'Choose a radiograph, or drop one here',
      onClick: () => handleChoose(),
      onKeydown: (event) => {
        if (event.target !== zone) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleChoose(); }
      },
    },
      el('div', { class: 'dropzone-icon', innerHTML: UPLOAD_SVG }),
      el('div', { class: 'dropzone-text' },
        el('div', { class: 'dropzone-title' }, 'Drop a DICOM series or lateral radiograph'),
        el('div', { class: 'dropzone-subtitle' }, 'De-identified files only. Segmentation runs locally on the workstation.')),
      chooseButton);
    zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('dropzone-active'); });
    // dragleave also fires when the pointer crosses onto a child; the next dragover re-adds the
    // class, so the flicker is one frame and accepted.
    zone.addEventListener('dragleave', () => zone.classList.remove('dropzone-active'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('dropzone-active');
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) handleDrop(files);
    });
    return zone;
  }
  ```

  The table (columns per spec 9.4; the status pill is `components.css`'s `.badge` with a status variant; the DEMO pill is `.pill-demo`; rows are keyboard-reachable buttons in all but tag):

  ```js
  function statusBadge(status) {
    return el('span', { class: `badge badge-${status}` }, el('span', { class: 'dot' }), statusLabel(status));
  }

  function buildRow(study) {
    const status = deriveStatus(study);
    const lordosis = study.measurements?.LL?.['L1-S1'];
    const hasLordosis = typeof lordosis === 'number' && Number.isFinite(lordosis);
    const patientChildren = [study.pt || '\u2014'];
    if (study.source === 'demo') patientChildren.push(el('span', { class: 'pill-demo' }, 'DEMO'));
    return el('div', {
      class: 'studies-row', role: 'button', tabindex: '0', 'data-study-id': study.id,
      onClick: () => openStudy(study),
      onKeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openStudy(study); } },
    },
      el('div', { class: 'studies-cell-id' }, study.id),
      el('div', { class: 'studies-cell-patient' }, ...patientChildren),
      el('div', { class: 'studies-cell-view' }, study.view || '\u2014'),
      el('div', { class: 'studies-cell-date' }, formatDate(study.addedAt)),
      el('div', {}, statusBadge(status)),
      el('div', { class: hasLordosis && lordosis >= LORDOSIS_ACCENT_DEGREES ? 'studies-lordosis studies-lordosis-high' : 'studies-lordosis' },
        hasLordosis ? `${Math.round(lordosis)}\u00B0` : '\u2014'));
  }

  function buildTable(studies) {
    // An explicit arrow, not `studies.map(buildRow)`: map passes the index as the second
    // argument, and Task 9 gives buildRow a second parameter.
    const body = studies.length > 0
      ? studies.map((study) => buildRow(study))
      : [el('div', { class: 'studies-empty' }, 'No studies match that search.')];
    return el('div', { class: 'studies-table card' },
      el('div', { class: 'studies-table-head' },
        el('div', {}, 'STUDY ID'), el('div', {}, 'PATIENT'), el('div', {}, 'VIEW'),
        el('div', {}, 'DATE'), el('div', {}, 'STATUS'), el('div', { class: 'studies-col-lordosis' }, 'LORDOSIS')),
      ...body);
  }
  ```

  The shell, the in-place update, and the subscription:

  ```js
  function sameKey(a, b) {
    return a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);
  }

  // The live mount, or null when this screen is not on screen. See screens/analysis.js for why
  // the subscription is module-scope and registered once: render() runs on every navigation.
  let mounted = null;

  subscribe((state) => {
    if (state.screen !== 'studies') { mounted = null; return; }
    if (mounted) mounted.update(state);
  });

  export function render(state) {
    const summary = el('div', { class: 'studies-summary' });
    const search = el('input', {
      type: 'search', class: 'studies-search', value: state.query || '',
      placeholder: 'Search ID, patient, diagnosis\u2026', 'aria-label': 'Search studies',
      onInput: (event) => setState({ query: event.target.value }),
    });
    const tableHost = el('div', { class: 'studies-table-host' });
    let lastKey = null;

    function update(live) {
      const key = [live.studies, live.query];
      if (sameKey(key, lastKey)) return;
      lastKey = key;
      const studies = live.studies || [];
      // The summary always describes the whole library, not the filtered view.
      const queued = studies.filter((study) => deriveStatus(study) === 'proc').length;
      summary.textContent = `${studies.length} STUDIES \u00B7 ${queued} IN QUEUE`;
      const query = (live.query || '').trim().toLowerCase();
      mount(tableHost, buildTable(studies.filter((study) => matchesQuery(study, query))));
    }

    const root = el('main', { class: 'studies-page' },
      el('div', { class: 'studies-page-inner' },
        el('div', { class: 'studies-header' },
          el('div', {}, el('h1', { class: 'studies-heading' }, 'Studies'), summary),
          el('div', { class: 'studies-header-spacer' }),
          search),
        dropzone(),
        tableHost));
    mounted = { update };
    update(state);
    return root;
  }
  ```

  Delete the old `nextLocalId` and its comment; `nextId` replaces it.

- [ ] Styles. In `styles/components.css`, beside `.badge`, add the three status variants (`.badge-seg` sage, `.badge-rev` accent, `.badge-proc` muted — background `color-mix(in srgb, var(--X) 14%, transparent)`, `color: var(--X)`), `.pill-demo` (the original plan's rule: 1px/8px/2px padding, 999px radius, `--border` border, `--well` background, `--muted` text, Chivo Mono 8.5px 500 with 0.12em tracking, nowrap), `.dropzone-clickable { cursor: pointer; }`, `.dropzone-clickable:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`, and `.dropzone-active { border-color: var(--accent); background: var(--well); }`. In `styles/screens/studies.css`, keep the four existing rules and add the original plan's `.studies-summary`, `.studies-search` (+ `:focus`), `.studies-header-spacer`, table rules renamed to `.studies-table` (drop the plan's `.studies-table-card` background/border — `.card` provides them; keep `border-radius: 14px; overflow: hidden`), `.studies-table-head`, `.studies-row` (+ `:hover`, `:focus-visible` outline), `.studies-col-lordosis`, `.studies-cell-id`, `.studies-cell-patient`, `.studies-cell-view`, `.studies-cell-date`, `.studies-lordosis`, `.studies-lordosis-high`, `.studies-empty`. No colour literal anywhere except through tokens (the original plan's `#FFFFFF` sample button is gone). Do not add `.studies-dropzone*`, `.studies-sample-btn`, `.pill-status*`, or `.studies-relocate-btn`.

- [ ] Verify: `node --test test/studies.test.js` → 7 pass; full suite passes.

- [ ] Write `tools/smoke/smoke-studies.mjs` (the controller runs it; the implementer syntax-checks it). Same shape as `smoke-parity.mjs` (`connect()`, `check()`, PASS/FAIL lines, non-zero exit, no-console-errors check). Precondition: app running (any screen). Checks, in order:
  1. `setState('{ ack: true, screen: "studies", query: "" }')`; heading text `Studies`; summary matches `/^(\d+) STUDIES · (\d+) IN QUEUE$/` with n ≥ 9; `.studies-row` count equals n.
  2. Every row whose id is in `SP-0030..SP-0042` carries `.pill-demo` and `.badge-seg`; `SP-0031`'s lordosis cell reads `58°` with `.studies-lordosis-high`; `SP-0030`'s reads `18°` without it; `SP-0042`'s date cell reads `Aug 21, 2026`.
  3. Click the search box (trusted click at its rect), `typeText('SP-0042')`: one row remains; the input still has focus, `value === 'SP-0042'`, `selectionStart === 7`; the summary is unchanged. Clear the box (`value = ''` + an `input` event), `typeText('anterior slip')` → one row, `SP-0042`. Clear, `typeText('zzzznomatch')` → `.studies-empty` reads `No studies match that search.` and the summary is unchanged. Clear → n rows.
  4. Click the `SP-0042` row → `screen === 'analysis'`, `openId === 'SP-0042'`, `zoom === 1`, `editing === false`, `selectedLevel === null`. Click `.icon-btn[aria-label="Back to studies"]` → `screen === 'studies'` and n rows again.
  5. Add an unsegmented study the way `inject-study.js` does (evaluate that file's expression; it parks the embedded 157×280 film as `SP-9000` and navigates to Analysis) → `screen === 'analysis'`, `openId === 'SP-9000'`, that study has `measurements === null`, the run card is visible with a `Run segmentation` button. Back → the new row is first, with `.badge-proc` `Processing`, patient `—`, lordosis `—`, no `.pill-demo`; summary reads `${n+1} STUDIES · 1 IN QUEUE`. (The `Choose radiograph` button and the zone click open the native picker, which CDP cannot drive; those are Gate 1 steps.)
  6. `window.spineContour.loadStudies()` → its `studies` contains the new id with `measurements: null` (the saver persisted the unsegmented record).
  7. No console errors.

  The dropzone click (native picker) and a real file drop cannot be driven over CDP; they are Gate 1 steps.

- [ ] Commit.

  ```
  git add renderer/screens/studies.js styles/screens/studies.css styles/components.css test/studies.test.js tools/smoke/smoke-studies.mjs
  git commit -m "feat: the Studies screen — summary, search, table with status and DEMO pills, browse and drop"
  ```

---

## Task 8 — Prediction sidecar, thumbnail, and film restore on open

**Files:** `renderer/screens/analysis.js` (modify), `renderer/components/viewer.js` (modify), `renderer/viewer/canvas.js` (modify), `styles/screens/analysis.css` (modify, if the card needs a hidden-button rule), `test/canvas.test.js` (modify), `tools/smoke/smoke-persist.mjs` (new)

**Interfaces:**
- Consumes: `renderer/api.js` (Task 5) — `savePrediction`, `loadPrediction`; `viewer/canvas.js` — `loadStudyImages`, `disposeStudyImages`; `components/viewer.js` — `recordPrediction`.
- Produces: `canvas.js` exports `thumbnailSize(width, height, maxEdge = 128) → [w, h]` and `thumbnailDataUri(bitmap, maxEdge = 128) → string`; `viewer.js`'s `recordPrediction(studyId, response, measuredGeometry = response.geometry)` and a `setFilmStatus(status)` on the viewer object; `analysis.js` writes the sidecar and the thumbnail when a run completes and restores the film from the sidecar when a persisted study is opened.

**The sidecar is the raw `/predict` response** — `image_png`, `mask_png`, `femoral_mask_png`, `labels`, `measurements`, `geometry`, `qc` — written once per run to `userData/predictions/<id>.json` (Task 5's IPC). It is everything the Study record does not keep: what `loadStudyImages` needs to draw the film and overlay, and what `RESET TO PREDICTION` needs as its target. The record keeps the **corrected** geometry and measurements; the sidecar keeps the model's. Reading it is lazy (on open), never at bootstrap.

**Restore semantics that matter:** `recordPrediction` today also tells the `/measure` queue that the study's numbers describe the prediction's geometry. After a restart that is false for a corrected study — its numbers describe the *stored* geometry — and a failed `/measure` would silently revert the correction to the prediction. Hence the third argument.

- [ ] Write the failing tests in `test/canvas.test.js`:

  ```js
  import { thumbnailSize } from '../renderer/viewer/canvas.js';

  test('thumbnailSize scales the long edge down to the limit and never up', () => {
    assert.deepEqual(thumbnailSize(1000, 2000), [64, 128]);
    assert.deepEqual(thumbnailSize(2000, 1000, 128), [128, 64]);
    assert.deepEqual(thumbnailSize(100, 50), [100, 50]);
    assert.deepEqual(thumbnailSize(0, 0), [1, 1]);
  });
  ```

- [ ] Verify it fails (`does not provide an export named 'thumbnailSize'`).

- [ ] In `renderer/viewer/canvas.js` add:

  ```js
  // Spec 13: a thumbnail is at most 128 px on its long edge, JPEG, inline as a data URI. Pure size
  // math here so it can be tested; the encode below needs a canvas.
  export function thumbnailSize(width, height, maxEdge = 128) {
    const longEdge = Math.max(width, height, 1);
    const scale = Math.min(1, maxEdge / longEdge);
    return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
  }

  export function thumbnailDataUri(bitmap, maxEdge = 128) {
    const [width, height] = thumbnailSize(bitmap.width, bitmap.height, maxEdge);
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    scratch.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    return scratch.toDataURL('image/jpeg', 0.82);
  }
  ```

- [ ] In `renderer/components/viewer.js`:

  - `recordPrediction(studyId, { measurements, geometry }, measuredGeometry = geometry)`: unchanged snapshot; the queue call becomes `measureQueue.replaceMeasured(studyId, measuredGeometry)` with the comment: *"`measuredGeometry` is the geometry the study's CURRENT measurements describe. It is the prediction's own for a fresh run; for a corrected study restored from disk it is the stored geometry, so a failed /measure restores the correction, never the prediction."*
  - A closure-scoped `let filmStatus = null;` inside `mountViewer`, and on the returned object `setFilmStatus(status)` (`'loading' | 'missing' | null`) that stores it and calls `updateViewer` for the current study when one is open.
  - `redrawDynamic(geometry)`: first lines — with no `currentImages`, clear the dynamic canvas, hide the label chip, and return. Geometry is in the film's pixel space; without the film there is nothing to draw it on (the default 300×150 canvas is not it).
  - **The run card becomes a description plus one writer.** Today `updateViewer` (viewer.js:621–640) computes `showRunCard = !hasResult || state.running`, toggles `is-hidden` from it, and fills the card inside a single `if` with no `else`. New states cannot be appended to that `if`: for a restored study `hasResult` is true and nothing is running, so the card would stay hidden and any new branch would be dead. Define the two functions below at `mountViewer` scope (beside `updateEditBar`, **not** inside `updateViewer`), and replace lines 621–640 of `updateViewer` with the two-line call that follows them. Every branch writes **every** card property, because `filmStatus` transitions `'loading'` → `null` inside one mount and a property a branch omits keeps the previous branch's value (a spinner that never stops, a button that never returns):

    ```js
    // What the stage card shows for this study right now, or null when the film stands alone.
    // Task 9 adds the demo branch in front and keys busy-ness on the study's id.
    function describeCard(study, state, hasResult) {
      if (!hasResult || state.running) {
        const running = Boolean(state.running);
        return {
          eyebrow: running ? 'RUNNING' : 'QUEUED',
          title: running ? 'Segmenting and measuring…' : 'No segmentation yet',
          // Describes what the pipeline does; never which model is executing (BD-4).
          body: running
            ? 'Runs three models: vertebral segmentation, S1 keypoint detection, and femoral head fitting.'
            : 'This study was uploaded but has not been processed. Run segmentation to generate measurements.',
          spinner: running,
          button: { text: running ? 'Working…' : 'Run segmentation', disabled: running, title: '' },
        };
      }
      if (filmStatus === 'loading') {
        return { eyebrow: 'LOADING', title: 'Loading the film…', body: 'Reading the saved segmentation for this study.', spinner: true, button: null };
      }
      if (filmStatus === 'missing') {
        return {
          eyebrow: 'FILM UNAVAILABLE',
          title: 'The saved segmentation was not found',
          body: 'The film and overlay for this study are missing from this profile. Re-run segmentation to restore them; the measurements are unchanged.',
          spinner: false,
          button: { text: 'Re-run segmentation', disabled: Boolean(state.running), title: '' },
        };
      }
      return null;
    }

    // The ONLY writer of the card's nodes. Writes every property on every call.
    function applyCard(card) {
      runCard.classList.toggle('is-hidden', !card);
      if (!card) return;
      runEyebrow.textContent = card.eyebrow;
      runTitle.textContent = card.title;
      runBody.textContent = card.body;
      runSpinner.classList.toggle('is-hidden', !card.spinner);
      runButton.classList.toggle('is-hidden', !card.button);
      runButton.textContent = card.button ? card.button.text : '';
      runButton.disabled = card.button ? card.button.disabled : true;
      runButton.title = card.button ? card.button.title : '';
    }
    ```

    and in `updateViewer`, in place of the removed block:

    ```js
    const hasResult = Boolean(study.measurements && study.geometry);
    applyCard(describeCard(study, state, hasResult));
    ```

    Add `.run-button.is-hidden { display: none; }` to `analysis.css` (`.is-hidden` is not applied to that element today). Then `editButton.disabled = !hasResult || state.running || filmStatus !== null;` and `rerunButton.disabled = !hasResult || state.running || filmStatus === 'loading';` — a study whose film is missing must still be able to re-run (that is the remedy), and must not be editable until the film is back. The card's own `Re-run segmentation` button is the same `runButton`, whose `onclick` is the run handler installed by `setRunHandler`.

- [ ] In `renderer/screens/analysis.js`:

  - Imports: `savePrediction`, `loadPrediction`, `persistenceDisabledReason` from `../api.js`; `thumbnailDataUri` from `../viewer/canvas.js`.
  - In `runSegmentation`, after `loadStudyImages` and its revision check: `const thumbnail = thumbnailDataUri(images.image);` then

    ```js
    // The sidecar first, then the record: a record that says "segmented" must point at a film
    // that exists. A failed sidecar write is reported and the run still completes — the study
    // opens to FILM UNAVAILABLE next time, and a re-run recreates it. Neither toast starts with
    // "Could not": tools/smoke/run-and-wait.js treats that prefix as a failed run.
    if (persistenceDisabledReason()) {
      showToast('Studies are not being saved this session, so the segmentation images were not stored.');
    } else {
      try {
        await savePrediction(studyId, response);
      } catch (error) {
        showToast(`Saved the measurements, but the segmentation images could not be stored: ${error.message}`);
      }
    }
    if (revision !== runRevision) { disposeStudyImages(images); return; }
    ```

    and include `thumbnail` in the study patch of the final `setState`. `cacheImages`, the hand-off gate, `recordPrediction(studyId, response)` (two arguments — a fresh run's numbers ARE the prediction's) and the rest stay as they are.
  - Restore. Module-scope `let restoreRevision = 0;` and:

    ```js
    // A persisted study opened after a restart has numbers but no bitmaps. Read its sidecar,
    // decode, hand the bitmaps to the live viewer, and re-record the prediction snapshot with the
    // STORED geometry as the measured one. Guarded like runSegmentation: a newer restore, a run
    // started meanwhile, or navigation away drops this one's result.
    async function restoreFilm(studyId) {
      const revision = ++restoreRevision;
      const runAtStart = runRevision;
      const live = () => mounted && mounted.studyId === studyId;
      if (live()) mounted.viewer.setFilmStatus('loading');
      try {
        const sidecar = await loadPrediction(studyId);
        if (revision !== restoreRevision || runAtStart !== runRevision) return;
        if (!sidecar) {
          if (live()) mounted.viewer.setFilmStatus('missing');
          return;
        }
        const images = await loadStudyImages(sidecar);
        if (revision !== restoreRevision || runAtStart !== runRevision) { disposeStudyImages(images); return; }
        cacheImages(studyId, images);
        const study = getState().studies.find((s) => s.id === studyId);
        recordPrediction(studyId, sidecar, study && study.geometry ? study.geometry : sidecar.geometry);
        if (live()) {
          mounted.viewer.setFilmStatus(null);
          mounted.viewer.setImages(images);
          mounted.update();
        }
      } catch (error) {
        if (revision !== restoreRevision) return;
        if (live()) mounted.viewer.setFilmStatus('missing');
        showToast(`Could not load the film for ${studyId}: ${error.message}`);
      }
    }
    ```

    In `render()`, the re-hand line at `analysis.js:236` **stays where it is** — `setImages` must run before the first `update()` paints, or the stage stays black until an unrelated click (the BD-6 ordering the file's own comment explains). Beside it, compute only whether a restore is needed:

    ```js
    if (imageCache && imageCache.studyId === study.id) viewer.setImages(imageCache.images);
    const needsRestore = !(imageCache && imageCache.studyId === study.id)
      && study.source === 'real' && Boolean(study.measurements && study.geometry);
    ```

    and start the restore **after** the mount is recorded and the first paint has happened, because `restoreFilm`'s `live()` reads `mounted`:

    ```js
    mounted = { viewer, update, studyId: study.id };
    update();
    if (needsRestore) restoreFilm(study.id);
    return root;
    ```

- [ ] Verify: `node --test test/canvas.test.js` → passes; full suite passes. Then the plan-04 viewer suites (controller): `smoke-parity`, `gate1`, `gate2`, `gate3`, `label`, `chip` all still green — the `redrawDynamic` guard and the card changes touch every mode.

- [ ] Write `tools/smoke/smoke-persist.mjs` with two phases selected by `--phase run` and `--phase restart` (the controller quits and relaunches with `SMOKE_KEEP_PROFILE=1` between them; the profile directory comes from `SPINE_CONTOUR_USER_DATA`, defaulting as `launch.mjs` does). It records what phase 1 measured in `tools/smoke/out/persist-state.json`.
  - **run:** add `SP-9000` the way `inject-study.js` does (or reuse it if `smoke-studies.mjs` already created it in this profile), click `.run-button`, and wait for the run as `run-and-wait.js` does (≤ 400 s). Then: `study.thumbnail` starts with `data:image/jpeg;base64,` and decodes (an `Image` in the page) to a long edge ≤ 128; `window.spineContour.loadPrediction(id)` has the keys `image_png`, `mask_png`, `femoral_mask_png`, `labels`, `measurements`, `geometry`; `loadStudies()` shows the record with measurements, geometry and thumbnail; back to Studies → the row's badge is `Segmented` or `Needs review` (never `Processing`) and its lordosis cell is `Math.round(LL['L1-S1'])`; re-open the row → the dynamic canvas is sized to the film (`width > 300`), `RESET TO PREDICTION` enabled once editing; enter edit mode, `Tab`, `ArrowRight` ×3, wait 400 ms → `loadStudies()` shows the changed `L1 SA` x (the saver persisted a correction); `RESET TO PREDICTION` → geometry back to the sidecar's; `DONE`. Write `{ id, measurements, geometry, thumbnail }` to the state file. No console errors.
  - **restart:** `getState().studies` contains `id` with `measurements` deep-equal to the state file's and the same thumbnail; go to Studies, click the row; within 5 s the run card is hidden, the dynamic canvas is sized to the film, no `LOADING` text remains; the measurements panel's `LL` row shows the same value; enter edit mode → `RESET TO PREDICTION` is enabled (the snapshot came back from the sidecar); nudge `Tab` + `ArrowRight`, wait 400 ms, → `/measure` succeeded (geometry changed, no failure toast); `RESET TO PREDICTION` → geometry deep-equals the sidecar's `geometry`; `DONE`. Then the missing-sidecar path: delete `<profile>/predictions/<id>.json`, navigate to Studies and back into the study → the card shows `FILM UNAVAILABLE` with a `Re-run segmentation` button and the edit toggle disabled; no console errors. (Task 10 appends the re-run-from-disk checks to this phase.)

- [ ] Commit.

  ```
  git add renderer/screens/analysis.js renderer/components/viewer.js renderer/viewer/canvas.js styles/screens/analysis.css test/canvas.test.js tools/smoke/smoke-persist.mjs
  git commit -m "feat: persist each run's prediction beside the study and restore the film on open"
  ```

---

## Task 9 — Demo studies in Analysis, and `running` becomes the running study's id

**Files:** `renderer/components/viewer.js` (modify), `renderer/screens/analysis.js` (modify), `renderer/screens/studies.js` (modify), `renderer/store.js` (modify), `styles/screens/analysis.css` (modify), `test/store.test.js` (modify — it asserts `running === false` at line 27), `tools/smoke/smoke-gate3.mjs` (modify — strict equality on `running`), `tools/smoke/smoke-studies.mjs` (modify)

**Interfaces:**
- Consumes: the contract amendment `running: null // string|null`.
- Produces: a demo card on the stage for `source === 'demo'`; a DEMO pill in the Analysis header; Export CSV disabled for demo studies; `state.running` carrying the id of the study whose `/predict` is in flight; the Studies list showing `Processing` for that study; the viewer keying its busy state on `running === study.id`.

**Why a demo card:** a demo study has measurements but no geometry and no film, so today's viewer would show the QUEUED run card — "No segmentation yet", a `Run segmentation` button that toasts "file is no longer available" — beside a panel full of numbers. The stage has to say what a demo study is.

**Why `running` changes type:** with a list, a user can open study B while A's `/predict` is in flight. A boolean makes B's card read RUNNING and disables B's edit and re-run buttons (handoff item 7). The id keeps every existing truthiness check working (`if (state.running)` still means "a run is in flight") while letting the viewer and the list ask *which* study.

- [ ] `renderer/store.js`: initial `running: null` with the comment `// string|null — the id of the study whose /predict is in flight; one run at a time`. `test/store.test.js:27` asserts `running === false`; change it to `null`.

- [ ] `tools/smoke/smoke-gate3.mjs` compares `running` with strict equality: line 139 `waitFor('s.running === true', 3000)` becomes `'s.running !== null'`, and line 142 `waitFor('s.running === false && …', 240000)` becomes `'s.running === null && …'`. Left as is, the suite fails three checks and stalls for the full 240 s timeout. (`run-and-wait.js`, `smoke-label.mjs` and `smoke-chip.mjs` use `!s.running` and need nothing.)

- [ ] `renderer/screens/analysis.js`:
  - `runSegmentation`: `setState({ running: studyId })`; every `running: false` becomes `running: null`. The run handler installed by `viewer.setRunHandler` keeps refusing while `live.running` is truthy (one run at a time).
  - Header: after `headerMeta`, when `study.source === 'demo'`, append `el('span', { class: 'pill-demo' }, 'DEMO')`. Style it in `analysis.css` only for placement (margin), not colour — `.pill-demo` is `components.css`'s.
  - `exportButton.disabled = open.source === 'demo'` in `update()`, with `title` `Demo studies are not exported` when disabled and `Export CSV` otherwise. `toCsv` already excludes demo rows; disabling the button stops a click from writing a file with no rows.

- [ ] `renderer/components/viewer.js`:
  - `const busy = state.running === study.id;` in `updateViewer` and in `updateEditBar(state, study)` (every `state.running` read there becomes `busy`). `handlePointerDown` already holds `study` (viewer.js:311) before its `state.running` read at 313 — compare with `study.id` there. `handleKeyDown` reads `state.running` at line 529 **before** it resolves a study (546): move `const study = currentStudy();` up beside `const state = getState();` and use `const busy = Boolean(study) && state.running === study.id;` — a null study is never busy.
  - `describeCard` (Task 8) gets the demo branch first, and every read of `running` inside it becomes `busy` — the eyebrow, the title, the body, the spinner, the button text. Only the button's `disabled` looks at any run in flight (one run at a time):

    ```js
    function describeCard(study, state, hasResult) {
      if (study.source === 'demo') {
        return {
          eyebrow: 'DEMO STUDY',
          title: 'No film for a demo study',
          body: 'Demo studies carry fabricated measurements for exploring the interface. There is no radiograph or segmentation to display.',
          spinner: false,
          button: null,
        };
      }
      const busy = state.running === study.id;
      const otherRunning = Boolean(state.running) && !busy;
      if (!hasResult || busy) {
        return {
          eyebrow: busy ? 'RUNNING' : 'QUEUED',
          title: busy ? 'Segmenting and measuring…' : 'No segmentation yet',
          body: busy
            ? 'Runs three models: vertebral segmentation, S1 keypoint detection, and femoral head fitting.'
            : 'This study was uploaded but has not been processed. Run segmentation to generate measurements.',
          spinner: busy,
          button: {
            text: busy ? 'Working…' : 'Run segmentation',
            disabled: Boolean(state.running),
            title: otherRunning ? 'Wait for the current segmentation to finish' : '',
          },
        };
      }
      // … the LOADING and FILM UNAVAILABLE branches from Task 8, unchanged except that the
      // missing-film button's disabled is Boolean(state.running) and its title follows otherRunning …
      return null;
    }
    ```

  - `editButton.disabled = !hasResult || busy || filmStatus !== null;` and `rerunButton.disabled = !hasResult || Boolean(state.running) || filmStatus === 'loading';` — study B stays editable while A runs, but cannot start a second run. A demo study has no geometry, so both stay disabled through `hasResult`.

- [ ] `renderer/screens/studies.js`: thread the running id through the table. `buildTable(studies, runningId)` maps with `studies.map((study) => buildRow(study, runningId))` (never `studies.map(buildRow)` — `map` would pass the array index as `runningId`); `buildRow(study, runningId)` computes `const status = runningId === study.id ? 'proc' : deriveStatus(study);` (spec 13.1's "or currently running"); `update()` passes `live.running` to `buildTable`, counts the queue with the same rule, and adds it to the gate key `[live.studies, live.query, live.running]`.

- [ ] Verify: full suite passes (the measure-queue tests fake the store and are unaffected; `store.test.js` updated). Controller: the six plan-04 suites green again on a segmented study, including `smoke-gate3.mjs` with its edited `running` checks — a real re-run inside it is the proof that `running` round-trips as an id.

- [ ] Extend `tools/smoke/smoke-studies.mjs` with a demo-open section after step 4's back-navigation: click the `SP-0042` row → the run card is visible with eyebrow `DEMO STUDY` and **no** visible run button; the edit and re-run toolbar buttons are disabled; the header contains a `.pill-demo`; the Export CSV button is disabled; the measurements panel's `L1 PELVIC ANGLE` row reads `—` and `LUMBAR LORDOSIS · L1–S1` reads `48.2°`; `FEMORAL FIT CONFIDENCE` reads `96%`; no console errors. And a running-id section, if a segmented real study exists in the scratch profile: start a re-run on it, navigate to Studies → its badge reads `Processing` while `state.running === id`; open a demo study meanwhile → its card is the demo card, not RUNNING; wait for the run to finish → `running === null`.

- [ ] Commit.

  ```
  git add renderer/components/viewer.js renderer/screens/analysis.js renderer/screens/studies.js renderer/store.js styles/screens/analysis.css test/store.test.js tools/smoke/smoke-gate3.mjs tools/smoke/smoke-studies.mjs
  git commit -m "feat: demo studies open to a demo card; running names the study whose /predict is in flight"
  ```

- [ ] **GATE 1 — MANUAL VERIFICATION (user at the app).** Controller: launch on a scratch profile, run `smoke-studies.mjs` and `smoke-persist.mjs --phase run` first; all green before asking. Then the user, from source with `$env:SPINE_CONTOUR_PYTHON` set and **no** `SPINE_CONTOUR_USER_DATA` (the real dev profile):
  1. Landing → Enter → Studies. Expected: heading `Studies`; summary `9 STUDIES · 0 IN QUEUE` (plus any studies already in your profile); the dashed dropzone with the upload icon, the two lines of copy, and an accent `Choose radiograph` button; the table with `STUDY ID · PATIENT · VIEW · DATE · STATUS · LORDOSIS` and nine demo rows, each with a `DEMO` pill beside the patient, a sage `Segmented` pill, and a right-aligned lordosis in accent at ≥ 40° (`SP-0031` 58°, `SP-0039` 52°) and ink below it (`SP-0030` 18°). Hover a row: well-coloured highlight.
  2. Type `SP-0042` in the search box: one row. Type `zzzz`: `No studies match that search.`, summary unchanged. Clear: all rows. The caret never jumps while typing.
  3. Click `SP-0042`: Analysis opens with `SP-0042 · STANDING LATERAL · P-8841` and a `DEMO` pill in the header, `FEMORAL FIT CONFIDENCE 96%`, the panel showing the four real rows and `—` for `L1 PELVIC ANGLE` and the lordosis levels, and the stage showing the `DEMO STUDY` card with no button. Export CSV is disabled. Back.
  4. Click the dropzone itself (not the button): the native picker opens. Cancel: nothing changes.
  5. Drag a real lateral radiograph from Explorer onto the dropzone: the zone highlights while hovering; on drop the app opens Analysis for a new `SP-10xx` with the run card. Run segmentation. Expected: the film, the overlay, the numbers. Back to Studies: the new row is first, `Segmented` or `Needs review`, its lordosis value matches the panel. In DevTools, `(await window.spineContour.loadStudies()).studies.at(0).filePath` is the file's absolute path, **not** `null` — this is the one check that proves a `File` crosses the context bridge with its path (nothing else in the plan verifies it; a silent `null` would only surface as "cannot re-run after a restart").
  6. Drag a file onto the **sidebar** (outside the dropzone): the cursor may show a copy icon while hovering, and nothing else happens — the window must not navigate to the file.
  7. Click `Choose radiograph` and pick a second real film: one picker opens (not two), Analysis opens for another `SP-10xx`, run it. Back: two real rows above the demo rows, `11 STUDIES · 0 IN QUEUE` (plus whatever your profile already held).
  8. Open the dropped study again from the list: the film shows immediately (this session's cache). Edit → drag a handle → DONE. Back. Open it again: the corrected geometry is what you see.
  9. DevTools console: no red lines during any of the above.

---

## Task 10 — Re-run after a restart, and relocating a moved film

**Files:** `renderer/screens/analysis.js` (modify), `tools/smoke/smoke-persist.mjs` (modify)

**Interfaces:**
- Consumes: `renderer/api.js` (Task 5) — `readFile`, `selectFile`.
- Produces: `runSegmentation` obtains the film bytes from the session payload, else from `filePath` on disk, else asks the user to relocate the film; a relocation updates `fileName`/`filePath` on the record (persisted by the saver) before the run.

After a restart `filePayloads` is empty, so a re-run must read the film from `filePath` (handoff item 5). When that read returns `null` the file has moved: spec §13's "file not found state offering to relocate it" is this flow — a toast that names the file, the native picker, and the run continuing with the chosen file.

- [ ] In `renderer/screens/analysis.js`, import `readFile`, `selectFile` and add:

  ```js
  // The film bytes: this session's payload, else the file at filePath, else null (moved or never had a path).
  async function filmBytes(study) {
    const cached = filePayloads.get(study.id);
    if (cached) return cached;
    if (!study.filePath) return null;
    const bytes = await readFile(study.filePath);
    if (bytes) filePayloads.set(study.id, bytes);
    return bytes;
  }

  // Spec 13: a study whose source moved still lists with its numbers and opens; the moment the
  // film is needed, offer to relocate it. Cancelling leaves the record untouched.
  async function relocateFilm(study) {
    showToast(`${study.fileName} was not found. Choose its new location.`);
    const chosen = await selectFile();
    if (!chosen) return null;
    filePayloads.set(study.id, chosen.data);
    setState((state) => ({
      studies: state.studies.map((s) => (s.id === study.id ? { ...s, fileName: chosen.name, filePath: chosen.path } : s)),
    }));
    return chosen.data;
  }
  ```

  Add a module-scope flag beside `runRevision`:

  ```js
  // True while a relocate picker is open for a run that has not started. It refuses a second run
  // (and so a second native dialog) WITHOUT claiming a segmentation is running -- the card must
  // not say RUNNING while the app is waiting on a file dialog (no fabricated status).
  let locating = false;
  ```

  In `runSegmentation`, replace `analysis.js:95–107` — from `const revision = ++runRevision;` through the `predict` call's `name: study.fileName,` — with:

  ```js
  if (locating) return;
  const revision = ++runRevision;
  const study = getState().studies.find((s) => s.id === studyId);
  if (!study) return;
  let data = null;
  locating = true;
  try {
    data = await filmBytes(study);
    if (!data) data = await relocateFilm(study);
  } catch (error) {
    showToast(`Could not read ${study.fileName}: ${error.message}`);
  } finally {
    locating = false;
  }
  if (!data || revision !== runRevision) return;
  // After a relocation the record carries the NEW name; the `study` binding above is stale.
  const current = getState().studies.find((s) => s.id === studyId) ?? study;

  setState({ running: studyId });
  try {
    const response = await predict({
      name: current.fileName,
      data,
      modality: 'xray',
      bodyPart: 'lumbar',
      view: 'lateral',
    });
  ```

  The rest of the `try` block and the `catch` continue as they are. `locating` is checked **before** the revision bump, so a refused second call cannot supersede the first at its revision check. The run handler installed in `render()` (`if (live.running) return;`) gains the same guard: `if (live.running || locating) return;`. `running` is set only once the bytes are in hand, so the card says QUEUED, not RUNNING, while the picker is open. The filename matters: the extension drives the backend's decoder, so relocating a `.jpg` to a `.png` must send the new name with the new bytes.

- [ ] Verify: full suite passes (no pure logic changed). Controller: the plan-04 suites unaffected (viewer untouched); `smoke-persist.mjs --phase restart` gains the checks below.

- [ ] Extend `smoke-persist.mjs`'s restart phase, after the missing-sidecar check: click the card's `Re-run segmentation` → within 400 s the run completes (`running === null`, no failure toast), the card is hidden, the canvas is sized to the film, `loadPrediction(id)` is non-null again (the sidecar was recreated from bytes read from `filePath` — the profile was fresh at launch, so no payload existed). Then the moved-film path as far as automation reaches: `setState` the study's `filePath` to `C:/does/not/exist/film.jpg` **and** clear its payload by re-launching is not possible mid-suite, so instead check `window.spineContour.readFile('C:/does/not/exist/film.jpg')` resolves `null`; the toast-and-picker flow is Gate 2's.

- [ ] Commit.

  ```
  git add renderer/screens/analysis.js tools/smoke/smoke-persist.mjs
  git commit -m "feat: re-run reads the film from disk after a restart and offers to relocate a moved film"
  ```

---

## Task 11 — End-to-end verification: persistence survives a restart; handoff

**Files:** `docs/superpowers/HANDOFF.md` (modify), `CLAUDE.md` (modify), `docs/superpowers/plans/2026-08-31-00-architecture-contract.md` (prose only, if any amendment text needs its "plan 05" markers updated)

**Interfaces:**
- Consumes: everything Tasks 0–10 built.
- Produces: the plan's acceptance criterion confirmed by the smoke harness and by the user; the handoff's "Resume plan 06 here" section.

- [ ] Run the full automated suite: `node --test test/*.test.js`. Expected: every file passes, 0 failures, and the count is the plan-04 baseline (115) plus this plan's additions.

- [ ] Controller: on a fresh scratch profile, `smoke-studies.mjs`, then `smoke-persist.mjs --phase run`, then `cdp.mjs --quit`, relaunch with `SMOKE_KEEP_PROFILE=1`, then `smoke-persist.mjs --phase restart`; then the six plan-04 suites on the study `inject-study.js` creates (`SP-9000`, so it cannot replace the persisted `SP-1000`). All green.

- [ ] **GATE 2 — MANUAL VERIFICATION (user at the app), the acceptance criterion in full.** From source on the real dev profile:
  1. Note which real studies are listed (from Gate 1). Open one, correct a landmark (drag a corner a visible distance), DONE, note the `LL L1–S1` value and the corner's new position. Back.
  2. **Quit the app completely** (close the window; the process exits).
  3. Relaunch. Landing → Studies. Expected: the same rows, same ids, same lordosis values, same status pills; `IN QUEUE` is 0.
  4. Open the corrected study. Expected: within a second the film and overlay appear (the LOADING card may flash), the corner is where you left it, the panel shows the same numbers, `FEMORAL FIT CONFIDENCE` unchanged. Edit → `RESET TO PREDICTION` is enabled; press it: the corner returns to the model's position and the numbers to the prediction's. DONE.
  5. Re-run segmentation on that study. Expected: it runs (the film was read from its path on disk), the result replaces the prediction, and the card disappears.
  6. Move or rename that study's source file in Explorer. In the app, re-run it. Expected: a toast `<file name> was not found. Choose its new location.` and the native picker. Cancel: the app stays on Analysis, nothing changes, the numbers are still there. Re-run again and this time pick the moved file: the run proceeds; back on Studies the row is unchanged; DevTools `await window.spineContour.loadStudies()` shows the new `filePath`.
  7. Quit. In `%APPDATA%\spine-contour\`, open `studies.json` in a text editor and confirm it is readable JSON with a `version` and your real studies only (no `SP-00xx` demo ids), each with a `thumbnail` data URI; `predictions\` holds one `<id>.json` per segmented study. Overwrite `studies.json` with `not json at all`. Relaunch: no crash; Studies shows the nine demo rows; the folder now holds `studies.json.corrupt-<n>` (your old contents) and a fresh `studies.json`. Restore by renaming the corrupt file back over `studies.json` (delete the fresh one first).
  8. Quit. Edit `studies.json` and change `"version": 1` to `"version": 2`. Relaunch: a toast says the store version is not supported; Studies shows only the nine demo rows. Add a film with `Choose radiograph` and run it. Expected: the run completes and shows its result, a toast says studies are not being saved this session so the segmentation images were not stored, and after quitting, `studies.json` still says `"version": 2` with your studies intact and `predictions\` has gained **no** new file. Change the version back to `1`; relaunch; everything is back.
  9. DevTools console clean throughout.

- [ ] Docs commit: HANDOFF.md gets plan 05 marked DONE with its commit range (its execution-order table row `| 05 | … | 10 | Measurements survive restart |` becomes 12 tasks, and the "77 tasks, 399 steps total" line is corrected), a "Resume plan 06 here" section (what plan 05 changed under plans 06/07: the saver, the sidecar, `running` as an id, `addStudy` as the one entry point for new films — plan 06's folder scan should create records through it or through `newStudy` + the saver; `filePath` is the film's identity for re-run; `tools/smoke/` is the verification harness and how to run it; the dev-profile-equals-production-profile note), a **Test data** section in the repository README linking the public lateral-radiograph datasets the user names (no film ships with the app; the links are the user's to supply — if they have not arrived, write the section with a clearly marked placeholder and say so in the handoff), CLAUDE.md's status line updated, and any contract prose whose "(plan 05)" markers should now read as present tense. Commit as `docs: plan 05 is done; record what it changed for plan 06`.

- [ ] Push `ui-redesign-cw` to `fork` (never `origin`) once Gate 2 has passed. Do not merge into the fork's `main`.
