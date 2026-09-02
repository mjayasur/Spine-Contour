import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeasureQueue } from '../renderer/viewer/measure-queue.js';

function geometryWith(tag) {
  return {
    vertebrae: { L1: { superior: [[tag, 0], [1, 0]], inferior: [[0, 1], [1, 1]], quadrilateral: [[tag, 0], [1, 0], [1, 1], [0, 1]] } },
    s1_superior: [[0, 2], [1, 2]],
    l1_center: [0.5, 0.5],
    hip_midpoint: [0.5, 3],
    femoral_circles: [[0, 3, 1], [1, 3, 1]],
  };
}

// A fake store with the same getState/setState contract as renderer/store.js, and a measure()
// whose promises the test resolves or rejects by hand, in whatever order it wants.
function harness() {
  let state = { studies: [{ id: 'A', measurements: null, geometry: null }, { id: 'B', measurements: null, geometry: null }] };
  const calls = [];
  const toasts = [];
  const queue = createMeasureQueue({
    measure: (request) => new Promise((resolve, reject) => { calls.push({ request, resolve, reject }); }),
    getState: () => state,
    setState: (patchOrFn) => { state = { ...state, ...(typeof patchOrFn === 'function' ? patchOrFn(state) : patchOrFn) }; },
    showToast: (message) => toasts.push(message),
    debounceMs: 10,
  });
  const study = (id) => state.studies.find((s) => s.id === id);
  return { queue, calls, toasts, study };
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a stale response is orphaned by a later commit on the same study', async () => {
  const h = harness();
  h.queue.commitGeometry('A', geometryWith(1));
  await tick(30);
  assert.equal(h.calls.length, 1);
  h.queue.commitGeometry('A', geometryWith(2));
  await tick(30);
  assert.equal(h.calls.length, 2);
  h.calls[0].resolve({ measurements: { PI: 1 }, geometry: geometryWith(1) });
  await tick(0);
  assert.equal(h.study('A').measurements, null, 'the first response must not land');
  h.calls[1].resolve({ measurements: { PI: 2 }, geometry: geometryWith(2) });
  await tick(0);
  assert.deepEqual(h.study('A').measurements, { PI: 2 });
});

test('replaceMeasured cancels a pending call and orphans one in flight', async () => {
  const h = harness();
  h.queue.commitGeometry('A', geometryWith(1));
  h.queue.replaceMeasured('A', geometryWith(0));
  await tick(30);
  assert.equal(h.calls.length, 0, 'the pending timer was cancelled');
  h.queue.commitGeometry('A', geometryWith(2));
  await tick(30);
  assert.equal(h.calls.length, 1);
  h.queue.replaceMeasured('A', geometryWith(0));
  h.calls[0].resolve({ measurements: { PI: 9 }, geometry: geometryWith(2) });
  await tick(0);
  assert.equal(h.study('A').measurements, null, 'the in-flight response was orphaned');
});

test('committing on another study flushes the pending one immediately', async () => {
  const h = harness();
  h.queue.commitGeometry('A', geometryWith(1));
  h.queue.commitGeometry('B', geometryWith(5));
  assert.equal(h.calls.length, 1, 'A was flushed synchronously');
  assert.deepEqual(h.calls[0].request.vertebrae, geometryWith(1).vertebrae);
  await tick(30);
  assert.equal(h.calls.length, 2, 'B followed after the debounce');
  assert.deepEqual(h.calls[1].request.vertebrae, geometryWith(5).vertebrae);
});

test('a failed current call restores the last measured geometry and toasts once; a stale failure is silent', async () => {
  const h = harness();
  const known = geometryWith(0);
  h.queue.replaceMeasured('A', known);
  h.queue.commitGeometry('A', geometryWith(1));
  await tick(30);
  h.calls[0].reject(new Error('backend gone'));
  await tick(0);
  assert.deepEqual(h.study('A').geometry, known, 'geometry restored to what the numbers describe');
  assert.notEqual(h.study('A').geometry, known, 'restored as a new reference');
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0], /not applied/);
  h.queue.commitGeometry('A', geometryWith(2));
  await tick(30);
  h.queue.commitGeometry('A', geometryWith(3));
  await tick(30);
  h.calls[1].reject(new Error('stale'));
  await tick(0);
  assert.equal(h.toasts.length, 1, 'a stale failure does not toast');
});

test('replacing study A leaves study B pending call alone', async () => {
  const h = harness();
  h.queue.commitGeometry('B', geometryWith(5));
  h.queue.replaceMeasured('A', geometryWith(0));
  await tick(30);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].request.vertebrae, geometryWith(5).vertebrae);
});

test('a response already in flight is superseded by a newer commit, on success and on failure', async () => {
  const h = harness();
  h.queue.replaceMeasured('A', geometryWith(0));
  h.queue.commitGeometry('A', geometryWith(1));
  await tick(30);
  assert.equal(h.calls.length, 1);
  h.queue.commitGeometry('A', geometryWith(2));
  h.calls[0].resolve({ measurements: { PI: 1 }, geometry: geometryWith(1) });
  await tick(0);
  assert.deepEqual(h.study('A').geometry, geometryWith(2), 'the older success did not overwrite the newer edit');
  assert.equal(h.study('A').measurements, null);
  await tick(30);
  assert.equal(h.calls.length, 2, 'the newer edit was measured');
  h.queue.commitGeometry('A', geometryWith(3));
  h.calls[1].reject(new Error('late failure'));
  await tick(0);
  assert.deepEqual(h.study('A').geometry, geometryWith(3), 'the older failure did not restore over the newer edit');
  assert.equal(h.toasts.length, 0, 'a superseded failure is silent');
});

test('a failure with no known measured geometry toasts without claiming a restore', async () => {
  const h = harness();
  h.queue.commitGeometry('A', geometryWith(1));
  await tick(30);
  h.calls[0].reject(new Error('backend gone'));
  await tick(0);
  assert.deepEqual(h.study('A').geometry, geometryWith(1), 'nothing to restore, geometry left as committed');
  assert.equal(h.toasts.length, 1);
  assert.doesNotMatch(h.toasts[0], /not applied/);
  assert.match(h.toasts[0], /backend gone/);
});
