# Landmark Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 14-button landmark/femoral-head correction matrix with direct manipulation of handles drawn on the viewer canvas — click to select, drag to move, keyboard to cycle and nudge — while preserving every correction capability the old editor had.

**Architecture:** `renderer/viewer/interactions.js` becomes a purely logical module: `TAB_ORDER`, `FULL_ORDER`, `nextSelection`, `sameHandle`, `nudge`, `hitTestFemoral`, `arrowKeyDelta` and `debounce`, all unit-tested under `node --test`, plus the zoom and vertebra hit-test helpers plan 03 already put there. `renderer/components/viewer.js` owns **all** pointer and keyboard wiring for the stage — pan, zoom, coarse click-select, handle drag, hover, retrace — through one module-scope `drag` and one `redrawDynamic()` path. `renderer/viewer/canvas.js`'s `drawDynamicLayer` is **extended**, not replaced: the plan-03 rendering (outlines, selected constructions) stays, and 22 landmark handles plus 4 femoral handles are drawn on top of it in edit mode only. Every edit works on a `structuredClone` of the store's geometry and commits a **new** reference; the store's geometry is never mutated in place. Committing (pointer release, a nudge, a retrace fit) schedules a 150 ms debounced `/measure` call bound to the study it was made on.

**Tech Stack:** Vanilla ES modules, Canvas 2D, `node --test`. No frameworks, no bundler.

## Global Constraints

These apply to **every task in every plan**. They are not repeated per task.

- **No bundler, no framework, no npm runtime dependencies.** Vanilla ES modules only.
  `package.json` `dependencies` stays empty; `devDependencies` stays exactly
  `electron` and `electron-builder`.
- **CSP is `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'`.**
  It must not be loosened. No CDN, no Google Fonts, no remote anything.
- **Fonts are self-hosted** from `assets/fonts/`. Source Sans 3 and Chivo Mono, both SIL OFL.
- **Never display a fabricated measurement.** Absent values render the em dash `—`,
  never `0`, never `N/A`, never a guess.
- **Never label a value with a name it isn't.** See the `SS` rename (plan 02) and the
  `FEMORAL FIT CONFIDENCE` badge (plan 03).
- **Never draw a construction under the wrong measurement's name.** `state.selectedLevel` is a
  construction target with domain `'L1'`…`'L5'` | `'S1'` | `'PI'` | `'PT'` | `'SS'` | `'L1PA'` | `null`.
  Anything switching on it handles the non-level values **explicitly**. Nothing in this plan
  switches on it; the plan-03 `drawSelectedMeasurement` that does is preserved verbatim.
- **Node's built-in test runner only** (`node --test test/*.test.js`). No Jest, Vitest, or Mocha.
  The directory form `node --test test/` fails on Node 24 — do not "fix" it back.
- **Every `<script>` is `type="module"`.** No global scope leakage.
- **`renderer/router.js` is in no task's Files block.** `SCREEN_KEYS` stays `['screen', 'ack']`.
  No new state keys are introduced by this plan; `editing` and `selection` already exist.
- Target Electron 44 / Chromium — modern syntax is fine. No transpilation.
- Commit after every task. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `chore:`, `refactor:`).

---

## Binding decisions for this plan

Settled by the pre-flight scan against plan 03's delivered code (ledger:
`.superpowers/sdd/2026-08-31-04-landmark-editing/progress.md`). They override anything a task
below appears to say otherwise.

- **BD-1 — One pointer pipeline, in `components/viewer.js`.** Plan 03 wired pan/zoom/click-select
  in `attachViewerInteractions` inside `interactions.js`, with the pan drag in a closure. The
  architecture contract puts transient interaction state at module scope in
  `components/viewer.js`, and a second `pointerdown` listener for handle drags on the same canvas
  would leave pan-mode and edit-mode gestures both firing with no precedence rule. Task 8 moves
  that wiring into `viewer.js` unchanged in behaviour (plus spec §12's middle-button pan), with
  **one** module-scope `drag` for every gesture kind. `interactions.js` ends the plan with no DOM
  code at all.
- **BD-2 — Clone on edit; one redraw path.** A drag works on `structuredClone(study.geometry)` and
  commits it as a **new** reference on release; a nudge, a fit and a reset do the same in one
  step. `updateViewer`'s reference-keyed redraw gate and `router.js`'s key sets both depend on
  this. The dynamic-layer key gains `editing`, `selection` and `zoom`; a single `redrawDynamic()`
  composes the draw options from the store and the module-scope transient state, and is the only
  function that calls `drawDynamicLayer`. Per-frame drag and hover redraws call it directly with
  the working geometry; everything else reaches it through `updateViewer`.
- **BD-3 — Handles exist only in edit mode, at a constant on-screen size.** Outside edit mode the
  stage renders exactly as plan 03 shipped and the user verified. In edit mode the 22 landmark
  handles use the legacy editor's per-corner colours (SA cyan, SP green, IA orange, IP pink), the
  femoral handles use the overlay's own femoral green, and every handle is sized in CSS pixels
  through `pixelRatio` (image px per CSS px, read from layout) so a 2500-px radiograph gets the
  same 5-px handle as a 600-px one at any zoom. The plan-03 outlines keep scaling with the image.
- **BD-4 — No store subscriptions in `viewer.js`.** `mountViewer` runs on every navigation into
  Analysis; a subscription created there is never removed. Every store-driven update goes through
  `updateViewer`, which `screens/analysis.js` already drives from its single module-scope
  subscription. The `keydown` listener and the stage `ResizeObserver` are attached inside
  `mountViewer` and removed in `detach`, which also resets the module-scope transient state.
- **BD-5 — The `/measure` round-trip is bound to a study.** `scheduleMeasure(studyId)` carries the
  id, `recalculateMeasurements(studyId)` reads and writes that study only, and the legacy
  `measureRevision` guard is preserved as one counter **per study**. Recording a new prediction
  (Task 17) and resetting to it discard that study's pending or in-flight correction only, so a
  stale correction can never land on a fresh prediction and a re-run of study B cannot silence
  a correction made on study A. **Reset restores the prediction's measurements and geometry together and
  makes no `/measure` call** — the backend recomputes `l1_center` from the L1 quadrilateral
  centroid, which is not the mask centroid `/predict` used, so a round-trip would not return the
  original L1PA.
- **BD-6 — Toolbar layout.** The glass toolbar gains two icon buttons: an **Edit landmarks**
  toggle (pencil, `aria-pressed`) and **Re-run segmentation** (refresh). An **edit bar** directly
  below the toolbar, shown only while editing, carries `RETRACE` (toggle), `FIT`,
  `RESET TO PREDICTION` and `DONE` as text tool buttons. Five text buttons inside the toolbar
  itself do not fit the ~550-px stage at the default 1180-px window. `aria-pressed` is set on
  every toggle: pan, overlay, edit, retrace.
- **BD-7 — Re-run is a first-class affordance.** Plan 03's run button lives inside the run card,
  which hides once a result exists, so a study could never be re-segmented — which is what made
  the cache-eviction defect unrecoverable. The toolbar's Re-run button shares the run handler;
  the run card shows whenever `running` is true, result or not; a completing prediction exits
  edit mode and records itself as the new reset target.
- **BD-8 — `store.js` isolates its listeners.** One subscriber's throw must not silence the
  subscribers after it. Task 1 wraps each listener call in `try`/`catch` and reports the error
  through `console.error`. Contract signatures are unchanged.
- **BD-9 — `selection` and `selectedLevel` stay independent.** Clicking a handle never changes
  the construction being shown; clicking a row never changes the selected handle. An
  empty-canvas click in edit mode still performs plan 03's coarse vertebra select, exactly as
  outside edit mode.
- **BD-10 — Three manual gates, not twelve.** Canvas and pointer code cannot be unit-tested here.
  Manual verification is consolidated: Gate 1 after Task 11 (parity, toggle, handles, hover),
  Gate 2 after Task 14 (drag, femoral, retrace), Gate 3 as Task 19 (keyboard, reset, re-run, the
  full pass). Every "MANUAL VERIFICATION (before)" step in the original plan was deleted: they
  asked a human to confirm that unbuilt features do not exist. The controller runs smoke checks
  over `--remote-debugging-port` between gates; those are not a substitute for the gates.
- **BD-11 — Accepted limitations, stated so they are not rediscovered as bugs.** (a) While a
  handle is being dragged, a measurement label on the stage shows the last computed value
  beside a line that has already moved; the panel does the same, and both update ≤150 ms plus
  one round-trip after release. (b) After the first `/measure`, `l1_center` is the L1 quadrilateral
  centroid rather than the mask centroid; this is the backend's behaviour and matches the old
  app. (c) Retrace has no per-point undo — toggling `RETRACE` off clears the points. (d) While
  editing, `Tab` is the handle cycle everywhere except inside the edit bar, so `RETRACE` /
  `FIT` / `RESET TO PREDICTION` / `DONE` are reachable by keyboard only once the mouse has put
  focus in that bar; `Escape`, and the pencil (which keeps focus after activation), remain
  keyboard exits, and Retrace needs the mouse to place points regardless.

---

## What plan 03 actually delivered (the seams this plan builds on)

Read these signatures as facts. Every task below was written against this code.

- `renderer/viewer/geometry.js` exports exactly the contract's `fitCircle`, `imageToClient(pt, rect, canvas)`,
  `clientToImage(ev, canvas)` (clamped to the canvas), `nearestLandmark(geometry, clientX, clientY, canvas, radius = 14)`
  → `{level, corner, distance} | null`, `landmarkAt`, `setLandmarkAt` (keeps `quadrilateral` in sync), `LEVELS`, `CORNERS`.
- `renderer/viewer/canvas.js` exports `createLayeredCanvases(host)` → `{staticCanvas, dynamicCanvas, staticCtx, dynamicCtx}`
  (appends both canvases to `host`), `sizeCanvases`, `drawStaticLayer(ctx, canvas, images, opts)`, and
  `drawDynamicLayer(ctx, canvas, geometry, {selectedLevel, measurements})`, which draws the five
  outlines, the S1 segment, both femoral circles, and the selected construction via
  `drawSelectedMeasurement` — the function that handles every `selectedLevel` value explicitly.
  Its sanctioned literals: `STAGE_LINE_COLOR`, `STAGE_SELECTED_COLOR`, `STAGE_LABEL_FILL`,
  `LABEL_PLATE_FILL`, and `CANVAS_MONO`; the module also exports `LEVEL_RGB` and `FEMORAL_OVERLAY_COLOR`.
- `renderer/viewer/interactions.js` exports `ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP`, `clampZoom`, `zoomIn`, `zoomOut`,
  `vertebraAt(geometry, point, radius = 20)` and — until Task 8 moves it — `attachViewerInteractions(stage, canvas, options)`.
- `renderer/components/viewer.js` exports `mountViewer(container)` → `{updateViewer(study), setImages(images), setRunHandler(handler), detach()}`.
  `screens/analysis.js` calls it on every render, calls `detach()` on every teardown, and calls
  `updateViewer(study)` from its single module-scope store subscription. The toolbar is built with
  `toolButton(label, icon, onClick)` (real `<button class="viewer-tool">` with `aria-label`); the
  dynamic redraw is gated on `[study.geometry, state.selectedLevel, study.measurements]` by reference.
- `screens/analysis.js`'s `runSegmentation(studyId)` owns the `/predict` flow: it caches images,
  hands them to the live viewer, then writes `measurements`/`geometry`/`qc` onto the study.
- `renderer/api.js` exports `measure(geometry)` → `{measurements, geometry}`; the backend's
  `/measure` accepts `{vertebrae, s1_superior, femoral_circles}`, echoes `vertebrae`, and
  recomputes `hip_midpoint` (mean of the two centres) and `l1_center`.
- `components/toast.js` exports `showToast(message)`; nothing writes `state.toast` directly.
- The existing test files `test/interactions.test.js` (4 tests), `test/geometry.test.js` (10),
  `test/canvas.test.js` (3) and `test/store.test.js` (8) are appended to, never replaced. 66 tests pass at BASE `7de86cd`.
- Source-mode launch: `$env:SPINE_CONTOUR_PYTHON = "C:\Users\codyj\spine contour\.venv\Scripts\python.exe"` then
  `npm.cmd run dev` (worktree has no `.venv`). Add `-- --remote-debugging-port=9222` to drive it over CDP.
  "Process alive" is not evidence of a launch: a fatal error is a modal dialog.

---

## Task 1: `store.js` isolates its subscribers

**Files:** `renderer/store.js`, `test/store.test.js`

**Interfaces:**
- Produces: no signature change. `setState` still shallow-merges and notifies synchronously in insertion order.

`setState` iterates `listeners` with a bare `listener(state)`. A throw inside any subscriber
stops every subscriber registered after it — the router's included — for that update and every
later one; a single unguarded property read in a draw function freezes the whole UI. Plan 03 hit
this twice. This plan adds the code most likely to throw at pointermove rate, so the guard lands
first.

- [ ] Append to `test/store.test.js`:

  ```js
  test('a subscriber that throws is reported and does not stop the subscribers after it', () => {
    const reported = [];
    const originalError = console.error;
    console.error = (...args) => reported.push(args);
    const seen = [];
    const unsubscribeThrower = subscribe(() => { throw new Error('draw failed'); });
    const unsubscribeLater = subscribe((state) => seen.push(state.toast));
    try {
      setState({ toast: 'still delivered' });
    } finally {
      console.error = originalError;
      unsubscribeThrower();
      unsubscribeLater();
    }
    assert.deepEqual(seen, ['still delivered'], 'the later subscriber must still be notified');
    assert.equal(reported.length, 1, 'the throw is reported exactly once');
    assert.ok(reported[0].some((arg) => arg instanceof Error && arg.message === 'draw failed'));
    // The notifying flag was cleared: the store keeps working afterwards.
    setState({ toast: '' });
    assert.equal(getState().toast, '');
  });
  ```

- [ ] Run `node --test test/store.test.js` and confirm the new test fails **before any assertion
  runs**: with the unguarded loop the subscriber's own `Error: draw failed` propagates out of
  `setState({ toast: 'still delivered' })` and aborts the test.

- [ ] In `renderer/store.js`, replace the notification loop inside `setState`:

  ```js
    notifying = true;
    try {
      for (const listener of listeners) {
        try {
          listener(state);
        } catch (error) {
          // One subscriber's throw must not silence the subscribers after it. Before this
          // guard, a TypeError inside a canvas draw function stopped the router's listener
          // too, and the whole UI froze instead of one layer going blank. The re-entrancy
          // error thrown by the nested setState() above is unaffected: it is raised inside
          // the offending subscriber, which is where it belongs.
          console.error('store: subscriber threw during notification', error);
        }
      }
    } finally {
      notifying = false;
    }
  ```

- [ ] Run `node --test test/store.test.js` and confirm 9/9 pass, including the existing
  re-entrancy test (its subscriber catches the nested `setState` throw itself, so nothing
  reaches the new guard).

- [ ] Run `node --test test/*.test.js` — 67 pass.

- [ ] Commit:

  ```
  git add -A && git commit -m "fix: isolate store subscribers so one throw cannot freeze the UI"
  ```

---

## Task 2: `Selection` type, `TAB_ORDER` and `FULL_ORDER`

**Files:** `renderer/viewer/interactions.js`, `test/interactions.test.js`

**Interfaces:**
- Consumes: `LEVELS`, `CORNERS` from `renderer/viewer/geometry.js`
- Produces: `TAB_ORDER` (22 landmark stops), `FULL_ORDER` (24 stops — both **exported**, per the
  contract), the `Selection` typedef (JSDoc only).

Both files already exist. `test/interactions.test.js` imports `ZOOM_MIN, ZOOM_MAX, clampZoom, zoomIn, zoomOut, vertebraAt`
from the module; **extend that one import line** rather than adding a second import of the same
module. Do the same in every later task that adds names.

- [ ] Add to the import line in `test/interactions.test.js`: `TAB_ORDER, FULL_ORDER`. Append:

  ```js
  test('TAB_ORDER has 22 entries in anatomical order', () => {
    assert.equal(TAB_ORDER.length, 22);
    assert.deepEqual(TAB_ORDER[0], { kind: 'landmark', level: 'L1', corner: 'SA' });
    assert.deepEqual(TAB_ORDER[1], { kind: 'landmark', level: 'L1', corner: 'SP' });
    assert.deepEqual(TAB_ORDER[2], { kind: 'landmark', level: 'L1', corner: 'IA' });
    assert.deepEqual(TAB_ORDER[3], { kind: 'landmark', level: 'L1', corner: 'IP' });
    assert.deepEqual(TAB_ORDER[4], { kind: 'landmark', level: 'L2', corner: 'SA' });
    assert.deepEqual(TAB_ORDER[19], { kind: 'landmark', level: 'L5', corner: 'IP' });
    assert.deepEqual(TAB_ORDER[20], { kind: 'landmark', level: 'S1', corner: 'SA' });
    assert.deepEqual(TAB_ORDER[21], { kind: 'landmark', level: 'S1', corner: 'SP' });
  });

  test('TAB_ORDER never contains an S1 IA or IP corner', () => {
    const s1Entries = TAB_ORDER.filter((entry) => entry.level === 'S1');
    assert.equal(s1Entries.length, 2);
    assert.ok(s1Entries.every((entry) => entry.corner === 'SA' || entry.corner === 'SP'));
  });

  test('FULL_ORDER is TAB_ORDER followed by the left and right femoral-head centres', () => {
    assert.equal(FULL_ORDER.length, 24);
    assert.deepEqual(FULL_ORDER.slice(0, 22), TAB_ORDER);
    assert.deepEqual(FULL_ORDER[22], { kind: 'femoral', side: 'left', part: 'center' });
    assert.deepEqual(FULL_ORDER[23], { kind: 'femoral', side: 'right', part: 'center' });
  });

  test('FULL_ORDER contains no rim stops', () => {
    assert.ok(FULL_ORDER.every((entry) => entry.kind !== 'femoral' || entry.part === 'center'));
  });
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm it fails at import time:
  `SyntaxError: The requested module '../renderer/viewer/interactions.js' does not provide an export named 'TAB_ORDER'`.

- [ ] In `renderer/viewer/interactions.js`, extend the geometry import to
  `import { clientToImage, LEVELS, CORNERS } from './geometry.js';` and append at the end of the file:

  ```js
  /**
   * @typedef {Object} Selection
   * @property {'landmark'|'femoral'} kind
   * @property {string} [level]   'L1'..'L5'|'S1' — present when kind === 'landmark'
   * @property {string} [corner]  'SA'|'SP'|'IA'|'IP' — present when kind === 'landmark'
   * @property {'left'|'right'} [side]   present when kind === 'femoral'
   * @property {'center'|'rim'} [part]   present when kind === 'femoral'
   */

  // The 22 landmark stops in anatomical order: L1 SA,SP,IA,IP · L2 … · L5 · S1 SA,SP.
  export const TAB_ORDER = [
    ...LEVELS.flatMap((level) => CORNERS.map((corner) => ({ kind: 'landmark', level, corner }))),
    { kind: 'landmark', level: 'S1', corner: 'SA' },
    { kind: 'landmark', level: 'S1', corner: 'SP' },
  ];

  // What Tab / Shift+Tab actually cycle: the landmarks plus the two femoral-head centres. The
  // heads are not landmarks, so they are not in TAB_ORDER, but the spec requires them to be
  // reachable by keyboard. Rim handles are not stops of their own -- see nextSelection.
  export const FULL_ORDER = [
    ...TAB_ORDER,
    { kind: 'femoral', side: 'left', part: 'center' },
    { kind: 'femoral', side: 'right', part: 'center' },
  ];
  ```

- [ ] Run `node --test test/interactions.test.js` — 8/8 pass.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add Selection type, TAB_ORDER and FULL_ORDER to interactions.js"
  ```

---

## Task 3: `sameHandle` and `nextSelection(current, direction)`

**Files:** `renderer/viewer/interactions.js`, `test/interactions.test.js`

**Interfaces:**
- Consumes: `FULL_ORDER` (Task 2)
- Produces: `sameHandle(a, b)` (exact identity, used by the canvas and the hover gate) and
  `nextSelection(current, direction)` (`1` for Tab, `-1` for Shift+Tab), both exported.

- [ ] Add `sameHandle, nextSelection` to the test file's import line and append:

  ```js
  test('sameHandle is exact identity, including the femoral part', () => {
    assert.ok(sameHandle({ kind: 'landmark', level: 'L3', corner: 'IA' }, { kind: 'landmark', level: 'L3', corner: 'IA' }));
    assert.ok(!sameHandle({ kind: 'landmark', level: 'L3', corner: 'IA' }, { kind: 'landmark', level: 'L3', corner: 'IP' }));
    assert.ok(sameHandle({ kind: 'femoral', side: 'left', part: 'rim' }, { kind: 'femoral', side: 'left', part: 'rim' }));
    assert.ok(!sameHandle({ kind: 'femoral', side: 'left', part: 'rim' }, { kind: 'femoral', side: 'left', part: 'center' }));
  });

  test('sameHandle is false when either side is null or the kinds differ', () => {
    assert.ok(!sameHandle(null, { kind: 'landmark', level: 'L1', corner: 'SA' }));
    assert.ok(!sameHandle({ kind: 'landmark', level: 'L1', corner: 'SA' }, null));
    assert.ok(!sameHandle(null, null));
    assert.ok(!sameHandle({ kind: 'landmark', level: 'L1', corner: 'SA' }, { kind: 'femoral', side: 'left', part: 'center' }));
  });

  test('nextSelection steps forward through landmarks in anatomical order', () => {
    const l1sa = { kind: 'landmark', level: 'L1', corner: 'SA' };
    assert.deepEqual(nextSelection(l1sa, 1), { kind: 'landmark', level: 'L1', corner: 'SP' });
  });

  test('nextSelection steps backward through landmarks', () => {
    const l1sp = { kind: 'landmark', level: 'L1', corner: 'SP' };
    assert.deepEqual(nextSelection(l1sp, -1), { kind: 'landmark', level: 'L1', corner: 'SA' });
  });

  test('nextSelection reaches the femoral heads after S1 SP', () => {
    const s1sp = { kind: 'landmark', level: 'S1', corner: 'SP' };
    const leftHead = nextSelection(s1sp, 1);
    assert.deepEqual(leftHead, { kind: 'femoral', side: 'left', part: 'center' });
    assert.deepEqual(nextSelection(leftHead, 1), { kind: 'femoral', side: 'right', part: 'center' });
  });

  test('nextSelection wraps from the right head back to L1 SA', () => {
    const rightHead = { kind: 'femoral', side: 'right', part: 'center' };
    assert.deepEqual(nextSelection(rightHead, 1), { kind: 'landmark', level: 'L1', corner: 'SA' });
  });

  test('nextSelection wraps backward from L1 SA to the right head', () => {
    const l1sa = { kind: 'landmark', level: 'L1', corner: 'SA' };
    assert.deepEqual(nextSelection(l1sa, -1), { kind: 'femoral', side: 'right', part: 'center' });
  });

  test('nextSelection with null current returns the first stop forward and the last stop backward', () => {
    assert.deepEqual(nextSelection(null, 1), { kind: 'landmark', level: 'L1', corner: 'SA' });
    assert.deepEqual(nextSelection(null, -1), { kind: 'femoral', side: 'right', part: 'center' });
  });

  test('nextSelection treats a selection that is not a stop like null', () => {
    assert.deepEqual(nextSelection({ kind: 'landmark', level: 'S1', corner: 'IA' }, 1), { kind: 'landmark', level: 'L1', corner: 'SA' });
    assert.deepEqual(nextSelection({ kind: 'landmark', level: 'S1', corner: 'IA' }, -1), { kind: 'femoral', side: 'right', part: 'center' });
  });

  test('nextSelection resolves a rim selection to its side and steps from there', () => {
    const rim = { kind: 'femoral', side: 'left', part: 'rim' };
    assert.deepEqual(nextSelection(rim, 1), { kind: 'femoral', side: 'right', part: 'center' });
    assert.deepEqual(nextSelection(rim, -1), { kind: 'landmark', level: 'S1', corner: 'SP' });
  });
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm the whole file fails at import time
  (`does not provide an export named 'sameHandle'`) — the existing tests fail with it until the
  exports exist.

- [ ] Append to `renderer/viewer/interactions.js`:

  ```js
  // Exact handle identity. The canvas uses it to decide which handle is selected or hovered,
  // and the viewer uses it to skip a hover redraw when nothing changed.
  export function sameHandle(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === 'landmark') return a.level === b.level && a.corner === b.corner;
    return a.side === b.side && a.part === b.part;
  }

  // Tab stops are per femoral SIDE: the rim handle is not a stop of its own, so a rim
  // selection resolves to its side's centre stop for cycling purposes.
  function sameStop(stop, current) {
    if (stop.kind !== current.kind) return false;
    if (stop.kind === 'landmark') return stop.level === current.level && stop.corner === current.corner;
    return stop.side === current.side;
  }

  export function nextSelection(current, direction) {
    const step = direction < 0 ? -1 : 1;
    const last = FULL_ORDER.length - 1;
    const index = current ? FULL_ORDER.findIndex((stop) => sameStop(stop, current)) : -1;
    if (index === -1) return step > 0 ? FULL_ORDER[0] : FULL_ORDER[last];
    return FULL_ORDER[(index + step + FULL_ORDER.length) % FULL_ORDER.length];
  }
  ```

- [ ] Run `node --test test/interactions.test.js` — 18/18 pass.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add sameHandle and nextSelection for Tab/Shift+Tab cycling"
  ```

---

## Task 4: `setFemoralCircle` and `nudge`

**Files:** `renderer/viewer/geometry.js`, `test/geometry.test.js`, `renderer/viewer/interactions.js`, `test/interactions.test.js`

**Interfaces:**
- Produces in `geometry.js`: `FEMORAL_SIDES`, `femoralCircle(geometry, side)`, `setFemoralCircle(geometry, side, circle)` — the femoral analogue of `landmarkAt`/`setLandmarkAt`.
- Produces in `interactions.js`: `nudge(geometry, selection, dx, dy)` (mutates `geometry`, per the contract).

`drawSelectedMeasurement` draws the pelvic constructions from `geometry.hip_midpoint`. Moving a
femoral centre without resyncing it would leave the S1/PT/PI line pointing at the old hip until
`/measure` answers. `setFemoralCircle` keeps `hip_midpoint` in sync exactly as `setLandmarkAt`
keeps `quadrilateral` in sync, using the backend's own formula (`backend/utils.py:304`: the mean
of the two centres). The rim has one degree of freedom — radius — so the nudge convention is
right/up grow, left/down shrink (`r + dx - dy`), floored at 1 px because the backend rejects a
non-positive radius (`utils.py:296`).

- [ ] Add `FEMORAL_SIDES, femoralCircle, setFemoralCircle` to the import in `test/geometry.test.js` and append:

  ```js
  test('femoralCircle reads index 0 for left and 1 for right', () => {
    const geometry = fakeGeometry();
    assert.deepEqual(FEMORAL_SIDES, ['left', 'right']);
    assert.deepEqual(femoralCircle(geometry, 'left'), [10, 140, 5]);
    assert.deepEqual(femoralCircle(geometry, 'right'), [20, 140, 5]);
  });

  test('setFemoralCircle writes one circle and keeps hip_midpoint at the mean of the centres', () => {
    const geometry = fakeGeometry();
    setFemoralCircle(geometry, 'right', [30, 150, 6]);
    assert.deepEqual(geometry.femoral_circles[1], [30, 150, 6]);
    assert.deepEqual(geometry.femoral_circles[0], [10, 140, 5]);
    assert.deepEqual(geometry.hip_midpoint, [20, 145]);
  });
  ```

- [ ] Add `nudge` to the import in `test/interactions.test.js` and append:

  ```js
  function sampleGeometry() {
    return {
      vertebrae: {
        L1: { superior: [[10, 10], [20, 10]], inferior: [[10, 20], [20, 20]], quadrilateral: [[10, 10], [20, 10], [20, 20], [10, 20]] },
        L2: { superior: [[10, 30], [20, 30]], inferior: [[10, 40], [20, 40]], quadrilateral: [[10, 30], [20, 30], [20, 40], [10, 40]] },
        L3: { superior: [[10, 50], [20, 50]], inferior: [[10, 60], [20, 60]], quadrilateral: [[10, 50], [20, 50], [20, 60], [10, 60]] },
        L4: { superior: [[10, 70], [20, 70]], inferior: [[10, 80], [20, 80]], quadrilateral: [[10, 70], [20, 70], [20, 80], [10, 80]] },
        L5: { superior: [[10, 90], [20, 90]], inferior: [[10, 100], [20, 100]], quadrilateral: [[10, 90], [20, 90], [20, 100], [10, 100]] },
      },
      s1_superior: [[10, 110], [20, 110]],
      l1_center: [15, 15],
      hip_midpoint: [100, 150],
      femoral_circles: [[50, 150, 20], [150, 150, 25]],
    };
  }

  test('nudge moves a landmark by dx, dy', () => {
    const geometry = sampleGeometry();
    nudge(geometry, { kind: 'landmark', level: 'L1', corner: 'SA' }, 3, -2);
    assert.deepEqual(geometry.vertebrae.L1.superior[0], [13, 8]);
  });

  test('nudge on a landmark keeps the quadrilateral in sync', () => {
    const geometry = sampleGeometry();
    nudge(geometry, { kind: 'landmark', level: 'L2', corner: 'IP' }, 1, 1);
    assert.deepEqual(geometry.vertebrae.L2.quadrilateral[2], geometry.vertebrae.L2.inferior[1]);
    assert.deepEqual(geometry.vertebrae.L2.inferior[1], [21, 41]);
  });

  test('nudge moves S1 SA and SP through s1_superior', () => {
    const geometry = sampleGeometry();
    nudge(geometry, { kind: 'landmark', level: 'S1', corner: 'SA' }, 5, 5);
    assert.deepEqual(geometry.s1_superior[0], [15, 115]);
    nudge(geometry, { kind: 'landmark', level: 'S1', corner: 'SP' }, -1, 0);
    assert.deepEqual(geometry.s1_superior[1], [19, 110]);
  });

  test('nudge on a femoral centre translates cx, cy and resyncs hip_midpoint', () => {
    const geometry = sampleGeometry();
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'center' }, 4, -3);
    assert.deepEqual(geometry.femoral_circles[0], [54, 147, 20]);
    assert.deepEqual(geometry.hip_midpoint, [102, 148.5]);
  });

  test('nudge on a femoral centre uses index 1 for the right side', () => {
    const geometry = sampleGeometry();
    nudge(geometry, { kind: 'femoral', side: 'right', part: 'center' }, 1, 1);
    assert.deepEqual(geometry.femoral_circles[1], [151, 151, 25]);
    assert.deepEqual(geometry.femoral_circles[0], [50, 150, 20]);
  });

  test('nudge on a femoral rim grows the radius on right/up, shrinks on left/down, and leaves the centre alone', () => {
    const geometry = sampleGeometry();
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'rim' }, 1, 0);
    assert.equal(geometry.femoral_circles[0][2], 21);
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'rim' }, 0, -1);
    assert.equal(geometry.femoral_circles[0][2], 22);
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'rim' }, -1, 0);
    assert.equal(geometry.femoral_circles[0][2], 21);
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'rim' }, 0, 1);
    assert.equal(geometry.femoral_circles[0][2], 20);
    assert.deepEqual(geometry.femoral_circles[0].slice(0, 2), [50, 150]);
    assert.deepEqual(geometry.hip_midpoint, [100, 150]);
  });

  test('nudge on a femoral rim never drops the radius below 1', () => {
    const geometry = sampleGeometry();
    geometry.femoral_circles[0] = [50, 150, 0.5];
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'rim' }, -10, 0);
    assert.equal(geometry.femoral_circles[0][2], 1);
  });
  ```

- [ ] Run `node --test test/geometry.test.js test/interactions.test.js` and confirm the nine new tests fail.

- [ ] Append to `renderer/viewer/geometry.js`:

  ```js
  // Femoral circle index 0 is left, 1 is right, per the architecture contract's Geometry shape.
  export const FEMORAL_SIDES = ['left', 'right'];

  export function femoralCircle(geometry, side) {
    return geometry.femoral_circles[side === 'left' ? 0 : 1];
  }

  // Writes one circle and keeps hip_midpoint in sync, the way setLandmarkAt keeps
  // quadrilateral in sync. hip_midpoint is the mean of the two centres, which is exactly how
  // the backend derives it (backend/utils.py:304), so the pelvic constructions drawn between
  // /measure round-trips agree with what the round-trip will return.
  export function setFemoralCircle(geometry, side, circle) {
    geometry.femoral_circles[side === 'left' ? 0 : 1] = circle;
    const [a, b] = geometry.femoral_circles;
    geometry.hip_midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return geometry;
  }
  ```

- [ ] In `renderer/viewer/interactions.js`, extend the geometry import to
  `import { clientToImage, LEVELS, CORNERS, landmarkAt, setLandmarkAt, femoralCircle, setFemoralCircle } from './geometry.js';`
  and append:

  ```js
  // Moves the selected handle by (dx, dy) image pixels. Mutates `geometry` -- callers hand it
  // a working copy, never the store's object (see components/viewer.js).
  export function nudge(geometry, selection, dx, dy) {
    if (selection.kind === 'landmark') {
      const [x, y] = landmarkAt(geometry, selection.level, selection.corner);
      setLandmarkAt(geometry, selection.level, selection.corner, [x + dx, y + dy]);
      return geometry;
    }
    const [cx, cy, r] = femoralCircle(geometry, selection.side);
    if (selection.part === 'center') {
      return setFemoralCircle(geometry, selection.side, [cx + dx, cy + dy, r]);
    }
    // The rim has one degree of freedom. Right/up grow the radius, left/down shrink it,
    // floored at 1px: the backend rejects a non-positive radius (backend/utils.py:296).
    return setFemoralCircle(geometry, selection.side, [cx, cy, Math.max(1, r + dx - dy)]);
  }
  ```

- [ ] Run `node --test test/geometry.test.js test/interactions.test.js` — 12 + 25 pass.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add setFemoralCircle and nudge for landmark and femoral selections"
  ```

---

## Task 5: `hitTestFemoral`, `arrowKeyDelta` and `debounce`

**Files:** `renderer/viewer/interactions.js`, `test/interactions.test.js`

**Interfaces:**
- Produces: `hitTestFemoral(circles, x, y, radius = 14)` → `Selection | null`, coordinate-space
  agnostic (Task 11 feeds it circles already mapped into client space, so the hit radius is a
  constant 14 CSS px like `nearestLandmark`'s); `arrowKeyDelta(key, shiftKey)` → `{dx, dy} | null`
  (1 px, 10 px with Shift, spec §12); `debounce(fn, ms)` → debounced function with `.cancel()`.

- [ ] Add `hitTestFemoral, arrowKeyDelta, debounce` to the test file's import line and append:

  ```js
  test('hitTestFemoral finds the left centre when the point is inside the hit radius', () => {
    const circles = [[50, 150, 20], [150, 150, 25]];
    assert.deepEqual(hitTestFemoral(circles, 52, 151, 14), { kind: 'femoral', side: 'left', part: 'center' });
  });

  test('hitTestFemoral finds the right rim when the point sits near the circumference', () => {
    const circles = [[50, 150, 20], [150, 150, 25]];
    assert.deepEqual(hitTestFemoral(circles, 174, 150, 14), { kind: 'femoral', side: 'right', part: 'rim' });
  });

  test('hitTestFemoral returns null outside every hit radius', () => {
    const circles = [[50, 150, 20], [150, 150, 25]];
    assert.equal(hitTestFemoral(circles, 400, 400, 14), null);
  });

  test('hitTestFemoral prefers the closer of centre and rim when both are within radius', () => {
    assert.deepEqual(hitTestFemoral([[0, 0, 8]], 2, 0, 14), { kind: 'femoral', side: 'left', part: 'center' });
  });

  test('arrowKeyDelta maps arrow keys to 1px deltas', () => {
    assert.deepEqual(arrowKeyDelta('ArrowUp', false), { dx: 0, dy: -1 });
    assert.deepEqual(arrowKeyDelta('ArrowDown', false), { dx: 0, dy: 1 });
    assert.deepEqual(arrowKeyDelta('ArrowLeft', false), { dx: -1, dy: 0 });
    assert.deepEqual(arrowKeyDelta('ArrowRight', false), { dx: 1, dy: 0 });
  });

  test('arrowKeyDelta maps shift+arrow keys to 10px deltas', () => {
    assert.deepEqual(arrowKeyDelta('ArrowUp', true), { dx: 0, dy: -10 });
    assert.deepEqual(arrowKeyDelta('ArrowRight', true), { dx: 10, dy: 0 });
  });

  test('arrowKeyDelta returns null for non-arrow keys', () => {
    assert.equal(arrowKeyDelta('Tab', false), null);
    assert.equal(arrowKeyDelta('a', false), null);
  });

  test('debounce collapses rapid calls into one, using the last arguments', async () => {
    const calls = [];
    const debounced = debounce((value) => calls.push(value), 20);
    debounced('a');
    debounced('b');
    debounced('c');
    assert.equal(calls.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(calls, ['c']);
  });

  test('debounce.cancel prevents a pending call from firing', async () => {
    const calls = [];
    const debounced = debounce((value) => calls.push(value), 20);
    debounced('x');
    debounced.cancel();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(calls, []);
  });
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm the nine new tests fail.

- [ ] Append to `renderer/viewer/interactions.js`:

  ```js
  // Coordinate-space agnostic: operates on whatever space `circles` and (x, y) share. The
  // viewer feeds it circles mapped into client space so the hit radius is 14 CSS pixels at
  // any zoom, the same convention nearestLandmark uses.
  export function hitTestFemoral(circles, x, y, radius = 14) {
    let best = null;
    let bestDistance = Infinity;
    circles.forEach(([cx, cy, r], index) => {
      const side = FEMORAL_SIDES[index];
      const centerDistance = Math.hypot(x - cx, y - cy);
      if (centerDistance <= radius && centerDistance < bestDistance) {
        best = { kind: 'femoral', side, part: 'center' };
        bestDistance = centerDistance;
      }
      const rimDistance = Math.abs(centerDistance - r);
      if (rimDistance <= radius && rimDistance < bestDistance) {
        best = { kind: 'femoral', side, part: 'rim' };
        bestDistance = rimDistance;
      }
    });
    return best;
  }

  // 1px per press, 10px with Shift (spec section 12).
  export function arrowKeyDelta(key, shiftKey) {
    const amount = shiftKey ? 10 : 1;
    if (key === 'ArrowUp') return { dx: 0, dy: -amount };
    if (key === 'ArrowDown') return { dx: 0, dy: amount };
    if (key === 'ArrowLeft') return { dx: -amount, dy: 0 };
    if (key === 'ArrowRight') return { dx: amount, dy: 0 };
    return null;
  }

  export function debounce(fn, ms) {
    let timer = null;
    const debounced = (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, ms);
    };
    debounced.cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return debounced;
  }
  ```

  and add `FEMORAL_SIDES` to the geometry import line.

- [ ] Run `node --test test/interactions.test.js` — 34/34 pass. Run `node --test test/*.test.js` — 99 pass.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add hitTestFemoral, arrowKeyDelta and debounce"
  ```

---

## Task 6: (folded into Task 5)

`arrowKeyDelta` ships in Task 5. This heading is kept so task numbers stay stable against the ledger.

- [ ] Nothing to do.

---

## Task 7: (folded into Task 5)

`debounce` ships in Task 5. This heading is kept so task numbers stay stable against the ledger.

- [ ] Nothing to do.

---

## Task 8: One pointer pipeline in `components/viewer.js`

**Files:** `renderer/components/viewer.js`, `renderer/viewer/interactions.js`

**Interfaces:**
- Removes: `attachViewerInteractions` from `interactions.js` (and its now-unused `clientToImage` import).
- Produces: the module-scope transient-state block in `viewer.js` and the pointer handlers every
  later task extends. `mountViewer`'s return shape `{updateViewer, setImages, setRunHandler, detach}` is unchanged.

Pure refactor plus one spec item: **middle-button drag pans in every mode** (spec §12: "Panning
stays on the toolbar's pan toggle and on middle-drag"). Wheel zoom, pan-toggle drag and coarse
click-select behave exactly as before. Read `renderer/viewer/interactions.js:58-112` first: the
handlers below are that code, moved, with the closure's `dragStart` replaced by the shared `drag`.

- [ ] In `renderer/viewer/interactions.js`, delete `attachViewerInteractions` and its JSDoc block
  (lines 58–112 at BASE), delete the "NOTE ON COORDINATES" comment (lines 11–17 at BASE — it
  describes how the caller of `clientToImage` must behave, and that caller now lives in
  `viewer.js`, where the comment reappears below), and delete `clientToImage` from the geometry
  import. Run `node --test test/interactions.test.js` — still 34/34.

- [ ] In `renderer/components/viewer.js`, replace the two imports of `../viewer/interactions.js`
  and `../viewer/canvas.js` with:

  ```js
  import {
    createLayeredCanvases, sizeCanvases, drawStaticLayer, drawDynamicLayer,
  } from '../viewer/canvas.js';
  import { clientToImage } from '../viewer/geometry.js';
  import { zoomIn, zoomOut, vertebraAt } from '../viewer/interactions.js';
  ```

- [ ] Below the `ICONS` block, add the transient-state block. Every variable is declared here now;
  Tasks 11–14 populate them.

  ```js
  // ---------------------------------------------------------------------------
  // Transient interaction state. Module scope, NOT the store, per the architecture
  // contract's viewer/interactions.js section: only committed geometry reaches the store.
  //
  // One `drag` for every kind of gesture -- pan, landmark handle, femoral handle -- so two
  // gestures can never be live at once and there is one place to look for what the pointer
  // is doing. Plan 03 kept the pan drag in a closure inside interactions.js; it moved here so
  // plan 04's handle drag would not become a second copy. detach() resets all of it.
  let drag = null;           // {kind:'pan', clientX, clientY, panX, panY} | {kind:'handle', ...} | null
  let suppressClick = false; // a pointerdown that started a gesture eats the click that follows it
  let hover = null;          // Selection | null -- the handle under the pointer (Task 11)
  let retracing = false;     // Task 14
  let tracePoints = [];      // [x, y][] in image space (Task 14)
  ```

- [ ] Add a module-scope helper below `sameKey`:

  ```js
  function currentStudy() {
    const state = getState();
    return state.studies.find((s) => s.id === state.openId) ?? null;
  }
  ```

- [ ] Inside `mountViewer`, delete the whole `const detach = attachViewerInteractions(stage, dynamicCanvas, {...});`
  call (lines 112–124 at BASE) and, in the same place, add the pointer handlers and their wiring:

  ```js
    // NOTE ON COORDINATES, because this looks like a missing correction and is not.
    // clientToImage() derives its scale from canvas.getBoundingClientRect(), and the rect
    // ALREADY reflects the CSS `transform: translate(panX, panY) scale(zoom)` applied to the
    // canvases' shared host. Zoom and pan are therefore accounted for exactly once. Do not
    // "fix" a hit test by subtracting panX/panY or dividing by zoom -- that double-counts the
    // transform and every hit drifts further from the cursor the more you pan.

    function handleWheel(event) {
      event.preventDefault();
      setState((s) => ({ zoom: event.deltaY < 0 ? zoomIn(s.zoom) : zoomOut(s.zoom) }));
    }

    function startPan(event) {
      const state = getState();
      drag = { kind: 'pan', clientX: event.clientX, clientY: event.clientY, panX: state.panX, panY: state.panY };
      suppressClick = true;
      dynamicCanvas.setPointerCapture(event.pointerId);
    }

    // Gesture precedence: middle button pans in every mode (spec 12); the primary button pans
    // when the toolbar's pan toggle is on. Tasks 12-14 add edit-mode gestures after these
    // two checks, and only for the primary button. A second pointer while one gesture is
    // live (a second finger; the primary button pressed during a middle-drag) is ignored --
    // it would otherwise overwrite `drag` and re-capture under a different pointerId.
    function handlePointerDown(event) {
      if (drag) return;
      suppressClick = false;
      if (event.button === 1 || (event.button === 0 && getState().panMode)) {
        event.preventDefault();
        startPan(event);
      }
    }

    function handlePointerMove(event) {
      if (!drag) return;
      if (drag.kind === 'pan') {
        setState({
          panX: drag.panX + (event.clientX - drag.clientX),
          panY: drag.panY + (event.clientY - drag.clientY),
        });
      }
    }

    function handlePointerUp(event) {
      if (dynamicCanvas.hasPointerCapture(event.pointerId)) dynamicCanvas.releasePointerCapture(event.pointerId);
      drag = null;
    }

    // Coarse click-select: the vertebra under the pointer becomes the construction target.
    // A click that ended a gesture is not a selection.
    function handleClick(event) {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const study = currentStudy();
      if (!study || !study.geometry) return;
      const level = vertebraAt(study.geometry, clientToImage(event, dynamicCanvas));
      if (level) setState({ selectedLevel: level });
    }

    stage.addEventListener('wheel', handleWheel, { passive: false });
    dynamicCanvas.addEventListener('pointerdown', handlePointerDown);
    dynamicCanvas.addEventListener('pointermove', handlePointerMove);
    dynamicCanvas.addEventListener('pointerup', handlePointerUp);
    dynamicCanvas.addEventListener('pointercancel', handlePointerUp);
    dynamicCanvas.addEventListener('click', handleClick);

    function detach() {
      stage.removeEventListener('wheel', handleWheel);
      dynamicCanvas.removeEventListener('pointerdown', handlePointerDown);
      dynamicCanvas.removeEventListener('pointermove', handlePointerMove);
      dynamicCanvas.removeEventListener('pointerup', handlePointerUp);
      dynamicCanvas.removeEventListener('pointercancel', handlePointerUp);
      dynamicCanvas.removeEventListener('click', handleClick);
      drag = null;
      suppressClick = false;
      hover = null;
      retracing = false;
      tracePoints = [];
    }
  ```

  The existing `return { updateViewer, setImages, setRunHandler, detach };` now returns this local `detach`.

- [ ] Run `node --test test/*.test.js` — 99 pass (no test references the moved function). Run
  `node --check renderer/components/viewer.js renderer/viewer/interactions.js`.

- [ ] Verify the moved code is the old code: `git diff -- renderer/viewer/interactions.js`
  (working tree against the Task 5 commit) removes exactly the NOTE comment, the JSDoc +
  function, and one import name; nothing else in that file changes.

- [ ] Commit:

  ```
  git add -A && git commit -m "refactor: move stage pointer wiring into components/viewer.js with one drag state; add middle-drag pan"
  ```

---

## Task 9: Edit-mode toggle, edit bar, Escape, `aria-pressed`

**Files:** `renderer/components/viewer.js`, `styles/screens/analysis.css`, `renderer/screens/analysis.js`, `renderer/screens/studies.js`

**Interfaces:**
- Consumes: `getState`, `setState`, `el`.
- Produces: `editButton`, `editBar`, `doneButton`, `exitEditMode()`, `handleKeyDown` (extended by
  Tasks 15–16), and `aria-pressed` on the pan and overlay toggles (plan-03 deferred minor).

- [ ] In `renderer/components/viewer.js`, add two icons to `ICONS` (same 24-unit stroke style as the
  rest; these two are not in the design reference, which dropped landmark editing):

  ```js
    edit: `${SVG_OPEN}<path d="M12 20 H21"></path><path d="M16.5 3.5 a2.1 2.1 0 0 1 3 3 L7 19 L3 20 L4 16 Z"></path></svg>`,
    rerun: `${SVG_OPEN}<path d="M21 4 V10 H15"></path><path d="M3 20 V14 H9"></path><path d="M20.5 9.5 A8 8 0 0 0 5.6 6.6 L3 9"></path><path d="M3.5 14.5 A8 8 0 0 0 18.4 17.4 L21 15"></path></svg>`,
  ```

- [ ] Replace `toolButton` with a version that accepts extra props, and add `textButton`:

  ```js
  // Real <button>s, not <div>s: the toolbar has to be keyboard-reachable and
  // screen-reader-nameable, and `title` has to be a sentence rather than the icon.
  function toolButton(label, icon, onClick, props = {}) {
    return el('button', {
      type: 'button',
      class: 'viewer-tool',
      title: label,
      'aria-label': label,
      onClick,
      innerHTML: icon,
      ...props,
    });
  }

  // Text variant for the edit bar. Chivo Mono eyebrow, same 30px row as the icons.
  function textButton(label, onClick, props = {}) {
    return el('button', { type: 'button', class: 'viewer-tool viewer-tool-text', onClick, ...props }, label);
  }
  ```

- [ ] Inside `mountViewer`, make the two existing toggles carry `aria-pressed`, and add the edit
  toggle and the edit bar. Replace the `panButton`/`overlayButton` lines and the `toolbar` construction:

  ```js
    const panButton = toolButton('Pan', ICONS.pan, () => setState((s) => ({ panMode: !s.panMode })), { 'aria-pressed': 'false' });
    const overlayButton = toolButton('Toggle segmentation overlay', ICONS.overlays, () => setState((s) => ({ overlays: !s.overlays })), { 'aria-pressed': 'false' });
    const editButton = toolButton('Edit landmarks', ICONS.edit, () => {
      if (getState().editing) exitEditMode();
      else setState({ editing: true });
    }, { 'aria-pressed': 'false', disabled: true });
  ```

  ```js
    const toolbar = el('div', { class: 'viewer-toolbar' },
      toolButton('Zoom out', ICONS.zoomOut, () => setState((s) => ({ zoom: zoomOut(s.zoom) }))),
      zoomLabel,
      toolButton('Zoom in', ICONS.zoomIn, () => setState((s) => ({ zoom: zoomIn(s.zoom) }))),
      toolButton('Fit to view', ICONS.fit, () => setState({ zoom: 1, panX: 0, panY: 0 })),
      el('div', { class: 'viewer-divider' }),
      panButton,
      overlayButton,
      el('div', { class: 'viewer-divider' }),
      el('div', { class: 'viewer-fill' },
        el('div', { class: 'viewer-fill-label' }, 'FILL'),
        fillSlider),
      el('div', { class: 'viewer-divider' }),
      editButton);

    // Shown only while editing. Tasks 14 and 17 add RETRACE, FIT and RESET TO PREDICTION
    // before DONE.
    const doneButton = textButton('DONE', () => exitEditMode());
    const editBar = el('div', { class: 'viewer-editbar is-hidden' },
      el('div', { class: 'viewer-editbar-label' }, 'EDITING LANDMARKS'),
      doneButton);
  ```

  and change the stage assembly to `stage.append(host, chip, toolbar, editBar, footer, runCard);`.

- [ ] Add `exitEditMode` and the keyboard handler next to the pointer handlers from Task 8, and
  wire/unwire the listener:

  ```js
    // Retrace is bound to the selected femoral side (Task 14). Any selection change, and
    // every exit from edit mode, ends it.
    function cancelRetrace() {
      retracing = false;
      tracePoints = [];
    }

    // The one way out of edit mode. Clears every piece of transient edit state before the
    // store update so updateViewer sees a consistent picture.
    function exitEditMode() {
      cancelRetrace();
      hover = null;
      stage.classList.remove('is-over-handle');
      setState({ editing: false, selection: null });
    }

    // Keyboard lives on window: the canvas is not focusable and the shortcuts must work
    // wherever focus happens to be on the Analysis screen, except inside a text control.
    // Tasks 15 and 16 add Tab and Arrow branches after the Escape branch.
    function handleKeyDown(event) {
      const state = getState();
      if (!state.editing || state.running || drag) return;
      if (event.target instanceof Element && event.target.matches('input, select, textarea')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        exitEditMode();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
  ```

  and in `detach()` add `window.removeEventListener('keydown', handleKeyDown);`.

- [ ] In `applyTransform`, after the two `classList.toggle` lines for `panButton`/`overlayButton`, add:

  ```js
      panButton.setAttribute('aria-pressed', String(state.panMode));
      overlayButton.setAttribute('aria-pressed', String(state.overlays));
  ```

- [ ] In `updateViewer`, after the `runCard`/`hasResult` block, add:

  ```js
      // Edit mode needs geometry to edit and must not start under a running prediction.
      editButton.disabled = !hasResult || state.running;
      editButton.setAttribute('aria-pressed', String(state.editing));
      editButton.classList.toggle('is-active', state.editing);
      const editLabel = state.editing ? 'Done editing' : 'Edit landmarks';
      editButton.title = editLabel;
      editButton.setAttribute('aria-label', editLabel);
      editBar.classList.toggle('is-hidden', !state.editing);
      stage.classList.toggle('is-editing', state.editing);
  ```

- [ ] In `renderer/screens/analysis.js`, the back button's `onClick` becomes
  `() => setState({ screen: 'studies', editing: false, selection: null })`. In
  `renderer/screens/studies.js`'s `handleChoose`, add `editing: false, selection: null,` to the
  reset block after `panMode: false,` — a new film must not inherit the last one's edit state.
  (Plan 05: opening a persisted study from the list must reset these too.)

- [ ] Append to section 02 of `styles/screens/analysis.css`, after the `.run-button:focus-visible` rule:

  ```css
  /* --- Plan 04: landmark editing ------------------------------------------ */
  .viewer-tool:disabled { opacity: .35; cursor: not-allowed; }
  .viewer-tool:disabled:hover { background: transparent; color: var(--stage-muted); }

  .viewer-tool-text {
    width: auto;
    padding: 0 10px;
    font-family: 'Chivo Mono', monospace;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.13em;
  }

  /* Second glass bar, directly under the toolbar (14px top + 44px bar + 6px gap). */
  .viewer-editbar {
    position: absolute;
    top: 64px;
    right: 14px;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 6px;
    border-radius: 12px;
    background: var(--stage-chrome);
    border: 1px solid var(--stage-line);
    backdrop-filter: blur(8px);
  }
  .viewer-editbar.is-hidden { display: none; }
  .viewer-editbar-label {
    padding: 0 8px;
    font-family: 'Chivo Mono', monospace;
    font-size: 8px;
    font-weight: 500;
    letter-spacing: 0.14em;
    color: var(--stage-accent);
  }

  /* Cursors. While editing with the pan toggle on, a primary-button drag pans, not edits; the
     pan-mode rules resolve to the same `grab` the hover rule uses, so whichever wins on
     specificity the cursor is right. Kept last for readability, not for cascade order. */
  .viewer-stage.is-editing .viewer-canvas-dynamic { cursor: crosshair; }
  .viewer-stage.is-editing.is-over-handle .viewer-canvas-dynamic { cursor: grab; }
  .viewer-stage.is-editing.is-dragging-handle .viewer-canvas-dynamic { cursor: grabbing; }
  .viewer-stage.is-pan-mode .viewer-canvas-dynamic { cursor: grab; }
  .viewer-stage.is-pan-mode:active .viewer-canvas-dynamic { cursor: grabbing; }
  ```

- [ ] Run `node --test test/*.test.js` — 99 pass. `node --check` the three JS files. Confirm
  `grep -n "style:" renderer/components/viewer.js` finds no `el()` style prop and that no
  `subscribe(` appears in `renderer/components/viewer.js`.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add the edit-landmarks toggle, edit bar, Escape exit and aria-pressed on toolbar toggles"
  ```

---

## Task 10: Handle rendering on the dynamic layer

**Files:** `renderer/viewer/canvas.js`, `test/canvas.test.js`, `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `LEVELS`, `CORNERS`, `landmarkAt`, `femoralCircle`, `FEMORAL_SIDES` from `geometry.js`; `sameHandle` from `interactions.js`.
- Produces: `drawDynamicLayer(ctx, canvas, geometry, opts)` **extended** with
  `opts.editing`, `opts.selection`, `opts.hover`, `opts.tracePoints`, `opts.retracing`, `opts.pixelRatio`;
  `redrawDynamic(geometry)`, `pixelRatio()` and `liveGeometry()` inside `mountViewer`.

`drawDynamicLayer`'s existing body — outlines, S1 segment, femoral circles,
`drawSelectedMeasurement` — stays. With `opts.editing` false the output is pixel-identical to
BASE. In edit mode the handles are drawn **after** the construction so they sit on top, at a
constant on-screen size via `pixelRatio` (image px per CSS px). The femoral circle whose side
is selected strokes in the selected colour so a rim drag has a visible target.

- [ ] Append to `test/canvas.test.js` (add `drawDynamicLayer` to its import; copy `fakeGeometry`
  from `test/geometry.test.js`):

  ```js
  // A 2D context stand-in that records every method call. Canvas code is otherwise
  // untestable here; this pins the one structural fact the design depends on -- how many
  // handles exist, and when.
  function recordingContext() {
    const calls = [];
    const ctx = new Proxy({}, {
      get(target, prop) {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop in target) return target[prop];
        return (...args) => { calls.push([prop, args]); };
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    });
    return { ctx, calls };
  }

  function arcCount(calls) {
    return calls.filter(([name]) => name === 'arc').length;
  }

  test('drawDynamicLayer draws no handles outside edit mode', () => {
    const { ctx, calls } = recordingContext();
    drawDynamicLayer(ctx, { width: 200, height: 150 }, fakeGeometry(), { selectedLevel: null, measurements: null, editing: false });
    assert.equal(arcCount(calls), 2, 'only the two femoral circles');
  });

  test('drawDynamicLayer draws 22 landmark and 4 femoral handles in edit mode', () => {
    const { ctx, calls } = recordingContext();
    drawDynamicLayer(ctx, { width: 200, height: 150 }, fakeGeometry(), {
      selectedLevel: null, measurements: null, editing: true, selection: null, hover: null, pixelRatio: 1,
    });
    assert.equal(arcCount(calls), 2 + 22 + 4);
  });

  test('a selected handle gets a ring and a label, a hovered handle gets a label', () => {
    const { ctx, calls } = recordingContext();
    drawDynamicLayer(ctx, { width: 200, height: 150 }, fakeGeometry(), {
      selectedLevel: null, measurements: null, editing: true, pixelRatio: 1,
      selection: { kind: 'landmark', level: 'L2', corner: 'SA' },
      hover: { kind: 'femoral', side: 'right', part: 'rim' },
    });
    assert.equal(arcCount(calls), 2 + 22 + 4 + 1, 'one extra arc for the selection ring');
    const labels = calls.filter(([name]) => name === 'fillText').map(([, args]) => args[0]);
    assert.deepEqual(labels, ['L2 SA', 'Right head \u00B7 resize']);
  });
  ```

- [ ] Run `node --test test/canvas.test.js` — the three new tests fail (26 arcs expected, 2 drawn; no labels).

- [ ] In `renderer/viewer/canvas.js`, change the geometry import to
  `import { LEVELS, CORNERS, landmarkAt, femoralCircle, FEMORAL_SIDES } from './geometry.js';`
  and add `import { sameHandle } from './interactions.js';`. Change the first line of the
  comment above `STAGE_LINE_COLOR` (canvas.js:116 at BASE, "The four off-theme literals the
  architecture contract sanctions for this file, and the only hardcoded colours anywhere in
  plan 03's JavaScript.") to "The four off-theme literals the architecture contract sanctions
  for the stage itself; plan 04's edit-mode literals follow CANVAS_MONO below." Then, below the
  existing `CANVAS_MONO` constant, add:

  ```js
  // Plan 04 additions to this file's literal set. All of them are pixels drawn INTO the
  // canvas, which is the exception the architecture contract grants viewer/canvas.js:
  // the stage background (the contract's first literal) as the handle outline; the legacy
  // editor's four per-corner colours (renderer.js:43, historical); the femoral handle colour,
  // which is the overlay's own femoral green; and the retrace point colour.
  const STAGE_BG_COLOR = '#0B0A09';
  const CORNER_COLORS = { SA: '#32d4ff', SP: '#64e19a', IA: '#ffb259', IP: '#fa78d4' };
  const FEMORAL_HANDLE_COLOR = `rgb(${FEMORAL_OVERLAY_COLOR.join(',')})`;
  const TRACE_COLOR = '#ffe071';

  // Handles keep a constant size ON SCREEN, unlike the outlines, which scale with the image.
  // Every handle dimension below is in CSS pixels and is multiplied by opts.pixelRatio
  // (image pixels per CSS pixel at the current fit and zoom) at draw time.
  const HANDLE_RADIUS_PX = 5;
  const HANDLE_HOVER_RADIUS_PX = 8;
  const HANDLE_RING_RADIUS_PX = 10;
  const HANDLE_LABEL_PX = 11;
  ```

- [ ] Add the handle drawing functions above `drawDynamicLayer`:

  ```js
  function drawHandle(ctx, canvas, point, color, { selected, hovered, label, pixelRatio }) {
    const radius = (hovered ? HANDLE_HOVER_RADIUS_PX : HANDLE_RADIUS_PX) * pixelRatio;
    if (selected) {
      ctx.beginPath();
      ctx.arc(point[0], point[1], HANDLE_RING_RADIUS_PX * pixelRatio, 0, 2 * Math.PI);
      ctx.strokeStyle = STAGE_SELECTED_COLOR;
      ctx.lineWidth = 2 * pixelRatio;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(point[0], point[1], radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = STAGE_BG_COLOR;
    ctx.lineWidth = pixelRatio;
    ctx.stroke();
    if (!(selected || hovered) || !label) return;
    const fontSize = HANDLE_LABEL_PX * pixelRatio;
    const pad = 4 * pixelRatio;
    ctx.font = `600 ${fontSize}px ${CANVAS_MONO}`;
    const width = ctx.measureText(label).width + 2 * pad;
    const height = fontSize + 2 * pad;
    // Keep the plate inside the canvas, as drawMeasurementLabel does.
    const x = Math.max(0, Math.min(point[0] + radius + 2 * pad, canvas.width - width));
    const y = Math.max(0, Math.min(point[1] - radius - height, canvas.height - height));
    ctx.fillStyle = LABEL_PLATE_FILL;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = STAGE_LABEL_FILL;
    ctx.textBaseline = 'top';
    ctx.fillText(label, x + pad, y + pad);
    ctx.textBaseline = 'alphabetic';
  }

  // 22 landmark handles (every corner of L1-L5, SA/SP of S1) and 4 femoral handles (centre
  // and a rim handle at 3 o'clock per side). Order matters only for labels: a selected or
  // hovered handle's label is drawn with it, so later handles can overlap it.
  function drawHandles(ctx, canvas, geometry, { selection, hover, pixelRatio }) {
    const handleOpts = (handle, label) => ({
      selected: sameHandle(selection, handle),
      hovered: sameHandle(hover, handle),
      label,
      pixelRatio,
    });
    for (const level of [...LEVELS, 'S1']) {
      for (const corner of level === 'S1' ? ['SA', 'SP'] : CORNERS) {
        const handle = { kind: 'landmark', level, corner };
        drawHandle(ctx, canvas, landmarkAt(geometry, level, corner), CORNER_COLORS[corner], handleOpts(handle, `${level} ${corner}`));
      }
    }
    for (const side of FEMORAL_SIDES) {
      const [cx, cy, r] = femoralCircle(geometry, side);
      const name = side === 'left' ? 'Left head' : 'Right head';
      drawHandle(ctx, canvas, [cx, cy], FEMORAL_HANDLE_COLOR, handleOpts({ kind: 'femoral', side, part: 'center' }, name));
      drawHandle(ctx, canvas, [cx + r, cy], FEMORAL_HANDLE_COLOR, handleOpts({ kind: 'femoral', side, part: 'rim' }, `${name} \u00B7 resize`));
    }
  }

  function drawTracePoints(ctx, canvas, tracePoints, pixelRatio) {
    const fontSize = HANDLE_LABEL_PX * pixelRatio;
    ctx.font = `600 ${fontSize}px ${CANVAS_MONO}`;
    tracePoints.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc(point[0], point[1], HANDLE_RADIUS_PX * pixelRatio, 0, 2 * Math.PI);
      ctx.fillStyle = TRACE_COLOR;
      ctx.fill();
      ctx.strokeStyle = STAGE_BG_COLOR;
      ctx.lineWidth = pixelRatio;
      ctx.stroke();
      ctx.fillStyle = STAGE_LABEL_FILL;
      ctx.fillText(String(index + 1), point[0] + 8 * pixelRatio, point[1] - 8 * pixelRatio);
    });
  }
  ```

- [ ] In `drawDynamicLayer`, change the femoral-circle loop so the selected side is highlighted in
  edit mode, and append the handle pass after `drawSelectedMeasurement`:

  ```js
    geometry.femoral_circles.forEach(([x, y, r], index) => {
      const selectedCircle = Boolean(opts.editing) && opts.selection?.kind === 'femoral'
        && opts.selection.side === FEMORAL_SIDES[index];
      ctx.strokeStyle = selectedCircle ? STAGE_SELECTED_COLOR : STAGE_LINE_COLOR;
      ctx.lineWidth = selectedCircle ? lineWidth * 1.6 : lineWidth;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
    });

    drawSelectedMeasurement(ctx, canvas, geometry, selectedLevel, opts.measurements);

    // Handles exist only in edit mode -- outside it the stage is exactly plan 03's
    // user-verified rendering -- and are drawn LAST so they sit above the construction lines.
    if (!opts.editing) return;
    const pixelRatio = opts.pixelRatio ?? 1;
    drawHandles(ctx, canvas, geometry, { selection: opts.selection ?? null, hover: opts.hover ?? null, pixelRatio });
    if (opts.retracing) drawTracePoints(ctx, canvas, opts.tracePoints ?? [], pixelRatio);
  ```

  (The `ctx.strokeStyle = STAGE_LINE_COLOR; ctx.lineWidth = lineWidth;` pair that preceded the
  loop is now set inside it; delete the pair.)

- [ ] Run `node --test test/canvas.test.js` — 6/6 pass.

- [ ] In `renderer/components/viewer.js`, replace the `sameKey` comment block (the one headed
  "Redraw gating compares by REFERENCE" / "PLAN 04, READ THIS") with:

  ```js
  // Redraw gating compares by REFERENCE, not by JSON.stringify: the dynamic key contains
  // study.geometry, and stringifying a full geometry object on every pointermove frame is
  // exactly the per-frame cost the layered design exists to avoid. Reference equality holds
  // because nothing mutates the store's geometry in place: /predict and /measure replace it
  // wholesale, and every edit in this file works on a structuredClone and commits that clone
  // as a new reference (see handlePointerUp, handleKeyDown, applyFit, resetToPrediction).
  ```

- [ ] Inside `mountViewer`, add the redraw helpers before the pointer handlers:

  ```js
    // Image pixels per CSS pixel at the current fit and zoom. Read from layout, so it is
    // right after a zoom, a resize or a sidebar collapse without anything having to say so.
    function pixelRatio() {
      const rect = dynamicCanvas.getBoundingClientRect();
      return rect.width > 0 ? dynamicCanvas.width / rect.width : 1;
    }

    // The geometry the stage should show right now: a live drag's working copy, else the store's.
    function liveGeometry() {
      if (drag && drag.kind === 'handle') return drag.geometry;
      const study = currentStudy();
      return study ? study.geometry : null;
    }

    // The ONE place the dynamic layer is drawn from. Store-driven redraws reach it through
    // updateViewer's reference-keyed gate; per-frame drag and hover redraws call it directly
    // with the working geometry. Both compose the same options, so there is exactly one
    // notion of what the dynamic layer shows.
    function redrawDynamic(geometry) {
      const state = getState();
      const study = currentStudy();
      drawDynamicLayer(dynamicCtx, dynamicCanvas, geometry, {
        selectedLevel: state.selectedLevel,
        measurements: study ? study.measurements : null,
        editing: state.editing,
        selection: state.selection,
        hover,
        tracePoints,
        retracing,
        pixelRatio: pixelRatio(),
      });
    }

    // Handle sizes are in CSS pixels, so a stage resize (window, sidebar collapse) changes
    // their image-space radius. Only edit mode draws anything size-dependent.
    const resizeObserver = new ResizeObserver(() => {
      if (getState().editing) redrawDynamic(liveGeometry());
    });
    resizeObserver.observe(stage);
  ```

  and in `detach()` add `resizeObserver.disconnect();`.

- [ ] In `updateViewer`, replace the dynamic-key block with:

  ```js
      // editing, selection and zoom are in the key: handles appear and disappear with
      // editing, follow selection, and are sized in CSS pixels so zoom changes their image-
      // space size. panX/panY are deliberately NOT here -- a pan moves the host, not the pixels.
      const dynamicKey = [study.geometry, state.selectedLevel, study.measurements, state.editing, state.selection, state.zoom];
      if (!sameKey(dynamicKey, lastDynamic)) {
        lastDynamic = dynamicKey;
        redrawDynamic(liveGeometry());
      }
  ```

- [ ] Run `node --test test/*.test.js` — 102 pass. `node --check` both files. Confirm
  `grep -c "drawDynamicLayer(" renderer/components/viewer.js` prints exactly `1` — the call
  inside `redrawDynamic`; the import line has no parenthesis and does not match.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: render 22 landmark and 4 femoral handles on the dynamic layer in edit mode"
  ```

---

## Task 11: Hover detection

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `nearestLandmark`, `imageToClient` from `geometry.js`; `hitTestFemoral`, `sameHandle` from `interactions.js`.
- Produces: `hitTestHandle(geometry, event)` and `setHover(next)` inside `mountViewer` (both used by Task 12).

Hovering (pointermove with no live drag) enlarges the nearest handle and labels it, per
spec §12. The redraw is gated on the hovered handle actually changing, so moving the pointer
across empty stage costs nothing.

- [ ] Extend the imports: `import { clientToImage, imageToClient, nearestLandmark } from '../viewer/geometry.js';`
  and `import { zoomIn, zoomOut, vertebraAt, sameHandle, hitTestFemoral } from '../viewer/interactions.js';`.

- [ ] Add inside `mountViewer`, before the pointer handlers:

  ```js
    // Landmarks first, then femoral handles. The two sets are anatomically far apart, so the
    // order only matters in a degenerate geometry.
    function hitTestHandle(geometry, event) {
      const landmark = nearestLandmark(geometry, event.clientX, event.clientY, dynamicCanvas);
      if (landmark) return { kind: 'landmark', level: landmark.level, corner: landmark.corner };
      // hitTestFemoral is coordinate-space agnostic; feed it the circles in CLIENT space so
      // the hit radius is a constant 14 CSS pixels at any zoom, as nearestLandmark's is.
      const rect = dynamicCanvas.getBoundingClientRect();
      const scale = rect.width / dynamicCanvas.width;
      const circles = geometry.femoral_circles.map(([cx, cy, r]) => [...imageToClient([cx, cy], rect, dynamicCanvas), r * scale]);
      return hitTestFemoral(circles, event.clientX, event.clientY);
    }

    function setHover(next) {
      if (next === hover || sameHandle(hover, next)) return;
      hover = next;
      stage.classList.toggle('is-over-handle', Boolean(hover));
      redrawDynamic(liveGeometry());
    }
  ```

- [ ] Extend `handlePointerMove` so a move with no live drag drives hover, and add a leave handler:

  ```js
    function handlePointerMove(event) {
      if (!drag) {
        const state = getState();
        if (!state.editing || retracing) return;
        const study = currentStudy();
        if (!study || !study.geometry) return;
        setHover(hitTestHandle(study.geometry, event));
        return;
      }
      if (drag.kind === 'pan') {
        setState({
          panX: drag.panX + (event.clientX - drag.clientX),
          panY: drag.panY + (event.clientY - drag.clientY),
        });
      }
    }

    function handlePointerLeave() {
      if (!drag) setHover(null);
    }
  ```

  Register `dynamicCanvas.addEventListener('pointerleave', handlePointerLeave);` with the others
  and remove it in `detach()`.

- [ ] Run `node --test test/*.test.js` — 102 pass. `node --check renderer/components/viewer.js`.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: enlarge and label the hovered handle"
  ```

- [ ] **MANUAL VERIFICATION — GATE 1** (stop and ask the user; the controller runs a CDP smoke
  pass first and reports what it saw). Launch from source (see the seams section), choose a
  radiograph, run segmentation.
  1. Parity: wheel zoom, the Fit button, the pan toggle plus primary-button drag, and clicking a
     vertebra to select its construction all behave as before this plan. Middle-button drag pans
     with the pan toggle **off**. Clicking a row in the panel still highlights and draws.
  2. The toolbar ends with a pencil button (`Edit landmarks`). Before segmentation it is
     disabled; after, enabled. Click it: it shows an active state, an `EDITING LANDMARKS` bar
     with `DONE` appears under the toolbar, and 22 landmark dots (cyan/green/orange/pink) plus a
     green centre dot and rim dot on each femoral circle appear. The dots are the same size at
     every zoom level and do not scale with the image.
  3. Press `Escape`: edit mode exits, the dots vanish, the pencil is no longer active. Re-enter,
     click `DONE`: same. Re-enter, click the pencil: same.
  4. In edit mode, hover `L3 SA` without clicking: it grows and an `L3 SA` label appears; move
     away and it shrinks. Hover a rim dot: `Left head · resize` (or Right). The cursor is a
     crosshair over the stage and a hand over a handle.
  5. Pan toggle on while editing: primary-button drag pans; handles do not react.
  6. Open DevTools (Ctrl+Shift+I): no console errors during any of the above.

---

## Task 12: Click-select and drag-move landmarks, debounced `/measure`

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `setLandmarkAt` from `geometry.js`; `measure` from `api.js`; `showToast` from `toast.js`; `debounce` from `interactions.js`.
- Produces (module scope): `recalculateMeasurements(studyId)`, `scheduleMeasure(studyId)`,
  `commitGeometry(studyId, geometry)`; used by Tasks 13–17.

Pointer capture and the drag lifecycle follow the legacy editor. Every `pointermove` during a
drag mutates the **working copy** and redraws only the dynamic canvas; `pointerup` commits the
copy as a new reference and schedules a debounced `/measure` bound to the study id. The
legacy `measureRevision` guard is preserved, now as one counter per study, so a stale
response never overwrites a newer one and one study's re-run cannot silence another's correction.

- [ ] Extend the imports: add `setLandmarkAt` to the geometry import, `debounce` to the
  interactions import, and add `import { measure } from '../api.js';` and
  `import { showToast } from './toast.js';`. Add `const MEASURE_DEBOUNCE_MS = 150;` below `ICONS`.

- [ ] Add at module scope, below the transient-state block:

  ```js
  // ---------------------------------------------------------------------------
  // The /measure round-trip. Bound to a study id at schedule time: reading openId when the
  // timer fires would measure whichever study is open 150ms later and rewrite ITS geometry.
  //
  // Revisions are PER STUDY, and so is the record of whose call the single debounce holds.
  // A stale response is orphaned by its own study's counter, so re-running or resetting
  // study B (which discards B's pending correction) can never orphan or cancel a correction
  // made on study A.
  const measureRevisions = new Map(); // studyId -> latest revision issued
  let pendingMeasureId = null;        // the study whose call sits in the debounce, or null

  function bumpRevision(studyId) {
    const next = (measureRevisions.get(studyId) ?? 0) + 1;
    measureRevisions.set(studyId, next);
    return next;
  }

  async function recalculateMeasurements(studyId) {
    pendingMeasureId = null;
    const revision = bumpRevision(studyId);
    const study = getState().studies.find((item) => item.id === studyId);
    if (!study || !study.geometry) return;
    try {
      const result = await measure({
        vertebrae: study.geometry.vertebrae,
        s1_superior: study.geometry.s1_superior,
        femoral_circles: study.geometry.femoral_circles,
      });
      if (revision !== measureRevisions.get(studyId)) return;
      setState((current) => ({
        studies: current.studies.map((item) => (item.id === studyId
          ? { ...item, measurements: result.measurements, geometry: result.geometry }
          : item)),
      }));
    } catch (error) {
      if (revision === measureRevisions.get(studyId)) showToast(`Could not update measurements: ${error.message}`);
    }
  }

  const scheduleMeasure = debounce(recalculateMeasurements, MEASURE_DEBOUNCE_MS);

  // Commits an edited geometry as a NEW reference and schedules the re-measure. Every edit
  // path ends here: drag release, keyboard nudge, retrace fit. One debounce serves every
  // study, so a correction still pending for ANOTHER study is flushed first rather than
  // silently replaced -- a committed geometry must never be left beside stale measurements.
  function commitGeometry(studyId, geometry) {
    setState((current) => ({
      studies: current.studies.map((item) => (item.id === studyId ? { ...item, geometry } : item)),
    }));
    if (pendingMeasureId !== null && pendingMeasureId !== studyId) {
      scheduleMeasure.cancel();
      recalculateMeasurements(pendingMeasureId);
    }
    pendingMeasureId = studyId;
    scheduleMeasure(studyId);
  }

  // Drops any correction pending or in flight for ONE study: its geometry is about to be
  // replaced by a prediction or a reset, and a late /measure response must not overwrite that.
  function discardPendingMeasure(studyId) {
    bumpRevision(studyId);
    if (pendingMeasureId === studyId) {
      scheduleMeasure.cancel();
      pendingMeasureId = null;
    }
  }
  ```

- [ ] Extend `handlePointerDown` with the edit-mode branch after the pan checks:

  ```js
    function handlePointerDown(event) {
      if (drag) return;
      suppressClick = false;
      const state = getState();
      if (event.button === 1 || (event.button === 0 && state.panMode)) {
        event.preventDefault();
        startPan(event);
        return;
      }
      if (event.button !== 0 || !state.editing || state.running) return;
      const study = currentStudy();
      if (!study || !study.geometry) return;
      const hit = hitTestHandle(study.geometry, event);
      if (!hit) return; // empty stage: the click that follows still does the coarse vertebra select
      event.preventDefault();
      suppressClick = true;
      // Drag a WORKING COPY. The store's geometry is never mutated in place: the copy is
      // committed as a new reference on release, which is what this file's reference-keyed
      // redraw gate and router.js's key sets both require.
      drag = { kind: 'handle', selection: hit, geometry: structuredClone(study.geometry), studyId: study.id, moved: false };
      dynamicCanvas.setPointerCapture(event.pointerId);
      stage.classList.add('is-dragging-handle');
      setState({ selection: hit });
    }
  ```

- [ ] Extend `handlePointerMove`'s drag branch and `handlePointerUp`:

  ```js
      if (drag.kind === 'pan') {
        setState({
          panX: drag.panX + (event.clientX - drag.clientX),
          panY: drag.panY + (event.clientY - drag.clientY),
        });
        return;
      }
      const point = clientToImage(event, dynamicCanvas);
      const { selection, geometry } = drag;
      if (selection.kind === 'landmark') {
        setLandmarkAt(geometry, selection.level, selection.corner, point);
      }
      drag.moved = true;
      redrawDynamic(geometry);
  ```

  ```js
    function handlePointerUp(event) {
      if (dynamicCanvas.hasPointerCapture(event.pointerId)) dynamicCanvas.releasePointerCapture(event.pointerId);
      const ended = drag;
      drag = null;
      stage.classList.remove('is-dragging-handle');
      if (!ended || ended.kind !== 'handle') return;
      // A cancelled gesture (pen lifted out of range, window lost the pointer) discards the
      // working copy: the store still holds the pre-drag geometry, so redraw from it.
      if (event.type === 'pointercancel' || !ended.moved) {
        redrawDynamic(liveGeometry());
        return;
      }
      commitGeometry(ended.studyId, ended.geometry);
    }
  ```

- [ ] Run `node --test test/*.test.js` — 102 pass. `node --check renderer/components/viewer.js`.
  Confirm `grep -n "study.geometry\." renderer/components/viewer.js` shows reads only — no
  assignment into the store's geometry anywhere in the file.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: click-select and drag-move landmarks with a debounced, study-bound re-measure"
  ```

---

## Task 13: Femoral centre drag (translate) and rim drag (resize)

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `femoralCircle`, `setFemoralCircle` from `geometry.js` (Task 4).

Extends the drag branch from Task 12. The centre handle translates the circle; the rim handle's
radius tracks the pointer's distance from the unchanged centre, so the user can grab anywhere
near the circumference, not only the rendered 3 o'clock dot. `setFemoralCircle` keeps
`hip_midpoint` in sync so the pelvic construction follows the drag live.

- [ ] Add `femoralCircle, setFemoralCircle` to the geometry import.

- [ ] In `handlePointerMove`, replace the landmark-only `if` with:

  ```js
      if (selection.kind === 'landmark') {
        setLandmarkAt(geometry, selection.level, selection.corner, point);
      } else if (selection.part === 'center') {
        const [, , r] = femoralCircle(geometry, selection.side);
        setFemoralCircle(geometry, selection.side, [point[0], point[1], r]);
      } else {
        // Radius floored at 1px: the backend rejects a non-positive radius, and dragging the
        // rim back through the centre must shrink smoothly, never flip or go negative.
        const [cx, cy] = femoralCircle(geometry, selection.side);
        setFemoralCircle(geometry, selection.side, [cx, cy, Math.max(1, Math.hypot(point[0] - cx, point[1] - cy))]);
      }
  ```

- [ ] Run `node --test test/*.test.js` — 102 pass. `node --check renderer/components/viewer.js`.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: drag femoral centre handles to translate and rim handles to resize"
  ```

---

## Task 14: Retrace mode

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `fitCircle` from `geometry.js` (ported in plan 03 — consumed, never reimplemented).
- Produces: `retraceButton`, `fitButton` in the edit bar; `toggleRetrace()`, `applyFit()`,
  `updateEditBar(state, study)` inside `mountViewer` (`cancelRetrace()` exists since Task 9).

`RETRACE` is enabled only while a femoral handle is selected; `FIT` once at least three arc
points are placed. While retracing, a primary-button press on the stage places a point instead
of starting a drag, and hover is off. Any selection change cancels retrace (it is bound to the
selected side). Toggling `RETRACE` off clears the points — that is the undo.

- [ ] Add `fitCircle` to the geometry import.

- [ ] In the edit bar construction (Task 9), add the two buttons before `doneButton`:

  ```js
    const retraceButton = textButton('RETRACE', () => toggleRetrace(), { 'aria-pressed': 'false', disabled: true });
    const fitButton = textButton('FIT', () => applyFit(), { disabled: true });
    const doneButton = textButton('DONE', () => exitEditMode());
    const editBar = el('div', { class: 'viewer-editbar is-hidden' },
      el('div', { class: 'viewer-editbar-label' }, 'EDITING LANDMARKS'),
      retraceButton,
      fitButton,
      doneButton);
  ```

- [ ] Add the retrace functions inside `mountViewer`, near `exitEditMode`:

  ```js
    function toggleRetrace() {
      const state = getState();
      if (!state.selection || state.selection.kind !== 'femoral') return;
      const next = !retracing;
      cancelRetrace();
      retracing = next;
      // No hover highlight while placing points. Cleared directly (not via setHover) so
      // this handler redraws exactly once.
      hover = null;
      stage.classList.remove('is-over-handle');
      updateEditBar(state, currentStudy());
      redrawDynamic(liveGeometry());
    }

    function applyFit() {
      const state = getState();
      const study = currentStudy();
      if (!study || !study.geometry || !state.selection || state.selection.kind !== 'femoral') return;
      const fitted = fitCircle(tracePoints);
      if (!fitted) {
        // Collinear points have no circle. Never apply a guess.
        showToast('Those points do not describe a circle. Place them along the head contour.');
        return;
      }
      const geometry = structuredClone(study.geometry);
      setFemoralCircle(geometry, state.selection.side, fitted);
      cancelRetrace();
      commitGeometry(study.id, geometry);
    }

    // Edit-bar button states. Called from updateViewer on every notification and directly by
    // the retrace handlers; it only writes DOM, never the store. `study` is unused until
    // Task 17's reset button reads it.
    function updateEditBar(state, study) {
      const femoralSelected = Boolean(state.selection && state.selection.kind === 'femoral');
      retraceButton.disabled = !femoralSelected;
      retraceButton.setAttribute('aria-pressed', String(retracing));
      retraceButton.classList.toggle('is-active', retracing);
      fitButton.disabled = !retracing || tracePoints.length < 3;
    }
  ```

  `cancelRetrace` and `exitEditMode` come from Task 9; nothing to add there.

- [ ] In `handlePointerDown`, insert the retrace branch between the `study.geometry` guard and the hit test:

  ```js
      if (retracing) {
        event.preventDefault();
        suppressClick = true;
        tracePoints = [...tracePoints, clientToImage(event, dynamicCanvas)];
        updateEditBar(state, study);
        redrawDynamic(liveGeometry());
        return;
      }
  ```

- [ ] In `updateViewer`, after `stage.classList.toggle('is-editing', ...)`, add `updateEditBar(state, study);`.

- [ ] Run `node --test test/*.test.js` — 102 pass. `node --check renderer/components/viewer.js`.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add retrace mode for femoral head refitting"
  ```

- [ ] **MANUAL VERIFICATION — GATE 2** (stop and ask the user after the controller's CDP smoke pass).
  1. In edit mode, click `L2 IP`: it gets the accent ring and its label stays. Drag it: it follows
     the pointer smoothly, the L2 outline updates live, the radiograph never flickers. Release:
     within ~150 ms plus the round-trip the panel's `LUMBAR LORDOSIS` values change. With the
     `LL L2–S1` row selected, its construction line follows the drag live.
  2. DevTools → Network: drag one handle back and forth quickly, release once — exactly one
     `/measure` request.
  3. Drag `S1 SA`. With `SACRAL SLOPE` selected, its endplate line follows live; the SS value
     updates after release.
  4. Drag the left femoral **centre**: the whole circle translates, the rim dot moves with it,
     the radius does not change. With `PELVIC TILT` selected the hip-to-S1 line follows the
     drag live (hip midpoint resync). PT/PI/SS update after release.
  5. Drag the right femoral **rim** outward: the circle grows around a fixed centre. Drag it
     inward past the centre: it shrinks smoothly to a point and grows again — never flips.
     Grab the circle at 9 o'clock, not the dot: it still resizes.
  6. Select a femoral centre (click it). `RETRACE` becomes enabled; click it — it shows active,
     the cursor stays a crosshair, hovering handles no longer highlights. Click 4 points along
     the head's visible contour: numbered yellow dots, no drag starts. `FIT` enabled after the
     third. Click `FIT`: the circle re-fits, `RETRACE` turns off, the dots vanish, measurements
     update. Click `RETRACE`, place 2 points: `FIT` stays disabled. Click `RETRACE` again: points
     cleared, button inactive.
  7. Select a landmark: `RETRACE` is disabled. Press `Escape` while retracing with points placed:
     edit mode exits cleanly and re-entering shows no leftover dots.
  8. No console errors throughout.

---

## Task 15: Tab / Shift+Tab cycling

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `nextSelection` from `interactions.js` (Task 3).

- [ ] Add `nextSelection` to the interactions import. In `handleKeyDown`, after the `Escape` branch:

  ```js
      if (event.key === 'Tab') {
        // Inside the edit bar, Tab stays ordinary focus movement so RETRACE / FIT / RESET /
        // DONE remain keyboard-operable once focus is there (BD-11 d).
        if (event.target instanceof Element && event.target.closest('.viewer-editbar')) return;
        event.preventDefault();
        cancelRetrace(); // retrace is bound to the selected side; a new selection ends it
        setState({ selection: nextSelection(state.selection, event.shiftKey ? -1 : 1) });
        return;
      }
  ```

  (`selection` is in the dynamic key, so `updateViewer` redraws; nothing else to do.)

- [ ] Run `node --test test/*.test.js` — 102 pass. `node --check renderer/components/viewer.js`.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: wire Tab/Shift+Tab landmark cycling"
  ```

---

## Task 16: Arrow-key nudge

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `nudge`, `arrowKeyDelta` from `interactions.js` (Tasks 4–5); `commitGeometry` (Task 12).

- [ ] Add `nudge, arrowKeyDelta` to the interactions import. In `handleKeyDown`, after the `Tab` branch:

  ```js
      const delta = arrowKeyDelta(event.key, event.shiftKey);
      if (!delta || !state.selection) return;
      const study = currentStudy();
      if (!study || !study.geometry) return;
      event.preventDefault();
      const geometry = structuredClone(study.geometry);
      nudge(geometry, state.selection, delta.dx, delta.dy);
      commitGeometry(study.id, geometry);
  ```

  Each press commits a new reference and re-arms the 150 ms debounce, so a burst of presses
  produces one `/measure`. The `drag` guard at the top of the handler keeps a nudge from
  colliding with a live drag's working copy.

- [ ] Run `node --test test/*.test.js` — 102 pass. `node --check renderer/components/viewer.js`.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: wire arrow-key nudging with Shift for 10px steps"
  ```

---

## Task 17: Reset to prediction

**Files:** `renderer/components/viewer.js`, `renderer/screens/analysis.js`

**Interfaces:**
- Produces: `recordPrediction(studyId, {measurements, geometry})` **exported** from `viewer.js`,
  called by `screens/analysis.js`'s `runSegmentation` when `/predict` resolves; `resetButton` in the
  edit bar; `resetToPrediction()` inside `mountViewer`.

The prediction is snapshotted at the moment it arrives, keyed by study id, off the Study record
(plan 05 persists and validates that record). Reset restores **both** the measurements and the
geometry from the snapshot and makes no `/measure` call — see BD-5 for why a round-trip would not
reproduce the original L1PA. Session-scoped, like `screens/analysis.js`'s file payloads; plan 05
may persist it.

- [ ] Add at module scope in `viewer.js`, below `commitGeometry`:

  ```js
  // ---------------------------------------------------------------------------
  // The raw /predict output per study: the target of RESET TO PREDICTION. Kept off the Study
  // record (plan 05 persists and validates that record) and keyed by id, so a reset always
  // returns to THIS study's own prediction, however many studies were opened in between.
  const predictions = new Map();

  export function recordPrediction(studyId, { measurements, geometry }) {
    predictions.set(studyId, { measurements: structuredClone(measurements), geometry: structuredClone(geometry) });
    // A correction still pending or in flight belongs to the geometry this prediction just
    // replaced. Only THIS study's is dropped.
    discardPendingMeasure(studyId);
  }
  ```

- [ ] In the edit bar, add `resetButton` between `fitButton` and `doneButton`:

  ```js
    const resetButton = textButton('RESET TO PREDICTION', () => resetToPrediction(), { disabled: true });
  ```

  and add it to the `editBar` children in that position.

- [ ] Add inside `mountViewer`, near `applyFit`:

  ```js
    function resetToPrediction() {
      const study = currentStudy();
      const predicted = study ? predictions.get(study.id) : null;
      if (!predicted) return;
      cancelRetrace();
      // No /measure: the snapshot IS the prediction's own numbers. Orphan anything in flight.
      discardPendingMeasure(study.id);
      setState((current) => ({
        selection: null,
        studies: current.studies.map((item) => (item.id === study.id
          ? { ...item, measurements: structuredClone(predicted.measurements), geometry: structuredClone(predicted.geometry) }
          : item)),
      }));
    }
  ```

  and in `updateEditBar` add `resetButton.disabled = !study || !predictions.has(study.id);`.

- [ ] In `renderer/screens/analysis.js`, change the viewer import to
  `import { mountViewer, recordPrediction } from '../components/viewer.js';` and, in
  `runSegmentation`, call `recordPrediction(studyId, response);` immediately before the completing
  `setState` (after the `mounted.viewer.setImages` hand-off) — the reset button reads the map
  during that very notification.

- [ ] Run `node --test test/*.test.js` — 102 pass. `node --check` both files.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add Reset to prediction from a per-study prediction snapshot"
  ```

---

## Task 18: Re-run segmentation affordance

**Files:** `renderer/components/viewer.js`, `renderer/screens/analysis.js`

**Interfaces:**
- Produces: `rerunButton` in the toolbar sharing the run handler; the run card visible while
  `running` even when a result exists; predict completion exits edit mode.

Replaces the original Task 18 (delete the button-matrix editor): plan 03 never ported that
matrix, so there is nothing to delete. This is the handoff's "no longer cosmetic" item: without
a way to re-run, a study whose bitmaps were evicted from the single-entry image cache is
permanently image-less, and the plan-03 final review's Critical was unrecoverable for the same
reason.

- [ ] In `mountViewer`, declare these directly after `editButton` — before the
  `el('div', { class: 'viewer-toolbar' }, …)` call, which evaluates its children eagerly — and
  append `rerunButton` as the last toolbar child:

  ```js
    let runHandler = null;
    const rerunButton = toolButton('Re-run segmentation', ICONS.rerun, () => { if (runHandler) runHandler(); }, { disabled: true });
  ```

  Change `setRunHandler` to

  ```js
    function setRunHandler(handler) {
      runHandler = handler;
      runButton.onclick = handler;
    }
  ```

  and in `updateViewer` add `rerunButton.disabled = !hasResult || state.running;` beside the
  `editButton.disabled` line.

- [ ] In `updateViewer`, the run card must show during a re-run of an already-segmented study
  (plan-03 deferred minor: it gated on `hasResult` alone). Replace these **three** lines
  (viewer.js:155–157 at BASE):

  ```js
      const hasResult = Boolean(study.measurements && study.geometry);
      runCard.classList.toggle('is-hidden', hasResult);
      if (!hasResult) {
  ```

  with:

  ```js
      const hasResult = Boolean(study.measurements && study.geometry);
      // Visible before the first run AND during a re-run: a study that already has a result
      // must still show that segmentation is in progress. The card is a scrim over the whole
      // stage, so it also keeps the pointer off the handles while the geometry is about to
      // be replaced.
      const showRunCard = !hasResult || state.running;
      runCard.classList.toggle('is-hidden', !showRunCard);
      if (showRunCard) {
  ```

  (the body of that `if` is unchanged).

- [ ] In `renderer/screens/analysis.js`'s completing `setState` in `runSegmentation`, add
  `editing: false, selection: null,` beside `running: false` — the geometry was just replaced
  under any edit in progress, and the new prediction is the reset target.

- [ ] Run `node --test test/*.test.js` — 102 pass. `node --check` both files.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add a re-run segmentation button and show the run card during a re-run"
  ```

---

## Task 19: End-to-end manual verification — GATE 3

**Files:** none (verification only)

Full pass across the feature, matching spec §12 and §15's manual-testing scope for landmark
editing. Stop and ask the user; the controller's CDP smoke pass comes first.

- [ ] Run the full automated suite and confirm everything passes:

  ```
  node --test test/*.test.js
  ```

  Expected: 102 tests, 0 failures, output pristine.

- [ ] Launch from source with `SPINE_CONTOUR_PYTHON` set and `npm.cmd run dev`, choose a real
  radiograph, and walk through:
  1. After segmentation the toolbar ends with the pencil (`Edit landmarks`) and refresh
     (`Re-run segmentation`) buttons, both enabled; before segmentation both are disabled.
  2. Click the pencil: the edit bar shows `EDITING LANDMARKS · RETRACE (disabled) · FIT (disabled)
     · RESET TO PREDICTION · DONE`. All 22 landmark handles and both femoral circles with centre
     and rim handles are visible.
  3. Hover several handles — each enlarges and labels itself (`L4 SA`, `Left head`,
     `Right head · resize`).
  4. Note the `LUMBAR LORDOSIS · L1–S1` and `PELVIC INCIDENCE` values. Click `L2 SP`, drag it a
     visible distance, release: it stays selected, the outline follows, the panel updates after
     ~150 ms plus the round-trip.
  5. With nothing selected (`Escape`, re-enter), press `Tab`: `L1 SA` gets the ring and label.
     Press `Tab` 21 more times through every corner in anatomical order, then the left femoral
     centre, then the right, then it wraps to `L1 SA`. `Shift+Tab` from `L1 SA` lands on the
     right femoral centre.
  6. Select `L3 SA` via Tab. Press `ArrowRight` five times, then `Shift+ArrowUp` once: five small
     steps, one large. Network: a burst of presses within 150 ms yields one `/measure`. Focus a
     panel row first (click it, then Tab is hijacked — use the mouse) and confirm arrows still
     nudge rather than scrolling the panel.
  7. Left femoral centre drag translates; its rim drag resizes about the fixed centre.
  8. Select the right head, `RETRACE`, place 4 points, `FIT`: the circle re-fits and `RETRACE`
     turns off.
  9. `RESET TO PREDICTION`: every landmark and both circles snap back, the selection clears, and
     the panel shows **exactly** the values noted in step 4 with no network request.
  10. `Escape`: edit mode exits; handles gone; no handle reacts to hover or click.
  11. Click `Re-run segmentation`: the run card appears over the stage with the spinner, the
      toolbar buttons are covered, and when it finishes the new prediction is shown, edit mode
      is off, and `RESET TO PREDICTION` after a fresh edit returns to the **new** prediction.
  12. Segment a second radiograph, return to the first (Back → choose it again is not possible
      in plan 03's UI; skip if the Studies list cannot reopen it), and confirm `Re-run` recovers
      a black stage if one is seen.
  13. Sidebar collapse while editing: handles stay the same on-screen size after the transition.
  14. Middle-button drag pans in edit mode; the pan toggle still works; `Fit to view` resets.

- [ ] Confirm no console errors appeared in DevTools throughout the pass.

- [ ] This task produces no code changes; do not commit unless a defect found during
  verification required a fix in an earlier task's files, in which case commit that fix with
  `fix: <description>` before proceeding.
