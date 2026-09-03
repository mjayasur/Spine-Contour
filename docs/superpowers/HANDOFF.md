# Handoff — Spine Contour UI Redesign

**Last updated:** 2026-09-03
**Branch:** `ui-redesign-cw`
**Worktree:** `C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign`

---

## Where things stand

**Plans 01 through 05 are complete.** Plan 05's implementation (Tasks 0–11, commit range
`c6cf87f..fd8d634` plus the docs commit that closes it out) and its automated verification
are done — the unit suite and every `tools/smoke/` suite are green, and Gate 1 (after Task
9) passed. **Gate 2 (after Task 11) — the final manual verification at the running app —
and the push of `ui-redesign-cw` to `fork` are the one step still outstanding**; see "Tasks
that need the human" below. Plan 06 is next — see "Resume plan 06 here" below for what plan
05 changed under it.

Plan 03 restored parity with the old app and then went past it: the Analysis screen,
the layered viewer, the measurements panel, CSV export to a real file, and the deletion
of the legacy `renderer.js`. 64 tests across eight files.

- **Plan 01** (`c40f944`..`3a95d7d`) — preview installer, verified on real installs: two
  uninstall entries, separate `%APPDATA%` dirs (proved by **inode**, not name — Windows is
  case-insensitive and the name check gives a false pass), distinct window titles, and
  production still measuring after the preview was uninstalled.
- **Plan 02** (`3a95d7d`..`ad1d555`, 40 commits) — the renderer foundation. Landing gate,
  sidebar, tokens, fonts, `SS` rename, router, store, api. Walkthrough verified against the
  running app over Electron's `--remote-debugging-port`, not by proxy.
- **Plan 03** (`ad1d555`..`7de86cd`) — the Analysis screen, layered viewer, measurements panel,
  CSV export, `renderer.js` deleted. Three contract amendments during its manual verification.
- **Plan 04** (`a19befe`..`c687c75`, 33 commits) — direct-manipulation landmark editing: handles,
  hover, drag, femoral centre/rim, retrace + fit, Tab cycle, arrow nudges, reset to prediction,
  re-run, subscriber isolation, a tested `/measure` queue, and draggable construction labels that
  scale with the film. 115 tests across ten files. Three manual gates passed at the running app; 122
  trusted-input smoke checks over CDP, all green.
- **Plan 05** (`c6cf87f`..`fd8d634`, 19 commits, plus the docs commit that closes it out) —
  persistence: `createStudySaver`, a single store subscriber that writes real studies to
  `userData/studies.json` on every `state.studies` change; a `/predict` sidecar per study
  (`userData/predictions/<id>.json`) that makes a persisted study reviewable, correctable and
  resettable after a restart; `state.running` as the running study's id instead of a boolean;
  the Studies screen (summary, search, browse/drop, status and `DEMO` pills, thumbnails); re-run
  reading the film from disk with a relocate flow when it has moved; a refused store (bad record
  identity or an unknown `version`) disabling writes for the session rather than risking an
  overwrite of a newer build's data; `tools/smoke/` promoted into the repo as the verification
  harness. Unit 194/194; `smoke-studies.mjs` 56/56; `smoke-persist.mjs --phase run` 33/33 and
  `--phase restart` 44/44; the plan-04 suites re-run clean (parity 15/15, gate1 25/25, gate2
  32/32, gate3 23/23, chip 20/20 — `smoke-label.mjs` at 9/16 is known plan-04 debt, not a
  plan-05 regression; see `tools/smoke/README.md`). Gate 1 (after Task 9) passed; Gate 2 (after
  Task 11) is the remaining human step, then the push to `fork`.

### Plan 05 amendment (2026-09-02) — historical record

**Plan 05 is now fully implemented (Tasks 0–11); the amendment below is kept as the record
of what was settled before implementation started, not as a starting point.** See "Resume
plan 06 here" for what plan 05 actually changed under the later plans.

The plan-05 document was rewritten in one reviewed pass against the live code at `7d4ab6e`
(12 tasks, `## Task 0` … `## Task 11`), and the architecture contract was amended in the same
pass. Nothing from it is implemented. The pre-flight scan (45 rows), the rulings, and the
two-round independent review live in the plan's SDD workspace,
`.superpowers/sdd/2026-08-31-05-persistence-studies/` (git-ignored): `progress.md` is the
ledger, `amendment-review.md` the review, and `plan05-amendment.diff` /
`contract-amendment.diff` the diffs. The ledger carries `Task N: complete` through Task 10;
Task 11 (this docs pass) and Gate 2 are what remain.

What the amendment settled, in the order a new session will meet it:

- **The live choose → Analysis → run-card flow stays.** Persistence is one store subscriber
  (`createStudySaver`) that writes the real studies whenever `state.studies` changes reference.
  There is no second `/predict` path inside the Studies screen.
- **A prediction sidecar per study** (`userData/predictions/<id>.json`, the raw `/predict`
  response) is what makes a persisted study reviewable after a restart: film, overlay,
  corrected geometry, and a `RESET TO PREDICTION` target. This deviates from spec §13's "no
  full-resolution images in the store" and is the accepted default; the alternative (a model
  run on every first open) was rejected for its 5–60 s cost per study per session.
- **`state.running` becomes the running study's id** (`string|null`) so a second study's card
  cannot claim to be running. One run at a time.
- **No sample film ships** (user decision). The design's `Use sample film` button is not built;
  the existing `Choose radiograph` button and the dropzone (click or drop) are the only ways
  in. The README gets a **Test data** section linking public lateral-radiograph datasets — the
  links are Cody's to supply and had not arrived when this was written; Task 11 carries a
  placeholder instruction.
- **`sourceAvailable` is dropped.** A moved film is discovered when it is needed (re-run), and
  the relocate flow lives there, not on the row click.
- **`validate` throws on a broken record identity or an unknown store version and nulls a
  malformed measurements/geometry pair.** A refused store disables *all* writes for the
  session — `studies.json` and sidecars — so a newer build's data is never overwritten.
- **`store-io.js` is CommonJS** (the root is CommonJS) and must be in both packaging
  allowlists; the plan adds it to both.
- **The Studies screen updates in place** from a module-scope subscription; `SCREEN_KEYS`
  stays `['screen','ack']`.
- **Demo studies open** to a labelled demo card with a DEMO pill in the header; Export CSV
  is disabled for them.
- **Task 0 promotes the CDP harness** into `tools/smoke/` with a launcher
  (`node tools/smoke/launch.mjs`) that runs the app on a scratch profile via
  `SPINE_CONTOUR_USER_DATA`; `main.js` honours that variable in development only. The dev
  profile (`%APPDATA%\spine-contour`) and the future production profile
  (`%APPDATA%\Spine-Contour`) are the same directory on Windows — accepted, noted in the plan.
- **Deferred to plan 06:** deleting a study (and pruning `predictions/`). Thumbnails are
  generated and persisted now but only plan 07 displays them.
- **Two consolidated manual gates:** Gate 1 after Task 9, Gate 2 after Task 11. The controller
  runs the smoke suites before each.

What the review taught, so the next controller does not repeat it: every blocking defect it
found was in plan text that edited an existing `if` block by "adding a branch" without
restating the gate — the new branches were unreachable. The amended tasks now show whole
replacement blocks. When a task edits an existing conditional, insist on the same.

### Resume plan 05 here — what plan 04 changed under you

Plan 04 replaced the button-matrix landmark editor with direct manipulation. The contract was
amended in the same pass (commit `a19befe`), so the interfaces below are already in it; this list
is the *consequences* plan 05 inherits.

**1. `components/viewer.js` owns every pointer and keyboard listener on the stage.** The plan-03
`attachViewerInteractions` is gone; `viewer/interactions.js` is pure logic (zoom steps, hit tests,
Tab order, nudge, debounce) with real tests. One module-scope `drag` covers pan, landmark and
femoral gestures, gated on `pointerId`. Middle-button drag pans in every mode.

**2. Geometry is never mutated in place.** Every edit works on `structuredClone(study.geometry)`
and commits a **new** reference; `updateViewer`'s redraw gate and `router.js`'s key sets both
depend on that. If plan 05 writes geometry from disk, write a new object into `state.studies`.

**3. `/measure` bookkeeping lives in `viewer/measure-queue.js` and is unit-tested.**
`createMeasureQueue(...)` keeps per-study revisions and one owner-tracked debounce; `commitGeometry`
flushes another study's pending correction rather than replacing it; `replaceMeasured(id, geometry)`
runs on a new prediction and on reset and records the geometry the study's numbers now describe.
When a `/measure` call fails at the current revision, the queue restores that geometry and toasts
"The correction was not applied", so the panel never shows numbers beside a geometry they were not
computed from. The queue is module-scope in `viewer.js` and `detach()` deliberately does not clear
it: a correction committed just before navigation still lands on its own study. If plan 05 can
delete a study, call `replaceMeasured` for it first so an in-flight response cannot write to a
reused id.

**4. The prediction snapshot is session-only.** `recordPrediction(studyId, response)` (exported
from `viewer.js`, called by `runSegmentation`) keeps each study's raw `/predict` measurements and
geometry in a module Map. `RESET TO PREDICTION` restores both **without** a `/measure` call — the
backend recomputes `l1_center` from the L1 quadrilateral centroid, not the mask centroid `/predict`
used, so a round-trip would not return the original L1PA. After a restart there is no snapshot and
the reset button is disabled. Plan 05 should decide whether to persist the snapshot beside the
corrected measurements (it is what makes a correction reversible) — if so, off the `Study` record
or as a validated field, and re-record it on load.

**5. `filePayloads` are session-only too.** Re-run segmentation (new toolbar button) needs the raw
bytes; after a restart the handler toasts "file is no longer available". Plan 05 should re-read
from `filePath` when the payload map is empty.

**6. Opening a study must change `screen`, or the viewer must re-key on `openId`.** Setting
`openId` while already on Analysis does not remount the viewer (`SCREEN_KEYS` gates on `screen`),
so `mounted.studyId` goes stale, `setImages` is skipped, and the new study's geometry draws over
the previous study's bitmaps. Unreachable today — `studies.js` always sets `screen` too — but a
studies list that opens a study from inside Analysis would hit it. Also reset `editing: false,
selection: null` on every path that changes `openId` (`handleChoose` and the back button do).

**7. `running` is one global flag.** With a list that can reopen an already-segmented study while
another is mid-run, that study's card would show RUNNING and its edit/re-run buttons disable
(plan-03 deferred minor, widened by the re-run affordance; unreachable until a list exists).

**8. `store.js` isolates subscribers.** A throwing subscriber is reported through `console.error`
and no longer stops the ones after it. Check DevTools during verification: a red line there is a
real defect that used to freeze the UI.

**9. A selected construction can be cleared** (Gate 1 finding): clicking the selected row or
vertebra again, clicking empty stage, or Escape outside edit mode sets `selectedLevel` back to
`null`. Inside edit mode Escape still means "exit editing".

**10. The stage literal set grew** (contract colour section): the handle outline uses the stage
background, per-corner handle colours, the femoral handle colour derived from the overlay green,
and the retrace point colour — pixels drawn into the canvas, in edit mode only.

**11. The construction label is a DOM chip that scales with the film** (Tasks 20–21, user requests
after Gate 3). `canvas.js` exports the pure `constructionLabel(geometry, selectedLevel, measurements)`
→ `{ text, anchor, side } | null` and draws no measurement text; `viewer.js` renders `.viewer-label`
INSIDE the transformed host, so the host's translate/scale pans and zooms it with the film, it can
sit in the black stage around the film, and it drags by its own pointer events. Offsets are kept in
image px per construction for the open study (`labelOffsets`, cleared on study change and `detach`)
and are session-only; if plan 05 wants them to survive a restart they belong beside the corrections.
While editing the chip is pointer-transparent and faded so it can never block a handle. Endplate
labels anchor 15% of the endplate beyond the anterior corner; hip-line labels at their midpoint.

**Verification harness, worth keeping.** `.superpowers/sdd/2026-08-31-04-landmark-editing/` is
git-ignored scratch, but its `cdp-lib.mjs` (trusted mouse/keyboard input over
`--remote-debugging-port=9222`, console-error capture, `Browser.close` for clean restarts),
`cdp.mjs`, `inject-study.js` / `run-and-wait.js` (open and segment a sample without the native
dialog) and the four `smoke-*.mjs` suites are what verified plans 03–04's canvas and pointer code.
Every defect found at the app in plan 04 was caught by them or by the user; none by the unit
suite. Promote them into the repo before plan 05's verification rather than rewriting them.

**Accepted limitations, so they are not rediscovered as bugs** (plan BD-11): a measurement label on
the stage shows the last computed value beside a moved line for ≤150 ms plus one round-trip; after
the first `/measure`, `l1_center` is the L1 quadrilateral centroid (old-app behaviour); retrace has
no per-point undo (toggling RETRACE off clears); while editing, Tab is the handle cycle everywhere
except inside the edit bar. The segmentation fill is the model's mask and does not follow a dragged
corner — the measurements come from the geometry; and a rim resize does not move the hip midpoint,
which is the mean of the two centres.

### Resume plan 06 here — what plan 05 changed under you

Plan 05 added persistence and the Studies screen. The contract was amended in the same pass
(`9a6a583`), so the interfaces below are already in it; this list is the *consequences* plan
06 inherits.

**1. Persistence is one store subscriber.** `createStudySaver` (`renderer/data/persistence.js`)
is subscribed in `renderer/main.js` and writes the real studies to `userData/studies.json`
whenever `state.studies` changes reference — a chosen film, a completed run, every `/measure`
correction, a relocation. Demo studies are filtered out and never written. `addStudy`
(`renderer/screens/studies.js`) is the entry point for **one film arriving interactively**
(picker or drop): it inserts at the front, parks bytes in `filePayloads`, resets view state,
and navigates to Analysis. **Do not call it in a loop.** A **multi-file folder scan must
instead build records with `newStudy` and commit them in one new-array `setState`**
(front-inserted, newest first), leaving `openId`/`screen` alone — the saver persists that
single reference change on its own. Bytes are not parked for a scan; a scanned study runs
later through the normal re-run path, which reads from `filePath`. No new `/predict` path.

**2. The prediction sidecar** (`userData/predictions/<id>.json`) is the raw `/predict` response,
written by `runSegmentation` before the record's numbers are committed and read lazily by
`restoreFilm` when a persisted study is opened with no cached bitmaps. The record keeps the
corrected geometry; the sidecar keeps the model's. `recordPrediction(studyId, sidecar,
study.geometry)`'s third argument is the geometry the study's current numbers describe, so a
failed `/measure` restores the correction, never the prediction. Missing sidecar →
`FILM UNAVAILABLE` card; a re-run recreates it. Ids are validated in the main process
(`/^SP-\d{4,}$/` and ≥ 1000) so a sidecar path cannot leave `predictions/`.

**3. `state.running` is the running study's id** (`string|null`), not a boolean. Truthiness
still means "a run in flight"; the viewer keys its card and edit button on
`running === study.id`, and the Studies list badges that study `Processing`. One run at a time
— study B stays editable while A runs, but cannot start a second run.

**4. `filePath` is the film's identity; bytes are never stored.** A re-run takes them from this
session's `filePayloads`, else `api.readFile(filePath)`, and when that is `null` toasts
`<fileName> was not found. Choose its new location.` and opens the picker; a relocation
rewrites `fileName`/`filePath` on the record before the run. A module-scope `locating` flag
refuses a second run while the picker is open *without* setting `running` (no fabricated
status).

**5. A refused store disables all writes for the session.** `validate` throws on a bad record
identity or an unknown store `version`; `renderer/main.js` catches it, runs on the demo
studies, and calls `api.disablePersistence(reason)` — after which `saveStudies` and
`savePrediction` both reject, so a newer build's data is never overwritten. Corrupt
(unparseable/wrong-shape) files are quarantined by `store-io.js` as `studies.json.corrupt-<ts>`
with bytes intact.

**6. `validate` nulls a malformed `measurements`/`geometry` pair** (both together, one
`console.warn`) rather than throwing, so one bad payload cannot discard the whole store — that
study shows `Processing` and a re-run restores it.

**7. Demo studies open to a `DEMO STUDY` card; Export CSV is disabled for them** (tooltip
explains), and the header carries a `.pill-demo`.

**8. Thumbnails** (`≤128px` JPEG data URIs, `thumbnailDataUri` in `viewer/canvas.js`) are
generated at run completion and persisted on the record. Nothing displays them yet — plan 07's
cards consume them.

**9. `store-io.js` is CommonJS at the repo root** and is in both packaging allowlists
(`package.json` `build.files` and `electron-builder.preview.yml`). Any new root file `main.js`
requires must go in both.

**10. The dev profile is the production profile on Windows** (`%APPDATA%\spine-contour` vs
`Spine-Contour`, case-insensitive). `SPINE_CONTOUR_USER_DATA` (honoured only when
`!app.isPackaged`) redirects a run; `tools/smoke/launch.mjs` sets it to a scratch directory and
*wipes* that directory unless `SMOKE_KEEP_PROFILE=1` — never point it at a real profile.

**Verification harness, worth keeping.** `tools/smoke/` is now in the repo (Task 0); see
`tools/smoke/README.md` for the run order and preconditions. Baseline at this branch's tip:
unit 194/194; `smoke-studies.mjs` 56/56; `smoke-persist.mjs --phase run` 33/33 and
`--phase restart` 44/44; the plan-04 suites `smoke-parity` 15/15, `gate1` 25/25, `gate2` 32/32,
`gate3` 23/23, `chip` 20/20. Three harness facts worth their own lines: `launch.mjs` refuses a
CDP port another instance holds (exit 3) and gates `ready` on a real page target; never
interleave `smoke-studies.mjs` between the two persist phases (it re-injects `SP-9000`
unsegmented, destroying the corrected geometry `--phase restart` compares against);
`smoke-label.mjs` is known-failing at 9/16 — plan-04 debt, it tests the canvas-drawn label
plate that Task 21 replaced with the DOM chip (`smoke-chip`, green), proved identical on the
unmoved original. Do not present it as a plan-05 regression.

**Known gap, stated honestly.** "A failed `/measure` on a restored study restores the
correction, not the prediction" has no automated coverage. `smoke-persist.mjs --phase
measurefail` exists and self-gates but cannot be run: `contextBridge` freezes
`window.spineContour` against stubbing, and every route to a genuinely failing `/measure`
raises a blocking modal (`main.js:253-256` on backend exit; the `app.whenReady()` catch when
it never starts) that wedges CDP. Covered by code review and the manual gate, not by the
suite. See `tools/smoke/README.md`'s "`--phase measurefail` is parked" section before trying
to make it runnable.

**Rough edges for plan 06 to know about.** A run's completion clears `editing`/`selection`
globally, so a user mid-edit on study B loses edit mode when study A finishes (newly reachable
because B stays editable). While the relocate picker is open the Re-run buttons still render
enabled and a click is silently swallowed by `locating` (correct per the no-fabricated-status
rule, but worth a real disabled state later). `predictions/` is never pruned. The `DEMO` pill
is built in `render()`, not `update()` — safe today only because every writer also sets
`screen`.

### Distributing a build from this branch

Plan 02's Task 19 removed the old single-screen UI and plan 03 restored parity, so this
branch is now worth building. Pushing `ui-redesign-cw` to `fork` triggers **only** the
preview installer workflow, which publishes to a `preview-windows` prerelease and cannot
touch the production `latest-windows` release the README links to.

Still true, and still the reason not to merge: `windows.yml` has no repository guard, only
`branches: [main]`. Merging this branch into the fork's `main` would run the production
workflow on the fork and publish a release tagged `latest-windows`, flagged `--latest`,
containing redesign code.

### Running from source

`npm run dev` in this worktree fails with `backend exited with code 9009` — `.venv` is
gitignored so the worktree has none and it falls back to a bare `python` that isn't on PATH.
Set `SPINE_CONTOUR_PYTHON` to the main directory's venv python first:

```
$env:SPINE_CONTOUR_PYTHON = "C:\Users\codyj\spine contour\.venv\Scripts\python.exe"
npm.cmd run dev
```

(`npm.cmd`, because PowerShell's execution policy blocks `npm.ps1`.)

**"Process alive" is NOT evidence of a successful launch.** A fatal startup error shows a
*modal dialog*, which keeps the process running — several verification passes in plans 01
and 02 reported false positives this way. Check for a real window title, or drive the app
over `--remote-debugging-port=9222` and assert against the live DOM.

## Carry into plan 03 (inherited from plan 02)

Two latent traps the final review flagged. Neither is a present defect; both should land
early, before plan 02 adds its first new top-level directory.

1. **The two `files` allowlists are guarded only by prose.** Add an executable parity
   check comparing `electron-builder.preview.yml`'s `files:` block against
   `package.json` `build.files`, failing the build on divergence. A missing entry ships an
   installer that opens a blank window while CI stays green. Plan 01 contains a worked
   example of prose-as-guard failing: a confident comment claimed `productName` gave a
   separate `%APPDATA%` folder, and it did not.
2. **The renderer test gate is unfailable two ways.** `Test renderer` carries
   `continue-on-error: true`, *and* `node --test 'test/*.test.js'` exits 0 reporting
   `tests 0` when nothing matches. Drop `continue-on-error` and assert a non-zero test
   count when `test/` lands, otherwise the gate is permanently green. Note `windows.yml`
   has no renderer test step at all, so the preview workflow is the only place the
   redesign's tests will ever run in CI.

**Do not merge `ui-redesign-cw` into the fork's `main`.** `windows.yml` has no repository
guard, only `branches: [main]` — merging there would run the production workflow on the
fork and publish a release tagged `latest-windows`, flagged `--latest`, containing
redesign code. `windows-preview.yml` has such a guard (`if: github.repository == ...`);
`windows.yml` does not, and editing it was out of scope for plan 01.

**Upstream carry-forward:** `mjayasur/Spine-Contour`'s `windows.yml` does the identical
packaging with no disk mitigation, so it may be one runner-image change from the same
failure. It fails *closed* — no `if:` conditions, so a packaging failure skips the publish
step and `gh release upload latest-windows --clobber` never runs; the existing asset
survives and users see a stale release, never a broken one. Worth raising upstream with
the diagnosis and the one-step fix.

## What is being built

A Claude Design mockup (`design-reference/template.html`) replaces the current
single-screen app with a five-screen research tool: Landing gate, collapsible Sidebar,
Workspace (folder + clinical CSV), Studies library, and Study Analysis with comparison
and cohort matching. Warm light/dark token system replaces the hardcoded GitHub-dark
theme.

**The user's overriding constraint:** the working production installer must not break.
Plan 01 exists to prove that before any UI work begins.

## Execution order

Plans are sequenced. **Do not start one until the previous plan's final commit is on
the branch.** Each leaves the app launchable.

| # | Plan | Tasks | Deliverable |
|---|---|---|---|
| 01 | `2026-08-31-01-preview-build.md` | 4 | **DONE** — preview installs beside the real app |
| 02 | `2026-08-31-02-foundation.md` | 20 | **DONE** — Landing, Sidebar, tokens, `SS` rename |
| 03 | `2026-08-31-03-analysis-screen.md` | 11 | **DONE** — Analysis screen, parity restored, `renderer.js` deleted |
| 04 | `2026-08-31-04-landmark-editing.md` | 19 | **DONE** — direct manipulation, retrace, reset, re-run |
| 05 | `2026-08-31-05-persistence-studies.md` | 12 | **DONE** (Gate 2 pending) — measurements, film and corrections survive restart |
| 06 | `2026-08-31-06-workspace-clinical-data.md` | 6 | Folder scan, CSV import |
| 07 | `2026-08-31-07-similar-comparison.md` | 7 | Ranking, side-by-side |

79 tasks total (plan 05 grew from 10 to 12 tasks in its 2026-09-02 amendment).

`2026-08-31-00-architecture-contract.md` is not a plan — it is the binding interface
definition shared by all seven. Read it before every plan. **It wins over any
individual plan.**

## Tasks that need the human

Most tasks are autonomous. These are not:

- ~~**Plan 01, Task 4**~~ — done. Actions enabled, both apps installed, two uninstall
  entries confirmed, uninstall proved non-destructive.
- **Prefer a programmatic check over a human one where the OS exposes the fact.**
  Window titles are readable with `Get-Process | MainWindowTitle`; directory identity is
  readable by inode (`ls -di`). Plan 01 shipped a title bug precisely because the
  substituted check proved the process survived rather than reading the title, and the
  plan’s own name-based `%APPDATA%` check would have passed falsely on a shared folder.
- **Every task whose verification step says MANUAL VERIFICATION** — canvas rendering,
  pointer interaction, and screen layout cannot be unit tested here. These steps list
  exact clicks and exact expected results. They are real gates, not formalities.
- ~~**Plan 05, Gate 1 (after Task 9)**~~ — done. Covered the Studies screen, the picker and a
  real drag-and-drop (the one check that proves a dropped `File` crosses the context bridge
  with its path), opening a demo study, thumbnails, and the sidecar restore.
- **Plan 05, Gate 2 (after Task 11) — pending.** Covers restart survival, re-run from disk,
  relocating a moved film, and corrupt and refused stores. The controller runs the full unit
  suite and the `tools/smoke/` suites first, then this gate at the running app, then pushes
  `ui-redesign-cw` to `fork`.

## Decisions already made — do not relitigate

These were settled with the user during brainstorming. Changing them needs their
explicit say-so.

1. **Full design, all five screens.** Only the nine demo studies are fabricated;
   everything else runs on real files and real computation.
2. **Disc heights and slip are not implemented.** They render `—` with the note
   "Not computed in this build." Both are lengths and need pixel spacing that PNG/JPG
   inputs lack.
3. **`L1PA` is added** as a sixth sagittal row, and `LL L2–S1`…`L5–S1` go behind a
   disclosure. The mockup omitted real backend output; we don't delete working
   measurements to match a mockup.
4. **`SI` → `SS` rename** is a breaking change across backend, tests, and renderer,
   landing as one atomic commit in plan 02.
5. **Landmark editing is kept and redesigned** to direct manipulation. The mockup
   dropped it entirely, which would have made `PI`/`PT` unfixable since both derive
   from femoral circles the design never draws.
6. **Segmentation progress is indeterminate.** Timed stage labels were explicitly
   rejected as fabricated status.
7. **`Reports` nav item is cut** (a dead stub). **`Export PDF report` is deferred** —
   button omitted rather than shipped dead.
8. **`Import from EMR` is relabelled `Import from CSV`.** There is no EMR integration.
9. **CSV column mapping is user-editable** via a dropdown per chip, rather than
   teaching `autoMap` medical synonyms that would guess wrong elsewhere.
10. **Demo studies get no status exemption.** All nine derive to `Segmented`. The other
    two states are reachable honestly — `Processing` from a workspace scan,
    `Needs review` from a genuinely poor femoral fit.
11. **No sample film ships with the app** (2026-09-02). The design's `Use sample film`
    button is cut; people test with their own films or with the public datasets the README
    links. No radiograph of unknown provenance goes into an installer. **The links themselves
    have not arrived from the user as of this writing** — README's "Test data" section carries
    a marked placeholder (`<!-- TODO: public dataset links to be supplied -->`) until they do.
12. **The prediction sidecar is accepted despite spec §13's "no full-resolution images in the
    store."** Without it a persisted study cannot be redrawn, corrected, or reset after a
    restart; the alternative — a model run on every first open — costs 5–60 s per study per
    session.
13. **`state.running` is a study id, not a boolean; `sourceAvailable` is dropped.** A moved
    film is discovered when it's needed, at re-run, not by a background check on the row.
    Deleting a study and pruning `predictions/` are plan 06's.
14. **Demo studies are gated on the build channel for release** (2026-09-03, decided at
    Gate 1): kept in dev and the preview installer, absent from the production build. This
    is a release-prep task, not part of plan 05 or plan 06 — carried as a named prerequisite
    below, not yet implemented.
15. **Plan 06 (Workspace & clinical data) is next; plan 07 (Find similar & comparison) is
    deferred past the first release.**
16. **Before anything is pushed to the fork's `main`, the branch is tested through the
    preview installer.** Recorded alongside the other release prerequisites below.

## Release prerequisites — before a production release, not before plan 06

These do not block plan 06 (they are about shipping `latest-windows`, not about the next
plan's code) but must not be forgotten before that happens:

- **Gate demo studies on build channel.** Dev and the preview installer keep the nine demo
  studies; the production build must exclude them. Not yet implemented (decision 14 above).
- **Add a repository guard to `windows.yml`.** It currently has only `branches: [main]`,
  unlike `windows-preview.yml`'s `if: github.repository == ...`. Merging this branch's
  descendants into the fork's `main` without that guard would run the production workflow on
  the fork and publish a release tagged `latest-windows`. See "Distributing a build from this
  branch" above.
- **Supply the README's public dataset links.** Currently a marked placeholder (decision 11
  above).
- **Test the branch through the preview installer before pushing to the fork's `main`.**
  (decision 16 above).

## Known traps

- **`node --test test/` fails on Node 24.** Use `node --test test/*.test.js`.
- **Two electron-builder file allowlists exist** and must stay in sync. Plans 02 and 03
  each contain an assertion step that diffs them.
- **`renderer/` cannot import `node:fs`.** It is loaded by the browser through
  `<script type="module">`. Disk I/O lives in root-level `store-io.js`.
- **`design-reference/` is required, not decorative.** Plan 02 sources the ten woff2
  fonts from `design-reference/design_src/`; plan 05 sources a sample radiograph from
  the same place.
- **LFS bandwidth is NOT a problem — do not chase it.** Plan 01 lost time suspecting it.
  Measured in CI: `actions/checkout` with `lfs: true` takes ~54s and `git lfs pull` takes
  **1 second**. If a build is slow or dies, look at packaging, not LFS.
- **LFS quota.** Pushing this branch uploaded 432 MB of model weights to the fork, about
  43% of GitHub's free 1 GB. Avoid branches that touch `backend/weights/`.

## Recovering the design source

`design-reference/template.html` is already extracted. If it is ever lost, the original
export is a self-extracting bundle and `design-reference/unpack_design.py` regenerates
the assets:

```bash
"C:/Users/codyj/spine contour/.venv/Scripts/python.exe" design-reference/unpack_design.py
```

The Claude Design MCP is **not** available — the account lacks Claude Design
entitlement (`HTTP 403`), and `/design-login` does not exist in CLI 2.1.251. Do not
retry it; use the extracted files.
