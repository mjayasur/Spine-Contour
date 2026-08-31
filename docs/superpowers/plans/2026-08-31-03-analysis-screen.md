# Analysis Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `renderer.js`'s single-canvas measure flow with the redesigned Study Analysis screen — layered viewer rendering, the six-row sagittal panel with a lordosis disclosure, staged-progress segmentation, and CSV export — reaching feature parity with today's app except landmark editing.

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

- **Reaching the Analysis screen without Studies (plan 05) or Workspace (plan 06).** This plan creates a deliberately minimal `renderer/screens/studies.js` (Task 10) — a heading and a single "Choose radiograph…" button that opens the native file picker and creates an in-memory (non-persisted) `Study` record. It carries a comment marking it as a stub that plan 05 replaces wholesale with the real table, search, and dropzone. This is the only way to satisfy "choose a radiograph, run segmentation, see the overlay… and export CSV" (the plan's own exit criteria) without building the Studies table early.
- **Overlay opacity math.** The segmentation-overlay pixel data is baked once per prediction at a fixed base alpha of `116` (double `renderer.js`'s hardcoded `58`). At draw time the static layer multiplies that by `overlayOpacity / 100` via `ctx.globalAlpha`. At the default `overlayOpacity` of `50`, the effective alpha is `116 × 0.5 = 58` — visually identical to today's app — while the `FILL` slider's full `0..100` range gives roughly double today's maximum opacity at the high end.
- **"Measurement lines for selected parameters" (spec §9.5).** The old checkbox strip (nine independently toggleable measurement overlays) is gone; the redesign has one `selectedLevel` in the store instead. Clicking a vertebra on the canvas, or a row in the Measurements panel, sets `selectedLevel`. The dynamic layer then draws exactly one construction: for `L1`..`L5` it draws that level's `LL` line (endplate vs. S1, labelled `LL {level}-S1 {value}°`); for `S1` it draws the S1-midpoint-to-hip line labelled with `PI`, `PT`, and `SS` together, since all three share that same construction. This is a smaller surface than the old nine-checkbox display but is the direct, intentional consequence of the redesign's single-selection model — not an oversight.
- **Row-to-vertebra mapping for panel/canvas highlight sync**, used by `sagittalRows`'s `opts.selectedLevel` and by the panel's row click handlers:

  | Row key | Associated level(s) |
  |---|---|
  | `LL` | `L1` |
  | `PI` | `S1` |
  | `PT` | `S1` |
  | `SS` | `S1` |
  | `PILL` | `L1`, `S1` |
  | `L1PA` | `L1` |

- **CSV citation block.** The spec requires "a leading comment block carries the citation text and a NOT FOR CLINICAL USE line" but doesn't give the literal string. This plan uses:
  ```
  # Spine Contour export
  # Citation required for published use: Cody Woodhouse, MD; Michael Jayasuria, BS.
  # Investigational software. NOT FOR CLINICAL USE.
  ```
  (names and spelling exactly as spec §9.1 gives them).
- **Run-segmentation progress is indeterminate, by decision.** `/predict` is a single request/response with no progress channel, and spec §11 rules out adding one, so the renderer cannot know which model is executing. An earlier draft of this plan advanced five named stage labels on a 1400 ms timer; that was **rejected** because it would display "Locating S1" while the backend may still be segmenting vertebrae — a fabricated status in an app whose organising principle is that nothing shown is invented, and one that would be wrong by varying amounts since the first run pays model-loading cost that cached later runs skip. The card shows one animated indeterminate indicator reading `Segmenting and measuring…` above static text naming what the pipeline does. Do not reintroduce a stage timer without first adding a real backend progress channel and amending spec §11.

---

### Task 1: `viewer/geometry.js` — circle fit and coordinate transforms

**Files:**
- Create: `renderer/viewer/geometry.js`
- Test: `test/geometry.test.js`

**Interfaces:**
- Produces: `fitCircle(points)`, `imageToClient(pt, rect, canvas)`, `clientToImage(ev, canvas)`, `nearestLandmark(geometry, clientX, clientY, canvas, radius=14)`, `landmarkAt(geometry, level, corner)`, `setLandmarkAt(geometry, level, corner, point)`, `LEVELS`, `CORNERS` — exactly the signatures in the architecture contract's `renderer/viewer/geometry.js` section.

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
Expected: PASS — 9 tests, 0 failures

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
const RESIDUAL_LIMIT = 1.0;

const SAGITTAL_DEFS = [
  { key: 'LL', label: 'LUMBAR LORDOSIS \u00B7 L1\u2013S1', levels: ['L1'] },
  { key: 'PI', label: 'PELVIC INCIDENCE', levels: ['S1'] },
  { key: 'PT', label: 'PELVIC TILT', levels: ['S1'] },
  { key: 'SS', label: 'SACRAL SLOPE', levels: ['S1'] },
  { key: 'PILL', label: 'PI\u2013LL MISMATCH', levels: ['L1', 'S1'] },
  { key: 'L1PA', label: 'L1 PELVIC ANGLE', levels: ['L1'] },
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
- Produces: `ZOOM_MIN` (0.6), `ZOOM_MAX` (2.4), `clampZoom(zoom)`, `zoomIn(zoom)`, `zoomOut(zoom)`, `vertebraAt(geometry, point, radius=20)`, `attachViewerInteractions(stage, canvas, options)`. `TAB_ORDER`, `nextSelection`, and `nudge` (the landmark-editing exports in the architecture contract's interactions.js section) are **not** added by this plan — they belong to plan 04, which extends this same file.

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
- Produces: `bitmapFromBase64(base64)`, `loadStudyImages(predictResponse)`, `disposeStudyImages(images)`, `createLayeredCanvases(host)`, `sizeCanvases(canvases, width, height)`, `drawStaticLayer(ctx, canvas, images, opts)`, `drawDynamicLayer(ctx, canvas, geometry, opts)`. These are consumed by `renderer/components/viewer.js` in Task 7.

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

const STAGE_LINE_COLOR = '#38342F';
const STAGE_SELECTED_COLOR = '#D45A32';
const STAGE_LABEL_FILL = 'rgba(250,247,242,.75)';

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function drawStageLabel(ctx, text, point, selected, canvasWidth) {
  if (!selected) return;
  const fontSize = Math.max(11, canvasWidth / 70);
  ctx.font = `700 ${fontSize}px 'Chivo Mono', monospace`;
  ctx.fillStyle = STAGE_LABEL_FILL;
  ctx.fillText(text, point[0] + 10, point[1] - 10);
}

function drawMeasurementLabel(ctx, canvas, text, point) {
  const fontSize = Math.max(12, canvas.width / 60);
  ctx.font = `600 ${fontSize}px 'Source Sans 3', sans-serif`;
  const width = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(11,10,9,.78)';
  ctx.fillRect(point[0] - 4, point[1] - fontSize, width, fontSize + 7);
  ctx.fillStyle = STAGE_SELECTED_COLOR;
  ctx.fillText(text, point[0] + 2, point[1] + 2);
}

function drawSelectedMeasurement(ctx, canvas, geometry, selectedLevel, measurements) {
  if (!selectedLevel || !measurements) return;
  ctx.save();
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
    drawMeasurementLabel(
      ctx, canvas,
      `PI ${measurements.PI.toFixed(1)}\u00B0  PT ${measurements.PT.toFixed(1)}\u00B0  SS ${measurements.SS.toFixed(1)}\u00B0`,
      midpoint(s1Mid, hip),
    );
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
    const value = measurements.LL[key];
    if (value != null) {
      drawMeasurementLabel(ctx, canvas, `LL ${key} ${value.toFixed(1)}\u00B0`, midpoint(body.superior[0], body.superior[1]));
    }
  }
  ctx.restore();
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
    drawStageLabel(ctx, level, body.quadrilateral[0], selected, canvas.width);
  }
  const selectedS1 = selectedLevel === 'S1';
  ctx.strokeStyle = selectedS1 ? STAGE_SELECTED_COLOR : STAGE_LINE_COLOR;
  ctx.lineWidth = selectedS1 ? lineWidth * 1.6 : lineWidth;
  ctx.beginPath();
  ctx.moveTo(...geometry.s1_superior[0]);
  ctx.lineTo(...geometry.s1_superior[1]);
  ctx.stroke();
  drawStageLabel(ctx, 'S1', geometry.s1_superior[0], selectedS1, canvas.width);

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
Deferred to Task 7, Step 4 — this module has no host DOM to render into until the viewer component exists. Task 7's manual verification exercises `loadStudyImages`, `drawStaticLayer`, and `drawDynamicLayer` directly.

- [ ] **Step 5: Commit**
```
git add renderer/viewer/canvas.js
git commit -m "feat: add image loading and layered drawing to viewer/canvas.js"
```

---

### Task 7: `components/viewer.js` — stage, toolbar, and layered canvas host

**Files:**
- Create: `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `el`, `clear`, `mount` from `renderer/dom.js` (plan 02); `getState`, `setState` from `renderer/store.js` (plan 02); everything from `renderer/viewer/canvas.js` (Tasks 5-6) and `renderer/viewer/interactions.js` (Task 4).
- Produces: `mountViewer(container)` — builds the stage DOM once and wires interactions once; returns `{ updateViewer(study, images) }`. `updateViewer` is cheap to call on every store notification: it only calls `drawStaticLayer` when `overlays`/`overlayOpacity`/`images` changed since the last call, only calls `drawDynamicLayer` when `geometry`/`selectedLevel` changed, and never redraws anything for pan/zoom — those are applied as a CSS `transform` on the canvas host, per this plan's layered-rendering note above (resolves spec §16's performance risk: dragging to pan costs zero canvas redraws).

The off-theme colours below (`#0B0A09`, `rgba(250,247,242,.75)`, `#D45A32`, `#38342F`) are hardcoded inline styles, never CSS custom properties, per the architecture contract's colour-tokens section.

This is DOM/canvas code with no available test runner. It gets a MANUAL VERIFICATION step.

- [ ] **Step 1: Write the implementation**

Create `renderer/components/viewer.js`:

```js
import { el, clear } from '../dom.js';
import { getState, setState } from '../store.js';
import {
  loadStudyImages, disposeStudyImages, createLayeredCanvases, sizeCanvases,
  drawStaticLayer, drawDynamicLayer,
} from '../viewer/canvas.js';
import { attachViewerInteractions, zoomIn, zoomOut } from '../viewer/interactions.js';

function toolbarButton(label, onClick, extraStyle = '') {
  return el('div', {
    title: label,
    onClick,
    style: `width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9A9188;cursor:pointer;${extraStyle}`,
  }, label);
}

function footerText(study) {
  const patient = study.pt ?? '\u2014';
  const sex = study.sex ?? '\u2014';
  const age = study.age ?? '\u2014';
  return `${study.id} \u00B7 ${patient} \u00B7 ${sex} \u00B7 ${age} \u2014 NOT FOR CLINICAL USE`;
}

export function mountViewer(container) {
  clear(container);

  const stage = el('div', {
    style: 'flex:1;min-width:0;position:relative;overflow:hidden;background:#0B0A09;',
  });

  const host = el('div', { style: 'position:absolute;inset:0;transform-origin:center;' });
  const { staticCanvas, dynamicCanvas, staticCtx, dynamicCtx } = createLayeredCanvases(host);

  const chip = el('div', {
    style: 'position:absolute;top:14px;left:14px;display:flex;align-items:center;gap:9px;padding:6px 8px 6px 12px;border-radius:12px;background:rgba(20,18,16,.85);border:1px solid #38342F;',
  });

  const zoomLabel = el('div', { style: 'width:36px;text-align:center;font-family:"Chivo Mono",monospace;font-size:9px;font-weight:500;color:#9A9188;' }, '100%');
  const panButton = toolbarButton('\u2295', () => setState((s) => ({ panMode: !s.panMode })));
  const overlayButton = toolbarButton('\u25A3', () => setState((s) => ({ overlays: !s.overlays })));
  const fillSlider = el('input', {
    type: 'range', min: '0', max: '100', value: String(getState().overlayOpacity),
    onInput: (e) => setState({ overlayOpacity: Number(e.target.value) }),
    style: 'width:72px;height:12px;cursor:pointer;',
  });

  const toolbar = el(
    'div',
    { style: 'position:absolute;top:14px;right:14px;display:flex;align-items:center;gap:3px;padding:6px;border-radius:12px;background:rgba(20,18,16,.85);border:1px solid #38342F;' },
    toolbarButton('\u2212', () => setState((s) => ({ zoom: zoomOut(s.zoom) }))),
    zoomLabel,
    toolbarButton('+', () => setState((s) => ({ zoom: zoomIn(s.zoom) }))),
    toolbarButton('\u2922', () => setState({ zoom: 1, panX: 0, panY: 0 })),
    panButton,
    overlayButton,
    el('div', { style: 'display:flex;align-items:center;gap:7px;padding:0 8px 0 5px;' },
      el('div', { style: 'font-family:"Chivo Mono",monospace;font-size:8px;font-weight:500;letter-spacing:0.14em;color:#9A9188;' }, 'FILL'),
      fillSlider),
  );

  const footer = el('div', {
    style: 'position:absolute;left:16px;bottom:14px;max-width:calc(100% - 32px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:"Chivo Mono",monospace;font-size:8.5px;font-weight:500;letter-spacing:0.14em;color:rgba(250,247,242,.3);',
  });

  const runCard = el('div', {
    style: 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(11,10,9,.72);',
  });
  const runEyebrow = el('div', { style: 'font-family:"Chivo Mono",monospace;font-size:9px;font-weight:500;letter-spacing:0.16em;color:#9A9188;' });
  const runTitle = el('div', { style: 'margin-top:10px;font:650 18px "Source Sans 3",sans-serif;color:#FAF7F2;' });
  const runBody = el('div', { style: 'margin-top:8px;font:400 13.5px/1.5 "Source Sans 3",sans-serif;color:#C9C2B8;' });
  // Indeterminate ring. It conveys "working" and nothing more — there is no
  // progress channel from /predict, so there is no percentage to report.
  const runSpinner = el('div', {
    style: 'display:none;margin:16px auto 0;width:22px;height:22px;border-radius:50%;'
      + 'border:2px solid #38342F;border-top-color:#D45A32;animation:spin .8s linear infinite;',
  });
  const runButton = el('button', {
    style: 'margin-top:18px;width:100%;padding:10px;border:none;border-radius:10px;background:#D45A32;color:#FFFFFF;font:650 14px "Source Sans 3",sans-serif;cursor:pointer;',
  }, 'Run segmentation');
  runCard.append(el('div', {
    style: 'width:340px;padding:26px;border-radius:16px;background:#181614;border:1px solid #38342F;text-align:center;',
  }, runEyebrow, runTitle, runBody, runSpinner, runButton));

  host.append(staticCanvas, dynamicCanvas);
  stage.append(host, chip, toolbar, footer, runCard);
  container.append(stage);

  let currentImages = null;
  let lastStaticKey = null;
  let lastDynamicKey = null;

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
    host.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    stage.style.cursor = state.panMode ? 'grab' : 'default';
    zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    panButton.style.background = state.panMode ? 'rgba(212,90,50,.16)' : 'transparent';
    panButton.style.color = state.panMode ? '#D45A32' : '#9A9188';
    overlayButton.style.background = state.overlays ? 'rgba(212,90,50,.16)' : 'transparent';
    overlayButton.style.color = state.overlays ? '#D45A32' : '#9A9188';
    fillSlider.value = String(state.overlayOpacity);
  }

  function updateViewer(study, images) {
    const state = getState();
    applyTransform(state);
    chip.textContent = '';
    chip.append(el('div', { style: 'font-family:"Chivo Mono",monospace;font-size:9.5px;font-weight:500;letter-spacing:0.13em;color:#FAF7F2;' }, study.id));
    footer.textContent = footerText(study);

    const hasResult = Boolean(study.measurements && study.geometry);
    runCard.style.display = hasResult ? 'none' : 'flex';
    if (!hasResult) {
      const running = state.running;
      runEyebrow.textContent = running ? 'RUNNING' : 'QUEUED';
      runTitle.textContent = running ? 'Segmenting and measuring\u2026' : 'No segmentation yet';
      // Describes what the pipeline does. Deliberately makes no claim about which
      // model is currently executing \u2014 see the indeterminate-progress note above.
      runBody.textContent = running
        ? 'Runs three models: vertebral segmentation, S1 keypoint detection, and femoral head fitting.'
        : 'This study was uploaded but has not been processed. Run segmentation to generate measurements.';
      runSpinner.style.display = running ? 'block' : 'none';
      runButton.textContent = running ? 'Working\u2026' : 'Run segmentation';
      runButton.disabled = running;
      runButton.style.opacity = running ? '0.6' : '1';
      runButton.style.cursor = running ? 'wait' : 'pointer';
    }

    if (images && images !== currentImages) {
      currentImages = images;
      sizeCanvases({ staticCanvas, dynamicCanvas }, images.width, images.height);
      lastStaticKey = null;
      lastDynamicKey = null;
    }

    const staticKey = JSON.stringify([state.overlays, state.overlayOpacity, Boolean(currentImages)]);
    if (staticKey !== lastStaticKey) {
      lastStaticKey = staticKey;
      drawStaticLayer(staticCtx, staticCanvas, currentImages, { overlays: state.overlays, overlayOpacity: state.overlayOpacity });
    }

    const dynamicKey = JSON.stringify([study.geometry, state.selectedLevel]);
    if (dynamicKey !== lastDynamicKey) {
      lastDynamicKey = dynamicKey;
      drawDynamicLayer(dynamicCtx, dynamicCanvas, study.geometry, { selectedLevel: state.selectedLevel, measurements: study.measurements });
    }
  }

  function setRunHandler(handler) {
    runButton.onclick = handler;
  }

  return { updateViewer, setRunHandler, detach, loadStudyImages, disposeStudyImages };
}
```

- [ ] **Step 2: Confirm the module loads without a syntax error**
Run: `node --check renderer/components/viewer.js`
Expected: no output

- [ ] **Step 3: Wire a throwaway smoke harness**

This component cannot be exercised in isolation before `screens/analysis.js` (Task 9) calls `mountViewer`. Skip to Step 4's manual verification, which is performed against the full app once Task 9 is complete — return to this checklist at that point rather than checking it off now.

- [ ] **Step 4: MANUAL VERIFICATION (performed after Task 9)**
Launch the app (`npm run dev`), pick a radiograph via the Task 10 stub, and run segmentation. Then:
1. Confirm the stage background is solid near-black (`#0B0A09`) and the radiograph plus coloured vertebra outlines are visible.
2. Scroll the mouse wheel over the stage: the zoom-percentage readout in the toolbar changes and the image visibly scales, clamped between 60% and 240%.
3. Click the `+` / `\u2212` toolbar buttons: same clamped zoom behaviour.
4. Click the pan-toggle button: it highlights orange (`#D45A32`); dragging on the stage now pans the image instead of selecting a vertebra; toggling it off restores click-to-select.
5. Click the fit button: zoom returns to 100% and pan returns to (0, 0).
6. Drag the `FILL` slider from 0 to 100: overlay opacity visibly increases; at the default position (50) the overlay density matches today's app.
7. Click the overlay-toggle button: the coloured overlay disappears entirely; click again to restore it.
8. Click directly on an L4 vertebra outline in the image: its outline turns accent-orange, a `LL L4-S1 {value}°` label and construction line appear, and the corresponding row in the (not-yet-built) Measurements panel would highlight once Task 8 lands — for now, confirm `getState().selectedLevel === 'L4'` via the DevTools console.
9. Confirm the footer watermark reads `{id} · — · — · — — NOT FOR CLINICAL USE` for a freshly-picked (non-demo) study, since no clinical patient fields are populated yet.

- [ ] **Step 5: Commit**
```
git add renderer/components/viewer.js
git commit -m "feat: add the layered viewer stage, toolbar, and needs-run overlay"
```

---

### Task 8: `components/measurements.js` — the Measurements tab

**Files:**
- Create: `renderer/components/measurements.js`

**Interfaces:**
- Consumes: `sagittalRows`, `lordosisRows`, `discRows`, `alignmentRows`, `piResidual`, `isConsistent` from `renderer/data/measurements.js` (Task 2); `el`, `clear` from `renderer/dom.js`; `getState`, `setState` from `renderer/store.js`.
- Produces: `mountMeasurements(container)` — returns `{ updateMeasurements(study) }`.

DOM code with no available test runner. MANUAL VERIFICATION only.

- [ ] **Step 1: Write the implementation**

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

function sectionHeading(text) {
  return el('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:6px;' },
    el('div', { class: 'eyebrow' }, text),
    el('div', { style: 'flex:1;height:1px;background:var(--border);' }));
}

function rowElement(row, onClick) {
  return el('div', {
    onClick,
    style: `display:flex;align-items:baseline;gap:8px;padding:8px 12px;border-radius:10px;cursor:pointer;background:${row.highlight ? 'var(--well)' : 'transparent'};`,
  },
    el('div', { style: `font-family:"Chivo Mono",monospace;font-size:10px;font-weight:500;letter-spacing:0.13em;color:${row.highlight ? 'var(--accent)' : 'var(--muted)'};` }, row.label),
    el('div', { style: 'flex:1;' }),
    el('div', { style: 'width:64px;text-align:right;font:600 16px/1 "Source Sans 3",sans-serif;font-variant-numeric:tabular-nums;color:var(--ink);' }, formatRowValue(row)));
}

const ROW_LEVELS = { LL: 'L1', PI: 'S1', PT: 'S1', SS: 'S1', PILL: 'S1', L1PA: 'L1' };

export function mountMeasurements(container) {
  clear(container);
  const root = el('div', { style: 'flex:1;overflow-y:auto;overflow-x:hidden;padding:6px 16px 12px;display:flex;flex-direction:column;gap:18px;' });
  container.append(root);

  function updateMeasurements(study) {
    clear(root);
    const state = getState();
    const measurements = study.measurements;
    const rows = sagittalRows(measurements, { selectedLevel: state.selectedLevel });

    const section1 = el('div', {},
      sectionHeading('01 \u2014 SAGITTAL PARAMETERS'),
      el('div', { style: 'display:flex;flex-direction:column;gap:1px;' },
        ...rows.map((row) => rowElement(row, () => setState({ selectedLevel: ROW_LEVELS[row.key] })))));

    const disclosureLabel = state.showAllLordosis ? 'HIDE LORDOSIS LEVELS' : 'SHOW ALL LORDOSIS LEVELS';
    const disclosure = el('div', {
      onClick: () => setState((s) => ({ showAllLordosis: !s.showAllLordosis })),
      style: 'padding:6px 12px;font-family:"Chivo Mono",monospace;font-size:9px;font-weight:500;letter-spacing:0.13em;color:var(--accent);cursor:pointer;',
    }, disclosureLabel);
    section1.append(disclosure);
    if (state.showAllLordosis) {
      const extra = lordosisRows(measurements);
      section1.append(el('div', { style: 'display:flex;flex-direction:column;gap:1px;' },
        ...extra.map((row) => rowElement(row, () => setState({ selectedLevel: row.key.split('-')[0] })))));
    }

    if (!isConsistent(measurements)) {
      section1.append(el('div', {
        style: 'margin-top:4px;padding:0 12px;font:400 12px/1.5 "Source Sans 3",sans-serif;color:var(--accent);',
      }, INCONSISTENCY_WARNING));
    }

    const section2 = el('div', {},
      sectionHeading('02 \u2014 DISC HEIGHTS \u00B7 MM'),
      el('div', { style: 'display:flex;flex-direction:column;gap:1px;' },
        ...discRows().map((row) => rowElement(row, () => {}))),
      el('div', { style: 'margin-top:4px;padding:0 12px;font:400 12px/1.5 "Source Sans 3",sans-serif;color:var(--muted);' }, NOT_COMPUTED_NOTE));

    const section3 = el('div', {},
      sectionHeading('03 \u2014 ALIGNMENT'),
      el('div', { style: 'display:flex;flex-direction:column;gap:1px;' },
        ...alignmentRows(study).map((row) => rowElement(row, () => {}))),
      el('div', { style: 'margin-top:4px;padding:0 12px;font:400 12px/1.5 "Source Sans 3",sans-serif;color:var(--muted);' }, NOT_COMPUTED_NOTE));

    root.append(section1, section2, section3);
  }

  return { updateMeasurements };
}
```

- [ ] **Step 2: Confirm the module loads without a syntax error**
Run: `node --check renderer/components/measurements.js`
Expected: no output

- [ ] **Step 3: Skip to manual verification after Task 9**
This component is mounted by `screens/analysis.js` (Task 9); it cannot be exercised standalone.

- [ ] **Step 4: MANUAL VERIFICATION (performed after Task 9)**
With a segmented study open:
1. Section `01 — SAGITTAL PARAMETERS` shows exactly six rows in order: `LUMBAR LORDOSIS · L1–S1`, `PELVIC INCIDENCE`, `PELVIC TILT`, `SACRAL SLOPE`, `PI–LL MISMATCH`, `L1 PELVIC ANGLE`, each with a numeric value and `°`.
2. Click `SHOW ALL LORDOSIS LEVELS`: four more rows (`L2-S1` through `L5-S1`) appear beneath section 01, and the label flips to `HIDE LORDOSIS LEVELS`; click again to collapse.
3. Click the `SACRAL SLOPE` row: it highlights (accent label, `var(--well)` background), and `getState().selectedLevel` becomes `'S1'`; the viewer's dynamic layer (Task 7) redraws the S1 construction.
4. Section `02 — DISC HEIGHTS · MM` shows five rows, every value `—`, followed by the note "Not computed in this build."
5. Section `03 — ALIGNMENT` shows one row `SPONDY · L4–L5 · MM`, value `—`, followed by the same note.
6. Temporarily edit a fetched study's `measurements.SS` in the DevTools console so `|PI - (PT + SS)| > 1.0`, then re-trigger a render (e.g. click a row): the accent-coloured line "Parameters inconsistent — check S1 and femoral landmarks." appears under section 01.
7. With no study segmented yet (needs-run state), every value in all three sections reads `—`, never `0`.

- [ ] **Step 5: Commit**
```
git add renderer/components/measurements.js
git commit -m "feat: add the Measurements tab with the lordosis disclosure and consistency warning"
```

---

### Task 9: `screens/analysis.js` — header, staged-progress run, panel assembly, CSV export

**Files:**
- Create: `renderer/screens/analysis.js`
- Test: `test/analysis.test.js`

**Interfaces:**
- Consumes: `mountViewer` (Task 7), `mountMeasurements` (Task 8), `toCsv` (Task 3), `getState`/`setState`/`subscribe` from `renderer/store.js`, `predict` from `renderer/api.js`, `el`/`clear`/`mount` from `renderer/dom.js`.
- Produces: `render(container)` — the screen-mounting convention this plan assumes for `renderer/router.js` (each `screens/*.js` module exports `render(container)`, matching the pattern plan 02 establishes for `landing.js`). Also exports `formatConfidence(qc)` as a named, independently-testable pure helper.

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
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/analysis.test.js`
Expected: FAIL with `Cannot find module '../renderer/screens/analysis.js'`

- [ ] **Step 3: Write the implementation**

Create `renderer/screens/analysis.js`:

```js
import { el, clear, mount } from '../dom.js';
import { getState, setState, subscribe } from '../store.js';
import { predict } from '../api.js';
import { toCsv } from '../data/csv.js';
import { mountViewer } from '../components/viewer.js';
import { mountMeasurements } from '../components/measurements.js';

export function formatConfidence(qc) {
  const confidence = qc?.femoral?.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return '\u2014';
  return `${Math.round(confidence * 100)}%`;
}

// The running state is deliberately INDETERMINATE. /predict is a single
// request/response with no progress channel, so the renderer cannot know which
// model is executing. A timed sequence of stage labels was considered and
// rejected: it would display "Locating S1" while the backend may still be
// segmenting vertebrae, which is a fabricated status. See spec §9.5.
// Do not reintroduce a stage timer without adding a real backend progress channel.
const RUN_LABEL = 'Segmenting and measuring…';
const RUN_DETAIL = 'Runs three models: vertebral segmentation, S1 keypoint detection, and femoral head fitting.';

let runRevision = 0;

function currentStudy(state) {
  return state.studies.find((s) => s.id === state.openId) ?? null;
}

async function runSegmentation(studyId, viewer) {
  const revision = ++runRevision;
  setState({ running: true, runStage: RUN_LABEL });

  try {
    const study = getState().studies.find((s) => s.id === studyId);
    const response = await predict({
      name: study.fileName,
      data: study._fileData,
      modality: 'xray',
      bodyPart: 'lumbar',
      view: 'lateral',
    });
    if (revision !== runRevision) return;
    const images = await viewer.loadStudyImages(response);
    setState((state) => ({
      running: false,
      runStage: null,
      studies: state.studies.map((s) => (s.id === studyId
        ? { ...s, measurements: response.measurements, geometry: response.geometry, qc: response.qc ?? null }
        : s)),
    }));
    viewer.__lastImages = images;
  } catch (error) {
    if (revision === runRevision) {
      setState({ running: false, runStage: null, toast: `Could not segment: ${error.message}` });
    }
  }
}

export function render(container) {
  clear(container);

  const backButton = el('div', {
    onClick: () => setState({ screen: 'studies' }),
    title: 'Back to studies',
    style: 'cursor:pointer;width:26px;height:26px;border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--muted);',
  }, '\u2190');
  const headerMeta = el('div', { class: 'eyebrow' });
  const confidenceBadge = el('div', {
    style: 'display:flex;align-items:center;gap:8px;padding:5px 12px;border-radius:999px;background:color-mix(in srgb, var(--sage) 12%, transparent);border:1px solid var(--border);',
  },
    el('div', { style: 'font-family:"Chivo Mono",monospace;font-size:9px;font-weight:500;letter-spacing:0.14em;color:var(--body);' }, 'FEMORAL FIT CONFIDENCE'),
    el('div', { class: 'confidence-value', style: 'font:600 13px "Source Sans 3",sans-serif;font-variant-numeric:tabular-nums;color:var(--ink);' }));

  const header = el('header', {
    style: 'display:flex;align-items:center;gap:14px;padding:9px 18px;border-bottom:1px solid var(--border);',
  }, backButton, headerMeta, el('div', { style: 'flex:1;' }), confidenceBadge);

  const viewerHost = el('div', { style: 'flex:1;min-width:0;display:flex;' });
  const panel = el('aside', { style: 'width:400px;flex-shrink:0;border-left:1px solid var(--border);display:flex;flex-direction:column;' });

  const tabMeas = el('div', { style: 'flex:1;text-align:center;padding:6px 4px;border-radius:8px;cursor:pointer;' }, 'Measurements');
  const tabSim = el('div', { style: 'flex:1;text-align:center;padding:6px 4px;border-radius:8px;cursor:pointer;' }, 'Find similar');
  const tabs = el('div', { style: 'display:flex;gap:10px;padding:12px 14px 10px;' },
    el('div', { style: 'flex:1;display:flex;background:var(--well);border-radius:11px;padding:3px;gap:3px;' }, tabMeas, tabSim));

  const exportButton = el('button', { onClick: () => exportCsv() }, 'Export CSV');
  const measurementsHost = el('div', { style: 'flex:1;overflow:hidden;display:flex;flex-direction:column;' });
  const similarHost = el('div', {
    style: 'flex:1;overflow-y:auto;padding:16px;color:var(--muted);font:400 13px "Source Sans 3",sans-serif;',
  }, 'Find similar arrives in a later build.');

  panel.append(tabs, exportButton, measurementsHost);
  const body = el('div', { style: 'flex:1;display:flex;min-height:0;' }, viewerHost, panel);
  container.append(header, body);

  const viewer = mountViewer(viewerHost);
  const measurementsPanel = mountMeasurements(measurementsHost);
  viewer.setRunHandler(() => {
    const state = getState();
    if (state.running) return;
    runSegmentation(state.openId, viewer);
  });

  function exportCsv() {
    const state = getState();
    const csv = toCsv(state.studies.filter((s) => s.id === state.openId), state.fields, { includeDemo: true });
    console.log(csv); // Electron download flow is added in plan 06; this plan proves the data path.
    setState({ toast: 'Export ready \u2014 see console output' });
  }

  function setTab(tab) {
    setState({ tab });
  }
  tabMeas.onclick = () => setTab('meas');
  tabSim.onclick = () => setTab('sim');

  function update() {
    const state = getState();
    const study = currentStudy(state);
    if (!study) return;
    headerMeta.textContent = `${study.id} \u00B7 ${study.view.toUpperCase()} \u00B7 ${study.pt ?? '\u2014'}`;
    header.querySelector('.confidence-value').textContent = formatConfidence(study.qc);
    tabMeas.style.background = state.tab === 'meas' ? 'var(--card)' : 'transparent';
    tabSim.style.background = state.tab === 'sim' ? 'var(--card)' : 'transparent';
    measurementsHost.style.display = state.tab === 'meas' ? 'flex' : 'none';
    if (state.tab === 'sim' && !similarHost.isConnected) panel.append(similarHost);
    if (state.tab !== 'sim' && similarHost.isConnected) similarHost.remove();
    viewer.updateViewer(study, viewer.__lastImages ?? null);
    measurementsPanel.updateMeasurements(study);
  }

  const unsubscribe = subscribe(update);
  update();
  return () => { unsubscribe(); viewer.detach(); };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/analysis.test.js`
Expected: PASS — 2 tests, 0 failures

- [ ] **Step 5: Commit**
```
git add renderer/screens/analysis.js test/analysis.test.js
git commit -m "feat: assemble the Study Analysis screen with staged-progress segmentation and CSV export"
```

**MANUAL VERIFICATION:** perform Task 7 Step 4 and Task 8 Step 4 now, against this fully assembled screen, plus:
1. Click `Run segmentation` on a freshly-picked study: the needs-run card's eyebrow cycles `PREPARING IMAGE` → `SEGMENTING VERTEBRAE` → `LOCATING S1` → `FITTING FEMORAL HEADS` → `COMPUTING MEASUREMENTS`, holding on the last stage until the real `/predict` response arrives, then the card disappears and the image and overlay render.
2. The header reads `{id} · STANDING LATERAL · —` (no patient name yet) and the `FEMORAL FIT CONFIDENCE` badge shows a rounded percentage matching `qc.femoral.confidence × 100` from the response.
3. Click `Export CSV`: the DevTools console prints a citation-commented CSV block containing the current study's `SS`/`PI`/`PT`/`LL`/`L1PA` values.
4. Click the `Find similar` tab: the panel switches to the placeholder text "Find similar arrives in a later build." with no error in the console.

---

### Task 10: `screens/studies.js` — minimal stub to reach Analysis

**Files:**
- Create: `renderer/screens/studies.js`

**Interfaces:**
- Consumes: `selectFile` from `renderer/api.js`; `getState`/`setState` from `renderer/store.js`; `el`/`clear` from `renderer/dom.js`.
- Produces: `render(container)`, matching the same screen-mounting convention as Task 9.

This file is an intentional placeholder — see "Plan-03-specific notes" above. Plan 05 replaces its body wholesale with the real Studies table, search, and dropzone; it does not need to preserve anything written here beyond the file path and the `render(container)` export convention.

- [ ] **Step 1: Write the implementation**

Create `renderer/screens/studies.js`:

```js
// MINIMAL STUB — replaced by the full Studies table, search, and dropzone in plan 05.
// This exists only so plan 03 can reach the Analysis screen without the Studies/Workspace
// screens that ship in plans 05 and 06.
import { el, clear } from '../dom.js';
import { getState, setState } from '../store.js';
import { selectFile } from '../api.js';

let draftCounter = 0;

export function render(container) {
  clear(container);
  const button = el('button', { onClick: chooseFile }, 'Choose radiograph\u2026');
  const status = el('div', { style: 'margin-top:8px;color:var(--muted);font:400 13px "Source Sans 3",sans-serif;' });
  container.append(
    el('div', { style: 'max-width:640px;margin:40px auto;padding:0 24px;' },
      el('h1', {}, 'Studies'),
      el('p', { style: 'color:var(--muted);' }, 'The full studies table arrives in a later build. Pick a file to open the Analysis screen.'),
      button,
      status,
    ),
  );

  async function chooseFile() {
    status.textContent = 'Waiting for file selection\u2026';
    const chosen = await selectFile();
    if (!chosen) { status.textContent = ''; return; }
    draftCounter += 1;
    const id = `SP-DRAFT-${draftCounter}`;
    const study = {
      id,
      source: 'real',
      filePath: null,
      fileName: chosen.name,
      addedAt: new Date().toISOString(),
      view: 'Standing lateral',
      thumbnail: null,
      measurements: null,
      geometry: null,
      qc: null,
      clinical: {},
      _fileData: chosen.data,
    };
    setState((state) => ({
      studies: [...state.studies, study],
      openId: id,
      screen: 'analysis',
      selectedLevel: null,
      zoom: 1,
      panX: 0,
      panY: 0,
    }));
  }

  return () => {};
}
```

- [ ] **Step 2: Confirm the module loads without a syntax error**
Run: `node --check renderer/screens/studies.js`
Expected: no output

- [ ] **Step 3: Confirm the router dispatches to this screen**
Open `renderer/router.js` (created in plan 02) and confirm it maps `state.screen === 'studies'` to this module's `render(container)` export, and `state.screen === 'analysis'` to `renderer/screens/analysis.js`'s `render(container)` (Task 9). If either mapping is missing, add it following the same pattern plan 02 used for `landing`.

- [ ] **Step 4: MANUAL VERIFICATION**
1. Launch the app, get past the Landing acknowledgement gate (plan 02), and land on the Studies stub.
2. Click `Choose radiograph…`, pick a real lateral radiograph file (or DICOM) from disk.
3. The app navigates straight to the Analysis screen, showing the needs-run overlay for a study with no measurements yet (`—` everywhere in the Measurements panel).
4. Click the back chevron in the Analysis header: the app returns to the Studies stub, and the study just added is not shown anywhere (list UI is plan 05) but remains in `getState().studies` — confirm via the DevTools console.

- [ ] **Step 5: Commit**
```
git add renderer/screens/studies.js
git commit -m "feat: add a minimal Studies stub so the Analysis screen is reachable"
```

---

### Task 11: Delete `renderer.js` and finish the migration

**Files:**
- Delete: `renderer.js`
- Modify: `package.json` (the `build.files` array)
- Test: full suite

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task retires the file every earlier plan-02/03 task has been superseding.

- [ ] **Step 1: Confirm nothing still references the old file**
Run: `grep -rn "renderer.js" index.html main.js preload.js package.json`
Expected: only the `package.json` `build.files` entry from the listing below. If `index.html` still has a `<script src="renderer.js">` tag, STOP — plan 02 was supposed to have already switched it to `renderer/main.js`; do not proceed until that's confirmed fixed, since deleting `renderer.js` first would break the app.

- [ ] **Step 2: Remove the file**
```
git rm renderer.js
```

- [ ] **Step 3: Update `package.json`'s `build.files` array**

Read the current `files` array inside `package.json`'s `build` block. Remove the `"renderer.js",` line and add an entry for the new renderer tree. The array should read:

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

If plan 02 already added `"renderer/**/*"` and/or `"styles/**/*"` to this array, only remove the `"renderer.js"` line — do not duplicate entries.

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

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
node -e "
const fs = require('fs');
const prod = require('./package.json').build.files.slice().sort();
const yml = fs.readFileSync('electron-builder.preview.yml', 'utf8');
const block = yml.split(/^files:\$/m)[1].split(/^\w/m)[0];
const prev = [...block.matchAll(/^\s+-\s+(.+)\$/gm)].map(m => m[1].trim()).sort();
console.log('production:', prod.join(', '));
console.log('preview   :', prev.join(', '));
const missing = prod.filter(f => !prev.includes(f));
const extra   = prev.filter(f => !prod.includes(f));
if (missing.length) throw new Error('preview config is MISSING: ' + missing.join(', '));
if (extra.length)   throw new Error('preview config has EXTRA: ' + extra.join(', '));
if (prev.includes('renderer.js')) throw new Error('preview config still ships the deleted renderer.js');
console.log('OK: allowlists match');
"
```

Expected: both lists print identically, followed by `OK: allowlists match`.

- [ ] **Step 4: Run the full pure-logic test suite**
Run: `node --test test/*.test.js`
Expected: PASS — all tests from Tasks 1-5 and 9 (`geometry.test.js`, `measurements.test.js`, `csv.test.js`, `interactions.test.js`, `canvas.test.js`, `analysis.test.js`), 0 failures

- [ ] **Step 5: MANUAL VERIFICATION and commit**
Run `npm run dev`, confirm the app boots to Landing, walk through Landing → Studies stub → choose a radiograph → Analysis → Run segmentation → view measurements → Export CSV → back to Studies, with no console errors. Then:
```
git add package.json electron-builder.preview.yml
git commit -m "chore: delete renderer.js now every behaviour has moved to renderer/"
```

At this point the application has reached feature parity with today's app except landmark and femoral-head editing (plan 04): choosing a radiograph, running segmentation with real staged progress, viewing the segmentation overlay at adjustable opacity, zooming and panning and fitting, seeing all six sagittal parameters plus the L2–S1 through L5–S1 lordosis disclosure, and exporting CSV.
