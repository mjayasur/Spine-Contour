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
node tools/smoke/smoke-label.mjs
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

**`smoke-label.mjs` is a known-failing, superseded suite — 9/16, not a regression.**
Plan-04 Task 20 built a canvas-drawn label plate; Task 21 replaced it with a DOM chip
(`.viewer-label`) and added `smoke-chip.mjs`, which is green. `smoke-label.mjs` still
tests the old drawn plate and fails the same seven checks on a freshly segmented study
as it did before this promotion (confirmed against the original, unmoved copy). It is
left in the run order above as a record of plan-04 debt, not a gate; do not fix,
rewrite, or delete it here — that is out of this plan's scope.

## Library

`cdp-lib.mjs` exports `connect()`, whose returned object provides trusted-input helpers
(`click`, `drag`, `move`, `wheel`, `key`, `typeText`), state access (`state`, `setState`),
DOM helpers (`rect`, `toClient`, `evaluate`), and `screenshot(path)`. Suite authors write
screenshots under `tools/smoke/out/` (git-ignored). `cdp.mjs` is a small CLI wrapper over
the same library for one-off calls.
