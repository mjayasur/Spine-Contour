# CDP smoke harness

Trusted-input smoke checks driven over Chrome DevTools Protocol against the real,
running Electron app. The unit suite (`node --test test/*.test.js`) covers pure logic
only; canvas/pointer behaviour — drags, hover, keyboard nudges, pixel colours — is not
reachable from it. Every defect found in plans 03–04 of the UI redesign was caught by
these scripts or by a human, none by the unit suite. This directory is outside both
electron-builder file allowlists (`package.json` `build.files` and
`electron-builder.preview.yml` `files`), so nothing here ships.

## Launch and quit

```
node tools/smoke/launch.mjs            # SPINE_CONTOUR_PYTHON must point at the venv python
node tools/smoke/cdp.mjs --quit        # clean shutdown through Browser.close
```

`launch.mjs` starts the app from source, detached, on a scratch `SPINE_CONTOUR_USER_DATA`
directory (default `<tmp>/spine-contour-smoke`, wiped on each launch unless
`SMOKE_KEEP_PROFILE=1`) so smoke runs never touch a developer's real `studies.json`.
**`main.js` only honours `SPINE_CONTOUR_USER_DATA` from Task 5 onward** — until then the
app writes to its normal user-data directory regardless, which is expected, not a bug in
this harness.

**A process staying alive is not evidence of a successful launch.** A fatal startup
error shows a modal dialog and the Electron process keeps running. Always assert against
the live DOM over CDP (port 9222 by default, `CDP_PORT` to override) rather than trusting
the exit code or PID.

**And a port being open is not evidence that it is *your* app.** Electron cannot bind a
`--remote-debugging-port` another process already holds; it starts anyway with no CDP
endpoint, and the suites then drive the *older* instance still on the port — different
code, different profile — reporting results that look real. `launch.mjs` therefore probes
`/json/version` before spawning and refuses (exit 3) if anything answers, telling you to
run `node tools/smoke/cdp.mjs --quit` first (then kill stray `electron` processes if the
port stays open). To drive an already-running instance on purpose, set `SMOKE_ATTACH=1`:
it skips the spawn, touches no profile, and its ready line says `"attached": true`.

## Running the plan-04 suites

In order, against the launched app. Each suite expects a freshly segmented study.
`smoke-gate1.mjs` and `smoke-gate2.mjs` drag landmarks and re-measure as part of their
own checks, which is fine for those two, but it leaves the study's geometry different
from what was predicted — and `smoke-gate3.mjs` resets landmarks back to the *exact*
prediction recorded in `out/last-run.json`. Running the six suites straight through on
one study makes `smoke-gate3.mjs` fail (measured 22/23 that way); it needs its own
fresh `inject-study.js` + `run-and-wait.js` pair run immediately before it, not the one
from the top of the run, to get 23/23:

```
node tools/smoke/cdp.mjs --file tools/smoke/inject-study.js
node tools/smoke/cdp.mjs --file tools/smoke/run-and-wait.js > tools/smoke/out/last-run.json
node tools/smoke/smoke-parity.mjs
node tools/smoke/smoke-gate1.mjs
node tools/smoke/smoke-gate2.mjs
node tools/smoke/cdp.mjs --file tools/smoke/inject-study.js
node tools/smoke/cdp.mjs --file tools/smoke/run-and-wait.js > tools/smoke/out/last-run.json
node tools/smoke/smoke-gate3.mjs
node tools/smoke/smoke-chip.mjs
```

`inject-study.js` embeds its own tiny 157x280 sample film (the `design_src/13462cd9`
reference JPG, base64-encoded in the script) and injects it as study `SP-9000`, inserted
at the front of `state.studies` to match `addStudy`'s front-insertion (screens/studies.js),
then segmentation completes in roughly 7 seconds. `SP-9000` is a reserved id, not `SP-1000`:
from Task 6 on, a store saver persists whatever the harness injects, and a film added
through the app's native file picker on a fresh profile also lands on `SP-1000`. Using a
different id keeps a smoke run from silently overwriting a real, segmented `SP-1000`
study with an unsegmented one, and keeps repeated smoke runs from colliding with each
other in one profile.

`launch.mjs` creates `tools/smoke/out/` and writes the app's console output there as
`out/app.log`; `smoke-gate2.mjs` and `smoke-gate3.mjs` read it to count `/measure`
calls. `smoke-gate3.mjs` also reads `out/last-run.json` — the segmentation result it
resets landmarks back to — which is why every `run-and-wait.js` step above redirects
its JSON output there, overwriting it with the most recently segmented study. If you
run a suite without `launch.mjs` first (or after clearing `out/`), create the directory
yourself first; nothing else in the chain creates it.

Every suite exits non-zero on any failed check and asserts there were no console errors
during the run; a green process exit is sufficient to trust the result, no need to
eyeball output.

**Known baseline** (fresh scratch profile, this branch tip): parity 15/15, gate1
25/25, gate2 32/32, gate3 23/23 (with the fresh precondition above), chip 20/20. Use
these to spot a real regression later.

**`smoke-label.superseded.mjs` is not in the run order and must not be added back.**
Plan-04 Task 20 built a canvas-drawn label plate; Task 21 replaced it with a DOM chip
(`.viewer-label`) and added `smoke-chip.mjs`, which is green and covers the shipped
behaviour. The old suite still tests the drawn plate, so it fails seven of its sixteen
checks against correct code (9/16, unchanged since plan 04). It is renamed rather than
deleted because it is the record of that debt — but a permanently red line beside green
ones is the same class of problem as a false green: it teaches the reader to skim
failures. Keep it out of the run order and out of any baseline. Do not fix or rewrite
it here; if the drawn plate is ever revived, that is the plan that owns this file.

## Running the plan-05 suites

**`smoke-studies.mjs` needs a profile that does not already contain `SP-9000`.** Its
step-5 check asserts the summary grows to `n+1` studies after `inject-study.js` runs,
but `inject-study.js` de-duplicates by id (it filters `SP-9000` out before prepending
it), so on a profile where an earlier suite already created that study the count does
not grow and the check fails — measured `"14 STUDIES · 1 IN QUEUE"` that way. On a
fresh profile every one of its checks runs unconditionally (56 of them after Task 9's
sections were added; it was 28 before them). Same class of precondition as
`smoke-gate3.mjs`'s above.

**`smoke-studies.mjs` segments `SP-9000` twice** (sections 7 and 8, ~9 s each), so it needs
the Python backend up and takes about 20 s longer than a DOM-only suite. `state.running` is
the running study's *id*, and the only way to prove the list badges the right study — and
that a demo study opened mid-run still shows the demo card — is to watch a real run. Two
consequences:

- **Never run it between `smoke-persist.mjs --phase run` and `--phase restart`.** Section 5
  re-injects `SP-9000` unsegmented, destroying the corrected geometry `--phase restart`
  compares against. (Pre-existing, but newly tempting now that the suite drives runs.)
- **It ends on Studies with `SP-9000` segmented and nothing open on Analysis.** Every suite
  documented as "assumes a segmented study open on Analysis" needs its own
  `inject-study.js` + `run-and-wait.js` pair *after* this one, not before it.

`smoke-persist.mjs` runs in three phases across two real restarts, and phases 2 and 3
read `out/persist-state.json` written by phase 1:

```
node tools/smoke/launch.mjs
node tools/smoke/smoke-persist.mjs --phase run
node tools/smoke/cdp.mjs --quit
SMOKE_KEEP_PROFILE=1 node tools/smoke/launch.mjs
node tools/smoke/smoke-persist.mjs --phase restart
```

There is a third phase, `--phase measurefail`, but it is **not part of the standard run**
and there is currently no way to execute it. See below before trying.

`SMOKE_KEEP_PROFILE=1` on the relaunch is what makes it a restart rather than a fresh
start — without it `launch.mjs` deletes the scratch profile and phase 2 has nothing to
restore. Phase 2 briefly moves `predictions/SP-9000.json` aside to exercise the
`FILM UNAVAILABLE` card and restores it in a `finally`; if a phase-2 run is killed
mid-section, check for a leftover `predictions/SP-9000.json.bak` before re-running.

### `--phase measurefail` is parked — do not try to run it

**There is currently no way to make `/measure` fail without wedging the app, so this phase
cannot be exercised. Do not kill the backend to try.** An earlier version of this file told
you to; that recipe leaves Electron alive but completely undriveable, and it was measured,
not theorised — the suite dies with `TypeError: fetch failed / HeadersTimeoutError` because
CDP stops answering.

The phase exists because `recordPrediction`'s third argument is observable only when a
`/measure` **fails** on a corrected, restored study: the argument reaches nothing but the
measure queue's `measured` map (via `replaceMeasured`), and that map is read in exactly one
place — `recalculate`'s failure branch. A *successful* `/measure` overwrites the map, and
the restore only re-seeds it on a fresh mount, so the failing call has to be the first one
after a restore, in its own app session.

Every lever into that state is blocked:

- **Stub the bridge in-page** — no. `contextBridge.exposeInMainWorld` under
  `contextIsolation` makes `window.spineContour` non-configurable: property assignment
  silently no-ops and redefinition throws `Cannot redefine property`. `renderer/api.js`'s
  module exports are live bindings that cannot be reassigned from outside either, and
  `createMeasureQueue`'s `measure` is a closure parameter.
- **Kill the backend after launch** — no, and this is the harmful one. `main.js:253-256`
  raises `dialog.showErrorBox('Spine-Contour backend stopped', …)` on the backend's `exit`
  event whenever the window is up and the app is not already quitting. `showErrorBox` is
  modal and blocking, so it wedges the main process and the CDP endpoint stops responding.
  The app is alive and undriveable — this README's own "a process staying alive is not
  evidence of a successful launch" warning, arriving from the other direction.
- **Launch with a bogus `SPINE_CONTOUR_PYTHON` so the backend never starts** — no.
  `startBackend()` throws out of `waitForBackend()` (`main.js:224`) *before* `createWindow()`
  runs, and `app.whenReady()`'s catch shows its own modal at `main.js:272-275` and quits. No
  page target ever appears, so `launch.mjs` just times out.

**The correction-vs-prediction restore semantics are therefore covered by code review and by
the manual gate, not by this suite.** The reviewer traced `recordPrediction` →
`replaceMeasured` → the `measured` map → `recalculate`'s failure branch and confirmed the
third argument reaches nothing else; the product code is correct.

The phase itself is kept as written and needs no changes the day a lever exists. It
self-gates: it calls `/measure` straight through the bridge first, and if that call
*succeeds* the precondition check FAILS and every dependent assertion is reported as `SKIP`,
never `PASS` — so it can never certify coverage it did not get.

## Library

`cdp-lib.mjs` exports `connect()`, whose returned object provides trusted-input helpers
(`click`, `drag`, `move`, `wheel`, `key`, `typeText`), state access (`state`, `setState`),
DOM helpers (`rect`, `toClient`, `evaluate`), and `screenshot(path)`. Suite authors write
screenshots under `tools/smoke/out/` (git-ignored). `cdp.mjs` is a small CLI wrapper over
the same library for one-off calls.
