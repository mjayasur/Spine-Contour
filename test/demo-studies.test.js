import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_STUDIES } from '../renderer/data/demo-studies.js';
import { deriveStatus } from '../renderer/data/status.js';

test('DEMO_STUDIES has exactly nine studies with unique ids in SP-0030..SP-0042', () => {
  assert.equal(DEMO_STUDIES.length, 9);
  const ids = DEMO_STUDIES.map((s) => s.id);
  assert.equal(new Set(ids).size, 9);
  for (const id of ids) {
    const match = /^SP-(\d{4})$/.exec(id);
    assert.ok(match, `${id} does not match the SP-#### id format`);
    const n = Number(match[1]);
    assert.ok(n >= 30 && n <= 42, `${id} is outside the demo id range SP-0030..SP-0042`);
  }
});

test('every demo study has source "demo" and a null filePath', () => {
  for (const study of DEMO_STUDIES) {
    assert.equal(study.source, 'demo');
    assert.equal(study.filePath, null);
  }
});

test('every demo study omits L1PA (renders as an em dash)', () => {
  for (const study of DEMO_STUDIES) {
    assert.equal('L1PA' in study.measurements, false, `${study.id} should have no L1PA key`);
  }
});

test('every demo study omits lumbar lordosis levels L2-S1..L5-S1', () => {
  for (const study of DEMO_STUDIES) {
    assert.equal('L1-S1' in study.measurements.LL, true, `${study.id} should have LL[L1-S1]`);
    for (const level of ['L2-S1', 'L3-S1', 'L4-S1', 'L5-S1']) {
      assert.equal(level in study.measurements.LL, false, `${study.id} should have no LL[${level}]`);
    }
  }
});

test('every demo study satisfies PI = PT + SS within 0.1 degrees', () => {
  for (const study of DEMO_STUDIES) {
    const { PI, PT, SS } = study.measurements;
    const residual = Math.abs(PI - (PT + SS));
    assert.ok(residual <= 0.1, `${study.id} has a PI/PT/SS residual of ${residual}, expected <= 0.1`);
  }
});

test('every demo study carries a femoral qc confidence between 0 and 1', () => {
  for (const study of DEMO_STUDIES) {
    const confidence = study.qc && study.qc.femoral && study.qc.femoral.confidence;
    assert.equal(typeof confidence, 'number', `${study.id} should have qc.femoral.confidence`);
    assert.ok(confidence > 0 && confidence <= 1, `${study.id} confidence ${confidence} is out of range`);
  }
});

test('every demo study derives to Segmented status', () => {
  for (const study of DEMO_STUDIES) {
    assert.equal(deriveStatus(study), 'seg', `${study.id} should derive to seg`);
  }
});

test('demo studies carry the extra display fields real studies leave absent', () => {
  for (const study of DEMO_STUDIES) {
    assert.equal(typeof study.pt, 'string');
    assert.equal(typeof study.sex, 'string');
    assert.equal(typeof study.age, 'number');
    assert.equal(typeof study.dx, 'string');
    assert.equal(typeof study.conf, 'number');
  }
});

test('every demo study has null geometry and a null thumbnail (no film to show)', () => {
  for (const study of DEMO_STUDIES) {
    assert.equal(study.geometry, null);
    assert.equal(study.thumbnail, null);
  }
});
