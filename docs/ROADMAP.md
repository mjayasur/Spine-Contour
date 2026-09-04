# Roadmap — deferred work

Work that is understood and deliberately not built yet. Each item says what happens today, what
"done" looks like, and the decisions someone has to make before writing code.

This is not a wish list. Everything here came out of building plans 01–06 or out of the whole-branch
review at the end of plan 06, and each item is either a limitation a user will hit or a hazard a
maintainer will hit. Items are ordered by when they are likely to matter, not by size.

Authoritative detail lives in `docs/superpowers/HANDOFF.md` (state, decisions, traps) and in
`docs/superpowers/plans/2026-08-31-00-architecture-contract.md` (binding interfaces). Where an item
would change a stored file's shape, that is called out, because it forces a store version bump.

---

## 1. The exported CSV cannot be imported back

**Priority: next.** This is the item the roadmap was opened for.

Plan 06 put clinical import and clinical export in the same module and made clinical values part of
both. The obvious workflow is therefore: export the study list, fill in Diagnosis and ODI in Excel,
load the file back. That does not work today, and it fails silently rather than with a message.

### What happens today

Export (`toCsv` in `renderer/data/csv.js`) writes:

```
# Spine Contour export
# Created by Cody Woodhouse, MD; Michael Jayasuriya, BS.
# Investigational software. NOT FOR CLINICAL USE.
Study ID,Source,View,LL L1-S1,PI,PT,SS,PI-LL Mismatch,L1PA,LL L2-S1,...,<active clinical fields>
SP-1000,real,Standing lateral,49.0,48.6,12.1,36.5,-0.4,...,58,F,Fusion
```

Three separate things then block the import, and all three have to be dealt with:

1. **The citation block is read as data.** `parse` drops blank lines only, so the first line,
   `# Spine Contour export`, becomes the header row and the file parses as one nameless column.
   Nothing downstream can recover from that. This alone kills the round trip.
2. **The identity column holds the wrong kind of value.** Past the comments, `Study ID` does
   normalise to `studyid`, so `findJoinHeader` would find it. But the import joins a row to a film by
   the film's **filename stem**, while the export writes the **record id** (`SP-1000`). Nothing
   matches, and every row is reported unmatched. The two identifiers were designed for different
   moments: a film on disk has no id until it is loaded, which is why the import joins on filename.
3. **Only currently-visible clinical columns are exported.** `toCsv(studies, fields, …)` takes the
   session's active field list, and the drawer's column control hides a field for the session. So a
   hidden column is absent from the export with nothing in the file to say so, and a round trip
   through that file would drop those values even once 1 and 2 are fixed.

### What "done" looks like

A researcher exports the library, edits clinical columns in Excel, saves as CSV UTF-8, loads the file
in the Workspace, and every row lands on the study it came from. Measurement columns are ignored on
import (they are outputs, never inputs). Nothing is silently skipped: whatever does not match is
counted and named in the load message, as unmatched rows already are.

### Decisions to make first

- **Which identity does the round trip use?** Three options, and this is the real design question.
  (a) Export a `study_id` column holding the filename stem alongside the human-facing `Study ID`.
  Cheapest, keeps the import rule unchanged, but puts two identity columns in a file people read.
  (b) Teach the import to join on the record id when the column holds one, falling back to the
  filename stem. Handles the app's own export directly, but means a row can now name a study that
  does not exist in this library, which needs its own reporting.
  (c) Give every study a stable external identifier and export that. Cleanest long term, and it is
  the same conversation as item 3 below, but it changes the stored record and forces a version bump.
- **Comment lines: skip or forbid?** Skipping lines that begin with `#` before the header is a small
  change to `parse` and makes the app's own export readable. It also silently changes how a
  third-party CSV whose first column legitimately starts with `#` is read. Decide, then test it.
- **Export hidden fields or not?** Either export every clinical key present on the exported studies
  rather than the visible list, or say in the export dialog that hidden columns are omitted. The
  current behaviour is defensible but undocumented, which is the worst of the three.

### Where the code is

`renderer/data/csv.js` owns all of it: `toCsv` (export), `parse`, `findJoinHeader`, `joinClinical`
(import). All of it is pure and unit-tested in `test/csv.test.js`, so this work is testable without
launching the app. The Workspace wiring is `renderer/screens/workspace.js`; the per-study import is
`renderer/components/clinical-data.js`.

### Rough size

Small to medium. The parser and export changes are hours. The identity decision is what makes it
larger, and option (c) makes it a plan of its own.

---

## 2. Telling studies apart when they come from more than one folder

There is no workspace as a saved thing. The app has one library, and "workspace" is a transient
pointer to the folder and CSV last picked; none of it is persisted. Loading a second folder merges
its films into the same library, with ids continuing across them.

Today nothing in the Studies table says which folder a study came from. The columns are id, patient,
view, date, status and lordosis, and the search box covers id, patient, view and clinical values. So
a library assembled from several folders cannot be filtered back down to one of them.

Two sizes of answer:

- **Show the containing folder, derived from the film's path.** No change to stored data. The catch
  is that the scan follows subfolders and the record keeps only the film's own path, so a film in a
  subfolder shows the subfolder while its siblings show the parent. Honest under a heading of
  FOLDER, not under one of WORKSPACE. Pairs naturally with extending the search to cover the path,
  which is roughly a line and is what actually delivers filtering.
- **Store the chosen folder on each study.** Truthful as a workspace, but it adds a field to the
  record, which means the validator, the contract's record definition, a decision about the studies
  already in the library, and a version bump.

---

## 3. Nothing records which model produced a stored measurement

**Read this before merging a new segmentation model.**

A study's `measurements`, `geometry` and `qc` are stored with no indication of what produced them.
The moment a second model exists, old and new numbers sit in one library, one exported CSV and one
set of prediction sidecars with nothing to tell them apart, and there is no way to ask "which
studies need re-running" or to re-run them in bulk.

If the payload changes shape rather than just its numbers, the validator nulls the
measurements and geometry of every affected record with a console warning, the studies fall back to
`Processing`, and each one has to be re-run by hand from its own screen.

What it needs: a provenance field on the record (a model name and version at minimum), the validator
preserving it, the status derivation treating a study measured by an older model as needing a re-run,
and a way to re-run a selection of studies. This changes the stored record, so it is a store version
bump and a contract amendment, and it deserves its own plan rather than a patch.

---

## 4. Release prerequisites

Not code quality; these stand between the branch and a production release.

- **The production build workflow runs no renderer tests and no packaging-allowlist check.**
  `.github/workflows/windows.yml` builds and publishes without either, while the preview workflow has
  both. The two allowlists are also the files most likely to conflict in a merge. A merge that drops
  a root file from one list would publish an installer that opens a blank window, with CI green.
- **`windows.yml` has no repository guard**, only a branch filter, so merging a descendant of this
  branch into a fork's `main` would run the production workflow there and publish a release tagged
  as the latest.
- **The nine demo studies ship in every build.** They are wanted in development and in the preview
  installer, and must be absent from a production build.

---

## 5. Smaller known limitations

- **A bulk load has no ceiling.** The scan, the IPC payload and the load are unbounded. The realistic
  input is a public dataset of thousands of films, not a mistaken drive root.
- **Five things have no automated coverage**, and each would stay green if broken: the two deferred
  commits in the clinical drawer that stop a rebuild stranding typed text, the delete path's
  data-safety branches, the bootstrap step that makes stored clinical values visible after a
  restart, the refusal branch of the drawer's `Import from CSV` when a filename is ambiguous, and the
  gate that stops a refused store's sidecar being read under a reused id. The bootstrap one sits in
  the file a backend merge is most likely to touch.

  The last two were verified by hand against the running app when they were fixed, and neither has a
  check that would catch a regression. The sidecar gate is the one worth closing first, because its
  failure mode is another patient's measurements one click away from being committed: write a store
  with an unsupported `version` into a scratch profile, open a study that has measurements and
  geometry but no cached bitmaps, and assert both that the film reads as unavailable and that
  `RESET TO PREDICTION` is disabled. The ambiguity refusal needs only a second film sharing a stem in
  the smoke fixture, which would also give the workspace load's ambiguous counter its first live
  assertion.
- **The external-URL check has no automated test.** The landing gate's contact address made
  `open-external` accept `mailto:` alongside http and https, and the pattern is deliberately strict:
  one address, no query string, because a `?subject=` or `?body=` would let a caller compose a
  message in the user's real mail client. It was verified by hand against fifteen cases, including
  header injection and the `javascript:` and `file:` schemes, but it lives in `main.js`, which no
  unit test can load. Moving the two patterns into a small root module beside `store-io.js` would
  make them testable, at the cost of an entry in both packaging allowlists.
- **Two checks in the studies smoke suite race the backend.** They click re-run, navigate, then
  expect the row to still read `Processing`; on a fast or warmed-up machine the run has already
  finished and the badge correctly reads `Segmented`. The suite reads 54 of 56 when that happens.
  The product is right and the suite is wrong, so the fix belongs in the suite: sample the badge
  while the run is provably still in flight. Details and the two check names are in
  `tools/smoke/README.md`, so nobody mistakes it for a regression.
- **A landmark correction is saved before its measurement round trip returns.** An abrupt quit inside
  roughly 150 milliseconds makes a corrected geometry durable beside the previous numbers. The design
  for the fix is written down in plan 06's design notes: an optional staleness flag on the record,
  set on commit and cleared on the result, read by the status rule.
- **The Studies row is a single control for assistive technology.** It keeps the button role it was
  given in plan 05, so some screen readers do not announce the in-row delete controls separately.
  Mouse and keyboard both work. Recorded for an accessibility pass.
