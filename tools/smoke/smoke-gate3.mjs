// Gate 3 smoke (after Task 18): Tab / Shift+Tab cycle, arrow nudges (1px, 10px with Shift,
// one /measure per burst), Tab inside the edit bar not hijacked, RESET TO PREDICTION restoring
// the recorded prediction with no /measure, Re-run segmentation (run card, edit-mode exit,
// new reset target), no console errors. Expects last-run.json beside it: the run-and-wait
// output for the open study (its measurements are the reset target).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(HERE, 'out', 'app.log');
const measureCount = () => (fs.readFileSync(LOG, 'utf8').match(/POST \/measure HTTP\/1\.1" 200/g) || []).length;
const lastRun = JSON.parse(fs.readFileSync(path.join(HERE, 'out', 'last-run.json'), 'utf8'));
// GATE3_STAGE=16 runs the keyboard sections; 17 adds reset; 18 (default) adds re-run.
const STAGE = Number(process.env.GATE3_STAGE || 18);
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const sameSel = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const cdp = await connect();
const geometry = () => cdp.evaluate(`import('./renderer/store.js').then((m) => { const st = m.getState(); return st.studies.find((x) => x.id === st.openId).geometry; })`);
const measurements = () => cdp.evaluate(`import('./renderer/store.js').then((m) => { const st = m.getState(); return st.studies.find((x) => x.id === st.openId).measurements; })`);
const editBarButton = (label) => cdp.evaluate(`(() => { const b = [...document.querySelectorAll('.viewer-editbar button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; const r = b.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, disabled: b.disabled, pressed: b.getAttribute('aria-pressed') }; })()`);
async function waitForMeasure(before) {
  const key = JSON.stringify(before);
  for (let i = 0; i < 40; i += 1) {
    await cdp.settle(100);
    const now = await measurements();
    if (JSON.stringify(now) !== key) return now;
  }
  return null;
}
async function waitFor(predicateSource, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`import('./renderer/store.js').then((m) => { const s = m.getState(); return Boolean(${predicateSource}); })`)) return true;
    await cdp.settle(150);
  }
  return false;
}

try {
  let s = await cdp.state();
  check('precondition: analysis screen with a result', s.screen === 'analysis' && s.studies.some((x) => x.id === s.openId && x.geometry), s.openId);
  await cdp.setState('{ editing: true, selection: null, zoom: 1, panX: 0, panY: 0, panMode: false, selectedLevel: null }');
  await cdp.settle(120);

  // 1. Tab cycle through all 24 stops and wrap; Shift+Tab wraps backward.
  const expected = [];
  for (const level of ['L1', 'L2', 'L3', 'L4', 'L5']) for (const corner of ['SA', 'SP', 'IA', 'IP']) expected.push({ kind: 'landmark', level, corner });
  expected.push({ kind: 'landmark', level: 'S1', corner: 'SA' }, { kind: 'landmark', level: 'S1', corner: 'SP' }, { kind: 'femoral', side: 'left', part: 'center' }, { kind: 'femoral', side: 'right', part: 'center' });
  let mismatches = [];
  for (let i = 0; i < 24; i += 1) {
    await cdp.key('Tab');
    await cdp.settle(20);
    s = await cdp.state();
    if (!sameSel(s.selection, expected[i])) mismatches.push([i, s.selection]);
  }
  check('Tab walks all 24 stops in anatomical order', mismatches.length === 0, mismatches.slice(0, 3));
  await cdp.key('Tab');
  await cdp.settle(20);
  s = await cdp.state();
  check('Tab wraps from the right head to L1 SA', sameSel(s.selection, expected[0]), s.selection);
  await cdp.key('Tab', { shift: true });
  await cdp.settle(20);
  s = await cdp.state();
  check('Shift+Tab wraps from L1 SA to the right head', sameSel(s.selection, expected[23]), s.selection);
  check('Tab did not move document focus around the page', await cdp.evaluate(`document.activeElement === document.body || document.activeElement.closest('.viewer-toolbar') !== null`), await cdp.evaluate('document.activeElement.tagName + "." + document.activeElement.className'));

  // 2. Arrow nudges on L3 SA: 5 x ArrowRight then Shift+ArrowUp = (+5, -10) image px, one /measure.
  await cdp.setState('{ selection: { kind: "landmark", level: "L3", corner: "SA" } }');
  await cdp.settle(80);
  let g0 = await geometry();
  let m0 = await measurements();
  let logBefore = measureCount();
  for (let i = 0; i < 5; i += 1) await cdp.key('ArrowRight');
  await cdp.key('ArrowUp', { shift: true });
  let g1 = await geometry();
  check('five ArrowRight then Shift+ArrowUp moves L3 SA by (+5, -10) image px', near(g1.vertebrae.L3.superior[0][0] - g0.vertebrae.L3.superior[0][0], 5, 1e-6) && near(g1.vertebrae.L3.superior[0][1] - g0.vertebrae.L3.superior[0][1], -10, 1e-6), [g0.vertebrae.L3.superior[0], g1.vertebrae.L3.superior[0]]);
  let m1 = await waitForMeasure(m0);
  await cdp.settle(400);
  check('a burst of six nudges is exactly one /measure', measureCount() - logBefore === 1 && m1 !== null, measureCount() - logBefore);
  check('LL updates after the nudge burst', m1 && m1.LL['L3-S1'] !== m0.LL['L3-S1'], m1 && [m0.LL['L3-S1'], m1.LL['L3-S1']]);

  // 3. Arrow keys still nudge when a measurement row has focus.
  const row = await cdp.rect('.meas-row');
  await cdp.click(row.cx, row.cy);
  await cdp.settle(80);
  await cdp.setState('{ selection: { kind: "landmark", level: "L3", corner: "SA" } }');
  g0 = await geometry();
  await cdp.key('ArrowLeft');
  await cdp.settle(50);
  g1 = await geometry();
  check('ArrowLeft nudges while a panel row has focus', near(g1.vertebrae.L3.superior[0][0] - g0.vertebrae.L3.superior[0][0], -1, 1e-6), [g0.vertebrae.L3.superior[0][0], g1.vertebrae.L3.superior[0][0]]);
  await waitForMeasure(await measurements());

  // 4. Tab inside the edit bar is ordinary focus movement.
  await cdp.setState('{ selection: { kind: "femoral", side: "left", part: "center" } }');
  await cdp.settle(80);
  let retrace = await editBarButton('RETRACE');
  await cdp.click(retrace.cx, retrace.cy);
  await cdp.settle(80);
  const before = await cdp.state();
  await cdp.key('Tab');
  await cdp.settle(50);
  s = await cdp.state();
  const focusInBar = await cdp.evaluate(`document.activeElement.closest('.viewer-editbar') !== null`);
  check('Tab inside the edit bar moves focus instead of cycling handles', sameSel(s.selection, before.selection) && focusInBar, [s.selection, focusInBar]);
  retrace = await editBarButton('RETRACE');
  await cdp.click(retrace.cx, retrace.cy);
  await cdp.settle(80);

  if (STAGE >= 17) {
  // 5. RESET TO PREDICTION restores the recorded prediction exactly, with no /measure.
  logBefore = measureCount();
  const reset = await editBarButton('RESET TO PREDICTION');
  check('RESET TO PREDICTION present and enabled', reset && reset.disabled === false, reset);
  await cdp.click(reset.cx, reset.cy);
  await cdp.settle(300);
  s = await cdp.state();
  g1 = await geometry();
  m1 = await measurements();
  check('reset clears the selection', s.selection === null, s.selection);
  check('reset restores the prediction measurements exactly', JSON.stringify(m1) === JSON.stringify(lastRun.measurements), [m1 && m1.PI, lastRun.measurements.PI]);
  check('reset restores the predicted femoral circles exactly', JSON.stringify(g1.femoral_circles) === JSON.stringify(lastRun.femoral), g1.femoral_circles);
  check('reset makes no /measure call', measureCount() - logBefore === 0, measureCount() - logBefore);

  }

  if (STAGE >= 18) {
  // 6. Re-run segmentation: run card shows, edit mode exits, new prediction becomes the reset target.
  const rerun = await cdp.rect('.viewer-tool[aria-label="Re-run segmentation"]');
  check('Re-run button present', Boolean(rerun), rerun);
  const rerunDisabledEditing = await cdp.evaluate(`document.querySelector('.viewer-tool[aria-label="Re-run segmentation"]').disabled`);
  check('Re-run enabled with a result', rerunDisabledEditing === false, rerunDisabledEditing);
  await cdp.click(rerun.cx, rerun.cy);
  const sawRunning = await waitFor('s.running === true', 3000);
  const cardVisible = await cdp.evaluate(`(() => { const c = document.querySelector('.run-card'); return c && !c.classList.contains('is-hidden'); })()`);
  check('re-run sets running and shows the run card over an existing result', sawRunning && cardVisible, [sawRunning, cardVisible]);
  const finished = await waitFor('s.running === false && s.studies.find((x) => x.id === s.openId).measurements', 240000);
  s = await cdp.state();
  check('re-run completes', finished && !s.running, [finished, s.running, s.toast]);
  check('re-run exits edit mode and clears the selection', s.editing === false && s.selection === null, [s.editing, s.selection]);
  const cardHidden = await cdp.evaluate(`document.querySelector('.run-card').classList.contains('is-hidden')`);
  check('run card hidden again after the re-run', cardHidden === true, cardHidden);
  const newPrediction = await measurements();
  await cdp.setState('{ editing: true, selection: { kind: "landmark", level: "L2", corner: "SP" } }');
  await cdp.settle(80);
  await cdp.key('ArrowRight', { shift: true });
  await waitForMeasure(newPrediction);
  const reset2 = await editBarButton('RESET TO PREDICTION');
  await cdp.click(reset2.cx, reset2.cy);
  await cdp.settle(300);
  m1 = await measurements();
  check('after a re-run, reset returns to the NEW prediction', JSON.stringify(m1) === JSON.stringify(newPrediction), [m1 && m1.PI, newPrediction.PI]);

  }

  await cdp.setState('{ editing: false, selection: null }');
  check('no console errors or exceptions during the run', cdp.errors.length === 0, cdp.errors);
} finally {
  cdp.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${JSON.stringify(r.detail)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
