import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZOOM_MIN, ZOOM_MAX, clampZoom, zoomIn, zoomOut, vertebraAt, TAB_ORDER, FULL_ORDER, sameHandle, nextSelection } from '../renderer/viewer/interactions.js';

test('clampZoom clamps to the 0.6..2.4 range and passes through in between', () => {
  assert.equal(clampZoom(0.1), ZOOM_MIN);
  assert.equal(clampZoom(9), ZOOM_MAX);
  assert.equal(clampZoom(1.2), 1.2);
});

test('zoomIn and zoomOut step by 1.25x and clamp at the bounds', () => {
  assert.ok(Math.abs(zoomIn(1) - 1.25) < 1e-9);
  assert.ok(Math.abs(zoomOut(1) - 0.8) < 1e-9);
  assert.equal(zoomIn(2.4), ZOOM_MAX);
  assert.equal(zoomOut(0.6), ZOOM_MIN);
});

function fakeGeometry() {
  return {
    vertebrae: {
      L1: { quadrilateral: [[0, 0], [10, 0], [10, 10], [0, 10]] },
      L2: { quadrilateral: [[0, 20], [10, 20], [10, 30], [0, 30]] },
      L3: { quadrilateral: [[0, 40], [10, 40], [10, 50], [0, 50]] },
      L4: { quadrilateral: [[0, 60], [10, 60], [10, 70], [0, 70]] },
      L5: { quadrilateral: [[0, 80], [10, 80], [10, 90], [0, 90]] },
    },
    s1_superior: [[0, 100], [10, 100]],
  };
}

test('vertebraAt returns the level whose quadrilateral contains the point', () => {
  const geometry = fakeGeometry();
  assert.equal(vertebraAt(geometry, [5, 25]), 'L2');
  assert.equal(vertebraAt(geometry, [5, 65]), 'L4');
});

test('vertebraAt returns S1 near the S1 superior segment and null elsewhere', () => {
  const geometry = fakeGeometry();
  assert.equal(vertebraAt(geometry, [5, 102], 20), 'S1');
  assert.equal(vertebraAt(geometry, [5000, 5000]), null);
});

test('TAB_ORDER has 22 entries in anatomical order', () => {
  assert.equal(TAB_ORDER.length, 22);
  assert.deepEqual(TAB_ORDER[0], { kind: 'landmark', level: 'L1', corner: 'SA' });
  assert.deepEqual(TAB_ORDER[1], { kind: 'landmark', level: 'L1', corner: 'SP' });
  assert.deepEqual(TAB_ORDER[2], { kind: 'landmark', level: 'L1', corner: 'IA' });
  assert.deepEqual(TAB_ORDER[3], { kind: 'landmark', level: 'L1', corner: 'IP' });
  assert.deepEqual(TAB_ORDER[4], { kind: 'landmark', level: 'L2', corner: 'SA' });
  assert.deepEqual(TAB_ORDER[19], { kind: 'landmark', level: 'L5', corner: 'IP' });
  assert.deepEqual(TAB_ORDER[20], { kind: 'landmark', level: 'S1', corner: 'SA' });
  assert.deepEqual(TAB_ORDER[21], { kind: 'landmark', level: 'S1', corner: 'SP' });
});

test('TAB_ORDER never contains an S1 IA or IP corner', () => {
  const s1Entries = TAB_ORDER.filter((entry) => entry.level === 'S1');
  assert.equal(s1Entries.length, 2);
  assert.ok(s1Entries.every((entry) => entry.corner === 'SA' || entry.corner === 'SP'));
});

test('FULL_ORDER is TAB_ORDER followed by the left and right femoral-head centres', () => {
  assert.equal(FULL_ORDER.length, 24);
  assert.deepEqual(FULL_ORDER.slice(0, 22), TAB_ORDER);
  assert.deepEqual(FULL_ORDER[22], { kind: 'femoral', side: 'left', part: 'center' });
  assert.deepEqual(FULL_ORDER[23], { kind: 'femoral', side: 'right', part: 'center' });
});

test('FULL_ORDER contains no rim stops', () => {
  assert.ok(FULL_ORDER.every((entry) => entry.kind !== 'femoral' || entry.part === 'center'));
});

test('sameHandle is exact identity, including the femoral part', () => {
  assert.ok(sameHandle({ kind: 'landmark', level: 'L3', corner: 'IA' }, { kind: 'landmark', level: 'L3', corner: 'IA' }));
  assert.ok(!sameHandle({ kind: 'landmark', level: 'L3', corner: 'IA' }, { kind: 'landmark', level: 'L3', corner: 'IP' }));
  assert.ok(sameHandle({ kind: 'femoral', side: 'left', part: 'rim' }, { kind: 'femoral', side: 'left', part: 'rim' }));
  assert.ok(!sameHandle({ kind: 'femoral', side: 'left', part: 'rim' }, { kind: 'femoral', side: 'left', part: 'center' }));
});

test('sameHandle is false when either side is null or the kinds differ', () => {
  assert.ok(!sameHandle(null, { kind: 'landmark', level: 'L1', corner: 'SA' }));
  assert.ok(!sameHandle({ kind: 'landmark', level: 'L1', corner: 'SA' }, null));
  assert.ok(!sameHandle(null, null));
  assert.ok(!sameHandle({ kind: 'landmark', level: 'L1', corner: 'SA' }, { kind: 'femoral', side: 'left', part: 'center' }));
});

test('nextSelection steps forward through landmarks in anatomical order', () => {
  const l1sa = { kind: 'landmark', level: 'L1', corner: 'SA' };
  assert.deepEqual(nextSelection(l1sa, 1), { kind: 'landmark', level: 'L1', corner: 'SP' });
});

test('nextSelection steps backward through landmarks', () => {
  const l1sp = { kind: 'landmark', level: 'L1', corner: 'SP' };
  assert.deepEqual(nextSelection(l1sp, -1), { kind: 'landmark', level: 'L1', corner: 'SA' });
});

test('nextSelection reaches the femoral heads after S1 SP', () => {
  const s1sp = { kind: 'landmark', level: 'S1', corner: 'SP' };
  const leftHead = nextSelection(s1sp, 1);
  assert.deepEqual(leftHead, { kind: 'femoral', side: 'left', part: 'center' });
  assert.deepEqual(nextSelection(leftHead, 1), { kind: 'femoral', side: 'right', part: 'center' });
});

test('nextSelection wraps from the right head back to L1 SA', () => {
  const rightHead = { kind: 'femoral', side: 'right', part: 'center' };
  assert.deepEqual(nextSelection(rightHead, 1), { kind: 'landmark', level: 'L1', corner: 'SA' });
});

test('nextSelection wraps backward from L1 SA to the right head', () => {
  const l1sa = { kind: 'landmark', level: 'L1', corner: 'SA' };
  assert.deepEqual(nextSelection(l1sa, -1), { kind: 'femoral', side: 'right', part: 'center' });
});

test('nextSelection with null current returns the first stop forward and the last stop backward', () => {
  assert.deepEqual(nextSelection(null, 1), { kind: 'landmark', level: 'L1', corner: 'SA' });
  assert.deepEqual(nextSelection(null, -1), { kind: 'femoral', side: 'right', part: 'center' });
});

test('nextSelection treats a selection that is not a stop like null', () => {
  assert.deepEqual(nextSelection({ kind: 'landmark', level: 'S1', corner: 'IA' }, 1), { kind: 'landmark', level: 'L1', corner: 'SA' });
  assert.deepEqual(nextSelection({ kind: 'landmark', level: 'S1', corner: 'IA' }, -1), { kind: 'femoral', side: 'right', part: 'center' });
});

test('nextSelection resolves a rim selection to its side and steps from there', () => {
  const rim = { kind: 'femoral', side: 'left', part: 'rim' };
  assert.deepEqual(nextSelection(rim, 1), { kind: 'femoral', side: 'right', part: 'center' });
  assert.deepEqual(nextSelection(rim, -1), { kind: 'landmark', level: 'S1', corner: 'SP' });
});
