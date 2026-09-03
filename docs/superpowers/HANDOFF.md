# Handoff — Spine Contour UI Redesign

**Last updated:** 2026-09-02
**Branch:** `ui-redesign-cw`
**Worktree:** `C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign`

---

## Where things stand

**Plans 01 through 04 are complete, reviewed, and user-verified.** Plan 05 is next.

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
| 05 | `2026-08-31-05-persistence-studies.md` | 10 | Measurements survive restart |
| 06 | `2026-08-31-06-workspace-clinical-data.md` | 6 | Folder scan, CSV import |
| 07 | `2026-08-31-07-similar-comparison.md` | 7 | Ranking, side-by-side |

77 tasks, 399 steps total.

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
