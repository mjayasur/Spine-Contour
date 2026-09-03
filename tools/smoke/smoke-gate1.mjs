// Gate 1 smoke (after Task 11): edit toggle, edit bar, Escape/DONE, handles drawn only in
// edit mode at their corner colours, hover label, pan precedence, aria-pressed, no console
// errors. Pixel assertions read the dynamic canvas through getImageData. Assumes the app is
// running with a segmented study open on Analysis. Run smoke-parity.mjs first.
import { connect } from './cdp-lib.mjs';

const CORNER = { SA: [50, 212, 255], SP: [100, 225, 154], IA: [255, 178, 89], IP: [250, 120, 212] };
const FEMORAL = [98, 210, 111];
// GATE1_STAGE=9 runs only the Task 9 checks; 10 adds handle pixels; 11 (default) adds hover.
const STAGE = Number(process.env.GATE1_STAGE || 11);
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });
const closeTo = (px, rgb, tol = 40) => px && px[3] > 200 && Math.abs(px[0] - rgb[0]) <= tol && Math.abs(px[1] - rgb[1]) <= tol && Math.abs(px[2] - rgb[2]) <= tol;

const cdp = await connect();
try {
  // Image-space landmark points from the live store.
  const pts = await cdp.evaluate(`import('./renderer/store.js').then((m) => { const st = m.getState(); const g = st.studies.find((x) => x.id === st.openId).geometry; return { L1SA: g.vertebrae.L1.superior[0], L1IP: g.vertebrae.L1.inferior[1], L3SA: g.vertebrae.L3.superior[0], S1SP: g.s1_superior[1], LEFT: [g.femoral_circles[0][0], g.femoral_circles[0][1]], RIM: [g.femoral_circles[1][0] + g.femoral_circles[1][2], g.femoral_circles[1][1]] }; })`);
  // RGBA at an image-space point on the dynamic canvas, plus image px per CSS px.
  const pixel = (p, dx = 0, dy = 0) => cdp.evaluate(`(() => { const c = document.querySelector('.viewer-canvas-dynamic'); const pr = c.width / c.getBoundingClientRect().width; const d = c.getContext('2d').getImageData(Math.round(${p[0]} + ${dx} * pr), Math.round(${p[1]} + ${dy} * pr), 1, 1).data; return [d[0], d[1], d[2], d[3]]; })()`);

  let s = await cdp.state();
  check('precondition: analysis screen with a result', s.screen === 'analysis' && s.studies.some((x) => x.id === s.openId && x.geometry), s.openId);
  await cdp.setState('{ editing: false, selection: null, zoom: 1, panX: 0, panY: 0, panMode: false, selectedLevel: null }');
  await cdp.settle();

  const edit = await cdp.rect('.viewer-tool[aria-label="Edit landmarks"]');
  check('edit toggle present', Boolean(edit), edit);
  const editAttrs = await cdp.evaluate(`(() => { const b = document.querySelector('.viewer-tool[aria-label="Edit landmarks"]'); return { disabled: b.disabled, pressed: b.getAttribute('aria-pressed') }; })()`);
  check('edit toggle enabled with aria-pressed=false', editAttrs.disabled === false && editAttrs.pressed === 'false', editAttrs);
  const panPressed = await cdp.evaluate(`document.querySelector('.viewer-tool[aria-label="Pan"]').getAttribute('aria-pressed')`);
  check('pan toggle carries aria-pressed', panPressed === 'false', panPressed);
  if (STAGE >= 10) check('no handle at L1 SA outside edit mode', !closeTo(await pixel(pts.L1SA), CORNER.SA), await pixel(pts.L1SA));
  check('edit bar hidden outside edit mode', (await cdp.rect('.viewer-editbar')) === null || (await cdp.rect('.viewer-editbar')).width === 0, await cdp.rect('.viewer-editbar'));

  // Enter edit mode by clicking the pencil.
  await cdp.click(edit.cx, edit.cy);
  await cdp.settle(120);
  s = await cdp.state();
  check('pencil click enters edit mode', s.editing === true, s.editing);
  const editing = await cdp.evaluate(`(() => { const b = document.querySelector('.viewer-tool[aria-label="Done editing"]'); const bar = document.querySelector('.viewer-editbar'); return { pressed: b && b.getAttribute('aria-pressed'), active: b && b.classList.contains('is-active'), barVisible: bar && !bar.classList.contains('is-hidden') && bar.getBoundingClientRect().height > 0, stageEditing: document.querySelector('.viewer-stage').classList.contains('is-editing'), done: Boolean(document.querySelector('.viewer-editbar button')), barText: bar && bar.textContent }; })()`);
  check('toggle relabels to Done editing with aria-pressed=true and is-active', editing.pressed === 'true' && editing.active === true, editing);
  check('edit bar visible with EDITING LANDMARKS and DONE', editing.barVisible && /EDITING LANDMARKS/.test(editing.barText) && /DONE/.test(editing.barText), editing.barText);
  check('stage carries is-editing', editing.stageEditing === true, editing.stageEditing);
  if (STAGE >= 10) {
    // Probe at 2.4x zoom: the sample film displays at 1:1, where a 5px handle radius equals
    // 5 image px and adjacent corners (L1 IP / L2 SP are 5.1 px apart) overlap. Zooming in
    // shrinks the image-space radius and also exercises the constant-on-screen-size rule.
    await cdp.setState('{ zoom: 2.4 }');
    await cdp.settle(120);
    check('L1 SA handle is cyan', closeTo(await pixel(pts.L1SA), CORNER.SA), await pixel(pts.L1SA));
    check('L1 IP handle is pink', closeTo(await pixel(pts.L1IP), CORNER.IP), await pixel(pts.L1IP));
    check('S1 SP handle is green', closeTo(await pixel(pts.S1SP), CORNER.SP), await pixel(pts.S1SP));
    check('left femoral centre handle is femoral green', closeTo(await pixel(pts.LEFT), FEMORAL), await pixel(pts.LEFT));
    check('right femoral rim handle at 3 o\'clock is femoral green', closeTo(await pixel(pts.RIM), FEMORAL), await pixel(pts.RIM));
  }

  // Hover L3 SA: handle stays its colour, a label plate appears above-right, cursor class set.
  const l3 = await cdp.toClient(pts.L3SA[0], pts.L3SA[1]);
  if (STAGE >= 11) {
  // The label plate (and its text) appears above-right of the hovered handle: that pixel is
  // empty before the hover and painted after it.
  const plateBefore = await pixel(pts.L3SA, 8 + 10 + 2, -(8 + 4 + 11 / 2));
  await cdp.move(l3.x, l3.y);
  await cdp.settle(120);
  const overHandle = await cdp.evaluate(`document.querySelector('.viewer-stage').classList.contains('is-over-handle')`);
  check('hovering a handle sets is-over-handle', overHandle === true, overHandle);
  const plate = await pixel(pts.L3SA, 8 + 10 + 2, -(8 + 4 + 11 / 2));
  check('hover paints a label plate above-right of the handle', plateBefore[3] < 60 && plate[3] > 120, [plateBefore, plate]);
  await cdp.move(l3.x + 60, l3.y + 60);
  await cdp.settle(120);
  const away = await cdp.evaluate(`document.querySelector('.viewer-stage').classList.contains('is-over-handle')`);
  check('moving away clears is-over-handle', away === false, away);
  }

  // Pan precedence while editing: primary drag on a handle pans, geometry untouched.
  const gBefore = await cdp.evaluate(`import('./renderer/store.js').then((m) => { const st = m.getState(); return JSON.stringify(st.studies.find((x) => x.id === st.openId).geometry); })`);
  const pan = await cdp.rect('.viewer-tool[aria-label="Pan"]');
  await cdp.click(pan.cx, pan.cy);
  await cdp.settle();
  const l3b = await cdp.toClient(pts.L3SA[0], pts.L3SA[1]);
  await cdp.drag(l3b.x, l3b.y, l3b.x + 25, l3b.y + 15);
  await cdp.settle();
  s = await cdp.state();
  const gAfter = await cdp.evaluate(`import('./renderer/store.js').then((m) => { const st = m.getState(); return JSON.stringify(st.studies.find((x) => x.id === st.openId).geometry); })`);
  check('with the pan toggle on, dragging over a handle pans', Math.abs(s.panX - 25) < 1 && Math.abs(s.panY - 15) < 1, [s.panX, s.panY]);
  check('and the geometry is untouched', gBefore === gAfter);
  await cdp.click(pan.cx, pan.cy);
  await cdp.setState('{ zoom: 1, panX: 0, panY: 0 }');
  await cdp.settle();

  // Escape exits; handles disappear.
  await cdp.key('Escape');
  await cdp.settle(120);
  s = await cdp.state();
  check('Escape exits edit mode', s.editing === false && s.selection === null, [s.editing, s.selection]);
  if (STAGE >= 10) check('handles gone after Escape', !closeTo(await pixel(pts.L1SA), CORNER.SA), await pixel(pts.L1SA));

  // DONE exits.
  await cdp.click(edit.cx, edit.cy);
  await cdp.settle(120);
  const done = await cdp.rect('.viewer-editbar button:last-child');
  await cdp.click(done.cx, done.cy);
  await cdp.settle(120);
  s = await cdp.state();
  check('DONE exits edit mode', s.editing === false, s.editing);

  // Pencil again toggles off.
  await cdp.click(edit.cx, edit.cy);
  await cdp.settle(120);
  await cdp.click(edit.cx, edit.cy);
  await cdp.settle(120);
  s = await cdp.state();
  check('pencil toggles edit mode off again', s.editing === false, s.editing);

  // Task 11-b: a selected construction can be cleared four ways.
  if (STAGE >= 12) {
    await cdp.setState('{ editing: false, selection: null, selectedLevel: null, zoom: 1, panX: 0, panY: 0 }');
    await cdp.settle(80);
    const llRow = await cdp.rect('.meas-row[data-row-key="LL"]');
    await cdp.click(llRow.cx, llRow.cy);
    await cdp.settle(80);
    s = await cdp.state();
    check('clicking the LL row selects L1', s.selectedLevel === 'L1', s.selectedLevel);
    await cdp.click(llRow.cx, llRow.cy);
    await cdp.settle(80);
    s = await cdp.state();
    check('clicking the selected row again clears the construction', s.selectedLevel === null, s.selectedLevel);
    const l3c = await cdp.evaluate("import('./renderer/store.js').then((m) => { const st = m.getState(); const q = st.studies.find((x) => x.id === st.openId).geometry.vertebrae.L3.quadrilateral; return [q.reduce((a, p) => a + p[0], 0) / 4, q.reduce((a, p) => a + p[1], 0) / 4]; })");
    const l3Client = await cdp.toClient(l3c[0], l3c[1]);
    await cdp.click(l3Client.x, l3Client.y);
    await cdp.settle(80);
    s = await cdp.state();
    check('clicking L3 on the film selects it', s.selectedLevel === 'L3', s.selectedLevel);
    await cdp.click(l3Client.x, l3Client.y);
    await cdp.settle(80);
    s = await cdp.state();
    check('clicking the selected vertebra again clears it', s.selectedLevel === null, s.selectedLevel);
    await cdp.click(l3Client.x, l3Client.y);
    await cdp.settle(80);
    const canvasRect = await cdp.rect('.viewer-canvas-dynamic');
    await cdp.click(canvasRect.left + 4, canvasRect.top + 4);
    await cdp.settle(80);
    s = await cdp.state();
    check('clicking empty stage clears the construction', s.selectedLevel === null, s.selectedLevel);
    await cdp.click(l3Client.x, l3Client.y);
    await cdp.settle(80);
    await cdp.key('Escape');
    await cdp.settle(80);
    s = await cdp.state();
    check('Escape outside edit mode clears the construction', s.selectedLevel === null && s.editing === false, [s.selectedLevel, s.editing]);
    await cdp.click(l3Client.x, l3Client.y);
    await cdp.setState('{ editing: true }');
    await cdp.settle(80);
    await cdp.key('Escape');
    await cdp.settle(80);
    s = await cdp.state();
    check('Escape inside edit mode still exits editing and leaves the construction', s.editing === false && s.selectedLevel === 'L3', [s.editing, s.selectedLevel]);
    await cdp.setState('{ selectedLevel: null }');
  }

  check('no console errors or exceptions during the run', cdp.errors.length === 0, cdp.errors);
} finally {
  cdp.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${JSON.stringify(r.detail)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
