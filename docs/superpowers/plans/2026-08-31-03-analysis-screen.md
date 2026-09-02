# Analysis Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `renderer.js`'s single-canvas measure flow with the redesigned Study Analysis screen — layered viewer rendering, the six-row sagittal panel with a lordosis disclosure, indeterminate-progress segmentation, and CSV export — reaching feature parity with today's app except landmark editing.

**Architecture:** Pure logic (circle fitting, coordinate transforms, row derivation, CSV export, zoom/pan math, overlay pixel compositing) lives in testable ES modules under `renderer/viewer/` and `renderer/data/`. DOM and canvas code (the toolbar, the two-layer canvas host, the measurements panel, the screen assembly) consumes that logic and is verified by launching the real app, since no DOM testing library is available. The viewer uses two stacked `<canvas>` elements — a static layer (image + segmentation overlay, redrawn only when the image or overlay settings change) and a dynamic layer (vertebra outlines, femoral circles, the selected measurement's construction lines, redrawn only on selection change) — with zoom/pan applied as a CSS transform on their shared host so panning and zooming never trigger a canvas redraw.

**Tech Stack:** Vanilla ES modules, Canvas 2D, Node's built-in test runner (`node --test`), Electron 44 IPC via `window.spineContour`.

## Global Constraints

- **No bundler, no framework, no npm runtime dependencies.** Vanilla ES modules only. `package.json` `dependencies` stays empty; `devDependencies` stays exactly `electron` and `electron-builder`.
- **CSP is `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'`.** It must not be loosened. No CDN, no Google Fonts, no remote anything.
- **Fonts are self-hosted** from `assets/fonts/`. Source Sans 3 and Chivo Mono, both SIL OFL.
- **Never display a fabricated measurement.** Absent values render the em dash `—`, never `0`, never `N/A`, never a guess.
- **Never label a value with a name it isn't.** See the `SS` rename (plan 02) and the `FEMORAL FIT CONFIDENCE` badge (plan 03).
- **Node's built-in test runner only** (`node --test`). No Jest, Vitest, or Mocha.
- **Every `<script>` is `type="module"`.** No global scope leakage.
- Target Electron 44 / Chromium — modern syntax is fine. No transpilation.
- Commit after every task. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `chore:`).

## Plan-03-specific notes

These are decisions this plan has to make that neither the spec nor the architecture contract pins down. They are recorded here so later plans don't re-litigate them.

- **Reaching the Analysis screen without the Studies table (plan 05) or Workspace (plan 06).** Task 10 extends the `renderer/screens/studies.js` that plan 02 already built — keeping its dropzone, its `Choose radiograph` button and its markup — and adds only the flow that turns a picked file into an in-memory (non-persisted) `Study` and opens it in Analysis. That is the minimum needed to satisfy this plan's own exit criteria ("choose a radiograph, run segmentation, see the overlay… and export CSV") without building the Studies table early. The table, search, status column and persistence still arrive in plan 05. **An earlier draft of this bullet said Task 10 *creates* a minimal stub; it does not — see BD-5.**
- **Overlay opacity math.** The segmentation-overlay pixel data is baked once per prediction at a fixed base alpha of `116` (double `renderer.js`'s hardcoded `58`). At draw time the static layer multiplies that by `overlayOpacity / 100` via `ctx.globalAlpha`. At the default `overlayOpacity` of `50`, the effective alpha is `116 × 0.5 = 58` — visually identical to today's app — while the `FILL` slider's full `0..100` range gives roughly double today's maximum opacity at the high end.
- **"Measurement lines for selected parameters" (spec §9.5).** The old checkbox strip (nine independently toggleable measurement overlays) is gone; the redesign has one `selectedLevel` in the store instead. Clicking a vertebra on the canvas, or a row in the Measurements panel, sets `selectedLevel`. The dynamic layer then draws exactly one construction: for `L1`..`L5` it draws that level's `LL` line (endplate vs. S1, labelled `LL {level}-S1 {value}°`); for `S1` it draws the S1-midpoint-to-hip line labelled with `PI`, `PT`, and `SS` together, since all three share that same construction. This is a smaller surface than the old nine-checkbox display but is the direct, intentional consequence of the redesign's single-selection model — not an oversight.
- **Row-to-vertebra mapping for panel/canvas highlight sync.** The table below is the
  **read** half — which rows light up for a given `selectedLevel`, used by
  `sagittalRows`'s `opts.selectedLevel`. The panel's click handlers are the **write**
  half (`ROW_LEVELS` in `components/measurements.js`), and the two are deliberately
  asymmetric for exactly one row: `PILL` highlights for either `L1` or `S1`, because the
  PI–LL mismatch is a relationship between them, but a click has to pick one level and
  picks `S1` — the level whose construction line is actually drawn. Do not collapse the
  two into a single table.

  | Row key | Highlights when selected | A click selects |
  |---|---|---|
  | `LL` | `L1` | `L1` |
  | `PI` | `PI`, `S1` | `PI` |
  | `PT` | `PT`, `S1` | `PT` |
  | `SS` | `SS`, `S1` | `SS` |
  | `PILL` | `L1`, `S1` | `S1` |
  | `L1PA` | `L1PA` | `L1PA` |

  Each of `PI`/`PT`/`SS`/`L1PA` selects itself because each has its own construction — see
  the architecture contract's `selectedLevel` section. They still highlight under `S1` so
  that clicking the sacrum on the image lights up every parameter the overview line covers.

- **CSV citation block.** The spec requires "a leading comment block carries the citation text and a NOT FOR CLINICAL USE line" but doesn't give the literal string. This plan uses:
  ```
  # Spine Contour export
  # Citation required for published use: Cody Woodhouse, MD; Michael Jayasuria, BS.
  # Investigational software. NOT FOR CLINICAL USE.
  ```
  (names and spelling exactly as spec §9.1 gives them).
- **Run-segmentation progress is indeterminate, by decision.** `/predict` is a single request/response with no progress channel, and spec §11 rules out adding one, so the renderer cannot know which model is executing. An earlier draft of this plan advanced five named stage labels on a 1400 ms timer; that was **rejected** because it would display "Locating S1" while the backend may still be segmenting vertebrae — a fabricated status in an app whose organising principle is that nothing shown is invented, and one that would be wrong by varying amounts since the first run pays model-loading cost that cached later runs skip. The card shows one animated indeterminate indicator reading `Segmenting and measuring…` above static text naming what the pipeline does. Do not reintroduce a stage timer without first adding a real backend progress channel and amending spec §11.

---

## Binding decisions for this plan

These resolve the seven blocking conflicts the pre-flight scan found
(`docs/superpowers/2026-09-01-plan-03-preflight-scan.md`). **They override anything later
in this document that contradicts them, and they override the source mockup.** Read them
before starting any task; each affected task points back here.

The scan exists because this plan was written before plan 02's final architecture did.
Most of what follows is not a change of intent — it is this plan's intent restated
against the code that actually shipped.

### BD-1 — Screens export `render(state)` and return exactly one root node

`renderer/router.js:222-231` calls `renderScreen(state)` and `replaceChild`s the node it
returns. All four screen modules plan 02 built follow that. Tasks 9 and 10 therefore
export:

```js
export function render(state)   // → HTMLElement
```

Not `render(container)`. No `clear(container)`, no `container.append(...)`, no returned
cleanup function.

This is not a stylistic preference — the container form fails silently and then loudly
in the wrong place. `clear(state)` no-ops (`dom.js:26` loops on `node.firstChild`, which
is `undefined` on the frozen plain object the router passes), then
`container.append(...)` throws `TypeError: container.append is not a function` inside
`store.js`'s listener loop, inside `setState`, inside the sidebar's click handler.
User-visible result: **clicking Studies or Analysis does nothing, with one red TypeError
in DevTools.**

Every screen root carries `flex: 1; min-width: 0`. `.app-shell` is a flex row
(`styles/components.css:368-375`); a screen that appends two rootless siblings gets a
narrow vertical column beside the viewer instead of a header above it.

### BD-2 — `screens/analysis.js` subscribes to the store itself. Add NOTHING to `SCREEN_KEYS`.

`renderer/router.js:73-74` says *"if any of them starts reading a state key, add it here
too."* **That instruction does not apply to this plan.** The same comment block states
the exception (`router.js:79-85`), and this is the case it was written for.

The Analysis screen reads seventeen state keys. Four of them — **`zoom`, `panX`,
`panY`, `panMode`** — change at pointermove rate. Adding any of those to `SCREEN_KEYS`
means: `handlePointerMove` → `setState({panX, panY})` → `keysChanged(SCREEN_KEYS)` is
true → `swap()` `replaceChild`s the screen node → both `<canvas>` elements detach,
`staticCtx`/`dynamicCtx` now point at orphaned nodes, `mountViewer` re-runs, `detach()`
is never called so listeners stack one set per frame. **User-visible: the image vanishes
on the first drag pixel.**

Concretely, for this plan:

- `SCREEN_KEYS` stays exactly `['screen', 'ack']`.
- `SIDEBAR_KEYS` and `TOAST_KEYS` are unchanged.
- **`renderer/router.js` is not edited by any task in this plan.** No task's Files block
  lists it. If you believe you need to edit it, stop and raise it.

Instead, `screens/analysis.js` calls `subscribe(...)` **once at module scope** — at
import time, not inside `render()` — with a guard that no-ops unless the screen is both
the current screen and currently mounted. Module scope matters twice over: a
subscription created inside `render()` leaks one permanently-live listener per
studies→analysis round trip, each one rebuilding a detached tree on every later
notification; and module scope is what lets the subscriber run its own teardown when
`screen` moves away from `'analysis'`.

Listener order makes that teardown correct without any router change. ES module
evaluation runs `screens/analysis.js`'s body (and therefore its `subscribe`) before
`renderer/main.js`'s body (and therefore the router's `subscribe`), because `main.js`
imports `router.js`, which imports `screens/analysis.js`. `store.js` notifies listeners
in insertion order, so on `setState({screen: 'studies'})` the analysis subscriber tears
down first and the router swaps the node second.

### BD-3 — Never pass `style` to `el()`. Styling lives in `styles/screens/analysis.css`.

The architecture contract forbids `style`, `dataset`, `list` and `form` as `el()` props.
As drafted, Tasks 7–10 pass `style:` **51 times**, and this plan creates no stylesheet
to move them into. Both halves are fixed together:

1. **Task 7 creates `styles/screens/analysis.css` and adds its `<link>` to
   `index.html`.** `index.html:12-16` links exactly five sheets today; a new file with no
   `<link>` silently does nothing. Tasks 8 and 9 append their own sections to that same
   file. Task 10 needs no new CSS — see BD-5.
2. **Every static rule becomes a class.** Exactly two things are written to a node
   after construction, and both are genuinely per-frame values with no class that could
   express them: the viewer host's `transform` (`translate(panX, panY) scale(zoom)`) and
   the `FILL` slider's `value`. Every other state-dependent appearance — active
   toolbar buttons, the selected measurement row, the visible tab, the run card's
   visibility — is a `classList.toggle`.

One accuracy note, so nobody re-litigates this after testing it. The contract says
`el('div', {style: '...'})` throws a `TypeError` under strict mode. That is true for
`dataset`, `list` and `form` (getter-only IDL attributes) but **not** for `style`, which
is `[PutForwards=cssText]` and accepts a string assignment. The prohibition still stands
— it is what keeps 51 inline style strings out of the codebase and keeps the token
system enforceable — but do not go looking for an exception that never throws.

`class` takes a **string**, never an array. Join conditional class lists before calling
`el()`.

### BD-4 — The running state is indeterminate. There is no stage sequence.

This plan's own notes already reject a timed stage sequence (see *Plan-03-specific
notes* below), and CLAUDE.md and the architecture contract both forbid fabricated status.
An earlier draft of Task 9's verification checklist nevertheless asserted a five-stage
cycling eyebrow (`PREPARING IMAGE` → `SEGMENTING VERTEBRAE` → `LOCATING S1` →
`FITTING FEMORAL HEADS` → `COMPUTING MEASUREMENTS`). It is removed. A worker treats the
verification checklist as the definition of done and would have written the timer back in
to satisfy it.

The run card shows exactly two states, both owned by Task 7: `QUEUED` before a run and
`RUNNING` during one, with one indeterminate spinner and one static line naming what the
pipeline does. Task 9 defines no run copy of its own — see BD-6.

### BD-5 — Task 10 **extends** `screens/studies.js`. It does not replace it.

`renderer/screens/studies.js` already exists and is more complete than the stub this plan
proposed: `.studies-page` / `.studies-page-inner` / `.studies-header` / `.dropzone`
markup, an inline upload SVG, a `btn btn-primary btn-small` button labelled
`Choose radiograph` (**no ellipsis**), the de-identification copy, and `showToast` error
handling around `selectFile()`. `styles/screens/studies.css` styles all of it and
`index.html:16` links it.

Overwriting that file deletes the dropzone, orphans a linked stylesheet, and regresses
the button label. Task 10 keeps the existing file and its `render(state)` shape, and adds
only the study-creation and navigation flow to the existing `handleChoose`.

### BD-6 — Image ownership: the screen owns the bitmaps; the viewer only draws them

As drafted, Task 9 invented `viewer.__lastImages` — an undeclared property written
across a module boundary — and assigned it *after* the completing `setState`. Because
`setState` notifies synchronously, `update()` ran first and read `null`, so
`updateViewer(study, null)` left the canvases at their default 300×150 and drew
nothing. **User-visible: all six measurements populate and the stage stays black until an
unrelated click.** Nothing disposed the previous `ImageBitmap`s either, and navigating
studies→analysis→studies→analysis produced a study with measurements, no run
card, and no image.

One ownership rule fixes all three:

- **`screens/analysis.js` owns image lifetime.** It imports `loadStudyImages` and
  `disposeStudyImages` directly from `../viewer/canvas.js` and holds a module-scope
  single-entry cache, `{studyId, images} | null`. Loading a different study's images
  disposes the previous entry. Returning to a study whose images are still cached
  re-hands them to a freshly mounted viewer, so the radiograph survives navigation.
- **`mountViewer` never disposes and never re-exports canvas functions.** It returns
  `{ updateViewer, setImages, setRunHandler, detach }` — four keys, all four used.
  `setImages(images)` stores the reference and sizes the canvases; `updateViewer(study)`
  takes **one** argument; `detach()` removes listeners only.
- **`setImages` is called before the completing `setState`**, never after.
- **Both hand-offs to a live viewer are gated on study identity.** `runSegmentation` checks
  `mounted.studyId === studyId` and `render()` checks `imageCache.studyId === study.id`.
  Neither is defensive padding. `mounted` is a single global that `render()` reassigns on
  every navigation, and the run's revision guard only detects a *second* `runSegmentation`
  call -- nothing bumps it when the user navigates away mid-run. Open study A, start a run,
  press back, open study B: when A's slow request lands, an ungated hand-off puts A's
  radiograph under B's header, chip id and geometry, behind a run card that is a blur scrim
  rather than an opaque one. The run still commits A's measurements to the store, and
  returning to A re-hands its bitmaps through the cache -- only the hand-off to a live
  viewer is conditional. Do **not** "simplify" either check away, and do **not** fix this
  instead by blocking navigation while `state.running` is true: locking the user out of the
  app for the duration of a three-model run is worse than the bug.

### BD-7 — The `Study` record carries no `_fileData`, no `SP-DRAFT-n`, and a real `filePath`

Plan 05 persists `state.studies` to disk and validates it, so every field this plan
writes ships. As drafted, Task 10 wrote all three of the following, and all three are
wrong:

| Drafted | Correct | Why |
|---|---|---|
| `_fileData: chosen.data` | not on the record | Not a `Study` field. Plan 05 either writes megabytes of base64 to disk or `validate()` throws. |
| `id: \`SP-DRAFT-${n}\`` | `SP-` + `(1000 + n)` | The contract fixes real ids at `SP-1000`+; `nextId` parsing `SP-DRAFT-1` yields `NaN`. |
| `filePath: null` | `filePath: chosen.path` | `null` means demo. The path is already known and simply discarded. |

The file payload lives in a module-scope `Map` in **`screens/analysis.js`**, keyed by
study id — `export function setFilePayload(studyId, data)`, which `screens/studies.js`
calls after `selectFile()` resolves. Two reasons for that direction rather than the
reverse: `analysis.js` is the module that actually consumes the bytes (`studies.js` only
hands them over), and Task 9 lands before Task 10, so the consumer must own the export or
Task 9's test fails at import time with a missing named export.

The map is deliberately transitional. Plan 06 scans folders into studies that have a
`filePath` and no payload, at which point it goes away.

`main.js`'s `select-file` handler (`main.js:24-38`) currently returns `{name, data}` and
must also return `path` — the contract's `api.js` section already specifies
`selectFile() → {name, data, path} | null`. That one-line change is owned by Task 10.

### Colours on the viewer stage

The contract's colour-token section grants the viewer stage an off-theme exception and
names four values — `#0B0A09`, `rgba(250,247,242,.75)`, `#D45A32`, `#38342F` —
"hardcoded in `viewer/canvas.js`". That covers pixels drawn *into* the canvas. It does not
cover the DOM chrome floating *over* the canvas (toolbar, study chip, footer watermark,
run card), which this plan draws with twelve hardcoded literals, six of them the
dark-theme token values copied by hand — i.e. the dark theme reproduced in JS strings,
rendering theme-inverted beside the light panel that the default `theme: 'light'` store
gives you.

**Resolution, and it is a deliberate extension of the contract's exception rather than a
literal reading of it:** `styles/screens/analysis.css` declares one scoped, theme-invariant
token block on `.viewer-stage` and every stage rule below it uses those custom properties.
The stage stays off-theme in both modes, as the contract intends, and the values are
declared once instead of twelve times. `viewer/canvas.js` keeps its four literals for the
pixels it draws.


---

### Task 1: `viewer/geometry.js` — circle fit and coordinate transforms

**Files:**
- Create: `renderer/viewer/geometry.js`
- Test: `test/geometry.test.js`

**Interfaces:**
- Produces: `fitCircle(points)`, `imageToClient(pt, rect, canvas)`, `clientToImage(ev, canvas)`, `nearestLandmark(geometry, clientX, clientY, canvas, radius=14)`, `landmarkAt(geometry, level, corner)`, `setLandmarkAt(geometry, level, corner, point)`, `LEVELS`, `CORNERS` — exactly the signatures in the architecture contract's `renderer/viewer/geometry.js` section.
- `nearestLandmark` has no consumer in this plan; it is a dead export until plan 04. Its
  return shape is **`{level, corner, distance}` or `null`** — the contract does not pin
  that down, so plan 04 must destructure exactly those three names.

**Contract errata.** The architecture contract says `fitCircle` is "ported verbatim from
`renderer.js:597`". Line 597 is `const divisor = augmented[column][column];`, inside
`solve3x3`. The citations in this task's code are the correct ones and were verified
against the file: `solve3x3` is `renderer.js:590-606` and `fitCircle` is
`renderer.js:608-622`. Do not "correct" them to match the contract.

- [ ] **Step 1: Write the failing tests**

Create `test/geometry.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitCircle, imageToClient, clientToImage, nearestLandmark,
  landmarkAt, setLandmarkAt, LEVELS, CORNERS,
} from '../renderer/viewer/geometry.js';

test('LEVELS and CORNERS are the fixed anatomical lists', () => {
  assert.deepEqual(LEVELS, ['L1', 'L2', 'L3', 'L4', 'L5']);
  assert.deepEqual(CORNERS, ['SA', 'SP', 'IA', 'IP']);
});

test('fitCircle recovers a known circle from points on its edge', () => {
  const cx = 120; const cy = 80; const r = 40;
  const points = [0, 90, 200, 300].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  });
  const [fx, fy, fr] = fitCircle(points);
  assert.ok(Math.abs(fx - cx) < 1e-6, `cx ${fx} vs ${cx}`);
  assert.ok(Math.abs(fy - cy) < 1e-6, `cy ${fy} vs ${cy}`);
  assert.ok(Math.abs(fr - r) < 1e-6, `r ${fr} vs ${r}`);
});

test('fitCircle returns null for fewer than 3 points', () => {
  assert.equal(fitCircle([]), null);
  assert.equal(fitCircle([[0, 0]]), null);
  assert.equal(fitCircle([[0, 0], [1, 1]]), null);
});

test('fitCircle returns null for collinear points', () => {
  assert.equal(fitCircle([[0, 0], [10, 0], [20, 0]]), null);
});

function fakeGeometry() {
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
    hip_midpoint: [15, 130],
    femoral_circles: [[10, 140, 5], [20, 140, 5]],
  };
}

test('landmarkAt reads every level and corner, including S1', () => {
  const geometry = fakeGeometry();
  assert.deepEqual(landmarkAt(geometry, 'L2', 'SA'), [10, 30]);
  assert.deepEqual(landmarkAt(geometry, 'L2', 'SP'), [20, 30]);
  assert.deepEqual(landmarkAt(geometry, 'L2', 'IA'), [10, 40]);
  assert.deepEqual(landmarkAt(geometry, 'L2', 'IP'), [20, 40]);
  assert.deepEqual(landmarkAt(geometry, 'S1', 'SA'), [10, 110]);
  assert.deepEqual(landmarkAt(geometry, 'S1', 'SP'), [20, 110]);
});

test('setLandmarkAt mutates the point and keeps quadrilateral in sync', () => {
  const geometry = fakeGeometry();
  setLandmarkAt(geometry, 'L3', 'IA', [11, 61]);
  assert.deepEqual(geometry.vertebrae.L3.inferior[0], [11, 61]);
  assert.deepEqual(geometry.vertebrae.L3.quadrilateral, [
    geometry.vertebrae.L3.superior[0],
    geometry.vertebrae.L3.superior[1],
    geometry.vertebrae.L3.inferior[1],
    geometry.vertebrae.L3.inferior[0],
  ]);
});

test('setLandmarkAt on S1 does not touch vertebrae', () => {
  const geometry = fakeGeometry();
  setLandmarkAt(geometry, 'S1', 'SP', [99, 99]);
  assert.deepEqual(geometry.s1_superior[1], [99, 99]);
});

function fakeCanvas(width, height, rect) {
  return { width, height, getBoundingClientRect: () => rect };
}

test('clientToImage maps a client point into image space and clamps to bounds', () => {
  const canvas = fakeCanvas(200, 100, { left: 50, top: 20, width: 100, height: 50 });
  const [x, y] = clientToImage({ clientX: 100, clientY: 45 }, canvas);
  assert.equal(x, 100);
  assert.equal(y, 50);
  const [cx, cy] = clientToImage({ clientX: -1000, clientY: 1000 }, canvas);
  assert.equal(cx, 0);
  assert.equal(cy, 100);
});

test('imageToClient is the inverse of clientToImage at interior points', () => {
  const canvas = fakeCanvas(200, 100, { left: 50, top: 20, width: 100, height: 50 });
  const rect = canvas.getBoundingClientRect();
  const [cx, cy] = imageToClient([100, 50], rect, canvas);
  assert.equal(cx, 100);
  assert.equal(cy, 45);
});

test('nearestLandmark finds the closest handle within radius and null outside it', () => {
  const geometry = fakeGeometry();
  const canvas = fakeCanvas(200, 150, { left: 0, top: 0, width: 200, height: 150 });
  const hit = nearestLandmark(geometry, 10, 30, canvas, 14);
  assert.deepEqual({ level: hit.level, corner: hit.corner }, { level: 'L2', corner: 'SA' });
  const miss = nearestLandmark(geometry, 500, 500, canvas, 14);
  assert.equal(miss, null);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/geometry.test.js`
Expected: FAIL with `Cannot find module '../renderer/viewer/geometry.js'`

- [ ] **Step 3: Write minimal implementation**

Create `renderer/viewer/geometry.js`:

```js
export const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5'];
export const CORNERS = ['SA', 'SP', 'IA', 'IP'];

// Ported verbatim from renderer.js:590-606.
function solve3x3(matrix, values) {
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-9) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let entry = column; entry < 4; entry += 1) augmented[column][entry] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry < 4; entry += 1) augmented[row][entry] -= factor * augmented[column][entry];
    }
  }
  return [augmented[0][3], augmented[1][3], augmented[2][3]];
}

// Ported verbatim from renderer.js:608-622.
export function fitCircle(points) {
  if (points.length < 3) return null;
  let sxx = 0; let syy = 0; let sxy = 0; let sx = 0; let sy = 0;
  let sbx = 0; let sby = 0; let sb = 0;
  for (const [x, y] of points) {
    const b = x * x + y * y;
    sxx += 4 * x * x; syy += 4 * y * y; sxy += 4 * x * y; sx += 2 * x; sy += 2 * y;
    sbx += 2 * x * b; sby += 2 * y * b; sb += b;
  }
  const solved = solve3x3([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, points.length]], [sbx, sby, sb]);
  if (!solved) return null;
  const [cx, cy, constant] = solved;
  const radiusSquared = cx * cx + cy * cy + constant;
  return Number.isFinite(radiusSquared) && radiusSquared > 0 ? [cx, cy, Math.sqrt(radiusSquared)] : null;
}

export function landmarkAt(geometry, level, corner) {
  if (level === 'S1') return geometry.s1_superior[corner === 'SA' ? 0 : 1];
  const body = geometry.vertebrae[level];
  if (corner === 'SA') return body.superior[0];
  if (corner === 'SP') return body.superior[1];
  if (corner === 'IA') return body.inferior[0];
  return body.inferior[1];
}

export function setLandmarkAt(geometry, level, corner, point) {
  if (level === 'S1') {
    geometry.s1_superior[corner === 'SA' ? 0 : 1] = point;
    return geometry;
  }
  const body = geometry.vertebrae[level];
  if (corner === 'SA') body.superior[0] = point;
  else if (corner === 'SP') body.superior[1] = point;
  else if (corner === 'IA') body.inferior[0] = point;
  else body.inferior[1] = point;
  body.quadrilateral = [body.superior[0], body.superior[1], body.inferior[1], body.inferior[0]];
  return geometry;
}

export function clientToImage(ev, canvas) {
  const rect = canvas.getBoundingClientRect();
  return [
    Math.max(0, Math.min(canvas.width, ((ev.clientX - rect.left) * canvas.width) / rect.width)),
    Math.max(0, Math.min(canvas.height, ((ev.clientY - rect.top) * canvas.height) / rect.height)),
  ];
}

export function imageToClient(pt, rect, canvas) {
  return [
    rect.left + (pt[0] * rect.width) / canvas.width,
    rect.top + (pt[1] * rect.height) / canvas.height,
  ];
}

export function nearestLandmark(geometry, clientX, clientY, canvas, radius = 14) {
  const rect = canvas.getBoundingClientRect();
  let nearest = null;
  for (const level of [...LEVELS, 'S1']) {
    for (const corner of level === 'S1' ? ['SA', 'SP'] : CORNERS) {
      const point = landmarkAt(geometry, level, corner);
      const [x, y] = imageToClient(point, rect, canvas);
      const distance = Math.hypot(clientX - x, clientY - y);
      if (distance <= radius && (!nearest || distance < nearest.distance)) {
        nearest = { level, corner, distance };
      }
    }
  }
  return nearest;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/geometry.test.js`
Expected: PASS — 10 tests, 0 failures

- [ ] **Step 5: Commit**
```
git add renderer/viewer/geometry.js test/geometry.test.js
git commit -m "feat: port circle fit and coordinate transforms to viewer/geometry.js"
```

---

### Task 2: `data/measurements.js` — API response to display rows

**Files:**
- Create: `renderer/data/measurements.js`
- Test: `test/measurements.test.js`

**Interfaces:**
- Consumes: `Measurements` shape from the architecture contract (`SS`, `PI`, `PT`, `L1PA`, `LL: {'L1-S1'..'L5-S1'}`).
- Produces: `sagittalRows(measurements, opts)`, `lordosisRows(measurements)`, `discRows()`, `alignmentRows(study)`, `piResidual(measurements)`, `isConsistent(measurements)`, `deltaRow(row, otherRow, threshold)` — exactly the signatures in the architecture contract.

- [ ] **Step 1: Write the failing tests**

Create `test/measurements.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sagittalRows, lordosisRows, discRows, alignmentRows,
  piResidual, isConsistent, deltaRow,
} from '../renderer/data/measurements.js';

const MEASUREMENTS = {
  SS: 38.2,
  PI: 52.7,
  PT: 14.6,
  L1PA: 21.3,
  LL: { 'L1-S1': 47.1, 'L2-S1': 40.0, 'L3-S1': 30.5, 'L4-S1': 18.2, 'L5-S1': 6.4 },
};

test('sagittalRows returns exactly six rows in the contracted order with verbatim labels', () => {
  const rows = sagittalRows(MEASUREMENTS, {});
  assert.deepEqual(rows.map((r) => r.key), ['LL', 'PI', 'PT', 'SS', 'PILL', 'L1PA']);
  assert.deepEqual(rows.map((r) => r.label), [
    'LUMBAR LORDOSIS \u00B7 L1\u2013S1',
    'PELVIC INCIDENCE',
    'PELVIC TILT',
    'SACRAL SLOPE',
    'PI\u2013LL MISMATCH',
    'L1 PELVIC ANGLE',
  ]);
  rows.forEach((r) => assert.equal(r.unit, '\u00B0'));
});

test('sagittalRows computes values, including the derived PI-LL mismatch', () => {
  const rows = sagittalRows(MEASUREMENTS, {});
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.LL.value, 47.1);
  assert.equal(byKey.PI.value, 52.7);
  assert.equal(byKey.PT.value, 14.6);
  assert.equal(byKey.SS.value, 38.2);
  assert.ok(Math.abs(byKey.PILL.value - (52.7 - 47.1)) < 1e-9);
  assert.equal(byKey.L1PA.value, 21.3);
  rows.forEach((r) => assert.equal(r.absent, false));
});

test('sagittalRows marks every row absent with null values when measurements is null', () => {
  const rows = sagittalRows(null, {});
  assert.equal(rows.length, 6);
  rows.forEach((r) => {
    assert.equal(r.absent, true);
    assert.equal(r.value, null);
  });
});

test('sagittalRows highlight reflects opts.selectedLevel per the row-to-level map', () => {
  const rows = sagittalRows(MEASUREMENTS, { selectedLevel: 'S1' });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.PI.highlight, true);
  assert.equal(byKey.PT.highlight, true);
  assert.equal(byKey.SS.highlight, true);
  assert.equal(byKey.PILL.highlight, true);
  assert.equal(byKey.LL.highlight, false);
  assert.equal(byKey.L1PA.highlight, false);
});

test('lordosisRows returns L2-S1 through L5-S1 with values when present', () => {
  const rows = lordosisRows(MEASUREMENTS);
  assert.deepEqual(rows.map((r) => r.key), ['L2-S1', 'L3-S1', 'L4-S1', 'L5-S1']);
  assert.equal(rows[0].value, 40.0);
  assert.equal(rows[0].label, 'LUMBAR LORDOSIS \u00B7 L2\u2013S1');
  rows.forEach((r) => assert.equal(r.absent, false));
});

test('lordosisRows is absent when measurements is null', () => {
  const rows = lordosisRows(null);
  rows.forEach((r) => {
    assert.equal(r.absent, true);
    assert.equal(r.value, null);
  });
});

test('discRows is always five absent rows regardless of input', () => {
  const rows = discRows();
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.label), ['L1\u2013L2', 'L2\u2013L3', 'L3\u2013L4', 'L4\u2013L5', 'L5\u2013S1']);
  rows.forEach((r) => { assert.equal(r.absent, true); assert.equal(r.value, null); });
});

test('alignmentRows is always one absent spondylolisthesis row', () => {
  const rows = alignmentRows({ id: 'SP-1000' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'SPONDY \u00B7 L4\u2013L5 \u00B7 MM');
  assert.equal(rows[0].absent, true);
  assert.equal(rows[0].value, null);
});

test('piResidual is |PI - (PT + SS)| and null when measurements is null', () => {
  assert.ok(Math.abs(piResidual(MEASUREMENTS) - Math.abs(52.7 - (14.6 + 38.2))) < 1e-9);
  assert.equal(piResidual(null), null);
});

test('isConsistent is true at and below the 1.0 boundary, false above it, true when null', () => {
  assert.equal(isConsistent({ PI: 50, PT: 25, SS: 24.0, L1PA: 0, LL: { 'L1-S1': 0 } }), true);
  assert.equal(isConsistent({ PI: 50, PT: 25, SS: 23.99, L1PA: 0, LL: { 'L1-S1': 0 } }), false);
  assert.equal(isConsistent(null), true);
});

test('deltaRow formats a signed one-decimal delta with the correct minus glyph', () => {
  const positive = deltaRow({ value: 40, absent: false }, { value: 42.3, absent: false }, 5);
  assert.equal(positive.text, '+2.3');
  assert.equal(positive.overThreshold, false);
  const negative = deltaRow({ value: 40, absent: false }, { value: 33, absent: false }, 5);
  assert.equal(negative.text, '\u22127.0');
  assert.equal(negative.overThreshold, true);
});

test('deltaRow is over threshold exactly at the boundary and empty when either row is absent', () => {
  const boundary = deltaRow({ value: 10, absent: false }, { value: 15, absent: false }, 5);
  assert.equal(boundary.overThreshold, true);
  const absent = deltaRow({ value: null, absent: true }, { value: 10, absent: false }, 5);
  assert.equal(absent.text, '\u2014');
  assert.equal(absent.overThreshold, false);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/measurements.test.js`
Expected: FAIL with `Cannot find module '../renderer/data/measurements.js'`

- [ ] **Step 3: Write minimal implementation**

Create `renderer/data/measurements.js`:

```js
// RESIDUAL_LIMIT mirrors data/status.js's constant of the same name (plan 05).
// Duplicated here deliberately: this module must not depend on plan 05's file.
//
// PLAN 05 OWES THIS ONE GUARD. Two independent literals for one clinical threshold,
// with nothing comparing them, is how deriveStatus() and isConsistent() end up
// disagreeing about the same study. When plan 05 creates data/status.js it must either
// import piResidual/isConsistent from here (inverting the dependency, which is the
// better fix) or add a test asserting the two literals are equal -- exactly what the
// architecture contract already requires for STORE_VERSION.
const RESIDUAL_LIMIT = 1.0;

const SAGITTAL_DEFS = [
  { key: 'LL', label: 'LUMBAR LORDOSIS \u00B7 L1\u2013S1', levels: ['L1'] },
  // PI, PT and SS are three different angles against three different reference axes, so
  // each selects itself rather than the shared 'S1' overview. Mapping all three to 'S1'
  // drew one line for all of them and ran their combined label off the edge of the stage.
  { key: 'PI', label: 'PELVIC INCIDENCE', levels: ['PI', 'S1'] },
  { key: 'PT', label: 'PELVIC TILT', levels: ['PT', 'S1'] },
  { key: 'SS', label: 'SACRAL SLOPE', levels: ['SS', 'S1'] },
  { key: 'PILL', label: 'PI\u2013LL MISMATCH', levels: ['L1', 'S1'] },
  // L1PA's levels is ['L1PA'], not ['L1']. L1 pelvic angle has a construction of its
  // own -- the angle at the hip between the L1 centroid and the S1 midpoint -- which is
  // geometrically unrelated to lumbar lordosis. Mapping it to 'L1' made clicking a row
  // labelled L1 PELVIC ANGLE draw the lordosis line and label it `LL L1-S1`. See the
  // architecture contract's selectedLevel section.
  { key: 'L1PA', label: 'L1 PELVIC ANGLE', levels: ['L1PA'] },
];

function sagittalValue(key, measurements) {
  if (key === 'LL') return measurements.LL['L1-S1'];
  if (key === 'PILL') return measurements.PI - measurements.LL['L1-S1'];
  return measurements[key];
}

export function sagittalRows(measurements, opts = {}) {
  const selectedLevel = opts.selectedLevel ?? null;
  const absent = measurements == null;
  return SAGITTAL_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    value: absent ? null : sagittalValue(def.key, measurements),
    unit: '\u00B0',
    absent,
    highlight: selectedLevel != null && def.levels.includes(selectedLevel),
  }));
}

const LORDOSIS_LEVELS = ['L2', 'L3', 'L4', 'L5'];

export function lordosisRows(measurements) {
  const absent = measurements == null;
  return LORDOSIS_LEVELS.map((level) => {
    const key = `${level}-S1`;
    return {
      key,
      label: `LUMBAR LORDOSIS \u00B7 ${level}\u2013S1`,
      value: absent ? null : measurements.LL[key],
      unit: '\u00B0',
      absent,
      highlight: false,
    };
  });
}

const DISC_LEVEL_PAIRS = [['L1', 'L2'], ['L2', 'L3'], ['L3', 'L4'], ['L4', 'L5'], ['L5', 'S1']];

export function discRows() {
  return DISC_LEVEL_PAIRS.map(([a, b]) => ({
    key: `${a}-${b}`,
    label: `${a}\u2013${b}`,
    value: null,
    unit: 'mm',
    absent: true,
    highlight: false,
  }));
}

export function alignmentRows(study) {
  void study; // reserved: a future per-study calibration input, unused while slip is unimplemented (spec §10.3)
  return [{
    key: 'SPONDY_L4_L5',
    label: 'SPONDY \u00B7 L4\u2013L5 \u00B7 MM',
    value: null,
    unit: 'mm',
    absent: true,
    highlight: false,
  }];
}

export function piResidual(measurements) {
  if (measurements == null) return null;
  return Math.abs(measurements.PI - (measurements.PT + measurements.SS));
}

export function isConsistent(measurements) {
  const residual = piResidual(measurements);
  if (residual == null) return true;
  return residual <= RESIDUAL_LIMIT;
}

export function deltaRow(row, otherRow, threshold) {
  if (!row || !otherRow || row.absent || otherRow.absent || row.value == null || otherRow.value == null) {
    return { text: '\u2014', overThreshold: false };
  }
  const delta = otherRow.value - row.value;
  const sign = delta >= 0 ? '+' : '\u2212';
  return { text: `${sign}${Math.abs(delta).toFixed(1)}`, overThreshold: Math.abs(delta) >= threshold };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/measurements.test.js`
Expected: PASS — 12 tests, 0 failures

- [ ] **Step 5: Commit**
```
git add renderer/data/measurements.js test/measurements.test.js
git commit -m "feat: derive display rows from the measure response in data/measurements.js"
```

---

### Task 3: `data/csv.js` — `toCsv` only

**Files:**
- Create: `renderer/data/csv.js`
- Test: `test/csv.test.js`

**Interfaces:**
- Consumes: `Study` shape from the architecture contract.
- Produces: `toCsv(studies, fields, opts)` — the only export this plan adds. `parse` and `autoMap` are added to this same file by plan 06; do not stub them.

- [ ] **Step 1: Write the failing tests**

Create `test/csv.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../renderer/data/csv.js';

function study(overrides) {
  return {
    id: 'SP-1000',
    source: 'real',
    filePath: 'C:/films/a.dcm',
    fileName: 'a.dcm',
    addedAt: '2026-08-31T00:00:00Z',
    view: 'Standing lateral',
    thumbnail: null,
    measurements: null,
    geometry: null,
    qc: null,
    clinical: {},
    ...overrides,
  };
}

test('toCsv leads with the citation and NOT FOR CLINICAL USE comment block', () => {
  const csv = toCsv([], [], {});
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '# Spine Contour export');
  assert.match(lines[1], /Cody Woodhouse, MD/);
  assert.match(lines[1], /Michael Jayasuria, BS/);
  assert.match(lines[2], /NOT FOR CLINICAL USE/);
});

test('toCsv excludes demo studies by default and includes them with opts.includeDemo', () => {
  const studies = [study({ id: 'SP-1000', source: 'real' }), study({ id: 'SP-0030', source: 'demo' })];
  const excluded = toCsv(studies, [], {});
  assert.ok(excluded.includes('SP-1000'));
  assert.ok(!excluded.includes('SP-0030'));
  const included = toCsv(studies, [], { includeDemo: true });
  assert.ok(included.includes('SP-0030'));
});

test('toCsv exports absent measurements as empty cells, never 0', () => {
  const csv = toCsv([study({ measurements: null })], [], {});
  const dataLine = csv.split('\r\n').find((line) => line.startsWith('SP-1000'));
  const cells = dataLine.split(',');
  // Study ID, Source, View, then the ten measurement columns.
  for (let i = 3; i < 3 + 10; i += 1) assert.equal(cells[i], '');
});

test('toCsv exports real measurements including the derived PI-LL mismatch column', () => {
  const measurements = {
    SS: 38.2, PI: 52.7, PT: 14.6, L1PA: 21.3,
    LL: { 'L1-S1': 47.1, 'L2-S1': 40.0, 'L3-S1': 30.5, 'L4-S1': 18.2, 'L5-S1': 6.4 },
  };
  const csv = toCsv([study({ measurements })], [], {});
  const header = csv.split('\r\n')[3].split(',');
  const dataLine = csv.split('\r\n')[4].split(',');
  const mismatchIndex = header.indexOf('PI-LL Mismatch');
  assert.ok(Math.abs(Number(dataLine[mismatchIndex]) - (52.7 - 47.1)) < 1e-9);
});

test('toCsv appends one column per clinical field and quotes fields containing commas', () => {
  const csv = toCsv(
    [study({ clinical: { Diagnosis: 'Spondylolisthesis, grade 2' } })],
    ['Diagnosis'],
    {},
  );
  const dataLine = csv.split('\r\n').find((line) => line.startsWith('SP-1000'));
  assert.ok(dataLine.includes('"Spondylolisthesis, grade 2"'));
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/csv.test.js`
Expected: FAIL with `Cannot find module '../renderer/data/csv.js'`

- [ ] **Step 3: Write minimal implementation**

Create `renderer/data/csv.js`:

```js
const MEASUREMENT_COLUMNS = [
  'LL L1-S1', 'PI', 'PT', 'SS', 'PI-LL Mismatch', 'L1PA',
  'LL L2-S1', 'LL L3-S1', 'LL L4-S1', 'LL L5-S1',
];

function measurementValue(study, column) {
  const m = study.measurements;
  if (!m) return '';
  switch (column) {
    case 'LL L1-S1': return m.LL['L1-S1'];
    case 'PI': return m.PI;
    case 'PT': return m.PT;
    case 'SS': return m.SS;
    case 'PI-LL Mismatch': return m.PI - m.LL['L1-S1'];
    case 'L1PA': return m.L1PA;
    case 'LL L2-S1': return m.LL['L2-S1'];
    case 'LL L3-S1': return m.LL['L3-S1'];
    case 'LL L4-S1': return m.LL['L4-S1'];
    case 'LL L5-S1': return m.LL['L5-S1'];
    default: return '';
  }
}

function escapeField(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(studies, fields, opts = {}) {
  const includeDemo = opts.includeDemo === true;
  const rows = studies.filter((study) => includeDemo || study.source !== 'demo');

  const citation = [
    '# Spine Contour export',
    '# Citation required for published use: Cody Woodhouse, MD; Michael Jayasuria, BS.',
    '# Investigational software. NOT FOR CLINICAL USE.',
  ];
  const header = ['Study ID', 'Source', 'View', ...MEASUREMENT_COLUMNS, ...fields];

  const lines = [...citation, header.map(escapeField).join(',')];
  for (const study of rows) {
    const cells = [
      study.id,
      study.source,
      study.view,
      ...MEASUREMENT_COLUMNS.map((column) => measurementValue(study, column)),
      ...fields.map((field) => (study.clinical && study.clinical[field] != null ? study.clinical[field] : '')),
    ];
    lines.push(cells.map(escapeField).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/csv.test.js`
Expected: PASS — 5 tests, 0 failures

- [ ] **Step 5: Commit**
```
git add renderer/data/csv.js test/csv.test.js
git commit -m "feat: implement CSV export in data/csv.js"
```

---

### Task 4: `viewer/interactions.js` — zoom, pan, and click-to-select

**Files:**
- Create: `renderer/viewer/interactions.js`
- Test: `test/interactions.test.js`

**Interfaces:**
- Consumes: `clientToImage(ev, canvas)` from `renderer/viewer/geometry.js` (Task 1).
- Produces: `ZOOM_MIN` (0.6), `ZOOM_MAX` (2.4), `ZOOM_STEP` (1.25), `clampZoom(zoom)`, `zoomIn(zoom)`, `zoomOut(zoom)`, `vertebraAt(geometry, point, radius=20)`, `attachViewerInteractions(stage, canvas, options)`.
- Deferred to plan 04, which extends this same file: the `Selection` typedef, `TAB_ORDER`
  (22 landmark stops), **`FULL_ORDER` (24 stops — `TAB_ORDER` plus the two femoral-head
  centres)**, `nextSelection`, and `nudge`. `FULL_ORDER` is easy to miss and is the one
  that matters: the spec requires the femoral heads to be keyboard-reachable, and they are
  not landmarks, so wiring Tab to `TAB_ORDER` makes them unreachable — the exact failure
  `FULL_ORDER` exists to prevent.

**For plan 04, decide before you start:** the contract's `interactions.js` section says
transient drag state "live[s] as module-scope variables in
`renderer/components/viewer.js`". This task puts `dragStart` in a closure inside
`attachViewerInteractions`, which `components/viewer.js` cannot reach. That is harmless
for plan 03 — pan is the only drag and it is self-contained — but plan 04 adds
landmark drag and hover, and it must not end up with drag state duplicated across two
files (which the contract's last sentence forbids). Either move the state or refactor this
task's callback-injection design; do not do both halves.

- [ ] **Step 1: Write the failing tests**

Create `test/interactions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZOOM_MIN, ZOOM_MAX, clampZoom, zoomIn, zoomOut, vertebraAt } from '../renderer/viewer/interactions.js';

test('clampZoom clamps to the 0.6..2.4 range and passes through in between', () => {
  assert.equal(clampZoom(0.1), ZOOM_MIN);
  assert.equal(clampZoom(9), ZOOM_MAX);
  assert.equal(clampZoom(1.2), 1.2);
});

test('zoomIn and zoomOut step by 1.25x and clamp at the bounds', () => {
  assert.ok(Math.abs(zoomIn(1) - 1.25) < 1e-9);
  assert.ok(Math.abs(zoomOut(1) - 0.8) < 1e-9);
  assert.equal(zoomIn(2.4), ZOOM_MAX);
  assert.equal(zoomOut(0.6), ZOOM_MIN);
});

function fakeGeometry() {
  return {
    vertebrae: {
      L1: { quadrilateral: [[0, 0], [10, 0], [10, 10], [0, 10]] },
      L2: { quadrilateral: [[0, 20], [10, 20], [10, 30], [0, 30]] },
      L3: { quadrilateral: [[0, 40], [10, 40], [10, 50], [0, 50]] },
      L4: { quadrilateral: [[0, 60], [10, 60], [10, 70], [0, 70]] },
      L5: { quadrilateral: [[0, 80], [10, 80], [10, 90], [0, 90]] },
    },
    s1_superior: [[0, 100], [10, 100]],
  };
}

test('vertebraAt returns the level whose quadrilateral contains the point', () => {
  const geometry = fakeGeometry();
  assert.equal(vertebraAt(geometry, [5, 25]), 'L2');
  assert.equal(vertebraAt(geometry, [5, 65]), 'L4');
});

test('vertebraAt returns S1 near the S1 superior segment and null elsewhere', () => {
  const geometry = fakeGeometry();
  assert.equal(vertebraAt(geometry, [5, 102], 20), 'S1');
  assert.equal(vertebraAt(geometry, [5000, 5000]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/interactions.test.js`
Expected: FAIL with `Cannot find module '../renderer/viewer/interactions.js'`

- [ ] **Step 3: Write minimal implementation**

Create `renderer/viewer/interactions.js`:

```js
import { clientToImage } from './geometry.js';

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.4;
export const ZOOM_STEP = 1.25;

export function clampZoom(zoom) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

// NOTE ON COORDINATES, because this looks like a missing correction and is not.
// clientToImage() derives its scale from canvas.getBoundingClientRect(), and the rect
// ALREADY reflects the CSS `transform: translate(panX, panY) scale(zoom)` that
// components/viewer.js applies to the canvases' shared host. Zoom and pan are therefore
// accounted for exactly once. Do not "fix" the hit test by subtracting panX/panY or
// dividing by zoom -- that double-counts the transform and click-to-select drifts
// further from the cursor the more you pan.

export function zoomIn(zoom) {
  return clampZoom(zoom * ZOOM_STEP);
}

export function zoomOut(zoom) {
  return clampZoom(zoom / ZOOM_STEP);
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, a, b) {
  const [px, py] = point; const [ax, ay] = a; const [bx, by] = b;
  const dx = bx - ax; const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx; const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function vertebraAt(geometry, point, radius = 20) {
  for (const level of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    if (pointInPolygon(point, geometry.vertebrae[level].quadrilateral)) return level;
  }
  const [sa, sp] = geometry.s1_superior;
  if (distanceToSegment(point, sa, sp) <= radius) return 'S1';
  return null;
}

/**
 * Wires wheel-zoom, pan-toggle-drag, and click-to-select onto a stage/canvas pair.
 * options: {
 *   getZoom(): number, getPan(): {panX,panY}, getPanMode(): boolean, getGeometry(): Geometry|null,
 *   onZoom(zoom), onPan(panX, panY), onSelect(level),
 * }
 * Returns a detach() function that removes every listener it added.
 */
export function attachViewerInteractions(stage, canvas, options) {
  function handleWheel(event) {
    event.preventDefault();
    const zoom = options.getZoom();
    options.onZoom(event.deltaY < 0 ? zoomIn(zoom) : zoomOut(zoom));
  }

  let dragStart = null;
  function handlePointerDown(event) {
    if (!options.getPanMode()) return;
    const pan = options.getPan();
    dragStart = { x: event.clientX, y: event.clientY, panX: pan.panX, panY: pan.panY };
    canvas.setPointerCapture(event.pointerId);
  }
  function handlePointerMove(event) {
    if (!dragStart) return;
    options.onPan(dragStart.panX + (event.clientX - dragStart.x), dragStart.panY + (event.clientY - dragStart.y));
  }
  function handlePointerUp(event) {
    dragStart = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function handleClick(event) {
    if (options.getPanMode()) return;
    const geometry = options.getGeometry();
    if (!geometry) return;
    const point = clientToImage(event, canvas);
    const level = vertebraAt(geometry, point);
    if (level) options.onSelect(level);
  }

  stage.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('click', handleClick);

  return function detach() {
    stage.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerUp);
    canvas.removeEventListener('click', handleClick);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/interactions.test.js`
Expected: PASS — 4 tests, 0 failures

- [ ] **Step 5: Commit**
```
git add renderer/viewer/interactions.js test/interactions.test.js
git commit -m "feat: add zoom/pan math and click-to-select hit testing to viewer/interactions.js"
```

**MANUAL VERIFICATION (deferred):** `attachViewerInteractions` is exercised end-to-end once the canvas exists — see Task 7's manual verification, which covers wheel-zoom, the pan toggle, drag-panning, and click-to-select against the real DOM.

---

### Task 5: `viewer/canvas.js` — overlay pixel compositing (pure part)

**Files:**
- Create: `renderer/viewer/canvas.js`
- Test: `test/canvas.test.js`

**Interfaces:**
- Consumes: `predict()` response shape — `labels: {L1: 20, L2: 21, ..., S1: 25, ...}` per `backend/models/models.py`'s `VertebraLabel`.
- Produces: `LEVEL_RGB`, `FEMORAL_OVERLAY_COLOR`, `BASE_OVERLAY_ALPHA` (116), `buildLabelColorMap(labels)`, `buildOverlayPixels(maskPixels, femoralPixels, colorByLabel, alpha)`.

- [ ] **Step 1: Write the failing tests**

Create `test/canvas.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_RGB, FEMORAL_OVERLAY_COLOR, BASE_OVERLAY_ALPHA, buildLabelColorMap, buildOverlayPixels } from '../renderer/viewer/canvas.js';

test('buildLabelColorMap maps L1..L5 backend label ids to the fixed RGB ramp', () => {
  const labels = { BACKGROUND: 0, L1: 20, L2: 21, L3: 22, L4: 23, L5: 24, S1: 25 };
  const map = buildLabelColorMap(labels);
  assert.deepEqual(map[20], LEVEL_RGB.L1);
  assert.deepEqual(map[21], LEVEL_RGB.L2);
  assert.deepEqual(map[24], LEVEL_RGB.L5);
  assert.equal(map[25], undefined);
  assert.equal(map[0], undefined);
});

test('buildOverlayPixels colours a labelled mask pixel and leaves background transparent', () => {
  // Two RGBA pixels: pixel 0 has mask value 20 (L1), pixel 1 has mask value 0 (background).
  const maskPixels = new Uint8ClampedArray([20, 20, 20, 255, 0, 0, 0, 255]);
  const femoralPixels = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0]);
  const colorByLabel = { 20: [255, 99, 132] };
  const overlay = buildOverlayPixels(maskPixels, femoralPixels, colorByLabel, BASE_OVERLAY_ALPHA);
  assert.deepEqual([...overlay.slice(0, 4)], [255, 99, 132, BASE_OVERLAY_ALPHA]);
  assert.deepEqual([...overlay.slice(4, 8)], [0, 0, 0, 0]);
});

test('buildOverlayPixels falls back to the femoral colour when the femoral mask is set and the label mask is not', () => {
  const maskPixels = new Uint8ClampedArray([0, 0, 0, 255]);
  const femoralPixels = new Uint8ClampedArray([1, 0, 0, 255]);
  const overlay = buildOverlayPixels(maskPixels, femoralPixels, {}, BASE_OVERLAY_ALPHA);
  assert.deepEqual([...overlay], [...FEMORAL_OVERLAY_COLOR, BASE_OVERLAY_ALPHA]);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/canvas.test.js`
Expected: FAIL with `Cannot find module '../renderer/viewer/canvas.js'`

- [ ] **Step 3: Write minimal implementation**

Create `renderer/viewer/canvas.js`:

```js
export const LEVEL_RGB = {
  L1: [255, 99, 132],
  L2: [255, 159, 64],
  L3: [255, 205, 86],
  L4: [75, 192, 192],
  L5: [54, 162, 235],
};
export const FEMORAL_OVERLAY_COLOR = [98, 210, 111];
// Baked into the overlay pixel data once per prediction. The static layer scales this by
// (overlayOpacity / 100) via ctx.globalAlpha at draw time, so the default overlayOpacity of 50
// reproduces renderer.js's original hardcoded alpha of 58 exactly (116 * 0.5 = 58).
export const BASE_OVERLAY_ALPHA = 116;

export function buildLabelColorMap(labels) {
  const map = {};
  for (const level of Object.keys(LEVEL_RGB)) {
    const id = labels?.[level];
    if (typeof id === 'number') map[id] = LEVEL_RGB[level];
  }
  return map;
}

export function buildOverlayPixels(maskPixels, femoralPixels, colorByLabel, alpha) {
  const overlay = new Uint8ClampedArray(maskPixels.length);
  for (let offset = 0; offset < maskPixels.length; offset += 4) {
    const labelId = maskPixels[offset];
    const color = colorByLabel[labelId];
    if (color) {
      overlay[offset] = color[0];
      overlay[offset + 1] = color[1];
      overlay[offset + 2] = color[2];
      overlay[offset + 3] = alpha;
    } else if (femoralPixels[offset]) {
      overlay[offset] = FEMORAL_OVERLAY_COLOR[0];
      overlay[offset + 1] = FEMORAL_OVERLAY_COLOR[1];
      overlay[offset + 2] = FEMORAL_OVERLAY_COLOR[2];
      overlay[offset + 3] = alpha;
    }
  }
  return overlay;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/canvas.test.js`
Expected: PASS — 3 tests, 0 failures

- [ ] **Step 5: Commit**
```
git add renderer/viewer/canvas.js test/canvas.test.js
git commit -m "feat: add overlay pixel compositing to viewer/canvas.js"
```

---

### Task 6: `viewer/canvas.js` — image loading and layered draw (DOM part)

**Files:**
- Modify: `renderer/viewer/canvas.js` (append to the file from Task 5)

**Interfaces:**
- Consumes: `LEVELS` from `renderer/viewer/geometry.js`; `buildLabelColorMap`, `buildOverlayPixels`, `BASE_OVERLAY_ALPHA` from Task 5 (same file).
- Produces: `bitmapFromBase64(base64)`, `loadStudyImages(predictResponse)`, `disposeStudyImages(images)`, `createLayeredCanvases(host)`, `sizeCanvases(canvases, width, height)`, `drawStaticLayer(ctx, canvas, images, opts)`, `drawDynamicLayer(ctx, canvas, geometry, opts)`.
- Consumers: `renderer/components/viewer.js` (Task 7) uses `createLayeredCanvases`,
  `sizeCanvases`, `drawStaticLayer`, `drawDynamicLayer`. `renderer/screens/analysis.js`
  (Task 9) imports `loadStudyImages` and `disposeStudyImages` **directly from this
  module**, not re-exported through the viewer — see BD-6, the screen owns image
  lifetime.
- `LEVEL_RGB` has no `S1` entry and `buildLabelColorMap` drops backend label id 25, yet
  `drawDynamicLayer` still draws an S1 outline and an S1 stage label. That is correct and
  matches legacy `renderer.js:44-46`: S1 has geometry but no segmentation overlay colour.
  Do not "fix" it by adding `S1` to `LEVEL_RGB`.

This task is Canvas/DOM code with no available test runner (no jsdom — see Global Constraints). It gets a MANUAL VERIFICATION step instead of an automated test, run together with Task 7 once the toolbar exists to drive it. This task's own step just confirms the module loads without a syntax error.

- [ ] **Step 1: Write the implementation**

Append to `renderer/viewer/canvas.js` (add this import at the top of the existing file, then append the functions below):

```js
import { LEVELS } from './geometry.js';
```

Append:

```js
export async function bitmapFromBase64(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

export async function loadStudyImages(predictResponse) {
  const [image, mask, femoral] = await Promise.all([
    bitmapFromBase64(predictResponse.image_png),
    bitmapFromBase64(predictResponse.mask_png),
    bitmapFromBase64(predictResponse.femoral_mask_png),
  ]);
  const scratch = document.createElement('canvas');
  scratch.width = image.width;
  scratch.height = image.height;
  const context = scratch.getContext('2d');
  context.drawImage(mask, 0, 0);
  const maskPixels = context.getImageData(0, 0, image.width, image.height).data;
  context.clearRect(0, 0, image.width, image.height);
  context.drawImage(femoral, 0, 0);
  const femoralPixels = context.getImageData(0, 0, image.width, image.height).data;
  const colorByLabel = buildLabelColorMap(predictResponse.labels);
  const overlayPixels = buildOverlayPixels(maskPixels, femoralPixels, colorByLabel, BASE_OVERLAY_ALPHA);
  context.clearRect(0, 0, image.width, image.height);
  context.putImageData(new ImageData(overlayPixels, image.width, image.height), 0, 0);
  return { image, mask, femoral, overlayCanvas: scratch, width: image.width, height: image.height };
}

export function disposeStudyImages(images) {
  if (!images) return;
  images.image.close();
  images.mask.close();
  images.femoral.close();
}

export function createLayeredCanvases(host) {
  const staticCanvas = document.createElement('canvas');
  const dynamicCanvas = document.createElement('canvas');
  for (const canvas of [staticCanvas, dynamicCanvas]) {
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }
  dynamicCanvas.style.touchAction = 'none';
  host.append(staticCanvas, dynamicCanvas);
  return {
    staticCanvas,
    dynamicCanvas,
    staticCtx: staticCanvas.getContext('2d'),
    dynamicCtx: dynamicCanvas.getContext('2d'),
  };
}

export function sizeCanvases(canvases, width, height) {
  canvases.staticCanvas.width = width;
  canvases.staticCanvas.height = height;
  canvases.dynamicCanvas.width = width;
  canvases.dynamicCanvas.height = height;
}

export function drawStaticLayer(ctx, canvas, images, opts) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!images) return;
  ctx.drawImage(images.image, 0, 0);
  if (opts.overlays && images.overlayCanvas) {
    ctx.globalAlpha = Math.max(0, Math.min(1, opts.overlayOpacity / 100));
    ctx.drawImage(images.overlayCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }
}

// The four off-theme literals the architecture contract sanctions for this file, and
// the only hardcoded colours anywhere in plan 03's JavaScript. Everything drawn as DOM
// over this canvas is styled from styles/screens/analysis.css -- see BD-3.
const STAGE_LINE_COLOR = '#38342F';
const STAGE_SELECTED_COLOR = '#D45A32';
const STAGE_LABEL_FILL = 'rgba(250,247,242,.75)';
const LABEL_PLATE_FILL = 'rgba(11,10,9,.78)';

// Canvas text cannot express font-variant-numeric: tabular-nums (the ctx.font shorthand
// has no slot for it), so every canvas-drawn label that contains a number uses Chivo
// Mono, which is monospaced and therefore tabular by construction.
const CANVAS_MONO = "'Chivo Mono', monospace";

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// Draws the level's name (L1..L5, S1) ONLY when that level is selected. Named for what
// it does: the unselected levels are identified by their outline, not by a label, so the
// stage is not covered in text.
function drawSelectedStageLabel(ctx, text, point, selected, canvasWidth) {
  if (!selected) return;
  const fontSize = Math.max(11, canvasWidth / 70);
  ctx.font = `700 ${fontSize}px ${CANVAS_MONO}`;
  ctx.fillStyle = STAGE_LABEL_FILL;
  ctx.fillText(text, point[0] + 10, point[1] - 10);
}

function drawMeasurementLabel(ctx, canvas, text, point) {
  const fontSize = Math.max(12, canvas.width / 60);
  ctx.font = `600 ${fontSize}px ${CANVAS_MONO}`;
  const width = ctx.measureText(text).width + 12;
  // Backing plate: STAGE_LABEL_FILL and STAGE_SELECTED_COLOR are both light-on-dark and
  // vanish over a bright region of a radiograph without it.
  ctx.fillStyle = LABEL_PLATE_FILL;
  ctx.fillRect(point[0] - 4, point[1] - fontSize, width, fontSize + 7);
  ctx.fillStyle = STAGE_SELECTED_COLOR;
  ctx.fillText(text, point[0] + 2, point[1] + 2);
}

function drawSelectedMeasurement(ctx, canvas, geometry, selectedLevel, measurements) {
  if (!selectedLevel || !measurements) return;
  ctx.save();
  // try/finally, not a bare save()/restore() pair. This function runs inside a store
  // subscriber, and store.js:59-63 iterates listeners with NO per-listener try/catch -- so a
  // throw here does not merely blank the dynamic layer, it stops every subscriber registered
  // after this one, including the router's, for this update and every update after it. The
  // whole UI freezes. The ctx is also created once in createLayeredCanvases and reused, so a
  // throw that skipped restore() would leave an unmatched save() on the canvas state stack
  // every frame.
  try {
    ctx.strokeStyle = STAGE_SELECTED_COLOR;
    ctx.lineWidth = Math.max(2, canvas.width / 400);
    if (selectedLevel === 'S1') {
      const s1 = geometry.s1_superior;
      const s1Mid = midpoint(s1[0], s1[1]);
      const hip = geometry.hip_midpoint;
      ctx.beginPath();
      ctx.moveTo(...s1Mid);
      ctx.lineTo(...hip);
      ctx.stroke();
      // Guarded the same way the LL branch below is -- and after this plan's Task 6 fix that
      // claim is finally true. An unguarded .toFixed() on a null PI/PT/SS throws inside the
      // render loop, which aborts the whole dynamic layer and, because this runs in a store
      // subscriber, stops the router from rendering at all.
      const { PI, PT, SS } = measurements;
      if (PI != null && PT != null && SS != null) {
        drawMeasurementLabel(
          ctx, canvas,
          `PI ${PI.toFixed(1)}\u00B0  PT ${PT.toFixed(1)}\u00B0  SS ${SS.toFixed(1)}\u00B0`,
          midpoint(s1Mid, hip),
        );
      }
      } else if (selectedLevel === 'L1PA') {
      // L1 pelvic angle: the angle subtended at the hip midpoint between the L1 body
      // centroid and the S1 endplate midpoint. Two rays from the hip -- NOT an endplate
      // pair. This branch exists because falling through to the lordosis branch below drew
      // the wrong construction under the right label. See the contract's selectedLevel
      // section.
      const hip = geometry.hip_midpoint;
      const l1c = geometry.l1_center;
      const s1Mid = midpoint(geometry.s1_superior[0], geometry.s1_superior[1]);
      ctx.beginPath();
      ctx.moveTo(...hip);
      ctx.lineTo(...l1c);
      ctx.moveTo(...hip);
      ctx.lineTo(...s1Mid);
      ctx.stroke();
      if (measurements.L1PA != null) {
        drawMeasurementLabel(ctx, canvas, `L1PA ${measurements.L1PA.toFixed(1)}\u00B0`, midpoint(hip, l1c));
      }
    } else {
      const body = geometry.vertebrae[selectedLevel];
      const s1 = geometry.s1_superior;
      ctx.beginPath();
      ctx.moveTo(...body.superior[0]);
      ctx.lineTo(...body.superior[1]);
      ctx.moveTo(...s1[0]);
      ctx.lineTo(...s1[1]);
      ctx.stroke();
      const key = `${selectedLevel}-S1`;
      // Optional chaining is load-bearing here, not decoration. A measurements object shaped
      // {PI, PT, SS, L1PA} with no LL key is a real shape -- Task 3 had to fix toCsv for
      // exactly it, and plan 05 persists these records to a user-writable file. Because
      // geometry.vertebrae is populated independently of measurements, an L-level stays
      // clickable in the outline even when its LL value is missing, so this line IS reachable.
      const value = measurements.LL?.[key];
      if (value != null) {
        drawMeasurementLabel(ctx, canvas, `LL ${key} ${value.toFixed(1)}\u00B0`, midpoint(body.superior[0], body.superior[1]));
      }
    }
  } finally {
    ctx.restore();
  }
}

export function drawDynamicLayer(ctx, canvas, geometry, opts) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!geometry) return;
  const selectedLevel = opts.selectedLevel ?? null;
  const lineWidth = Math.max(2, canvas.width / 600);
  ctx.lineJoin = 'round';
  for (const level of LEVELS) {
    const body = geometry.vertebrae[level];
    const selected = level === selectedLevel;
    ctx.strokeStyle = selected ? STAGE_SELECTED_COLOR : STAGE_LINE_COLOR;
    ctx.lineWidth = selected ? lineWidth * 1.6 : lineWidth;
    ctx.beginPath();
    body.quadrilateral.forEach((point, index) => (index ? ctx.lineTo(...point) : ctx.moveTo(...point)));
    ctx.closePath();
    ctx.stroke();
    drawSelectedStageLabel(ctx, level, body.quadrilateral[0], selected, canvas.width);
  }
  const selectedS1 = selectedLevel === 'S1';
  ctx.strokeStyle = selectedS1 ? STAGE_SELECTED_COLOR : STAGE_LINE_COLOR;
  ctx.lineWidth = selectedS1 ? lineWidth * 1.6 : lineWidth;
  ctx.beginPath();
  ctx.moveTo(...geometry.s1_superior[0]);
  ctx.lineTo(...geometry.s1_superior[1]);
  ctx.stroke();
  drawSelectedStageLabel(ctx, 'S1', geometry.s1_superior[0], selectedS1, canvas.width);

  ctx.strokeStyle = STAGE_LINE_COLOR;
  ctx.lineWidth = lineWidth;
  geometry.femoral_circles.forEach(([x, y, r]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.stroke();
  });

  drawSelectedMeasurement(ctx, canvas, geometry, selectedLevel, opts.measurements);
}
```

- [ ] **Step 2: Confirm the module still loads**
Run: `node --check renderer/viewer/canvas.js`
Expected: no output (Node's syntax checker only parses the file; it does not execute `document`/`createImageBitmap` calls at module scope, so this passes even outside a browser)

- [ ] **Step 3: Re-run Task 5's tests to confirm the pure exports are unaffected**
Run: `node --test test/canvas.test.js`
Expected: PASS — 3 tests, 0 failures

- [ ] **Step 4: MANUAL VERIFICATION**
Deferred to Task 7, Step 4 — this module has no host DOM to render into until the viewer component exists. Task 7's manual verification exercises `loadStudyImages`, `drawStaticLayer`, and `drawDynamicLayer` directly. Two things to look at specifically while you are there, because only a real radiograph can settle them: `STAGE_LABEL_FILL` (near-white, backed by a plate only on measurement labels, not on stage labels) over a **bright** region of the film, and `STAGE_LINE_COLOR` `#38342F` over a **black** region.

- [ ] **Step 5: Commit**
```
git add renderer/viewer/canvas.js
git commit -m "feat: add image loading and layered drawing to viewer/canvas.js"
```

---

### Task 7: `components/viewer.js` — stage, toolbar, and layered canvas host

**Files:**
- Create: `styles/screens/analysis.css`
- Modify: `index.html` (one `<link>`)
- Create: `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `el` from `renderer/dom.js` (plan 02 — **`clear` and `mount` are not used by this module**); `getState`, `setState` from `renderer/store.js` (plan 02); `createLayeredCanvases`, `sizeCanvases`, `drawStaticLayer`, `drawDynamicLayer` from `renderer/viewer/canvas.js` (Tasks 5-6); `attachViewerInteractions`, `zoomIn`, `zoomOut` from `renderer/viewer/interactions.js` (Task 4).
- Produces: `mountViewer(container)` — builds the stage DOM once, wires interactions once, and returns **exactly these four keys, all four of which Task 9 uses**:

  | Key | Signature | Contract |
  |---|---|---|
  | `updateViewer` | `(study) → void` | One argument. Images are not passed in; see `setImages`. |
  | `setImages` | `(images \| null) → void` | Stores the reference and sizes the canvases. **Never disposes** — `screens/analysis.js` owns image lifetime (BD-6). |
  | `setRunHandler` | `(fn) → void` | Click handler for the run card's button. |
  | `detach` | `() → void` | Removes every listener `attachViewerInteractions` added. Nothing else. |

  It does **not** re-export `loadStudyImages` / `disposeStudyImages`; Task 9 imports those straight from `../viewer/canvas.js`.

`updateViewer` is cheap to call on every store notification: it calls `drawStaticLayer`
only when `overlays`/`overlayOpacity`/`images` changed since the last call,
`drawDynamicLayer` only when `geometry`/`selectedLevel`/`measurements` changed, and
redraws nothing at all for pan/zoom — those are a CSS `transform` on the canvas host,
per this plan's layered-rendering note above (this is what resolves spec §16's
performance risk: dragging to pan costs zero canvas redraws).

**Read BD-2 before this task.** This component drives `zoom`/`panX`/`panY`/`panMode`
through `setState` at pointermove rate. None of those keys may be added to `SCREEN_KEYS`,
and this task does not edit `renderer/router.js`.

**Read BD-3 before this task.** This task owns `styles/screens/analysis.css` and its
`<link>`; Tasks 8 and 9 append to the file it creates. No `style:` prop is passed to
`el()` anywhere in this plan.

This is DOM/canvas code with no available test runner. It gets a MANUAL VERIFICATION step.

- [ ] **Step 1: Create the stylesheet and link it**

Create `styles/screens/analysis.css`:

```css
/* Study Analysis screen.
   01 — screen shell and header  (Task 9 appends here)
   02 — viewer stage             (this task)
   03 — measurements panel       (Task 8 appends here) */

/* ===== 02 — VIEWER STAGE ================================================
   The stage is deliberately OFF-THEME in both light and dark mode: a radiograph is read
   on a black field, not a warm cream one. The architecture contract grants this
   exception and names four literals for viewer/canvas.js -- those cover the pixels drawn
   INTO the canvas. The tokens below cover the DOM chrome floating OVER it (toolbar,
   study chip, footer watermark, run card), declared once here instead of repeated as
   twelve literals in components/viewer.js. They are deliberately NOT redefined under
   body[data-dark]: the stage is identical in both themes, which is the whole point. */
.viewer-stage {
  --stage-bg: #0B0A09;
  --stage-card: #181614;
  --stage-well: #282522;
  --stage-line: #38342F;
  --stage-ink: #FAF7F2;
  --stage-body: #C9C2B8;
  --stage-muted: #9A9188;
  --stage-accent: #D45A32;
  --stage-accent-soft: rgba(212, 90, 50, .16);
  --stage-chrome: rgba(20, 18, 16, .85);
  --stage-scrim: rgba(11, 10, 9, .72);
  --stage-watermark: rgba(250, 247, 242, .3);

  flex: 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
  background: var(--stage-bg);
}
.viewer-stage.is-pan-mode { cursor: grab; }
.viewer-stage.is-pan-mode:active { cursor: grabbing; }

.viewer-host {
  position: absolute;
  inset: 0;
  transform-origin: center;
}
/* createLayeredCanvases() sizes and positions the two <canvas> children. */

.viewer-chip {
  position: absolute;
  top: 14px;
  left: 14px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 12px;
  border-radius: 12px;
  background: var(--stage-chrome);
  border: 1px solid var(--stage-line);
  backdrop-filter: blur(8px);
}
.viewer-chip-id {
  font-family: 'Chivo Mono', monospace;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.13em;
  color: var(--stage-ink);
  font-variant-numeric: tabular-nums;
}

.viewer-toolbar {
  position: absolute;
  top: 14px;
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

.viewer-tool {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--stage-muted);
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.viewer-tool:hover {
  background: var(--stage-well);
  color: var(--stage-ink);
}
.viewer-tool.is-active {
  background: var(--stage-accent-soft);
  color: var(--stage-accent);
}
.viewer-tool:focus-visible {
  outline: 2px solid var(--stage-accent);
  outline-offset: 2px;
}

.viewer-zoom {
  width: 36px;
  text-align: center;
  font-family: 'Chivo Mono', monospace;
  font-size: 9px;
  font-weight: 500;
  color: var(--stage-muted);
  font-variant-numeric: tabular-nums;
}

.viewer-divider {
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--stage-line);
}

.viewer-fill {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px 0 5px;
}
.viewer-fill-label {
  font-family: 'Chivo Mono', monospace;
  font-size: 8px;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: var(--stage-muted);
}
.viewer-fill-slider {
  width: 72px;
  height: 12px;
  cursor: pointer;
  accent-color: var(--stage-accent);
}

.viewer-footer {
  position: absolute;
  left: 16px;
  bottom: 14px;
  max-width: calc(100% - 32px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Chivo Mono', monospace;
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: var(--stage-watermark);
  font-variant-numeric: tabular-nums;
}

/* Needs-run / running overlay. One indeterminate state, never a stage sequence -- BD-4. */
.run-card {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--stage-scrim);
  backdrop-filter: blur(2px);
}
.run-card.is-hidden { display: none; }

.run-card-inner {
  width: 340px;
  padding: 26px;
  border-radius: 16px;
  background: var(--stage-card);
  border: 1px solid var(--stage-line);
  text-align: center;
}
.run-eyebrow {
  font-family: 'Chivo Mono', monospace;
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.16em;
  color: var(--stage-muted);
}
.run-title {
  margin-top: 10px;
  font: 650 18px 'Source Sans 3', sans-serif;
  color: var(--stage-ink);
}
.run-body {
  margin-top: 8px;
  font: 400 13.5px/1.5 'Source Sans 3', sans-serif;
  color: var(--stage-body);
}
.run-spinner {
  margin: 16px auto 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--stage-line);
  border-top-color: var(--stage-accent);
  animation: spin .8s linear infinite;   /* @keyframes spin -- styles/base.css:77-80 */
}
.run-spinner.is-hidden { display: none; }

.run-button {
  margin-top: 18px;
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 10px;
  background: var(--stage-accent);
  color: #FFFFFF;                        /* = --on-accent; the stage has no theme to read it from */
  font: 650 14px 'Source Sans 3', sans-serif;
  cursor: pointer;
  transition: filter .15s ease, opacity .15s ease;
}
.run-button:hover:not(:disabled) { filter: brightness(1.08); }
.run-button:disabled { opacity: .6; cursor: wait; }
.run-button:focus-visible {
  outline: 2px solid var(--stage-accent);
  outline-offset: 2px;
}
```

Then add the `<link>` to `index.html`, after the `studies.css` line
(`index.html:12-16` links exactly five sheets today; without this the new file is
silently inert):

```html
    <link rel="stylesheet" href="styles/screens/analysis.css" />
```

- [ ] **Step 2: Write the implementation**

Create `renderer/components/viewer.js`:

```js
import { el } from '../dom.js';
import { getState, setState } from '../store.js';
import {
  createLayeredCanvases, sizeCanvases, drawStaticLayer, drawDynamicLayer,
} from '../viewer/canvas.js';
import { attachViewerInteractions, zoomIn, zoomOut } from '../viewer/interactions.js';

// Icons lifted verbatim from design-reference/template.html's Study Analysis toolbar.
// Same inline-SVG-through-innerHTML pattern plan 02 uses in components/sidebar.js and
// screens/landing.js. They replace the placeholder glyphs an earlier draft used, which
// also made every tooltip read as the glyph itself.
const SVG_OPEN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const ICONS = {
  zoomOut: `${SVG_OPEN}<circle cx="11" cy="11" r="7"></circle><path d="M8 11 H14"></path><path d="M16.5 16.5 L21 21"></path></svg>`,
  zoomIn: `${SVG_OPEN}<circle cx="11" cy="11" r="7"></circle><path d="M8 11 H14"></path><path d="M11 8 V14"></path><path d="M16.5 16.5 L21 21"></path></svg>`,
  fit: `${SVG_OPEN}<path d="M9 4 H5 V8"></path><path d="M15 4 H19 V8"></path><path d="M9 20 H5 V16"></path><path d="M15 20 H19 V16"></path></svg>`,
  pan: `${SVG_OPEN}<path d="M12 3 V21"></path><path d="M3 12 H21"></path><path d="M9.5 5.5 L12 3 L14.5 5.5"></path><path d="M9.5 18.5 L12 21 L14.5 18.5"></path><path d="M5.5 9.5 L3 12 L5.5 14.5"></path><path d="M18.5 9.5 L21 12 L18.5 14.5"></path></svg>`,
  overlays: `${SVG_OPEN}<path d="M12 3 L21 8 L12 13 L3 8 Z"></path><path d="M3 14 L12 19 L21 14"></path></svg>`,
};

// Real <button>s, not <div>s: the toolbar has to be keyboard-reachable and
// screen-reader-nameable, and `title` has to be a sentence rather than the icon.
function toolButton(label, icon, onClick) {
  return el('button', {
    type: 'button',
    class: 'viewer-tool',
    title: label,
    'aria-label': label,
    onClick,
    innerHTML: icon,
  });
}

function footerText(study) {
  // `study.pt` is the demo-set PATIENT label. It is not the PT pelvic-tilt measurement,
  // which lives at study.measurements.PT. Do not "fix" this to a number.
  const patient = study.pt ?? '\u2014';
  const sex = study.sex ?? '\u2014';
  const age = study.age ?? '\u2014';
  return `${study.id} \u00B7 ${patient} \u00B7 ${sex} \u00B7 ${age} \u2014 NOT FOR CLINICAL USE`;
}

// Redraw gating compares by REFERENCE, not by JSON.stringify: the dynamic key contains
// study.geometry, and stringifying a full geometry object on every pointermove frame is
// exactly the per-frame cost the layered design exists to avoid.
//
// PLAN 04, READ THIS. Reference equality is correct for plan 03 because geometry is only
// ever replaced wholesale by a /predict response. Landmark dragging must therefore
// REPLACE the geometry object (or the level within it), never mutate the existing one in
// place and re-set the same reference -- that compares equal here and the outline would
// not follow the handle. renderer/router.js:44-52 carries the same warning for its own
// key sets, for the same reason.
function sameKey(a, b) {
  return a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);
}

export function mountViewer(container) {
  const stage = el('div', { class: 'viewer-stage' });
  const host = el('div', { class: 'viewer-host' });
  const { staticCanvas, dynamicCanvas, staticCtx, dynamicCtx } = createLayeredCanvases(host);
  // createLayeredCanvases already appended both canvases to `host`. Do not append again.

  const chipId = el('div', { class: 'viewer-chip-id' });
  const chip = el('div', { class: 'viewer-chip' }, chipId);

  const zoomLabel = el('div', { class: 'viewer-zoom' }, '100%');
  const panButton = toolButton('Pan', ICONS.pan, () => setState((s) => ({ panMode: !s.panMode })));
  const overlayButton = toolButton('Toggle segmentation overlay', ICONS.overlays, () => setState((s) => ({ overlays: !s.overlays })));
  const fillSlider = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    value: String(getState().overlayOpacity),
    class: 'viewer-fill-slider',
    'aria-label': 'Segmentation overlay opacity',
    onInput: (e) => setState({ overlayOpacity: Number(e.target.value) }),
  });

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
      fillSlider));

  const footer = el('div', { class: 'viewer-footer' });

  // Indeterminate ring plus one static description. It conveys "working" and nothing
  // more: /predict has no progress channel, so there is no stage to name and no
  // percentage to report. See BD-4 -- do not add a stage timer here.
  const runEyebrow = el('div', { class: 'run-eyebrow' });
  const runTitle = el('div', { class: 'run-title' });
  const runBody = el('div', { class: 'run-body' });
  const runSpinner = el('div', { class: 'run-spinner is-hidden' });
  const runButton = el('button', { type: 'button', class: 'run-button' }, 'Run segmentation');
  const runCard = el('div', { class: 'run-card is-hidden' },
    el('div', { class: 'run-card-inner' }, runEyebrow, runTitle, runBody, runSpinner, runButton));

  stage.append(host, chip, toolbar, footer, runCard);
  container.append(stage);

  let currentImages = null;
  let lastStatic = null;
  let lastDynamic = null;

  const detach = attachViewerInteractions(stage, dynamicCanvas, {
    getZoom: () => getState().zoom,
    getPan: () => ({ panX: getState().panX, panY: getState().panY }),
    getPanMode: () => getState().panMode,
    getGeometry: () => {
      const state = getState();
      const study = state.studies.find((s) => s.id === state.openId);
      return study ? study.geometry : null;
    },
    onZoom: (zoom) => setState({ zoom }),
    onPan: (panX, panY) => setState({ panX, panY }),
    onSelect: (level) => setState({ selectedLevel: level }),
  });

  function applyTransform(state) {
    // The two per-frame node writes BD-3 sanctions. Everything else below is a class.
    host.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    fillSlider.value = String(state.overlayOpacity);

    zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    stage.classList.toggle('is-pan-mode', state.panMode);
    panButton.classList.toggle('is-active', state.panMode);
    overlayButton.classList.toggle('is-active', state.overlays);
  }

  // Stores the decoded bitmaps and sizes the canvases to them. Deliberately does NOT
  // dispose the outgoing set: screens/analysis.js owns image lifetime and caches one
  // study's images across navigation, so disposing here would close bitmaps that are
  // still owned elsewhere. See BD-6.
  function setImages(images) {
    if (images === currentImages) return;
    currentImages = images;
    if (images) sizeCanvases({ staticCanvas, dynamicCanvas }, images.width, images.height);
    lastStatic = null;
    lastDynamic = null;
  }

  function updateViewer(study) {
    const state = getState();
    applyTransform(state);
    chipId.textContent = study.id;
    footer.textContent = footerText(study);

    const hasResult = Boolean(study.measurements && study.geometry);
    runCard.classList.toggle('is-hidden', hasResult);
    if (!hasResult) {
      const running = state.running;
      runEyebrow.textContent = running ? 'RUNNING' : 'QUEUED';
      runTitle.textContent = running ? 'Segmenting and measuring\u2026' : 'No segmentation yet';
      // Describes what the pipeline does. Deliberately makes no claim about which model
      // is currently executing -- see the indeterminate-progress note above and BD-4.
      runBody.textContent = running
        ? 'Runs three models: vertebral segmentation, S1 keypoint detection, and femoral head fitting.'
        : 'This study was uploaded but has not been processed. Run segmentation to generate measurements.';
      runSpinner.classList.toggle('is-hidden', !running);
      runButton.textContent = running ? 'Working\u2026' : 'Run segmentation';
      runButton.disabled = running;
    }

    const staticKey = [state.overlays, state.overlayOpacity, currentImages];
    if (!sameKey(staticKey, lastStatic)) {
      lastStatic = staticKey;
      drawStaticLayer(staticCtx, staticCanvas, currentImages, {
        overlays: state.overlays,
        overlayOpacity: state.overlayOpacity,
      });
    }

    const dynamicKey = [study.geometry, state.selectedLevel, study.measurements];
    if (!sameKey(dynamicKey, lastDynamic)) {
      lastDynamic = dynamicKey;
      drawDynamicLayer(dynamicCtx, dynamicCanvas, study.geometry, {
        selectedLevel: state.selectedLevel,
        measurements: study.measurements,
      });
    }
  }

  function setRunHandler(handler) {
    runButton.onclick = handler;
  }

  return { updateViewer, setImages, setRunHandler, detach };
}
```

- [ ] **Step 3: Confirm the module loads and the stylesheet is linked**
Run: `node --check renderer/components/viewer.js`
Expected: no output.

Then run: `grep -n "analysis.css" index.html`
Expected: one hit. `node --check` only parses — it cannot see a missing `<link>`, a
`style:` prop, or a class with no rule behind it. Also confirm by eye that
`renderer/components/viewer.js` contains no occurrence of `style:` and exactly one
occurrence of `.style.` (`host.style.transform`) — `fillSlider.value` is a form value,
not a style.

- [ ] **Step 4: MANUAL VERIFICATION (performed after Task 9)**

This component cannot be exercised before `screens/analysis.js` (Task 9) calls
`mountViewer`; there is nothing here to check off until then. Come back once Task 9 is
committed. Launch the app (`npm run dev` — see the handoff note about
`SPINE_CONTOUR_PYTHON`), pick a radiograph from the Studies screen, and run segmentation.
Then:
1. The stage background is solid near-black and the radiograph plus coloured vertebra outlines are visible.
2. Scroll the mouse wheel over the stage: the zoom readout changes and the image visibly scales, clamped between 60% and 240%.
3. Click the zoom-out / zoom-in buttons: same clamped behaviour. Hovering each toolbar button shows a real sentence tooltip (`Zoom out`, `Zoom in`, `Fit to view`, `Pan`, `Toggle segmentation overlay`), never a glyph.
4. Tab into the toolbar: each button takes focus with a visible ring, and Space/Enter activates it.
5. Click Pan: the button highlights accent-orange; dragging on the stage pans the image instead of selecting a vertebra; the cursor is a grab hand; toggling it off restores click-to-select. **Watch the image through the whole drag** — if it disappears on the first pixel, a key was added to `SCREEN_KEYS`; see BD-2.
6. Click Fit to view: zoom returns to 100% and pan to (0, 0).
7. Drag `FILL` from 0 to 100: overlay opacity visibly increases; at the default 50 the overlay density matches today's app.
8. Click the overlay toggle: the coloured overlay disappears entirely; click again to restore it.
9. Click directly on the L4 vertebra in the image: its outline turns accent-orange and a `LL L4-S1 {value}°` label with its construction line appears. Confirm `getState().selectedLevel === 'L4'` in the DevTools console.
10. The footer watermark reads `{id} · — · — · — — NOT FOR CLINICAL USE` for a freshly-picked (non-demo) study, since no clinical patient fields are populated yet.
11. Toggle the theme in the sidebar: the panel and header change theme; **the stage, its toolbar, its chip and its footer do not.** That is intended — see the stage token block in `analysis.css`.

- [ ] **Step 5: Commit**
```
git add styles/screens/analysis.css index.html renderer/components/viewer.js
git commit -m "feat: add the layered viewer stage, toolbar, and needs-run overlay"
```

---

### Task 8: `components/measurements.js` — the Measurements tab

**Files:**
- Create: `renderer/components/measurements.js`
- Modify: `styles/screens/analysis.css` (append section 03 — the file is created by Task 7)

**Interfaces:**
- Consumes: `sagittalRows`, `lordosisRows`, `discRows`, `alignmentRows`, `isConsistent` from `renderer/data/measurements.js` (Task 2) — **not `piResidual`**, which `isConsistent` already wraps; `el`, `clear` from `renderer/dom.js`; `getState`, `setState` from `renderer/store.js`.
- Produces: `mountMeasurements(container)` — returns `{ updateMeasurements(study) }`.

`updateMeasurements` is called by `screens/analysis.js` on **every** store notification,
including every pointermove pan frame. Rebuilding the panel unconditionally would tear
down and rebuild every row sixty times a second during a pan, resetting the reader's
scroll position and dropping keyboard focus mid-gesture. It therefore gates its own
rebuild on a reference-compared key, the same way `components/viewer.js` gates its two
draw calls. Keeping the gate inside this component, rather than in the screen, is what
lets it name the four things it actually reads.

The panel has no `detach()`: it adds no listeners outside the nodes it owns, so removing
its root removes everything. If it ever grows a document-level listener or a timer, it
needs one, and `screens/analysis.js`'s teardown must call it.

**Read BD-3 before this task.** No `style:` prop; this task appends section 03 to
`styles/screens/analysis.css`.

- [ ] **Step 1: Append the panel styles**

Append to `styles/screens/analysis.css`:

```css
/* ===== 03 — MEASUREMENTS PANEL ========================================= */
.meas-panel {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.meas-section {
  display: flex;
  flex-direction: column;
}

.meas-section-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.meas-section-title {
  font-family: 'Chivo Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.15em;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.meas-rule {
  flex: 1;
  height: 1px;
  background: var(--border);
}

.meas-rows {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* Two row shapes, and the difference is deliberate. A sagittal or lordosis row selects a
   vertebra, so it is a <button>. A disc-height or alignment row has no value and nothing
   to select, so it is a <div> with no handler and no pointer cursor -- an earlier draft
   gave those rows `cursor:pointer` and an empty onClick, which reads as broken. */
.meas-row,
.meas-row-static {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  text-align: left;
}
.meas-row { cursor: pointer; }
.meas-row:hover { background: var(--well); }
.meas-row.is-selected { background: var(--well); }
.meas-row.is-selected .meas-label { color: var(--accent); }
.meas-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.meas-label {
  font-family: 'Chivo Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.13em;
  color: var(--muted);
}
.meas-spacer { flex: 1; }
.meas-value {
  width: 64px;
  text-align: right;
  font: 600 16px/1 'Source Sans 3', sans-serif;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.meas-disclosure {
  align-self: flex-start;
  padding: 6px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-family: 'Chivo Mono', monospace;
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.13em;
  color: var(--accent);
  cursor: pointer;
}
.meas-disclosure:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.meas-note,
.meas-warning {
  margin-top: 4px;
  padding: 0 12px;
  font: 400 12px/1.5 'Source Sans 3', sans-serif;
}
.meas-note { color: var(--muted); }
.meas-warning { color: var(--accent); }
```

- [ ] **Step 2: Write the implementation**

Create `renderer/components/measurements.js`:

```js
import { el, clear } from '../dom.js';
import { getState, setState } from '../store.js';
import { sagittalRows, lordosisRows, discRows, alignmentRows, isConsistent } from '../data/measurements.js';

const INCONSISTENCY_WARNING = 'Parameters inconsistent \u2014 check S1 and femoral landmarks.';
const NOT_COMPUTED_NOTE = 'Not computed in this build.';

function formatRowValue(row) {
  return row.absent ? '\u2014' : `${row.value.toFixed(1)}${row.unit}`;
}

function section(title, ...children) {
  return el('div', { class: 'meas-section' },
    el('div', { class: 'meas-section-head' },
      el('div', { class: 'meas-section-title' }, title),
      el('div', { class: 'meas-rule' })),
    ...children);
}

// A row that selects a vertebra. A real <button> so it is keyboard-reachable: these are
// the only way to drive the viewer's construction lines without a mouse until plan 04.
function rowButton(row, onClick) {
  return el('button', {
    type: 'button',
    class: `meas-row${row.highlight ? ' is-selected' : ''}`,
    'aria-pressed': row.highlight ? 'true' : 'false',
    onClick,
  },
    el('div', { class: 'meas-label' }, row.label),
    el('div', { class: 'meas-spacer' }),
    el('div', { class: 'meas-value' }, formatRowValue(row)));
}

// A row with nothing to select. No handler and no pointer cursor -- disc heights and
// spondylolisthesis are not computed in this build, so there is no level to highlight
// and nothing for a click to do.
function rowStatic(row) {
  return el('div', { class: 'meas-row-static' },
    el('div', { class: 'meas-label' }, row.label),
    el('div', { class: 'meas-spacer' }),
    el('div', { class: 'meas-value' }, formatRowValue(row)));
}

// Which vertebra a row's click selects.
//
// This is the WRITE half of the row/level mapping; data/measurements.js's SAGITTAL_DEFS
// is the READ half, and the two are deliberately asymmetric for exactly one row. PILL
// highlights when EITHER L1 or S1 is selected (`levels: ['L1','S1']`, because the PI-LL
// mismatch is a relationship between them), but a click has to choose one, and S1 is the
// one that draws a construction the user can see: the S1-midpoint-to-hip line shared by
// PI, PT and SS. Do not "reconcile" these into one table -- they answer different
// questions.
const ROW_LEVELS = { LL: 'L1', PI: 'PI', PT: 'PT', SS: 'SS', PILL: 'S1', L1PA: 'L1PA' };

function sameKey(a, b) {
  return a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);
}

export function mountMeasurements(container) {
  clear(container);
  const root = el('div', { class: 'meas-panel' });
  container.append(root);

  let lastKey = null;

  function updateMeasurements(study) {
    const state = getState();

    // Rebuild gate. screens/analysis.js calls this on every store notification, which
    // includes every pointermove pan frame; without the gate, a pan tears down and
    // rebuilds every row per frame, resetting scroll position and dropping focus.
    // Compared by reference: `measurements` is replaced wholesale by /predict, never
    // mutated. Same caveat as components/viewer.js -- plan 04 must replace, not mutate.
    const key = [study.id, study.measurements, state.selectedLevel, state.showAllLordosis];
    if (sameKey(key, lastKey)) return;
    lastKey = key;

    clear(root);
    const measurements = study.measurements;
    const rows = sagittalRows(measurements, { selectedLevel: state.selectedLevel });

    const section1 = section('01 \u2014 SAGITTAL PARAMETERS',
      el('div', { class: 'meas-rows' },
        ...rows.map((row) => rowButton(row, () => setState({ selectedLevel: ROW_LEVELS[row.key] })))));

    section1.append(el('button', {
      type: 'button',
      class: 'meas-disclosure',
      'aria-expanded': state.showAllLordosis ? 'true' : 'false',
      onClick: () => setState((s) => ({ showAllLordosis: !s.showAllLordosis })),
    }, state.showAllLordosis ? 'HIDE LORDOSIS LEVELS' : 'SHOW ALL LORDOSIS LEVELS'));

    if (state.showAllLordosis) {
      section1.append(el('div', { class: 'meas-rows' },
        ...lordosisRows(measurements).map((row) => rowButton(
          row,
          // Row key 'L2-S1' uses an ASCII hyphen; the label uses an en dash. The split
          // below relies on the key form, so do not unify them.
          () => setState({ selectedLevel: row.key.split('-')[0] }),
        ))));
    }

    if (!isConsistent(measurements)) {
      section1.append(el('div', { class: 'meas-warning' }, INCONSISTENCY_WARNING));
    }

    const section2 = section('02 \u2014 DISC HEIGHTS \u00B7 MM',
      el('div', { class: 'meas-rows' }, ...discRows().map(rowStatic)),
      el('div', { class: 'meas-note' }, NOT_COMPUTED_NOTE));

    const section3 = section('03 \u2014 ALIGNMENT',
      el('div', { class: 'meas-rows' }, ...alignmentRows(study).map(rowStatic)),
      el('div', { class: 'meas-note' }, NOT_COMPUTED_NOTE));

    root.append(section1, section2, section3);
  }

  return { updateMeasurements };
}
```

- [ ] **Step 3: Confirm the module loads and carries no inline styles**
Run: `node --check renderer/components/measurements.js`
Expected: no output.

Then run: `grep -c "style:" renderer/components/measurements.js`
Expected: `0`.

- [ ] **Step 4: MANUAL VERIFICATION (performed after Task 9)**

This component is mounted by `screens/analysis.js` (Task 9) and cannot be exercised
standalone; there is nothing here to check off until Task 9 is committed. With a
segmented study open:
1. Section `01 — SAGITTAL PARAMETERS` shows exactly six rows in order: `LUMBAR LORDOSIS · L1–S1`, `PELVIC INCIDENCE`, `PELVIC TILT`, `SACRAL SLOPE`, `PI–LL MISMATCH`, `L1 PELVIC ANGLE`, each with a numeric value and `°`.
2. Click `SHOW ALL LORDOSIS LEVELS`: four more rows (`L2-S1` through `L5-S1`) appear beneath section 01, and the label flips to `HIDE LORDOSIS LEVELS`; click again to collapse.
3. Click the `SACRAL SLOPE` row: it highlights, `selectedLevel` becomes `'SS'`, and the viewer draws the S1 endplate solid against a dashed **horizontal** reference, labelled `SS`. Then `PELVIC TILT` — the hip-to-S1 line against a dashed **vertical**, labelled `PT`. Then `PELVIC INCIDENCE` — the S1-to-hip line against a dashed **perpendicular to the endplate**, labelled `PI`. Each draws its own construction and its own short label; none of them shows all three values at once, and no label runs off the edge of the stage. Clicking the sacrum on the image itself still selects `'S1'` and still gives the combined overview.
4. Section `02 — DISC HEIGHTS · MM` shows five rows, every value `—`, followed by the note "Not computed in this build." Hovering those rows shows a normal arrow cursor and no highlight — they are not clickable and must not look like they are.
5. Section `03 — ALIGNMENT` shows one row `SPONDY · L4–L5 · MM`, value `—`, followed by the same note.
6. Tab through the panel: each of the six sagittal rows and the disclosure takes focus with a visible ring; the disc-height and alignment rows are skipped.
7. Scroll the panel down, then drag-pan the image in the viewer: **the panel's scroll position does not jump.** If it snaps back to the top on every frame, the rebuild gate is not working.
8. Temporarily edit a fetched study's `measurements.SS` in the DevTools console so `|PI - (PT + SS)| > 1.0`, then re-trigger a render (e.g. click a row): the accent-coloured line "Parameters inconsistent — check S1 and femoral landmarks." appears under section 01.
9. With no study segmented yet (needs-run state), every value in all three sections reads `—`, never `0`.

- [ ] **Step 5: Commit**
```
git add renderer/components/measurements.js styles/screens/analysis.css
git commit -m "feat: add the Measurements tab with the lordosis disclosure and consistency warning"
```

---

### Task 9: `screens/analysis.js` — header, indeterminate run, panel assembly, CSV export

**Files:**
- Replace: `renderer/screens/analysis.js` — the file already exists as a five-line
  `Coming soon` placeholder from plan 02. It is **not** created by this task.
- Modify: `styles/screens/analysis.css` (prepend section 01 — the file is created by Task 7)
- Test: `test/analysis.test.js`

**Interfaces:**
- Consumes: `mountViewer` (Task 7), `mountMeasurements` (Task 8), `toCsv` (Task 3), `loadStudyImages` and `disposeStudyImages` from `renderer/viewer/canvas.js` (Task 6, imported directly — not through the viewer), `getState`/`setState`/`subscribe` from `renderer/store.js`, `predict` from `renderer/api.js`, `showToast` from `renderer/components/toast.js`, `el` from `renderer/dom.js` (**`clear` and `mount` are not used**).
- Produces:
  - `render(state)` → **a single `HTMLElement`**, per BD-1. Not `render(container)`; no
    `clear`/`append` on an argument; no returned cleanup function. The root is
    `el('main', {class: 'analysis-screen'}, header, body)`.
  - `formatConfidence(qc)` — a named, independently testable pure helper.
  - `setFilePayload(studyId, data)` — writes into this module's transient payload map.
    `screens/studies.js` (Task 10) calls it; see BD-7.

**Read BD-1, BD-2, BD-4, BD-6 and BD-7 before this task.** In particular:

- **BD-2.** This module subscribes to the store **once at module scope**, not inside
  `render()`, with a guard that no-ops unless the Analysis screen is both current and
  mounted. **Add nothing to `renderer/router.js`'s `SCREEN_KEYS`** — the seventeen state
  keys this screen reads include `zoom`, `panX`, `panY` and `panMode`, and adding any of
  those remounts the screen host on every pan frame and destroys the canvas mid-gesture.
  This task does not edit `renderer/router.js`.
- **BD-4.** There is no stage sequence and no stage timer. Task 7 owns all run copy
  (`QUEUED` / `RUNNING` plus one static description). This module defines none of its own,
  and leaves `state.runStage` untouched — it is in the contract's state shape, nothing in
  plan 03 reads it, and writing a label into it would create a second source of truth for
  a string Task 7 already hardcodes.
- **BD-6.** This module owns image lifetime: it imports `loadStudyImages` /
  `disposeStudyImages` directly, holds a single-entry cache across navigation, and hands
  the viewer its images through `setImages` **before** the completing `setState`.

**A known, accepted limitation of the single-entry cache.** Segment study A, go back,
segment study B, then re-open A: A still has its measurements, so no run card, but its
bitmaps were evicted when B's loaded — the stage shows outlines on black with no
radiograph behind them. That is the deliberate cost of bounding the cache to one entry;
`ImageBitmap`s are large and nothing else in the renderer caches at all. It resolves in
plan 05, which persists studies and their thumbnails. Do not "fix" it here by growing the
cache without bound, and do not fix it by re-running `/predict`. If it needs fixing before
plan 05, the right shape is an explicit LRU with a stated entry count, not an unbounded
`Map`.

- [ ] **Step 1: Write the failing test for the one pure helper in this file**

Create `test/analysis.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatConfidence } from '../renderer/screens/analysis.js';

test('formatConfidence renders rounded percent from qc.femoral.confidence', () => {
  assert.equal(formatConfidence({ femoral: { confidence: 0.873 } }), '87%');
  assert.equal(formatConfidence({ femoral: { confidence: 1 } }), '100%');
});

test('formatConfidence renders em dash when qc is absent or malformed', () => {
  assert.equal(formatConfidence(null), '\u2014');
  assert.equal(formatConfidence({}), '\u2014');
  assert.equal(formatConfidence({ femoral: {} }), '\u2014');
});

// A confidence of exactly 0 is a measured value, not a missing one, so it renders as a
// number. The em dash is reserved for "the backend did not report this", per the
// architecture contract's absent-value rule.
test('formatConfidence renders 0% for a measured zero, not an em dash', () => {
  assert.equal(formatConfidence({ femoral: { confidence: 0 } }), '0%');
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/analysis.test.js`

Expected: FAIL with
`SyntaxError: The requested module '../renderer/screens/analysis.js' does not provide an export named 'formatConfidence'`.

**Not** `Cannot find module`. `renderer/screens/analysis.js` already exists — plan 02
left a five-line `Coming soon` placeholder there — so the module resolves fine and the
failure is a missing named export. If you see `Cannot find module`, you are in the wrong
worktree.

- [ ] **Step 3: Prepend the screen styles**

Prepend to `styles/screens/analysis.css`, above the `02 — VIEWER STAGE` section Task 7
created:

```css
/* ===== 01 — SCREEN SHELL AND HEADER ==================================== */
.analysis-screen {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.analysis-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  flex-shrink: 0;
}
.analysis-meta {
  font-family: 'Chivo Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.15em;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.analysis-spacer { flex: 1; }

.confidence-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--sage) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--sage) 45%, var(--border));
}
.confidence-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sage);
}
.confidence-label {
  font-family: 'Chivo Mono', monospace;
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: var(--body);
}
.confidence-value {
  font: 600 13px 'Source Sans 3', sans-serif;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.analysis-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.analysis-viewer-host {
  flex: 1;
  min-width: 0;
  display: flex;
  position: relative;
}

.analysis-panel {
  width: 400px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.analysis-tabs {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 10px;
  flex-shrink: 0;
}
.analysis-tabgroup {
  flex: 1;
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 11px;
  background: var(--well);
}
.analysis-tab {
  flex: 1;
  padding: 6px 4px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: center;
  font: 650 13px 'Source Sans 3', sans-serif;
  color: var(--muted);
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.analysis-tab.is-active {
  background: var(--card);
  color: var(--ink);
}
.analysis-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.analysis-actions {
  display: flex;
  padding: 0 14px 10px;
  flex-shrink: 0;
}
.analysis-export {
  width: 100%;
  justify-content: center;
}

.analysis-panel-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.analysis-similar {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  color: var(--muted);
  font: 400 13px 'Source Sans 3', sans-serif;
}

/* Both panel bodies are always in the DOM; the tab toggles which one is shown. */
.analysis-panel-host.is-hidden,
.analysis-similar.is-hidden { display: none; }
```

- [ ] **Step 4: Write the implementation**

Replace the contents of `renderer/screens/analysis.js`:

```js
import { el } from '../dom.js';
import { getState, setState, subscribe } from '../store.js';
import { predict } from '../api.js';
import { showToast } from '../components/toast.js';
import { toCsv } from '../data/csv.js';
import { loadStudyImages, disposeStudyImages } from '../viewer/canvas.js';
import { mountViewer } from '../components/viewer.js';
import { mountMeasurements } from '../components/measurements.js';

const BACK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12 H5"></path><path d="M11 6 L5 12 L11 18"></path></svg>';

export function formatConfidence(qc) {
  const confidence = qc?.femoral?.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return '\u2014';
  return `${Math.round(confidence * 100)}%`;
}

// ---------------------------------------------------------------------------
// Transient per-study binary state. None of this belongs on the Study record --
// plan 05 persists state.studies to disk and validates its shape, so anything
// hung on the record ships. See BD-6 and BD-7.

// Raw file bytes, keyed by study id. screens/studies.js writes; runSegmentation reads.
// Transitional: plan 06 scans folders into studies that carry a filePath and no payload.
const filePayloads = new Map();

export function setFilePayload(studyId, data) {
  filePayloads.set(studyId, data);
}

// Exactly one study's decoded bitmaps, deliberately kept ACROSS navigation so that
// returning to an already-segmented study repaints without re-running /predict. Bounded
// to a single entry: ImageBitmaps are large. Without this, studies -> analysis ->
// studies -> analysis leaves a study that has measurements, therefore no run card, and
// no image -- a black stage with outlines floating on it.
let imageCache = null; // { studyId, images } | null

function cacheImages(studyId, images) {
  if (imageCache && imageCache.images !== images) disposeStudyImages(imageCache.images);
  imageCache = { studyId, images };
}

// The live mount, or null when this screen is not on screen.
let mounted = null;

let runRevision = 0;

function currentStudy(state) {
  return state.studies.find((s) => s.id === state.openId) ?? null;
}

function teardown() {
  if (!mounted) return;
  mounted.viewer.detach();
  mounted = null;
  // imageCache deliberately survives -- that is the whole point of it.
}

// ---------------------------------------------------------------------------
// Subscribed ONCE, here at module scope, at import time. Not inside render().
//
// WHY NOT THE ROUTER (BD-2): this screen reads zoom/panX/panY/panMode, which change at
// pointermove rate. Adding them to router.js's SCREEN_KEYS would remount the screen host
// -- and therefore both <canvas> elements -- on every frame of a pan, orphaning the 2D
// contexts and stacking one set of listeners per frame. router.js:79-85 states this
// exception explicitly; its "add it here too" comment does not apply to this module.
//
// WHY NOT INSIDE render() (P2-3): render() runs on every navigation, so a subscription
// created there leaks one permanently-live listener per studies->analysis round trip,
// each rebuilding a detached tree on every later notification.
//
// ORDERING: this module's body evaluates before renderer/main.js's, because main.js
// imports router.js which imports this module, and store.js notifies listeners in
// insertion order. So on setState({screen: 'studies'}) the teardown below runs first and
// the router swaps the node second, which is the order that makes detach() correct.
subscribe((state) => {
  if (state.screen !== 'analysis') {
    teardown();
    return;
  }
  if (!mounted) return; // render() has not run for this navigation yet
  mounted.update();
});

async function runSegmentation(studyId) {
  const revision = ++runRevision;
  const study = getState().studies.find((s) => s.id === studyId);
  const data = study ? filePayloads.get(studyId) : undefined;
  if (!study || !data) {
    // A clinician must never be shown a raw "Cannot read properties of undefined".
    showToast('That study\u2019s file is no longer available. Choose the radiograph again.');
    return;
  }

  setState({ running: true });
  try {
    const response = await predict({
      name: study.fileName,
      data,
      modality: 'xray',
      bodyPart: 'lumbar',
      view: 'lateral',
    });
    if (revision !== runRevision) return;

    const images = await loadStudyImages(response);
    if (revision !== runRevision) {
      disposeStudyImages(images);
      return;
    }

    // ORDER MATTERS (BD-6). setState notifies synchronously, so the module-scope
    // subscription's update() runs INSIDE the setState call below and asks the viewer to
    // repaint. The images have to be in place first, or that first paint sizes nothing
    // and draws nothing: every measurement populates while the stage stays black until
    // an unrelated click happens to fire the next update.
    // Cache unconditionally -- these are studyId's real results and belong in the cache
    // whatever the user is currently looking at.
    cacheImages(studyId, images);
    // Hand them to a LIVE viewer only if that viewer is showing this study. `mounted` is a
    // single global that render() reassigns on every navigation, and the revision guards
    // above only detect a second runSegmentation call -- nothing bumps runRevision when the
    // user simply navigates away mid-run. Without this check: open A, run, press back, open
    // B, and when A's slow three-model request lands it hands A's bitmaps to B's viewer.
    // The next repaint then draws A's radiograph under B's header, chip id and geometry,
    // and the run card is a blur scrim rather than an opaque one, so A's film stays visible
    // behind it. A clinical image under the wrong study's identity is exactly what the
    // contract's "never label a value with a name it isn't" rule exists to prevent.
    // This is the same guard the re-hand path already applies in render() below.
    if (mounted && mounted.studyId === studyId) mounted.viewer.setImages(images);

    setState((state) => ({
      running: false,
      studies: state.studies.map((s) => (s.id === studyId
        ? { ...s, measurements: response.measurements, geometry: response.geometry, qc: response.qc ?? null }
        : s)),
    }));
  } catch (error) {
    if (revision === runRevision) {
      setState({ running: false });
      showToast(`Could not segment: ${error.message}`);
    }
  }
}

export function render(state) {
  // A re-render (the router calls this whenever SCREEN_KEYS change) must not leave the
  // previous mount's listeners live.
  teardown();

  const study = currentStudy(state);
  if (!study) {
    // Not reachable from plan 03's UI -- screens/studies.js always sets openId and
    // screen together, and the sidebar has no Analysis nav item -- but rendering a
    // header-and-empty-viewer shell over a study that isn't there is worse than one
    // extra branch.
    return el('main', { class: 'placeholder-screen' }, el('p', {}, 'No study is open.'));
  }

  const backButton = el('button', {
    type: 'button',
    class: 'icon-btn',
    title: 'Back to studies',
    'aria-label': 'Back to studies',
    innerHTML: BACK_SVG,
    onClick: () => setState({ screen: 'studies' }),
  });

  const headerMeta = el('div', { class: 'analysis-meta' });
  const confidenceValue = el('div', { class: 'confidence-value' });

  // Labelled FEMORAL FIT CONFIDENCE, not the mockup's SEGMENTATION CONFIDENCE, because
  // the number behind it is qc.femoral.confidence -- a femoral circle-fit score, not a
  // whole-segmentation score. The architecture contract's "never label a value with a
  // name it isn't" rule names this badge specifically. Do not rename it to match the
  // mockup. It stays visible with an em dash before a run, per the absent-value rule.
  const confidenceBadge = el('div', { class: 'confidence-badge' },
    el('div', { class: 'confidence-dot' }),
    el('div', { class: 'confidence-label' }, 'FEMORAL FIT CONFIDENCE'),
    confidenceValue);

  const header = el('header', { class: 'analysis-header' },
    backButton,
    headerMeta,
    el('div', { class: 'analysis-spacer' }),
    confidenceBadge);

  const tabMeas = el('button', {
    type: 'button', class: 'analysis-tab', onClick: () => setState({ tab: 'meas' }),
  }, 'Measurements');
  const tabSim = el('button', {
    type: 'button', class: 'analysis-tab', onClick: () => setState({ tab: 'sim' }),
  }, 'Find similar');

  const exportButton = el('button', {
    type: 'button', class: 'btn btn-small analysis-export', onClick: () => exportCsv(),
  }, 'Export CSV');

  const measurementsHost = el('div', { class: 'analysis-panel-host' });
  const similarHost = el('div', { class: 'analysis-similar is-hidden' },
    'Find similar arrives in a later build.');

  const panel = el('aside', { class: 'analysis-panel' },
    el('div', { class: 'analysis-tabs' },
      el('div', { class: 'analysis-tabgroup' }, tabMeas, tabSim)),
    el('div', { class: 'analysis-actions' }, exportButton),
    measurementsHost,
    similarHost);

  const viewerHost = el('div', { class: 'analysis-viewer-host' });
  const body = el('div', { class: 'analysis-body' }, viewerHost, panel);
  const root = el('main', { class: 'analysis-screen' }, header, body);

  const viewer = mountViewer(viewerHost);
  const measurementsPanel = mountMeasurements(measurementsHost);

  viewer.setRunHandler(() => {
    const live = getState();
    if (live.running) return;
    runSegmentation(live.openId);
  });

  // Re-hand the cached bitmaps to the fresh viewer, so navigating back into an
  // already-segmented study shows its radiograph instead of a black stage. The
  // studyId comparison is load-bearing, not defensive: the cache holds exactly one
  // study's bitmaps and it is frequently not this one. runSegmentation applies the
  // same check before handing images to a live viewer.
  if (imageCache && imageCache.studyId === study.id) viewer.setImages(imageCache.images);

  async function exportCsv() {
    const live = getState();
    // No includeDemo. It is a no-op today (openId is always a real study), but plan 05
    // makes the nine demo studies openable, at which point `includeDemo: true` would
    // silently write fabricated measurements into a research CSV.
    const csv = toCsv(live.studies.filter((s) => s.id === live.openId), live.fields, {});
    const open = currentStudy(live);
    try {
      const savedTo = await saveCsv({ text: csv, suggestedName: `${open ? open.id : 'export'}.csv` });
      // Cancelling the dialog is not an error and must not toast. saveCsv resolves null.
      if (savedTo) showToast(`Exported to ${savedTo}`);
    } catch (error) {
      showToast(`Could not export: ${error.message}`);
    }
  }

  function update() {
    const live = getState();
    const open = currentStudy(live);
    if (!open) return;

    // `open.pt` is the demo-set PATIENT label, not the PT pelvic-tilt measurement
    // (that is open.measurements.PT). Do not "fix" this to a number.
    headerMeta.textContent = `${open.id} \u00B7 ${(open.view ?? '').toUpperCase()} \u00B7 ${open.pt ?? '\u2014'}`;
    confidenceValue.textContent = formatConfidence(open.qc);

    tabMeas.classList.toggle('is-active', live.tab === 'meas');
    tabSim.classList.toggle('is-active', live.tab === 'sim');
    measurementsHost.classList.toggle('is-hidden', live.tab !== 'meas');
    similarHost.classList.toggle('is-hidden', live.tab !== 'sim');

    viewer.updateViewer(open);
    measurementsPanel.updateMeasurements(open);
  }

  // studyId tags the mount so an in-flight run that completes after the user has navigated
  // to a different study cannot hand its bitmaps to this viewer. See runSegmentation.
  mounted = { viewer, update, studyId: study.id };
  update();
  return root;
}
```

- [ ] **Step 5: Run test to verify it passes**
Run: `node --test test/analysis.test.js`
Expected: PASS — 3 tests, 0 failures

- [ ] **Step 6: Commit**
```
git add renderer/screens/analysis.js test/analysis.test.js styles/screens/analysis.css
git commit -m "feat: assemble the Study Analysis screen with indeterminate segmentation and CSV export"
```

**MANUAL VERIFICATION.** Task 10 is not written yet, so there is no way to pick a
radiograph from the UI at this point. Do this checklist **after Task 10 is committed**,
and perform Task 7 Step 4 and Task 8 Step 4 in the same sitting, against this fully
assembled screen. Then:

1. Click `Run segmentation` on a freshly-picked study. The card's eyebrow reads exactly
   `QUEUED` beforehand and exactly `RUNNING` for the whole duration of the request, with
   one spinning indeterminate ring and the static line naming the three models. **It must
   not advance through named stages.** `/predict` has no progress channel, so any stage
   sequence is invented status — see BD-4. When the response arrives the card
   disappears and the radiograph, overlay and outlines all render **immediately**, in the
   same paint as the measurement values. If the numbers appear while the stage stays
   black, `setImages` is being called after the completing `setState` instead of before
   (BD-6).
2. The header reads `{id} · STANDING LATERAL · —` (no patient name yet), and
   the `FEMORAL FIT CONFIDENCE` badge shows a rounded percentage matching
   `qc.femoral.confidence × 100` from the response. Before the run, the same badge is
   visible and reads `—`.
3. Click `Export CSV`: the DevTools console prints a citation-commented CSV block
   containing the current study's `SS`/`PI`/`PT`/`LL`/`L1PA` values, and a toast appears
   **and dismisses itself after about two seconds**. A toast that stays on screen means
   `setState({toast})` was used instead of `showToast()` — the auto-dismiss timer lives
   in `components/toast.js`, not in the store.
4. Click the `Find similar` tab: the panel switches to the placeholder text "Find similar
   arrives in a later build." with no console error, and the tab pill moves. Click back to
   `Measurements`: the rows return.
5. **Navigation round trip.** Click the back chevron to Studies, then re-open the same
   study. The radiograph, overlay and outlines are all still there — the image cache is
   what makes that work. Then, in the DevTools console, confirm the subscriber count did
   not grow: repeat the round trip three times and check that a single `setState({tab:
   'sim'})` still produces exactly one panel rebuild (add a temporary `console.count` in
   `update()` if needed). Two or more means a subscription is leaking, i.e. `subscribe`
   ended up inside `render()`.

---

### Task 10: `screens/studies.js` — extend the Studies screen to reach Analysis

**Files:**
- Modify: `renderer/screens/studies.js` — **the file already exists and is not replaced.** See BD-5.
- Modify: `main.js` (one line: the `select-file` handler's return value)

**Interfaces:**
- Consumes: `selectFile` from `renderer/api.js`; `getState`/`setState` from `renderer/store.js`; `el` from `renderer/dom.js`; `showToast` from `renderer/components/toast.js`; `setFilePayload` from `renderer/screens/analysis.js` (Task 9).
- Produces: no new exports. `render(state)` → `HTMLElement` is unchanged from what plan 02 built — that is already the router's convention (BD-1).

**Read BD-5 and BD-7 before this task.**

An earlier draft of this task said *"Create `renderer/screens/studies.js`"* and opened with
`// MINIMAL STUB`. That was written before plan 02 built the file. The file that exists
today is *more* complete than the stub: `.studies-page` / `.studies-page-inner` /
`.studies-header` / `.dropzone` markup, an inline upload SVG, a `btn btn-primary btn-small`
button labelled `Choose radiograph` (**no ellipsis**), the de-identification copy, and a
`showToast` try/catch around `selectFile()`. `styles/screens/studies.css` styles every one
of those classes and `index.html:16` links it. Overwriting the file deletes the dropzone,
orphans a linked stylesheet, and regresses the button label.

So: keep the file, keep `render(state)`, keep the markup. Add the id helper, the payload
hand-off, and the study-creation/navigation flow to the existing `handleChoose`. The
full-featured Studies table, search and status column still arrive in plan 05 — this
task only makes the Analysis screen reachable.

- [ ] **Step 1: Return the file path from the main process**

`renderer/api.js`'s contract is `selectFile() → {name, data, path} | null`, but
`main.js`'s handler returns only `{name, data}` and throws the path away. A real study's
`filePath` must be the real path — `null` is the contract's marker for a *demo* study,
and plan 05 persists whatever this writes.

In `main.js`, in the `ipcMain.handle('select-file', ...)` handler, add `path` to the
returned object:

```js
  return {
    name: path.basename(filePath),
    data: await fsPromises.readFile(filePath),
    path: filePath,
  };
```

(`path` here is the `node:path` module in the key position and the local `filePath`
variable in the value position — that shadowing reads oddly but is correct; the module
is only used for `basename` on the line above.)

- [ ] **Step 2: Confirm the main process still starts**
Run: `node --check main.js`
Expected: no output.

- [ ] **Step 3: Extend `renderer/screens/studies.js`**

Change only the imports and `handleChoose`; leave `UPLOAD_SVG`, `dropzone()` and
`render()` exactly as they are.

Replace the import block:

```js
import { el } from '../dom.js';
import { getState, setState } from '../store.js';
import { selectFile } from '../api.js';
import { showToast } from '../components/toast.js';
import { setFilePayload } from './analysis.js';
```

Add above `handleChoose`:

```js
// Local stand-in for data/persistence.js's nextId(), which arrives in plan 05. Scans
// real studies only and starts at SP-1000, exactly as the architecture contract
// specifies. Deliberately NOT a separate `SP-DRAFT-n` namespace: plan 05 persists these
// records, and nextId() parsing 'SP-DRAFT-1' yields NaN. Derived from state rather than
// from a module-scope counter so it cannot collide with studies that are already loaded.
function nextLocalId(studies) {
  let highest = 999;
  for (const study of studies) {
    if (study.source !== 'real') continue;
    const match = /^SP-(\d+)$/.exec(study.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `SP-${highest + 1}`;
}
```

Replace `handleChoose` with:

```js
async function handleChoose() {
  try {
    const chosen = await selectFile();
    if (!chosen) return;

    const id = nextLocalId(getState().studies);

    // The raw bytes are held OFF the Study record, in screens/analysis.js's payload map.
    // Plan 05 persists state.studies to disk and validates its shape, so a `_fileData`
    // field would either write megabytes of binary into the store or fail validate().
    // See BD-7.
    setFilePayload(id, chosen.data);

    setState((state) => ({
      studies: [...state.studies, {
        id,
        source: 'real',
        filePath: chosen.path,
        fileName: chosen.name,
        addedAt: new Date().toISOString(),
        view: 'Standing lateral',
        thumbnail: null,
        measurements: null,
        geometry: null,
        qc: null,
        clinical: {},
      }],
      openId: id,
      screen: 'analysis',
      // Reset the per-study view state so a new film does not inherit the last one's
      // zoom, pan or selection.
      selectedLevel: null,
      zoom: 1,
      panX: 0,
      panY: 0,
      panMode: false,
    }));
  } catch (error) {
    showToast(`Could not open file: ${error.message}`);
  }
}
```

Note the `setState` patch passes a **new** `studies` array. `renderer/router.js:44-52`
warns that its key sets compare with `!==`, so mutating the existing array and re-setting
the same reference would silently skip the sidebar remount.

- [ ] **Step 4: Confirm the module loads and the screen contract is intact**
Run: `node --check renderer/screens/studies.js`
Expected: no output.

Then confirm, by reading `renderer/router.js`, that `SCREENS` already maps both
`studies` and `analysis` (it does — `router.js:10-14`), and that `SCREEN_KEYS` is still
exactly `['screen', 'ack']`. **Do not edit `renderer/router.js`.** An earlier draft of
this task told you to add the mappings "following the same pattern plan 02 used for
`landing`"; both mappings already exist, and adding state keys to `SCREEN_KEYS` is the
failure BD-2 exists to prevent.

Run: `grep -n "SCREEN_KEYS = " renderer/router.js`
Expected: `export const SCREEN_KEYS = ['screen', 'ack'];`

- [ ] **Step 5: MANUAL VERIFICATION**
1. Launch the app, get past the Landing acknowledgement gate (plan 02), and land on the
   Studies screen. **The dropzone is still there** — upload icon, "Drop a DICOM series
   or lateral radiograph", the de-identification subtitle, and a `Choose radiograph`
   button with **no** ellipsis. If any of that is missing, the file was overwritten
   instead of extended; see BD-5.
2. Click `Choose radiograph`, pick a real lateral radiograph (or DICOM) from disk.
3. The app navigates straight to the Analysis screen, showing the needs-run overlay for a
   study with no measurements yet (`—` everywhere in the Measurements panel).
4. In the DevTools console, confirm the record is contract-shaped:
   `getState().studies.at(-1)` has `id` matching `/^SP-1\d{3}$/`, `source: 'real'`, a
   `filePath` that is the real absolute path you just picked, and **no `_fileData` key**.
5. Cancel the picker instead of choosing a file: nothing happens, no toast, no navigation.
6. Click the back chevron in the Analysis header: the app returns to Studies. The study
   just added is not listed (the table is plan 05) but remains in `getState().studies` —
   confirm via the console.
7. Now perform Task 7 Step 4, Task 8 Step 4 and Task 9's verification checklist, all of
   which have been waiting on this task.

- [ ] **Step 6: Commit**
```
git add renderer/screens/studies.js main.js
git commit -m "feat: create a study from the file picker and open it in Analysis"
```

---

### Task 11: Delete `renderer.js` and finish the migration

**Files:**
- Delete: `renderer.js`
- Modify: `package.json` (the `build.files` array)
- Modify: `electron-builder.preview.yml` (its own `files:` allowlist)
- Test: full suite

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task retires the file every earlier plan-02/03 task has been superseding.

- [ ] **Step 1: Confirm nothing still references the old file**
Run: `grep -rn "renderer.js" index.html main.js preload.js package.json electron-builder.preview.yml`

Expected: **exactly two** hits, both packaging allowlist entries — `package.json:27` and
`electron-builder.preview.yml:18`. Both were verified present. Note that
`electron-builder.preview.yml` must be in the grep list: it is the file Step 3b exists to
fix, and an earlier draft of this step omitted it, so the check could not see the very
drift it was meant to catch.

`index.html:20` is already `<script type="module" src="renderer/main.js"></script>`, so it
should produce no hit. If it still has a `<script src="renderer.js">` tag, STOP — plan
02 was supposed to have switched it; deleting `renderer.js` first would break the app.

- [ ] **Step 2: Remove the file**
```
git rm renderer.js
```

- [ ] **Step 3: Update `package.json`'s `build.files` array**

Read the current `files` array inside `package.json`'s `build` block. Remove the `"renderer.js",` line. Plan 02 already added `"renderer/**/*"` and `"styles/**/*"`, so this is a deletion only — do not duplicate entries. Afterwards the array reads:

```json
    "files": [
      "assets/**/*",
      "index.html",
      "main.js",
      "preload.js",
      "renderer/**/*",
      "styles/**/*",
      "package.json"
    ],
```

- [ ] **Step 3b: Apply the identical removal to the preview build config**

⚠️ `electron-builder.preview.yml` (plan 01) carries its **own** `files` allowlist. It
still lists `renderer.js`, which no longer exists. electron-builder does not fail on a
missing glob entry, so this drifts silently.

In `electron-builder.preview.yml`, remove the `  - renderer.js` line so the block reads:

```yaml
files:
  - assets/**/*
  - index.html
  - main.js
  - preload.js
  - renderer/**/*
  - styles/**/*
  - package.json
```

- [ ] **Step 3c: Assert the two allowlists still agree**

`.github/workflows/windows-preview.yml:137-162` already runs this assertion in CI (plan 02
landed it). Run the same check locally before committing, so a divergence is caught here
rather than on a runner.

**Run this through the Bash tool, not PowerShell.** This environment's primary shell is
PowerShell, where the heredoc below is a parse error. An earlier draft of this step was
fenced as `bash` but used `\$` escapes that only resolve inside a double-quoted bash
string, and it hardcoded an absolute worktree path.

```bash
node - <<'NODE'
const fs = require('fs');
const prod = JSON.parse(fs.readFileSync('package.json', 'utf8')).build.files;
const yml = fs.readFileSync('electron-builder.preview.yml', 'utf8');
const block = yml.match(/^files:\n((?:[ \t]+- .*\n)+)/m);
if (!block) { console.error('FAIL: no files: block in electron-builder.preview.yml'); process.exit(1); }
const prev = block[1].trimEnd().split('\n')
  .map(s => s.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, ''));
console.log('package.json build.files       :', JSON.stringify(prod));
console.log('electron-builder.preview files :', JSON.stringify(prev));
if (prod.includes('renderer.js') || prev.includes('renderer.js')) {
  console.error('FAIL: an allowlist still ships the deleted renderer.js');
  process.exit(1);
}
if (JSON.stringify([...prod].sort()) !== JSON.stringify([...prev].sort())) {
  console.error('FAIL: the two packaging allowlists have diverged.');
  console.error('A missing entry does not fail the build - it ships an installer that opens a blank window.');
  process.exit(1);
}
console.log('OK: allowlists match');
NODE
```

Expected: both lists print identically, followed by `OK: allowlists match`. The
`renderer.js` check is what catches the both-stale case, where the two lists agree with
each other and are both wrong.

- [ ] **Step 4: Run the full pure-logic test suite**
Run: `node --test test/*.test.js`

Expected: PASS, 0 failures, across **eight** files — the six this plan adds
(`geometry.test.js` 10, `measurements.test.js` 12, `csv.test.js` 6,
`interactions.test.js` 4, `canvas.test.js` 3, `analysis.test.js` 3) **plus** the two plan
02 left behind, which the same glob also matches (`api.test.js` and `store.test.js`, 19
tests between them). That is **57 tests**.

(`csv.test.js` is 6, not the 5 Task 3's own text specifies: Task 3's review found that
`measurementValue` threw on a `measurements` object with no `LL` key and wrote the literal
string `NaN` into the `PI-LL Mismatch` cell when `PI` was absent. One test was added with
the guard that fixed it. See the ledger's Task 3 ruling.)

Check the count, not just the exit code: `node --test` exits 0 while reporting `tests 0`
when the glob matches nothing, so a green run proves nothing on its own. Note also that
`node --test test/` (bare directory) **fails** on Node 24 with `Cannot find module` —
it is treated as a CommonJS entry point. Do not "fix" the glob back to the directory form.

- [ ] **Step 5: MANUAL VERIFICATION and commit**

Run `npm run dev` (see the handoff note about `SPINE_CONTOUR_PYTHON`; and remember that a
live process is **not** evidence of a successful launch — a fatal startup error shows a
modal dialog and the process stays up. Check for a real window, or drive it over
`--remote-debugging-port=9222`).

Confirm the app boots to Landing, then walk the whole path with DevTools open and **no
console errors at any point**: Landing → acknowledge → Studies → choose a
radiograph → Analysis → Run segmentation → measurements populate and the image
renders in the same paint → select a row → zoom, pan, toggle overlay → Export CSV
→ back to Studies → re-open the study and confirm the image is still there.

Then commit. **Stage the deletion explicitly** — `git rm renderer.js` in Step 2 already
staged it, but a fresh shell after a `git reset` silently drops it, and the commit below
would then ship a repo that still contains the file it claims to have deleted:

```
git add package.json electron-builder.preview.yml renderer.js
git status --short
git commit -m "chore: delete renderer.js now every behaviour has moved to renderer/"
```

`git status --short` must show `D  renderer.js` before you commit.

At this point the application has reached feature parity with today's app except landmark
and femoral-head editing (plan 04): choosing a radiograph, running segmentation with a
single honest indeterminate indicator, viewing the segmentation overlay at adjustable
opacity, zooming and panning and fitting, seeing all six sagittal parameters plus the
L2–S1 through L5–S1 lordosis disclosure, and exporting CSV.
