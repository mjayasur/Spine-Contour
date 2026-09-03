// Task 20 smoke: the construction label sits beyond the anterior corner off the body (checked at 2x
// zoom, where it fits beside a vertebra on the 157-px sample), can be dragged in and out of edit
// mode, keeps its offset across reselection, does not block clicks or handle presses, and loses
// its offset when the study changes. Opens its own fresh studies so no offset from an earlier run
// can leak in. Assumes the app is running on the Analysis screen (any study).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JPG = path.resolve(HERE, '../../../design-reference/design_src/13462cd9-a59f-4aab-9256-cbd723fb978c.jpg');
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

const cdp = await connect();
const pixel = (x, y) => cdp.evaluate(`(() => { const c = document.querySelector('.viewer-canvas-dynamic'); const d = c.getContext('2d').getImageData(Math.round(${x}), Math.round(${y}), 1, 1).data; return [d[0], d[1], d[2], d[3]]; })()`);
const isPlate = (px) => px[3] > 150 && px[0] < 30 && px[1] < 30 && px[2] < 30; // LABEL_PLATE_FILL rgba(11,10,9,.78)
const geometry = () => cdp.evaluate(`import('./renderer/store.js').then((m) => { const st = m.getState(); return st.studies.find((x) => x.id === st.openId).geometry; })`);
const pr = () => cdp.evaluate(`(() => { const c = document.querySelector('.viewer-canvas-dynamic'); return c.width / c.getBoundingClientRect().width; })()`);
const plateRun = (x0, x1, y) => cdp.evaluate(`(() => { const c = document.querySelector('.viewer-canvas-dynamic'); const ctx = c.getContext('2d'); let n = 0; for (let x = Math.max(0, Math.round(${x0})); x <= Math.min(c.width - 1, Math.round(${x1})); x += 1) { const d = ctx.getImageData(x, Math.round(${y}), 1, 1).data; if (d[3] > 150 && d[0] < 30 && d[1] < 30 && d[2] < 30) n += 1; } return n; })()`);

// Opens the sample film as a brand-new study (fresh id, so no label offsets carry over), runs
// segmentation, and waits for the result.
async function openFreshStudy() {
  const id = `SP-${5000 + (Date.now() % 4000)}`;
  const b64 = fs.readFileSync(JPG).toString('base64');
  await cdp.evaluate(`(async () => {
    const store = await import('./renderer/store.js');
    const analysis = await import('./renderer/screens/analysis.js');
    const bin = atob('${b64}'); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    analysis.setFilePayload('${id}', bytes);
    store.setState((s) => ({ studies: [...s.studies, { id: '${id}', source: 'real', filePath: 'smoke', fileName: 'smoke.jpg', addedAt: new Date().toISOString(), view: 'Standing lateral', thumbnail: null, measurements: null, geometry: null, qc: null, clinical: {} }], openId: '${id}', screen: 'studies', selectedLevel: null, zoom: 1, panX: 0, panY: 0, panMode: false, editing: false, selection: null }));
    store.setState({ screen: 'analysis' });
    return true;
  })()`);
  await cdp.settle(100);
  const done = await cdp.evaluate(`(async () => {
    const store = await import('./renderer/store.js');
    const button = document.querySelector('.run-button');
    if (!button) return 'no run button';
    const outcome = new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 120000);
      const un = store.subscribe((s) => { const st = s.studies.find((x) => x.id === s.openId); if (!s.running && st && st.measurements) { clearTimeout(timer); un(); resolve('done'); } });
    });
    button.click();
    return outcome;
  })()`);
  return { id, done };
}

// Where the label's default plate should be for level `level`, at the current zoom.
async function defaultAnchor(level) {
  const g = await geometry();
  const [sa, sp] = g.vertebrae[level].superior;
  const ratio = await pr();
  const dx = sa[0] - sp[0]; const dy = sa[1] - sp[1]; const len = Math.hypot(dx, dy) || 1;
  return { anchor: [sa[0] + (dx / len) * 8 * ratio, sa[1] + (dy / len) * 8 * ratio], side: dx >= 0 ? 1 : -1, mid: [(sa[0] + sp[0]) / 2, (sa[1] + sp[1]) / 2], ratio };
}
const plateSeen = async ({ anchor, side, ratio }) => (await plateRun(side > 0 ? anchor[0] : anchor[0] - 60 * ratio, side > 0 ? anchor[0] + 60 * ratio : anchor[0], anchor[1])) > 5;

try {
  const first = await openFreshStudy();
  check('a fresh study segments', first.done === 'done', first);
  await cdp.setState('{ editing: false, selection: null, selectedLevel: "L5", zoom: 2, panX: 0, panY: 0, panMode: false }');
  await cdp.settle(150);

  // 1. Placement at 2x: the plate sits beyond the anterior corner and the endplate midpoint is clear.
  let a = await defaultAnchor('L5');
  check('a label plate sits beyond the anterior corner', await plateSeen(a), a);
  check('the endplate midpoint is clear of the plate', !isPlate(await pixel(a.mid[0], a.mid[1] + 4 * a.ratio)), await pixel(a.mid[0], a.mid[1] + 4 * a.ratio));

  // 2. Drag the plate 40px right and 30px down (client px); hover shows the move cursor class.
  // Grab inside the plate padding (2 CSS px in from the anchored edge), clear of the glyphs.
  const grab = [a.side > 0 ? a.anchor[0] + 2 * a.ratio : a.anchor[0] - 2 * a.ratio, a.anchor[1]];
  const grabClient = await cdp.toClient(grab[0], grab[1]);
  await cdp.move(grabClient.x, grabClient.y);
  await cdp.settle(80);
  check('hovering the label sets is-over-label', await cdp.evaluate(`document.querySelector('.viewer-stage').classList.contains('is-over-label')`));
  const before = await geometry();
  // Drag toward the canvas centre so the plate cannot hit the edge clamp on a small film.
  const dxSign = a.side > 0 ? -1 : 1;
  await cdp.drag(grabClient.x, grabClient.y, grabClient.x + dxSign * 40, grabClient.y + 30, { steps: 6 });
  await cdp.settle(120);
  check('dragging the label does not touch the geometry', JSON.stringify(before) === JSON.stringify(await geometry()));
  let s = await cdp.state();
  check('dragging the label does not change the selection or construction', s.selectedLevel === 'L5' && s.selection === null, [s.selectedLevel, s.selection]);
  const moved = [grab[0] + dxSign * 40 * a.ratio, grab[1] + 30 * a.ratio];
  const plateAt = async (p) => (await plateRun(p[0] - 8 * a.ratio, p[0] + 8 * a.ratio, p[1])) >= 2;
  check('the plate moved with the drag', await plateAt(moved), await plateRun(moved[0] - 8 * a.ratio, moved[0] + 8 * a.ratio, moved[1]));
  check('the plate left its default position', !isPlate(await pixel(grab[0], grab[1])), await pixel(grab[0], grab[1]));

  // 3. The offset survives reselecting the construction.
  await cdp.setState('{ selectedLevel: "L4" }');
  await cdp.settle(100);
  await cdp.setState('{ selectedLevel: "L5" }');
  await cdp.settle(100);
  check('the offset survives reselecting the construction', await plateAt(moved), await plateRun(moved[0] - 8 * a.ratio, moved[0] + 8 * a.ratio, moved[1]));

  // 4. A plain click on the plate falls through: it clears the selected construction.
  const movedClient = await cdp.toClient(moved[0], moved[1]);
  await cdp.click(movedClient.x, movedClient.y);
  await cdp.settle(100);
  s = await cdp.state();
  // The click reaches the coarse select: it clears L5 or selects whatever vertebra lies under the plate.
  check('a click on the plate without moving falls through to the coarse select', s.selectedLevel !== 'L5', s.selectedLevel);
  await cdp.setState('{ selectedLevel: "L5" }');
  await cdp.settle(100);

  // 5. In edit mode a handle under the plate still wins the press. Put the plate over L5 SA by
  // dragging it there, then press on L5 SA and move: the handle drags, not the label.
  await cdp.setState('{ editing: true }');
  await cdp.settle(120);
  const g = await geometry();
  const sa = g.vertebrae.L5.superior[0];
  const plateNow = await cdp.toClient(moved[0], moved[1]);
  const saClient = await cdp.toClient(sa[0], sa[1]);
  await cdp.drag(plateNow.x, plateNow.y, saClient.x + 4, saClient.y, { steps: 6 });
  await cdp.settle(120);
  check('label dragged over L5 SA', (await plateRun(sa[0] - 10 * a.ratio, sa[0] + 30 * a.ratio, sa[1])) > 5, await plateRun(sa[0] - 10 * a.ratio, sa[0] + 30 * a.ratio, sa[1]));
  await cdp.drag(saClient.x, saClient.y, saClient.x - 10, saClient.y - 8, { steps: 6 });
  await cdp.settle(300);
  s = await cdp.state();
  const g2 = await geometry();
  check('pressing on the handle under the plate drags the handle', s.selection && s.selection.level === 'L5' && s.selection.corner === 'SA' && (g2.vertebrae.L5.superior[0][0] !== sa[0] || g2.vertebrae.L5.superior[0][1] !== sa[1]), [s.selection, sa, g2.vertebrae.L5.superior[0]]);
  await cdp.setState('{ editing: false, selection: null }');
  await cdp.settle(100);

  // 6. Pan mode still wins a primary drag over the label.
  const panButton = await cdp.rect('.viewer-tool[aria-label="Pan"]');
  await cdp.click(panButton.cx, panButton.cy);
  await cdp.settle(80);
  const afterPlate = await cdp.toClient(sa[0] + 4 * a.ratio, sa[1]);
  await cdp.drag(afterPlate.x, afterPlate.y, afterPlate.x + 20, afterPlate.y + 10);
  await cdp.settle(80);
  s = await cdp.state();
  check('with the pan toggle on, dragging the label pans instead', Math.abs(s.panX - 20) < 1 && Math.abs(s.panY - 10) < 1, [s.panX, s.panY]);
  await cdp.click(panButton.cx, panButton.cy);
  await cdp.setState('{ zoom: 2, panX: 0, panY: 0 }');
  await cdp.settle(100);

  // 7. Offsets clear when the study changes: a fresh study shows L5's plate at its default anchor.
  const second = await openFreshStudy();
  check('a second fresh study segments', second.done === 'done', second);
  await cdp.setState('{ editing: false, selection: null, selectedLevel: "L5", zoom: 2, panX: 0, panY: 0, panMode: false }');
  await cdp.settle(150);
  a = await defaultAnchor('L5');
  check('a new study starts with the label at its default anchor', await plateSeen(a), a);

  await cdp.setState('{ selectedLevel: null, zoom: 1 }');
  check('no console errors or exceptions during the run', cdp.errors.length === 0, cdp.errors);
} finally {
  cdp.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${JSON.stringify(r.detail)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
