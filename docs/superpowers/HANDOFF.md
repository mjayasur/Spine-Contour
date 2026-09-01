# Handoff — Spine Contour UI Redesign

**Last updated:** 2026-08-31
**Branch:** `ui-redesign-cw`
**Worktree:** `C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign`

---

## Where things stand

**Plans 01 and 02 are complete, reviewed, and user-verified. Plan 03 is started but not
implemented: its pre-flight scan is done and two decisions are made.** Nothing is pushed —
the fork is still at plan 01's `3a95d7d`, deliberately (see "Do not distribute" below).

- **Plan 01** (`c40f944`..`3a95d7d`) — preview installer, verified on real installs: two
  uninstall entries, separate `%APPDATA%` dirs (proved by **inode**, not name — Windows is
  case-insensitive and the name check gives a false pass), distinct window titles, and
  production still measuring after the preview was uninstalled.
- **Plan 02** (`3a95d7d`..`ad1d555`, 40 commits) — the renderer foundation. Landing gate,
  sidebar, tokens, fonts, `SS` rename, router, store, api. Walkthrough verified against the
  running app over Electron's `--remote-debugging-port`, not by proxy.

### Resume plan 03 here

Read **`docs/superpowers/2026-09-01-plan-03-preflight-scan.md`** first. It is the committed
copy of a parallel pre-flight scan (~830k tokens) over plan 03's 11 tasks, the binding
contract, and the code plan 02 actually built. Re-running it is expensive; don't.

It found **7 blocking conflicts**, nearly all because plan 03 was written before plan 02's
final architecture existed. Two decisions are already made:

1. **Amend the plan document first, then implement.** Task briefs are extracted from the
   plan, so a stale plan yields stale briefs. Fix the 7 blocking items and the ~25
   non-blocking ones in the plan text, commit as docs, then implement from corrected text.
2. **`screens/analysis.js` self-subscribes** to the store at module scope with a guard that
   no-ops unless `state.screen === 'analysis'`. It does **not** go through the router.

**The single most dangerous item — a trap in this repo's own code.** `renderer/router.js`
comments say *"if any of them starts reading a state key, add it here too."* Plan 03 makes
the analysis screen read seventeen state keys. An implementer following that comment
literally adds all seventeen to `SCREEN_KEYS`, including `zoom`/`panX`/`panY`/`panMode`.
Consequence, traced concretely: `pointermove` → `setState({panX,panY})` → the router swaps
the screen node → both canvases detach, their 2D contexts point at orphans, `detach()` never
runs so listeners stack per frame. **The image vanishes on the first drag pixel.**
`SCREEN_KEYS` must gain **nothing** in plan 03, and that router comment needs an explicit
exception written into it.

Other blocking items, in brief — full detail and resolutions are in the scan:
`el()` is passed **51 `style:` props** (a getter-only IDL property; throws under strict
mode) with no stylesheet to move them into; Tasks 9/10 use `clear(container)`/`append`
instead of the contract's `render(state) → HTMLElement`; Task 9's verification checklist
asserts the staged progress the plan's own notes explicitly rejected as fabricated status;
Task 10 says "Create `studies.js`" which plan 02 already built; images are assigned after
the completing `setState` so the first post-run paint shows the previous study; and the
Study record would carry `_fileData`, `SP-DRAFT-n` ids and `filePath: null`, all of which
plan 05 persists to disk.

### One thing to know before you amend the plan

During the pre-flight scan, one of the scan agents edited
`docs/superpowers/plans/2026-08-31-03-analysis-screen.md` despite being told the scan was
read-only. That edit was **reverted** — the plan file is at its committed state. It is
mentioned only so nobody is surprised by the ledger referring to it.

It was reverted rather than kept because it was *partial*: it fixed B-2, B-3, the Task 1
test count, `ZOOM_STEP` and the canvas font, but left B-1, B-4 and B-7 untouched, and
introduced a fresh contradiction — Task 7's Interfaces block began declaring a `setImages`
surface while Task 9 still called `viewer.__lastImages`. Because task briefs are extracted
from this document, a half-amended plan hands some tasks corrected instructions and others
stale ones, with two tasks disagreeing about an interface. That is worse than either
extreme. Do the amendment as one deliberate reviewed pass.

### Do not distribute a build from this branch

Plan 02's Task 19 removed the old single-screen UI — the modality selectors, *Measure
radiograph*, the `SS`/`PI`/`PT`/`L1PA` checkboxes, the viewer, and the landmark panel. Plan
03 restores parity. Right now the app selects a file and shows a toast, nothing more. Push
and rebuild the preview **after** plan 03, not before.

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
| 03 | `2026-08-31-03-analysis-screen.md` | 11 | **IN PROGRESS** - pre-flight done, parity with today's app |
| 04 | `2026-08-31-04-landmark-editing.md` | 19 | Direct-manipulation editing |
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
