# Pre-flight conflict report — plan 03 (Analysis screen)

Plan: `docs/superpowers/plans/2026-08-31-03-analysis-screen.md`
Contract: `docs/superpowers/plans/2026-08-31-00-architecture-contract.md`
Built code checked against: `renderer/` as it exists on `my-changes` today.

---

## Cross-task rows

One row per pair of tasks sharing a file or an interface. Strings compared literally.

| Tasks | Produces | Consumes | Result |
|---|---|---|---|
| 1 → 4 | `export function clientToImage(ev, canvas)` in `renderer/viewer/geometry.js` | `import { clientToImage } from './geometry.js';` in `renderer/viewer/interactions.js` | OK |
| 1 → 6 | `export const LEVELS = ['L1','L2','L3','L4','L5']` | `import { LEVELS } from './geometry.js';` in `viewer/canvas.js` | OK |
| 1 → 4 | `geometry.vertebrae[level].quadrilateral`, `geometry.s1_superior` (snake_case) | `vertebraAt` reads both, same spelling | OK |
| 1 → (none) | `nearestLandmark(...) -> { level, corner, distance }` | no consumer in plan 03 | OK (dead export until plan 04; return shape is unpinned by the contract — plan 04 must destructure exactly `level`, `corner`, `distance`) |
| 5 → 6 | `buildLabelColorMap`, `buildOverlayPixels`, `BASE_OVERLAY_ALPHA` (same file) | referenced without import inside `loadStudyImages` / `drawStaticLayer` | OK |
| 5 → 7 | `createLayeredCanvases(host)` returns `{ staticCanvas, dynamicCanvas, staticCtx, dynamicCtx }` **and already calls `host.append(staticCanvas, dynamicCanvas)`** | Task 7 destructures the same four keys, then calls `host.append(staticCanvas, dynamicCanvas);` a second time (plan:1318) | MISMATCH (non-fatal): duplicate append. Re-append is a DOM reorder no-op, but it is redundant code. Delete the Task 7 line. |
| 6 → 7 | `sizeCanvases(canvases, width, height)` reads `canvases.staticCanvas` / `canvases.dynamicCanvas` | Task 7 calls `sizeCanvases({ staticCanvas, dynamicCanvas }, images.width, images.height)` | OK |
| 6 → 7 | `drawStaticLayer(ctx, canvas, images, opts)` reads `opts.overlays`, `opts.overlayOpacity` | Task 7 passes `{ overlays, overlayOpacity }` | OK |
| 6 → 7 | `drawDynamicLayer(ctx, canvas, geometry, opts)` reads `opts.selectedLevel`, `opts.measurements` | Task 7 passes `{ selectedLevel, measurements }` | OK |
| 6 → 7 | `loadStudyImages` returns `{ image, mask, femoral, overlayCanvas, width, height }` | Task 7 re-exports it verbatim; Task 9 uses `images.width` / `images.height` | OK |
| 6 → 9 | `disposeStudyImages(images)` | Task 9 never calls it (imports `mountViewer`, uses `updateViewer`/`setRunHandler`/`detach`/`loadStudyImages` only) | MISMATCH (non-fatal): every re-run leaks the previous `ImageBitmap`s. Call `disposeStudyImages(viewer.__lastImages)` before assigning new images. |
| 4 → 7 | `attachViewerInteractions(stage, canvas, options)` reads `getZoom`, `getPan`, `getPanMode`, `getGeometry`, `onZoom`, `onPan`, `onSelect` | Task 7 supplies exactly those seven keys | OK |
| 4 → 7 | `ZOOM_STEP` is exported by the Task 4 code (plan:777) but absent from Task 4's own **Produces** list (plan:714) | Task 7 imports only `zoomIn`, `zoomOut` | MISMATCH (documentation): Produces list is wrong. Keep the export, fix the list. |
| 4 → 7 | `clientToImage` derives scale from `canvas.getBoundingClientRect()`, which already includes Task 7's CSS `transform: translate(...) scale(zoom)` | Task 7 applies the transform on the host, not the canvases | OK — do **not** "fix" it by subtracting `panX`/`panY`. Undocumented; add a comment. |
| 2 → 8 | Row shape `{ key, label, value, unit, absent, highlight }`; sagittal keys `'LL','PI','PT','SS','PILL','L1PA'`; lordosis keys `'L2-S1'`…`'L5-S1'` (ASCII hyphen) | Task 8 reads all six fields, uses keys as `ROW_LEVELS` lookups and does `row.key.split('-')[0]` | OK on shape/spelling. The hyphen-vs-en-dash split (key `L2-S1`, label `LUMBAR LORDOSIS · L2–S1`) is load-bearing and untested. |
| 2 → 8 | `SAGITTAL_DEFS` gives `PILL` the levels `['L1','S1']` (row highlights for either) | Task 8 `ROW_LEVELS = { …, PILL: 'S1', … }` (click selects S1 only) | MISMATCH: asymmetric read/write for the PI–LL row. Pick one. Plan-internal notes (plan:~30) side with `['L1','S1']`; the click must choose a single level, so `PILL: 'S1'` is defensible — but say so in a comment or the two will drift. |
| 2 → 8 | `sagittalRows(measurements, opts)` reads `opts.selectedLevel`; `discRows()` takes no args; `alignmentRows(study)` ignores its arg; `isConsistent(measurements)` | Task 8 calls all four with matching arity | OK |
| 2 → 8 | `piResidual(measurements)` | Task 8 Interfaces declares it consumed; Task 8 code never imports or calls it | MISMATCH (documentation): drop `piResidual` from Task 8's Consumes line. |
| 6 → 8 | Canvas hardcodes the S1 label as the literal `'S1'` (`drawStageLabel(ctx, 'S1', …)`, `selectedLevel === 'S1'`) | Task 8 writes `selectedLevel` from `ROW_LEVELS[row.key]`, values `'L1'` and `'S1'` | OK — spellings match exactly. |
| 5 → 6 | `LEVEL_RGB` has no `S1` and `buildLabelColorMap` drops label id 25 | Task 6 `drawDynamicLayer` still draws an S1 outline and an S1 stage label | OK by design (matches legacy `renderer.js:44-46`). S1 has geometry but no overlay colour — do not "fix" by adding S1 to `LEVEL_RGB`. |
| 3 → 9 | `toCsv(studies, fields, opts)`, `opts.includeDemo === true` | Task 9: `toCsv(studies.filter(s => s.id === state.openId), state.fields, { includeDemo: true })` | OK on signature. See contract violation 3a for the hardcoded `includeDemo: true`. |
| 7 → 9 | `mountViewer(container)` returns `{ updateViewer, setRunHandler, detach, loadStudyImages, disposeStudyImages }` (5 keys, Step 1 code) | Task 9 uses `updateViewer`, `setRunHandler`, `detach`, `loadStudyImages` | OK against the code. MISMATCH against Task 7's **Interfaces** line, which says it returns `{ updateViewer(study, images) }` only. Fix the Interfaces line to list all five. |
| 7 → 9 | Task 7 has no `__lastImages` in its contract | Task 9 invents `viewer.__lastImages = images` and reads `viewer.__lastImages ?? null` | MISMATCH: undeclared ad-hoc property across a module boundary. Either add `images` to `mountViewer`'s declared surface (e.g. `setImages(images)`) or hold it in `screens/analysis.js` scope. |
| 7 ↔ 9 | Task 7 hardcodes `'Segmenting and measuring…'` and `'Runs three models: vertebral segmentation, S1 keypoint detection, and femoral head fitting.'` inline | Task 9 defines the identical strings as `RUN_LABEL` / `RUN_DETAIL` | MISMATCH: two sources of truth for the same user-visible copy. `RUN_DETAIL` is never referenced anywhere; `RUN_LABEL` is only written into `state.runStage`, which nothing reads. Resolve by having Task 7's run card read `state.runStage`, or delete `RUN_LABEL`/`RUN_DETAIL`/`runStage` from Task 9. |
| 8 → 9 | `mountMeasurements(container)` returns `{ updateMeasurements }` — no `detach` | Task 9's cleanup closure is `() => { unsubscribe(); viewer.detach(); }` | OK (nothing to detach), but note the measurements panel has no teardown path if it ever grows listeners. |
| 8 → 9 | `updateMeasurements(study)` does `clear(root)` and rebuilds every row | Task 9's `update()` calls it unconditionally on **every** store notification, including every `pointermove` pan frame | MISMATCH (performance/UX): full panel teardown + scroll-position reset during a pan drag, plus `JSON.stringify([study.geometry, state.selectedLevel])` per frame in Task 7. Gate `updateMeasurements` on a measurements/selectedLevel key, not on every notify. |
| 9 → 10 | Task 9 `export function render(container)` → returns a cleanup function | Task 10 `export function render(container)` → returns `() => {}` | Internally consistent with each other, but **both** conflict with the built router. See BLOCKING-1. |
| 10 → 9 | Task 10 writes `id: \`SP-DRAFT-${draftCounter}\``, `view: 'Standing lateral'`, `pt` absent, `_fileData: chosen.data`, `filePath: null` | Task 9 reads `study.id`, `study.view.toUpperCase()`, `study.pt ?? '—'`, `study._fileData`, `study.fileName` | OK at runtime within plan 03 (`view.toUpperCase()` yields `STANDING LATERAL`, matching Task 9's verification text). Contract violations 6a/6b/6c apply to `_fileData`, `SP-DRAFT-n`, and `filePath: null`. |
| 10 → 9 | Task 10 sets `screen: 'analysis'` | Task 9's back button sets `screen: 'studies'` | OK — both values exist in `renderer/router.js`'s `SCREENS` map. |
| 1–5, 9 → 11 | Test files `test/geometry.test.js`, `test/measurements.test.js`, `test/csv.test.js`, `test/interactions.test.js`, `test/canvas.test.js`, `test/analysis.test.js` | Task 11 Step 4 runs `node --test test/*.test.js` and expects those six | MISMATCH (documentation): the glob also matches the pre-existing `test/api.test.js` and `test/store.test.js`. Eight files, not six. |
| 6, 7, 8 → 11 | no test files produced | Task 11 Step 4 is the migration gate | OK but note: `viewer/canvas.js` (DOM half), `components/viewer.js`, `components/measurements.js` are covered by manual verification only. |

---

## State-key requirements

Every store key plan 03 touches. All of them already exist in `renderer/store.js`.

`renderer/router.js:75` — `export const SCREEN_KEYS = ['screen', 'ack'];`

**The correct answer for plan 03 is: add nothing to `SCREEN_KEYS`.** Every key below is read by code running inside `screens/analysis.js`'s own `subscribe(update)`, so the screen host does not need to remount for any of them.

| Key | Task(s) | R/W | Add to SCREEN_KEYS? |
|---|---|---|---|
| `screen` | 9 (W: `'studies'`), 10 (W: `'analysis'`) | R/W | Already present |
| `ack` | — | — | Already present (landing.js) |
| `openId` | 9 (R), 10 (W) | R/W | **No** — analysis.js self-subscribes. Already in `SIDEBAR_KEYS`. |
| `studies` | 9 (R + W), 10 (W), 4/7 (R via `getGeometry`) | R/W | **No** — already in `SIDEBAR_KEYS`. |
| `selectedLevel` | 7 (R/W via canvas click), 8 (R/W via row click), 2 (R via `opts`), 10 (W: null) | R/W | **No** |
| `overlays` | 7 (R + W via toolbar) | R/W | **No** |
| `overlayOpacity` | 7 (R + W via FILL slider) | R/W | **No** |
| `showAllLordosis` | 8 (R + W via disclosure) | R/W | **No** |
| `tab` | 9 (R + W via `setTab`) | R/W | **No** |
| `running` | 7 (R), 9 (W) | R/W | **No** |
| `runStage` | 9 (W only) | W | **No** — and nothing reads it; see the T7↔T9 row. |
| `toast` | 9 (W, twice) | W | Already in `TOAST_KEYS`. But write it via `showToast()`, not `setState` — see PLAN-02-4. |
| `fields` | 9 (R, passed to `toCsv`) | R | **No** |
| `zoom` | 7 (R/W), 4 (via `onZoom`), 10 (W: 1) | R/W | **MUST NOT ADD** |
| `panX` | 7 (R/W), 4 (via `onPan`), 10 (W: 0) | R/W | **MUST NOT ADD** |
| `panY` | 7 (R/W), 4 (via `onPan`), 10 (W: 0) | R/W | **MUST NOT ADD** |
| `panMode` | 7 (R + W via toolbar), 4 (R via `getPanMode`) | R/W | **MUST NOT ADD** |

**Reason for MUST NOT ADD**, quoted from `renderer/router.js:79-85`:

> `// zoom, panX, panY and panMode are deliberately absent from every set above: … adding them here would make every pointermove-driven pan frame remount the screen host and destroy the canvas mid-gesture, which is the exact failure mode this file exists to prevent.`

Concretely: `attachViewerInteractions`' `handlePointerMove` → `setState({panX, panY})` → `keysChanged(SCREEN_KEYS)` true → `swap()` `replaceChild`s the screen node → both `<canvas>` elements detach, `staticCtx`/`dynamicCtx` point at orphans, `mountViewer` re-runs, `detach()` is never called so listeners stack per frame. User-visible: the image vanishes on the first drag pixel.

**The trap.** `renderer/router.js:73-74` says: `// studies.js, workspace.js and analysis.js read nothing from state today -- if any of them starts reading a state key, add it here too.` Plan 03 makes both of those modules read state. An implementer following that comment literally will append all seventeen keys, including the four forbidden ones. **Plan 03 must carry an explicit counter-instruction naming `zoom`/`panX`/`panY`/`panMode` as forbidden and stating that the comment does not apply because the screen self-subscribes.**

---

## Per-task self-consistency

| Task | Self-consistent | Detail |
|---|---|---|
| 1 — `viewer/geometry.js` | **NO** | Step 4 says `PASS — 9 tests, 0 failures`; Step 1 defines **10** `test(...)` blocks. Also three different citations for one function: task comment says `renderer.js:608-622`, the function ends at `renderer.js:621`, contract says `renderer.js:597`. Correct span: `renderer.js:608-621`. |
| 2 — `data/measurements.js` | YES | 12 tests declared, 12 defined. Float-boundary assertions verified (`SS:24.0` → residual exactly `1.0` → `<= 1.0` → true; `SS:23.99` → `1.0099999999999980` → false; `deltaRow` 15−10=5 with threshold 5 → `>= threshold` → true). |
| 3 — `data/csv.js` | YES | 3 citation lines (idx 0-2) ⇒ header at `[3]`, data at `[4]` — matches test 4. `MEASUREMENT_COLUMNS` has exactly 10 entries — matches test 3's `for (let i = 3; i < 3 + 10; …)`. 5 tests declared, 5 defined. |
| 4 — `viewer/interactions.js` | YES (code) | 4 tests declared, 4 defined; all zoom arithmetic and `vertebraAt` fixtures check out. Documentation defect only: `ZOOM_STEP` exported but missing from Produces (plan:714 vs plan:777). |
| 5 — `viewer/canvas.js` (pure) | YES | 5 exports declared, 5 defined. `BASE_OVERLAY_ALPHA = 116` consistent in the Interfaces line, the comment (`116 * 0.5 = 58`), and the code; reproduces legacy `[98, 210, 111, 58]` at `renderer.js:464`. 3 tests declared, 3 defined. |
| 6 — `viewer/canvas.js` (DOM) | YES, with one wobble | 7 exports declared, 7 defined. `node --check renderer/store.js` verified runnable (exit 0, Node v24.19.0, because `renderer/package.json` has `{"type":"module"}`). Wobble: `drawStageLabel(…, canvasWidth)` vs `drawMeasurementLabel(…, canvas)` — inconsistent parameter style between sibling helpers. |
| 7 — `components/viewer.js` | **NO** | (a) Interfaces says the mount returns `{ updateViewer(study, images) }`; the code returns 5 keys and Task 9 depends on 3 of the missing ones. (b) Interfaces declares `mount` consumed from `../dom.js`; the code imports only `el`, `clear`. (c) plan:1226's list of hardcoded off-theme colours names 4, one of which (`rgba(250,247,242,.75)`) never appears in this task, while the code hardcodes 12. (d) Step 3 is a checkbox whose body tells you not to do it. |
| 8 — `components/measurements.js` | **NO** | (a) Interfaces declares `piResidual` consumed; never imported. (b) `ROW_LEVELS.PILL = 'S1'` contradicts Task 2's `SAGITTAL_DEFS` `PILL: ['L1','S1']` and plan:~30's mapping table. Also: `onClick: () => {}` plus `cursor:pointer` on every disc-height and alignment row — they look clickable and do nothing. |
| 9 — `screens/analysis.js` | **NO** | (a) Claims `render(container)` matches "the pattern plan 02 establishes for `landing.js`" — `renderer/screens/landing.js:20` is `export function render(state)` returning a Node. (b) MANUAL VERIFICATION step 1 (plan:1743) demands a five-stage cycling eyebrow that the task's own code comment, Task 7's component, and plan:41-48 all reject. (c) Files block omits `renderer/router.js`, which Task 10 Step 3 may require editing — the router change is unowned. Also: `mount` imported and unused; `formatConfidence({femoral:{confidence:0}})` returns `'0%'`, untested. |
| 10 — `screens/studies.js` | **NO** | (a) Files says `Create` only, but Step 3 instructs editing `renderer/router.js`. (b) Step 3 says to follow "the same pattern plan 02 used for `landing`" — doing so yields `render(state) -> Node`, the opposite of the task's own code. (c) `getState` imported, never used. (d) `await selectFile()` is not wrapped in try/catch; the existing file is. |
| 11 — delete `renderer.js` | **NO** | (a) Step 1's grep file list (`index.html main.js preload.js package.json`) cannot see `electron-builder.preview.yml:18`, which is exactly what Step 3b exists to fix; its "Expected" understates the count (2, not 1). (b) Step 1's Expected points at "the listing below", which is the post-edit array that no longer contains `renderer.js`. Both allowlist entries verified present today: `package.json:27`, `electron-builder.preview.yml:18`. |

---

## Contract violations

The contract wins in every case below.

**CV-1 — `el()` must never receive a `style` prop. (Tasks 7, 8, 9, 10 — 51 occurrences)**
Contract, § `renderer/dom.js`: *"Never pass `style`, `dataset`, `list`, or `form` as `el()` props: `'style' in node` is true but `HTMLElement.style` is a readonly `CSSStyleDeclaration`, so `el('div', {style: 'left:12px'})` throws at construction. … set inline styles after construction (`node.style.cssText = …`) or inside an `innerHTML` template."*
Plan, Task 7 (plan:1262): `el('div', { style: 'flex:1;…background:#0B0A09;' })` — and 50 more at plan:1247, 1265, 1269, 1272, 1278, 1283, 1290-1291, 1296, 1300, 1302-1304, 1308, 1312, 1315, 1355, 1460, 1462, 1468, 1470-1472, 1479, 1490, 1496, 1501, 1507, 1513, 1515, 1519, 1521, 1659, 1663, 1665-1666, 1669-1670, 1672-1673, 1675-1678, 1681, 1683, 1687, 1778, 1780, 1782.
Correct value: **do not pass `style` to `el()`.** Move rules into `styles/screens/analysis.css` (see CV-7) and use `class`; where a value is genuinely dynamic (the zoom transform, the slider sync), set `node.style.cssText` / `node.style.transform` after construction.
Empirical note, so nobody is surprised: `renderer/dom.js:12` (`key in node → node[key] = value`) does **not** throw for a string `style`, because `HTMLElement.style` is `[PutForwards=cssText]`. The contract's stated failure mode is wrong; the prohibition still stands and is the right call — it is what keeps CV-7 enforceable. Do not use "it happens to work" as grounds to keep 51 inline style strings.

**CV-2 — Fabricated staged progress survives in the verification checklist. (Task 9)**
Contract, § Global constraints: *"Never display a fabricated measurement."* CLAUDE.md: *"No fabricated status either. … Do not add timed stage labels."* Plan's own decision (plan:41-48): *"An earlier draft of this plan advanced five named stage labels on a 1400 ms timer; that was rejected … Do not reintroduce a stage timer."*
Plan, Task 9 MANUAL VERIFICATION step 1 (plan:1743): *"the needs-run card's eyebrow cycles `PREPARING IMAGE` → `SEGMENTING VERTEBRAE` → `LOCATING S1` → `FITTING FEMORAL HEADS` → `COMPUTING MEASUREMENTS`, holding on the last stage until the real `/predict` response arrives."*
Correct value: a **single indeterminate** running state. Task 7's `'RUNNING'`/`'QUEUED'` eyebrow is correct. Rewrite plan:1743 to assert exactly that. Also strip "staged-progress" from the plan Goal (plan:5), the Task 9 heading (plan:1555), the Task 9 commit message (plan:1739), and the closing paragraph (plan:1935) — a worker treats the verification checklist as the definition of done and will write the timer back in.

**CV-3 — `styles/screens/analysis.css` is never created. (Tasks 7-10)**
Contract, § File structure: lists `styles/screens/analysis.css` among the Analysis screen's files; `index.html` annotated *"shell only — no inline CSS, no inline script."*
Plan: the string `analysis.css` appears nowhere in plan 03; all styling ships as the 51 inline strings of CV-1.
Correct value: create `styles/screens/analysis.css`, **and** add `<link rel="stylesheet" href="styles/screens/analysis.css" />` to `index.html` — currently only five sheets are linked (`index.html:12-16`), so a new file would silently do nothing. Give the screen root `flex:1; min-width:0`, matching `styles/screens/studies.css:1-5` and `styles/base.css:62-64`. `@keyframes spin` already exists at `styles/base.css:77-80`, so the run spinner is fine once the screen has a root.

**CV-4 — Nine extra hardcoded colours. (Task 7)**
Contract, § Colour tokens: *"`styles/tokens.css` defines exactly these, and nothing else defines colours"*, with a single stated exception: *"background `#0B0A09`, label fill `rgba(250,247,242,.75)`, selected accent `#D45A32`, divider `#38342F`. These are hardcoded in `viewer/canvas.js` and must not use the tokens above."*
Plan, plan:1226: *"The off-theme colours below (`#0B0A09`, `rgba(250,247,242,.75)`, `#D45A32`, `#38342F`) are hardcoded inline styles … per the architecture contract's colour-tokens section"* — then plan:1240-1400 hardcodes twelve: the four sanctioned plus `#9A9188` (×6), `#FAF7F2` (×2), `#C9C2B8`, `#181614`, `#FFFFFF`, `rgba(212,90,50,.16)` (×2), `rgba(20,18,16,.85)` (×2), `rgba(250,247,242,.3)`, `rgba(11,10,9,.72)`.
Correct value: only the four sanctioned values may be hardcoded, and only in `viewer/canvas.js`. `#9A9188`/`#FAF7F2`/`#C9C2B8`/`#181614` are verbatim the dark-theme token values (`styles/tokens.css:19-24`) — that is the dark theme reproduced by hand in JS strings, and the default store theme is `'light'` (`renderer/store.js:4`), so the viewer chrome will read theme-inverted beside the light panel. Use `var(--muted)` etc. `#0B0A09` is also in the wrong file (plan:1262 puts it in `components/viewer.js`; the contract assigns it to `viewer/canvas.js`), and plan:1663 derives a new colour outside `tokens.css` via `color-mix(in srgb, var(--sage) 12%, transparent)`.

**CV-5 — `_fileData` is not a `Study` field. (Tasks 9, 10)**
Contract, § Data shapes / Study: enumerates the record's properties; `_fileData` is not among them. § `data/persistence.js`: `validate(raw) // → Study[] throws on bad shape`.
Plan, plan:1806: `_fileData: chosen.data` on the persisted study record; plan:1631 reads `data: study._fileData`.
Correct value: keep the file payload **off** the `Study` record — hold it in a module-scope `Map<studyId, data>` in `screens/studies.js` or `screens/analysis.js`. Otherwise plan 05 either writes megabytes of base64 to disk or throws on `validate`.

**CV-6 — `SP-DRAFT-n` is not a valid Study id. (Task 10)**
Contract, § Study: `id 'SP-0042' (demo) | 'SP-1000'+ (real)`. § `data/persistence.js`: *"`nextId(studies)` // → 'SP-1000' etc, scans real studies only. Real IDs start at `SP-1000`."*
Plan, plan:1793: ``const id = `SP-DRAFT-${draftCounter}`;`` on a record with `source: 'real'`.
Correct value: `SP-1000`+. `nextId` parsing `SP-DRAFT-1` yields `NaN`. Since `data/persistence.js` does not exist yet in plan 03, use a local equivalent (`SP-` + `(1000 + n)`), not a new id namespace.

**CV-7 — `filePath: null` on a real study. (Task 10)**
Contract, § Study: `filePath` is *"absolute path; null for demo"*. § `renderer/api.js`: `selectFile() → {name, data, path} | null`.
Plan, plan:1797: `filePath: null` on `source: 'real'`, discarding the returned path.
Correct value: `filePath: chosen.path`. Verify the main-process handler actually returns `path` — `main.js:34-37` currently returns `{ name, data }` only, so either the handler or the contract needs one line.

**CV-8 — `includeDemo: true` hardcoded on the export path. (Task 9)**
Contract, § `data/csv.js`: `opts.includeDemo` is the escape hatch that otherwise excludes `source === 'demo'`.
Plan, plan:1700: `toCsv(state.studies.filter((s) => s.id === state.openId), state.fields, { includeDemo: true })`.
Correct value: omit `includeDemo` (or pass `false`). A no-op today for a single real study, but plan 05 makes the nine demo studies openable, at which point this export path silently emits fabricated measurements into a research CSV.

**CV-9 — `RESIDUAL_LIMIT` duplicated. (Task 2)**
Contract, § `data/status.js`: `export const RESIDUAL_LIMIT = 1.0` — `status.js` owns it.
Plan, plan:440: `const RESIDUAL_LIMIT = 1.0;` in `data/measurements.js`, commented *"Duplicated here deliberately: this module must not depend on plan 05's file."*
Correct value: one definition. Invert the dependency (plan 05's `status.js` imports `isConsistent`/`piResidual` from `measurements.js`) or add a test asserting the two literals are equal, the way the contract requires for `STORE_VERSION`. Two independent literals for one clinical threshold, with nothing guarding them, is how `deriveStatus` and `isConsistent` end up disagreeing.

**CV-10 — Transient drag state is in the wrong file. (Task 4)**
Contract, § `renderer/viewer/interactions.js`: *"Transient interaction state — the in-flight drag, the hovered handle, and the retrace point buffer are not in `store.js`. They live as module-scope variables in `renderer/components/viewer.js`."*
Plan, plan:837: `let dragStart = null;` inside `attachViewerInteractions` in `renderer/viewer/interactions.js`. `components/viewer.js` holds only `currentImages`, `lastStaticKey`, `lastDynamicKey`.
Correct value: module-scope in `components/viewer.js`. The plan gets the important half right (out of `store.js`) but puts it in a closure `components/viewer.js` cannot reach — so plan 04, which adds landmark drag and hover, must either duplicate drag state across two files (which the contract's last sentence forbids) or refactor Task 4's callback-injection design. Decide before plan 04 starts.

**CV-11 — Plan 03's summary of the contract's `interactions.js` exports is incomplete. (Task 4)**
Contract, § `renderer/viewer/interactions.js`: fixes five things — the `Selection` typedef, `TAB_ORDER` (22 stops), `FULL_ORDER` (24 stops), `nextSelection`, `nudge` — with the note *"`TAB_ORDER` plus the two femoral-head centre stops = 24 stops. This is what Tab/Shift+Tab actually cycles."*
Plan, plan:714: *"`TAB_ORDER`, `nextSelection`, and `nudge` (the landmark-editing exports in the architecture contract's interactions.js section) are not added by this plan — they belong to plan 04."*
Correct value: the deferred set is `Selection`, `TAB_ORDER`, `FULL_ORDER`, `nextSelection`, `nudge`. A plan-04 worker trusting plan 03's enumeration wires Tab to `TAB_ORDER` and the femoral heads become keyboard-unreachable — the exact failure `FULL_ORDER` exists to prevent.

**CV-12 — `tabular-nums` missing on most numerics. (Tasks 7, 9)**
Contract, § Typography: *"All numerics carry `font-variant-numeric: tabular-nums`."*
Plan: applied twice (plan:1472 measurement values, plan:1666 confidence badge); omitted on the zoom readout (plan:1272, `'100%'`, which changes continuously 60%→240% and will jitter), on the footer watermark's ID/age (plan:1251 `footerText`), and on the canvas-drawn measurement labels (plan:~1115/~1123), where the `ctx.font` shorthand cannot express it at all — those need a monospace face or explicit handling.

**Contract errata (the plan is right, the contract is wrong):** contract § `renderer/viewer/geometry.js` says *"`fitCircle` is ported verbatim from `renderer.js:597`"*. Line 597 is `const divisor = augmented[column][column];`, inside `solve3x3`. `fitCircle` begins at `renderer.js:608`. Follow the plan's citation (corrected to `renderer.js:608-621`).

**Checked and clean:** `SS` everywhere and no `SI` anywhere; `LL` keyed `'L1-S1'`…`'L5-S1'`; `qc.femoral.confidence`; `s1_superior[0]=SA`/`[1]=SP`; PI–LL derived as `PI − LL['L1-S1']`, never read from the response; all six sagittal labels byte-identical to the contract table including U+00B7 and U+2013; `toCsv` signature; all nine module paths; `renderer.js` deleted at the end of plan 03 with both allowlists kept in sync; no new dependencies; CSP untouched; `node --test test/*.test.js` in glob form throughout; absent values render `—` (U+2014), never `0`, never `N/A`.

---

## Plan-02 integration conflicts

**P2-1 — Screen-mounting signature is inverted. (Tasks 9, 10)**
Built: `renderer/screens/landing.js:20` is `export function render(state)` and returns a Node; `renderer/router.js:222-231` does `screenNode = swap(appShellNode, screenNode, renderScreen(state), undefined, sameScreen)`; `swap()` at `router.js:137` does `parent.replaceChild(freshNode, oldNode)`. All four existing screen modules follow this.
Plan: Tasks 9 and 10 export `render(container)`, call `clear(container)` / `container.append(...)`, and return a cleanup function. Task 9 claims this *"match[es] the pattern plan 02 establishes for `landing.js`"* — false.
Failure mode: the router passes the frozen `state` object. `clear(state)` silently no-ops (`dom.js:26` loops on `node.firstChild`, `undefined` on a plain object). Then `container.append(...)` throws `TypeError: container.append is not a function`, propagating out of `store.js:61`'s listener loop, out of `setState`, into the sidebar click handler. **User-visible: clicking Studies or Analysis does nothing; one red TypeError in DevTools.** Even reaching `append`, `swap()` would then get a function as `freshNode` → `replaceChild: parameter 1 is not of type 'Node'`.

**P2-2 — No single root element, so the layout collapses. (Task 9)**
Plan Task 9 appends `header` and `body` as two siblings. `.app-shell` is `display:flex` row (`styles/components.css:368-375`), and every existing screen root carries `flex:1; min-width:0`. Two flex children with no root → the header becomes a narrow vertical column beside the viewer.

**P2-3 — Subscription leak on every navigation. (Task 9)**
`render()` calls `subscribe(update)` and returns the unsubscribe in a cleanup closure the router never invokes (under either convention). Each studies→analysis→studies round trip permanently adds a subscriber pointed at a detached tree, each doing a full `clear(root)` + panel rebuild on every subsequent notification. `viewer.detach()` likewise never runs.

**P2-4 — `screens/studies.js` duplication: Task 10 is a destructive rewrite, not a stub creation.**
The file already exists and is *more* complete than the proposed stub: `renderer/screens/studies.js:17-37` renders `.studies-page` / `.studies-page-inner` / `.studies-header` / `.dropzone` with an inline `UPLOAD_SVG`, a `btn btn-primary btn-small` button labelled `'Choose radiograph'` (no ellipsis), the copy `'Drop a DICOM series or lateral radiograph'` / `'De-identified files only. Segmentation runs locally on the workstation.'`, and `showToast`-based error handling around `selectFile()`. Task 10's header says **"Files: Create: `renderer/screens/studies.js`"** and its body opens `// MINIMAL STUB — replaced by the full Studies table, search, and dropzone in plan 05.`
Overwriting it deletes the dropzone, all four `.studies-*` / `.dropzone-*` class hooks, the button styling, and the try/catch — and orphans `styles/screens/studies.css` (all its classes become unused) while `index.html:16` keeps linking it.
Correct shape: **extend** the existing file. Keep `render(state) -> Node` and the dropzone markup; add the `selectFile()` → in-memory Study → `setState({..., screen: 'analysis'})` flow to the existing `handleChoose`, which today only calls `showToast(\`${chosen.name} selected.\`)`. Also note the copy regression: existing label is `Choose radiograph`, the stub writes `Choose radiograph…` (U+2026), and Tasks 9 and 10 both verify against the ellipsis form.

**P2-5 — `screens/analysis.js` already exists; Task 9's expected test failure is wrong.**
The file is five lines: `export function render() { return el('main', { class: 'placeholder-screen' }, el('p', {}, 'Coming soon')); }`. Task 9 says **"Create"** and Step 2 expects `FAIL with Cannot find module '../renderer/screens/analysis.js'`. The module resolves fine; the actual failure is `SyntaxError: The requested module '../renderer/screens/analysis.js' does not provide an export named 'formatConfidence'`. Relabel Create → Replace and fix the expected text.

**P2-6 — Toasts never dismiss.**
Plan Task 9 writes `setState({ toast: … })` directly, twice. The auto-dismiss timer lives in `showToast`, not the store (`renderer/components/toast.js:6-13`, 2200 ms). **User-visible: the "Export ready — see console output" banner sits over the UI permanently.** Use `showToast(...)` at both call sites. Bonus: `router.js` only remounts the toast host when `TOAST_KEYS` change by `!==`, so a second identical export currently produces no toast at all.

**P2-7 — Unlinked stylesheet: none exists, and that is the problem.**
Plan 03 creates no stylesheet and touches no `<link>`, so there is no orphan-sheet hazard. The inverse hazard applies: if CV-3 is fixed by adding `styles/screens/analysis.css`, the `<link>` in `index.html` must be added in the same task or the file silently does nothing (`index.html:12-16` links exactly five sheets today). `styles/screens/studies.css` becomes an orphan only if P2-4 is resolved the wrong way.

**P2-8 — Stale-images ordering bug. (Task 9)**
`setState` notifies synchronously (`store.js:59-64`). Task 9's success path calls `setState(...)` at plan:1638-1644 and only assigns `viewer.__lastImages = images` at plan:1645. `update()` runs during the notification and reads `viewer.__lastImages ?? null` → `null`, so `updateViewer(study, null)` runs: `sizeCanvases` never fires (canvases stay 300×150) and `drawStaticLayer(…, null, …)` just clears. **User-visible: run segmentation, all six measurements populate, the stage stays black until an unrelated click fires the next `update()`.** Task 9's MANUAL VERIFICATION step 1 fails as written. Fix: assign `viewer.__lastImages = images` **before** the `setState` (and see the T7→T9 row — this property should not be ad-hoc at all).

**Checked and clean:** `renderer/api.js:40-53` exports exactly `selectFile`, `predict`, `measure`, `openExternal`; plan 03 imports only `predict` and `selectFile`, and `measure` is correctly deferred to plan 04. `main.js:34-37` returns `{ name, data }`, matching Task 10's `chosen.name` / `chosen.data` reads (but see CV-7 re: `path`). `predict({ name, data, modality, bodyPart, view })` matches `main.js`'s `ipcMain.handle('predict')`. `.eyebrow` exists at `styles/components.css:103-110`. `@keyframes spin` exists at `styles/base.css:77-80`. `--sage`, `--well`, `--card`, `--border`, `--ink`, `--body`, `--muted`, `--accent` all exist in `styles/tokens.css`. No `dataset`, `list`, or `form` props anywhere in plan 03; no array passed as `class`; handler casing (`onInput` → `'input'`, `onClick` → `'click'`) is correct. `index.html:20` is already `<script type="module" src="renderer/main.js"></script>`, so Task 11's Step 1 grep passes once the yml is added to its file list. Task 11 Step 3c's parity script correctly guards the both-stale case with `if (prev.includes('renderer.js')) throw …`.

---

## Blocking vs non-blocking

### BLOCKING

**B-1 — Screen-mounting convention is inverted (P2-1, P2-2, P2-3).**
Decision: convert Tasks 9 and 10 to `export function render(state)` returning a **single root node** — `el('main', { class: 'analysis-screen' }, header, body)` and the existing `el('main', { class: 'studies-page' }, …)`. Drop `clear(container)` / `container.append(...)` / the cleanup return. For the store subscription, either (a) subscribe once at module scope with a guard that no-ops when `getState().screen !== 'analysis'`, or (b) extend `renderer/router.js` to call a teardown returned alongside the node — and if (b), add `renderer/router.js` to a task's Files block, because no task owns it today.
Must reach: **Task 9 and Task 10**, before either is implemented. Task 11's Step 5 walkthrough is gated on it.

**B-2 — `SCREEN_KEYS` must not gain `zoom`/`panX`/`panY`/`panMode` (State-key section).**
Decision: add an explicit instruction to plan 03 — *"Add no key to `SCREEN_KEYS`. `zoom`, `panX`, `panY`, `panMode` are forbidden; `router.js:73-74`'s 'add it here too' comment does not apply because `screens/analysis.js` subscribes to the store itself."* Without it, an implementer following the router's own comment destroys the canvas on the first pan frame.
Must reach: **Task 9** (the module that self-subscribes), stated in its Interfaces block; referenced from **Task 7**.

**B-3 — 51 `style:` props passed to `el()` (CV-1), with no stylesheet to move them into (CV-3).**
Decision: create `styles/screens/analysis.css`, add its `<link>` to `index.html`, give the screen root `flex:1; min-width:0`, and convert all 51 to classes; keep only genuinely dynamic values, set post-construction via `node.style.transform` / `node.style.cssText`. This also resolves CV-4 (nine of the twelve hardcoded colours become tokens) and CV-12 (`tabular-nums` in one place).
Must reach: **Tasks 7, 8, 9, 10** — and the file+`<link>` must be owned by whichever task lands first (Task 7).
Note: `node --check` (Tasks 7 Step 2, 8 Step 2) cannot detect any of this; it only parses.

**B-4 — Fabricated staged progress in Task 9's verification checklist (CV-2).**
Decision: rewrite plan:1743 to assert a single indeterminate running indicator (`RUNNING` / `QUEUED` per Task 7), and strip "staged-progress" from plan:5, plan:1555, plan:1739, plan:1935. This is the project's first non-negotiable; a worker treats the checklist as the definition of done and will reintroduce the timer.
Must reach: **Task 9**, before implementation.

**B-5 — Task 10 destroys the existing Studies screen (P2-4).**
Decision: relabel `Create` → `Modify`; keep the dropzone markup, the `.studies-*`/`.dropzone-*` classes, the `btn btn-primary btn-small` button (label `Choose radiograph`, no ellipsis), and the `showToast` try/catch; add only the study-creation + navigation flow to the existing `handleChoose`. Update Task 10 Step 4 and Task 9's verification to reference `Choose radiograph` without U+2026.
Must reach: **Task 10**, before implementation.

**B-6 — Stale images on the first post-run paint (P2-8).**
Decision: assign the images before the completing `setState`, and replace the ad-hoc `viewer.__lastImages` with a declared surface on `mountViewer` (e.g. `setImages(images)`); call `disposeStudyImages` on the outgoing set.
Must reach: **Task 7** (declare the surface) and **Task 9** (reorder the two statements).

**B-7 — `_fileData` / `SP-DRAFT-n` / `filePath: null` on the persisted Study record (CV-5, CV-6, CV-7).**
Decision: hold the file payload in a module-scope `Map`, keyed by study id, not on the record; use `SP-` + `(1000 + n)`; set `filePath` from `selectFile()`'s `path` (adding `path` to `main.js:34-37`'s return if absent). Plan 05 persists `state.studies`, so all three ship to disk if left.
Must reach: **Task 10** (writes) and **Task 9** (reads `study._fileData`).

### NON-BLOCKING

Fix these in the plan text now; none stops implementation.

- **Task 1 test count**: Step 4 says 9, ten tests defined. Also fix the `fitCircle` citation to `renderer.js:608-621` (contract's `renderer.js:597` is wrong).
- **Task 4**: add `ZOOM_STEP` to the Produces list (plan:714 vs plan:777). Correct plan:714's enumeration of deferred contract exports to include `Selection` and `FULL_ORDER` (CV-11).
- **CV-10** (drag state in `interactions.js` rather than `components/viewer.js`): non-blocking for plan 03, **blocking for plan 04**. Decide the location before plan 04 starts.
- **CV-9** (`RESIDUAL_LIMIT` duplicated): non-blocking; add the equality test or invert the dependency when plan 05 lands `data/status.js`.
- **CV-8** (`includeDemo: true` hardcoded): harmless today, becomes a fabricated-data leak when plan 05 makes demo studies openable. Change it now — it is one token.
- **P2-6** (toasts never dismiss): use `showToast()` at both Task 9 call sites.
- **Task 8 `ROW_LEVELS.PILL`**: reconcile `'S1'` against Task 2's `['L1','S1']`, or comment why they differ.
- **Task 8 dead handlers**: `onClick: () => {}` + `cursor:pointer` on disc-height and alignment rows — drop the handler and the cursor.
- **Task 8/9 panel thrash**: gate `updateMeasurements` so it does not rebuild on pan/zoom frames; drop the per-frame `JSON.stringify(study.geometry)` in Task 7's `dynamicKey`.
- **Task 6 null guard**: `drawSelectedMeasurement`'s S1 branch calls `measurements.PI.toFixed(1)` / `.PT` / `.SS` with no guard, unlike the LL branch. A null PI/PT/SS throws inside the render loop and blanks the dynamic layer. Guard it or state in the plan that those three are never null.
- **Task 6 `drawStageLabel`** returns early when `!selected`, so no level is labelled when `selectedLevel` is null. Confirm that is intended; the name reads otherwise. Also check `STAGE_LABEL_FILL` (near-white, no backing plate) against a bright radiograph region and `STAGE_LINE_COLOR` `#38342F` against a black one during manual verification.
- **Task 7 double `host.append`** (plan:1318) — delete; `createLayeredCanvases` already appends.
- **Task 7 Interfaces**: list all five returned keys; remove `mount` from Consumes; fix the colour enumeration at plan:1226.
- **Task 7 toolbar**: buttons are `div`s (no keyboard focus, no role) and `title` is the glyph itself (`⊕`, `▣`, `⤢`) — give them real tooltips and `<button>`.
- **Task 8 Interfaces**: remove `piResidual` from Consumes.
- **Task 9**: remove the unused `mount` import and the unused `RUN_DETAIL`; drop `RUN_LABEL`/`runStage` or make Task 7 read `state.runStage`; add a CSS rule for `.confidence-value` or use the in-scope node instead of `header.querySelector`; decide what `formatConfidence({femoral:{confidence:0}})` should return (currently `'0%'`, untested); null-guard `runSegmentation`'s `getState().studies.find(...)` so a clinician never sees a raw `Cannot read properties of undefined` in a toast.
- **Task 9**: `study.pt` (demo-only patient field) reads like the `PT` pelvic-tilt key — add a comment so nobody "fixes" it.
- **Task 10**: remove the unused `getState` import; wrap `await selectFile()` in try/catch with `showToast`; `draftCounter` is not reconciled against `state.studies` (moot once B-7 changes the id scheme).
- **Task 11 Step 1**: add `electron-builder.preview.yml` to the grep file list and correct the Expected to two references (`package.json:27`, `electron-builder.preview.yml:18`, both verified present); fix the sentence pointing at "the listing below", which is the post-edit array.
- **Task 11 Step 4**: expected file list is six; the glob also matches `test/api.test.js` and `test/store.test.js` — eight.
- **Task 11 Step 3c**: the script is fenced as `bash` and uses `\$` escapes that only resolve in a double-quoted bash string; this environment's primary shell is PowerShell, where it dies with a TypeError instead of printing `OK: allowlists match`. Run it through the Bash tool explicitly or make it a script file. It also hardcodes the absolute worktree path — use a relative path like every other step.
- **Task 11 Step 5**: stages only `package.json electron-builder.preview.yml`; the `git rm renderer.js` deletion rides along from the index. Non-obvious — a fresh shell after a `git reset` silently drops it.
- **Task 7 Step 3**: a checkbox whose body says not to do it — delete the step.
- **CV-12**: add `font-variant-numeric: tabular-nums` to the zoom readout and footer numerics; the canvas labels need a monospace face.
