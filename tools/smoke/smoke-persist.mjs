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
  return {
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

try {
  if (PHASE === 'run') {
    // 1. SP-9000, unsegmented, open on Analysis. inject-study.js prepends it and replaces any
    // copy an earlier suite left in this profile, so it both creates and reuses.
    const injected = await cdp.evaluate(fs.readFileSync(path.join(HERE, 'inject-study.js'), 'utf8'));
    check('inject-study.js parks SP-9000 and opens Analysis', injected && injected.screen === 'analysis' && injected.openId === STUDY_ID, injected);
    check('the run card offers Run segmentation', injected && injected.runButton === true, injected);

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
    let stage = await stageState();
    check('the dynamic canvas is sized to the film', Boolean(stage.canvas) && stage.canvas[0] > 300, stage.canvas);
    check('the run card is hidden for a study with a film', stage.cardVisible === false, stage);

    // 8. Editing: RESET TO PREDICTION is armed by the prediction snapshot this run recorded.
    check('the edit toggle enters edit mode', await enterEditMode(), null);
    const resetArmed = await editBarButton('RESET TO PREDICTION');
    check('RESET TO PREDICTION is enabled once editing', Boolean(resetArmed) && resetArmed.disabled === false, resetArmed);

    // 9. Tab to L1 SA, nudge it right three times, and confirm the saver wrote the correction.
    const predictedSA = study ? l1sa(study.geometry) : null;
    await cdp.key('Tab');
    await cdp.settle(60);
    const selection = (await cdp.state()).selection;
    check('Tab selects L1 SA', selection && selection.kind === 'landmark' && selection.level === 'L1' && selection.corner === 'SA', selection);
    for (let i = 0; i < 3; i += 1) { await cdp.key('ArrowRight'); await cdp.settle(30); }
    await cdp.settle(400);
    const correction = await waitFor(async () => {
      const raw = await cdp.evaluate(`window.spineContour.loadStudies().then((r) => (r.studies || []).find((x) => x.id === ${JSON.stringify(STUDY_ID)}) ?? null)`);
      const point = raw ? l1sa(raw.geometry) : null;
      return point && predictedSA && point[0] !== predictedSA[0] ? point : null;
    }, 4000);
    check('loadStudies() shows the changed L1 SA x', Boolean(correction), { correction, predictedSA });
    const liveStudy = await openStudy();
    const liveSA = liveStudy ? l1sa(liveStudy.geometry) : null;
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

    // 11. DONE leaves edit mode.
    const done = await editBarButton('DONE');
    check('DONE is present', Boolean(done), done);
    if (done) {
      await cdp.click(done.cx, done.cy);
      await cdp.settle(150);
    }
    check('DONE leaves edit mode', (await cdp.state()).editing === false, null);

    // 12. Hand phase 2 what this run measured.
    const final = await openStudy();
    check('the study is still open at the end of the phase', Boolean(final), null);
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

    // B. Missing sidecar FIRST (see the ORDER NOTE at the top): the film cache is still empty,
    // so this open really does read the sidecar, and a failed read leaves the cache empty.
    const sidecarOnDisk = fs.existsSync(SIDECAR);
    check('the prediction sidecar is on disk', sidecarOnDisk, SIDECAR);
    if (sidecarOnDisk) fs.renameSync(SIDECAR, `${SIDECAR}.bak`);
    check('the row opens with the sidecar moved aside', Boolean(await openFromStudies()), null);
    const missing = await waitFor(async () => {
      const s = await stageState();
      return s.eyebrow === 'FILM UNAVAILABLE' ? s : null;
    }, 5000);
    check('the card shows FILM UNAVAILABLE', Boolean(missing), missing ?? (await stageState()));
    check('it offers a Re-run segmentation button', Boolean(missing) && missing.buttonVisible === true && missing.buttonText === 'Re-run segmentation' && missing.buttonDisabled === false, missing);
    check('the edit toggle is disabled while the film is missing', Boolean(missing) && missing.editDisabled === true, missing);
    check('the re-run toolbar button stays enabled -- that is the remedy', Boolean(missing) && missing.rerunDisabled === false, missing);
    if (fs.existsSync(`${SIDECAR}.bak`)) fs.renameSync(`${SIDECAR}.bak`, SIDECAR);

    // C. The sidecar is back: leaving and re-entering restores the film.
    check('back button returns to Studies', await backToStudies(), null);
    check('the row re-opens the study', Boolean(await openFromStudies()), null);
    const shown = await waitFor(async () => {
      const s = await stageState();
      return s.cardVisible === false && s.canvas && s.canvas[0] > 300 ? s : null;
    }, 5000);
    check('within 5 s the run card is hidden and the canvas is sized to the film', Boolean(shown), shown ?? (await stageState()));
    const stageText = await cdp.evaluate("(() => { const e = document.querySelector('.analysis-screen'); return e ? e.innerText : null; })()");
    check('no LOADING text remains on the stage', typeof stageText === 'string' && !/LOADING/.test(stageText), stageText ? stageText.slice(0, 120) : stageText);

    const ll = before.measurements.LL['L1-S1'];
    const llText = (await text('[data-row-key="LL"] .meas-value') || '').trim();
    check('the measurements panel LL row shows the persisted value', llText === `${ll.toFixed(1)}°`, { llText, expected: `${ll.toFixed(1)}°` });

    // D. The prediction snapshot came back from the sidecar, so editing is fully armed.
    check('the edit toggle enters edit mode', await enterEditMode(), null);
    const resetArmed = await editBarButton('RESET TO PREDICTION');
    check('RESET TO PREDICTION is enabled after a restart', Boolean(resetArmed) && resetArmed.disabled === false, resetArmed);

    const beforeNudge = await openStudy();
    const startSA = beforeNudge ? l1sa(beforeNudge.geometry) : null;
    check('the open study has geometry to nudge', Boolean(startSA), startSA);
    await cdp.key('Tab');
    await cdp.settle(60);
    await cdp.key('ArrowRight');
    await cdp.settle(400);
    const measured = await waitFor(async () => {
      const state = await cdp.state();
      if (FAILED_MEASURE.test(state.toast || '')) return { failed: state.toast };
      const study = await openStudy();
      const point = study ? l1sa(study.geometry) : null;
      return point && startSA && point[0] !== startSA[0] ? { point } : null;
    }, 4000);
    check('the nudge held and /measure did not revert it', Boolean(measured) && !measured.failed, { measured, startSA });
    const toast = (await cdp.state()).toast || '';
    check('no failed-measure toast', !FAILED_MEASURE.test(toast), toast);

    const sidecar = await sidecarFromApp();
    check('the sidecar still reads back through the bridge', Boolean(sidecar && sidecar.geometry), sidecar ? Object.keys(sidecar) : null);
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
