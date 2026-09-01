import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_RGB, FEMORAL_OVERLAY_COLOR, BASE_OVERLAY_ALPHA, buildLabelColorMap, buildOverlayPixels } from '../renderer/viewer/canvas.js';

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
