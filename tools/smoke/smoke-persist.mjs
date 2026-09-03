// Plan 05 Task 8 persistence smoke, in two phases. The controller drives it as:
//
//   node tools/smoke/launch.mjs
//   node tools/smoke/smoke-persist.mjs --phase run
//   node tools/smoke/cdp.mjs --quit
//   SMOKE_KEEP_PROFILE=1 node tools/smoke/launch.mjs
//   node tools/smoke/smoke-persist.mjs --phase restart
//
// Phase 1 segments SP-9000 (about 9 s for the embedded 157x280 sample; capped at 400 s the way
// run-and-wait.js caps it) and records what it measured in out/persist-state.json. Phase 2 reads
// that back and asserts the record, the film and the prediction snapshot all survived the
// restart. The scratch profile is SPINE_CONTOUR_USER_DATA, defaulting as launch.mjs defaults it.
//
// Phase 1 deliberately ends on a CORRECTION, not on RESET TO PREDICTION. The study's stored
// geometry has to differ from the sidecar's for phase 2 to test anything: recordPrediction's
// third argument (the geometry the study's current numbers describe) collapses onto its default
// the moment the two are value-identical, and that argument is the riskiest semantic here -- it
// is what stops a failed /measure after a restart from silently reverting a correction to the
// prediction. Do not "tidy" the phase to end on the reset.
//
// The sample film is 157x280 -- NARROWER than the 300x150 canvases start at -- so "sized to the
// film" is checked against the base canvas (see sizedToFilm), never against a width threshold.
//
// ORDER NOTE for phase 2. The brief lists the missing-sidecar path last, after the successful
// restore. It cannot run there: screens/analysis.js keeps ONE study's decoded bitmaps across
// navigation on purpose (its imageCache, and teardown() says so explicitly), so once a restore
// has succeeded, leaving the study and coming back re-hands the cached bitmaps and never reads
// the sidecar again -- FILM UNAVAILABLE is unreachable without reloading the renderer. The
// missing-sidecar path therefore runs FIRST, while the cache is still empty, and a failed
// restore leaves it empty (cacheImages is never reached), so the successful restore that
// follows is the genuine article. Same checks, reachable order.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
const STATE_FILE = path.join(OUT_DIR, 'persist-state.json');
const USER_DATA = process.env.SPINE_CONTOUR_USER_DATA || path.join(os.tmpdir(), 'spine-contour-smoke');
const STUDY_ID = 'SP-9000';
const SIDECAR = path.join(USER_DATA, 'predictions', `${STUDY_ID}.json`);
const JPEG_PREFIX = 'data:image/jpeg;base64,';

const phaseFlag = process.argv.indexOf('--phase');
const PHASE = phaseFlag === -1 ? 'run' : process.argv[phaseFlag + 1];
if (PHASE !== 'run' && PHASE !== 'restart') {
  console.error('usage: node tools/smoke/smoke-persist.mjs --phase run|restart');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

// Deep equality with key order normalised: the store's geometry reaches us through
// structuredClone and the sidecar's through JSON.parse, and neither promises key order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const FAILED_MEASURE = /correction was not applied|Could not update measurements/;

const cdp = await connect();

const openStudy = () => cdp.evaluate("import('./renderer/store.js').then((m) => { const s = m.getState(); return s.studies.find((x) => x.id === s.openId) ?? null; })");
const storedStudy = () => cdp.evaluate(`import('./renderer/store.js').then((m) => m.getState().studies.find((x) => x.id === ${JSON.stringify(STUDY_ID)}) ?? null)`);
const sidecarFromApp = () => cdp.evaluate(`window.spineContour.loadPrediction(${JSON.stringify(STUDY_ID)})`);
const text = (selector) => cdp.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.textContent : null; })()`);
const l1sa = (geometry) => (geometry && geometry.vertebrae && geometry.vertebrae.L1 ? geometry.vertebrae.L1.superior[0] : null);

// The card as it reads on screen, plus the two toolbar buttons the film's state gates.
const stageState = () => cdp.evaluate(`(() => {
  const card = document.querySelector('.run-card');
  const button = document.querySelector('.run-button');
  const edit = document.querySelector('.viewer-tool[aria-label="Edit landmarks"], .viewer-tool[aria-label="Done editing"]');
  const rerun = document.querySelector('.viewer-tool[aria-label="Re-run segmentation"]');
  const canvas = document.querySelector('.viewer-canvas-dynamic');
  // The FIRST .viewer-canvas is the static layer, which drawStaticLayer paints the radiograph
  // onto 1:1. sizeCanvases sets both layers together, so the static layer is the reference the
  // dynamic layer has to match.
  const base = document.querySelector('.viewer-canvas');
  return {
    base: base ? [base.width, base.height] : null,
    cardVisible: Boolean(card) && !card.classList.contains('is-hidden'),
    eyebrow: document.querySelector('.run-eyebrow')?.textContent ?? null,
    buttonVisible: Boolean(button) && !button.classList.contains('is-hidden'),
    buttonText: button ? button.textContent : null,
    buttonDisabled: button ? button.disabled : null,
    editDisabled: edit ? edit.disabled : null,
    rerunDisabled: rerun ? rerun.disabled : null,
    canvas: canvas ? [canvas.width, canvas.height] : null,
  };
})()`);

// "Sized to the film" means the dynamic layer matches the static layer sizeCanvases set from the
// bitmap AND is not the untouched 300x150 default both canvases start at. Derived from the base
// canvas, never from a literal: the embedded sample is 157x280, so it is NARROWER than the
// default canvas and no `width > 300` predicate can ever hold for a correctly sized stage.
const DEFAULT_CANVAS = [300, 150];
const sizedToFilm = (stage) => Boolean(stage && stage.canvas && stage.base)
  && stage.canvas[0] === stage.base[0] && stage.canvas[1] === stage.base[1]
  && !(stage.canvas[0] === DEFAULT_CANVAS[0] && stage.canvas[1] === DEFAULT_CANVAS[1]);

// An edit-bar button by its label, with its live rect and disabled flag.
const editBarButton = (label) => cdp.evaluate(`(() => { const b = [...document.querySelectorAll('.viewer-editbar button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; const r = b.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, disabled: b.disabled }; })()`);

async function waitFor(fn, timeoutMs = 5000, stepMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() >= deadline) return null;
    await cdp.settle(stepMs);
  }
}

async function openFromStudies() {
  await cdp.setState('{ ack: true, screen: "studies", query: "" }');
  await cdp.settle(120);
  const row = await cdp.rect(`.studies-row[data-study-id="${STUDY_ID}"]`);
  if (!row) return null;
  await cdp.click(row.cx, row.cy);
  await cdp.settle(150);
  return row;
}

async function backToStudies() {
  const back = await cdp.rect('.icon-btn[aria-label="Back to studies"]');
  if (!back) return false;
  await cdp.click(back.cx, back.cy);
  await cdp.settle(150);
  return true;
}

async function enterEditMode() {
  const edit = await cdp.rect('.viewer-tool[aria-label="Edit landmarks"]');
  if (!edit) return false;
  await cdp.click(edit.cx, edit.cy);
  await cdp.settle(150);
  return (await cdp.state()).editing === true;
}

// Tab to L1 SA, nudge it right `times`, and return the SETTLED state after the round trip.
//
// Why settling matters: ArrowRight commits the nudged geometry to the store SYNCHRONOUSLY
// (measure-queue's commitGeometry -> writeStudy) and only then SCHEDULES /measure, behind a
// 150 ms debounce. So polling the geometry alone resolves on the local optimistic write and
// says nothing about whether /measure succeeded, failed, or ran at all. Only a successful
// /measure writes `measurements`, so a changed measurements object is the settled signal --
// and reading the geometry before it would capture a value /measure is about to replace.
// A failure instead toasts and restores the last measured geometry, which is why the poll
// watches the toast too.
async function nudgeAndSettle(times, timeoutMs = 20000) {
  const before = await openStudy();
  if (!before) return { before: null, selection: null, after: null, failed: null };
  // Focus must not be inside the edit bar: viewer.js's handleKeyDown deliberately leaves Tab as
  // ordinary focus movement there (BD-11 d), so RETRACE/FIT/RESET/DONE stay keyboard-operable.
  // A nudge right after clicking RESET TO PREDICTION would otherwise never advance the selection
  // and every ArrowRight after it would be a no-op.
  await cdp.evaluate('(() => { const a = document.activeElement; if (a && a.blur) a.blur(); return true; })()');
  await cdp.key('Tab');
  await cdp.settle(60);
  const selection = (await cdp.state()).selection;
  for (let i = 0; i < times; i += 1) {
    await cdp.key('ArrowRight');
    await cdp.settle(30);
  }
  await cdp.settle(400);
  const settled = await waitFor(async () => {
    const state = await cdp.state();
    if (FAILED_MEASURE.test(state.toast || '')) return { failed: state.toast };
    const study = await openStudy();
    return study && !same(study.measurements, before.measurements) ? { study } : null;
  }, timeoutMs);
  return {
    before,
    selection,
    after: settled && settled.study ? settled.study : null,
    failed: settled && settled.failed ? settled.failed : null,
  };
}

// The saver writes on every reference change, but it writes asynchronously. Phase 2 compares the
// restored record against what phase 1 recorded, so phase 1 must not exit until studies.json
// actually holds the geometry it is about to write to persist-state.json.
const persistedMatches = (geometry) => waitFor(async () => {
  const raw = await cdp.evaluate(`window.spineContour.loadStudies().then((r) => (r.studies || []).find((x) => x.id === ${JSON.stringify(STUDY_ID)}) ?? null)`);
  return raw && same(raw.geometry, geometry) ? raw : null;
}, 5000);

try {
  if (PHASE === 'run') {
    // 1. SP-9000, unsegmented, open on Analysis. inject-study.js prepends it and replaces any
    // copy an earlier suite left in this profile, so it both creates and reuses.
    const injected = await cdp.evaluate(fs.readFileSync(path.join(HERE, 'inject-study.js'), 'utf8'));
    check('inject-study.js parks SP-9000 and opens Analysis', injected && injected.screen === 'analysis' && injected.openId === STUDY_ID, injected);
    // Read the card itself, not inject-study.js's `runButton`: that is only a querySelector
    // existence test, and .run-button is in the DOM from mount onward whatever the card shows.
    const queued = await stageState();
    check('the run card is visible, QUEUED, offering Run segmentation',
      queued.cardVisible === true && queued.eyebrow === 'QUEUED' && queued.buttonVisible === true
      && queued.buttonText === 'Run segmentation' && queued.buttonDisabled === false, queued);

    // 2. Run segmentation and wait for it, exactly as run-and-wait.js does (<= 400 s).
    const run = await cdp.evaluate(fs.readFileSync(path.join(HERE, 'run-and-wait.js'), 'utf8'));
    check('segmentation completed', run && run.result === 'done', run && { result: run.result, seconds: run.seconds, toast: run.toast });

    const study = await openStudy();
    check('the study carries measurements and geometry', Boolean(study && study.measurements && study.geometry), study && { measurements: Boolean(study.measurements), geometry: Boolean(study.geometry) });
    const lordosis = study && study.measurements && study.measurements.LL ? study.measurements.LL['L1-S1'] : null;
    check('lumbar lordosis L1-S1 is a number', typeof lordosis === 'number' && Number.isFinite(lordosis), lordosis);

    // 3. The thumbnail: a JPEG data URI that decodes to at most 128 px on its long edge.
    const thumb = await cdp.evaluate(`(async () => {
      const m = await import('./renderer/store.js');
      const st = m.getState().studies.find((x) => x.id === ${JSON.stringify(STUDY_ID)});
      const uri = st ? st.thumbnail : null;
      if (typeof uri !== 'string') return { uri: null };
      const size = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
        img.onerror = () => resolve(null);
        img.src = uri;
      });
      return { prefix: uri.slice(0, ${JPEG_PREFIX.length}), length: uri.length, size };
    })()`);
    check('study.thumbnail is a base64 JPEG data URI', thumb && thumb.prefix === JPEG_PREFIX && thumb.length > JPEG_PREFIX.length, thumb);
    check('the thumbnail decodes to a long edge of at most 128 px', Boolean(thumb && thumb.size) && Math.max(...thumb.size) <= 128 && Math.min(...thumb.size) > 0, thumb && thumb.size);

    // 4. The sidecar on disk, read back through the app's own bridge.
    const sidecar = await sidecarFromApp();
    const wanted = ['image_png', 'mask_png', 'femoral_mask_png', 'labels', 'measurements', 'geometry'];
    const missingKeys = sidecar ? wanted.filter((k) => sidecar[k] == null) : wanted;
    check('loadPrediction returns the raw /predict response', missingKeys.length === 0, { missingKeys, keys: sidecar ? Object.keys(sidecar) : null });
    check('the sidecar geometry matches the study record', Boolean(sidecar && study) && same(sidecar.geometry, study.geometry), null);

    // 5. The record round-trips through studies.json.
    const persisted = await cdp.evaluate(`(async () => {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        const raw = await window.spineContour.loadStudies();
        const found = (raw.studies || []).find((x) => x.id === ${JSON.stringify(STUDY_ID)});
        if (found && found.measurements) {
          return { found: true, measurements: found.measurements, hasGeometry: Boolean(found.geometry), thumbnailPrefix: typeof found.thumbnail === 'string' ? found.thumbnail.slice(0, ${JPEG_PREFIX.length}) : null };
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return { found: false };
    })()`);
    check('loadStudies() shows the record with measurements, geometry and thumbnail',
      persisted.found === true && persisted.hasGeometry === true && persisted.thumbnailPrefix === JPEG_PREFIX,
      { found: persisted.found, hasGeometry: persisted.hasGeometry, thumbnailPrefix: persisted.thumbnailPrefix });
    check('the persisted measurements match the store', persisted.found === true && Boolean(study) && same(persisted.measurements, study.measurements), null);

    // 6. Back on Studies the row is segmented, never Processing, with a rounded lordosis cell.
    check('back button returns to Studies', await backToStudies(), null);
    const row = await cdp.evaluate(`(() => {
      const r = document.querySelector('.studies-row[data-study-id="${STUDY_ID}"]');
      if (!r) return null;
      const badge = r.querySelector('.badge');
      return { badge: badge ? badge.textContent.trim() : null, lordosis: r.querySelector('.studies-lordosis')?.textContent ?? null };
    })()`);
    check('the row badge reads Segmented or Needs review', Boolean(row) && (row.badge === 'Segmented' || row.badge === 'Needs review'), row);
    check('the row lordosis cell is the rounded L1-S1 value', Boolean(row) && row.lordosis === `${Math.round(lordosis)}°`, row && { lordosis: row.lordosis, expected: `${Math.round(lordosis)}°` });

    // 7. Re-opening the row shows the film: the dynamic canvas is sized to it, not left at 300x150.
    check('the row re-opens the study', Boolean(await openFromStudies()), null);
    const stage = await stageState();
    check('the dynamic canvas matches the film-sized base canvas and is not the 300x150 default', sizedToFilm(stage), { canvas: stage.canvas, base: stage.base });
    check('the run card is hidden for a study with a film', stage.cardVisible === false, stage);

    // 8. Editing: RESET TO PREDICTION is armed by the prediction snapshot this run recorded.
    check('the edit toggle enters edit mode', await enterEditMode(), null);
    const resetArmed = await editBarButton('RESET TO PREDICTION');
    check('RESET TO PREDICTION is enabled once editing', Boolean(resetArmed) && resetArmed.disabled === false, resetArmed);

    // 9. Tab to L1 SA, nudge it right three times, and confirm the saver wrote the correction.
    const predictedSA = study ? l1sa(study.geometry) : null;
    const firstNudge = await nudgeAndSettle(3);
    check('Tab selects L1 SA', firstNudge.selection && firstNudge.selection.kind === 'landmark' && firstNudge.selection.level === 'L1' && firstNudge.selection.corner === 'SA', firstNudge.selection);
    check('/measure settled after the nudge (measurements changed)', Boolean(firstNudge.after) && !firstNudge.failed, { failed: firstNudge.failed, settled: Boolean(firstNudge.after) });
    const correction = await waitFor(async () => {
      const raw = await cdp.evaluate(`window.spineContour.loadStudies().then((r) => (r.studies || []).find((x) => x.id === ${JSON.stringify(STUDY_ID)}) ?? null)`);
      const point = raw ? l1sa(raw.geometry) : null;
      return point && predictedSA && point[0] !== predictedSA[0] ? point : null;
    }, 5000);
    check('loadStudies() shows the changed L1 SA x', Boolean(correction), { correction, predictedSA });
    const liveSA = firstNudge.after ? l1sa(firstNudge.after.geometry) : null;
    check('the persisted L1 SA matches the live store', Boolean(correction && liveSA) && correction[0] === liveSA[0], { correction, liveSA });

    // 10. RESET TO PREDICTION puts the sidecar's geometry back, with no /measure.
    const reset = await editBarButton('RESET TO PREDICTION');
    check('RESET TO PREDICTION is still enabled', Boolean(reset) && reset.disabled === false, reset);
    if (reset) {
      await cdp.click(reset.cx, reset.cy);
      await cdp.settle(250);
    }
    const afterReset = await openStudy();
    check('RESET TO PREDICTION restores the sidecar geometry', Boolean(sidecar && afterReset) && same(afterReset.geometry, sidecar.geometry), null);

    // 10b. End the phase CORRECTED, not reset. This is what makes phase 2 mean anything: the
    // third argument to recordPrediction (the geometry the study's CURRENT numbers describe)
    // only differs from the prediction's own for a study whose stored geometry is a correction.
    // If phase 1 ended on the reset, `study.geometry` and the sidecar's would be value-identical
    // at restart and either argument would supply the same numbers -- the riskiest semantic in
    // this task would go untested. resetToPrediction clears the selection, so Tab again.
    const secondNudge = await nudgeAndSettle(3);
    check('the study can be corrected again after a reset', Boolean(secondNudge.after) && !secondNudge.failed, { failed: secondNudge.failed, settled: Boolean(secondNudge.after) });
    check('the phase ends with a geometry that differs from the prediction',
      Boolean(secondNudge.after && sidecar) && !same(secondNudge.after.geometry, sidecar.geometry), null);

    // 11. DONE leaves edit mode.
    const done = await editBarButton('DONE');
    check('DONE is present', Boolean(done), done);
    if (done) {
      await cdp.click(done.cx, done.cy);
      await cdp.settle(150);
    }
    check('DONE leaves edit mode', (await cdp.state()).editing === false, null);

    // 12. Hand phase 2 the CORRECTED study, once studies.json has actually caught up with it.
    const final = await openStudy();
    check('the study is still open at the end of the phase', Boolean(final), null);
    check('studies.json holds the corrected geometry before the phase exits', Boolean(final) && Boolean(await persistedMatches(final.geometry)), null);
    if (final) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        id: STUDY_ID, measurements: final.measurements, geometry: final.geometry, thumbnail: final.thumbnail,
      }, null, 2));
    }
    check('wrote out/persist-state.json for the restart phase', fs.existsSync(STATE_FILE), STATE_FILE);
  }

  if (PHASE === 'restart') {
    if (!fs.existsSync(STATE_FILE)) {
      console.error(`missing ${STATE_FILE} -- run "--phase run" first`);
      process.exit(2);
    }
    const before = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

    // A. The record itself survived the restart, numbers and thumbnail intact.
    const restored = await waitFor(async () => (await storedStudy()) || null, 5000);
    check(`${STUDY_ID} is in the store after the restart`, Boolean(restored), restored ? restored.id : null);
    check('the measurements are deep-equal to what phase 1 measured', Boolean(restored) && same(restored.measurements, before.measurements), null);
    check('the thumbnail is the same data URI', Boolean(restored) && restored.thumbnail === before.thumbnail, restored ? { length: restored.thumbnail ? restored.thumbnail.length : null } : null);
    check('the geometry survived the restart', Boolean(restored) && same(restored.geometry, before.geometry), null);

    // The correction, not the prediction. Read before section B moves the sidecar aside. Phase 1
    // deliberately ends on a nudge rather than the reset, so these two geometries differ; that
    // difference is the whole reason recordPrediction takes a third argument, and without it the
    // restore path would look identical whichever geometry it passed.
    const sidecarAtStart = await sidecarFromApp();
    check('the sidecar reads back through the bridge after the restart', Boolean(sidecarAtStart && sidecarAtStart.geometry), sidecarAtStart ? Object.keys(sidecarAtStart) : null);
    check('the restored geometry is the CORRECTION, not the prediction', Boolean(restored && sidecarAtStart) && !same(restored.geometry, sidecarAtStart.geometry), null);
    check('the sidecar still holds the model\'s own geometry', Boolean(sidecarAtStart && before) && !same(sidecarAtStart.geometry, before.geometry), null);

    // B. Missing sidecar FIRST (see the ORDER NOTE at the top): the film cache is still empty,
    // so this open really does read the sidecar, and a failed read leaves the cache empty.
    const sidecarOnDisk = fs.existsSync(SIDECAR);
    check('the prediction sidecar is on disk', sidecarOnDisk, SIDECAR);
    if (sidecarOnDisk) fs.renameSync(SIDECAR, `${SIDECAR}.bak`);
    // try/finally around the whole section: a throw between the move and the restore would
    // leave the scratch profile permanently without its sidecar, poisoning every later run of
    // this suite against the same SMOKE_KEEP_PROFILE directory.
    try {
      check('the row opens with the sidecar moved aside', Boolean(await openFromStudies()), null);
      const missing = await waitFor(async () => {
        const s = await stageState();
        return s.eyebrow === 'FILM UNAVAILABLE' ? s : null;
      }, 5000);
      check('the card shows FILM UNAVAILABLE', Boolean(missing), missing ?? (await stageState()));
      check('it offers a Re-run segmentation button', Boolean(missing) && missing.buttonVisible === true && missing.buttonText === 'Re-run segmentation' && missing.buttonDisabled === false, missing);
      check('the edit toggle is disabled while the film is missing', Boolean(missing) && missing.editDisabled === true, missing);
      check('the re-run toolbar button stays enabled -- that is the remedy', Boolean(missing) && missing.rerunDisabled === false, missing);
    } finally {
      if (fs.existsSync(`${SIDECAR}.bak`)) fs.renameSync(`${SIDECAR}.bak`, SIDECAR);
    }

    // C. The sidecar is back: leaving and re-entering restores the film.
    check('back button returns to Studies', await backToStudies(), null);
    check('the row re-opens the study', Boolean(await openFromStudies()), null);
    const shown = await waitFor(async () => {
      const s = await stageState();
      return s.cardVisible === false && sizedToFilm(s) ? s : null;
    }, 5000);
    check('within 5 s the run card is hidden and the canvas matches the film-sized base canvas', Boolean(shown), shown ?? (await stageState()));
    const stageText = await cdp.evaluate("(() => { const e = document.querySelector('.analysis-screen'); return e ? e.innerText : null; })()");
    check('no LOADING text remains on the stage', typeof stageText === 'string' && !/LOADING/.test(stageText), stageText ? stageText.slice(0, 120) : stageText);

    const ll = before.measurements.LL['L1-S1'];
    const llText = (await text('[data-row-key="LL"] .meas-value') || '').trim();
    check('the measurements panel LL row shows the persisted value', llText === `${ll.toFixed(1)}°`, { llText, expected: `${ll.toFixed(1)}°` });

    // D. The prediction snapshot came back from the sidecar, so editing is fully armed.
    check('the edit toggle enters edit mode', await enterEditMode(), null);
    const resetArmed = await editBarButton('RESET TO PREDICTION');
    check('RESET TO PREDICTION is enabled after a restart', Boolean(resetArmed) && resetArmed.disabled === false, resetArmed);

    const nudge = await nudgeAndSettle(1);
    const startSA = nudge.before ? l1sa(nudge.before.geometry) : null;
    check('the open study has geometry to nudge', Boolean(startSA), startSA);
    // The settled state, not the optimistic one: nudgeAndSettle waits for `measurements` to
    // change, which only a successful /measure writes. Asserting the geometry first would pass
    // whether the round trip succeeded, failed or never ran.
    check('/measure settled after the nudge (measurements changed)', Boolean(nudge.after) && !nudge.failed, { failed: nudge.failed, settled: Boolean(nudge.after) });
    const nudgedSA = nudge.after ? l1sa(nudge.after.geometry) : null;
    check('the correction held -- /measure did not revert it to the prediction', Boolean(nudgedSA && startSA) && nudgedSA[0] !== startSA[0], { startSA, nudgedSA });
    const toast = (await cdp.state()).toast || '';
    check('no failed-measure toast', !FAILED_MEASURE.test(toast), toast);

    const sidecar = await sidecarFromApp();
    check('the sidecar is back on disk after section B', Boolean(sidecar && sidecar.geometry), sidecar ? Object.keys(sidecar) : null);
    const reset = await editBarButton('RESET TO PREDICTION');
    check('RESET TO PREDICTION is still enabled', Boolean(reset) && reset.disabled === false, reset);
    if (reset) {
      await cdp.click(reset.cx, reset.cy);
      await cdp.settle(250);
    }
    const afterReset = await openStudy();
    check('RESET TO PREDICTION restores the sidecar geometry', Boolean(sidecar && afterReset) && same(afterReset.geometry, sidecar.geometry), null);

    const done = await editBarButton('DONE');
    check('DONE is present', Boolean(done), done);
    if (done) {
      await cdp.click(done.cx, done.cy);
      await cdp.settle(150);
    }
    check('DONE leaves edit mode', (await cdp.state()).editing === false, null);
  }

  check('no console errors or exceptions during the run', cdp.errors.length === 0, cdp.errors);
} finally {
  cdp.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${JSON.stringify(r.detail)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed (phase ${PHASE})`);
process.exit(failed ? 1 : 0);
