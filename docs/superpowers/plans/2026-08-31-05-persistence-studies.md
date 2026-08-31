# Persistence and Studies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local persistence for measured studies and build the full Studies screen, so a radiograph measured in this app is still there — with its measurements, thumbnail, and derived status — after the app is closed and reopened.

**Architecture:** Two pure, dependency-free renderer modules — `renderer/data/status.js` (status derivation) and `renderer/data/persistence.js` (ids, shape validation, demo/real merge) — are consumed by a new fixture module (`renderer/data/demo-studies.js`, the nine fabricated studies) and a full `renderer/screens/studies.js`. Disk I/O is isolated in a root-level `store-io.js` (atomic write, corrupt-store recovery) that only `main.js`'s two new IPC handlers touch, so every module the browser loads via `<script type="module">` stays free of Node built-ins the browser cannot resolve. Status is computed from `measurements`/`qc` on every read — it is never stored as a field.

**Tech Stack:** Vanilla ES modules throughout (main process and renderer), `node --test` for the four pure-logic modules, Electron's `ipcMain.handle`/`contextBridge`, Canvas/Blob APIs for thumbnail generation.

**Dependency note:** This plan assumes plan 02 (Foundation) set `package.json`'s `"type"` to `"module"` and converted `main.js`/`preload.js` to ES module syntax (`import`/`export`) — this is the only way plan 07's test files can `import` directly from `renderer/data/*.js`, which is the convention this plan follows too. If `main.js`/`preload.js` are still CommonJS when this plan is executed, translate every `import`/`export` line touching those two files to the equivalent `require()`/`module.exports` — the IPC channel names, handler bodies, and behavior below are normative; the module syntax is not. This plan also extends `renderer/main.js` (bootstrap) and `renderer/router.js` (screen switching) created by plan 02, and assumes `renderer/screens/*.js` modules export `render(state) → HTMLElement`, called by the router and mounted via `renderer/dom.js`'s `mount(node, child)` — adapt the call site if the real convention differs; the rendering behavior specified per task is normative. Where `el(tag, props, ...children)` is called with a plain string child, this plan assumes `el`/`mount` append strings as text nodes, matching how `Node.append()` behaves natively.

## Global Constraints

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

## Task 1 — `renderer/data/status.js`: status derivation

**Files:** `renderer/data/status.js` (new), `test/status.test.js` (new)

**Interfaces:**
- Consumes: nothing — pure logic, no imports.
- Produces: `RESIDUAL_LIMIT`, `CONFIDENCE_LIMIT`, `deriveStatus(study)`, `statusLabel(status)`, exactly per the architecture contract's `renderer/data/status.js` section.

- [ ] Write the failing test file.

  Create `test/status.test.js`:

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { RESIDUAL_LIMIT, CONFIDENCE_LIMIT, deriveStatus, statusLabel } from '../renderer/data/status.js';

  test('RESIDUAL_LIMIT is 1.0 degrees and CONFIDENCE_LIMIT is 0.6', () => {
    assert.equal(RESIDUAL_LIMIT, 1.0);
    assert.equal(CONFIDENCE_LIMIT, 0.6);
  });

  test('deriveStatus returns proc when the study itself is null or undefined', () => {
    assert.equal(deriveStatus(null), 'proc');
    assert.equal(deriveStatus(undefined), 'proc');
  });

  test('deriveStatus returns proc when measurements is null', () => {
    const study = { measurements: null, qc: null };
    assert.equal(deriveStatus(study), 'proc');
  });

  test('deriveStatus returns seg when residual and confidence both pass', () => {
    const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.9 } } };
    assert.equal(deriveStatus(study), 'seg');
  });

  test('deriveStatus returns rev when the residual exceeds the limit', () => {
    // |PI - (PT + SS)| = |50 - 48| = 2
    const study = { measurements: { PI: 50, PT: 20, SS: 28 }, qc: { femoral: { confidence: 0.9 } } };
    assert.equal(deriveStatus(study), 'rev');
  });

  test('deriveStatus returns rev when confidence is below the limit', () => {
    const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.5 } } };
    assert.equal(deriveStatus(study), 'rev');
  });

  test('deriveStatus returns rev when both the residual and confidence fail', () => {
    const study = { measurements: { PI: 50, PT: 20, SS: 28 }, qc: { femoral: { confidence: 0.1 } } };
    assert.equal(deriveStatus(study), 'rev');
  });

  test('a residual of exactly 1.0 is inclusive-pass (seg, not rev)', () => {
    // |51 - (20 + 30)| = 1.0 exactly
    const study = { measurements: { PI: 51, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.9 } } };
    assert.equal(deriveStatus(study), 'seg');
  });

  test('a confidence of exactly 0.6 is inclusive-pass (seg, not rev)', () => {
    const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.6 } } };
    assert.equal(deriveStatus(study), 'seg');
  });

  test('a residual of 1.01 fails (rev)', () => {
    const study = { measurements: { PI: 51.01, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.9 } } };
    assert.equal(deriveStatus(study), 'rev');
  });

  test('a confidence of 0.59 fails (rev)', () => {
    const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.59 } } };
    assert.equal(deriveStatus(study), 'rev');
  });

  test('missing qc entirely does not by itself force rev', () => {
    const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: null };
    assert.equal(deriveStatus(study), 'seg');
  });

  test('missing qc.femoral does not by itself force rev', () => {
    const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: {} };
    assert.equal(deriveStatus(study), 'seg');
  });

  test('statusLabel maps every status to its display label', () => {
    assert.equal(statusLabel('seg'), 'Segmented');
    assert.equal(statusLabel('rev'), 'Needs review');
    assert.equal(statusLabel('proc'), 'Processing');
  });
  ```

- [ ] Verify the test fails because the module does not exist yet.

  Run:

  ```
  node --test test/status.test.js
  ```

  Expected: fails immediately with `Cannot find module '../renderer/data/status.js'` (or `ERR_MODULE_NOT_FOUND`), zero tests executed.

- [ ] Implement `renderer/data/status.js`.

  Create `renderer/data/status.js`:

  ```js
  /**
   * Status derivation (spec 13.1, architecture contract "renderer/data/status.js").
   * Status is never stored on a Study — it is computed from measurements and qc
   * every time it is needed. Pure function, no dependencies.
   */

  export const RESIDUAL_LIMIT = 1.0; // degrees
  export const CONFIDENCE_LIMIT = 0.6;

  /**
   * @param {object|null} study a Study record
   * @returns {'seg'|'rev'|'proc'}
   */
  export function deriveStatus(study) {
    if (!study || study.measurements == null) return 'proc';

    const { PI, PT, SS } = study.measurements;
    const residual = Math.abs(PI - (PT + SS));
    const confidence = study.qc && study.qc.femoral ? study.qc.femoral.confidence : null;

    if (residual > RESIDUAL_LIMIT) return 'rev';
    if (confidence != null && confidence < CONFIDENCE_LIMIT) return 'rev';
    return 'seg';
  }

  /**
   * @param {'seg'|'rev'|'proc'} status
   * @returns {string} display label
   */
  export function statusLabel(status) {
    if (status === 'seg') return 'Segmented';
    if (status === 'rev') return 'Needs review';
    return 'Processing';
  }
  ```

- [ ] Verify the tests pass.

  Run:

  ```
  node --test test/status.test.js
  ```

  Expected: all 13 tests pass, 0 failures, exit code 0.

- [ ] Commit.

  ```
  git add renderer/data/status.js test/status.test.js
  git commit -m "feat: add status derivation (data/status.js)"
  ```

---

## Task 2 — `renderer/data/demo-studies.js`: the nine fabricated studies

**Files:** `renderer/data/demo-studies.js` (new), `test/demo-studies.test.js` (new)

**Interfaces:**
- Consumes: nothing at runtime. Its test imports `deriveStatus` from `renderer/data/status.js` (Task 1) to cross-check derived status.
- Produces: `DEMO_STUDIES` — an array of exactly nine `Study` objects, `source: 'demo'`, `filePath: null`, ids `SP-0030`–`SP-0042`, never written to disk.

This data is transcribed from the `STUDIES` array in `design-reference/template.html` (around line 655). That array's `p:[a,b,c,d,e]` field maps `a → LL(L1-S1)`, `b → PI`, `c → PT`, `d → SS`, with `e` being the design's own precomputed `PI-LL` (used here only to cross-check the transcription, not stored). Every study gets real `PI`/`PT`/`SS`/`LL['L1-S1']` values so that `PI = PT + SS` holds for all nine (verified below) — none are left unmeasured, which also keeps this fixture consistent with plan 07's `similarity.test.js`, which independently fixtures the same nine ids with the same four numbers and expects every one of them to be rankable. `L1PA` and lumbar-lordosis levels `L2-S1`–`L5-S1` are not in the source design data, so they are omitted entirely (not present as keys) rather than fabricated — consuming code must treat a missing key as absent, rendering `—`, never `0`.

Because every demo study's `PI`/`PT`/`SS` residual is ~0 and every demo study's confidence (`qc.femoral.confidence`, transcribed from the design's `conf` field ÷ 100) is ≥ 0.6, `deriveStatus()` (Task 1) resolves all nine to `'seg'`. The source mockup labelled two rows `rev` and two `proc`, but those labels were the mockup author's arbitrary per-row choice with no underlying formula — under this app's real, threshold-based derivation (architecture contract §13.1, "status is derived, never stored"), reproducing them would mean inventing a lower confidence number than the design actually specifies, which is exactly the kind of fabrication the global constraints forbid. All nine demo studies are `Segmented`.

- [ ] Write the failing test file.

  Create `test/demo-studies.test.js`:

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { DEMO_STUDIES } from '../renderer/data/demo-studies.js';
  import { deriveStatus } from '../renderer/data/status.js';

  test('DEMO_STUDIES has exactly nine studies with unique ids in SP-0030..SP-0042', () => {
    assert.equal(DEMO_STUDIES.length, 9);
    const ids = DEMO_STUDIES.map((s) => s.id);
    assert.equal(new Set(ids).size, 9);
    for (const id of ids) {
      const match = /^SP-(\d{4})$/.exec(id);
      assert.ok(match, `${id} does not match the SP-#### id format`);
      const n = Number(match[1]);
      assert.ok(n >= 30 && n <= 42, `${id} is outside the demo id range SP-0030..SP-0042`);
    }
  });

  test('every demo study has source "demo" and a null filePath', () => {
    for (const study of DEMO_STUDIES) {
      assert.equal(study.source, 'demo');
      assert.equal(study.filePath, null);
    }
  });

  test('every demo study omits L1PA (renders as an em dash)', () => {
    for (const study of DEMO_STUDIES) {
      assert.equal('L1PA' in study.measurements, false, `${study.id} should have no L1PA key`);
    }
  });

  test('every demo study omits lumbar lordosis levels L2-S1..L5-S1', () => {
    for (const study of DEMO_STUDIES) {
      assert.equal('L1-S1' in study.measurements.LL, true, `${study.id} should have LL[L1-S1]`);
      for (const level of ['L2-S1', 'L3-S1', 'L4-S1', 'L5-S1']) {
        assert.equal(level in study.measurements.LL, false, `${study.id} should have no LL[${level}]`);
      }
    }
  });

  test('every demo study satisfies PI = PT + SS within 0.1 degrees', () => {
    for (const study of DEMO_STUDIES) {
      const { PI, PT, SS } = study.measurements;
      const residual = Math.abs(PI - (PT + SS));
      assert.ok(residual <= 0.1, `${study.id} has a PI/PT/SS residual of ${residual}, expected <= 0.1`);
    }
  });

  test('every demo study carries a femoral qc confidence between 0 and 1', () => {
    for (const study of DEMO_STUDIES) {
      const confidence = study.qc && study.qc.femoral && study.qc.femoral.confidence;
      assert.equal(typeof confidence, 'number', `${study.id} should have qc.femoral.confidence`);
      assert.ok(confidence > 0 && confidence <= 1, `${study.id} confidence ${confidence} is out of range`);
    }
  });

  test('every demo study derives to Segmented status', () => {
    for (const study of DEMO_STUDIES) {
      assert.equal(deriveStatus(study), 'seg', `${study.id} should derive to seg`);
    }
  });

  test('demo studies carry the extra display fields real studies leave absent', () => {
    for (const study of DEMO_STUDIES) {
      assert.equal(typeof study.pt, 'string');
      assert.equal(typeof study.sex, 'string');
      assert.equal(typeof study.age, 'number');
      assert.equal(typeof study.dx, 'string');
      assert.equal(typeof study.conf, 'number');
    }
  });
  ```

- [ ] Verify the test fails because the module does not exist yet.

  Run:

  ```
  node --test test/demo-studies.test.js
  ```

  Expected: fails immediately with `Cannot find module '../renderer/data/demo-studies.js'` (or `ERR_MODULE_NOT_FOUND`), zero tests executed.

- [ ] Implement `renderer/data/demo-studies.js`.

  Create `renderer/data/demo-studies.js`:

  ```js
  /**
   * The nine fabricated demo studies (spec 5, 13.1; architecture contract
   * "renderer/data/demo-studies.js"). Compiled in, never written to disk.
   * Transcribed from the STUDIES array in design-reference/template.html
   * (~line 655): p:[a,b,c,d,e] -> a=LL(L1-S1), b=PI, c=PT, d=SS, e=PI-LL
   * (kept here only as a comment for verification, not stored).
   *
   * L1PA and lumbar-lordosis levels L2-S1..L5-S1 have no source data, so
   * they are omitted (not present as keys) rather than invented. Consumers
   * must render a missing key as "-", never 0.
   */

  export const DEMO_STUDIES = [
    {
      id: 'SP-0042', source: 'demo', filePath: null, fileName: 'SP-0042.jpg',
      addedAt: '2026-08-21T14:00:00.000Z', view: 'Standing lateral', thumbnail: null,
      // p=[48.2,54.1,18.3,35.8,5.9] -> PT+SS=54.1=PI, PI-LL=5.9
      measurements: { PI: 54.1, PT: 18.3, SS: 35.8, LL: { 'L1-S1': 48.2 } },
      geometry: null,
      qc: { femoral: { method: 'contour-fit', component_count: 2, circle_union_iou: 0.91, radii_pixels: [41, 42], center_separation_pixels: 112, radius_ratio: 0.97, confidence: 0.96, qc_pass: true, foreground_pixels: 15400 } },
      clinical: {},
      pt: 'P-8841', sex: 'F', age: 62, bmi: '27.4', odi: '46',
      dx: 'Anterior slip of L4 on L5 \u00b7 Meyerding grade I', plan: 'Pending review', hx: 'L3 laminectomy, 2019',
      outcome: 'Awaiting operative decision. Baseline ODI 46.', conf: 96,
    },
    {
      id: 'SP-0041', source: 'demo', filePath: null, fileName: 'SP-0041.jpg',
      addedAt: '2026-08-21T09:00:00.000Z', view: 'Flexion lateral', thumbnail: null,
      // p=[31.7,48.9,22.6,26.3,17.2] -> PT+SS=48.9=PI, PI-LL=17.2
      measurements: { PI: 48.9, PT: 22.6, SS: 26.3, LL: { 'L1-S1': 31.7 } },
      geometry: null,
      qc: { femoral: { method: 'contour-fit', component_count: 2, circle_union_iou: 0.85, radii_pixels: [39, 41], center_separation_pixels: 108, radius_ratio: 0.95, confidence: 0.88, qc_pass: true, foreground_pixels: 14800 } },
      clinical: {},
      pt: 'P-3306', sex: 'M', age: 57, bmi: '31.2', odi: '52',
      dx: 'Flatback with compensatory pelvic retroversion', plan: 'Deformity clinic referral', hx: 'None',
      outcome: 'Referred for deformity workup. ODI 52 at intake.', conf: 88,
    },
    {
      id: 'SP-0039', source: 'demo', filePath: null, fileName: 'SP-0039.jpg',
      addedAt: '2026-08-20T12:00:00.000Z', view: 'Standing lateral', thumbnail: null,
      // p=[52.4,49.8,12.1,37.7,-2.6] -> PT+SS=49.8=PI, PI-LL=-2.6
      measurements: { PI: 49.8, PT: 12.1, SS: 37.7, LL: { 'L1-S1': 52.4 } },
      geometry: null,
      qc: { femoral: { method: 'contour-fit', component_count: 2, circle_union_iou: 0.93, radii_pixels: [40, 40], center_separation_pixels: 104, radius_ratio: 0.99, confidence: 0.97, qc_pass: true, foreground_pixels: 15900 } },
      clinical: {},
      pt: 'P-7712', sex: 'F', age: 15, bmi: '20.8', odi: '51',
      dx: 'Adolescent idiopathic scoliosis, Lenke 1A', plan: 'L4\u2013L5 TLIF', hx: 'None',
      outcome: 'L4\u2013L5 TLIF, posterior instrumentation. ODI 51\u219222 at 6 mo.', conf: 97,
    },
    {
      id: 'SP-0038', source: 'demo', filePath: null, fileName: 'SP-0038.jpg',
      addedAt: '2026-08-19T12:00:00.000Z', view: 'Extension lateral', thumbnail: null,
      // p=[24.9,52.3,29.8,22.5,27.4] -> PT+SS=52.3=PI, PI-LL=27.4
      measurements: { PI: 52.3, PT: 29.8, SS: 22.5, LL: { 'L1-S1': 24.9 } },
      geometry: null,
      qc: { femoral: { method: 'contour-fit', component_count: 2, circle_union_iou: 0.89, radii_pixels: [41, 43], center_separation_pixels: 115, radius_ratio: 0.96, confidence: 0.92, qc_pass: true, foreground_pixels: 15000 } },
      clinical: {},
      pt: 'P-1054', sex: 'M', age: 71, bmi: '29.6', odi: '58',
      dx: 'Adjacent segment degeneration above prior L5\u2013S1 fusion', plan: 'Extension of construct under discussion', hx: 'L5\u2013S1 PLIF, 2016',
      outcome: 'Construct extension under discussion. ODI 58.', conf: 92,
    },
    {
      id: 'SP-0036', source: 'demo', filePath: null, fileName: 'SP-0036.jpg',
      addedAt: '2026-08-18T12:00:00.000Z', view: 'Standing lateral', thumbnail: null,
      // p=[44.7,55.6,21.4,34.2,10.9] -> PT+SS=55.6=PI, PI-LL=10.9
      measurements: { PI: 55.6, PT: 21.4, SS: 34.2, LL: { 'L1-S1': 44.7 } },
      geometry: null,
      qc: { femoral: { method: 'contour-fit', component_count: 2, circle_union_iou: 0.90, radii_pixels: [42, 42], center_separation_pixels: 110, radius_ratio: 0.98, confidence: 0.94, qc_pass: true, foreground_pixels: 15600 } },
      clinical: {},
      pt: 'P-6420', sex: 'F', age: 44, bmi: '24.1', odi: '42',
      dx: 'Facet arthropathy L4\u2013L5', plan: 'PT + facet injections', hx: 'None',
      outcome: 'Conservative: PT + L4\u2013L5 facet injections. ODI 42\u219218 at 12 mo.', conf: 94,
    },
    {
      id: 'SP-0035', source: 'demo', filePath: null, fileName: 'SP-0035.jpg',
      addedAt: '2026-08-17T12:00:00.000Z', view: 'Lateral lumbar', thumbnail: null,
      // p=[27.9,46.2,25.1,21.1,18.3] -> PT+SS=46.2=PI, PI-LL=18.3
      measurements: { PI: 46.2, PT: 25.1, SS: 21.1, LL: { 'L1-S1': 27.9 } },
      geometry: null,
      qc: { femoral: { method: 'contour-fit', component_count: 2, circle_union_iou: 0.82, radii_pixels: [38, 40], center_separation_pixels: 106, radius_ratio: 0.93, confidence: 0.82, qc_pass: true, foreground_pixels: 14200 } },
      clinical: {},
      pt: 'P-9013', sex: 'M', age: 66, bmi: '28.3', odi: '49',
      dx: 'Multilevel degenerative disc disease', plan: 'Repeat imaging in 3 mo', hx: 'None',
      outcome: 'Conservative management, repeat imaging at 3 mo. ODI 49.', conf: 82,
    },
    {
      id: 'SP-0033', source: 'demo', filePath: null, fileName: 'SP-0033.jpg',
      addedAt: '2026-08-15T12:00:00.000Z', view: 'Standing lateral', thumbnail: null,
      // p=[44.1,53.0,19.7,33.3,8.9] -> PT+SS=53.0=PI, PI-LL=8.9
      measurements: { PI: 53.0, PT: 19.7, SS: 33.3, LL: { 'L1-S1': 44.1 } },
      geometry: null,
      qc: { femoral: { method: 'contour-fit', component_count: 2, circle_union_iou: 0.92, radii_pixels: [41, 41], center_separation_pixels: 109, radius_ratio: 0.98, confidence: 0.93, qc_pass: true, foreground_pixels: 15500 } },
      clinical: {},
      pt: 'P-2287', sex: 'F', age: 58, bmi: '26.0', odi: '38',
      dx: 'Degenerative disc disease L4\u2013L5', plan: 'PT, activity modification', hx: 'None',
      outcome: 'PT + activity modification. ODI 38\u219221 at 9 mo.', conf: 93,
    },
    {
      id: 'SP-0031', source: 'demo', filePath: null, fileName: 'SP-0031.jpg',
      addedAt: '2026-08-14T12:00:00.000Z', view: 'Lateral lumbar', thumbnail: null,
      // p=[58.3,57.1,10.2,46.9,-1.2] -> PT+SS=57.1=PI, PI-LL=-1.2
      measurements: { PI: 57.1, PT: 10.2, SS: 46.9, LL: { 'L1-S1': 58.3 } },
      geometry: null,
      qc: { femoral: { method: 'contour-fit', component_count: 2, circle_union_iou: 0.94, radii_pixels: [40, 40], center_separation_pixels: 103, radius_ratio: 0.99, confidence: 0.95, qc_pass: true, foreground_pixels: 15800 } },
      clinical: {},
      pt: 'P-5561', sex: 'M', age: 23, bmi: '22.5', odi: '29',
      dx: 'L5 spondylolysis without slip', plan: 'Bracing, activity restriction', hx: 'None',
      outcome: 'Bracing + activity restriction. ODI 29\u21929 at 6 mo.', conf: 95,
    },
    {
      id: 'SP-0030', source: 'demo', filePath: null, fileName: 'SP-0030.jpg',
      addedAt: '2026-08-12T12:00:00.000Z', view: 'Standing lateral', thumbnail: null,
      // p=[18.3,44.8,28.4,16.4,26.5] -> PT+SS=44.8=PI, PI-LL=26.5
      measurements: { PI: 44.8, PT: 28.4, SS: 16.4, LL: { 'L1-S1': 18.3 } },
      geometry: null,
      qc: { femoral: { method: 'contour-fit', component_count: 2, circle_union_iou: 0.88, radii_pixels: [40, 41], center_separation_pixels: 111, radius_ratio: 0.96, confidence: 0.91, qc_pass: true, foreground_pixels: 15100 } },
      clinical: {},
      pt: 'P-4178', sex: 'F', age: 69, bmi: '30.1', odi: '61',
      dx: 'Sagittal imbalance after prior L2 compression fracture', plan: 'Osteoporosis workup, deformity clinic', hx: 'T12 kyphoplasty, 2021',
      outcome: 'Osteoporosis workup then staged correction. ODI 61.', conf: 91,
    },
  ];
  ```

- [ ] Verify the tests pass.

  Run:

  ```
  node --test test/demo-studies.test.js
  ```

  Expected: all 8 tests pass, 0 failures, exit code 0.

- [ ] Commit.

  ```
  git add renderer/data/demo-studies.js test/demo-studies.test.js
  git commit -m "feat: add the nine demo studies (data/demo-studies.js)"
  ```

---

## Task 3 — `renderer/data/persistence.js`: ids, validation, and demo/real merge

**Files:** `renderer/data/persistence.js` (new), `test/persistence.test.js` (new)

**Interfaces:**
- Consumes: `renderer/data/demo-studies.js` (Task 2) — `DEMO_STUDIES`.
- Produces: `STORE_VERSION`, `nextId(studies)`, `merge(realStudies)`, `validate(raw)`, exactly per the architecture contract's `renderer/data/persistence.js` section.

This module is pure — no `fs`, no Electron, safe to load in the browser via `<script type="module">` and in `node --test` alike. Disk I/O lives in `store-io.js` (Task 4), which only `main.js` imports.

- [ ] Write the failing test file.

  Create `test/persistence.test.js`:

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { STORE_VERSION, nextId, merge, validate } from '../renderer/data/persistence.js';
  import { DEMO_STUDIES } from '../renderer/data/demo-studies.js';

  test('STORE_VERSION is 1', () => {
    assert.equal(STORE_VERSION, 1);
  });

  test('nextId returns SP-1000 for an empty study list', () => {
    assert.equal(nextId([]), 'SP-1000');
  });

  test('nextId ignores demo studies when scanning for the highest id', () => {
    const studies = [
      { id: 'SP-0042', source: 'demo' },
      { id: 'SP-0041', source: 'demo' },
    ];
    assert.equal(nextId(studies), 'SP-1000');
  });

  test('nextId increments past the highest real id, out of order', () => {
    const studies = [
      { id: 'SP-1000', source: 'real' },
      { id: 'SP-1004', source: 'real' },
      { id: 'SP-1002', source: 'real' },
      { id: 'SP-0042', source: 'demo' },
    ];
    assert.equal(nextId(studies), 'SP-1005');
  });

  test('nextId never collides with the demo id range', () => {
    const merged = merge([]);
    assert.equal(nextId(merged), 'SP-1000');
  });

  test('merge places real studies first, then all nine demo studies', () => {
    const real = [{ id: 'SP-1000', source: 'real' }];
    const merged = merge(real);
    assert.equal(merged.length, real.length + DEMO_STUDIES.length);
    assert.equal(merged[0].id, 'SP-1000');
    for (let i = 0; i < DEMO_STUDIES.length; i += 1) {
      assert.equal(merged[real.length + i].id, DEMO_STUDIES[i].id);
    }
  });

  test('merge with no real studies returns only the nine demo studies', () => {
    const merged = merge([]);
    assert.equal(merged.length, DEMO_STUDIES.length);
  });

  test('merge with an undefined argument returns only demo studies', () => {
    const merged = merge(undefined);
    assert.equal(merged.length, DEMO_STUDIES.length);
  });

  test('validate throws when the root is not an object', () => {
    assert.throws(() => validate(null));
    assert.throws(() => validate('not an object'));
    assert.throws(() => validate([]));
  });

  test('validate throws when studies is not an array', () => {
    assert.throws(() => validate({ version: 1 }));
  });

  test('validate throws when a study is missing required fields', () => {
    assert.throws(() => validate({ version: 1, studies: [{ source: 'real' }] }));
  });

  test('validate throws when a study claims a non-real source', () => {
    const raw = {
      version: 1,
      studies: [{ id: 'SP-1000', source: 'demo', fileName: 'a.dcm', addedAt: '2026-01-01T00:00:00.000Z', view: 'Standing lateral' }],
    };
    assert.throws(() => validate(raw));
  });

  test('validate round-trips a well-formed store and fills in defaults', () => {
    const raw = {
      version: 1,
      studies: [
        { id: 'SP-1000', source: 'real', fileName: 'film.dcm', addedAt: '2026-08-31T12:00:00.000Z', view: 'Standing lateral' },
      ],
    };
    const studies = validate(raw);
    assert.equal(studies.length, 1);
    assert.equal(studies[0].id, 'SP-1000');
    assert.equal(studies[0].filePath, null);
    assert.equal(studies[0].thumbnail, null);
    assert.equal(studies[0].measurements, null);
    assert.equal(studies[0].geometry, null);
    assert.equal(studies[0].qc, null);
    assert.deepEqual(studies[0].clinical, {});
  });

  test('validate preserves a fully-populated study', () => {
    const raw = {
      version: 1,
      studies: [{
        id: 'SP-1000', source: 'real', filePath: 'C:/films/a.dcm', fileName: 'a.dcm',
        addedAt: '2026-08-31T12:00:00.000Z', view: 'Standing lateral', thumbnail: 'data:image/jpeg;base64,AAA',
        measurements: { PI: 50, PT: 20, SS: 30, LL: { 'L1-S1': 45 } },
        geometry: { vertebrae: {} }, qc: { femoral: { confidence: 0.9 } },
        clinical: { Age: '62' },
      }],
    };
    const [study] = validate(raw);
    assert.equal(study.filePath, 'C:/films/a.dcm');
    assert.equal(study.thumbnail, 'data:image/jpeg;base64,AAA');
    assert.deepEqual(study.measurements, raw.studies[0].measurements);
    assert.deepEqual(study.geometry, raw.studies[0].geometry);
    assert.deepEqual(study.qc, raw.studies[0].qc);
    assert.deepEqual(study.clinical, { Age: '62' });
  });
  ```

- [ ] Verify the test fails because the module does not exist yet.

  Run:

  ```
  node --test test/persistence.test.js
  ```

  Expected: fails immediately with `Cannot find module '../renderer/data/persistence.js'` (or `ERR_MODULE_NOT_FOUND`), zero tests executed.

- [ ] Implement `renderer/data/persistence.js`.

  Create `renderer/data/persistence.js`:

  ```js
  /**
   * Study store logic: ids, shape validation, demo/real merge (spec 13, 13.1;
   * architecture contract "renderer/data/persistence.js"). Pure — no fs, no
   * Electron — safe to load in the browser and under node --test alike.
   * Disk I/O (atomic write, corrupt-store recovery) lives in store-io.js,
   * which only main.js imports.
   */

  import { DEMO_STUDIES } from './demo-studies.js';

  export const STORE_VERSION = 1;

  /**
   * @param {object[]} studies real + demo, merged or not
   * @returns {string} 'SP-1000' or higher, scanning real studies only
   */
  export function nextId(studies) {
    let max = 999; // so the first id is SP-1000
    for (const study of studies || []) {
      if (!study || study.source !== 'real') continue;
      const match = /^SP-(\d+)$/.exec(study.id || '');
      if (!match) continue;
      const n = Number(match[1]);
      if (n > max) max = n;
    }
    const next = Math.max(max + 1, 1000);
    return `SP-${String(next).padStart(4, '0')}`;
  }

  /**
   * @param {object[]} realStudies
   * @returns {object[]} real studies first, then all nine demo studies
   */
  export function merge(realStudies) {
    return [...(realStudies || []), ...DEMO_STUDIES];
  }

  /**
   * @param {*} raw the parsed contents of studies.json ({version, studies})
   * @returns {object[]} normalized real Study[]
   * @throws {Error} when raw is not a well-formed store
   */
  export function validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Study store is not an object.');
    }
    if (!Array.isArray(raw.studies)) {
      throw new Error('Study store is missing a "studies" array.');
    }
    return raw.studies.map((entry, index) => validateStudy(entry, index));
  }

  function validateStudy(entry, index) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Study at index ${index} is not an object.`);
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error(`Study at index ${index} is missing an id.`);
    }
    if (entry.source !== 'real') {
      throw new Error(`Study ${entry.id} has source "${entry.source}"; only "real" studies may be persisted.`);
    }
    if (typeof entry.fileName !== 'string') {
      throw new Error(`Study ${entry.id} is missing fileName.`);
    }
    if (typeof entry.addedAt !== 'string') {
      throw new Error(`Study ${entry.id} is missing addedAt.`);
    }
    if (typeof entry.view !== 'string') {
      throw new Error(`Study ${entry.id} is missing view.`);
    }
    return {
      id: entry.id,
      source: 'real',
      filePath: typeof entry.filePath === 'string' ? entry.filePath : null,
      fileName: entry.fileName,
      addedAt: entry.addedAt,
      view: entry.view,
      thumbnail: typeof entry.thumbnail === 'string' ? entry.thumbnail : null,
      measurements: entry.measurements ?? null,
      geometry: entry.geometry ?? null,
      qc: entry.qc ?? null,
      clinical: entry.clinical && typeof entry.clinical === 'object' ? entry.clinical : {},
    };
  }
  ```

- [ ] Verify the tests pass.

  Run:

  ```
  node --test test/persistence.test.js
  ```

  Expected: all 13 tests pass, 0 failures, exit code 0.

- [ ] Commit.

  ```
  git add renderer/data/persistence.js test/persistence.test.js
  git commit -m "feat: add study ids, validation, and demo/real merge (data/persistence.js)"
  ```

---

## Task 4 — `store-io.js`: atomic disk read/write with corrupt-store recovery

**Files:** `store-io.js` (new, repo root), `test/store-io.test.js` (new)

**Interfaces:**
- Consumes: `node:fs/promises` only.
- Produces: `STORE_VERSION`, `isValidStoreShape(parsed)`, `readStudyStore(storePath)`, `writeStudyStore(storePath, studies)`.

This file lives at the repo root, next to `main.js`, not under `renderer/` — it is the one place in this plan that touches `node:fs`, and `renderer/**/*.js` is loaded by the browser via `<script type="module">`, which cannot resolve `node:fs` at all. Keeping filesystem code out of anything the browser loads is deliberate, not an oversight. `STORE_VERSION` here mirrors `renderer/data/persistence.js`'s `STORE_VERSION` (Task 3); the test below cross-checks they stay equal.

- [ ] Write the failing test file.

  Create `test/store-io.test.js`:

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { mkdtemp, readFile, access, readdir } from 'node:fs/promises';
  import path from 'node:path';
  import os from 'node:os';
  import { STORE_VERSION, readStudyStore, writeStudyStore } from '../store-io.js';

  async function tempStorePath() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'spine-contour-store-'));
    return path.join(dir, 'studies.json');
  }

  test('STORE_VERSION matches renderer/data/persistence.js', async () => {
    const { STORE_VERSION: rendererVersion } = await import('../renderer/data/persistence.js');
    assert.equal(STORE_VERSION, rendererVersion);
  });

  test('readStudyStore returns an empty array when the file does not exist', async () => {
    const storePath = await tempStorePath();
    const studies = await readStudyStore(storePath);
    assert.deepEqual(studies, []);
  });

  test('writeStudyStore then readStudyStore round-trips the studies array', async () => {
    const storePath = await tempStorePath();
    const studies = [{ id: 'SP-1000', source: 'real', fileName: 'film.dcm' }];
    await writeStudyStore(storePath, studies);
    const loaded = await readStudyStore(storePath);
    assert.deepEqual(loaded, studies);
  });

  test('writeStudyStore writes the version alongside the studies', async () => {
    const storePath = await tempStorePath();
    await writeStudyStore(storePath, []);
    const raw = JSON.parse(await readFile(storePath, 'utf8'));
    assert.equal(raw.version, STORE_VERSION);
    assert.deepEqual(raw.studies, []);
  });

  test('writeStudyStore leaves no .tmp file behind after a successful write', async () => {
    const storePath = await tempStorePath();
    await writeStudyStore(storePath, [{ id: 'SP-1000', source: 'real' }]);
    const exists = await access(`${storePath}.tmp`).then(() => true).catch(() => false);
    assert.equal(exists, false);
  });

  test('readStudyStore quarantines an unparseable file and returns an empty store', async () => {
    const storePath = await tempStorePath();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(storePath, '{ this is not valid json', 'utf8');

    const studies = await readStudyStore(storePath);
    assert.deepEqual(studies, []);

    const dir = path.dirname(storePath);
    const entries = await readdir(dir);
    const corruptEntry = entries.find((name) => name.startsWith('studies.json.corrupt-'));
    assert.ok(corruptEntry, 'expected a studies.json.corrupt-<timestamp> file');
    const corruptContent = await readFile(path.join(dir, corruptEntry), 'utf8');
    assert.equal(corruptContent, '{ this is not valid json');

    const freshRaw = JSON.parse(await readFile(storePath, 'utf8'));
    assert.deepEqual(freshRaw.studies, []);
  });

  test('readStudyStore quarantines well-formed JSON with the wrong shape', async () => {
    const storePath = await tempStorePath();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(storePath, JSON.stringify({ hello: 'world' }), 'utf8');

    const studies = await readStudyStore(storePath);
    assert.deepEqual(studies, []);

    const dir = path.dirname(storePath);
    const entries = await readdir(dir);
    assert.ok(entries.some((name) => name.startsWith('studies.json.corrupt-')));
  });

  test('readStudyStore quarantines a JSON array at the root instead of an object', async () => {
    const storePath = await tempStorePath();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(storePath, JSON.stringify([1, 2, 3]), 'utf8');

    const studies = await readStudyStore(storePath);
    assert.deepEqual(studies, []);
  });
  ```

- [ ] Verify the test fails because the module does not exist yet.

  Run:

  ```
  node --test test/store-io.test.js
  ```

  Expected: fails immediately with `Cannot find module '../store-io.js'` (or `ERR_MODULE_NOT_FOUND`), zero tests executed.

- [ ] Implement `store-io.js`.

  Create `store-io.js` at the repo root:

  ```js
  /**
   * Atomic disk read/write for studies.json, with corrupt-store recovery
   * (spec 13, 13.1). Deliberately outside renderer/ — this is the only file
   * in the persistence stack that touches node:fs, and only main.js imports
   * it. Mirrors renderer/data/persistence.js's STORE_VERSION.
   */

  import { readFile, writeFile, rename } from 'node:fs/promises';

  export const STORE_VERSION = 1;

  /**
   * @param {*} parsed
   * @returns {boolean} true when parsed looks like {version, studies: [...]}
   */
  export function isValidStoreShape(parsed) {
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Array.isArray(parsed.studies)
    );
  }

  /**
   * Writes {version, studies} to storePath atomically: write to a .tmp file,
   * then rename over the real path, so a crash mid-write cannot corrupt the
   * store.
   * @param {string} storePath
   * @param {object[]} studies
   */
  export async function writeStudyStore(storePath, studies) {
    const tmpPath = `${storePath}.tmp`;
    const body = JSON.stringify({ version: STORE_VERSION, studies }, null, 2);
    await writeFile(tmpPath, body, 'utf8');
    await rename(tmpPath, storePath);
  }

  /**
   * Reads the study store at storePath. A missing file yields an empty
   * array. An unparseable file, or well-formed JSON with the wrong shape,
   * is renamed aside to "<storePath>.corrupt-<timestamp>" and replaced
   * with a fresh empty store, rather than crashing the caller.
   * @param {string} storePath
   * @returns {Promise<object[]>} the raw studies array from disk
   */
  export async function readStudyStore(storePath) {
    let raw;
    try {
      raw = await readFile(storePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    let parsed = null;
    let shapeOk = false;
    try {
      parsed = JSON.parse(raw);
      shapeOk = isValidStoreShape(parsed);
    } catch (_error) {
      shapeOk = false;
    }

    if (!shapeOk) {
      const corruptPath = `${storePath}.corrupt-${Date.now()}`;
      await rename(storePath, corruptPath);
      await writeStudyStore(storePath, []);
      return [];
    }

    return parsed.studies;
  }
  ```

- [ ] Verify the tests pass.

  Run:

  ```
  node --test test/store-io.test.js
  ```

  Expected: all 8 tests pass, 0 failures, exit code 0.

- [ ] Commit.

  ```
  git add store-io.js test/store-io.test.js
  git commit -m "feat: add atomic study-store read/write with corrupt-store recovery"
  ```

---

## Task 5 — IPC: `loadStudies()` / `saveStudies(studies)`

**Files:** `main.js` (modify), `preload.js` (modify), `renderer/api.js` (modify)

**Interfaces:**
- Consumes: `store-io.js` (Task 4) — `readStudyStore`, `writeStudyStore`. `node:fs` — `existsSync`.
- Produces: IPC channels `load-studies` / `save-studies`; `window.spineContour.loadStudies()` / `.saveStudies(studies)`; `renderer/api.js`'s `loadStudies()` / `saveStudies(studies)` per the architecture contract's `renderer/api.js` section. Also extends the existing `select-file` handler's return shape with a `path` field (additive — `name` and `data` are unchanged), which Tasks 9–10 need to persist `filePath` for studies created via the file picker.

Real studies loaded from disk cannot be trusted to still point at a file that exists — the source may have moved or been deleted since the study was saved. Rather than add a new IPC channel to check that (this plan's only new channels are `loadStudies`/`saveStudies`), `load-studies` computes it itself, once, in the main process, which already has full filesystem access: each real study gets a `sourceAvailable` boolean. This is a derived field, exactly like `status` — `save-studies` strips it back out before persisting, so it is never written to disk.

- [ ] Modify `preload.js` to expose the two new channels.

  In `preload.js`, add two entries to the `contextBridge.exposeInMainWorld('spineContour', { ... })` object, alongside the existing `selectFile`/`predict`/`measure`:

  ```js
    loadStudies: () => ipcRenderer.invoke('load-studies'),
    saveStudies: (studies) => ipcRenderer.invoke('save-studies', studies),
  ```

  The full object should now expose `selectFile`, `predict`, `measure`, `loadStudies`, `saveStudies` — no other channel.

- [ ] Modify `renderer/api.js` to add the two wrapper functions.

  Add, following the same pass-through pattern the existing `selectFile`/`predict`/`measure` wrappers already use:

  ```js
  export async function loadStudies() {
    return window.spineContour.loadStudies();
  }

  export async function saveStudies(studies) {
    return window.spineContour.saveStudies(studies);
  }
  ```

- [ ] Modify `main.js`: import `store-io.js`, add the `path` field to `select-file`, add the two new handlers.

  Add near the top, with the other imports:

  ```js
  import { readStudyStore, writeStudyStore } from './store-io.js';
  ```

  In the existing `select-file` handler, change:

  ```js
    return {
      name: path.basename(filePath),
      data: await fsPromises.readFile(filePath),
    };
  ```

  to:

  ```js
    return {
      name: path.basename(filePath),
      data: await fsPromises.readFile(filePath),
      path: filePath,
    };
  ```

  Add the two new handlers, next to the existing `predict`/`measure` handlers:

  ```js
  ipcMain.handle('load-studies', async () => {
    const storePath = path.join(app.getPath('userData'), 'studies.json');
    const studies = await readStudyStore(storePath);
    return studies.map((study) => ({
      ...study,
      sourceAvailable: study.filePath ? fs.existsSync(study.filePath) : false,
    }));
  });

  ipcMain.handle('save-studies', async (_event, studies) => {
    const storePath = path.join(app.getPath('userData'), 'studies.json');
    const toPersist = (studies || []).map(({ sourceAvailable, ...rest }) => rest);
    await writeStudyStore(storePath, toPersist);
  });
  ```

- [ ] MANUAL VERIFICATION — this task has no automated test; it wires already-tested logic (Task 4) through Electron IPC, which `node --test` cannot exercise.

  1. Launch the app: `npm run dev`.
  2. Open DevTools (Ctrl+Shift+I) and switch to the Console.
  3. Run:

     ```js
     await window.spineContour.loadStudies()
     ```

     Expected: resolves to `[]` (no `studies.json` exists yet for this profile).

  4. Run:

     ```js
     await window.spineContour.saveStudies([{
       id: 'SP-1000', source: 'real', filePath: null, fileName: 'test.dcm',
       addedAt: new Date().toISOString(), view: 'Standing lateral', thumbnail: null,
       measurements: null, geometry: null, qc: null, clinical: {},
     }])
     ```

     Expected: resolves without throwing.

  5. Run `await window.spineContour.loadStudies()` again.

     Expected: resolves to an array containing that one study, with `sourceAvailable: false` (since `filePath` is `null`) and no `sourceAvailable` key left over from a prior save.

  6. Close the app. Locate `studies.json` under the app's userData directory — on Windows in a development (non-preview) build this is `%APPDATA%\Spine-Contour\studies.json`. Open it in a text editor and overwrite its contents with `not json at all`. Save.
  7. Relaunch the app (`npm run dev`) and repeat step 3.

     Expected: resolves to `[]` (the corrupt file was quarantined, not crashed on). Confirm a new file named `studies.json.corrupt-<a number>` now sits alongside `studies.json` in that same folder, and that `studies.json` itself is valid JSON again (`{"version":1,"studies":[]}`).

  8. Repeat step 4 to leave a clean `[SP-1000]` store in place for the next task's verification, or delete `studies.json` to start fresh — either is fine, Task 6 onward re-derives everything from whatever is there.

- [ ] Commit.

  ```
  git add main.js preload.js renderer/api.js
  git commit -m "feat: add loadStudies/saveStudies IPC and a path field on selectFile"
  ```

---

## Task 6 — Studies screen: heading, summary, table, and demo pill

**Files:** `renderer/screens/studies.js` (new/replace), `styles/screens/studies.css` (new), `index.html` (modify), `renderer/main.js` (modify), `renderer/router.js` (modify, if needed)

**Interfaces:**
- Consumes: `renderer/store.js` — `getState()`, `setState(patchOrFn)`. `renderer/dom.js` — `el(tag, props, ...children)`, `mount(node, child)`. `renderer/data/status.js` (Task 1) — `deriveStatus`, `statusLabel`. `renderer/data/persistence.js` (Task 3) — `merge`. `renderer/api.js` (Task 5) — `loadStudies`.
- Produces: `render(state) → HTMLElement` (the screen's entry point, called by the router), `formatDate(iso) → string` (exported for testing).

This task lays out the static screen: heading, `{n} STUDIES · {m} IN QUEUE` summary, the table with status pills and the `DEMO` pill, and the empty state markup (unreachable until Task 7 adds search filtering). The dropzone renders but is not yet interactive — Task 9 wires it up. If `renderer/screens/studies.js` already exists as a stub from an earlier plan, this task replaces it wholesale; if `renderer/router.js` does not yet dispatch to it, this task adds that too.

- [ ] Write the failing test for the one pure helper this task introduces.

  Create `test/studies.test.js`:

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { formatDate } from '../renderer/screens/studies.js';

  test('formatDate renders a short month/day/year', () => {
    assert.equal(formatDate('2026-08-21T14:00:00.000Z'), 'Aug 21, 2026');
  });

  test('formatDate renders an em dash for a missing or invalid date', () => {
    assert.equal(formatDate(null), '\u2014');
    assert.equal(formatDate(undefined), '\u2014');
    assert.equal(formatDate('not a date'), '\u2014');
  });
  ```

- [ ] Verify the test fails because the module does not exist yet.

  Run:

  ```
  node --test test/studies.test.js
  ```

  Expected: fails immediately with `Cannot find module '../renderer/screens/studies.js'` (or `ERR_MODULE_NOT_FOUND`), zero tests executed.

- [ ] Create `styles/screens/studies.css`.

  ```css
  .studies-screen {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }

  .studies-container {
    max-width: 1160px;
    margin: 0 auto;
    padding: 30px 36px 60px;
  }

  .studies-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }

  .studies-header-spacer {
    flex: 1;
  }

  .studies-heading {
    margin: 0;
    font: 650 26px/1.2 'Source Sans 3', sans-serif;
    color: var(--ink);
    letter-spacing: -0.01em;
  }

  .studies-summary {
    margin-top: 4px;
    font-family: 'Chivo Mono', monospace;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.15em;
    color: var(--muted);
  }

  .studies-search {
    width: 260px;
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--card);
    color: var(--ink);
    font: 400 14px 'Source Sans 3', sans-serif;
  }

  .studies-search:focus {
    outline: none;
    border-color: var(--accent);
  }

  .studies-dropzone {
    margin-bottom: 18px;
    padding: 14px 18px;
    border: 1.5px dashed var(--border);
    border-radius: 12px;
    background: var(--card);
    display: flex;
    align-items: center;
    gap: 14px;
    cursor: pointer;
  }

  .studies-dropzone-active {
    border-color: var(--accent);
    background: var(--well);
  }

  .studies-dropzone-icon {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: 11px;
    background: var(--well);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
  }

  .studies-dropzone-text {
    flex: 1;
    min-width: 0;
  }

  .studies-dropzone-title {
    font: 650 14.5px 'Source Sans 3', sans-serif;
    color: var(--ink);
  }

  .studies-dropzone-subtitle {
    margin-top: 2px;
    font: 400 12.5px 'Source Sans 3', sans-serif;
    color: var(--muted);
  }

  .studies-sample-btn {
    padding: 7px 14px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    background: var(--accent);
    color: #FFFFFF;
    font: 650 13.5px 'Source Sans 3', sans-serif;
    cursor: pointer;
    white-space: nowrap;
  }

  .studies-sample-btn:hover {
    filter: brightness(1.08);
  }

  .studies-table-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: hidden;
  }

  .studies-table-head,
  .studies-row {
    display: grid;
    grid-template-columns: 112px 1.15fr 1.2fr 0.9fr 1.05fr 110px;
    gap: 16px;
    align-items: center;
    padding: 13px 22px;
  }

  .studies-table-head {
    padding: 12px 22px;
    border-bottom: 1px solid var(--border);
    background: var(--well);
    font-family: 'Chivo Mono', monospace;
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.15em;
    color: var(--muted);
  }

  .studies-col-lordosis {
    text-align: right;
  }

  .studies-row {
    border-top: 1px solid var(--border);
    cursor: pointer;
  }

  .studies-row:hover {
    background: var(--well);
  }

  .studies-cell-id {
    font-family: 'Chivo Mono', monospace;
    font-size: 12.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    color: var(--ink);
  }

  .studies-cell-patient {
    display: flex;
    align-items: center;
    gap: 8px;
    font: 400 14px 'Source Sans 3', sans-serif;
    color: var(--body);
  }

  .studies-cell-view {
    font: 400 14px 'Source Sans 3', sans-serif;
    color: var(--body);
    white-space: nowrap;
  }

  .studies-cell-date {
    font: 400 13.5px 'Source Sans 3', sans-serif;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    white-space: nowrap;
  }

  .pill-status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
    padding: 3px 11px 4px;
    border-radius: 999px;
    font: 600 12.5px 'Source Sans 3', sans-serif;
  }

  .pill-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .pill-status-seg {
    background: color-mix(in srgb, var(--sage) 14%, transparent);
    color: var(--sage);
  }

  .pill-status-rev {
    background: color-mix(in srgb, var(--accent) 13%, transparent);
    color: var(--accent);
  }

  .pill-status-proc {
    background: color-mix(in srgb, var(--muted) 14%, transparent);
    color: var(--muted);
  }

  .pill-demo {
    padding: 1px 8px 2px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--well);
    color: var(--muted);
    font-family: 'Chivo Mono', monospace;
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.12em;
    white-space: nowrap;
  }

  .studies-lordosis,
  .studies-lordosis-high {
    text-align: right;
    font: 600 15px 'Source Sans 3', sans-serif;
    font-variant-numeric: tabular-nums;
  }

  .studies-lordosis {
    color: var(--ink);
  }

  .studies-lordosis-high {
    color: var(--accent);
  }

  .studies-empty {
    padding: 34px;
    text-align: center;
    font: 400 14px 'Source Sans 3', sans-serif;
    color: var(--muted);
  }

  .studies-relocate-btn {
    padding: 7px 14px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    background: var(--accent);
    color: #FFFFFF;
    font: 650 13px 'Source Sans 3', sans-serif;
    cursor: pointer;
    white-space: nowrap;
  }
  ```

- [ ] Add the stylesheet link to `index.html`. In the `<head>`, alongside the other `styles/screens/*.css` links added by earlier plans, add:

  ```html
      <link rel="stylesheet" href="styles/screens/studies.css" />
  ```

- [ ] Create `renderer/screens/studies.js`.

  ```js
  /**
   * Studies screen (spec 9.4). Heading, search, dropzone, and the studies
   * table with derived status pills and the DEMO pill. render(state) is a
   * pure function of state -> DOM tree; the router mounts it and re-invokes
   * it on every store change.
   */

  import { el } from '../dom.js';
  import { deriveStatus, statusLabel } from '../data/status.js';

  const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  /**
   * @param {string|null|undefined} iso
   * @returns {string}
   */
  export function formatDate(iso) {
    if (!iso) return '\u2014';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '\u2014';
    return dateFormatter.format(date);
  }

  /**
   * @param {object} state store state
   * @returns {HTMLElement}
   */
  export function render(state) {
    const studies = state.studies || [];
    const queued = studies.filter((study) => deriveStatus(study) === 'proc').length;

    return el('main', { class: 'studies-screen' },
      el('div', { class: 'studies-container' },
        el('div', { class: 'studies-header' },
          el('div', {},
            el('h1', { class: 'studies-heading' }, 'Studies'),
            el('div', { class: 'studies-summary' }, `${studies.length} STUDIES \u00b7 ${queued} IN QUEUE`),
          ),
          el('div', { class: 'studies-header-spacer' }),
          el('input', {
            class: 'studies-search',
            value: state.query || '',
            placeholder: 'Search ID, patient, diagnosis\u2026',
          }),
        ),
        buildDropzone(),
        buildTable(studies),
      ),
    );
  }

  function buildDropzone() {
    const icon = el('div', { class: 'studies-dropzone-icon' });
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16 V4"></path><path d="M7.5 8.5 L12 4 L16.5 8.5"></path><path d="M4.5 19.5 H19.5"></path></svg>';

    return el('div', { class: 'studies-dropzone' },
      icon,
      el('div', { class: 'studies-dropzone-text' },
        el('div', { class: 'studies-dropzone-title' }, 'Drop a DICOM series or lateral radiograph'),
        el('div', { class: 'studies-dropzone-subtitle' }, 'De-identified files only. Segmentation runs locally on the workstation.'),
      ),
      el('button', { class: 'studies-sample-btn' }, 'Use sample film'),
    );
  }

  function buildTable(studies) {
    const rows = studies.map((study) => buildRow(study));
    return el('div', { class: 'studies-table-card' },
      el('div', { class: 'studies-table-head' },
        el('div', {}, 'STUDY ID'),
        el('div', {}, 'PATIENT'),
        el('div', {}, 'VIEW'),
        el('div', {}, 'DATE'),
        el('div', {}, 'STATUS'),
        el('div', { class: 'studies-col-lordosis' }, 'LORDOSIS'),
      ),
      ...rows,
    );
  }

  function buildRow(study) {
    const status = deriveStatus(study);
    const lordosis = study.measurements && study.measurements.LL ? study.measurements.LL['L1-S1'] : null;
    const hasLordosis = typeof lordosis === 'number';
    const lordosisText = hasLordosis ? `${Math.round(lordosis)}\u00b0` : '\u2014';
    const lordosisClass = hasLordosis && lordosis >= 40 ? 'studies-lordosis-high' : 'studies-lordosis';

    const patientChildren = [study.pt || '\u2014'];
    if (study.source === 'demo') patientChildren.push(el('span', { class: 'pill-demo' }, 'DEMO'));

    return el('div', { class: 'studies-row' },
      el('div', { class: 'studies-cell-id' }, study.id),
      el('div', { class: 'studies-cell-patient' }, ...patientChildren),
      el('div', { class: 'studies-cell-view' }, study.view || '\u2014'),
      el('div', { class: 'studies-cell-date' }, formatDate(study.addedAt)),
      el('div', {},
        el('span', { class: `pill-status pill-status-${status}` },
          el('span', { class: 'pill-status-dot' }),
          statusLabel(status),
        ),
      ),
      el('div', { class: lordosisClass }, lordosisText),
    );
  }
  ```

- [ ] Verify the `formatDate` test passes.

  Run:

  ```
  node --test test/studies.test.js
  ```

  Expected: both tests pass, 0 failures, exit code 0.

- [ ] Wire study loading into the renderer bootstrap. Open `renderer/main.js`. Per the architecture contract's file-structure comment, its job is exactly `bootstrap: load studies, mount, subscribe`. Add these imports alongside its existing ones:

  ```js
  import { loadStudies } from './api.js';
  import { merge } from './data/persistence.js';
  ```

  Then, in the bootstrap sequence, before the first render/mount of the app (i.e. before the router displays the initial screen), add:

  ```js
  const realStudies = await loadStudies();
  setState({ studies: merge(realStudies) });
  ```

  `setState` is whatever `renderer/main.js` already imports from `./store.js` for this purpose.

- [ ] Confirm `renderer/router.js` dispatches to this screen. Open `renderer/router.js`. It should already import `renderer/screens/studies.js` and, when `state.screen === 'studies'`, call its `render(state)` export and mount the result (this is required for the `studies` screen to have worked at all since plan 02 established the four-screen state machine). If that case is missing or names a different function, add or adjust it to match:

  ```js
  import { render as renderStudies } from './screens/studies.js';
  // ...
  if (state.screen === 'studies') mount(appRoot, renderStudies(state));
  ```

- [ ] MANUAL VERIFICATION.

  1. Launch the app: `npm run dev`.
  2. Acknowledge the landing gate, navigate to Studies (via the sidebar, or by whatever route plans 02–04 established).
  3. Expected: heading reads `Studies`; the summary line reads `9 STUDIES · 0 IN QUEUE` (assuming `studies.json` is empty or absent — all nine demo studies derive to Segmented per Task 2, so the queue count is 0).
  4. Expected: the dashed dropzone renders with its icon, title, subtitle, and an accent `Use sample film` button (not yet functional — that's Task 9).
  5. Expected: the table lists all nine demo studies, each row showing STUDY ID (Chivo Mono), PATIENT with a `DEMO` pill next to it, VIEW, a formatted DATE (e.g. `Aug 21, 2026`), a sage `Segmented` status pill, and a LORDOSIS value — accent-colored and right-aligned when \u2265 40\u00b0 (e.g. `SP-0031` at 58\u00b0), otherwise the normal ink color.
  6. If a study was left in `studies.json` from Task 5's manual verification (`SP-1000`, no measurements), confirm it also appears, above the demo rows, with a muted `Processing` pill and `\u2014` for both PATIENT and LORDOSIS, and no `DEMO` pill — and that the summary line now reads `10 STUDIES · 1 IN QUEUE`.
  7. Close and reopen the app. Confirm the same rows still render (studies persisted via Task 5, loaded via this task's bootstrap wiring).

- [ ] Commit.

  ```
  git add renderer/screens/studies.js styles/screens/studies.css index.html renderer/main.js renderer/router.js test/studies.test.js
  git commit -m "feat: render the Studies table with status and DEMO pills"
  ```

---

## Task 7 — Studies screen: search filtering

**Files:** `renderer/screens/studies.js` (modify)

**Interfaces:**
- Consumes: `renderer/store.js` — `setState`.
- Produces: `matchesQuery(study, query) → boolean` (exported for testing); wires the search input built in Task 6 to actual filtering and the empty state.

- [ ] Write the failing test.

  Add to `test/studies.test.js`:

  ```js
  import { matchesQuery } from '../renderer/screens/studies.js';

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
    const study = { id: 'SP-1000', view: 'Standing lateral' };
    assert.equal(matchesQuery(study, ''), true);
  });
  ```

- [ ] Verify the new tests fail (the current `test/studies.test.js` has no `matchesQuery` export to import).

  Run:

  ```
  node --test test/studies.test.js
  ```

  Expected: fails with a `SyntaxError`/`does not provide an export named 'matchesQuery'` from the new `import` line.

- [ ] Implement filtering in `renderer/screens/studies.js`. Add the exported helper:

  ```js
  /**
   * @param {object} study
   * @param {string} query already-lowercased, trimmed search text
   * @returns {boolean}
   */
  export function matchesQuery(study, query) {
    if (!query) return true;
    const haystack = [study.id, study.pt, study.dx, study.view]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }
  ```

  Update `render(state)` to filter before building the table, wire the search input's `onInput` to `setState`, and pass the filtered list (and the original query, for the empty-state check) into `buildTable`:

  ```js
  import { getState, setState } from '../store.js';
  ```

  Replace the body of `render(state)`:

  ```js
  export function render(state) {
    const studies = state.studies || [];
    const queued = studies.filter((study) => deriveStatus(study) === 'proc').length;
    const query = (state.query || '').trim().toLowerCase();
    const filtered = studies.filter((study) => matchesQuery(study, query));

    return el('main', { class: 'studies-screen' },
      el('div', { class: 'studies-container' },
        el('div', { class: 'studies-header' },
          el('div', {},
            el('h1', { class: 'studies-heading' }, 'Studies'),
            el('div', { class: 'studies-summary' }, `${studies.length} STUDIES \u00b7 ${queued} IN QUEUE`),
          ),
          el('div', { class: 'studies-header-spacer' }),
          el('input', {
            class: 'studies-search',
            value: state.query || '',
            placeholder: 'Search ID, patient, diagnosis\u2026',
            onInput: (event) => setState({ query: event.target.value }),
          }),
        ),
        buildDropzone(),
        buildTable(filtered),
      ),
    );
  }
  ```

  Update `buildTable` to render the empty state when filtering leaves nothing:

  ```js
  function buildTable(studies) {
    const body = studies.length > 0
      ? studies.map((study) => buildRow(study))
      : [el('div', { class: 'studies-empty' }, 'No studies match that search.')];
    return el('div', { class: 'studies-table-card' },
      el('div', { class: 'studies-table-head' },
        el('div', {}, 'STUDY ID'),
        el('div', {}, 'PATIENT'),
        el('div', {}, 'VIEW'),
        el('div', {}, 'DATE'),
        el('div', {}, 'STATUS'),
        el('div', { class: 'studies-col-lordosis' }, 'LORDOSIS'),
      ),
      ...body,
    );
  }
  ```

  Note the summary line's `${studies.length}` and `${queued}` counts still use the *unfiltered* `studies` array — the summary always reports the full library, independent of the current search.

- [ ] Verify the tests pass.

  Run:

  ```
  node --test test/studies.test.js
  ```

  Expected: all 5 tests (2 from Task 6, 3 new) pass, 0 failures, exit code 0.

- [ ] MANUAL VERIFICATION.

  1. Launch the app, navigate to Studies.
  2. Type `SP-0042` into the search box. Expected: only that one row remains.
  3. Clear the box, type `anterior slip` (matches `SP-0042`'s diagnosis). Expected: only `SP-0042` remains.
  4. Type `standing lateral`. Expected: only rows with that exact view remain (several demo rows).
  5. Type `zzzznomatch`. Expected: the table body is replaced with the single centered line `No studies match that search.`; the summary line above still reads the full, unfiltered `{n} STUDIES · {m} IN QUEUE`.
  6. Clear the box. Expected: all rows return.

- [ ] Commit.

  ```
  git add renderer/screens/studies.js test/studies.test.js
  git commit -m "feat: filter the Studies table by id, patient, diagnosis, and view"
  ```

---

## Task 8 — Thumbnail generation and wiring real measurements into the store

**Files:** `renderer/screens/studies.js` (modify), `assets/sample-film/lateral.jpg` (new)

**Interfaces:**
- Consumes: `renderer/api.js` (Task 5) — `selectFile`, `predict`, `saveStudies`. `renderer/data/persistence.js` (Task 3) — `nextId`. `renderer/store.js` — `getState`, `setState`. Browser `Image`/`canvas`/`Blob`/`FileReader` APIs.
- Produces: `buildStudy({id, fileName, filePath, predictResponse, thumbnail}) → Study` (exported for testing), `generateThumbnail(imagePngBase64) → Promise<string>`, `runPrediction(fileName, bytes, filePath)`; makes the dropzone (click, drop) and `Use sample film` button functional.

This is the task that makes a measured radiograph durable: `runPrediction` calls the existing `predict()` API, builds a real `Study` with a fresh id from `nextId`, generates a thumbnail from the prediction's `image_png`, appends the study to the in-memory list, persists every real study via `saveStudies`, and navigates to the (already-built, from plan 03) analysis screen. Bundling a real sample radiograph is necessary because `predict()` runs the real backend — "sample" here means a real file shipped with the app, not a shortcut around the real pipeline.

- [ ] Copy a real lateral radiograph into the app's assets so `Use sample film` has something to send through the real backend.

  ```bash
  mkdir -p "assets/sample-film"
  cp "design-reference/design_src/3ea1de46-3989-4083-8488-6e68ad57e050.jpg" "assets/sample-film/lateral.jpg"
  ```

  This file is already inside `assets/**/*`, which `package.json`'s `build.files` (and `electron-builder.preview.yml`'s mirrored `files` list, per plan 01's standing warning) already globs — no packaging config changes needed.

- [ ] Write the failing test for the one fully pure piece of this task, `buildStudy`.

  Add to `test/studies.test.js`:

  ```js
  import { buildStudy } from '../renderer/screens/studies.js';

  test('buildStudy produces a real Study populated from the predict response', () => {
    const predictResponse = {
      measurements: { PI: 50, PT: 20, SS: 30, LL: { 'L1-S1': 45 } },
      geometry: { vertebrae: {} },
      qc: { femoral: { confidence: 0.9 } },
    };
    const study = buildStudy({
      id: 'SP-1000',
      fileName: 'film.dcm',
      filePath: 'C:/films/film.dcm',
      predictResponse,
      thumbnail: 'data:image/jpeg;base64,AAA',
    });
    assert.equal(study.id, 'SP-1000');
    assert.equal(study.source, 'real');
    assert.equal(study.fileName, 'film.dcm');
    assert.equal(study.filePath, 'C:/films/film.dcm');
    assert.equal(study.thumbnail, 'data:image/jpeg;base64,AAA');
    assert.deepEqual(study.measurements, predictResponse.measurements);
    assert.deepEqual(study.geometry, predictResponse.geometry);
    assert.deepEqual(study.qc, predictResponse.qc);
    assert.deepEqual(study.clinical, {});
    assert.ok(!Number.isNaN(new Date(study.addedAt).getTime()));
  });

  test('buildStudy defaults filePath and thumbnail to null when none is given', () => {
    const predictResponse = { measurements: {}, geometry: {}, qc: null };
    const study = buildStudy({ id: 'SP-1001', fileName: 'film.dcm', filePath: null, predictResponse, thumbnail: null });
    assert.equal(study.filePath, null);
    assert.equal(study.thumbnail, null);
  });
  ```

- [ ] Verify the new tests fail.

  Run:

  ```
  node --test test/studies.test.js
  ```

  Expected: fails with `does not provide an export named 'buildStudy'`.

- [ ] Implement `buildStudy`, `generateThumbnail`, `runPrediction`, and wire the dropzone/sample-film UI.

  Add these imports to the top of `renderer/screens/studies.js`:

  ```js
  import * as api from '../api.js';
  import { nextId } from '../data/persistence.js';
  ```

  Add the pure builder:

  ```js
  /**
   * @param {{id:string, fileName:string, filePath:?string, predictResponse:object, thumbnail:?string}} args
   * @returns {object} a real Study
   */
  export function buildStudy({ id, fileName, filePath, predictResponse, thumbnail }) {
    return {
      id,
      source: 'real',
      filePath: filePath || null,
      fileName,
      addedAt: new Date().toISOString(),
      view: 'Standing lateral',
      thumbnail: thumbnail || null,
      measurements: predictResponse.measurements,
      geometry: predictResponse.geometry,
      qc: predictResponse.qc || null,
      clinical: {},
    };
  }
  ```

  Add thumbnail generation (downscale to a max 128px long edge, JPEG, data URI — spec 13):

  ```js
  /**
   * @param {string} imagePngBase64 the predict response's image_png (no data: prefix)
   * @returns {Promise<string>} a JPEG data URI, max 128px on the long edge
   */
  export async function generateThumbnail(imagePngBase64) {
    const binary = atob(imagePngBase64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 128 / longEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Could not generate a thumbnail.'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the generated thumbnail.'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.82);
    });
  }
  ```

  Add the orchestration that turns a file into a saved, persisted, navigated-to Study:

  ```js
  /**
   * Runs the full predict -> thumbnail -> save -> navigate flow for one
   * radiograph and appends the resulting Study to the store.
   * @param {string} fileName
   * @param {Uint8Array} bytes
   * @param {?string} filePath absolute path, when known (from selectFile()); null otherwise
   */
  export async function runPrediction(fileName, bytes, filePath) {
    const response = await api.predict({
      name: fileName, data: bytes, modality: 'xray', bodyPart: 'lumbar', view: 'lateral',
    });
    const thumbnail = await generateThumbnail(response.image_png);
    const state = getState();
    const study = buildStudy({
      id: nextId(state.studies), fileName, filePath: filePath || null,
      predictResponse: response, thumbnail,
    });
    const nextStudies = [study, ...state.studies];
    setState({ studies: nextStudies, screen: 'analysis', openId: study.id });
    await api.saveStudies(nextStudies.filter((s) => s.source === 'real'));
  }

  function toUint8Array(data) {
    if (data instanceof Uint8Array) return data;
    if (data && data.data) return Uint8Array.from(data.data);
    return Uint8Array.from(data);
  }

  async function triggerFilePicker() {
    try {
      const file = await api.selectFile();
      if (!file) return;
      await runPrediction(file.name, toUint8Array(file.data), file.path || null);
    } catch (error) {
      setState({ toast: error.message });
    }
  }

  async function handleDroppedFile(file) {
    try {
      const buffer = await file.arrayBuffer();
      await runPrediction(file.name, new Uint8Array(buffer), null);
    } catch (error) {
      setState({ toast: error.message });
    }
  }

  async function useSampleFilm() {
    try {
      const bytes = await loadSampleFilmBytes();
      await runPrediction('sample-lateral.jpg', bytes, null);
    } catch (error) {
      setState({ toast: error.message });
    }
  }

  function loadSampleFilmBytes() {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Could not prepare the sample film.'));
            return;
          }
          blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer))).catch(reject);
        }, 'image/png');
      };
      image.onerror = () => reject(new Error('Could not load the sample film.'));
      image.src = 'assets/sample-film/lateral.jpg';
    });
  }
  ```

  Wire the dropzone: replace `buildDropzone()`'s body so it attaches drag/drop and click handlers, and give the sample-film button its own click handler that does not also trigger the dropzone's click-to-browse:

  ```js
  function buildDropzone() {
    const icon = el('div', { class: 'studies-dropzone-icon' });
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16 V4"></path><path d="M7.5 8.5 L12 4 L16.5 8.5"></path><path d="M4.5 19.5 H19.5"></path></svg>';

    const sampleBtn = el('button', {
      class: 'studies-sample-btn',
      onClick: (event) => { event.stopPropagation(); useSampleFilm(); },
    }, 'Use sample film');

    const zone = el('div', { class: 'studies-dropzone' },
      icon,
      el('div', { class: 'studies-dropzone-text' },
        el('div', { class: 'studies-dropzone-title' }, 'Drop a DICOM series or lateral radiograph'),
        el('div', { class: 'studies-dropzone-subtitle' }, 'De-identified files only. Segmentation runs locally on the workstation.'),
      ),
      sampleBtn,
    );

    zone.addEventListener('click', () => triggerFilePicker());
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('studies-dropzone-active');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('studies-dropzone-active');
    });
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('studies-dropzone-active');
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) handleDroppedFile(file);
    });

    return zone;
  }
  ```

- [ ] Verify the tests pass.

  Run:

  ```
  node --test test/studies.test.js
  ```

  Expected: all 7 tests pass, 0 failures, exit code 0.

- [ ] MANUAL VERIFICATION.

  1. Launch the app, navigate to Studies.
  2. Click anywhere on the dropzone (not the `Use sample film` button). Expected: the native file picker opens (`api.selectFile()`); cancel it — nothing changes.
  3. Click `Use sample film`. Expected: the button click does not also open the file picker; after a short delay (real `/predict` call against the bundled backend), the app navigates to the analysis screen (built in plan 03) for a newly created study.
  4. Navigate back to Studies. Expected: a new row appears at the top of the table with id `SP-1000` (or the next unused `SP-10xx`), a thumbnail-bearing entry, real measurements, and a status pill derived from those measurements (`Segmented` or `Needs review`, never `Processing` — a state Task 9's flow never produces since it always finishes with a predict response).
  5. If the sample film happens to fail the real segmentation pipeline (`predict()` rejects), expected: a toast reads the error message and the app stays on Studies with no new row added — if this happens, replace `assets/sample-film/lateral.jpg` with a different real lateral radiograph and retry; the flow itself (thumbnail generation, save, navigation) is only verified once a `predict()` call succeeds.
  6. Drag any real lateral radiograph file from the OS file explorer onto the dropzone. Expected: the same predict → save → navigate flow runs, and the resulting study has `filePath: null` (drag-and-drop does not currently carry an absolute path — only the file picker path, verified next, does).
  7. Repeat step 2, this time completing the picker with a real radiograph instead of cancelling. Expected: the same flow runs and, this time, the resulting study's `filePath` is the absolute path you picked — confirm via DevTools console: `(await window.spineContour.loadStudies()).find(s => s.id === '<the new id>').filePath` should be a real path, not `null`.
  8. Close and reopen the app, navigate to Studies. Expected: all studies created in this task's verification are still listed, with their measurements and thumbnails intact.

- [ ] Commit.

  ```
  git add renderer/screens/studies.js assets/sample-film/lateral.jpg test/studies.test.js
  git commit -m "feat: wire dropzone, sample film, thumbnails, and real study persistence"
  ```

---

## Task 9 — Missing source file: relocate flow

**Files:** `renderer/screens/studies.js` (modify)

**Interfaces:**
- Consumes: `renderer/api.js` (Task 5) — `selectFile`, `saveStudies`. `renderer/store.js` — `getState`, `setState`.
- Produces: row-click navigation (`openStudy`), including the relocate path for real studies whose source file is missing.

Every real study's `sourceAvailable` flag (Task 5) reflects whether `fs.existsSync(study.filePath)` was true the last time studies were loaded. A study can list perfectly well with stale `sourceAvailable` (nothing re-checks mid-session) — that is fine, since the check re-runs fresh on every app launch, exactly like `status`.

- [ ] Implement row click handling. In `renderer/screens/studies.js`, import `getState`/`setState` if not already imported (Task 7 already imports `setState`; add `getState` to that import), then add:

  ```js
  function openStudy(study) {
    if (study.source === 'real' && study.sourceAvailable === false) {
      setState({ toast: `${study.fileName} was not found. Choose its new location.` });
      relocateFile(study);
      return;
    }
    setState({ screen: 'analysis', openId: study.id });
  }

  async function relocateFile(study) {
    try {
      const file = await api.selectFile();
      if (!file) return;
      const state = getState();
      const updatedStudies = state.studies.map((existing) => (
        existing.id === study.id
          ? { ...existing, fileName: file.name, filePath: file.path || null, sourceAvailable: true }
          : existing
      ));
      await api.saveStudies(updatedStudies.filter((s) => s.source === 'real'));
      setState({ studies: updatedStudies, screen: 'analysis', openId: study.id });
    } catch (error) {
      setState({ toast: error.message });
    }
  }
  ```

  Wire it to each row in `buildRow`:

  ```js
    return el('div', { class: 'studies-row', onClick: () => openStudy(study) },
  ```

  (replacing the existing `el('div', { class: 'studies-row' },` opening line from Task 6).

- [ ] MANUAL VERIFICATION — this task is pure DOM wiring around already-tested IPC (Task 5); there is no new pure logic to `node --test`.

  1. Launch the app, navigate to Studies, and click any demo row (e.g. `SP-0042`).

     Expected: navigates straight to the analysis screen for that study — demo studies have `source: 'demo'`, so the relocate branch never triggers for them.

  2. Navigate back to Studies. Via DevTools console, simulate a moved file on an existing real study (using one created in Task 8, or create one now):

     ```js
     const studies = await window.spineContour.loadStudies();
     const target = studies.find((s) => s.source === 'real');
     await window.spineContour.saveStudies(
       (await window.spineContour.loadStudies()).map((s) =>
         s.id === target.id ? { ...s, filePath: 'C:/does/not/exist.dcm' } : s
       )
     );
     ```

     Reload the app (or navigate away from and back to Studies, if the app's state does not already refresh from `loadStudies()` — a full relaunch is always a valid way to force this).

  3. Click that study's row.

     Expected: a toast reads `<fileName> was not found. Choose its new location.`, and the native file picker opens immediately.

  4. In the picker, choose any real file. Expected: the app navigates to the analysis screen for that study. Navigate back to Studies; confirm via `await window.spineContour.loadStudies()` that the study's `fileName` now matches the file you just picked and `filePath` is its absolute path.

  5. Repeat steps 2–3, but this time cancel the picker (Escape, or the dialog's Cancel button). Expected: the app stays on the Studies screen; the study's `filePath` is unchanged (still the nonexistent path) — clicking it again re-offers the same relocate flow.

- [ ] Commit.

  ```
  git add renderer/screens/studies.js
  git commit -m "feat: offer to relocate a study whose source file is missing"
  ```

---

## Task 10 — End-to-end verification: persistence survives a restart

**Files:** none — verification only.

**Interfaces:**
- Consumes: the full flow built in Tasks 1–9.
- Produces: nothing — confirms this plan's stated acceptance criterion.

- [ ] Run the full automated test suite for everything this plan added.

  ```
  node --test test/*.test.js
  ```

  Expected: `status.test.js`, `demo-studies.test.js`, `persistence.test.js`, `store-io.test.js`, and `studies.test.js` all pass, 0 failures. (Other test files may exist from other plans; all should still pass.)

- [ ] MANUAL VERIFICATION — the plan's acceptance criterion, stated in full.

  1. If a `studies.json` exists for this profile from earlier manual verification, delete it (or note its current contents) so this pass starts from a known state. Launch the app: `npm run dev`.
  2. Acknowledge the landing gate, navigate to Studies.
  3. Confirm the summary line reads `9 STUDIES · 0 IN QUEUE` and all nine demo rows are present, each with a `DEMO` pill and a `Segmented` status.
  4. Click `Use sample film` (or drop/pick a real radiograph — either exercises the same path). Wait for the real `/predict` call to complete and the app to navigate to the analysis screen.
  5. Navigate back to Studies. Confirm the summary line now reads `10 STUDIES · {m} IN QUEUE` and a new row appears at the top with a real `SP-10xx` id, no `DEMO` pill, real measurements, a thumbnail, and a status pill of `Segmented` or `Needs review` (derived, per Task 1, from the real predict response — never `Processing`, since this flow only ever completes after a successful predict).
  6. Note the new study's id.
  7. **Close the app completely** (not just navigate away — quit the process).
  8. **Reopen the app** (`npm run dev` again). Acknowledge the landing gate, navigate to Studies.
  9. Confirm the study from step 6 is still listed, by id, with the same measurements (spot-check the LORDOSIS column value matches what was shown before closing) and the same thumbnail.
  10. Open that study (click its row). Confirm the analysis screen shows the same measurement values as before the restart.

  This is the plan's definition of done: a study measured in this app is still there, with its measurements, after the app is closed and reopened.

- [ ] No commit for this task — it is verification only. If any step fails, fix the responsible task's code, re-run that task's own verification, then re-run this end-to-end pass before considering plan 05 complete.
