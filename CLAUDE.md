# Spine Contour

Electron desktop app that measures spinopelvic parameters from lateral lumbar
radiographs. A Python/FastAPI backend runs three PyTorch models locally; the Electron
main process spawns it on a random `127.0.0.1` port and polls `/health`.

**Currently mid-redesign — plans 01–06 of 07 are done; plan 07 is deferred past the first
release.** Plan 06's automated verification is green (unit 270/270 and every `tools/smoke/`
suite) and its Gate 1 passed on 2026-09-03, but **Gate 2 was not run** — the user chose on
2026-09-04 to skip it and hand the branch to the developer who wrote the Python backend — and
**the preview installer has never been tested with plan 06's code in it**. The branch is pushed to
`fork` at `4a0142c`; the fork's `main` is untouched at `7aa1a86`. Every push of
`ui-redesign-cw` rebuilds the preview installer, and the user tests that installer before
anything touches `main`. See `docs/superpowers/HANDOFF.md` before doing anything: "Handing this
to the backend author" if you are merging a new segmentation model, "Resume plan 07 here" for
what plan 06 changed under plan 07 (the contract was amended in step; the plan-07 document was
not), and "Release prerequisites" for what stands between this branch and a production release.
`docs/ROADMAP.md` carries the deferred work that has no plan yet.

## Read these first

| Document | What it is |
|---|---|
| `docs/superpowers/HANDOFF.md` | Current state, what's done, what's next |
| `docs/superpowers/specs/2026-08-31-spine-contour-ui-redesign-design.md` | The approved spec |
| `docs/superpowers/plans/2026-08-31-00-architecture-contract.md` | **Binding** module interfaces |
| `docs/superpowers/plans/2026-08-31-0{1..7}-*.md` | Seven sequenced implementation plans |

The architecture contract wins over any individual plan. If a plan contradicts it,
raise the discrepancy rather than guessing.

## Non-negotiables

These come from the spec and apply to every change.

- **Never display a fabricated measurement.** Absent values render `—` (U+2014), never
  `0`, never `N/A`, never a guess. This is a clinical tool; it is the single most
  important rule in the project.
- **Never label a value with a name it isn't.** The backend used to return sacral slope
  under the key `SI` (sacral inclination is its 90° complement). That rename is part of
  plan 02. Don't reintroduce the confusion.
- **No fabricated status either.** Segmentation progress is deliberately indeterminate
  because `/predict` has no progress channel. Do not add timed stage labels.
- **Never draw a construction under the wrong measurement's name.** `state.selectedLevel`
  names which construction the viewer draws, and its domain is `'L1'`…`'L5'` | `'S1'` |
  `'PI'` | `'PT'` | `'SS'` | `'L1PA'` | `null` — not just a vertebral level. Anything
  switching on it must handle the non-level values **explicitly**; falling through to an
  `else` that assumes a vertebra is how the L1 pelvic angle row came to draw the lumbar
  lordosis line. See the architecture contract's `selectedLevel` section.
- **Never mutate the store's geometry in place.** Every edit works on a `structuredClone`
  and commits a new reference; the viewer's redraw gate and the router's key sets compare by
  reference, so an in-place mutation silently stops repainting.
- **All stage pointer and keyboard wiring lives in `renderer/components/viewer.js`.**
  `renderer/viewer/interactions.js` is pure logic with tests; do not add DOM code to it.
- **No bundler, no framework, no runtime dependencies.** Vanilla ES modules.
  `dependencies` stays empty; `devDependencies` stays exactly `electron` and
  `electron-builder`.
- **Do not loosen the CSP** in `index.html`. No CDN, no Google Fonts, no remote
  anything. Fonts are self-hosted from `assets/fonts/`.
- **Keep both electron-builder file allowlists in sync.** `package.json` `build.files`
  and `electron-builder.preview.yml` `files` must match. A missing entry does not fail
  the build — it ships an installer that opens a blank window.

## Commands

```bash
npm run dev                       # launch the app (starts the Python backend too)
node --test test/*.test.js        # renderer unit tests
npm test                          # same
```

`node --test test/` (directory form) **fails** on Node 24 — it treats the directory as
a CommonJS entry point. Use the glob. Do not "fix" it back.

Backend tests:

```bash
"C:/Users/codyj/spine contour/.venv/Scripts/python.exe" -m pytest backend -q
```

## Backend API

Local only, on a random port. Four endpoints:

- `POST /predict` — multipart file upload. Returns `image_png`, `mask_png`,
  `femoral_mask_png`, `measurements`, `geometry`, `qc`, `labels` (all base64 where
  relevant). Slow: locates the lumbosacral region, then runs the chosen models.
  Optional form fields `vertebra_model`, `femoral_model`, `s1_model` choose which model
  reads each structure; anything the backend does not offer is a 422, and omitted fields
  take the default.
- `POST /measure` — geometry only, no image. Returns `{measurements, geometry}`.
  Cheap, which is what makes live re-measurement after landmark correction practical.
- `GET /models` — `{vertebrae: [...], femoral: [...], s1: [...]}`, the offered model ids.
- `GET /health` — `{"status": "ok"}`.

`measurements` is `{SS, PI, PT, L1PA, LL: {'L1-S1'…'L5-S1'}}` after the plan-02 rename.
`PI–LL mismatch` is derived (`PI − LL['L1-S1']`), not returned.

`qc` is opaque to the renderer except `qc.femoral.confidence`, and it carries two
records the backend adds: `qc.models` (which model read each structure) and
`qc.framing` (the crop the models ran on, and whether the film was searched or taken
whole). A stored result therefore says what produced it. See `backend/framing.py` for
why a film is searched at all.

`PI = PT + SS` is a geometric identity, but the backend derives all three
independently. The residual is used as a landmark-quality signal, not assumed to be
zero.

Disc heights and spondylolisthesis slip are **not computed** and are out of scope. They
are lengths, and millimetres need pixel spacing that PNG/JPG inputs do not carry.

The backend bundle collects `timm` (the HRNet trunk) alongside the other model
packages; keep `--collect-all timm` in both workflows.

## Git

This worktree is on branch `ui-redesign-cw`. Two remotes:

- `fork` → `github.com/Feches/Spine-Contour` — **push here**
- `origin` → `github.com/mjayasur/Spine-Contour` — upstream, read-only in practice
  (the authenticated account has no write access)

Pushing `ui-redesign-cw` triggers only the preview installer workflow, which publishes
to a `preview-windows` prerelease. It cannot touch the production `latest-windows`
release the README links to. Keep it that way.

## Conventions

- Conventional commit prefixes: `feat:`, `fix:`, `test:`, `chore:`, `ci:`.
- Commit after every completed task.
- Pure-logic modules get real `node --test` coverage. DOM and canvas code gets explicit
  manual verification steps — say so plainly rather than writing a fake test.
- `renderer/` is browser code and cannot resolve `node:` specifiers. Anything touching
  `node:fs` belongs at the repo root and is imported only by `main.js`.
