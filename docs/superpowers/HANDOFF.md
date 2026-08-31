# Handoff — Spine Contour UI Redesign

**Last updated:** 2026-08-31
**Branch:** `ui-redesign-cw`
**Worktree:** `C:\Users\codyj\spine contour\.claude\worktrees\ui-redesign`

---

## Where things stand

**Plan 01 is complete, reviewed, and verified on real installs.** The preview installer
builds in CI, publishes to the fork's `preview-windows` pre-release, and installs beside
the production app without touching it. Plan 02 has not been started.

Plan 01's commits (`c40f944`..`ca6fdb6`, on `ui-redesign-cw`, pushed to `fork`) leave
`package.json`'s `build` block and `.github/workflows/windows.yml` byte-identical to
`7aa1a86`. Verified: two uninstall entries with distinct GUIDs, separate `%APPDATA%`
directories (proved by **inode**, not by name — Windows is case-insensitive, so the
obvious name check gives a false pass), window titles read from the **live processes**
via `Get-Process MainWindowTitle`, and production still measuring correctly after the
preview was uninstalled.

Three defects surfaced during plan 01 and were fixed. Two were defects in the plan
itself, not in its implementation:

- **CI runner died with no logs** (`cd04c9b`). Disk exhaustion while packaging:
  PyInstaller bundles torch plus 413MB of weights, electron-builder copies that whole
  tree into `win-unpacked` and compresses it to a ~680MB installer, while
  `build/pyinstaller`, the pip cache and site-packages all still hold disk. The fix
  reclaims disk immediately before packaging and **throws under 6GB**, so this can never
  again fail silently. An **empty log archive is the signature** — the runner dies before
  its log-upload handshake, so GitHub has nothing to serve.
- **Window title was never branded** (`aa49a48`). `index.html`'s `<title>` overrides
  `BrowserWindow`'s `title` option via `page-title-updated`. The plan's Task 2 approach
  could not work as written. Consequence for later plans: **setting `document.title` now
  does nothing** — call `mainWindow.setTitle()` instead.
- **Both builds shared `%APPDATA%\spine-contour`** (`472e3c8`). electron-builder does not
  write `build.productName` into the packaged `package.json`, so `app.getName()` fell back
  to `name`. Fixed preview-side only via `extraMetadata`; renaming production would have
  orphaned real users' data. Production deliberately keeps `%APPDATA%\spine-contour`.

## Carry into plan 02

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
| 02 | `2026-08-31-02-foundation.md` | 20 | Landing, Sidebar, tokens, `SS` rename |
| 03 | `2026-08-31-03-analysis-screen.md` | 11 | **Parity with today's app** |
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
