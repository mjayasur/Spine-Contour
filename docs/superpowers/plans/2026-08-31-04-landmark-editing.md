# Landmark Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 14-button landmark/femoral-head correction matrix with direct manipulation of handles drawn on the viewer canvas — click to select, drag to move, keyboard to cycle and nudge — while preserving every correction capability the old editor had.

**Architecture:** `renderer/viewer/interactions.js` gains four pieces of pure, unit-testable logic (`TAB_ORDER`, `nextSelection`, `nudge`, `hitTestFemoral`) that never touch the DOM. `renderer/components/viewer.js` and `renderer/viewer/canvas.js` consume that logic plus the already-ported `renderer/viewer/geometry.js` (from plan 03) to render 22 landmark handles and 2 femoral circles with centre/rim handles on the dynamic canvas layer, and to wire pointer/keyboard events to them. All geometry mutation during a drag happens directly on the in-memory geometry object with a targeted redraw of the dynamic canvas only; committing a change (pointer release, a nudge, or a retrace fit) pushes the result through the store and a 150 ms debounced `/measure` call.

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
- **Node's built-in test runner only** (`node --test`). No Jest, Vitest, or Mocha.
- **Every `<script>` is `type="module"`.** No global scope leakage.
- Target Electron 44 / Chromium — modern syntax is fine. No transpilation.
- Commit after every task. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `chore:`).

---

## Assumptions about plan 03's deliverables

Plan 04 runs after plan 03. This plan does not have plan 03's actual source to read, so it
fixes the minimal seam it needs and treats everything else as internal to the files below.
If plan 03's real code differs, adapt these seams first — the pure-logic tasks (1–7) do not
depend on any of this and can proceed regardless.

- `renderer/viewer/geometry.js` exports exactly the contract signatures: `fitCircle`,
  `imageToClient`, `clientToImage`, `nearestLandmark(geometry, clientX, clientY, canvas, radius=14)`
  → `{level, corner, distance} | null`, `landmarkAt`, `setLandmarkAt`, `LEVELS`, `CORNERS`.
- `renderer/viewer/canvas.js` exports `createLayers(host)` → `{staticCanvas, dynamicCanvas}`
  (two same-size, stacked `<canvas>` elements appended to `host`) and a `drawDynamic(canvas, geometry, opts)`
  function used for the anatomy/handle layer. Task 9 below replaces `drawDynamic`'s body outright —
  if plan 03 left it as a stub or a non-interactive renderer, this task's version supersedes it.
- `renderer/components/viewer.js` exports `mountViewer(container)`, called once by
  `renderer/screens/analysis.js`, which builds the toolbar and stage, calls `createLayers`,
  and keeps `dynamicCanvas`/`staticCanvas` as module-scope variables usable by code added later
  in the same file. The toolbar is a `<div class="viewer-toolbar">` that toolbar buttons get
  appended to.
- The currently-open study's `measurements`/`geometry` live in `getState().studies`, found by
  `state.openId`, exactly per the `Study` shape in the architecture contract. Plan 03 populates
  this after a successful `predict()` call; this plan never assumes anything about *how* — it
  only reads and writes through `getState()`/`setState()`/`subscribe()`, which are fully
  contract-bound.
- `renderer/api.js` exports `measure(geometry)` per the contract, callable as
  `measure({vertebrae, s1_superior, femoral_circles})`.

---

## Task 1: `Selection` type and `TAB_ORDER`

**Files:** `renderer/viewer/interactions.js` (new), `test/interactions.test.js` (new)

**Interfaces:**
- Consumes: `LEVELS`, `CORNERS` from `renderer/viewer/geometry.js`
- Produces: `TAB_ORDER` (exported), the `Selection` typedef (JSDoc comment only, no runtime code)

`TAB_ORDER` covers only the 22 landmark corners (5 levels × 4 corners + S1's 2 corners). The
femoral heads are appended internally by `nextSelection` in Task 2 via a private `FULL_ORDER`
array — this reconciles the contract's "22 entries" for `TAB_ORDER` with the spec's requirement
that Tab also reaches "left head, right head".

- [ ] Write the test file with a failing test for `TAB_ORDER`'s shape.

  Create `test/interactions.test.js`:

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { TAB_ORDER } from '../renderer/viewer/interactions.js';

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
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm it fails because
  `renderer/viewer/interactions.js` does not exist yet (`ERR_MODULE_NOT_FOUND`).

- [ ] Create `renderer/viewer/interactions.js`:

  ```js
  /**
   * @typedef {Object} Selection
   * @property {'landmark'|'femoral'} kind
   * @property {string} [level]   'L1'..'L5'|'S1' — present when kind === 'landmark'
   * @property {string} [corner]  'SA'|'SP'|'IA'|'IP' — present when kind === 'landmark'
   * @property {'left'|'right'} [side]   present when kind === 'femoral'
   * @property {'center'|'rim'} [part]   present when kind === 'femoral'
   */

  import { LEVELS, CORNERS } from './geometry.js';

  export const TAB_ORDER = [
    ...LEVELS.flatMap((level) => CORNERS.map((corner) => ({ kind: 'landmark', level, corner }))),
    { kind: 'landmark', level: 'S1', corner: 'SA' },
    { kind: 'landmark', level: 'S1', corner: 'SP' },
  ];
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm both tests pass.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add Selection type and TAB_ORDER to interactions.js"
  ```

---

## Task 2: `nextSelection(current, direction)`

**Files:** `renderer/viewer/interactions.js`, `test/interactions.test.js`

**Interfaces:**
- Consumes: `TAB_ORDER` (Task 1)
- Produces: `nextSelection(current, direction)` (exported)

`direction` is `1` for Tab (forward) and `-1` for Shift+Tab (backward). Internally, the full
24-stop cycle is `TAB_ORDER` followed by the left and right femoral-head centre selections —
this is where the spec's "…S1 SA, SP, left head, right head" order is realized.

- [ ] Append to `test/interactions.test.js`:

  ```js
  import { nextSelection } from '../renderer/viewer/interactions.js';

  test('nextSelection steps forward through landmarks in anatomical order', () => {
    const l1sa = { kind: 'landmark', level: 'L1', corner: 'SA' };
    const l1sp = nextSelection(l1sa, 1);
    assert.deepEqual(l1sp, { kind: 'landmark', level: 'L1', corner: 'SP' });
  });

  test('nextSelection steps backward through landmarks', () => {
    const l1sp = { kind: 'landmark', level: 'L1', corner: 'SP' };
    const l1sa = nextSelection(l1sp, -1);
    assert.deepEqual(l1sa, { kind: 'landmark', level: 'L1', corner: 'SA' });
  });

  test('nextSelection reaches the femoral heads after S1 SP', () => {
    const s1sp = { kind: 'landmark', level: 'S1', corner: 'SP' };
    const leftHead = nextSelection(s1sp, 1);
    assert.deepEqual(leftHead, { kind: 'femoral', side: 'left', part: 'center' });
    const rightHead = nextSelection(leftHead, 1);
    assert.deepEqual(rightHead, { kind: 'femoral', side: 'right', part: 'center' });
  });

  test('nextSelection wraps from the right head back to L1 SA', () => {
    const rightHead = { kind: 'femoral', side: 'right', part: 'center' };
    const wrapped = nextSelection(rightHead, 1);
    assert.deepEqual(wrapped, { kind: 'landmark', level: 'L1', corner: 'SA' });
  });

  test('nextSelection wraps backward from L1 SA to the right head', () => {
    const l1sa = { kind: 'landmark', level: 'L1', corner: 'SA' };
    const wrapped = nextSelection(l1sa, -1);
    assert.deepEqual(wrapped, { kind: 'femoral', side: 'right', part: 'center' });
  });

  test('nextSelection with null current returns the first stop going forward', () => {
    assert.deepEqual(nextSelection(null, 1), { kind: 'landmark', level: 'L1', corner: 'SA' });
  });

  test('nextSelection with null current returns the last stop going backward', () => {
    assert.deepEqual(nextSelection(null, -1), { kind: 'femoral', side: 'right', part: 'center' });
  });

  test('nextSelection ignores the femoral part when matching a current selection', () => {
    const rimSelection = { kind: 'femoral', side: 'left', part: 'rim' };
    const next = nextSelection(rimSelection, 1);
    assert.deepEqual(next, { kind: 'femoral', side: 'right', part: 'center' });
  });
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm the new tests fail
  (`nextSelection is not a function`).

- [ ] Append to `renderer/viewer/interactions.js`:

  ```js
  const HEAD_ORDER = [
    { kind: 'femoral', side: 'left', part: 'center' },
    { kind: 'femoral', side: 'right', part: 'center' },
  ];

  const FULL_ORDER = [...TAB_ORDER, ...HEAD_ORDER];

  function sameSelection(a, b) {
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'landmark') return a.level === b.level && a.corner === b.corner;
    return a.side === b.side;
  }

  export function nextSelection(current, direction) {
    const step = direction < 0 ? -1 : 1;
    if (!current) return step > 0 ? FULL_ORDER[0] : FULL_ORDER[FULL_ORDER.length - 1];
    let index = FULL_ORDER.findIndex((entry) => sameSelection(entry, current));
    if (index === -1) index = 0;
    index = (index + step + FULL_ORDER.length) % FULL_ORDER.length;
    return FULL_ORDER[index];
  }
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm every test passes.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add nextSelection for Tab/Shift+Tab cycling"
  ```

---

## Task 3: `nudge` — landmark selections

**Files:** `renderer/viewer/interactions.js`, `test/interactions.test.js`

**Interfaces:**
- Consumes: `landmarkAt`, `setLandmarkAt` from `renderer/viewer/geometry.js`
- Produces: `nudge(geometry, selection, dx, dy)` (exported), landmark branch

`setLandmarkAt` (ported in plan 03 from `renderer.js:361–372`) already keeps
`body.quadrilateral` in sync, so `nudge` only needs to read the current point and write the
moved one back through it.

- [ ] Append to `test/interactions.test.js`:

  ```js
  import { nudge } from '../renderer/viewer/interactions.js';

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
      hip_midpoint: [15, 150],
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
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm the three new tests fail
  (`nudge is not a function`).

- [ ] Append to `renderer/viewer/interactions.js` (add the import at the top, the function at
  the bottom):

  ```js
  import { landmarkAt, setLandmarkAt } from './geometry.js';
  ```

  ```js
  export function nudge(geometry, selection, dx, dy) {
    if (selection.kind === 'landmark') {
      const [x, y] = landmarkAt(geometry, selection.level, selection.corner);
      setLandmarkAt(geometry, selection.level, selection.corner, [x + dx, y + dy]);
      return;
    }
  }
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm all tests pass.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: nudge landmark selections by dx, dy"
  ```

---

## Task 4: `nudge` — femoral selections

**Files:** `renderer/viewer/interactions.js`, `test/interactions.test.js`

**Interfaces:**
- Produces: `nudge`'s femoral branch (center translate, rim resize)

Femoral circle index `0` is left, `1` is right (per the contract). The centre handle
translates on `dx, dy` directly. The rim handle has one degree of freedom — radius — so the
convention here is: right/up grow the radius, left/down shrink it (`radius += dx - dy`),
floored at 1px so it can never go to zero or negative.

- [ ] Append to `test/interactions.test.js`:

  ```js
  test('nudge on a femoral center translates cx, cy', () => {
    const geometry = sampleGeometry();
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'center' }, 4, -3);
    assert.deepEqual(geometry.femoral_circles[0], [54, 147, 20]);
  });

  test('nudge on a femoral center uses index 1 for the right side', () => {
    const geometry = sampleGeometry();
    nudge(geometry, { kind: 'femoral', side: 'right', part: 'center' }, 1, 1);
    assert.deepEqual(geometry.femoral_circles[1], [151, 151, 25]);
    assert.deepEqual(geometry.femoral_circles[0], [50, 150, 20]);
  });

  test('nudge on a femoral rim grows the radius on right/up, shrinks on left/down', () => {
    const geometry = sampleGeometry();
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'rim' }, 1, 0);
    assert.equal(geometry.femoral_circles[0][2], 21);
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'rim' }, 0, -1);
    assert.equal(geometry.femoral_circles[0][2], 22);
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'rim' }, -1, 0);
    assert.equal(geometry.femoral_circles[0][2], 21);
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'rim' }, 0, 1);
    assert.equal(geometry.femoral_circles[0][2], 20);
  });

  test('nudge on a femoral rim never drops the radius below 1', () => {
    const geometry = sampleGeometry();
    geometry.femoral_circles[0] = [50, 150, 0.5];
    nudge(geometry, { kind: 'femoral', side: 'left', part: 'rim' }, -10, 0);
    assert.equal(geometry.femoral_circles[0][2], 1);
  });
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm the new tests fail (radius/cx/cy
  assertions fail because the femoral branch is a no-op).

- [ ] Replace the `nudge` function body in `renderer/viewer/interactions.js`:

  ```js
  export function nudge(geometry, selection, dx, dy) {
    if (selection.kind === 'landmark') {
      const [x, y] = landmarkAt(geometry, selection.level, selection.corner);
      setLandmarkAt(geometry, selection.level, selection.corner, [x + dx, y + dy]);
      return;
    }
    const index = selection.side === 'left' ? 0 : 1;
    const circle = geometry.femoral_circles[index];
    if (selection.part === 'center') {
      circle[0] += dx;
      circle[1] += dy;
      return;
    }
    circle[2] = Math.max(1, circle[2] + dx - dy);
  }
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm all tests pass.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: nudge femoral centre and rim selections"
  ```

---

## Task 5: `hitTestFemoral` — pure femoral hit-testing

**Files:** `renderer/viewer/interactions.js`, `test/interactions.test.js`

**Interfaces:**
- Produces: `hitTestFemoral(circles, x, y, radius = 14)` (exported)

This is coordinate-space-agnostic: it operates on whatever `x, y` and `circles` are already
expressed in, so it is fully unit-testable without a DOM canvas. Task 12 wraps it with a
client-space adapter for real pointer events, mirroring how `nearestLandmark` already handles
scale.

- [ ] Append to `test/interactions.test.js`:

  ```js
  import { hitTestFemoral } from '../renderer/viewer/interactions.js';

  test('hitTestFemoral finds the left centre when the point is inside the hit radius', () => {
    const circles = [[50, 150, 20], [150, 150, 25]];
    const hit = hitTestFemoral(circles, 52, 151, 14);
    assert.deepEqual(hit, { kind: 'femoral', side: 'left', part: 'center' });
  });

  test('hitTestFemoral finds the right rim when the point sits near the circumference', () => {
    const circles = [[50, 150, 20], [150, 150, 25]];
    const hit = hitTestFemoral(circles, 174, 150, 14);
    assert.deepEqual(hit, { kind: 'femoral', side: 'right', part: 'rim' });
  });

  test('hitTestFemoral returns null outside every hit radius', () => {
    const circles = [[50, 150, 20], [150, 150, 25]];
    assert.equal(hitTestFemoral(circles, 400, 400, 14), null);
  });

  test('hitTestFemoral prefers the closer of centre and rim when both are within radius', () => {
    const circles = [[0, 0, 8]];
    const hit = hitTestFemoral(circles, 2, 0, 14);
    assert.deepEqual(hit, { kind: 'femoral', side: 'left', part: 'center' });
  });
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm the four new tests fail
  (`hitTestFemoral is not a function`).

- [ ] Append to `renderer/viewer/interactions.js`:

  ```js
  export function hitTestFemoral(circles, x, y, radius = 14) {
    const sides = ['left', 'right'];
    let best = null;
    let bestDistance = Infinity;
    circles.forEach((circle, index) => {
      const [cx, cy, r] = circle;
      const centerDistance = Math.hypot(x - cx, y - cy);
      if (centerDistance <= radius && centerDistance < bestDistance) {
        best = { kind: 'femoral', side: sides[index], part: 'center' };
        bestDistance = centerDistance;
      }
      const rimDistance = Math.abs(centerDistance - r);
      if (rimDistance <= radius && rimDistance < bestDistance) {
        best = { kind: 'femoral', side: sides[index], part: 'rim' };
        bestDistance = rimDistance;
      }
    });
    return best;
  }
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm all tests pass.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add pure femoral hit-testing"
  ```

---

## Task 6: `arrowKeyDelta` — keyboard nudge amounts

**Files:** `renderer/viewer/interactions.js`, `test/interactions.test.js`

**Interfaces:**
- Produces: `arrowKeyDelta(key, shiftKey)` (exported) → `{dx, dy} | null`

1px per press, 10px with Shift, per spec §12.

- [ ] Append to `test/interactions.test.js`:

  ```js
  import { arrowKeyDelta } from '../renderer/viewer/interactions.js';

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
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm the new tests fail.

- [ ] Append to `renderer/viewer/interactions.js`:

  ```js
  export function arrowKeyDelta(key, shiftKey) {
    const amount = shiftKey ? 10 : 1;
    if (key === 'ArrowUp') return { dx: 0, dy: -amount };
    if (key === 'ArrowDown') return { dx: 0, dy: amount };
    if (key === 'ArrowLeft') return { dx: -amount, dy: 0 };
    if (key === 'ArrowRight') return { dx: amount, dy: 0 };
    return null;
  }
  ```

- [ ] Run `node --test test/interactions.test.js` and confirm all tests pass.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add arrowKeyDelta for keyboard nudging"
  ```

---

## Task 7: `debounce` — measure round-trip helper

**Files:** `renderer/viewer/interactions.js`, `test/interactions.test.js`

**Interfaces:**
- Produces: `debounce(fn, ms)` (exported) → debounced function with a `.cancel()` method

Used in Task 11 to wrap the `/measure` round-trip at 150ms per spec §12. Tests use a short
delay so the suite stays fast; the real call site still passes 150.

- [ ] Append to `test/interactions.test.js`:

  ```js
  import { debounce } from '../renderer/viewer/interactions.js';

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

- [ ] Run `node --test test/interactions.test.js` and confirm the two new tests fail
  (`debounce is not a function`).

- [ ] Append to `renderer/viewer/interactions.js`:

  ```js
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

- [ ] Run `node --test test/interactions.test.js` and confirm all tests pass — the full file
  should now report at least 24 passing tests.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add debounce helper for the measure round-trip"
  ```

---

## Task 8: Edit-mode toggle and Esc handler

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `getState`, `setState` from `renderer/store.js`; `el` from `renderer/dom.js`

Adds the `Edit landmarks` / `Done editing` toggle to the viewer toolbar and an `Esc` handler
that exits edit mode. This introduces the `keydown` listener that Tasks 15 and 16 extend with
Tab and Arrow-key branches.

- [ ] MANUAL VERIFICATION (before): launch the app (`npm start`), select a radiograph, click
  **Measure radiograph**. The toolbar has zoom/pan/overlay controls but no edit toggle, and
  pressing `Escape` does nothing observable.

- [ ] In `renderer/components/viewer.js`, inside `mountViewer`, after the toolbar element is
  created and before it is appended to the stage, add the toggle button:

  ```js
  const editButton = el('button', {
    class: 'icon-button',
    type: 'button',
    onClick: () => {
      const state = getState();
      setState({ editing: !state.editing, selection: state.editing ? null : state.selection });
    },
  }, 'Edit landmarks');
  toolbar.appendChild(editButton);

  subscribe((state) => {
    editButton.textContent = state.editing ? 'Done editing' : 'Edit landmarks';
    editButton.classList.toggle('active', state.editing);
  });
  ```

  (`toolbar` and `subscribe` are assumed to already be in scope inside `mountViewer` per plan
  03 — `subscribe` imported from `renderer/store.js`.)

- [ ] Add the keydown listener at module scope, below `mountViewer`:

  ```js
  window.addEventListener('keydown', (event) => {
    const state = getState();
    if (!state.editing) return;
    if (event.target.matches('input, select, textarea')) return;
    if (event.key === 'Escape') {
      setState({ editing: false, selection: null });
    }
  });
  ```

- [ ] MANUAL VERIFICATION (after): reload the app, measure a radiograph. The toolbar now shows
  an **Edit landmarks** button. Click it — it reads **Done editing** and gets a visible active
  state. Press `Escape` — the button reverts to **Edit landmarks**. Click it again, then click
  elsewhere, then press `Escape` again to confirm it still exits.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add edit-mode toggle and Esc handler to the viewer"
  ```

---

## Task 9: Dynamic-layer handle rendering

**Files:** `renderer/viewer/canvas.js`

**Interfaces:**
- Consumes: `LEVELS`, `CORNERS`, `landmarkAt` from `renderer/viewer/geometry.js`
- Produces: `drawDynamic(canvas, geometry, opts)` — replaces any prior body from plan 03

Draws the 5 vertebra outlines, all 22 landmark handles, S1's 2 handles, and both femoral
circles with a centre and a rim handle. Outside edit mode the points render in flat,
non-interactive colors (parity with the old always-visible points); inside edit mode they use
distinct per-corner colors and respond to `selection`/`hover`. The off-theme viewer colors
(`#0B0A09` outline, `rgba(250,247,242,.75)` label fill, `#D45A32` selection accent) are the
ones fixed by the architecture contract for this file and must not be replaced with CSS
tokens.

- [ ] MANUAL VERIFICATION (before): measure a radiograph. Points are drawn in the old flat
  outline colors and there is no reaction to hovering or clicking (the old matrix panel is
  still the only way to select a corner).

- [ ] Add to the top of `renderer/viewer/canvas.js`:

  ```js
  import { LEVELS, CORNERS, landmarkAt } from './geometry.js';

  const LEVEL_COLORS = ['rgb(255,99,132)', 'rgb(255,159,64)', 'rgb(255,205,86)', 'rgb(75,192,192)', 'rgb(54,162,235)'];
  const CORNER_COLORS = { SA: '#32d4ff', SP: '#64e19a', IA: '#ffb259', IP: '#fa78d4' };
  const SELECTED_COLOR = '#D45A32';
  const LABEL_FILL = 'rgba(250,247,242,.75)';
  const LABEL_BG = 'rgba(11,10,9,.82)';
  const FEMORAL_COLOR = '#62d26f';

  function sameHandle(a, b) {
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'landmark') return a.level === b.level && a.corner === b.corner;
    return a.side === b.side && a.part === b.part;
  }

  function drawHandle(ctx, point, baseColor, isSelected, isHovered, label, scale) {
    const radius = Math.max(3, scale / 280) * (isHovered ? 1.7 : 1);
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(point[0], point[1], radius * 2.1, 0, 2 * Math.PI);
      ctx.strokeStyle = SELECTED_COLOR;
      ctx.lineWidth = Math.max(1.5, scale / 700);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(point[0], point[1], radius, 0, 2 * Math.PI);
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.strokeStyle = '#0B0A09';
    ctx.lineWidth = Math.max(1, scale / 1200);
    ctx.stroke();
    if ((isSelected || isHovered) && label) {
      const fontSize = Math.max(12, scale / 60);
      ctx.font = `600 ${fontSize}px "Chivo Mono", monospace`;
      const width = ctx.measureText(label).width + 12;
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(point[0] + radius * 1.6, point[1] - fontSize, width, fontSize + 7);
      ctx.fillStyle = LABEL_FILL;
      ctx.fillText(label, point[0] + radius * 1.6 + 5, point[1] + 1);
    }
  }
  ```

- [ ] Add `drawDynamic` to `renderer/viewer/canvas.js`, replacing any earlier definition:

  ```js
  export function drawDynamic(canvas, geometry, opts = {}) {
    const { editing = false, selection = null, hover = null, tracePoints = [], retracing = false } = opts;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = canvas.width;
    const lineWidth = Math.max(2, scale / 600);

    LEVELS.forEach((level, index) => {
      const body = geometry.vertebrae[level];
      const polygon = [body.superior[0], body.superior[1], body.inferior[1], body.inferior[0]];
      ctx.strokeStyle = LEVEL_COLORS[index];
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      polygon.forEach((point, i) => (i ? ctx.lineTo(...point) : ctx.moveTo(...point)));
      ctx.closePath();
      ctx.stroke();
      CORNERS.forEach((corner) => {
        const point = landmarkAt(geometry, level, corner);
        const isSelected = editing && sameHandle(selection, { kind: 'landmark', level, corner });
        const isHovered = editing && sameHandle(hover, { kind: 'landmark', level, corner });
        const color = editing ? CORNER_COLORS[corner] : LEVEL_COLORS[index];
        drawHandle(ctx, point, color, isSelected, isHovered, `${level} ${corner}`, scale);
      });
    });

    ['SA', 'SP'].forEach((corner) => {
      const point = landmarkAt(geometry, 'S1', corner);
      const isSelected = editing && sameHandle(selection, { kind: 'landmark', level: 'S1', corner });
      const isHovered = editing && sameHandle(hover, { kind: 'landmark', level: 'S1', corner });
      drawHandle(ctx, point, editing ? CORNER_COLORS[corner] : '#8A7E72', isSelected, isHovered, `S1 ${corner}`, scale);
    });

    const sides = ['left', 'right'];
    geometry.femoral_circles.forEach(([cx, cy, radius], index) => {
      const side = sides[index];
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = FEMORAL_COLOR;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      const centerSelected = editing && sameHandle(selection, { kind: 'femoral', side, part: 'center' });
      const centerHovered = editing && sameHandle(hover, { kind: 'femoral', side, part: 'center' });
      drawHandle(ctx, [cx, cy], FEMORAL_COLOR, centerSelected, centerHovered, `${side === 'left' ? 'Left' : 'Right'} head`, scale);
      const rimPoint = [cx + radius, cy];
      const rimSelected = editing && sameHandle(selection, { kind: 'femoral', side, part: 'rim' });
      const rimHovered = editing && sameHandle(hover, { kind: 'femoral', side, part: 'rim' });
      drawHandle(ctx, rimPoint, FEMORAL_COLOR, rimSelected, rimHovered, `${side === 'left' ? 'Left' : 'Right'} head · resize`, scale);
    });

    if (retracing && tracePoints.length) {
      tracePoints.forEach((point, index) => {
        ctx.beginPath();
        ctx.arc(point[0], point[1], Math.max(3, scale / 260), 0, 2 * Math.PI);
        ctx.fillStyle = '#ffe071';
        ctx.fill();
        ctx.strokeStyle = '#0B0A09';
        ctx.lineWidth = Math.max(1, scale / 1200);
        ctx.stroke();
        const fontSize = Math.max(11, scale / 70);
        ctx.font = `600 ${fontSize}px "Chivo Mono", monospace`;
        ctx.fillStyle = LABEL_FILL;
        ctx.fillText(String(index + 1), point[0] + 8, point[1] - 8);
      });
    }
  }
  ```

- [ ] Find the call site that invokes the dynamic-layer draw (in `renderer/components/viewer.js`,
  wherever the store subscription re-renders the canvases) and update it to pass the new
  `opts` shape:

  ```js
  drawDynamic(dynamicCanvas, study.geometry, {
    editing: state.editing,
    selection: state.selection,
    hover: null,
    tracePoints: [],
    retracing: false,
  });
  ```

- [ ] MANUAL VERIFICATION (after): measure a radiograph, click **Edit landmarks**. All 22
  landmark points switch to their bright per-corner colors (cyan/green/orange/pink) and both
  femoral circles show a green centre dot plus a second dot on the rim at 3 o'clock. Click
  **Done editing** — colors revert to the flat per-level outline colors.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: render 22 landmark and 4 femoral handles on the dynamic layer"
  ```

---

## Task 10: Hover detection

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `nearestLandmark`, `clientToImage` from `renderer/viewer/geometry.js`;
  `hitTestFemoral` from `renderer/viewer/interactions.js`; `drawDynamic` from
  `renderer/viewer/canvas.js`

Hovering (pointermove without an active drag) enlarges the nearest handle and shows its label,
per spec §12 ("Hover enlarges a handle and labels it"). This introduces the local
`hoverSelection` variable and a `hitTestFemoralClient` adapter that converts `hitTestFemoral`'s
pure, coordinate-space-agnostic math into real client-space hit-testing — the same scaling
approach `nearestLandmark` already uses, so hit radius stays a constant 14 CSS pixels
regardless of zoom.

- [ ] MANUAL VERIFICATION (before): enter edit mode, move the pointer over a landmark without
  clicking. Nothing happens — the point stays its normal size with no label.

- [ ] Add imports and module-scope state to `renderer/components/viewer.js`:

  ```js
  import { nearestLandmark, clientToImage } from '../viewer/geometry.js';
  import { hitTestFemoral } from '../viewer/interactions.js';
  import { drawDynamic } from '../viewer/canvas.js';

  let hoverSelection = null;
  let dragging = null;
  ```

- [ ] Add the client-space femoral hit-test adapter, below the imports:

  ```js
  function hitTestFemoralClient(geometry, clientX, clientY, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const circlesInClientSpace = geometry.femoral_circles.map(([cx, cy, r]) => [
      rect.left + cx / scaleX,
      rect.top + cy / scaleX,
      r / scaleX,
    ]);
    return hitTestFemoral(circlesInClientSpace, clientX, clientY, 14);
  }

  function currentStudy() {
    const state = getState();
    return state.studies.find((study) => study.id === state.openId) || null;
  }

  function nearestHandle(geometry, clientX, clientY, canvas) {
    const landmark = nearestLandmark(geometry, clientX, clientY, canvas);
    if (landmark) return { kind: 'landmark', level: landmark.level, corner: landmark.corner };
    return hitTestFemoralClient(geometry, clientX, clientY, canvas);
  }
  ```

- [ ] Add the hover `pointermove` handler on `dynamicCanvas` (inside `mountViewer`, after the
  canvases are created):

  ```js
  dynamicCanvas.addEventListener('pointermove', (event) => {
    const state = getState();
    if (!state.editing || dragging) return;
    const study = currentStudy();
    if (!study || !study.geometry) return;
    const hit = nearestHandle(study.geometry, event.clientX, event.clientY, dynamicCanvas);
    hoverSelection = hit;
    drawDynamic(dynamicCanvas, study.geometry, {
      editing: true,
      selection: state.selection,
      hover: hoverSelection,
      tracePoints: [],
      retracing: false,
    });
  });
  ```

- [ ] MANUAL VERIFICATION (after): in edit mode, hover over `L3 SA` without clicking — the
  point grows and a `L3 SA` label appears next to it. Move away — it shrinks back and the
  label disappears. Hover over a femoral rim dot — it grows and labels itself
  `Left head · resize` (or `Right head · resize`).

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: enlarge and label the hovered handle"
  ```

---

## Task 11: Click-select and drag-move landmarks

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `setLandmarkAt`, `clientToImage` from `renderer/viewer/geometry.js`; `measure`
  from `renderer/api.js`; `debounce` from `renderer/viewer/interactions.js`
- Produces: `recalculateMeasurements`, `scheduleMeasure` (module-scope, used by later tasks)

Pointer capture and the drag lifecycle mirror `renderer.js:203–262` exactly. Every
`pointermove` during a drag mutates `study.geometry` in place and redraws only
`dynamicCanvas` — `staticCanvas` is never touched during a drag. `pointerup` commits through
`setState` and schedules a debounced `/measure` call with the `measureRevision` guard from
`renderer.js:402–420` preserved so a stale response can never overwrite a newer one.

- [ ] MANUAL VERIFICATION (before): in edit mode, click a landmark point. Nothing is selected
  (no white ring), and dragging does nothing.

- [ ] Add the measure round-trip infrastructure to `renderer/components/viewer.js`:

  ```js
  import { measure } from '../api.js';
  import { debounce } from '../viewer/interactions.js';

  let measureRevision = 0;

  async function recalculateMeasurements() {
    const revision = ++measureRevision;
    const state = getState();
    const study = state.studies.find((item) => item.id === state.openId);
    if (!study || !study.geometry) return;
    try {
      const result = await measure({
        vertebrae: study.geometry.vertebrae,
        s1_superior: study.geometry.s1_superior,
        femoral_circles: study.geometry.femoral_circles,
      });
      if (revision !== measureRevision) return;
      setState((current) => ({
        studies: current.studies.map((item) => (
          item.id === current.openId
            ? { ...item, measurements: result.measurements, geometry: result.geometry }
            : item
        )),
      }));
    } catch (error) {
      if (revision === measureRevision) setState({ toast: `Could not update measurements: ${error.message}` });
    }
  }

  const scheduleMeasure = debounce(recalculateMeasurements, 150);
  ```

- [ ] Add the `pointerdown` handler on `dynamicCanvas`:

  ```js
  dynamicCanvas.addEventListener('pointerdown', (event) => {
    const state = getState();
    if (!state.editing) return;
    const study = currentStudy();
    if (!study || !study.geometry) return;
    event.preventDefault();
    dynamicCanvas.setPointerCapture(event.pointerId);
    const hit = nearestHandle(study.geometry, event.clientX, event.clientY, dynamicCanvas);
    if (!hit) return;
    setState({ selection: hit });
    if (hit.kind === 'landmark') {
      dragging = { selection: hit, geometry: study.geometry };
    }
    drawDynamic(dynamicCanvas, study.geometry, {
      editing: true,
      selection: hit,
      hover: hoverSelection,
      tracePoints: [],
      retracing: false,
    });
  });
  ```

- [ ] Extend the existing hover `pointermove` handler (from Task 10) to also drive the drag,
  replacing it with:

  ```js
  dynamicCanvas.addEventListener('pointermove', (event) => {
    const state = getState();
    if (!state.editing) return;
    if (!dragging) {
      const study = currentStudy();
      if (!study || !study.geometry) return;
      hoverSelection = nearestHandle(study.geometry, event.clientX, event.clientY, dynamicCanvas);
      drawDynamic(dynamicCanvas, study.geometry, {
        editing: true,
        selection: state.selection,
        hover: hoverSelection,
        tracePoints: [],
        retracing: false,
      });
      return;
    }
    const point = clientToImage(event, dynamicCanvas);
    const { selection, geometry } = dragging;
    if (selection.kind === 'landmark') {
      setLandmarkAt(geometry, selection.level, selection.corner, point);
    }
    drawDynamic(dynamicCanvas, geometry, {
      editing: true,
      selection,
      hover: null,
      tracePoints: [],
      retracing: false,
    });
  });
  ```

- [ ] Add the `pointerup`/`pointercancel` handlers:

  ```js
  function stopDragging(event) {
    if (!dragging) return;
    dragging = null;
    if (dynamicCanvas.hasPointerCapture(event.pointerId)) dynamicCanvas.releasePointerCapture(event.pointerId);
    setState((state) => ({
      studies: state.studies.map((item) => (item.id === state.openId ? { ...item } : item)),
    }));
    scheduleMeasure();
  }
  dynamicCanvas.addEventListener('pointerup', stopDragging);
  dynamicCanvas.addEventListener('pointercancel', stopDragging);
  ```

- [ ] MANUAL VERIFICATION (after): in edit mode, click `L2 IP` — it gets a white/accent
  selection ring and its label stays visible. Drag it to a new position — it follows the
  pointer smoothly and the vertebra outline updates live; the radiograph image never flickers
  or redraws during the drag. Release the pointer — after roughly 150ms the status/toast area
  (or measurement panel, once wired) reflects an updated value. Open DevTools Network/console
  and confirm only one `/measure` call fires even when dragging quickly back and forth before
  releasing.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: click-select and drag-move landmarks with debounced re-measure"
  ```

---

## Task 12: Femoral centre drag (translate)

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `clientToImage` (already imported in Task 10)

Extends the `pointerdown`/`pointermove` handlers from Task 11 so a femoral centre handle can
be dragged to translate the whole circle.

- [ ] MANUAL VERIFICATION (before): in edit mode, drag a femoral centre dot. It selects on
  click but does not follow the pointer.

- [ ] In the `pointerdown` handler, change the `if (hit.kind === 'landmark')` block to also
  start a drag for femoral hits:

  ```js
  if (hit.kind === 'landmark' || hit.kind === 'femoral') {
    dragging = { selection: hit, geometry: study.geometry };
  }
  ```

- [ ] In the `pointermove` handler, extend the drag branch to move a femoral centre:

  ```js
  if (selection.kind === 'landmark') {
    setLandmarkAt(geometry, selection.level, selection.corner, point);
  } else if (selection.part === 'center') {
    const index = selection.side === 'left' ? 0 : 1;
    geometry.femoral_circles[index][0] = point[0];
    geometry.femoral_circles[index][1] = point[1];
  }
  ```

- [ ] MANUAL VERIFICATION (after): drag the left femoral centre dot — the whole circle
  translates with the pointer, the rim handle moves with it, and the radius stays constant.
  Release — the measurement panel updates after the debounce.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: drag femoral centre handles to translate the circle"
  ```

---

## Task 13: Femoral rim drag (resize)

**Files:** `renderer/components/viewer.js`

Extends the same `pointermove` drag branch so dragging the rim handle resizes the circle —
the radius tracks the pointer's distance from the (unchanged) centre, so the user can grab
anywhere near the visible circumference, not just the single rendered rim dot.

- [ ] MANUAL VERIFICATION (before): drag a femoral rim dot. It selects but the circle does not
  resize.

- [ ] In the `pointermove` handler, extend the drag branch once more:

  ```js
  if (selection.kind === 'landmark') {
    setLandmarkAt(geometry, selection.level, selection.corner, point);
  } else if (selection.part === 'center') {
    const index = selection.side === 'left' ? 0 : 1;
    geometry.femoral_circles[index][0] = point[0];
    geometry.femoral_circles[index][1] = point[1];
  } else {
    const index = selection.side === 'left' ? 0 : 1;
    const [cx, cy] = geometry.femoral_circles[index];
    geometry.femoral_circles[index][2] = Math.hypot(point[0] - cx, point[1] - cy);
  }
  ```

- [ ] MANUAL VERIFICATION (after): drag the right femoral rim dot outward — the circle grows,
  tracking the pointer's distance from the centre; drag it back inward past the centre and
  confirm the radius shrinks smoothly rather than going negative or flipping. Release — the
  measurement panel updates after the debounce.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: drag femoral rim handles to resize the circle"
  ```

---

## Task 14: Retrace mode

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `fitCircle` from `renderer/viewer/geometry.js` (ported in plan 03 from
  `renderer.js:597` — consumed here, not reimplemented)

Adds a `Retrace` toolbar button (enabled only when a femoral handle is selected) and a `Fit`
button (enabled once at least 3 arc points are placed). Clicking the canvas while retracing
places arc points instead of dragging; `Fit` calls `fitCircle` and applies the result to the
selected side's circle.

- [ ] MANUAL VERIFICATION (before): select a femoral handle. There is no way to place arc
  points as an alternative to dragging.

- [ ] Add local state and the two buttons to `mountViewer`, near the edit toggle from Task 8:

  ```js
  import { fitCircle } from '../viewer/geometry.js';

  let retracing = false;
  let tracePoints = [];
  ```

  ```js
  const retraceButton = el('button', {
    class: 'icon-button',
    type: 'button',
    disabled: true,
    onClick: () => {
      const state = getState();
      if (!state.selection || state.selection.kind !== 'femoral') return;
      retracing = !retracing;
      tracePoints = [];
      updateRetraceUI();
      const study = currentStudy();
      if (study) redrawDynamicWithLocalState(study.geometry);
    },
  }, 'Retrace');

  const fitButton = el('button', {
    class: 'icon-button',
    type: 'button',
    disabled: true,
    onClick: () => {
      const fitted = fitCircle(tracePoints);
      if (!fitted) return;
      const state = getState();
      const study = currentStudy();
      if (!study || !state.selection || state.selection.kind !== 'femoral') return;
      const index = state.selection.side === 'left' ? 0 : 1;
      study.geometry.femoral_circles[index] = fitted;
      retracing = false;
      tracePoints = [];
      updateRetraceUI();
      setState((current) => ({
        studies: current.studies.map((item) => (item.id === current.openId ? { ...item } : item)),
      }));
      scheduleMeasure();
      redrawDynamicWithLocalState(study.geometry);
    },
  }, 'Fit');

  toolbar.appendChild(retraceButton);
  toolbar.appendChild(fitButton);

  function redrawDynamicWithLocalState(geometry) {
    const state = getState();
    drawDynamic(dynamicCanvas, geometry, {
      editing: true,
      selection: state.selection,
      hover: hoverSelection,
      tracePoints,
      retracing,
    });
  }

  function updateRetraceUI() {
    const state = getState();
    retraceButton.disabled = !state.selection || state.selection.kind !== 'femoral';
    retraceButton.classList.toggle('active', retracing);
    fitButton.disabled = !retracing || tracePoints.length < 3;
  }

  subscribe(() => updateRetraceUI());
  ```

- [ ] Add the retrace-mode branch to the `pointerdown` handler, as the first check inside the
  `if (!study || !study.geometry) return;` guard:

  ```js
  if (retracing) {
    const point = clientToImage(event, dynamicCanvas);
    tracePoints.push(point);
    updateRetraceUI();
    redrawDynamicWithLocalState(study.geometry);
    return;
  }
  ```

- [ ] MANUAL VERIFICATION (after): select the left femoral head, click **Retrace** (it
  highlights as active). Click 4 points along the visible head contour on the canvas — each
  click drops a small numbered dot and does not start a drag. Once 3+ points are placed, **Fit**
  becomes enabled; click it — the left circle re-fits to the traced points, `Retrace` turns off,
  the trace dots disappear, and the measurement panel updates after the debounce. Click
  **Retrace** again and place only 2 points — **Fit** stays disabled.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add retrace mode for femoral head refitting"
  ```

---

## Task 15: Tab / Shift+Tab cycling

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `nextSelection` from `renderer/viewer/interactions.js` (Task 2)

Extends the `keydown` listener from Task 8.

- [ ] MANUAL VERIFICATION (before): in edit mode, press `Tab`. Focus moves to the next
  focusable DOM element (browser default); no landmark gets selected.

- [ ] Add the import and extend the listener in `renderer/components/viewer.js`:

  ```js
  import { nextSelection } from '../viewer/interactions.js';
  ```

  Insert this branch into the existing `keydown` listener from Task 8, after the `Escape`
  branch:

  ```js
  if (event.key === 'Tab') {
    event.preventDefault();
    const next = nextSelection(state.selection, event.shiftKey ? -1 : 1);
    setState({ selection: next });
    const study = currentStudy();
    if (study) {
      drawDynamic(dynamicCanvas, study.geometry, {
        editing: true,
        selection: next,
        hover: hoverSelection,
        tracePoints,
        retracing,
      });
    }
  }
  ```

- [ ] MANUAL VERIFICATION (after): in edit mode with nothing selected, press `Tab` — `L1 SA`
  becomes selected (ring + label visible). Keep pressing `Tab` 21 more times — selection
  advances through every landmark corner in order, then the left femoral centre, then the
  right femoral centre, then wraps back to `L1 SA`. Press `Shift+Tab` from `L1 SA` — selection
  jumps to the right femoral centre.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: wire Tab/Shift+Tab landmark cycling"
  ```

---

## Task 16: Arrow-key nudge

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `nudge`, `arrowKeyDelta` from `renderer/viewer/interactions.js` (Tasks 3, 4, 6)

Extends the `keydown` listener once more.

- [ ] MANUAL VERIFICATION (before): select a landmark via Tab, press an arrow key. Nothing
  moves.

- [ ] Add the import and extend the listener:

  ```js
  import { nudge, arrowKeyDelta } from '../viewer/interactions.js';
  ```

  Insert this branch after the `Tab` branch added in Task 15:

  ```js
  const delta = arrowKeyDelta(event.key, event.shiftKey);
  if (delta && state.selection) {
    event.preventDefault();
    const study = currentStudy();
    if (!study || !study.geometry) return;
    nudge(study.geometry, state.selection, delta.dx, delta.dy);
    setState((current) => ({
      studies: current.studies.map((item) => (item.id === current.openId ? { ...item } : item)),
    }));
    scheduleMeasure();
    drawDynamic(dynamicCanvas, study.geometry, {
      editing: true,
      selection: state.selection,
      hover: hoverSelection,
      tracePoints,
      retracing,
    });
  }
  ```

- [ ] MANUAL VERIFICATION (after): select `L3 SA` via Tab. Press `ArrowRight` 10 times — the
  point visibly steps right by small increments and the vertebra outline follows. Press
  `Shift+ArrowLeft` once — it jumps back noticeably further than a single unshifted press.
  After the last nudge, wait ~150ms and confirm the measurement panel value changes once (not
  once per keypress — open DevTools Network and confirm only one `/measure` call fires for a
  burst of nudges made within 150ms of each other).

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: wire arrow-key nudging with shift for 10px steps"
  ```

---

## Task 17: Reset to prediction

**Files:** `renderer/components/viewer.js`

**Interfaces:**
- Consumes: `getState`, `subscribe` from `renderer/store.js`

Tracks the first geometry seen for each newly-opened study (the raw `/predict` output, before
any correction) via a store subscription — this makes no assumption about how plan 03's
predict flow is wired, only that it eventually appears in `getState().studies`. Adds the
**Reset to prediction** button.

- [ ] MANUAL VERIFICATION (before): drag a landmark away from its predicted position. There is
  no button to restore it.

- [ ] Add the tracking subscription to `renderer/components/viewer.js`, near the top of
  `mountViewer` or at module scope:

  ```js
  let predictedGeometry = null;
  let trackedStudyId = null;

  subscribe((state) => {
    const study = state.studies.find((item) => item.id === state.openId);
    if (!study) {
      trackedStudyId = null;
      return;
    }
    if (study.id !== trackedStudyId && study.geometry) {
      trackedStudyId = study.id;
      predictedGeometry = JSON.parse(JSON.stringify(study.geometry));
    }
  });
  ```

- [ ] Add the reset button to the toolbar, near the edit toggle:

  ```js
  const resetButton = el('button', {
    class: 'icon-button',
    type: 'button',
    onClick: () => {
      const state = getState();
      const study = state.studies.find((item) => item.id === state.openId);
      if (!study || !predictedGeometry) return;
      study.geometry = JSON.parse(JSON.stringify(predictedGeometry));
      setState((current) => ({
        studies: current.studies.map((item) => (item.id === current.openId ? { ...item } : item)),
        selection: null,
      }));
      scheduleMeasure();
      drawDynamic(dynamicCanvas, study.geometry, {
        editing: state.editing,
        selection: null,
        hover: null,
        tracePoints: [],
        retracing: false,
      });
    },
  }, 'Reset to prediction');
  toolbar.appendChild(resetButton);
  ```

- [ ] MANUAL VERIFICATION (after): measure a radiograph, note the lumbar lordosis value. Enter
  edit mode, drag several landmarks and both femoral heads noticeably. Click **Reset to
  prediction** — every point snaps back to its original position, the selection clears, and
  after the debounce the measurement values match what they were immediately after the initial
  measure.

- [ ] Commit:

  ```
  git add -A && git commit -m "feat: add Reset to prediction"
  ```

---

## Task 18: Delete the old button-matrix editor

**Files:** `renderer/components/viewer.js`, `styles/screens/analysis.css`

The direct-manipulation system built in Tasks 8–17 fully replaces the tool/level/corner button
grid and the trace-summary panel that plan 03 ported forward from `index.html:128–157` and
`renderer.js:139–195` to reach feature parity. This task removes that matrix.

- [ ] Run a search to confirm what is still present:

  ```
  grep -rn "data-tool\|data-level\|data-corner\|tool-grid\|level-grid\|corner-grid\|annotation-panel\|trace-side\|trace-count\|fit-circle\|undo-trace\|clear-trace\|use-predicted-circle\|reset-annotation" renderer/ styles/
  ```

  Confirm this returns matches in `renderer/components/viewer.js` and
  `styles/screens/analysis.css` — this is the verify-fail step; the old matrix is still there.

- [ ] In `renderer/components/viewer.js`, delete every block the grep above surfaced: the
  tool-grid (Spine/Pan/Left head/Right head) buttons and their click handlers, the level-grid
  (L1–L5, S1) buttons and handlers, the corner-grid (SA/SP/IA/IP) buttons and handlers, the
  trace-summary/trace-count/undo-trace/clear-trace/use-predicted-circle elements and handlers,
  and the standalone "Pan" tool (panning stays available only via the toolbar's existing pan
  toggle and middle-drag, per spec §12's closing line — do not remove that). Delete the
  `activeTool`/`activeLevel`/`activeCorner` local variables these blocks used, since selection
  is now entirely `state.selection`-driven.

- [ ] In `styles/screens/analysis.css`, delete the rules whose selectors match `.tool-grid`,
  `.level-grid`, `.corner-grid`, `.trace-actions`, `.trace-summary`, `.annotation-panel`,
  `.editor-section`, `.editor-label`, `.editor-hint`, `.editor-footer`, and
  `#reset-annotation` (`#reset-annotation` specifically — the new `Reset to prediction` button
  from Task 17 is a plain `.icon-button` in the toolbar and does not use this id or its rule).

- [ ] Re-run the search from the first step and confirm it now returns no matches in
  `renderer/` or `styles/`:

  ```
  grep -rn "data-tool\|data-level\|data-corner\|tool-grid\|level-grid\|corner-grid\|annotation-panel\|trace-side\|trace-count\|fit-circle\|undo-trace\|clear-trace\|use-predicted-circle\|reset-annotation" renderer/ styles/
  ```

- [ ] MANUAL VERIFICATION: launch the app, measure a radiograph, enter edit mode. There is no
  Spine/Pan/Left head/Right head button row, no level or corner grid, and no separate trace
  panel — only the toolbar (zoom, pan, overlay, Edit landmarks, Retrace, Fit,
  Reset to prediction) and the canvas handles from Tasks 8–17. Every interaction verified in
  those tasks still works unchanged.

- [ ] Commit:

  ```
  git add -A && git commit -m "refactor: remove the button-matrix landmark editor"
  ```

---

## Task 19: End-to-end manual verification

**Files:** none (verification only)

Full pass across the feature, matching spec §12 and §15's manual-testing scope for landmark
editing.

- [ ] Run the full automated suite and confirm everything passes:

  ```
  node --test test/interactions.test.js
  ```

- [ ] Launch the app (`npm start`) and, against a real radiograph, walk through:
  1. Measure the radiograph. Confirm the toolbar shows **Edit landmarks**, **Retrace**
     (disabled), **Fit** (disabled), and **Reset to prediction**.
  2. Click **Edit landmarks**. Confirm all 22 landmark handles and both femoral circles (with
     centre + rim handles) are visible in their bright per-corner/femoral colors.
  3. Hover several handles — each enlarges and labels itself (e.g. `L4 SA`, `Left head`,
     `Right head · resize`).
  4. Click `L2 SP`, drag it a visible distance, release. Confirm it stays selected, the
     vertebra outline follows, and the measurement panel updates roughly 150ms after release.
  5. Press `Tab` repeatedly from `L2 SP` through all 22 landmark corners in anatomical order,
     then to the left femoral centre, then the right femoral centre, then wraps to `L1 SA`.
     Press `Shift+Tab` once to confirm it steps backward correctly.
  6. With a landmark selected, press `ArrowRight` five times, then `Shift+ArrowUp` once.
     Confirm small then large movements, and confirm measurements update once, not per
     keypress.
  7. Select the left femoral centre, drag it — the whole circle translates. Select its rim,
     drag it — the circle resizes from the fixed centre.
  8. Select the right femoral head, click **Retrace**, place 4 arc points along the head
     contour, click **Fit**. Confirm the circle re-fits and **Retrace** turns off automatically.
  9. Click **Reset to prediction**. Confirm every landmark and both femoral circles return to
     their original post-`/predict` positions and the measurement values match what they were
     right after the initial measure.
  10. Press `Escape`. Confirm edit mode exits, the toolbar reverts to **Edit landmarks**, and
      no handles remain interactive until it is re-entered.

- [ ] Confirm no console errors appeared in DevTools throughout the pass.

- [ ] This task produces no code changes; do not commit unless a defect found during
  verification required a fix in an earlier task's files, in which case commit that fix with
  `fix: <description>` before proceeding.
