# Handoff — Spine Contour UI Redesign

**Last updated:** 2026-09-01
**Branch:** `ui-redesign-cw`
**Worktree:** `C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign`

---

## Where things stand

**Plans 01, 02 and 03 are complete, reviewed, and user-verified.** Plan 04 is next.

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

### Resume plan 04 here — and read this first, the contract moved

Plan 03's manual verification changed the **binding architecture contract** three times.
Plan 04 reads `selectedLevel` and plan 06 owns export, so both are affected. None of this
is discoverable from the plan-04 document, which predates it.

**1. `selectedLevel` is no longer a vertebral level.** It is a *construction target*, and
its domain is now `'L1'`…`'L5'` | `'S1'` | `'PI'` | `'PT'` | `'SS'` | `'L1PA'` | `null`.
Each value names exactly one construction the viewer draws. The contract carries the full
table.

Two consequences bind plan 04 directly. `vertebraAt()` still returns **only** vertebral
levels, so anatomical clicks stay coarse and the non-level values are reachable only from
their measurement row. And **anything switching on `selectedLevel` must handle the
non-level values explicitly** rather than falling through an `else` that assumes a
vertebra — that fall-through was the bug, twice. Clicking `L1 PELVIC ANGLE` drew the
lordosis line and labelled it `LL L1-S1`; `PI`/`PT`/`SS` shared one line and one combined
label that ran off the edge of the stage.

**2. `renderer/api.js` gained `saveCsv(request)`**, pulled forward from plan 06. It takes
`{text, suggestedName}` and resolves to the written path, or `null` when the user cancels.
Cancelling is not an error and must not toast. **Plan 06's export scope is therefore
smaller than its document says.**

**3. `toCsv` writes measurement columns to one decimal**, matching the panel, so a number
read off the screen and the same number in the file agree.

### What plan 03's verification actually taught

Worth internalising before plan 04, because the pattern will repeat.

**Every defect found at the app was invisible to the test suite, and four of the seven
originated in the plan text rather than in an implementer's code.** The suite went 19 → 64
and caught none of: a row drawing the wrong measurement, three parameters sharing one
construction, a radiograph stretched to the wrong aspect ratio, or an export button that
exported nothing. Reviews caught the rest — a `TypeError` that would have frozen the whole
UI, a research CSV containing the literal string `NaN`, keyboard focus dropped on every row
click, and one study's radiograph rendered under another study's identity.

Concretely, for plan 04: the pure-logic modules are well covered and the canvas and DOM are
covered by nothing. Budget for a real session at the running app with the person who knows
what the geometry should look like, and treat the plan document as a hypothesis rather than
a specification.

**Two traps worth carrying forward, both still live.**

`renderer/router.js`'s `SCREEN_KEYS` must stay `['screen', 'ack']`. `zoom`, `panX`, `panY`
and `panMode` change at pointermove rate; adding any of them remounts the screen host every
frame and destroys the canvas 2D context mid-gesture. `screens/analysis.js` subscribes to
the store itself at module scope for exactly this reason, and the router's own "add it here
too" comment does **not** apply to it.

`store.js` iterates its listeners with no per-listener `try`/`catch`, so a throw inside any
subscriber stops every subscriber registered after it — including the router's — for that
update and every one after. A single unguarded property access in a draw function freezes
the entire UI, not just the canvas. Plan 03 hit this once. It is worth fixing properly in
plan 04 rather than guarding every call site.

**Deferred, for plan 04 to pick up or decline:**

- The transient drag state lives in a closure inside `attachViewerInteractions`, not as
  module scope in `components/viewer.js` where the contract says it belongs. Harmless while
  pan is the only drag; plan 04 adds landmark drag and hover and must not end up with two
  copies. Decide the location before starting.
- The viewer's toolbar toggles convey their on/off state only visually — no `aria-pressed`.
- `geometry` is read unguarded throughout `drawDynamicLayer`. It is only ever produced whole
  by `/predict` today, but plan 05 persists it to the same user-writable file as
  `measurements`, so that assumption expires then.
- The single-entry image cache means segmenting A, then B, then reopening A shows outlines
  on black. Bounded on purpose; resolves when plan 05 persists studies and thumbnails.
- `PI–LL MISMATCH` has no construction of its own and maps to the `S1` overview. If it
  ever gets one it needs the lordosis line and the pelvic line drawn together.

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
