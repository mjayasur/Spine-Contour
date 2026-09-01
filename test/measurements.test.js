import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sagittalRows, lordosisRows, discRows, alignmentRows,
  piResidual, isConsistent, deltaRow,
} from '../renderer/data/measurements.js';

const MEASUREMENTS = {
  SS: 38.2,
  PI: 52.7,
  PT: 14.6,
  L1PA: 21.3,
  LL: { 'L1-S1': 47.1, 'L2-S1': 40.0, 'L3-S1': 30.5, 'L4-S1': 18.2, 'L5-S1': 6.4 },
};

test('sagittalRows returns exactly six rows in the contracted order with verbatim labels', () => {
  const rows = sagittalRows(MEASUREMENTS, {});
  assert.deepEqual(rows.map((r) => r.key), ['LL', 'PI', 'PT', 'SS', 'PILL', 'L1PA']);
  assert.deepEqual(rows.map((r) => r.label), [
    'LUMBAR LORDOSIS · L1–S1',
    'PELVIC INCIDENCE',
    'PELVIC TILT',
    'SACRAL SLOPE',
    'PI–LL MISMATCH',
    'L1 PELVIC ANGLE',
  ]);
  rows.forEach((r) => assert.equal(r.unit, '°'));
});

test('sagittalRows computes values, including the derived PI-LL mismatch', () => {
  const rows = sagittalRows(MEASUREMENTS, {});
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.LL.value, 47.1);
  assert.equal(byKey.PI.value, 52.7);
  assert.equal(byKey.PT.value, 14.6);
  assert.equal(byKey.SS.value, 38.2);
  assert.ok(Math.abs(byKey.PILL.value - (52.7 - 47.1)) < 1e-9);
  assert.equal(byKey.L1PA.value, 21.3);
  rows.forEach((r) => assert.equal(r.absent, false));
});

test('sagittalRows marks every row absent with null values when measurements is null', () => {
  const rows = sagittalRows(null, {});
  assert.equal(rows.length, 6);
  rows.forEach((r) => {
    assert.equal(r.absent, true);
    assert.equal(r.value, null);
  });
});

test('sagittalRows highlight reflects opts.selectedLevel per the row-to-level map', () => {
  const rows = sagittalRows(MEASUREMENTS, { selectedLevel: 'S1' });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.PI.highlight, true);
  assert.equal(byKey.PT.highlight, true);
  assert.equal(byKey.SS.highlight, true);
  assert.equal(byKey.PILL.highlight, true);
  assert.equal(byKey.LL.highlight, false);
  assert.equal(byKey.L1PA.highlight, false);
});

test('sagittalRows highlight: selecting L1PA highlights only the L1PA row, not LL or PILL', () => {
  const rows = sagittalRows(MEASUREMENTS, { selectedLevel: 'L1PA' });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.L1PA.highlight, true);
  assert.equal(byKey.LL.highlight, false);
  assert.equal(byKey.PILL.highlight, false);
  assert.equal(byKey.PI.highlight, false);
  assert.equal(byKey.PT.highlight, false);
  assert.equal(byKey.SS.highlight, false);
});

// Regression test for the "clicking L1 PELVIC ANGLE drew lumbar lordosis" bug: L1PA's
// levels used to be ['L1'], so selecting the L1 vertebra highlighted the L1PA row too.
// L1PA now has its own construction target and must NOT highlight when L1 is selected.
test('sagittalRows highlight: selecting L1 highlights LL and PILL but not L1PA (regression)', () => {
  const rows = sagittalRows(MEASUREMENTS, { selectedLevel: 'L1' });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.LL.highlight, true);
  assert.equal(byKey.PILL.highlight, true);
  assert.equal(byKey.L1PA.highlight, false);
});

test('lordosisRows returns L2-S1 through L5-S1 with values when present', () => {
  const rows = lordosisRows(MEASUREMENTS);
  assert.deepEqual(rows.map((r) => r.key), ['L2-S1', 'L3-S1', 'L4-S1', 'L5-S1']);
  assert.equal(rows[0].value, 40.0);
  assert.equal(rows[0].label, 'LUMBAR LORDOSIS · L2–S1');
  rows.forEach((r) => assert.equal(r.absent, false));
});

test('lordosisRows is absent when measurements is null', () => {
  const rows = lordosisRows(null);
  rows.forEach((r) => {
    assert.equal(r.absent, true);
    assert.equal(r.value, null);
  });
});

test('discRows is always five absent rows regardless of input', () => {
  const rows = discRows();
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.label), ['L1–L2', 'L2–L3', 'L3–L4', 'L4–L5', 'L5–S1']);
  rows.forEach((r) => { assert.equal(r.absent, true); assert.equal(r.value, null); });
});

test('alignmentRows is always one absent spondylolisthesis row', () => {
  const rows = alignmentRows({ id: 'SP-1000' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'SPONDY · L4–L5 · MM');
  assert.equal(rows[0].absent, true);
  assert.equal(rows[0].value, null);
});

test('piResidual is |PI - (PT + SS)| and null when measurements is null', () => {
  assert.ok(Math.abs(piResidual(MEASUREMENTS) - Math.abs(52.7 - (14.6 + 38.2))) < 1e-9);
  assert.equal(piResidual(null), null);
});

test('isConsistent is true at and below the 1.0 boundary, false above it, true when null', () => {
  assert.equal(isConsistent({ PI: 50, PT: 25, SS: 24.0, L1PA: 0, LL: { 'L1-S1': 0 } }), true);
  assert.equal(isConsistent({ PI: 50, PT: 25, SS: 23.99, L1PA: 0, LL: { 'L1-S1': 0 } }), false);
  assert.equal(isConsistent(null), true);
});

test('deltaRow formats a signed one-decimal delta with the correct minus glyph', () => {
  const positive = deltaRow({ value: 40, absent: false }, { value: 42.3, absent: false }, 5);
  assert.equal(positive.text, '+2.3');
  assert.equal(positive.overThreshold, false);
  const negative = deltaRow({ value: 40, absent: false }, { value: 33, absent: false }, 5);
  assert.equal(negative.text, '−7.0');
  assert.equal(negative.overThreshold, true);
});

test('deltaRow is over threshold exactly at the boundary and empty when either row is absent', () => {
  const boundary = deltaRow({ value: 10, absent: false }, { value: 15, absent: false }, 5);
  assert.equal(boundary.overThreshold, true);
  const absent = deltaRow({ value: null, absent: true }, { value: 10, absent: false }, 5);
  assert.equal(absent.text, '—');
  assert.equal(absent.overThreshold, false);
});
