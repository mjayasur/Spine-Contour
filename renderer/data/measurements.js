// RESIDUAL_LIMIT mirrors data/status.js's constant of the same name (plan 05).
// Duplicated here deliberately: this module must not depend on plan 05's file.
//
// PLAN 05 OWES THIS ONE GUARD. Two independent literals for one clinical threshold,
// with nothing comparing them, is how deriveStatus() and isConsistent() end up
// disagreeing about the same study. When plan 05 creates data/status.js it must either
// import piResidual/isConsistent from here (inverting the dependency, which is the
// better fix) or add a test asserting the two literals are equal -- exactly what the
// architecture contract already requires for STORE_VERSION.
const RESIDUAL_LIMIT = 1.0;

const SAGITTAL_DEFS = [
  { key: 'LL', label: 'LUMBAR LORDOSIS · L1–S1', levels: ['L1'] },
  { key: 'PI', label: 'PELVIC INCIDENCE', levels: ['S1'] },
  { key: 'PT', label: 'PELVIC TILT', levels: ['S1'] },
  { key: 'SS', label: 'SACRAL SLOPE', levels: ['S1'] },
  { key: 'PILL', label: 'PI–LL MISMATCH', levels: ['L1', 'S1'] },
  // L1PA's levels is ['L1PA'], not ['L1']. L1 pelvic angle has a construction of its
  // own -- the angle at the hip between the L1 centroid and the S1 midpoint -- which is
  // geometrically unrelated to lumbar lordosis. Mapping it to 'L1' made clicking a row
  // labelled L1 PELVIC ANGLE draw the lordosis line and label it `LL L1-S1`. See the
  // architecture contract's selectedLevel section.
  { key: 'L1PA', label: 'L1 PELVIC ANGLE', levels: ['L1PA'] },
];

function sagittalValue(key, measurements) {
  if (key === 'LL') return measurements.LL['L1-S1'];
  if (key === 'PILL') return measurements.PI - measurements.LL['L1-S1'];
  return measurements[key];
}

export function sagittalRows(measurements, opts = {}) {
  const selectedLevel = opts.selectedLevel ?? null;
  const absent = measurements == null;
  return SAGITTAL_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    value: absent ? null : sagittalValue(def.key, measurements),
    unit: '°',
    absent,
    highlight: selectedLevel != null && def.levels.includes(selectedLevel),
  }));
}

const LORDOSIS_LEVELS = ['L2', 'L3', 'L4', 'L5'];

export function lordosisRows(measurements) {
  const absent = measurements == null;
  return LORDOSIS_LEVELS.map((level) => {
    const key = `${level}-S1`;
    return {
      key,
      label: `LUMBAR LORDOSIS · ${level}–S1`,
      value: absent ? null : measurements.LL[key],
      unit: '°',
      absent,
      highlight: false,
    };
  });
}

const DISC_LEVEL_PAIRS = [['L1', 'L2'], ['L2', 'L3'], ['L3', 'L4'], ['L4', 'L5'], ['L5', 'S1']];

export function discRows() {
  return DISC_LEVEL_PAIRS.map(([a, b]) => ({
    key: `${a}-${b}`,
    label: `${a}–${b}`,
    value: null,
    unit: 'mm',
    absent: true,
    highlight: false,
  }));
}

export function alignmentRows(study) {
  void study; // reserved: a future per-study calibration input, unused while slip is unimplemented (spec §10.3)
  return [{
    key: 'SPONDY_L4_L5',
    label: 'SPONDY · L4–L5 · MM',
    value: null,
    unit: 'mm',
    absent: true,
    highlight: false,
  }];
}

export function piResidual(measurements) {
  if (measurements == null) return null;
  return Math.abs(measurements.PI - (measurements.PT + measurements.SS));
}

export function isConsistent(measurements) {
  const residual = piResidual(measurements);
  if (residual == null) return true;
  return residual <= RESIDUAL_LIMIT;
}

export function deltaRow(row, otherRow, threshold) {
  if (!row || !otherRow || row.absent || otherRow.absent || row.value == null || otherRow.value == null) {
    return { text: '—', overThreshold: false };
  }
  const delta = otherRow.value - row.value;
  const sign = delta >= 0 ? '+' : '−';
  return { text: `${sign}${Math.abs(delta).toFixed(1)}`, overThreshold: Math.abs(delta) >= threshold };
}
