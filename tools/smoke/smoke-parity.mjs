// Post-Task-8 parity smoke: wheel zoom, Fit, pan-toggle drag, coarse click-select, and the
// new middle-button pan, driven with trusted input events. Assumes the app is running with
// a segmented study open on the Analysis screen (inject-study.js + run-and-wait.js).
import { connect } from './cdp-lib.mjs';

const near = (a, b, tol = 0.51) => Math.abs(a - b) <= tol;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
}

const cdp = await connect();
try {
  let s = await cdp.state();
  check('precondition: analysis screen with a result', s.screen === 'analysis' && s.studies.some((x) => x.id === s.openId && x.geometry), { screen: s.screen, openId: s.openId });
  await cdp.setState('{ zoom: 1, panX: 0, panY: 0, panMode: false, selectedLevel: null }');

  const canvas = await cdp.rect('.viewer-canvas-dynamic');
  check('canvas has layout', canvas && canvas.width > 50, canvas);

  // 1. Wheel zoom in and out over the stage.
  await cdp.wheel(canvas.cx, canvas.cy, -100);
  await cdp.settle();
  s = await cdp.state();
  check('wheel up zooms in to 1.25', near(s.zoom, 1.25, 1e-6), s.zoom);
  await cdp.wheel(canvas.cx, canvas.cy, 100);
  await cdp.settle();
  s = await cdp.state();
  check('wheel down zooms back to 1', near(s.zoom, 1, 1e-6), s.zoom);

  // 2. Coarse click-select: click the L3 body centroid.
  const l3 = await cdp.evaluate(`import('./renderer/store.js').then((m) => { const st = m.getState(); const g = st.studies.find((x) => x.id === st.openId).geometry; const q = g.vertebrae.L3.quadrilateral; return [q.reduce((a, p) => a + p[0], 0) / 4, q.reduce((a, p) => a + p[1], 0) / 4]; })`);
  const l3Client = await cdp.toClient(l3[0], l3[1]);
  await cdp.click(l3Client.x, l3Client.y);
  await cdp.settle();
  s = await cdp.state();
  check('clicking the L3 body selects L3', s.selectedLevel === 'L3', s.selectedLevel);

  // 3. Pan toggle on, primary-button drag pans by the pointer delta, no selection change.
  const panButton = await cdp.rect('.viewer-tool[aria-label="Pan"]');
  check('pan button present', Boolean(panButton), panButton);
  await cdp.click(panButton.cx, panButton.cy);
  await cdp.settle();
  s = await cdp.state();
  check('pan toggle turns panMode on', s.panMode === true, s.panMode);
  await cdp.drag(canvas.cx, canvas.cy, canvas.cx + 30, canvas.cy + 20);
  await cdp.settle();
  s = await cdp.state();
  check('pan drag moves panX/panY by the pointer delta', near(s.panX, 30) && near(s.panY, 20), [s.panX, s.panY]);
  check('a pan drag does not change the selection', s.selectedLevel === 'L3', s.selectedLevel);
  await cdp.click(panButton.cx, panButton.cy);
  await cdp.settle();
  s = await cdp.state();
  check('pan toggle turns panMode off', s.panMode === false, s.panMode);

  // 4. Fit to view resets zoom and pan.
  const fit = await cdp.rect('.viewer-tool[aria-label="Fit to view"]');
  await cdp.click(fit.cx, fit.cy);
  await cdp.settle();
  s = await cdp.state();
  check('Fit to view resets zoom and pan', s.zoom === 1 && s.panX === 0 && s.panY === 0, [s.zoom, s.panX, s.panY]);

  // 5. Middle-button drag pans with the toggle OFF (spec 12, new in Task 8).
  const before = await cdp.rect('.viewer-canvas-dynamic');
  await cdp.drag(before.cx, before.cy, before.cx - 15, before.cy + 10, { button: 'middle' });
  await cdp.settle();
  s = await cdp.state();
  check('middle-button drag pans with the toggle off', near(s.panX, -15) && near(s.panY, 10), [s.panX, s.panY]);
  check('a middle-button drag does not change the selection', s.selectedLevel === 'L3', s.selectedLevel);

  // 6. A primary click after the middle-drag still selects (suppressClick must not go stale).
  const l3Again = await cdp.toClient(l3[0], l3[1]);
  await cdp.setState('{ selectedLevel: null }');
  await cdp.click(l3Again.x, l3Again.y);
  await cdp.settle();
  s = await cdp.state();
  check('primary click after a middle-drag still selects', s.selectedLevel === 'L3', s.selectedLevel);

  await cdp.setState('{ zoom: 1, panX: 0, panY: 0, panMode: false }');
  check('no console errors or exceptions during the run', cdp.errors.length === 0, cdp.errors);
} finally {
  cdp.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${JSON.stringify(r.detail)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
