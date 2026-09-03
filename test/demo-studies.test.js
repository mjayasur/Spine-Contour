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

// Double-entry value check (plan 05, fix round 1). The tests above check shape and
// type -- id format, key presence/absence, PI = PT + SS, confidence range, field
// types -- but never a specific transcribed number. PI = PT + SS is commutative, so a
// record with PT and SS transposed would pass every test above while showing the
// wrong number under a correct label ("PELVIC TILT" showing the sacral slope value).
// This table is transcribed independently from design-reference/template.html's
// STUDIES array (line 655) and the task brief -- NOT copied out of
// renderer/data/demo-studies.js -- so the comparison below is not vacuous. dx/plan/hx/
// outcome are deliberately not included: they are display prose, a transcription slip
// there is visible on screen rather than clinically misleading, and duplicating four
// paragraphs per record would double the transcription surface for no real guard.
const EXPECTED = {
  'SP-0042': { PI: 54.1, PT: 18.3, SS: 35.8, LL: 48.2, conf: 96, pt: 'P-8841', sex: 'F', age: 62, bmi: '27.4', odi: '46', view: 'Standing lateral', fileName: 'SP-0042.jpg', addedAt: '2026-08-21T12:10:00.000Z' },
  'SP-0041': { PI: 48.9, PT: 22.6, SS: 26.3, LL: 31.7, conf: 88, pt: 'P-3306', sex: 'M', age: 57, bmi: '31.2', odi: '52', view: 'Flexion lateral', fileName: 'SP-0041.jpg', addedAt: '2026-08-21T12:00:00.000Z' },
  'SP-0039': { PI: 49.8, PT: 12.1, SS: 37.7, LL: 52.4, conf: 97, pt: 'P-7712', sex: 'F', age: 15, bmi: '20.8', odi: '51', view: 'Standing lateral', fileName: 'SP-0039.jpg', addedAt: '2026-08-20T12:00:00.000Z' },
  'SP-0038': { PI: 52.3, PT: 29.8, SS: 22.5, LL: 24.9, conf: 92, pt: 'P-1054', sex: 'M', age: 71, bmi: '29.6', odi: '58', view: 'Extension lateral', fileName: 'SP-0038.jpg', addedAt: '2026-08-19T12:00:00.000Z' },
  'SP-0036': { PI: 55.6, PT: 21.4, SS: 34.2, LL: 44.7, conf: 94, pt: 'P-6420', sex: 'F', age: 44, bmi: '24.1', odi: '42', view: 'Standing lateral', fileName: 'SP-0036.jpg', addedAt: '2026-08-18T12:00:00.000Z' },
  'SP-0035': { PI: 46.2, PT: 25.1, SS: 21.1, LL: 27.9, conf: 82, pt: 'P-9013', sex: 'M', age: 66, bmi: '28.3', odi: '49', view: 'Lateral lumbar', fileName: 'SP-0035.jpg', addedAt: '2026-08-17T12:00:00.000Z' },
  'SP-0033': { PI: 53.0, PT: 19.7, SS: 33.3, LL: 44.1, conf: 93, pt: 'P-2287', sex: 'F', age: 58, bmi: '26.0', odi: '38', view: 'Standing lateral', fileName: 'SP-0033.jpg', addedAt: '2026-08-15T12:00:00.000Z' },
  'SP-0031': { PI: 57.1, PT: 10.2, SS: 46.9, LL: 58.3, conf: 95, pt: 'P-5561', sex: 'M', age: 23, bmi: '22.5', odi: '29', view: 'Lateral lumbar', fileName: 'SP-0031.jpg', addedAt: '2026-08-14T12:00:00.000Z' },
  'SP-0030': { PI: 44.8, PT: 28.4, SS: 16.4, LL: 18.3, conf: 91, pt: 'P-4178', sex: 'F', age: 69, bmi: '30.1', odi: '61', view: 'Standing lateral', fileName: 'SP-0030.jpg', addedAt: '2026-08-12T12:00:00.000Z' },
};

test('every demo study matches the independently transcribed expected values (double-entry check)', () => {
  for (const study of DEMO_STUDIES) {
    const expected = EXPECTED[study.id];
    assert.ok(expected, `${study.id} has no entry in EXPECTED`);
    assert.equal(study.measurements.PI, expected.PI, `${study.id} PI`);
    assert.equal(study.measurements.PT, expected.PT, `${study.id} PT`);
    assert.equal(study.measurements.SS, expected.SS, `${study.id} SS`);
    assert.equal(study.measurements.LL['L1-S1'], expected.LL, `${study.id} LL['L1-S1']`);
    assert.equal(study.qc.femoral.confidence, expected.conf / 100, `${study.id} qc.femoral.confidence`);
    assert.equal(study.pt, expected.pt, `${study.id} pt`);
    assert.equal(study.sex, expected.sex, `${study.id} sex`);
    assert.equal(study.age, expected.age, `${study.id} age`);
    assert.equal(study.bmi, expected.bmi, `${study.id} bmi`);
    assert.equal(study.odi, expected.odi, `${study.id} odi`);
    assert.equal(study.view, expected.view, `${study.id} view`);
    assert.equal(study.fileName, expected.fileName, `${study.id} fileName`);
    assert.equal(study.addedAt, expected.addedAt, `${study.id} addedAt`);
  }
});

test('EXPECTED covers exactly the ids in DEMO_STUDIES, no more and no fewer', () => {
  const demoIds = new Set(DEMO_STUDIES.map((s) => s.id));
  const expectedIds = new Set(Object.keys(EXPECTED));
  assert.deepEqual([...demoIds].sort(), [...expectedIds].sort());
});
