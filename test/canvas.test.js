import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_RGB, FEMORAL_OVERLAY_COLOR, BASE_OVERLAY_ALPHA, buildLabelColorMap, buildOverlayPixels, drawDynamicLayer } from '../renderer/viewer/canvas.js';

test('buildLabelColorMap maps L1..L5 backend label ids to the fixed RGB ramp', () => {
  const labels = { BACKGROUND: 0, L1: 20, L2: 21, L3: 22, L4: 23, L5: 24, S1: 25 };
  const map = buildLabelColorMap(labels);
  assert.deepEqual(map[20], LEVEL_RGB.L1);
  assert.deepEqual(map[21], LEVEL_RGB.L2);
  assert.deepEqual(map[24], LEVEL_RGB.L5);
  assert.equal(map[25], undefined);
  assert.equal(map[0], undefined);
});

test('buildOverlayPixels colours a labelled mask pixel and leaves background transparent', () => {
  // Two RGBA pixels: pixel 0 has mask value 20 (L1), pixel 1 has mask value 0 (background).
  const maskPixels = new Uint8ClampedArray([20, 20, 20, 255, 0, 0, 0, 255]);
  const femoralPixels = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0]);
  const colorByLabel = { 20: [255, 99, 132] };
  const overlay = buildOverlayPixels(maskPixels, femoralPixels, colorByLabel, BASE_OVERLAY_ALPHA);
  assert.deepEqual([...overlay.slice(0, 4)], [255, 99, 132, BASE_OVERLAY_ALPHA]);
  assert.deepEqual([...overlay.slice(4, 8)], [0, 0, 0, 0]);
});

test('buildOverlayPixels falls back to the femoral colour when the femoral mask is set and the label mask is not', () => {
  const maskPixels = new Uint8ClampedArray([0, 0, 0, 255]);
  const femoralPixels = new Uint8ClampedArray([1, 0, 0, 255]);
  const overlay = buildOverlayPixels(maskPixels, femoralPixels, {}, BASE_OVERLAY_ALPHA);
  assert.deepEqual([...overlay], [...FEMORAL_OVERLAY_COLOR, BASE_OVERLAY_ALPHA]);
});

function fakeGeometry() {
  return {
    vertebrae: {
      L1: { superior: [[10, 10], [20, 10]], inferior: [[10, 20], [20, 20]], quadrilateral: [[10, 10], [20, 10], [20, 20], [10, 20]] },
      L2: { superior: [[10, 30], [20, 30]], inferior: [[10, 40], [20, 40]], quadrilateral: [[10, 30], [20, 30], [20, 40], [10, 40]] },
      L3: { superior: [[10, 50], [20, 50]], inferior: [[10, 60], [20, 60]], quadrilateral: [[10, 50], [20, 50], [20, 60], [10, 60]] },
      L4: { superior: [[10, 70], [20, 70]], inferior: [[10, 80], [20, 80]], quadrilateral: [[10, 70], [20, 70], [20, 80], [10, 80]] },
      L5: { superior: [[10, 90], [20, 90]], inferior: [[10, 100], [20, 100]], quadrilateral: [[10, 90], [20, 90], [20, 100], [10, 100]] },
    },
    s1_superior: [[10, 110], [20, 110]],
    l1_center: [15, 15],
    hip_midpoint: [15, 130],
    femoral_circles: [[10, 140, 5], [20, 140, 5]],
  };
}

// A 2D context stand-in that records every method call. Canvas code is otherwise
// untestable here; this pins the one structural fact the design depends on -- how many
// handles exist, and when.
function recordingContext() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop in target) return target[prop];
      return (...args) => { calls.push([prop, args]); };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  return { ctx, calls };
}

function arcCount(calls) {
  return calls.filter(([name]) => name === 'arc').length;
}

test('drawDynamicLayer draws no handles outside edit mode', () => {
  const { ctx, calls } = recordingContext();
  drawDynamicLayer(ctx, { width: 200, height: 150 }, fakeGeometry(), { selectedLevel: null, measurements: null, editing: false });
  assert.equal(arcCount(calls), 2, 'only the two femoral circles');
});

test('drawDynamicLayer draws 22 landmark and 4 femoral handles in edit mode', () => {
  const { ctx, calls } = recordingContext();
  drawDynamicLayer(ctx, { width: 200, height: 150 }, fakeGeometry(), {
    selectedLevel: null, measurements: null, editing: true, selection: null, hover: null, pixelRatio: 1,
  });
  assert.equal(arcCount(calls), 2 + 22 + 4);
});

test('a selected handle gets a ring and a label, a hovered handle gets a label', () => {
  const { ctx, calls } = recordingContext();
  drawDynamicLayer(ctx, { width: 200, height: 150 }, fakeGeometry(), {
    selectedLevel: null, measurements: null, editing: true, pixelRatio: 1,
    selection: { kind: 'landmark', level: 'L2', corner: 'SA' },
    hover: { kind: 'femoral', side: 'right', part: 'rim' },
  });
  assert.equal(arcCount(calls), 2 + 22 + 4 + 1, 'one extra arc for the selection ring');
  const labels = calls.filter(([name]) => name === 'fillText').map(([, args]) => args[0]);
  assert.deepEqual(labels, ['L2 SA', 'Right head \u00B7 resize']);
});

test('retrace draws one numbered dot per trace point after the handles', () => {
  const { ctx, calls } = recordingContext();
  drawDynamicLayer(ctx, { width: 200, height: 150 }, fakeGeometry(), {
    selectedLevel: null, measurements: null, editing: true, selection: null, hover: null, pixelRatio: 1,
    retracing: true, tracePoints: [[30, 30], [40, 30], [35, 38]],
  });
  assert.equal(arcCount(calls), 2 + 22 + 4 + 3);
  const labels = calls.filter(([name]) => name === 'fillText').map(([, args]) => args[0]);
  assert.deepEqual(labels, ['1', '2', '3']);
});

function fullMeasurements() {
  return { SS: 40, PI: 50, PT: 10, L1PA: 5, LL: { 'L1-S1': 50, 'L2-S1': 45, 'L3-S1': 40, 'L4-S1': 35, 'L5-S1': 25 } };
}

function plateOf(calls) {
  const rects = calls.filter(([name]) => name === 'fillRect').map(([, args]) => args);
  return rects[rects.length - 1];
}

test('the construction label is sized on screen and sits beyond the anterior corner, extending away from the body', () => {
  // fakeGeometry's L3 endplate runs from SA [10,50] to SP [20,50]: anterior is leftward, so the plate
  // anchors 8px left of SA and extends further left, then clamps to the canvas edge.
  const one = recordingContext();
  const result = drawDynamicLayer(one.ctx, { width: 200, height: 150 }, fakeGeometry(), { selectedLevel: 'L3', measurements: fullMeasurements(), pixelRatio: 1 });
  assert.deepEqual(plateOf(one.calls), [0, 40.5, 18, 19]);
  assert.deepEqual(result.labelRect, { x: 0, y: 40.5, width: 18, height: 19 });
  const two = recordingContext();
  drawDynamicLayer(two.ctx, { width: 200, height: 150 }, fakeGeometry(), { selectedLevel: 'L3', measurements: fullMeasurements(), pixelRatio: 2 });
  assert.deepEqual(plateOf(two.calls), [0, 31, 26, 38], 'double the pixel ratio, double the plate');
});

test('a label offset moves the plate and is reported back', () => {
  const { ctx, calls } = recordingContext();
  const result = drawDynamicLayer(ctx, { width: 200, height: 150 }, fakeGeometry(), { selectedLevel: 'L3', measurements: fullMeasurements(), pixelRatio: 1, labelOffset: { dx: 100, dy: 20 } });
  assert.deepEqual(plateOf(calls), [84, 60.5, 18, 19]);
  assert.deepEqual(result.labelRect, { x: 84, y: 60.5, width: 18, height: 19 });
});

test('no construction, no label rect', () => {
  const { ctx } = recordingContext();
  const result = drawDynamicLayer(ctx, { width: 200, height: 150 }, fakeGeometry(), { selectedLevel: null, measurements: fullMeasurements(), pixelRatio: 1 });
  assert.equal(result.labelRect, null);
});
