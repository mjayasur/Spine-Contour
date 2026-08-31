# Find Similar and Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank stored studies by weighted sagittal-parameter distance, surface the top matches in a "Find similar" tab, and let clicking a match split the viewer and measurements table into a side-by-side comparison against the open study.

**Architecture:** `renderer/data/similarity.js` is a pure, dependency-free module (weighted Euclidean distance over `[LL, PI, PT, SS, PI-LL]`) consumed by a new `renderer/components/similar.js` tab component and by the comparison extensions added here to the existing viewer, measurements panel, analysis header, and clinical-data grid. Comparison state is just `store.js`'s existing `compareId` field; setting it drives every other change in this plan reactively through the existing `subscribe()` mechanism — there is no new state machine.

**Tech Stack:** Vanilla ES modules, `node --test` for the pure-logic module, hand-written DOM via `renderer/dom.js`'s `el()`/`clear()`/`mount()` helpers, CSS custom properties from `styles/tokens.css`.

**Dependency note:** This plan extends files created by plans 02–06 (`renderer/components/viewer.js`, `renderer/viewer/canvas.js`, `renderer/components/measurements.js`, `renderer/components/clinical-data.js`, `renderer/screens/analysis.js`) whose exact internal structure this document cannot see. Every task that touches one of those files states its assumed existing interface under **Consumes**, anchored where possible to strings and signatures the architecture contract or spec fix verbatim (e.g. the row label `PELVIC INCIDENCE`, the badge copy `FEMORAL FIT CONFIDENCE`). Where an assumption turns out wrong during implementation, adapt the call site to the real export — the behavior specified in each step is normative, the exact existing function name is not.

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

## Task 1 — `renderer/data/similarity.js`: weighted distance and ranking

**Files:** `renderer/data/similarity.js` (new), `test/similarity.test.js` (new)

**Interfaces:**
- Consumes: nothing — pure logic, no imports.
- Produces: `WEIGHTS`, `vector(study)`, `distance(a,b)`, `matchScore(a,b)`, `findSimilar(study, all, n=3)`, exactly per the architecture contract's `renderer/data/similarity.js` section.

- [ ] Write the failing test file first, using nine fixture studies whose sagittal numbers mirror the app's real demo dataset (`design-reference/template.html`'s `STUDIES` array), plus two unsegmented fixtures.

  Create `test/similarity.test.js`:

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { WEIGHTS, vector, distance, matchScore, findSimilar } from '../renderer/data/similarity.js';

  function closeTo(actual, expected, epsilon = 1e-9) {
    assert.ok(
      Math.abs(actual - expected) < epsilon,
      `expected ${actual} to be close to ${expected}`
    );
  }

  function demoStudy(id, ll, pi, pt, ss) {
    return {
      id,
      source: 'demo',
      filePath: null,
      fileName: `${id}.jpg`,
      addedAt: '2026-08-21T00:00:00.000Z',
      view: 'Standing lateral',
      thumbnail: null,
      measurements: {
        SS: ss,
        PI: pi,
        PT: pt,
        LL: {
          'L1-S1': ll,
          'L2-S1': ll + 3,
          'L3-S1': ll + 6,
          'L4-S1': ll + 9,
          'L5-S1': ll + 12
        }
      },
      geometry: null,
      qc: null,
      clinical: {}
    };
  }

  function unsegmentedStudy(id) {
    return {
      id,
      source: 'real',
      filePath: `C:/scans/${id}.dcm`,
      fileName: `${id}.dcm`,
      addedAt: '2026-08-31T00:00:00.000Z',
      view: 'Standing lateral',
      thumbnail: null,
      measurements: null,
      geometry: null,
      qc: null,
      clinical: {}
    };
  }

  // Nine fixtures mirroring the app's demo dataset (design-reference/template.html
  // STUDIES array), each [LL(L1-S1), PI, PT, SS].
  const DEMO = [
    demoStudy('SP-0042', 48.2, 54.1, 18.3, 35.8),
    demoStudy('SP-0041', 31.7, 48.9, 22.6, 26.3),
    demoStudy('SP-0039', 52.4, 49.8, 12.1, 37.7),
    demoStudy('SP-0038', 24.9, 52.3, 29.8, 22.5),
    demoStudy('SP-0036', 44.7, 55.6, 21.4, 34.2),
    demoStudy('SP-0035', 27.9, 46.2, 25.1, 21.1),
    demoStudy('SP-0033', 44.1, 53.0, 19.7, 33.3),
    demoStudy('SP-0031', 58.3, 57.1, 10.2, 46.9),
    demoStudy('SP-0030', 18.3, 44.8, 28.4, 16.4)
  ];

  test('WEIGHTS matches the contract order [LL, PI, PT, SS, PI-LL]', () => {
    assert.deepEqual(WEIGHTS, [1, 0.8, 0.8, 0.6, 1]);
  });

  test('vector() returns [LL, PI, PT, SS, PI-LL] for a segmented study', () => {
    const v = vector(DEMO[0]); // SP-0042
    closeTo(v[0], 48.2);
    closeTo(v[1], 54.1);
    closeTo(v[2], 18.3);
    closeTo(v[3], 35.8);
    closeTo(v[4], 54.1 - 48.2);
  });

  test('vector() returns null when measurements is null', () => {
    assert.equal(vector(unsegmentedStudy('SP-1000')), null);
  });

  test('distance() is symmetric', () => {
    const a = vector(DEMO[0]);
    const b = vector(DEMO[4]); // SP-0036
    assert.equal(distance(a, b), distance(b, a));
  });

  test('distance() is zero for identical vectors', () => {
    const a = vector(DEMO[2]);
    assert.equal(distance(a, a), 0);
  });

  test('matchScore() floors at 58 for very distant vectors', () => {
    const a = [0, 0, 0, 0, 0];
    const b = [100, 100, 100, 100, 100];
    assert.equal(matchScore(a, b), 58);
    assert.ok(Number.isInteger(matchScore(a, b)));
  });

  test('matchScore() is 100 for identical vectors', () => {
    const a = vector(DEMO[3]);
    assert.equal(matchScore(a, a), 100);
  });

  test('findSimilar() never ranks a study as similar to itself', () => {
    const results = findSimilar(DEMO[0], DEMO, 9);
    assert.ok(!results.some((s) => s.id === DEMO[0].id));
  });

  test('findSimilar() excludes studies whose vector() is null', () => {
    const all = [DEMO[0], unsegmentedStudy('SP-1000'), unsegmentedStudy('SP-1001')];
    const results = findSimilar(DEMO[0], all, 3);
    assert.deepEqual(results, []);
  });

  test('findSimilar() sorts ascending by weighted sagittal distance and returns the top n', () => {
    const results = findSimilar(DEMO[0], DEMO, 3); // base: SP-0042
    const ids = results.map((s) => s.id);
    assert.deepEqual(ids, ['SP-0033', 'SP-0036', 'SP-0039']);
  });

  test('findSimilar() respects a smaller n', () => {
    const results = findSimilar(DEMO[0], DEMO, 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'SP-0033');
  });

  test('findSimilar() returns Study objects, not distance wrappers', () => {
    const [nearest] = findSimilar(DEMO[0], DEMO, 1);
    assert.equal(nearest.source, 'demo');
    assert.ok(nearest.measurements);
  });
  ```

- [ ] Verify the test fails because `renderer/data/similarity.js` does not exist yet.

  Run:

  ```
  node --test test/similarity.test.js
  ```

  Expected: the run fails immediately with `Cannot find module '../renderer/data/similarity.js'` (or equivalent ERR_MODULE_NOT_FOUND), zero tests executed.

- [ ] Implement `renderer/data/similarity.js`.

  Create `renderer/data/similarity.js`:

  ```js
  /**
   * Weighted sagittal-parameter similarity ranking (spec 10.5, architecture
   * contract "renderer/data/similarity.js"). Pure functions, no dependencies.
   */

  export const WEIGHTS = [1, 0.8, 0.8, 0.6, 1];

  /**
   * @param {object} study a Study record
   * @returns {number[]|null} [LL(L1-S1), PI, PT, SS, PI-LL], or null when the
   *   study has never been segmented (measurements === null).
   */
  export function vector(study) {
    const m = study.measurements;
    if (m == null) return null;
    const ll = m.LL['L1-S1'];
    return [ll, m.PI, m.PT, m.SS, m.PI - ll];
  }

  /**
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} sqrt(sum(WEIGHTS[i] * (a[i]-b[i])^2))
   */
  export function distance(a, b) {
    let sum = 0;
    for (let i = 0; i < WEIGHTS.length; i++) {
      const d = a[i] - b[i];
      sum += WEIGHTS[i] * d * d;
    }
    return Math.sqrt(sum);
  }

  /**
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} integer match percentage, floored at 58
   */
  export function matchScore(a, b) {
    const d = distance(a, b);
    return Math.max(58, Math.round(100 - d * 1.35));
  }

  /**
   * Ranks `all` by distance to `study`, excluding `study` itself and any
   * study whose vector() is null, ascending, top `n`.
   * @param {object} study
   * @param {object[]} all
   * @param {number} [n]
   * @returns {object[]} Study[]
   */
  export function findSimilar(study, all, n = 3) {
    const base = vector(study);
    if (base == null) return [];
    const candidates = [];
    for (const other of all) {
      if (other.id === study.id) continue;
      const v = vector(other);
      if (v == null) continue;
      candidates.push({ study: other, dist: distance(base, v) });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    return candidates.slice(0, n).map((c) => c.study);
  }
  ```

- [ ] Verify the tests pass.

  Run:

  ```
  node --test test/similarity.test.js
  ```

  Expected: all 12 tests pass, 0 failures, exit code 0.

- [ ] Commit.

  ```
  git add renderer/data/similarity.js test/similarity.test.js
  git commit -m "feat: add weighted sagittal similarity ranking (data/similarity.js)"
  ```

---

## Task 2 — `renderer/components/similar.js`: the Find similar tab

**Files:** `renderer/components/similar.js` (new), `styles/screens/analysis.css` (append)

**Interfaces:**
- Consumes: `renderer/store.js` — `getState()`, `setState(patchOrFn)`, `subscribe(fn)`. `renderer/dom.js` — `el(tag, props, ...children)`, `mount(node, child)`. `renderer/data/similarity.js` (Task 1) — `vector`, `matchScore`, `findSimilar`.
- Produces: `renderSimilar(container)` — mounts the Find Similar tab into `container`, self-subscribes to the store, returns an unsubscribe function for the caller (e.g. `screens/analysis.js`) to invoke when the tab is torn down.

- [ ] Implement `renderer/components/similar.js`.

  ```js
  import { getState, setState, subscribe } from '../store.js';
  import { el, mount } from '../dom.js';
  import { vector, matchScore, findSimilar } from '../data/similarity.js';

  /**
   * Mounts the "Find similar" right-panel tab into `container` and keeps it in
   * sync with the store. Cards are ranked by weighted sagittal distance
   * (spec 10.5); clicking a card toggles it as the comparison study.
   * @param {HTMLElement} container
   * @returns {() => void} unsubscribe
   */
  export function renderSimilar(container) {
    draw();
    return subscribe(draw);

    function draw() {
      const state = getState();
      const study = state.studies.find((s) => s.id === state.openId);
      if (!study) return;

      const baseVector = vector(study);
      const eligible = state.studies.filter(
        (s) => s.id !== study.id && vector(s) != null
      );
      const matches = findSimilar(study, state.studies, 3);
      const moreCount = Math.max(0, eligible.length - matches.length);

      const root = el(
        'div',
        { class: 'similar-tab' },
        el('div', { class: 'similar-eyebrow' }, 'RANKED BY SAGITTAL PARAMETER DISTANCE'),
        ...matches.map((sim) => buildCard(sim, baseVector, state.compareId)),
        el('div', { class: 'similar-tail' }, `${moreCount} MORE STUDIES BELOW THRESHOLD`)
      );
      mount(container, root);
    }
  }

  function buildCard(sim, baseVector, compareId) {
    const score = matchScore(baseVector, vector(sim));
    const active = compareId === sim.id;
    const note = sim.outcome || sim.clinical?.Notes || sim.clinical?.Diagnosis || '\u2014';
    const thumbStyle = sim.thumbnail ? `background-image:url("${sim.thumbnail}")` : '';

    return el(
      'div',
      {
        class: `similar-card${active ? ' similar-card--active' : ''}`,
        onClick: () =>
          setState((s) => ({ compareId: s.compareId === sim.id ? null : sim.id }))
      },
      el('div', { class: 'similar-thumb', style: thumbStyle }),
      el(
        'div',
        { class: 'similar-body' },
        el(
          'div',
          { class: 'similar-head' },
          el('div', { class: 'similar-id' }, sim.id),
          el('div', { class: 'similar-spacer' }),
          el('div', { class: 'similar-score' }, `${score}% MATCH`)
        ),
        el('div', { class: 'similar-note' }, note),
        el(
          'div',
          { class: `similar-status${active ? ' similar-status--active' : ''}` },
          active ? 'IN VIEWER \u00b7 CLICK TO REMOVE' : 'CLICK TO COMPARE IN VIEWER'
        )
      )
    );
  }
  ```

- [ ] Append the Find similar tab styles to `styles/screens/analysis.css`.

  ```css
  /* Find similar tab (plan 07) */
  .similar-tab {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 6px 16px 12px;
  }
  .similar-eyebrow {
    font-family: 'Chivo Mono', monospace;
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.14em;
    color: var(--muted);
    padding: 0 2px;
  }
  .similar-card {
    display: flex;
    gap: 12px;
    padding: 10px;
    border-radius: 12px;
    border: 1.5px solid var(--border);
    background: transparent;
    cursor: pointer;
  }
  .similar-card:hover {
    background: var(--well);
  }
  .similar-card--active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent) 7%, var(--card));
  }
  .similar-card--active:hover {
    background: color-mix(in srgb, var(--accent) 7%, var(--card));
  }
  .similar-thumb {
    width: 56px;
    height: 76px;
    flex-shrink: 0;
    border-radius: 8px;
    border: 1px solid var(--border);
    background-color: #0B0A09;
    background-repeat: no-repeat;
    background-position: center;
    background-size: cover;
  }
  .similar-body {
    flex: 1;
    min-width: 0;
  }
  .similar-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .similar-id {
    font-family: 'Chivo Mono', monospace;
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    color: var(--ink);
    white-space: nowrap;
  }
  .similar-spacer {
    flex: 1;
  }
  .similar-score {
    font-family: 'Chivo Mono', monospace;
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.12em;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
    padding: 2px 8px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .similar-note {
    margin-top: 5px;
    font: 400 12.5px/1.45 'Source Sans 3', sans-serif;
    color: var(--body);
  }
  .similar-status {
    margin-top: 6px;
    font-family: 'Chivo Mono', monospace;
    font-size: 8px;
    font-weight: 500;
    letter-spacing: 0.13em;
    color: var(--muted);
  }
  .similar-status--active {
    color: var(--accent);
  }
  .similar-tail {
    text-align: center;
    padding: 6px 0;
    font-family: 'Chivo Mono', monospace;
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.14em;
    color: var(--muted);
  }
  ```

- [ ] Wire the tab into the screen. In `renderer/screens/analysis.js`, find where the right panel switches between the `meas` and `sim` tabs (`state.tab`). Import `renderSimilar` from `../components/similar.js` and call it against the panel body container when `state.tab === 'sim'`, exactly the way the existing Measurements tab is mounted when `state.tab === 'meas'`.

- [ ] MANUAL VERIFICATION.

  1. Launch the app (`npm run dev`, or the project's `run` skill if one is configured).
  2. Acknowledge the landing gate.
  3. Open Studies and open any segmented demo study (e.g. `SP-0042`).
  4. Click the **Find similar** tab in the right panel.
  5. Expected: eyebrow reads `RANKED BY SAGITTAL PARAMETER DISTANCE`; up to three cards render, each with a 56×76 thumbnail, the study ID, an `{n}% MATCH` badge, a clinical note (or `—`), and the status line `CLICK TO COMPARE IN VIEWER`; a tail line reads `{n} MORE STUDIES BELOW THRESHOLD`.
  6. Click a card. Expected: its border and background tint accent, its status line changes to `IN VIEWER · CLICK TO REMOVE`.
  7. Click the same card again. Expected: it reverts to the untinted state and `CLICK TO COMPARE IN VIEWER`.

- [ ] Commit.

  ```
  git add renderer/components/similar.js styles/screens/analysis.css renderer/screens/analysis.js
  git commit -m "feat: add Find similar tab (components/similar.js)"
  ```

---

## Task 3 — Comparison viewer panes

**Files:** `renderer/components/viewer.js` (modify)

**Interfaces:**
- Consumes: `renderer/store.js` — `getState()`, `setState()`, `subscribe()`. `renderer/dom.js` — `el(tag, props, ...children)`. `renderer/data/similarity.js` (Task 1) — `vector`, `matchScore`. From `renderer/viewer/canvas.js` (Plan 03's "layered rendering"), assumed export `mountPane(hostEl, study, opts) → { update(study, opts), destroy() }`, where `update` redraws only the layer(s) whose relevant inputs changed (static image+overlay vs. dynamic handles/lines/selection highlight) — this is the same function the single-pane case already calls, so reusing it for a second pane inherits the existing "don't repaint the static layer on selection change" behavior for free. If Plan 03 named this differently, adapt the call site below; the per-pane lifecycle described here is normative.
- Produces: `renderViewerPanes(stageEl)` — replaces the single always-one-pane render path with a 1-or-2-pane path driven by `state.openId`/`state.compareId`.

- [ ] Implement the pane-list orchestration in `renderer/components/viewer.js`. Add the following (as a new exported function, alongside whatever the file already exports for the toolbar):

  ```js
  import { getState, setState, subscribe } from '../store.js';
  import { el } from '../dom.js';
  import { mountPane } from '../viewer/canvas.js';
  import { vector, matchScore } from '../data/similarity.js';

  const activePanes = new Map(); // studyId -> { host, chipId, chipBadge, chipClose, handle }

  /**
   * Renders one canvas pane per open study — the primary study, plus the
   * comparison study when state.compareId is set — inside `stageEl`.
   * @param {HTMLElement} stageEl
   * @returns {() => void} unsubscribe
   */
  export function renderViewerPanes(stageEl) {
    draw();
    return subscribe(draw);

    function draw() {
      const state = getState();
      const study = state.studies.find((s) => s.id === state.openId);
      if (!study) return;
      const compareStudy = state.compareId
        ? state.studies.find((s) => s.id === state.compareId)
        : null;

      const wanted = compareStudy ? [study, compareStudy] : [study];
      const wantedIds = wanted.map((s) => s.id);

      for (const id of Array.from(activePanes.keys())) {
        if (!wantedIds.includes(id)) {
          const pane = activePanes.get(id);
          pane.handle.destroy();
          pane.host.remove();
          activePanes.delete(id);
        }
      }

      wanted.forEach((paneStudy, index) => {
        const isCompare = index === 1;
        let pane = activePanes.get(paneStudy.id);
        if (!pane) {
          pane = buildPane(stageEl, paneStudy, isCompare);
          activePanes.set(paneStudy.id, pane);
        }
        pane.host.style.order = String(index);
        pane.host.classList.toggle('viewer-pane--compare', isCompare);

        pane.handle.update(paneStudy, {
          interactive: !isCompare,
          overlays: state.overlays,
          overlayOpacity: state.overlayOpacity,
          zoom: state.zoom,
          panX: state.panX,
          panY: state.panY,
          selectedLevel: state.selectedLevel,
          editing: !isCompare && state.editing,
          selection: !isCompare ? state.selection : null
        });

        pane.chipId.textContent = paneStudy.id;
        if (isCompare) {
          const score = matchScore(vector(study), vector(paneStudy));
          pane.chipBadge.textContent = `${score}% MATCH`;
          pane.chipBadge.style.display = 'inline-flex';
          pane.chipClose.style.display = 'flex';
        } else {
          pane.chipBadge.style.display = 'none';
          pane.chipClose.style.display = 'none';
        }
      });
    }
  }

  function buildPane(stageEl, study, isCompare) {
    const chipId = el('div', { class: 'viewer-chip-id' }, study.id);
    const chipBadge = el('div', { class: 'viewer-chip-badge' });
    const chipClose = el(
      'div',
      {
        class: 'viewer-chip-close',
        title: 'Remove from viewer',
        onClick: () => setState({ compareId: null })
      },
      '\u00d7'
    );
    const chip = el('div', { class: 'viewer-chip' }, chipId, chipBadge, chipClose);
    const canvasHost = el('div', { class: 'viewer-canvas-host' });
    const host = el(
      'div',
      { class: `viewer-pane${isCompare ? ' viewer-pane--compare' : ''}` },
      canvasHost,
      chip
    );
    stageEl.appendChild(host);
    const handle = mountPane(canvasHost, study, { interactive: !isCompare });
    return { host, chip, chipId, chipBadge, chipClose, handle };
  }
  ```

- [ ] Replace the existing single-pane call site. Find where `renderer/components/viewer.js` currently mounts exactly one pane for `state.openId` (the toolbar, zoom controls, and needs-run overlay stay outside this — they are unaffected by comparison mode) and call `renderViewerPanes(stageEl)` there instead, passing the same stage container element that used to host the single pane's `<svg>`/canvas.

- [ ] Append the pane styles to `styles/screens/analysis.css`.

  ```css
  /* Comparison viewer panes (plan 07) */
  .viewer-pane {
    flex: 1;
    min-width: 0;
    position: relative;
    overflow: hidden;
    border-left: 1px solid transparent;
  }
  .viewer-pane--compare {
    border-left: 1px solid #38342F;
  }
  .viewer-canvas-host {
    position: absolute;
    inset: 0;
  }
  .viewer-chip {
    position: absolute;
    top: 14px;
    left: 14px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 8px 6px 12px;
    border-radius: 12px;
    background: rgba(20, 18, 16, .85);
    border: 1px solid #38342F;
    backdrop-filter: blur(8px);
  }
  .viewer-chip-id {
    font-family: 'Chivo Mono', monospace;
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.13em;
    color: #FAF7F2;
  }
  .viewer-chip-badge {
    display: none;
    font-family: 'Chivo Mono', monospace;
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.12em;
    color: #D45A32;
    background: rgba(212, 90, 50, .14);
    border: 1px solid rgba(212, 90, 50, .35);
    padding: 2px 7px;
    border-radius: 999px;
  }
  .viewer-chip-close {
    display: none;
    width: 22px;
    height: 22px;
    border-radius: 7px;
    align-items: center;
    justify-content: center;
    color: #9A9188;
    cursor: pointer;
    font: 600 14px/1 'Source Sans 3', sans-serif;
  }
  .viewer-chip-close:hover {
    background: #282522;
    color: #FAF7F2;
  }
  ```

- [ ] MANUAL VERIFICATION.

  1. Launch the app, open a segmented demo study, click **Find similar**, click the nearest match.
  2. Expected: the viewer stage splits into two canvases side by side with a thin divider between them. The left (primary) pane's chip shows only the study ID. The right (comparison) pane's chip shows its study ID, an `{n}% MATCH` badge, and a `×` close button.
  3. Click a vertebra on the left pane. Expected: it selects (existing single-pane selection behavior from plans 03/04) and the same level highlights in both panes' images.
  4. Attempt to click or drag on the right (comparison) pane's radiograph. Expected: nothing selects, nothing drags — the comparison pane does not respond to pointer input.
  5. Zoom or pan using the shared toolbar. Expected: both panes zoom/pan together.
  6. Click the `×` on the comparison pane's chip. Expected: the comparison pane closes, the viewer returns to a single full-width pane, and `state.compareId` is `null` (confirm by checking the Find similar tab's card status reverts to `CLICK TO COMPARE IN VIEWER`).

- [ ] Commit.

  ```
  git add renderer/components/viewer.js styles/screens/analysis.css
  git commit -m "feat: split viewer into primary/comparison panes"
  ```

---

## Task 4 — Analysis header COMPARING badge and right-panel width

**Files:** `renderer/screens/analysis.js` (modify), `styles/screens/analysis.css` (append)

**Interfaces:**
- Consumes: `renderer/store.js` — `getState()`, `subscribe()`. `renderer/dom.js` — `el()`. Assumes `screens/analysis.js` already renders a header element containing the `FEMORAL FIT CONFIDENCE` badge (spec 9.5, plan 03; that exact copy is a reliable anchor regardless of internal class names) and an `<aside>` element hosting the Measurements/Find similar tabs at a fixed 400px width (spec 9.5, plan 03).
- Produces: `renderComparingBadge(headerEl)` and `syncPanelWidth(asideEl)`.

- [ ] Add the COMPARING badge and panel-width sync functions to `renderer/screens/analysis.js`.

  ```js
  import { getState, subscribe } from '../store.js';
  import { el } from '../dom.js';

  /**
   * Inserts/removes a "COMPARING · {id}" pill in the analysis header,
   * positioned before the FEMORAL FIT CONFIDENCE badge when present.
   * @param {HTMLElement} headerEl
   * @returns {() => void} unsubscribe
   */
  export function renderComparingBadge(headerEl) {
    draw();
    return subscribe(draw);

    function draw() {
      const state = getState();
      const existing = headerEl.querySelector('.analysis-comparing-badge');
      if (existing) existing.remove();
      if (!state.compareId) return;
      const badge = el(
        'div',
        { class: 'analysis-comparing-badge' },
        `COMPARING \u00b7 ${state.compareId}`
      );
      const confidenceBadge = headerEl.querySelector('.analysis-confidence-badge');
      if (confidenceBadge) {
        headerEl.insertBefore(badge, confidenceBadge);
      } else {
        headerEl.appendChild(badge);
      }
    }
  }

  /**
   * Widens the right panel from 400px to 440px while comparison mode is
   * active (spec 9.5 / 10.6).
   * @param {HTMLElement} asideEl
   * @returns {() => void} unsubscribe
   */
  export function syncPanelWidth(asideEl) {
    draw();
    return subscribe(draw);

    function draw() {
      const state = getState();
      asideEl.style.width = (state.compareId ? 440 : 400) + 'px';
    }
  }
  ```

  If the existing header markup has no element carrying a class named `analysis-confidence-badge`, the fallback `headerEl.appendChild(badge)` still places the pill in the header (just not guaranteed immediately before the confidence badge) — add the class to the confidence badge's existing element, or adjust the selector to whatever it actually is, to restore exact placement.

- [ ] Call both functions from wherever `screens/analysis.js` mounts the header and the aside, passing the real header and aside elements: `renderComparingBadge(headerEl)` and `syncPanelWidth(asideEl)`.

- [ ] Append the badge styles to `styles/screens/analysis.css`.

  ```css
  /* Comparing badge (plan 07) */
  .analysis-comparing-badge {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    font-family: 'Chivo Mono', monospace;
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.14em;
    color: var(--accent);
    white-space: nowrap;
  }
  ```

- [ ] MANUAL VERIFICATION.

  1. Open a segmented study, click Find similar, click a match.
  2. Expected: the header shows a `COMPARING · {id}` pill (accent-tinted, Chivo Mono, matching the comparison study's ID), and the right panel visibly widens.
  3. Click the comparison pane's `×` close button (Task 3).
  4. Expected: the `COMPARING` pill disappears and the right panel narrows back to its original width.

- [ ] Commit.

  ```
  git add renderer/screens/analysis.js styles/screens/analysis.css
  git commit -m "feat: show COMPARING badge and widen right panel in comparison mode"
  ```

---

## Task 5 — Measurements table `{other}` and `Δ` columns

**Files:** `renderer/components/measurements.js` (modify), `styles/screens/analysis.css` (append)

**Interfaces:**
- Consumes: `renderer/store.js` — `getState()`. `renderer/dom.js` — `el()`. `renderer/data/measurements.js` (plan 03) — `sagittalRows(measurements, opts)`, `lordosisRows(measurements)`, `discRows()`, `alignmentRows(study)`, `deltaRow(row, otherRow, threshold)`. Assumes `components/measurements.js` already builds one row element per `Row` returned by those four functions and appends it to each section's container — the six sagittal row labels (`LUMBAR LORDOSIS · L1–S1`, `PELVIC INCIDENCE`, `PELVIC TILT`, `SACRAL SLOPE`, `PI–LL MISMATCH`, `L1 PELVIC ANGLE`) are fixed verbatim by the architecture contract and are a reliable anchor for locating that render path.
- Produces: `buildComparisonHeader(study, compareStudy)`, `buildComparisonCells(row, otherRow)` — appended to `components/measurements.js`.

- [ ] Add the comparison-column helpers to `renderer/components/measurements.js`.

  ```js
  import { deltaRow } from '../data/measurements.js';
  import { el } from '../dom.js';

  const SAGITTAL_KEYS = ['LL', 'PI', 'PT', 'SS', 'PILL', 'L1PA'];
  const SAGITTAL_THRESHOLD = 5; // degrees
  const LENGTH_THRESHOLD = 2; // mm

  /**
   * Header row shown once, above the sagittal section, when comparison
   * mode is active: primary ID | comparison ID | Δ.
   */
  export function buildComparisonHeader(study, compareStudy) {
    return el(
      'div',
      { class: 'meas-compare-header' },
      el('div', { class: 'meas-compare-header-spacer' }),
      el('div', { class: 'meas-compare-header-id' }, study.id),
      el('div', { class: 'meas-compare-header-id meas-compare-header-id--other' }, compareStudy.id),
      el('div', { class: 'meas-compare-header-delta' }, '\u0394')
    );
  }

  /**
   * Builds the {other} value cell and the Δ cell for one measurement row,
   * given the same Row from the comparison study. Absent values on either
   * side (e.g. a demo study missing L1PA) render em dash, never a computed
   * delta against a missing number.
   * @param {{key,label,value,unit,absent,highlight}} row primary row
   * @param {{key,label,value,unit,absent,highlight}} otherRow comparison row, same key
   * @returns {[HTMLElement, HTMLElement]} [otherCell, deltaCell]
   */
  export function buildComparisonCells(row, otherRow) {
    const threshold = SAGITTAL_KEYS.includes(row.key) ? SAGITTAL_THRESHOLD : LENGTH_THRESHOLD;

    const otherText =
      otherRow.absent || otherRow.value == null
        ? '\u2014'
        : otherRow.value.toFixed(1) + otherRow.unit;

    const delta = buildDelta(row, otherRow, threshold);

    return [
      el('div', { class: 'meas-cell-other' }, otherText),
      el(
        'div',
        { class: `meas-cell-delta${delta.overThreshold ? ' meas-cell-delta--over' : ''}` },
        delta.text
      )
    ];
  }

  function buildDelta(row, otherRow, threshold) {
    // data/measurements.js's deltaRow formats the signed, one-decimal,
    // proper-minus-sign delta text and the over-threshold flag (spec 10.6).
    // A row absent on either side must never render a fabricated delta —
    // e.g. demo studies have no L1PA, so comparing a real study against a
    // demo one must show "—" on that row, not 0 or a guess — so guard
    // explicitly here rather than trusting deltaRow to special-case absence.
    if (row.absent || otherRow.absent || row.value == null || otherRow.value == null) {
      return { text: '\u2014', overThreshold: false };
    }
    return deltaRow(row, otherRow, threshold);
  }
  ```

- [ ] Wire the helpers into the existing render path. In `renderer/components/measurements.js`, wherever the sagittal, lordosis, disc, and alignment sections currently build one row element per `Row` and append it to its section container: when `getState().compareId` is set, also call the same accessor function (`sagittalRows`, `lordosisRows`, `discRows`, `alignmentRows`) against the comparison study's `measurements`/study object to get `otherRows` in the same order, then for each row index `i` call `buildComparisonCells(rows[i], otherRows[i])` and append both returned cells to that row's existing element (after its existing label/value cells). Insert `buildComparisonHeader(study, compareStudy)` once, immediately above the sagittal section's row list, only while comparing.

- [ ] Append the comparison-column styles to `styles/screens/analysis.css`.

  ```css
  /* Measurement comparison columns (plan 07) */
  .meas-compare-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 12px;
  }
  .meas-compare-header-spacer {
    flex: 1;
  }
  .meas-compare-header-id {
    width: 64px;
    text-align: right;
    font-family: 'Chivo Mono', monospace;
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.12em;
    color: var(--ink);
  }
  .meas-compare-header-id--other {
    color: var(--muted);
  }
  .meas-compare-header-delta {
    width: 46px;
    text-align: right;
    font-family: 'Chivo Mono', monospace;
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.12em;
    color: var(--muted);
  }
  .meas-cell-other {
    width: 64px;
    text-align: right;
    font: 600 16px/1 'Source Sans 3', sans-serif;
    font-variant-numeric: tabular-nums;
    color: var(--body);
  }
  .meas-cell-delta {
    width: 46px;
    text-align: right;
    font-family: 'Chivo Mono', monospace;
    font-size: 10.5px;
    font-weight: 500;
    color: var(--muted);
  }
  .meas-cell-delta--over {
    color: var(--accent);
  }
  ```

- [ ] MANUAL VERIFICATION.

  1. Open a segmented real study (with an `L1PA` value), click Find similar, click a demo-study match (demo studies never carry `L1PA`).
  2. Expected: a header row above section `01 — SAGITTAL PARAMETERS` shows the primary ID, the comparison ID, and `Δ`. Each of the six sagittal rows gains an `{other}` value column and a `Δ` column.
  3. Check the `L1 PELVIC ANGLE` row specifically. Expected: its `{other}` cell and its `Δ` cell both read `—`, never `0` or a fabricated number, because the demo study has no `L1PA`.
  4. Check a row where the two studies differ by 5° or more (e.g. `PELVIC INCIDENCE`). Expected: the delta reads with a leading `+` or a proper minus sign (`−`, not a hyphen), one decimal place, and is rendered in the accent color; a row differing by less than the threshold stays in the muted color.
  5. Select a vertebra level. Expected: the corresponding row highlights across the whole row (label, primary value, other value, delta) in both the primary-only view and comparison view.

- [ ] Commit.

  ```
  git add renderer/components/measurements.js styles/screens/analysis.css
  git commit -m "feat: add other-value and delta columns to the measurements table"
  ```

---

## Task 6 — Clinical data grid: two rows in comparison mode

**Files:** `renderer/components/clinical-data.js` (modify)

**Interfaces:**
- Consumes: `renderer/store.js` — `getState()`. Assumes `components/clinical-data.js` already builds the grid's row list from an array of "visible" studies (spec 9.5: "one row per visible study") and renders one row per array entry, with one editable cell per active field in `state.fields`, each bound to `study.clinical[fieldName]`.
- Produces: `visibleStudiesForGrid(state)`.

- [ ] Add the visible-studies helper to `renderer/components/clinical-data.js`.

  ```js
  /**
   * The studies whose clinical fields should render as grid rows: just the
   * open study normally, or the open study plus the comparison study while
   * comparing (spec 9.5 / 10.6 — "one row per visible study").
   * @param {object} state store state
   * @returns {object[]} Study[]
   */
  export function visibleStudiesForGrid(state) {
    const study = state.studies.find((s) => s.id === state.openId);
    if (!study) return [];
    if (!state.compareId) return [study];
    const compareStudy = state.studies.find((s) => s.id === state.compareId);
    return compareStudy ? [study, compareStudy] : [study];
  }
  ```

- [ ] Wire it into the existing grid-row build. Find where `components/clinical-data.js` currently produces the array of studies it iterates to build one grid row each (today, effectively just `[study]`) and replace that expression with `visibleStudiesForGrid(getState())`. No other change is needed — outside comparison mode this returns the same single-element array as before, so the empty-state and single-row rendering paths are untouched.

- [ ] MANUAL VERIFICATION.

  1. Open a segmented study with at least one clinical field added (e.g. `Age`), click Find similar, click a match.
  2. Scroll to the Clinical data drawer at the bottom of the analysis screen.
  3. Expected: the grid now shows two rows — one labelled with the primary study's ID, one with the comparison study's ID — each with its own editable cell per active field.
  4. Click the comparison pane's `×` close button.
  5. Expected: the grid returns to a single row for the primary study; any values already typed into the primary row are unaffected.

- [ ] Commit.

  ```
  git add renderer/components/clinical-data.js
  git commit -m "feat: show a second clinical-data row while comparing"
  ```

---

## Task 7 — End-to-end verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: the full comparison flow built in Tasks 1–6.
- Produces: nothing — confirms the flow specified at the top of this plan works together.

- [ ] MANUAL VERIFICATION — full comparison flow.

  1. Launch the app, acknowledge the landing gate, open Studies.
  2. Open a segmented study (real or demo).
  3. Click the **Find similar** tab. Confirm the eyebrow, up to three ranked cards (thumbnail, ID, match %, note, status line), and the "more studies below threshold" tail line all render.
  4. Click the top match. Confirm, together:
     - The viewer splits into two canvases side by side.
     - The left chip shows only an ID; the right chip shows an ID, a match-score badge, and a close button.
     - The header shows a `COMPARING · {id}` badge.
     - The right panel is visibly wider.
     - The measurements table shows a header row (`{id} | {id} | Δ`) and `{other}`/`Δ` columns on every sagittal row, with absent comparisons (e.g. `L1PA` against a demo study) rendering `—`.
     - The clinical data drawer shows two rows.
  5. Select a vertebra level in the primary (left) pane. Confirm the corresponding measurement row highlights in both value columns, and confirm the comparison (right) pane does not respond to clicks or drags.
  6. Click the comparison pane's close button. Confirm, together:
     - The viewer returns to one full-width pane.
     - The `COMPARING` badge disappears and the right panel narrows back.
     - The measurements table drops its `{other}`/`Δ` columns and header row.
     - The clinical data drawer returns to one row.
     - Back on the Find similar tab, the card's status line reverts to `CLICK TO COMPARE IN VIEWER`.
  7. Repeat step 4 with a second match card instead of the first, and confirm the comparison pane swaps to that study (rather than adding a third pane) — `state.compareId` holds exactly one ID at a time.

- [ ] No commit for this task — it is verification only. If any step fails, fix the responsible task's code, re-run that task's verification, then re-run this end-to-end pass before considering plan 07 complete.
