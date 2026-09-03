// Gate 2 smoke (after Task 14): landmark drag with one /measure per release, S1 drag, femoral
// centre and rim drags (hip_midpoint resync, radius floor, circumference grab), retrace and
// fit, retrace cancellation, no console errors. Trusted input via cdp-lib. Assumes the app is
// running with a segmented study open on Analysis, and reads /measure counts from app.log.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-lib.mjs';

const LOG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'app.log');
const measureCount = () => (fs.readFileSync(LOG, 'utf8').match(/POST \/measure HTTP\/1\.1" 200/g) || []).length;
// GATE2_STAGE=12 runs the landmark/S1 drag sections; 13 adds femoral drags; 14 (default) adds retrace.
const STAGE = Number(process.env.GATE2_STAGE || 14);
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const cdp = await connect();
const geometry = () => cdp.evaluate(`import('./renderer/store.js').then((m) => { const st = m.getState(); return st.studies.find((x) => x.id === st.openId).geometry; })`);
const measurements = () => cdp.evaluate(`import('./renderer/store.js').then((m) => { const st = m.getState(); return st.studies.find((x) => x.id === st.openId).measurements; })`);
const editBarButton = (label) => cdp.evaluate(`(() => { const b = [...document.querySelectorAll('.viewer-editbar button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; const r = b.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, disabled: b.disabled, pressed: b.getAttribute('aria-pressed'), active: b.classList.contains('is-active') }; })()`);
// Waits until the store's measurements object changes from `before` (a /measure landed), up to 4 s.
async function waitForMeasure(before) {
  const key = JSON.stringify(before);
  for (let i = 0; i < 40; i += 1) {
    await cdp.settle(100);
    const now = await measurements();
    if (JSON.stringify(now) !== key) return now;
  }
  return null;
}
const pixelRatio = () => cdp.evaluate(`(() => { const c = document.querySelector('.viewer-canvas-dynamic'); return c.width / c.getBoundingClientRect().width; })()`);

try {
  let s = await cdp.state();
  check('precondition: analysis screen with a result', s.screen === 'analysis' && s.studies.some((x) => x.id === s.openId && x.geometry), s.openId);
  await cdp.setState('{ editing: true, selection: null, zoom: 1, panX: 0, panY: 0, panMode: false, selectedLevel: "L2" }');
  await cdp.settle(120);
  const pr = await pixelRatio();

  // 1. Landmark drag: L2 SP (its superior endplate drives LL L2-S1) by (+12, +9) CSS px, one /measure, geometry committed as a move.
  let g0 = await geometry();
  let m0 = await measurements();
  let logBefore = measureCount();
  const l2sp = await cdp.toClient(g0.vertebrae.L2.superior[1][0], g0.vertebrae.L2.superior[1][1]);
  await cdp.drag(l2sp.x, l2sp.y, l2sp.x + 12, l2sp.y + 9, { steps: 8 });
  await cdp.settle(50);
  s = await cdp.state();
  check('dragging L2 SP selects it', s.selection && s.selection.kind === 'landmark' && s.selection.level === 'L2' && s.selection.corner === 'SP', s.selection);
  let g1 = await geometry();
  check('L2 SP moved by the pointer delta in image space', near(g1.vertebrae.L2.superior[1][0] - g0.vertebrae.L2.superior[1][0], 12 * pr, 1.5 * pr) && near(g1.vertebrae.L2.superior[1][1] - g0.vertebrae.L2.superior[1][1], 9 * pr, 1.5 * pr), [g0.vertebrae.L2.superior[1], g1.vertebrae.L2.superior[1], pr]);
  check('quadrilateral kept in sync with the moved corner', JSON.stringify(g1.vertebrae.L2.quadrilateral[1]) === JSON.stringify(g1.vertebrae.L2.superior[1]), g1.vertebrae.L2.quadrilateral);
  let m1 = await waitForMeasure(m0);
  check('measurements update after the release', m1 && m1.LL['L2-S1'] !== m0.LL['L2-S1'], m1 && [m0.LL['L2-S1'], m1.LL['L2-S1']]);
  await cdp.settle(300);
  check('exactly one /measure for one drag', measureCount() - logBefore === 1, measureCount() - logBefore);

  // 2. A jittery drag with one release is still one /measure.
  logBefore = measureCount();
  m0 = await measurements();
  const l2spNow = await cdp.toClient(g1.vertebrae.L2.superior[1][0], g1.vertebrae.L2.superior[1][1]);
  await cdp.mouse('mouseMoved', l2spNow.x, l2spNow.y);
  await cdp.mouse('mousePressed', l2spNow.x, l2spNow.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 0; i < 12; i += 1) await cdp.mouse('mouseMoved', l2spNow.x + (i % 2 ? 15 : -15), l2spNow.y + (i % 3), { button: 'left', buttons: 1 });
  await cdp.mouse('mouseMoved', l2spNow.x - 12, l2spNow.y - 9, { button: 'left', buttons: 1 });
  await cdp.mouse('mouseReleased', l2spNow.x - 12, l2spNow.y - 9, { button: 'left', buttons: 0, clickCount: 1 });
  m1 = await waitForMeasure(m0);
  await cdp.settle(300);
  check('a jittery drag with one release is exactly one /measure', measureCount() - logBefore === 1 && m1 !== null, measureCount() - logBefore);

  // 3. S1 SA drag changes SS.
  g0 = await geometry();
  m0 = await measurements();
  const s1sa = await cdp.toClient(g0.s1_superior[0][0], g0.s1_superior[0][1]);
  await cdp.drag(s1sa.x, s1sa.y, s1sa.x, s1sa.y - 8);
  m1 = await waitForMeasure(m0);
  check('dragging S1 SA changes sacral slope', m1 && m1.SS !== m0.SS, m1 && [m0.SS, m1.SS]);

  if (STAGE >= 13) {
  // 4. Femoral centre drag translates, radius unchanged, hip_midpoint resynced.
  g0 = await geometry();
  m0 = await measurements();
  const left = await cdp.toClient(g0.femoral_circles[0][0], g0.femoral_circles[0][1]);
  await cdp.drag(left.x, left.y, left.x + 10, left.y - 6);
  await cdp.settle(50);
  g1 = await geometry();
  check('left centre drag translates the circle', near(g1.femoral_circles[0][0] - g0.femoral_circles[0][0], 10 * pr, 1.5 * pr) && near(g1.femoral_circles[0][1] - g0.femoral_circles[0][1], -6 * pr, 1.5 * pr), [g0.femoral_circles[0], g1.femoral_circles[0]]);
  check('radius unchanged by a centre drag', near(g1.femoral_circles[0][2], g0.femoral_circles[0][2], 1e-6), [g0.femoral_circles[0][2], g1.femoral_circles[0][2]]);
  check('hip_midpoint is the mean of the centres after the commit', near(g1.hip_midpoint[0], (g1.femoral_circles[0][0] + g1.femoral_circles[1][0]) / 2, 1e-6) && near(g1.hip_midpoint[1], (g1.femoral_circles[0][1] + g1.femoral_circles[1][1]) / 2, 1e-6), g1.hip_midpoint);
  m1 = await waitForMeasure(m0);
  check('PT changes after a femoral centre drag', m1 && m1.PT !== m0.PT, m1 && [m0.PT, m1.PT]);

  // 5. Rim drag resizes about a fixed centre; grabbing at 9 o'clock works; inward past the centre floors at 1.
  g0 = await geometry();
  const [rcx, rcy, rr] = g0.femoral_circles[1];
  const rim = await cdp.toClient(rcx + rr, rcy);
  await cdp.drag(rim.x, rim.y, rim.x + 8, rim.y);
  await cdp.settle(50);
  g1 = await geometry();
  check('rim drag outward grows the radius', near(g1.femoral_circles[1][2] - rr, 8 * pr, 1.5 * pr), [rr, g1.femoral_circles[1][2]]);
  check('rim drag leaves the centre alone', near(g1.femoral_circles[1][0], rcx, 1e-6) && near(g1.femoral_circles[1][1], rcy, 1e-6), g1.femoral_circles[1]);
  await waitForMeasure(await measurements());
  g0 = await geometry();
  const nine = await cdp.toClient(g0.femoral_circles[1][0] - g0.femoral_circles[1][2], g0.femoral_circles[1][1]);
  await cdp.drag(nine.x, nine.y, nine.x - 6, nine.y);
  await cdp.settle(50);
  g1 = await geometry();
  check('grabbing the circumference at 9 o\'clock resizes', near(g1.femoral_circles[1][2] - g0.femoral_circles[1][2], 6 * pr, 1.5 * pr), [g0.femoral_circles[1][2], g1.femoral_circles[1][2]]);
  await waitForMeasure(await measurements());
  g0 = await geometry();
  const rim2 = await cdp.toClient(g0.femoral_circles[1][0] + g0.femoral_circles[1][2], g0.femoral_circles[1][1]);
  const centre2 = await cdp.toClient(g0.femoral_circles[1][0], g0.femoral_circles[1][1]);
  await cdp.drag(rim2.x, rim2.y, centre2.x, centre2.y, { steps: 10 });
  await cdp.settle(50);
  g1 = await geometry();
  check('dragging the rim onto the centre floors the radius at 1, never negative', g1.femoral_circles[1][2] >= 1 && g1.femoral_circles[1][2] < 3 * pr + 1, g1.femoral_circles[1][2]);
  m1 = await waitForMeasure(await measurements());
  await cdp.settle(300);
  s = await cdp.state();
  check('a 1px radius is accepted by /measure (no toast)', !s.toast, s.toast);
  // Restore a sane right circle for the retrace test via a rim drag outward.
  g0 = await geometry();
  const rim3 = await cdp.toClient(g0.femoral_circles[1][0] + g0.femoral_circles[1][2], g0.femoral_circles[1][1]);
  await cdp.drag(rim3.x, rim3.y, rim3.x + 20, rim3.y);
  await waitForMeasure(await measurements());

  }

  if (STAGE >= 14) {
  // 6. Retrace: select the left centre, RETRACE, place 4 points on a known circle, FIT.
  g0 = await geometry();
  const leftNow = await cdp.toClient(g0.femoral_circles[0][0], g0.femoral_circles[0][1]);
  await cdp.click(leftNow.x, leftNow.y);
  await cdp.settle(120);
  s = await cdp.state();
  check('clicking the left centre selects it', s.selection && s.selection.kind === 'femoral' && s.selection.side === 'left' && s.selection.part === 'center', s.selection);
  let retrace = await editBarButton('RETRACE');
  check('RETRACE enabled with a femoral selection', retrace && retrace.disabled === false && retrace.pressed === 'false', retrace);
  await cdp.click(retrace.cx, retrace.cy);
  await cdp.settle(120);
  retrace = await editBarButton('RETRACE');
  check('RETRACE toggles on (aria-pressed, is-active)', retrace.pressed === 'true' && retrace.active === true, retrace);
  const target = { cx: g0.femoral_circles[0][0] + 6, cy: g0.femoral_circles[0][1] - 4, r: Math.max(8, g0.femoral_circles[0][2] * 0.8) };
  const angles = [10, 100, 190, 280];
  for (const [i, deg] of angles.entries()) {
    const p = await cdp.toClient(target.cx + target.r * Math.cos((deg * Math.PI) / 180), target.cy + target.r * Math.sin((deg * Math.PI) / 180));
    await cdp.click(p.x, p.y);
    await cdp.settle(80);
    const fit = await editBarButton('FIT');
    if (i === 1) check('FIT disabled with 2 points', fit && fit.disabled === true, fit);
    if (i === 2) check('FIT enabled with 3 points', fit && fit.disabled === false, fit);
  }
  const gBeforeFit = await geometry();
  check('placing trace points does not move the circle', JSON.stringify(gBeforeFit.femoral_circles[0]) === JSON.stringify(g0.femoral_circles[0]), gBeforeFit.femoral_circles[0]);
  m0 = await measurements();
  const fit = await editBarButton('FIT');
  await cdp.click(fit.cx, fit.cy);
  await cdp.settle(120);
  g1 = await geometry();
  check('FIT re-fits the left circle to the traced points', near(g1.femoral_circles[0][0], target.cx, 1.5 * pr) && near(g1.femoral_circles[0][1], target.cy, 1.5 * pr) && near(g1.femoral_circles[0][2], target.r, 1.5 * pr), [g1.femoral_circles[0], target]);
  retrace = await editBarButton('RETRACE');
  check('RETRACE turns off after FIT', retrace.pressed === 'false' && retrace.active === false, retrace);
  m1 = await waitForMeasure(m0);
  check('measurements update after FIT', m1 !== null, m1 && m1.PT);

  // 7. RETRACE again with 2 points, then RETRACE off clears; a landmark selection disables RETRACE.
  retrace = await editBarButton('RETRACE');
  await cdp.click(retrace.cx, retrace.cy);
  await cdp.settle(80);
  for (const deg of [30, 200]) {
    const p = await cdp.toClient(target.cx + target.r * Math.cos((deg * Math.PI) / 180), target.cy + target.r * Math.sin((deg * Math.PI) / 180));
    await cdp.click(p.x, p.y);
    await cdp.settle(60);
  }
  let fit2 = await editBarButton('FIT');
  check('FIT stays disabled with only 2 points', fit2.disabled === true, fit2);
  retrace = await editBarButton('RETRACE');
  await cdp.click(retrace.cx, retrace.cy);
  await cdp.settle(80);
  retrace = await editBarButton('RETRACE');
  fit2 = await editBarButton('FIT');
  check('RETRACE off clears the points and disables FIT', retrace.pressed === 'false' && fit2.disabled === true, [retrace, fit2]);
  g0 = await geometry();
  const l3sa = await cdp.toClient(g0.vertebrae.L3.superior[0][0], g0.vertebrae.L3.superior[0][1]);
  await cdp.click(l3sa.x, l3sa.y);
  await cdp.settle(80);
  retrace = await editBarButton('RETRACE');
  check('a landmark selection disables RETRACE', retrace.disabled === true, retrace);

  // 8. Escape while retracing with points placed exits cleanly.
  const leftAgain = await cdp.toClient(g0.femoral_circles[0][0], g0.femoral_circles[0][1]);
  await cdp.click(leftAgain.x, leftAgain.y);
  await cdp.settle(80);
  retrace = await editBarButton('RETRACE');
  await cdp.click(retrace.cx, retrace.cy);
  await cdp.settle(80);
  const p = await cdp.toClient(target.cx + target.r, target.cy);
  await cdp.click(p.x, p.y);
  await cdp.settle(60);
  await cdp.key('Escape');
  await cdp.settle(120);
  s = await cdp.state();
  check('Escape while retracing exits edit mode', s.editing === false && s.selection === null, [s.editing, s.selection]);
  await cdp.setState('{ editing: true }');
  await cdp.settle(120);
  retrace = await editBarButton('RETRACE');
  fit2 = await editBarButton('FIT');
  check('re-entering edit mode shows no leftover retrace state', retrace.pressed === 'false' && fit2.disabled === true, [retrace, fit2]);

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
