import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitCircle, imageToClient, clientToImage, nearestLandmark,
  landmarkAt, setLandmarkAt, LEVELS, CORNERS,
} from '../renderer/viewer/geometry.js';

test('LEVELS and CORNERS are the fixed anatomical lists', () => {
  assert.deepEqual(LEVELS, ['L1', 'L2', 'L3', 'L4', 'L5']);
  assert.deepEqual(CORNERS, ['SA', 'SP', 'IA', 'IP']);
});

test('fitCircle recovers a known circle from points on its edge', () => {
  const cx = 120; const cy = 80; const r = 40;
  const points = [0, 90, 200, 300].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  });
  const [fx, fy, fr] = fitCircle(points);
  assert.ok(Math.abs(fx - cx) < 1e-6, `cx ${fx} vs ${cx}`);
  assert.ok(Math.abs(fy - cy) < 1e-6, `cy ${fy} vs ${cy}`);
  assert.ok(Math.abs(fr - r) < 1e-6, `r ${fr} vs ${r}`);
});

test('fitCircle returns null for fewer than 3 points', () => {
  assert.equal(fitCircle([]), null);
  assert.equal(fitCircle([[0, 0]]), null);
  assert.equal(fitCircle([[0, 0], [1, 1]]), null);
});

test('fitCircle returns null for collinear points', () => {
  assert.equal(fitCircle([[0, 0], [10, 0], [20, 0]]), null);
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

test('landmarkAt reads every level and corner, including S1', () => {
  const geometry = fakeGeometry();
  assert.deepEqual(landmarkAt(geometry, 'L2', 'SA'), [10, 30]);
  assert.deepEqual(landmarkAt(geometry, 'L2', 'SP'), [20, 30]);
  assert.deepEqual(landmarkAt(geometry, 'L2', 'IA'), [10, 40]);
  assert.deepEqual(landmarkAt(geometry, 'L2', 'IP'), [20, 40]);
  assert.deepEqual(landmarkAt(geometry, 'S1', 'SA'), [10, 110]);
  assert.deepEqual(landmarkAt(geometry, 'S1', 'SP'), [20, 110]);
});

test('setLandmarkAt mutates the point and keeps quadrilateral in sync', () => {
  const geometry = fakeGeometry();
  setLandmarkAt(geometry, 'L3', 'IA', [11, 61]);
  assert.deepEqual(geometry.vertebrae.L3.inferior[0], [11, 61]);
  assert.deepEqual(geometry.vertebrae.L3.quadrilateral, [
    geometry.vertebrae.L3.superior[0],
    geometry.vertebrae.L3.superior[1],
    geometry.vertebrae.L3.inferior[1],
    geometry.vertebrae.L3.inferior[0],
  ]);
});

test('setLandmarkAt on S1 does not touch vertebrae', () => {
  const geometry = fakeGeometry();
  setLandmarkAt(geometry, 'S1', 'SP', [99, 99]);
  assert.deepEqual(geometry.s1_superior[1], [99, 99]);
});

function fakeCanvas(width, height, rect) {
  return { width, height, getBoundingClientRect: () => rect };
}

test('clientToImage maps a client point into image space and clamps to bounds', () => {
  const canvas = fakeCanvas(200, 100, { left: 50, top: 20, width: 100, height: 50 });
  const [x, y] = clientToImage({ clientX: 100, clientY: 45 }, canvas);
  assert.equal(x, 100);
  assert.equal(y, 50);
  const [cx, cy] = clientToImage({ clientX: -1000, clientY: 1000 }, canvas);
  assert.equal(cx, 0);
  assert.equal(cy, 100);
});

test('imageToClient is the inverse of clientToImage at interior points', () => {
  const canvas = fakeCanvas(200, 100, { left: 50, top: 20, width: 100, height: 50 });
  const rect = canvas.getBoundingClientRect();
  const [cx, cy] = imageToClient([100, 50], rect, canvas);
  assert.equal(cx, 100);
  assert.equal(cy, 45);
});

test('nearestLandmark finds the closest handle within radius and null outside it', () => {
  const geometry = fakeGeometry();
  const canvas = fakeCanvas(200, 150, { left: 0, top: 0, width: 200, height: 150 });
  const hit = nearestLandmark(geometry, 10, 30, canvas, 14);
  assert.deepEqual({ level: hit.level, corner: hit.corner }, { level: 'L2', corner: 'SA' });
  const miss = nearestLandmark(geometry, 500, 500, canvas, 14);
  assert.equal(miss, null);
});
