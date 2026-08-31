# Spine Contour — UI Redesign

**Date:** 2026-08-31
**Branch:** `worktree-ui-redesign`
**Status:** Approved design, ready for planning

---

## 1. Problem

Spine Contour today is a single screen. You choose a radiograph, press **Measure radiograph**, and get an annotated canvas with nine angle values in a checkbox strip. It works, but:

- Every measurement label is drawn onto the image, so all nine overlap at once.
- Results cannot be copied, exported, or compared.
- Nothing persists. Measure a film, close the app, the work is gone.
- The landmark editor requires up to 14 button clicks to move one point.
- There is one hardcoded dark theme, no design tokens, and colours are duplicated between `index.html` and `renderer.js`.
- Three dropdowns (Modality, Body part, Laterality) each have exactly one option.
- The backend already returns quality-control data that the UI silently discards.

A Claude Design mockup (`SpineContour Demo.dc.html`) proposes a substantially different product: a five-screen research application with a study library, cohort comparison, and clinical-data capture. This spec covers implementing that design against the real backend.

## 2. Users

**Researchers and clinicians**, in that order.

Researchers need throughput: a folder of films, a clinical CSV, exportable numbers, and a way to find comparable cases. Clinicians need the tool to be unmistakable about what it is — an investigational instrument whose output requires independent verification — and to make model errors visible and correctable rather than hidden.

Both requirements point the same way: show real numbers, mark absent ones absent, never fabricate, and always allow correction.

## 3. Goals

1. Adopt the design's visual language completely — tokens, typography, light and dark themes.
2. Build all five screens: Landing, Sidebar, Workspace, Studies, Study Analysis.
3. Keep every capability the current app has, including landmark and femoral-head correction.
4. Add persistence so measured studies survive a restart.
5. Ship as a **separate installable preview build** that cannot disturb the working release.

## 4. Non-goals

- No change to the segmentation models or their weights.
- No new inference capability. Disc heights and spondylolisthesis slip are not being implemented.
- No PDF report export (see §14).
- No cloud, network, or multi-user features. Everything stays local.
- No refactor of backend measurement maths beyond the naming fix in §11.

## 5. What is real and what is demo

This is the central constraint of the project. **The only fabricated data in the application is the set of nine demo studies.** Everything else operates on real files and real computation.

| Feature | Status | Notes |
|---|---|---|
| Sagittal parameters (LL, PI, PT, SS, PI–LL, L1PA) | **Real** | Computed by the existing backend |
| Segmentation and overlays | **Real** | Existing `/predict` pipeline |
| Landmark and femoral-head correction | **Real** | Existing `/measure` round-trip |
| Femoral fit confidence | **Real** | From `qc.femoral.confidence` |
| Workspace folder scan | **Real** | Electron dialog + `readdir` |
| Clinical CSV import and column mapping | **Real** | Local CSV parse |
| Studies list | **Real + demo** | Real measurements alongside labelled demo rows |
| Find similar | **Real** | Arithmetic over stored studies |
| Export CSV | **Real** | |
| Disc heights (5 rows) | **Absent** | Rendered `—`; see §10 |
| Spondylolisthesis slip | **Absent** | Rendered `—`; see §10 |
| The nine demo studies | **Demo** | Clearly marked in the UI |

Demo studies are visually distinguished in the Studies list with a `DEMO` pill and are excluded from CSV export by default.

## 6. Current state

Worth recording, because the redesign has to preserve it.

**Electron shell** — `main.js` spawns the Python backend on a free `127.0.0.1` port, polls `/health` every 100 ms with a 120 s timeout, and kills it on quit. Packaged builds run `backend-runtime/spine-contour-backend.exe`; development runs `uvicorn backend.server:app`.

**IPC** (`preload.js`, exposed as `window.spineContour`):

| Channel | Arguments | Returns |
|---|---|---|
| `selectFile()` | — | `{name, data}` or `null` |
| `predict(request)` | `{name, data, modality, bodyPart, view}` | `/predict` response |
| `measure(geometry)` | `{vertebrae, s1_superior, femoral_circles}` | `/measure` response |

**`POST /predict`** returns seven keys: `image_png`, `mask_png`, `femoral_mask_png`, `measurements`, `geometry`, `qc`, `labels`. The renderer currently uses the first five; `qc` and `labels` appear zero times in `renderer.js`.

**`POST /measure`** takes geometry only — no image — so re-measuring after a landmark correction is cheap. This is what makes live-updating measurements practical.

**`measurements`** — `SI`, `PI`, `PT`, `L1PA`, and `LL` as a nested object keyed `L1-S1` … `L5-S1`.

**`geometry`** — `vertebrae` (per level: `superior`, `inferior`, `quadrilateral`), `s1_superior`, `l1_center`, `hip_midpoint`, `femoral_circles` as `[cx, cy, r]` pairs.

**`qc.femoral`** — `method`, `component_count`, `circle_union_iou`, `radii_pixels`, `center_separation_pixels`, `radius_ratio`, `confidence` (0–1), `qc_pass`, `foreground_pixels`.

**Error paths** — `400` empty file, `413` over 50 MB, `422` for unsupported modality combinations, missing lumbar levels, no S1 keypoint, or `femoral-head geometry rejected: {reasons}`.

## 7. Architecture

**Vanilla ES modules. No bundler, no framework.**

Rationale: `index.html` ships `Content-Security-Policy: script-src 'self'`, and a build-free app keeps that trivially true. `npm run dev` is currently just `electron .`, and electron-builder's `files` array is an explicit allowlist — introducing a build step is precisely the kind of change that breaks packaging in ways only discoverable after installing. The design's React source is a mockup whose state lives in one `DCLogic` class over fabricated data; we are reimplementing that logic against a real backend regardless, so little is reused by matching its framework.

The cost is more explicit DOM code in the clinical-data grid and comparison view. The benefit is zero build risk on an app distributed as an installer.

```
index.html                     shell only — no inline CSS

styles/
  tokens.css                   light + dark custom properties
  base.css                     reset, @font-face, typography
  components.css               buttons, pills, inputs, cards, toast
  screens/{landing,workspace,studies,analysis}.css

assets/fonts/                  Source Sans 3 + Chivo Mono woff2 (self-hosted)

renderer/
  main.js                      bootstrap, mount, theme init
  store.js                     state, subscribe/notify, no dependencies
  router.js                    screen switching
  api.js                       wraps window.spineContour, normalises errors
  screens/
    landing.js  workspace.js  studies.js  analysis.js
  components/
    sidebar.js  viewer.js  measurements.js  similar.js
    clinical-data.js  toast.js
  viewer/
    canvas.js                  image + mask overlay + landmark rendering
    interactions.js            zoom, pan, select, drag, keyboard
    geometry.js                circle fit, coordinate transforms
  data/
    demo-studies.js            the nine fabricated studies
    persistence.js             read/write the study store
    similarity.js              weighted sagittal distance
    csv.js                     parse + column mapping + export
```

**State** — a single store object with `subscribe(fn)` and `setState(patch)`. Screens render from state; no two-way binding. This mirrors how `renderer.js` already works (module-scope state plus `renderResult()`), but with the globals collected into one place and the render targeted per component rather than redrawing everything.

**Rendering deviation from the design.** The mockup draws the spine as hand-authored SVG paths (`FILMS.A.verts` etc.) because it has no real segmentation. Real output is a raster mask that the current renderer composites pixel-by-pixel at `renderer.js:463`. **We keep canvas rendering** and restyle only the chrome around it. Landmark handles and measurement lines stay on the canvas; toolbar, chips, and panels become DOM.

## 8. Design system

Taken verbatim from the design's `<style>` block.

**Light (`:root`)**

| Token | Value | Role |
|---|---|---|
| `--bg` | `#FEFDFC` | app shell |
| `--card` | `#FFFFFF` | panels, sidebar, inputs |
| `--well` | `#F4EEE4` | icon swatches, hover, table header |
| `--border` | `#E5DDD1` | all dividers |
| `--ink` | `#201814` | primary text and values |
| `--body` | `#4A4038` | secondary text |
| `--muted` | `#8A7E72` | eyebrows, tertiary text |
| `--accent` | `#C1502B` | CTAs, active states, links |
| `--sage` | `#6E8577` | confidence and success only |

**Dark (`body[data-dark]`)** — `--bg:#151312`, `--card:#181614`, `--well:#282522`, `--border:#38342F`, `--ink:#FAF7F2`, `--body:#C9C2B8`, `--muted:#9A9188`, `--accent:#D45A32`, `--sage:#8AA894`.

**Typography** — `Source Sans 3` for everything at 12–34 px. `Chivo Mono` exclusively for small uppercase eyebrows, IDs, units, and status labels at 8–12.5 px, weight 500, letter-spacing 0.08–0.16em. All numeric values use `font-variant-numeric: tabular-nums`.

**Radii** — 7–8 px icon buttons, 10–13 px nav rows and swatches, 12–16 px cards and panels, 999 px pills.

**Motion** — `riseIn` (10 px translate + fade, 0.6 s on entry, 0.18 s on toast), `spin` for loading. Theme transitions on `background` at 0.25 s.

**Off-theme region.** The viewer stage is deliberately fixed dark (`#0B0A09`) in both themes, with its own greys (`#FAF7F2`, `#9A9188`, `#38342F`) and accent (`#D45A32`). Radiographs are read on black; this is correct and intentional.

**Fonts must be self-hosted.** `default-src 'self'` blocks Google Fonts. Ten woff2 files have been extracted from the design bundle into `design_src/`. Both families are SIL Open Font License, so redistribution inside the installer is permitted.

## 9. Screens

### 9.1 Landing

Two-column, full height. Left (40%, max 520 px): hero spine logo with `riseIn`, `spinecontour` wordmark, tagline `VERTEBRAL SEGMENTATION & ALIGNMENT`, version label pinned bottom.

Right: `RESEARCH USE ONLY` pill; heading **"Not for diagnostic or clinical use."**; body copy stating the tool is investigational and unapproved; a citation card with eyebrow `CITATION · REQUIRED FOR PUBLISHED USE` naming **Cody Woodhouse, MD** and **Michael Jayasuria, BS**; an acknowledgement checkbox; and `Enter SpineContour`, disabled until checked.

**Shown on every launch.** The gate is one click and the regulatory framing is the point.

### 9.2 Sidebar

Persistent, collapsible between 228 px and 64 px, with the chevron rotating on toggle. Labels and footer hide when collapsed.

Nav: **Workspace** (with a status sub-label — `NOT SET`, or `9 FILMS · 9 ROWS`), **Studies**, **Settings** (expands to a theme toggle), **Documentation** (opens the README via `shell.openExternal`).

The design also lists **Reports**, which has no click handler and nothing behind it. **Cut it.**

When a study is open, a card shows `OPEN STUDY`, the study ID, and `{view} · {patient}`. Footer: `RESEARCH USE ONLY` and the version label.

### 9.3 Workspace

Scrolling, max 900 px. Heading **"Workspace"** and the reassurance that nothing is uploaded — files are read from disk.

Three step cards:

1. **`01 — IMAGE FOLDER`** — folder picker. On selection, recursively scan for `.dcm`, `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.bmp`. Show the real path, real file count, and real skipped-file count. Border turns sage when set.
2. **`02 — CLINICAL DATA CSV · OPTIONAL`** — file picker, real parse. Show row and column counts.
3. **`03 — COLUMN MAPPING`** — appears once a CSV is loaded. One chip per CSV column showing `source → destination`, auto-matched case-insensitively against the known field names, with unmatched columns marked `Unmapped` in muted styling. Rows join to films on `study_id`; unmatched rows are kept and flagged.

`Load workspace` is disabled until a folder is chosen. Loading creates a study record per film with status `Processing`, then navigates to Studies.

### 9.4 Studies

Scrolling, max 1160 px. Heading **"Studies"** with a `{n} STUDIES · {m} IN QUEUE` summary. Search filters across ID, patient, diagnosis, and view.

Dashed dropzone: **"Drop a DICOM series or lateral radiograph"**, subtext **"De-identified files only. Segmentation runs locally on the workstation."**, and a `Use sample film` button. Drop and click both accept files.

Table columns: `STUDY ID`, `PATIENT`, `VIEW`, `DATE`, `STATUS`, `LORDOSIS` (right-aligned, tabular). Status pills: **Segmented** (sage), **Needs review** (accent), **Processing** (muted). Lordosis renders `—` when unsegmented and switches to accent colour at ≥ 40°.

Demo rows carry an additional `DEMO` pill.

Empty state: **"No studies match that search."**

### 9.5 Study Analysis

**Header** — back chevron, `{id} · {VIEW} · {patient}`, a `COMPARING · {id}` badge in comparison mode, and a right-aligned confidence badge.

The design labels that badge `SEGMENTATION CONFIDENCE`. The backend has no such value — `qc.femoral.confidence` is femoral-fit confidence only. **Label it `FEMORAL FIT CONFIDENCE`** and render `confidence × 100` rounded. Demo studies show their stored value. Studies with no QC data show `—`.

**Viewer** — fixed dark stage. Canvas with the radiograph, the segmentation overlay at adjustable opacity, landmark handles, femoral circles, and measurement lines for selected parameters.

Floating glass toolbar: zoom out, zoom percentage, zoom in, fit, pan toggle, overlay toggle, and a `FILL` opacity slider. Per-pane chip shows the study ID, match score in comparison mode, and a close button. Footer watermark: `{id} · {patient} · {sex} · {age} — NOT FOR CLINICAL USE`.

**Needs-run overlay** — scrim and card over the viewer when a study has no segmentation, with `QUEUED` / `RUNNING` state, explanatory copy, and a `Run segmentation` button wired to `/predict`.

**The running state is honestly indeterminate.** `/predict` is a single
request/response with no progress channel, and §11 rules out adding one. The renderer
therefore cannot know which model is currently executing, so it must not claim to.

The running card shows one animated indeterminate indicator with the copy
*"Segmenting and measuring…"*, above static explanatory text naming what the pipeline
does — *"Runs three models: vertebral segmentation, S1 keypoint detection, and femoral
head fitting."* That text describes the pipeline; it never asserts which stage is
active.

A timed sequence of stage labels was considered and rejected. It would display
*"Locating S1"* at a moment when the backend may still be segmenting vertebrae — a
fabricated status in an application whose organising principle is that nothing shown is
invented. It would also be wrong by varying amounts, since the first run pays
model-loading cost that cached later runs skip.

If real per-stage progress is wanted later, it requires a backend progress channel and
a change to §11.

**Right panel** — 400 px, 440 px in comparison mode. Tabs: `Measurements` and `Find similar`.

**Clinical data drawer** — collapsible, spans the width below the viewer. `ADD FIELD` chips for Age, Sex, BMI, Diagnosis, ODI, Treatment plan, Surgical history, Follow-up, Notes, plus a custom-field input committing on Enter.

The design labels the import button `Import from EMR`. There is no EMR integration and none is planned; it populates from the workspace CSV. **Label it `Import from CSV`** — a button promising EMR data in a clinical tool must not be lying. Fields become removable columns in an editable grid, one row per visible study. Empty state: **"No clinical fields yet — add the fields you want above, or import from the CSV."**

**Toast** — bottom-centre, inverted (`--ink` background), auto-dismissing after 2.2 s.

## 10. Measurements

### 10.1 Mapping

| Design row | Source | Status |
|---|---|---|
| `LUMBAR LORDOSIS · L1–S1` | `measurements.LL["L1-S1"]` | real |
| `PELVIC INCIDENCE` | `measurements.PI` | real |
| `PELVIC TILT` | `measurements.PT` | real |
| `SACRAL SLOPE` | `measurements.SS` (renamed, §11) | real |
| `PI–LL MISMATCH` | `PI − LL["L1-S1"]` | derived |
| `L1 PELVIC ANGLE` | `measurements.L1PA` | real, **added** |
| `02 — DISC HEIGHTS · MM` (5 rows) | none | `—` |
| `03 — ALIGNMENT` → `SPONDY · L4–L5 · MM` | none | `—` |

### 10.2 Additions to the design

**`L1PA` is added as a sixth sagittal row.** The backend computes it, it is clinically meaningful, and the design simply omitted it. Deleting a real measurement to match a mockup is the wrong trade.

**`LL L2–S1` through `L5–S1`** are likewise real today. They go behind a `SHOW ALL LORDOSIS LEVELS` disclosure inside section 01 rather than being discarded.

### 10.3 Absent measurements

Disc heights and spondylolisthesis slip are **not computed by the backend and will not be implemented.** Both sections remain in the layout with every value as `—` and a single muted note: *"Not computed in this build."*

Beyond the missing computation, both are lengths. The design shows them as bare millimetre numbers, but millimetres require pixel spacing, which DICOM carries and PNG/JPG does not. Since the app accepts both, these values are unobtainable for a large share of inputs without a calibration step. Implementing them is a separate project requiring a spec of its own.

### 10.4 Consistency check

`PI = PT + SS` is a geometric identity, but the backend derives all three independently. Compute the residual and, when `|PI − (PT + SS)| > 1.0°`, show an inline accent-coloured warning on the affected rows reading *"Parameters inconsistent — check S1 and femoral landmarks."*

This is free, it catches bad landmarks, and it is exactly the kind of signal a clinician needs.

### 10.5 Find similar

Weighted Euclidean distance over `[LL, PI, PT, SS, PI−LL]` with weights `[1, 0.8, 0.8, 0.6, 1]`, ranked ascending, top 3. Match score `max(58, round(100 − distance × 1.35))%`.

Ranks over **all stored studies**, real and demo. Cards show a thumbnail, ID, match percentage, and clinical note; clicking loads the study as the comparison pane.

### 10.6 Comparison

Selecting a similar study splits the viewer into two panes and adds `{other}` and `Δ` columns to the measurement table. Deltas render signed to one decimal and turn accent-coloured past threshold — 5° for sagittal parameters, 2 mm for lengths.

### 10.7 Export CSV

One row per study, columns for every real measurement plus any clinical fields in use. Absent measurements export as empty, never as `0`. A leading comment block carries the citation text and a `NOT FOR CLINICAL USE` line. Demo studies are excluded unless explicitly included.

## 11. Backend changes

Deliberately minimal.

**Rename `SI` to `SS`.** `utils.py:329` computes

```python
"SI": float(min(abs(math.degrees(s1_angle)), 180 - abs(math.degrees(s1_angle))))
```

where `s1_angle` is the angle of the S1 superior endplate to the image horizontal. That is **sacral slope**. Sacral inclination is measured from the vertical and would be its complement. The current UI therefore displays a value labelled `SI` that is off by 90° from what that name means.

Change the response key to `SS` in both `spinopelvic_measurements` and `spinopelvic_measurements_from_geometry`, update `backend/tests/unit/test_utils.py` and the integration tests, and update the renderer. This is a breaking API change confined to a local backend consumed only by this app.

**Surface `qc` and `labels`.** No backend change — the renderer simply stops discarding them.

No other backend modification is in scope.

## 12. Landmark editing

The current editor works but requires selecting a tool, then a level, then a corner before clicking — up to 14 buttons to move one point. The design removes the feature entirely, which would be a capability regression, and would leave `PI` and `PT` unfixable since both derive from femoral circles the design never draws.

**Replace the matrix with direct manipulation.**

- `Edit landmarks` toggles from the viewer toolbar; `Esc` exits.
- All 22 landmarks (5 levels × 4 corners, plus S1 SA/SP) render as handles. Femoral circles render with a centre handle and a rim handle.
- Hover enlarges a handle and labels it (`L4 SA`).
- Click selects; drag moves. Pointer capture as today.
- `Tab` / `Shift+Tab` cycle in anatomical order — L1 SA, SP, IA, IP, L2 …, S1, left head, right head.
- Arrow keys nudge the selection 1 px; `Shift+arrow` 10 px.
- Femoral heads: drag centre to translate, drag rim to resize, or `Retrace` to place ≥ 3 arc points and refit via the existing least-squares solver at `renderer.js:597`, which is preserved unchanged.
- `Reset to prediction` restores the original geometry.

Measurements recompute on pointer release and after keyboard nudges, debounced at 150 ms, via `/measure`. The existing `measureRevision` guard against out-of-order responses is preserved.

The level and corner grids, the tool grid, and the separate pan tool are all deleted. Panning stays on the toolbar's pan toggle and on middle-drag.

## 13. Persistence

A single JSON file at `app.getPath('userData')/studies.json`.

```jsonc
{
  "version": 1,
  "studies": [
    {
      "id": "SP-0001",
      "source": "real",              // "real" | "demo"
      "filePath": "C:/…/film.dcm",
      "fileName": "film.dcm",
      "addedAt": "2026-08-31T14:22:10Z",
      "view": "Standing lateral",
      "status": "seg",              // seg | rev | proc
      "measurements": { },          // exact /measure response shape
      "geometry": { },              // corrected geometry, not the prediction
      "qc": { },
      "clinical": { "Age": "62" }
    }
  ]
}
```

Full-resolution images are **not** copied into the store — only the source path, plus a downscaled thumbnail (max 128 px on the long edge, JPEG, inline as a data URI) for the Studies and Find-similar cards. If the source file has moved, the study still lists with its measurements and thumbnail but opens to a "file not found" state offering to relocate it.

### 13.1 Study identity and status

**IDs** — real studies get `SP-` plus a zero-padded four-digit counter persisted in the store, starting at `SP-1000` so they never collide with the demo range (`SP-0030`–`SP-0042`).

**Status** is derived, not stored as an independent fact:

| Status | Condition |
|---|---|
| `proc` — Processing | No segmentation yet, or currently running |
| `rev` — Needs review | Segmented, but `\|PI − (PT + SS)\| > 1.0°` or `qc.femoral.confidence < 0.6` |
| `seg` — Segmented | Segmented and both checks pass |

This makes the Studies list's status column carry real information: `Needs review` means the geometry is genuinely suspect and worth opening the landmark editor for.

Written atomically (temp file plus rename) so a crash mid-write cannot corrupt the store. A malformed or unreadable store is renamed aside and replaced with an empty one rather than crashing the app.

Demo studies are compiled into `data/demo-studies.js` and merged at read time; they are never written to disk.

New IPC channels: `loadStudies()`, `saveStudies(data)`, `chooseFolder()`, `scanFolder(path)`, `chooseCsv()`, `readCsv(path)`, `openExternal(url)`.

## 14. Preview build isolation

The working release must be unaffected. Four collision points exist, two of which would silently destroy it.

| | Current | Preview |
|---|---|---|
| `appId` | `org.spinecontour.app` | `org.spinecontour.app.preview` |
| `productName` | `Spine-Contour` | `Spine-Contour Preview` |
| Artifact | `Spine-Contour-Windows.exe` | `Spine-Contour-Preview-Windows.exe` |
| Release tag | `latest-windows`, `--latest` | `preview-windows`, **not** latest |
| Concurrency group | `latest-windows` | `preview-windows` |
| App data | `%APPDATA%\Spine-Contour` | `%APPDATA%\Spine-Contour Preview` |

Windows keys uninstall entries off `appId`; reusing it makes NSIS treat the preview as an *upgrade* and replace the installed app. Reusing the `latest-windows` tag would clobber the installer the README links to, since the workflow publishes with `--clobber` and `--latest`.

Implementation: a new `electron-builder.preview.yml` and a new `.github/workflows/windows-preview.yml`. **`package.json`'s existing `build` block is not edited**, so the path producing the working installer stays byte-identical. The preview workflow triggers on push to this branch and on `workflow_dispatch`.

The app title bar, Landing version label, and sidebar footer all show `PREVIEW` when built from the preview config, so the two are never confused once installed.

## 15. Testing

Pure-logic modules are unit tested with Node's built-in runner (`node --test`) — no new dependencies, no build step:

- `viewer/geometry.js` — circle fitting against known inputs, including the degenerate collinear case that must return `null`; coordinate transforms round-trip.
- `data/similarity.js` — weighted distance, ordering, and match scores, using the nine demo studies as fixtures; a study must never rank as similar to itself, and unsegmented studies must be excluded from ranking.
- Status derivation (§13.1) — each of the three states from representative measurement and QC inputs, including the boundary cases at exactly `1.0°` residual and `0.6` confidence.
- `data/csv.js` — parsing, quoted fields, column auto-matching, unmapped columns, export escaping.
- `data/persistence.js` — round-trip, atomic write, corrupt-store recovery, demo/real merge.
- `measurements.js` mapping — API response to display rows, absent values as `—` and never `0`, the `PI = PT + SS` residual check.

Backend changes are covered by the existing pytest suite, updated for the `SS` rename.

Screen and interaction code is verified by launching the app against a real radiograph. The manual pass covers: acknowledgement gate, folder scan, CSV mapping, run segmentation, each landmark interaction, comparison mode, CSV export, theme toggle in both directions, and sidebar collapse.

## 16. Risks

**Scope.** This is a five-screen application replacing a one-screen one, plus a storage layer and an editor redesign. It should be planned as sequenced phases with the app working at the end of each, not one large change.

**The `SS` rename is a breaking change** across backend, tests, and renderer. It must land as one atomic commit.

**Canvas rendering at high zoom.** The current renderer redraws the full image, overlay, anatomy, and measurement lines on every `pointermove` during a drag. With landmark editing now being the primary interaction, this needs a layered approach — static image and overlay on one canvas, handles and lines on another — or drags will feel heavy on large radiographs.

**Comparison mode doubles rendering cost**, with two full canvases live at once.

**Font weight.** Ten woff2 files add roughly 250 KB to the installer. Acceptable, but subset if it grows.

**Demo data in a clinical tool.** Mitigated by the `DEMO` pill, the viewer watermark, the acknowledgement gate, and exclusion from export — but it must stay unmistakable at every point where a demo number is visible.

## 17. Out of scope

- **Export PDF report.** The design shows the button; building it means a report layout plus `webContents.printToPDF`. Deferred, and the button is omitted rather than shipped dead.
- **Disc heights and slip**, per §10.3.
- **T12.** The design's mock films label a T12 body; the backend segments L1–L5 and S1 only.
- **The `Reports` nav item**, which is a stub in the design with nothing behind it.
- **Multi-view support.** The Modality / Body part / Laterality selectors are removed from the UI, since the backend supports exactly one combination and rejects all others with a `422`. The request continues to send `xray` / `lumbar` / `lateral`.
