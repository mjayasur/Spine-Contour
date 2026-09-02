# Architecture Contract — Spine Contour UI Redesign

> **Read this before any task in plans 01–07.** It fixes module boundaries, function
> signatures, and data shapes. Tasks in separate plans are implemented by workers who
> cannot see each other's code; this document is the only thing keeping their
> interfaces compatible. If a plan seems to contradict this file, this file wins —
> raise the discrepancy rather than guessing.

**Spec:** [`2026-08-31-spine-contour-ui-redesign-design.md`](../specs/2026-08-31-spine-contour-ui-redesign-design.md)

---

## Plan sequence

| # | Plan | Deliverable at the end |
|---|---|---|
| 01 | Preview build isolation | `Spine-Contour-Preview.exe` installs beside the real app |
| 02 | Foundation | Landing + Sidebar, tokens, theme toggle, `SS` rename |
| 03 | Analysis screen | Full measure flow, redesigned — **parity with today** |
| 04 | Landmark editing | Direct manipulation replaces the button matrix |
| 05 | Persistence & Studies | Measurements survive restart |
| 06 | Workspace & clinical data | Folder scan, CSV import, clinical grid |
| 07 | Find similar & comparison | Similarity ranking, side-by-side panes |

Each plan leaves the application launchable and usable. Do not start a plan until the
previous one's final commit is on the branch.

---

## Global constraints

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
- **Node's built-in test runner only.** No Jest, Vitest, or Mocha. The command is
  `node --test test/*.test.js` — verified on Node v24.19.0 on this machine. A bare
  directory argument (`node --test test/`) **fails** with `Cannot find module`, because
  Node treats it as a CommonJS entry point rather than a search root. Do not "fix" it
  back to the directory form.
- `renderer/package.json` and `test/package.json` each contain exactly `{"type":"module"}`
  so Node parses those trees as ESM while the repo root stays CommonJS for `main.js`
  and `preload.js`. This has no effect on Electron, which loads the renderer via
  `<script type="module">` and ignores `package.json` entirely.
- **Every `<script>` is `type="module"`.** No global scope leakage.
- Target Electron 44 / Chromium — modern syntax is fine. No transpilation.
- Commit after every task. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `chore:`).

---

## File structure

Files marked **(new)** do not exist yet.

```
index.html                        shell only — no inline CSS, no inline script
main.js                           Electron main; gains IPC handlers in plans 05–06
preload.js                        contextBridge surface; grows in plans 05–06
store-io.js                       (new, plan 05) disk I/O for the study store

**Why `store-io.js` is at the root and not under `renderer/data/`:** it uses `node:fs`,
and `renderer/` is loaded by the browser through `<script type="module">`, which cannot
resolve `node:` specifiers at all. `renderer/data/persistence.js` therefore stays pure —
IDs, merging, validation — and all filesystem work lives in `store-io.js`, imported only
by `main.js`. Both declare `STORE_VERSION`; a test asserts they stay equal.

styles/                           (new)
  tokens.css                      light + dark custom properties, nothing else
  base.css                        reset, @font-face, element defaults
  components.css                  button, pill, input, card, toast, badge
  screens/landing.css
  screens/workspace.css
  screens/studies.css
  screens/analysis.css

assets/fonts/                     (new) woff2 files

renderer/                         (new)
  main.js                         bootstrap: load studies, mount, subscribe
  store.js                        state container
  router.js                       screen switching
  api.js                          wraps window.spineContour
  dom.js                          el() helper, tiny render utilities

  screens/landing.js
  screens/workspace.js
  screens/studies.js
  screens/analysis.js

  components/sidebar.js
  components/viewer.js            toolbar + canvas host
  components/measurements.js      right panel, Measurements tab
  components/similar.js           right panel, Find similar tab
  components/clinical-data.js     drawer
  components/toast.js

  viewer/canvas.js                layered rendering
  viewer/interactions.js          zoom, pan, select, drag, keyboard
  viewer/geometry.js              circle fit, coordinate transforms

  data/demo-studies.js            the nine fabricated studies
  data/persistence.js             study store read/write
  data/measurements.js            API response → display rows
  data/similarity.js              weighted distance
  data/status.js                  status derivation
  data/csv.js                     parse, auto-map, export

test/                             (new) mirrors renderer/ — node --test
  geometry.test.js  similarity.test.js  status.test.js
  csv.test.js  measurements.test.js  persistence.test.js

electron-builder.preview.yml      (new, plan 01)
.github/workflows/windows-preview.yml   (new, plan 01)
```

`renderer.js` at the repo root is **deleted** at the end of plan 03, once every
behaviour it owns has moved. Do not delete it earlier — plans 02 and 03 reference it.

---

## Data shapes

### Study

The single record type. Demo and real studies share it exactly.

```js
/**
 * @typedef {Object} Study
 * @property {string}  id          'SP-0042' (demo) | 'SP-1000'+ (real)
 * @property {'real'|'demo'} source
 * @property {string|null} filePath   absolute path; null for demo
 * @property {string}  fileName
 * @property {string}  addedAt     ISO 8601
 * @property {string}  view        'Standing lateral'
 * @property {string|null} thumbnail  data URI, max 128px long edge; null if none
 * @property {Measurements|null} measurements  null when never segmented
 * @property {Geometry|null}     geometry
 * @property {Qc|null}           qc
 * @property {Object<string,string>} clinical   field name → value
 */
```

`status` is **derived, never stored** — see `data/status.js`.

Demo studies additionally carry `dx`, `plan`, `hx`, `outcome`, `pt`, `sex`, `age`,
`bmi`, `odi`, `conf` for display. Real studies leave these absent; the UI renders `—`.

### Measurements

Exactly the backend response, after the plan-02 rename.

```js
{
  SS: number,      // degrees — was SI before plan 02
  PI: number,
  PT: number,
  L1PA: number,
  LL: { 'L1-S1': number, 'L2-S1': number, 'L3-S1': number,
        'L4-S1': number, 'L5-S1': number }
}
```

### Geometry

```js
{
  vertebrae: {
    L1: { superior: [[x,y],[x,y]], inferior: [[x,y],[x,y]],
          quadrilateral: [[x,y],[x,y],[x,y],[x,y]] },
    L2: {...}, L3: {...}, L4: {...}, L5: {...}
  },
  s1_superior:     [[x,y],[x,y]],     // [SA, SP]
  l1_center:       [x,y],
  hip_midpoint:    [x,y],
  femoral_circles: [[cx,cy,r],[cx,cy,r]]   // index 0 = left, 1 = right
}
```

### Qc

```js
{ femoral: { method, component_count, circle_union_iou, radii_pixels,
             center_separation_pixels, radius_ratio,
             confidence /* 0..1 */, qc_pass, foreground_pixels } }
```

---

## Module interfaces

Signatures are binding. Do not rename, reorder parameters, or change return types.

### `renderer/store.js`

```js
export function getState()                      // → State (frozen shallow copy)
export function setState(patchOrFn)             // object | (state) => object
export function subscribe(fn)                   // → unsubscribe()
```

`setState` shallow-merges and notifies synchronously. Subscribers must not call
`setState` during notification.

**State shape** — every key, with its initial value:

```js
{
  screen: 'landing',        // 'landing'|'workspace'|'studies'|'analysis'
  ack: false,
  theme: 'light',           // 'light'|'dark'
  navCollapsed: false,
  settingsOpen: false,

  studies: [],              // Study[] — demo + real, merged
  query: '',
  openId: null,
  compareId: null,

  tab: 'meas',              // 'meas'|'sim'
  selectedLevel: null,      // 'L1'..'L5'|'S1'|'PI'|'PT'|'SS'|'L1PA'|null  -- see below
  overlays: true,
  overlayOpacity: 50,       // 0..100
  zoom: 1,
  panX: 0,
  panY: 0,
  panMode: false,
  showAllLordosis: false,

  editing: false,
  selection: null,          // Selection — see viewer/interactions.js
  running: false,
  runStage: null,           // string | null

  wsFolder: null,
  wsFiles: [],              // string[] absolute paths
  wsCsv: null,
  wsCsvHeaders: [],
  wsCsvRows: [],            // Object<string,string>[]
  wsMapping: [],            // Mapping[] — see data/csv.js

  fields: [],               // string[] active clinical field names
  dataOpen: true,
  toast: ''
}
```

### `renderer/api.js`

Every function rejects with an `Error` whose `message` is display-ready.

```js
export async function selectFile()              // → {name, data, path} | null
export async function predict(request)          // → PredictResponse
export async function measure(geometry)         // → {measurements, geometry}
export async function loadStudies()             // → Study[]   (plan 05)
export async function saveStudies(studies)      // → void      (plan 05)
export async function chooseFolder()            // → string|null   (plan 06)
export async function scanFolder(dirPath)       // → {files: string[], skipped: number}
export async function chooseCsv()               // → string|null
export async function readCsv(filePath)         // → string  (raw text)
export async function saveCsv(request)          // → string|null  absolute path, null if cancelled
export async function openExternal(url)         // → void
```

`predict(request)` takes `{name, data, modality: 'xray', bodyPart: 'lumbar', view: 'lateral'}`.
The three selectors are gone from the UI but the values are still sent.

`saveCsv(request)` takes `{text, suggestedName}` and opens the native save dialog. It
resolves to the absolute path written, or `null` when the user cancels — cancelling is not
an error and must not produce a toast. Pulled forward from plan 06 during plan 03's manual
verification: the Export CSV button previously wrote to `console.log` and toasted "see
console output", which is a dead button by the spec's own standard — the same standard that
had `Export PDF report` omitted rather than shipped inert.

### `renderer/dom.js`

```js
export function el(tag, props, ...children)     // → HTMLElement
export function clear(node)                     // remove all children
export function mount(node, child)              // clear + append
```

`el('button', {class: 'x', onClick: fn}, 'Label')`. Resolution order for each `props`
key, in exactly this sequence:

1. `undefined` values are skipped entirely.
2. Keys starting `on` whose value is a function bind a listener
   (`onClick` -> `addEventListener('click', fn)`).
3. `class` is set via `setAttribute('class', value)` — `class`, never `className`.
4. A key that **exists as a property on the node** (`key in node`) is assigned as a
   property: `node[key] = value`.
5. Anything else goes through `setAttribute(key, value)`.

Step 4 is load-bearing and must not be simplified to "everything else sets
attributes". `innerHTML` is how every icon and the landing hero mark are injected,
and `setAttribute('innerHTML', '<svg…>')` is inert — the icons would silently render
as nothing. Booleans are worse: `setAttribute('disabled', false)` sets the *string*
`"false"`, which is truthy to the DOM, so a `disabled: !state.ack` button would be
permanently disabled and the Landing gate would never open.

**Two traps that follow from step 4 — avoid these prop keys.** `key in node` also
matches *inherited, getter-only* IDL properties, and assigning to one throws a
`TypeError` under ESM's strict mode. Never pass `style`, `dataset`, `list`, or `form`
as `el()` props: `'style' in node` is true but `HTMLElement.style` is a readonly
`CSSStyleDeclaration`, so `el('div', {style: 'left:12px'})` throws at construction.
Use flat `data-*` keys instead of `dataset`, and set inline styles after construction
(`node.style.cssText = …`) or inside an `innerHTML` template.

Separately, `class` takes a **string**, never an array: `setAttribute('class', ['a','b'])`
stringifies to `"a,b"` and silently matches nothing. Join conditional class lists
yourself before calling `el()`.

### `state.selectedLevel` — a construction target, not only a vertebra

`selectedLevel` names **which construction the viewer draws**, and its domain is the set of
constructions that exist:

| Value | Construction drawn on the dynamic layer |
|---|---|
| `'L1'`…`'L5'` | that level's superior endplate against the S1 endplate, labelled `LL {level}-S1` |
| `'S1'` | the S1-midpoint-to-hip line, labelled with `PI`, `PT` and `SS` together — the overview you get by clicking the sacrum itself |
| `'SS'` | the S1 superior endplate against a **horizontal** reference through its midpoint |
| `'PT'` | the hip-to-S1-midpoint line against a **vertical** reference through the hip |
| `'PI'` | the S1-midpoint-to-hip line against the **perpendicular to the S1 endplate** at its midpoint |
| `'L1PA'` | two rays from the hip midpoint — one to the L1 body centroid, one to the S1 endplate midpoint — labelled `L1PA` |
| `null` | nothing selected |

Each of `'PI'`, `'PT'` and `'SS'` draws the anatomical line **solid** and its reference axis
**dashed**, so it is never ambiguous which line is measured and which is the datum. The three
constructions are derived directly from the backend's own formulas in
`backend/utils.py:322-331`, so the drawing and the number can never disagree about what is
being measured:

- `SS` is `atan2` of the S1 endplate vector — an angle from the horizontal.
- `PT` is `atan2(s1_mid.x − hip.x, hip.y − s1_mid.y)` — an angle from the vertical.
- `PI` is the angle between the S1→hip connection and the endplate normal.

Anatomical clicks stay coarse: `vertebraAt()` returns only `'L1'`…`'L5'` and `'S1'`, so
clicking the sacrum on the image still gives the three-parameter overview. The precise
single-parameter constructions are reachable only by clicking their row.

**Why `'L1PA'` is in a key called `selectedLevel`.** It is not a vertebral level, and that
reads oddly. The alternative was worse. L1 pelvic angle has a construction of its own — the
angle subtended at the hip between the L1 centroid and the S1 midpoint — which is
geometrically unrelated to lumbar lordosis. Before this amendment the L1PA row mapped to
level `'L1'`, so clicking a row labelled **L1 PELVIC ANGLE** drew the lordosis line and
labelled it `LL L1-S1`. A row that shows you a different measurement than the one it names
is exactly what the "never label a value with a name it isn't" rule forbids, and it was
caught by a human during plan 03's manual verification, not by any test.

Widening this key's domain was chosen over adding a second state key or renaming it to
`selection` — `state.selection` is already taken by the landmark-editing `Selection` typedef
(see `viewer/interactions.js`), and a second key would let the two drift out of sync.

Consequences that bind every plan:

- **`vertebraAt()` never returns `'L1PA'`.** Canvas clicks hit geometry, and there is no
  L1PA polygon — clicking the L1 vertebra still selects `'L1'` and still draws lordosis.
  `'L1PA'` is reachable only by clicking the L1 PELVIC ANGLE row.
- **Row highlighting follows suit.** `sagittalRows`' `L1PA` entry carries `levels: ['L1PA']`,
  so selecting L1 highlights lumbar lordosis and PI–LL mismatch but *not* L1 pelvic angle,
  and vice versa. That asymmetry is the point.
- **Anything switching on `selectedLevel` must handle the non-level values explicitly**
  rather than falling through to an `else` that assumes a vertebral level. The bugs these
  amendments fix were exactly such fall-throughs — first `'L1PA'` drawing lordosis, then
  `PI`/`PT`/`SS` sharing one line and one combined label.
- **`PILL` has no construction of its own** and deliberately maps to `'S1'`: the PI–LL
  mismatch is a relationship between two other measurements rather than an angle in the
  image, so clicking it shows the pelvic overview. If a later plan gives it a construction,
  it needs both the L1–S1 lordosis line and the pelvic line drawn together.

---

### `renderer/data/measurements.js`

```js
/** @typedef {{key,label,value,unit,absent,highlight}} Row */

export function sagittalRows(measurements, opts)   // → Row[]
export function lordosisRows(measurements)         // → Row[]  L2-S1..L5-S1
export function discRows()                         // → Row[]  always absent
export function alignmentRows(study)               // → Row[]  always absent
export function piResidual(measurements)           // → number|null  |PI-(PT+SS)|
export function isConsistent(measurements)         // → boolean (residual <= 1.0)
export function deltaRow(row, otherRow, threshold)  // → {text,overThreshold}
```

`sagittalRows` returns exactly six rows in this order, with these `key` and `label`
values — the labels are user-visible copy and must match verbatim:

| key | label |
|---|---|
| `LL` | `LUMBAR LORDOSIS · L1–S1` |
| `PI` | `PELVIC INCIDENCE` |
| `PT` | `PELVIC TILT` |
| `SS` | `SACRAL SLOPE` |
| `PILL` | `PI–LL MISMATCH` |
| `L1PA` | `L1 PELVIC ANGLE` |

Note `·` (U+00B7) and `–` (en dash, U+2013). `unit` is `'°'` for all six.
`absent: true` when `measurements` is `null`; `value` is then `null` and the UI
renders `—`.

### `renderer/data/status.js`

```js
export const RESIDUAL_LIMIT = 1.0        // degrees
export const CONFIDENCE_LIMIT = 0.6

export function deriveStatus(study)      // → 'seg'|'rev'|'proc'
export function statusLabel(status)      // → 'Segmented'|'Needs review'|'Processing'
```

Rules, in order:
1. `measurements == null` → `'proc'`
2. `piResidual > RESIDUAL_LIMIT` **or** `qc.femoral.confidence < CONFIDENCE_LIMIT` → `'rev'`
3. otherwise `'seg'`

Boundaries are inclusive-pass: residual exactly `1.0` and confidence exactly `0.6`
both yield `'seg'`. Missing `qc` does not by itself force `'rev'`.

**There is exactly one rule, and demo studies are not exempt from it.** All nine demo
studies have internally consistent parameters (residual ≈ 0) and confidence 0.82–0.97,
so all nine derive to `Segmented`. The source mockup labelled two rows `Needs review`
and two `Processing`, but those were arbitrary per-row choices with no underlying
formula; reproducing them would mean storing a status that contradicts the data beside
it, or inventing a lower confidence than the design specifies.

The other two states are still reachable — and reachable *honestly*: `Processing` is
what plan 06's workspace load produces for scanned films that have no measurements yet,
and `Needs review` is what a genuinely poor femoral fit produces. Neither needs faking
in the demo set.

### `renderer/data/similarity.js`

```js
export const WEIGHTS = [1, 0.8, 0.8, 0.6, 1]

export function vector(study)            // → [LL, PI, PT, SS, PI-LL] | null
export function distance(a, b)           // → number
export function matchScore(a, b)         // → number 58..100 (integer)
export function findSimilar(study, all, n = 3)   // → Study[]
```

`distance` is `sqrt(Σ Wᵢ (aᵢ − bᵢ)²)`. `matchScore` is
`max(58, round(100 − distance × 1.35))`. `findSimilar` excludes the study itself and
any study whose `vector()` is `null`, sorts ascending by distance, returns the first `n`.

### `renderer/data/csv.js`

```js
/** @typedef {{src: string, dest: string|null}} Mapping */

export const KNOWN_FIELDS = ['Age','Sex','BMI','Diagnosis','ODI',
                             'Treatment plan','Surgical history','Follow-up','Notes']

export function parse(text)              // → {headers: string[], rows: Object[]}
export function autoMap(headers)         // → Mapping[]   dest null when unmatched
export function toCsv(studies, fields, opts)   // → string
```

`parse` handles quoted fields, embedded commas, doubled quotes, and CRLF.

`autoMap` matches case-insensitively after stripping non-alphanumerics, so
`odi_base` → `ODI` and `age_yrs` → `Age`. It is a **convenience, not an authority**.
It deliberately has no medical synonym table: `dx_text` does not map to `Diagnosis`,
because teaching it `dx` would force teaching it `tx`, and a guess that silently maps
the wrong column is worse than one that maps nothing.

Instead, **the mapping is user-editable**. Each chip on the Workspace screen renders a
`<select>` of `KNOWN_FIELDS` plus `Unmapped`, a field already claimed by another column
is not offered twice, and edits write back to `state.wsMapping`. Rendering reads
`state.wsMapping`, never `autoMap()` directly, so overrides survive re-render; choosing
a new CSV resets to `autoMap`'s output.
`toCsv` emits the citation comment block first, absent values as empty, and excludes
`source === 'demo'` unless `opts.includeDemo` is true. **Measurement columns are written to
one decimal**, matching what the Measurements panel displays, so a value read off the screen
and the same value in the file agree. This also keeps float noise out of the data: for a
study with `PI` 48.6 and `LL['L1-S1']` 49.0, the derived `PI-LL Mismatch` computes to
`-0.3999999999999986`, and sixteen digits of that beside a clean `48.6` in the same row
reads as a defect to whoever opens the file. One decimal is finer than the segmentation's own
accuracy, so nothing meaningful is lost. Clinical fields are user-supplied text and are
never rounded or reformatted.

### `renderer/viewer/geometry.js`

```js
export function fitCircle(points)        // → [cx,cy,r] | null  (needs ≥3, null if collinear)
export function imageToClient(pt, rect, canvas)   // → [x,y]
export function clientToImage(ev, canvas)          // → [x,y]  clamped to bounds
export function nearestLandmark(geometry, clientX, clientY, canvas, radius = 14)
export function landmarkAt(geometry, level, corner)   // → [x,y]
export function setLandmarkAt(geometry, level, corner, point)   // mutates, keeps quadrilateral in sync
export const LEVELS = ['L1','L2','L3','L4','L5']
export const CORNERS = ['SA','SP','IA','IP']
```

`fitCircle` is ported verbatim from `renderer.js:597` — algebraic least squares via
`solve3x3`. Do not reimplement it.

S1 has only `SA` and `SP`. `landmarkAt(g,'S1','SA')` is `g.s1_superior[0]`,
`'SP'` is `[1]`.

### `renderer/viewer/interactions.js`

```js
/** @typedef {{kind:'landmark', level:string, corner:string}
 *          | {kind:'femoral', side:'left'|'right', part:'center'|'rim'}} Selection */

// 22 landmark stops, anatomical order:
//   L1 SA,SP,IA,IP · L2 … · L5 SA,SP,IA,IP · S1 SA,SP
export const TAB_ORDER = [...]

// TAB_ORDER plus the two femoral-head centre stops = 24 stops.
// This is what Tab/Shift+Tab actually cycles; the spec requires the heads to be
// reachable by keyboard, and they are not landmarks so they are not in TAB_ORDER.
export const FULL_ORDER = [...]

export function nextSelection(current, direction)   // → Selection, cycles FULL_ORDER
export function nudge(geometry, selection, dx, dy)  // mutates geometry
```

**Transient interaction state** — the in-flight drag, the hovered handle, and the
retrace point buffer are **not** in `store.js`. They live as module-scope variables in
`renderer/components/viewer.js`, mirroring how `renderer.js` already keeps `dragging`
and `traces` outside shared state. Only committed geometry reaches the store. Plan 07's
comparison pane must not introduce a second copy of these — the comparison pane is
read-only and has no drag state at all.

### `renderer/data/persistence.js`

```js
export const STORE_VERSION = 1

export function nextId(studies)          // → 'SP-1000' etc, scans real studies only
export function merge(realStudies)       // → Study[]  real + demo, real first
export function validate(raw)            // → Study[]  throws on bad shape
```

Real IDs start at `SP-1000`. Demo IDs are `SP-0030`–`SP-0042` and are never written
to disk.

---

## Colour tokens

`styles/tokens.css` defines exactly these, and nothing else defines colours.

`--on-accent` is the foreground for anything sitting on `--accent` — the primary
button label, the checked-checkbox tick. It is deliberately **not** redefined under
`body[data-dark]`: both accents are dark enough for white, so the same value is
correct in both themes, and `--card` is *not* a substitute because it flips to a
near-black in dark mode. `--shadow` is likewise theme-invariant. Both exist so that
"nothing else defines colours" stays literally true — without them, primary buttons
and toasts have to hardcode.

```css
:root {
  --bg:#FEFDFC; --card:#FFFFFF; --well:#F4EEE4; --border:#E5DDD1;
  --ink:#201814; --body:#4A4038; --muted:#8A7E72;
  --accent:#C1502B; --sage:#6E8577;
  --on-accent:#FFFFFF; --shadow:rgba(0,0,0,.18);
}
body[data-dark] {
  --bg:#151312; --card:#181614; --well:#282522; --border:#38342F;
  --ink:#FAF7F2; --body:#C9C2B8; --muted:#9A9188;
  --accent:#D45A32; --sage:#8AA894;
}
```

The viewer stage is deliberately off-theme in both modes: background `#0B0A09`,
label fill `rgba(250,247,242,.75)`, selected accent `#D45A32`, divider `#38342F`.
These are hardcoded in `viewer/canvas.js` and must **not** use the tokens above.

## Typography

`Source Sans 3` for everything, 12–34px. `Chivo Mono` **only** for uppercase eyebrows,
IDs, units, and status labels at 8–12.5px, weight 500, `letter-spacing` 0.08–0.16em.
All numerics carry `font-variant-numeric: tabular-nums`.
