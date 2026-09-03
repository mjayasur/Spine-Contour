import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESIDUAL_LIMIT, CONFIDENCE_LIMIT, deriveStatus, statusLabel } from '../renderer/data/status.js';
import { isConsistent } from '../renderer/data/measurements.js';

test('RESIDUAL_LIMIT is 1.0 degrees and CONFIDENCE_LIMIT is 0.6', () => {
  assert.equal(RESIDUAL_LIMIT, 1.0);
  assert.equal(CONFIDENCE_LIMIT, 0.6);
});

test('deriveStatus returns proc when the study itself is null or undefined', () => {
  assert.equal(deriveStatus(null), 'proc');
  assert.equal(deriveStatus(undefined), 'proc');
});

test('deriveStatus returns proc when measurements is null', () => {
  const study = { measurements: null, qc: null };
  assert.equal(deriveStatus(study), 'proc');
});

test('deriveStatus returns seg when residual and confidence both pass', () => {
  const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.9 } } };
  assert.equal(deriveStatus(study), 'seg');
});

test('deriveStatus returns rev when the residual exceeds the limit', () => {
  // |PI - (PT + SS)| = |50 - 48| = 2
  const study = { measurements: { PI: 50, PT: 20, SS: 28 }, qc: { femoral: { confidence: 0.9 } } };
  assert.equal(deriveStatus(study), 'rev');
});

test('deriveStatus returns rev when confidence is below the limit', () => {
  const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.5 } } };
  assert.equal(deriveStatus(study), 'rev');
});

test('deriveStatus returns rev when both the residual and confidence fail', () => {
  const study = { measurements: { PI: 50, PT: 20, SS: 28 }, qc: { femoral: { confidence: 0.1 } } };
  assert.equal(deriveStatus(study), 'rev');
});

test('a residual of exactly 1.0 is inclusive-pass (seg, not rev)', () => {
  // |51 - (20 + 30)| = 1.0 exactly
  const study = { measurements: { PI: 51, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.9 } } };
  assert.equal(deriveStatus(study), 'seg');
});

test('a confidence of exactly 0.6 is inclusive-pass (seg, not rev)', () => {
  const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.6 } } };
  assert.equal(deriveStatus(study), 'seg');
});

test('a residual of 1.01 fails (rev)', () => {
  const study = { measurements: { PI: 51.01, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.9 } } };
  assert.equal(deriveStatus(study), 'rev');
});

test('a confidence of 0.59 fails (rev)', () => {
  const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: { femoral: { confidence: 0.59 } } };
  assert.equal(deriveStatus(study), 'rev');
});

test('missing qc entirely does not by itself force rev', () => {
  const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: null };
  assert.equal(deriveStatus(study), 'seg');
});

test('missing qc.femoral does not by itself force rev', () => {
  const study = { measurements: { PI: 50, PT: 20, SS: 30 }, qc: {} };
  assert.equal(deriveStatus(study), 'seg');
});

test('statusLabel maps every status to its display label', () => {
  assert.equal(statusLabel('seg'), 'Segmented');
  assert.equal(statusLabel('rev'), 'Needs review');
  assert.equal(statusLabel('proc'), 'Processing');
});

test('deriveStatus and isConsistent agree at the residual boundary (one RESIDUAL_LIMIT)', () => {
  const at = { PI: 20 + 30 + RESIDUAL_LIMIT, PT: 20, SS: 30 };
  const over = { PI: 20 + 30 + RESIDUAL_LIMIT + 0.01, PT: 20, SS: 30 };
  const qc = { femoral: { confidence: 0.9 } };
  assert.equal(deriveStatus({ measurements: at, qc }), 'seg');
  assert.equal(isConsistent(at), true);
  assert.equal(deriveStatus({ measurements: over, qc }), 'rev');
  assert.equal(isConsistent(over), false);
});
