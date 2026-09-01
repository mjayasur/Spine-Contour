import { el, clear } from '../dom.js';
import { getState, setState } from '../store.js';
import { sagittalRows, lordosisRows, discRows, alignmentRows, isConsistent } from '../data/measurements.js';

const INCONSISTENCY_WARNING = 'Parameters inconsistent \u2014 check S1 and femoral landmarks.';
const NOT_COMPUTED_NOTE = 'Not computed in this build.';

function formatRowValue(row) {
  return row.absent ? '\u2014' : `${row.value.toFixed(1)}${row.unit}`;
}

function section(title, ...children) {
  return el('div', { class: 'meas-section' },
    el('div', { class: 'meas-section-head' },
      el('div', { class: 'meas-section-title' }, title),
      el('div', { class: 'meas-rule' })),
    ...children);
}

// A row that selects a vertebra. A real <button> so it is keyboard-reachable: these are
// the only way to drive the viewer's construction lines without a mouse until plan 04.
function rowButton(row, onClick) {
  return el('button', {
    type: 'button',
    class: `meas-row${row.highlight ? ' is-selected' : ''}`,
    'aria-pressed': row.highlight ? 'true' : 'false',
    onClick,
  },
    el('div', { class: 'meas-label' }, row.label),
    el('div', { class: 'meas-spacer' }),
    el('div', { class: 'meas-value' }, formatRowValue(row)));
}

// A row with nothing to select. No handler and no pointer cursor -- disc heights and
// spondylolisthesis are not computed in this build, so there is no level to highlight
// and nothing for a click to do.
function rowStatic(row) {
  return el('div', { class: 'meas-row-static' },
    el('div', { class: 'meas-label' }, row.label),
    el('div', { class: 'meas-spacer' }),
    el('div', { class: 'meas-value' }, formatRowValue(row)));
}

// Which vertebra a row's click selects.
//
// This is the WRITE half of the row/level mapping; data/measurements.js's SAGITTAL_DEFS
// is the READ half, and the two are deliberately asymmetric for exactly one row. PILL
// highlights when EITHER L1 or S1 is selected (`levels: ['L1','S1']`, because the PI-LL
// mismatch is a relationship between them), but a click has to choose one, and S1 is the
// one that draws a construction the user can see: the S1-midpoint-to-hip line shared by
// PI, PT and SS. Do not "reconcile" these into one table -- they answer different
// questions.
const ROW_LEVELS = { LL: 'L1', PI: 'S1', PT: 'S1', SS: 'S1', PILL: 'S1', L1PA: 'L1' };

function sameKey(a, b) {
  return a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);
}

export function mountMeasurements(container) {
  clear(container);
  const root = el('div', { class: 'meas-panel' });
  container.append(root);

  let lastKey = null;

  function updateMeasurements(study) {
    const state = getState();

    // Rebuild gate. screens/analysis.js calls this on every store notification, which
    // includes every pointermove pan frame; without the gate, a pan tears down and
    // rebuilds every row per frame, resetting scroll position and dropping focus.
    // Compared by reference: `measurements` is replaced wholesale by /predict, never
    // mutated. Same caveat as components/viewer.js -- plan 04 must replace, not mutate.
    const key = [study.id, study.measurements, state.selectedLevel, state.showAllLordosis];
    if (sameKey(key, lastKey)) return;
    lastKey = key;

    clear(root);
    const measurements = study.measurements;
    const rows = sagittalRows(measurements, { selectedLevel: state.selectedLevel });

    const section1 = section('01 \u2014 SAGITTAL PARAMETERS',
      el('div', { class: 'meas-rows' },
        ...rows.map((row) => rowButton(row, () => setState({ selectedLevel: ROW_LEVELS[row.key] })))));

    section1.append(el('button', {
      type: 'button',
      class: 'meas-disclosure',
      'aria-expanded': state.showAllLordosis ? 'true' : 'false',
      onClick: () => setState((s) => ({ showAllLordosis: !s.showAllLordosis })),
    }, state.showAllLordosis ? 'HIDE LORDOSIS LEVELS' : 'SHOW ALL LORDOSIS LEVELS'));

    if (state.showAllLordosis) {
      section1.append(el('div', { class: 'meas-rows' },
        ...lordosisRows(measurements).map((row) => rowButton(
          row,
          // Row key 'L2-S1' uses an ASCII hyphen; the label uses an en dash. The split
          // below relies on the key form, so do not unify them.
          () => setState({ selectedLevel: row.key.split('-')[0] }),
        ))));
    }

    if (!isConsistent(measurements)) {
      section1.append(el('div', { class: 'meas-warning' }, INCONSISTENCY_WARNING));
    }

    const section2 = section('02 \u2014 DISC HEIGHTS \u00B7 MM',
      el('div', { class: 'meas-rows' }, ...discRows().map(rowStatic)),
      el('div', { class: 'meas-note' }, NOT_COMPUTED_NOTE));

    const section3 = section('03 \u2014 ALIGNMENT',
      el('div', { class: 'meas-rows' }, ...alignmentRows(study).map(rowStatic)),
      el('div', { class: 'meas-note' }, NOT_COMPUTED_NOTE));

    root.append(section1, section2, section3);
  }

  return { updateMeasurements };
}
