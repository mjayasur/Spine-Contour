// Task 21 smoke: the construction label is a DOM chip (.viewer-label) inside the pan/zoom host.
// It appears beyond the anterior corner, scales with the film, drags anywhere in the stage
// (including the black space outside the film), keeps its offset across reselection and
// through pan/zoom, is inert and faded while editing, and resets on a new study. Opens its own
// fresh studies. Assumes the app is running on the Analysis screen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JPG = path.resolve(HERE, '../../../design-reference/design_src/13462cd9-a59f-4aab-9256-cbd723fb978c.jpg');
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const cdp = await connect();
const geometry = () => cdp.evaluate(`import('./renderer/store.js').then((m) => { const st = m.getState(); return st.studies.find((x) => x.id === st.openId).geometry; })`);
const chip = () => cdp.evaluate(`(() => { const e = document.querySelector('.viewer-label'); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { hidden: e.classList.contains('is-hidden') || cs.display === 'none', text: e.textContent, left: r.left, top: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, fontSize: parseFloat(cs.fontSize), opacity: parseFloat(cs.opacity), pointerEvents: cs.pointerEvents }; })()`);
const canvasRect = () => cdp.rect('.viewer-canvas-dynamic');
const stageRect = () => cdp.rect('.viewer-stage');

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

try {
  const first = await openFreshStudy();
  check('a fresh study segments', first.done === 'done', first);
  await cdp.setState('{ editing: false, selection: null, selectedLevel: null, zoom: 1, panX: 0, panY: 0, panMode: false }');
  await cdp.settle(120);
  check('no chip without a construction', (await chip()) === null || (await chip()).hidden, await chip());

  // 1. Select L4: the chip appears with the right text, beyond the anterior corner, off the body.
  await cdp.setState('{ selectedLevel: "L4" }');
  await cdp.settle(150);
  let c = await chip();
  const g = await geometry();
  const [sa, sp] = g.vertebrae.L4.superior;
  const saClient = await cdp.toClient(sa[0], sa[1]);
  const spClient = await cdp.toClient(sp[0], sp[1]);
  const anterior = saClient.x >= spClient.x ? 1 : -1;
  check('chip visible with the LL L4-S1 text', c && !c.hidden && /^LL L4-S1 \d+\.\d°$/.test(c.text), c && c.text);
  check('chip sits beyond the anterior corner, away from the body', c && (anterior > 0 ? c.left >= saClient.x - 1 : c.left + c.width <= saClient.x + 1), c && [c.left, c.width, saClient.x, anterior]);
  check('chip is vertically centred on the endplate corner', c && near(c.cy, saClient.y, c.height), c && [c.cy, saClient.y]);

  // 2. Scales with the film: at 2x zoom the chip is twice as tall.
  const h1 = c.height;
  await cdp.setState('{ zoom: 2 }');
  await cdp.settle(150);
  c = await chip();
  check('chip height doubles at 2x zoom (scales with the film)', near(c.height, 2 * h1, 1.5), [h1, c.height]);
  await cdp.setState('{ zoom: 1 }');
  await cdp.settle(150);

  // 3. Drag the chip 60px right, 40px down; it moves by the same client delta.
  c = await chip();
  const before = await geometry();
  await cdp.drag(c.cx, c.cy, c.cx + 60, c.cy + 40, { steps: 6 });
  await cdp.settle(120);
  let c2 = await chip();
  check('dragging the chip moves it by the pointer delta', near(c2.cx, c.cx + 60, 1.5) && near(c2.cy, c.cy + 40, 1.5), [c.cx, c.cy, c2.cx, c2.cy]);
  check('dragging the chip does not touch the geometry', JSON.stringify(before) === JSON.stringify(await geometry()));
  let s = await cdp.state();
  check('dragging the chip does not change the selection or construction', s.selectedLevel === 'L4' && s.selection === null, [s.selectedLevel, s.selection]);

  // 4. Into the black space: drag the chip fully outside the film but inside the stage.
  const cr = await canvasRect();
  const sr = await stageRect();
  const targetX = Math.min(sr.left + sr.width - 40, cr.left + cr.width + 60);
  await cdp.drag(c2.cx, c2.cy, targetX, c2.cy, { steps: 8 });
  await cdp.settle(120);
  c2 = await chip();
  check('the chip can sit in the black space outside the film', c2.left >= cr.left + cr.width - 1 && c2.left + c2.width <= sr.left + sr.width + 1, [c2.left, c2.width, cr.left + cr.width, sr.left + sr.width]);

  // 5. The offset survives reselection and follows pan and zoom.
  await cdp.setState('{ selectedLevel: "L3" }');
  await cdp.settle(100);
  await cdp.setState('{ selectedLevel: "L4" }');
  await cdp.settle(100);
  const c3 = await chip();
  check('the offset survives reselecting the construction', near(c3.cx, c2.cx, 1.5) && near(c3.cy, c2.cy, 1.5), [c2.cx, c2.cy, c3.cx, c3.cy]);
  await cdp.setState('{ panX: 25, panY: -15 }');
  await cdp.settle(100);
  const c4 = await chip();
  check('the chip pans with the film', near(c4.cx, c3.cx + 25, 1.5) && near(c4.cy, c3.cy - 15, 1.5), [c3.cx, c3.cy, c4.cx, c4.cy]);
  await cdp.setState('{ panX: 0, panY: 0 }');
  await cdp.settle(100);

  // 6. Inert and faded while editing; a handle under it can be grabbed.
  await cdp.setState('{ editing: true }');
  await cdp.settle(150);
  const ce = await chip();
  check('while editing the chip is pointer-transparent and faded', ce.pointerEvents === 'none' && ce.opacity < 0.9, [ce.pointerEvents, ce.opacity]);
  // Move the chip's DEFAULT position over L4 SA is not possible while inert; instead press on SA
  // itself and confirm the press reaches the handle regardless of the chip.
  const saNow = await cdp.toClient(sa[0], sa[1]);
  await cdp.drag(saNow.x, saNow.y, saNow.x - 8, saNow.y - 6, { steps: 6 });
  await cdp.settle(300);
  s = await cdp.state();
  const g2 = await geometry();
  check('a handle press while editing drags the handle', s.selection && s.selection.level === 'L4' && s.selection.corner === 'SA' && (g2.vertebrae.L4.superior[0][0] !== sa[0] || g2.vertebrae.L4.superior[0][1] !== sa[1]), [s.selection, sa, g2.vertebrae.L4.superior[0]]);
  await cdp.setState('{ editing: false, selection: null }');
  await cdp.settle(120);
  const cx = await chip();
  check('leaving edit mode makes the chip interactive again', cx.pointerEvents !== 'none' && cx.opacity >= 0.9, [cx.pointerEvents, cx.opacity]);

  // 7. Pan mode: a press on the chip does not drag it.
  const panButton = await cdp.rect('.viewer-tool[aria-label="Pan"]');
  await cdp.click(panButton.cx, panButton.cy);
  await cdp.settle(80);
  const cp = await chip();
  await cdp.drag(cp.cx, cp.cy, cp.cx + 20, cp.cy + 10);
  await cdp.settle(80);
  const cp2 = await chip();
  check('in pan mode a press on the chip does not move the chip relative to the film', near(cp2.cx - cp.cx, (await cdp.state()).panX, 1.5), [cp.cx, cp2.cx, (await cdp.state()).panX]);
  await cdp.click(panButton.cx, panButton.cy);
  await cdp.setState('{ zoom: 1, panX: 0, panY: 0 }');
  await cdp.settle(80);

  // 8. Wheel over the chip still zooms.
  const cw = await chip();
  await cdp.wheel(cw.cx, cw.cy, -100);
  await cdp.settle(100);
  s = await cdp.state();
  check('wheel over the chip zooms the stage', near(s.zoom, 1.25, 1e-6), s.zoom);
  await cdp.setState('{ zoom: 1 }');

  // 9. A new study starts with the label at its default position.
  const second = await openFreshStudy();
  check('a second fresh study segments', second.done === 'done', second);
  await cdp.setState('{ editing: false, selection: null, selectedLevel: "L4", zoom: 1, panX: 0, panY: 0, panMode: false }');
  await cdp.settle(150);
  const cn = await chip();
  const gn = await geometry();
  const saN = await cdp.toClient(gn.vertebrae.L4.superior[0][0], gn.vertebrae.L4.superior[0][1]);
  check('a new study starts with the chip back at its default anchor', cn && near(cn.cy, saN.y, cn.height) && (anterior > 0 ? near(cn.left, saN.x, cn.height * 2) : near(cn.left + cn.width, saN.x, cn.height * 2)), cn && [cn.left, cn.cy, saN]);

  await cdp.setState('{ selectedLevel: null }');
  check('no console errors or exceptions during the run', cdp.errors.length === 0, cdp.errors);
} finally {
  cdp.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${JSON.stringify(r.detail)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
