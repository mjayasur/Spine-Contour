import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORE_VERSION, nextId, merge, validate, createStudySaver } from '../renderer/data/persistence.js';
import { DEMO_STUDIES } from '../renderer/data/demo-studies.js';

function identity(id) {
  return { id, source: 'real', fileName: 'film.dcm', addedAt: '2026-08-31T12:00:00.000Z', view: 'Standing lateral' };
}

function fullGeometry() {
  const vertebrae = {};
  for (const level of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    vertebrae[level] = {
      superior: [[0, 0], [1, 1]],
      inferior: [[0, 2], [1, 3]],
      quadrilateral: [[0, 0], [1, 0], [1, 1], [0, 1]],
    };
  }
  return {
    vertebrae,
    s1_superior: [[0, 4], [1, 5]],
    l1_center: [2, 2],
    hip_midpoint: [3, 3],
    femoral_circles: [[10, 10, 5], [20, 20, 6]],
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// --- original plan's cases ---

test('STORE_VERSION is 1', () => {
  assert.equal(STORE_VERSION, 1);
});

test('nextId returns SP-1000 for an empty study list', () => {
  assert.equal(nextId([]), 'SP-1000');
});

test('nextId ignores demo studies when scanning for the highest id', () => {
  const studies = [
    { id: 'SP-0042', source: 'demo' },
    { id: 'SP-0041', source: 'demo' },
  ];
  assert.equal(nextId(studies), 'SP-1000');
});

test('nextId increments past the highest real id, out of order', () => {
  const studies = [
    { id: 'SP-1000', source: 'real' },
    { id: 'SP-1004', source: 'real' },
    { id: 'SP-1002', source: 'real' },
    { id: 'SP-0042', source: 'demo' },
  ];
  assert.equal(nextId(studies), 'SP-1005');
});

test('nextId never collides with the demo id range', () => {
  const merged = merge([]);
  assert.equal(nextId(merged), 'SP-1000');
});

test('merge places real studies first, then all nine demo studies', () => {
  const real = [{ id: 'SP-1000', source: 'real' }];
  const merged = merge(real);
  assert.equal(merged.length, real.length + DEMO_STUDIES.length);
  assert.equal(merged[0].id, 'SP-1000');
  for (let i = 0; i < DEMO_STUDIES.length; i += 1) {
    assert.equal(merged[real.length + i].id, DEMO_STUDIES[i].id);
  }
});

test('merge with no real studies returns only the nine demo studies', () => {
  const merged = merge([]);
  assert.equal(merged.length, DEMO_STUDIES.length);
});

test('merge with an undefined argument returns only demo studies', () => {
  const merged = merge(undefined);
  assert.equal(merged.length, DEMO_STUDIES.length);
});

test('validate throws when the root is not an object', () => {
  assert.throws(() => validate(null));
  assert.throws(() => validate('not an object'));
  assert.throws(() => validate([]));
});

test('validate throws when studies is not an array', () => {
  assert.throws(() => validate({ version: STORE_VERSION }));
});

test('validate throws when a study is missing required fields', () => {
  assert.throws(() => validate({ version: STORE_VERSION, studies: [{ source: 'real' }] }));
});

test('validate throws when a study claims a non-real source', () => {
  const raw = {
    version: STORE_VERSION,
    studies: [{ id: 'SP-1000', source: 'demo', fileName: 'a.dcm', addedAt: '2026-01-01T00:00:00.000Z', view: 'Standing lateral' }],
  };
  assert.throws(() => validate(raw));
});

test('validate round-trips a well-formed store and fills in defaults', () => {
  const raw = {
    version: STORE_VERSION,
    studies: [identity('SP-1000')],
  };
  const studies = validate(raw);
  assert.equal(studies.length, 1);
  assert.equal(studies[0].id, 'SP-1000');
  assert.equal(studies[0].filePath, null);
  assert.equal(studies[0].thumbnail, null);
  assert.equal(studies[0].measurements, null);
  assert.equal(studies[0].geometry, null);
  assert.equal(studies[0].qc, null);
  assert.deepEqual(studies[0].clinical, {});
});

test('validate preserves a fully-populated study', () => {
  const raw = {
    version: STORE_VERSION,
    studies: [{
      ...identity('SP-1000'), filePath: 'C:/films/a.dcm', thumbnail: 'data:image/jpeg;base64,AAA',
      measurements: { PI: 50, PT: 20, SS: 30, LL: { 'L1-S1': 45 } },
      geometry: fullGeometry(), qc: { femoral: { confidence: 0.9 } },
      clinical: { Age: '62' },
    }],
  };
  const [study] = validate(raw);
  assert.equal(study.filePath, 'C:/films/a.dcm');
  assert.equal(study.thumbnail, 'data:image/jpeg;base64,AAA');
  assert.deepEqual(study.measurements, raw.studies[0].measurements);
  assert.deepEqual(study.geometry, raw.studies[0].geometry);
  assert.deepEqual(study.qc, raw.studies[0].qc);
  assert.deepEqual(study.clinical, { Age: '62' });
});

// --- brief's new cases ---

test('validate throws when the store version is not STORE_VERSION', () => {
  assert.throws(() => validate({ version: STORE_VERSION + 1, studies: [] }), /version/);
  assert.throws(() => validate({ studies: [] }), /version/);
});

test('validate nulls both measurements and geometry when the geometry shape is wrong, and warns', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const raw = { version: STORE_VERSION, studies: [{ ...identity('SP-1000'),
    measurements: { PI: 50, PT: 20, SS: 30, LL: { 'L1-S1': 45 } }, geometry: { vertebrae: {} } }] };
  const [study] = validate(raw);
  assert.equal(study.measurements, null);
  assert.equal(study.geometry, null);
  assert.equal(warn.mock.callCount(), 1);
});

test('validate nulls both when measurements are malformed even though the geometry is fine', (t) => {
  t.mock.method(console, 'warn', () => {});
  const raw = { version: STORE_VERSION, studies: [{ ...identity('SP-1000'),
    measurements: { PI: 'fifty', PT: 20, SS: 30, LL: { 'L1-S1': 45 } }, geometry: fullGeometry() }] };
  const [study] = validate(raw);
  assert.equal(study.measurements, null);
  assert.equal(study.geometry, null);
});

test('validate accepts measurements with L1PA and the extra lordosis levels absent', () => {
  const raw = { version: STORE_VERSION, studies: [{ ...identity('SP-1000'),
    measurements: { PI: 50, PT: 20, SS: 30, LL: { 'L1-S1': 45 } }, geometry: fullGeometry() }] };
  const [study] = validate(raw);
  assert.deepEqual(study.measurements, raw.studies[0].measurements);
  assert.deepEqual(study.geometry, raw.studies[0].geometry);
});

test('validate rejects a femoral circle with a non-positive radius and a quadrilateral with three points', (t) => {
  t.mock.method(console, 'warn', () => {});
  const badRadius = fullGeometry(); badRadius.femoral_circles[1][2] = 0;
  const threePoints = fullGeometry(); threePoints.vertebrae.L3.quadrilateral.pop();
  for (const geometry of [badRadius, threePoints]) {
    const [study] = validate({ version: STORE_VERSION, studies: [{ ...identity('SP-1000'),
      measurements: { PI: 50, PT: 20, SS: 30, LL: { 'L1-S1': 45 } }, geometry }] });
    assert.equal(study.geometry, null);
  }
});

test('validate drops a thumbnail that is not a data:image URI and unknown keys', () => {
  const [study] = validate({ version: STORE_VERSION, studies: [{ ...identity('SP-1000'), thumbnail: 'http://x/y.jpg', sourceAvailable: true }] });
  assert.equal(study.thumbnail, null);
  assert.equal('sourceAvailable' in study, false);
});

test('createStudySaver saves only real studies when the studies reference changes', async () => {
  const calls = [];
  const saver = createStudySaver({ save: async (studies) => { calls.push(studies); }, onError: () => {} });
  const real = { id: 'SP-1000', source: 'real' };
  const demo = { id: 'SP-0042', source: 'demo' };
  saver.notify({ studies: [real, demo] });
  await saver.flush();
  assert.deepEqual(calls, [[real]]);
});

test('createStudySaver ignores a notification whose studies reference is unchanged', async () => {
  const calls = [];
  const studies = [{ id: 'SP-1000', source: 'real' }];
  const saver = createStudySaver({ save: async (s) => { calls.push(s); }, onError: () => {} });
  saver.notify({ studies });
  saver.notify({ studies });
  await saver.flush();
  assert.equal(calls.length, 1);
});

test('createStudySaver does not save the initial reference it was primed with', async () => {
  const calls = [];
  const initial = [{ id: 'SP-1000', source: 'real' }];
  const saver = createStudySaver({ save: async (s) => { calls.push(s); }, onError: () => {}, initial });
  saver.notify({ studies: initial });
  await saver.flush();
  assert.equal(calls.length, 0);
});

test('createStudySaver coalesces changes made while a save is in flight into one trailing save of the latest', async () => {
  const calls = [];
  const first = deferred();
  let n = 0;
  const saver = createStudySaver({ save: (s) => { calls.push(s); n += 1; return n === 1 ? first.promise : Promise.resolve(); }, onError: () => {} });
  saver.notify({ studies: [{ id: 'SP-1000', source: 'real', v: 1 }] });
  saver.notify({ studies: [{ id: 'SP-1000', source: 'real', v: 2 }] });
  saver.notify({ studies: [{ id: 'SP-1000', source: 'real', v: 3 }] });
  assert.equal(calls.length, 1);
  first.resolve();
  await saver.flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0].v, 3);
});

test('createStudySaver reports a failed save through onError and keeps working afterward', async () => {
  const errors = [];
  let fail = true;
  const saver = createStudySaver({ save: async () => { if (fail) throw new Error('disk full'); }, onError: (e) => errors.push(e.message) });
  saver.notify({ studies: [{ id: 'SP-1000', source: 'real' }] });
  await saver.flush();
  fail = false;
  saver.notify({ studies: [{ id: 'SP-1001', source: 'real' }] });
  await saver.flush();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^Could not save studies: disk full$/);
});

test('createStudySaver with a disabledReason never saves and reports once', async () => {
  const calls = [];
  const errors = [];
  const saver = createStudySaver({ save: async (s) => { calls.push(s); }, onError: (e) => errors.push(e.message), disabledReason: 'the store was written by a newer version' });
  saver.notify({ studies: [{ id: 'SP-1000', source: 'real' }] });
  saver.notify({ studies: [{ id: 'SP-1001', source: 'real' }] });
  await saver.flush();
  assert.equal(calls.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not being saved/);
  assert.match(errors[0], /newer version/);
});
