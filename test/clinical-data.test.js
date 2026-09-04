import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldCountLabel, importRowFor, mountClinicalData } from '../renderer/components/clinical-data.js';
import { joinClinical } from '../renderer/data/csv.js';

test('fieldCountLabel reads NO FIELDS when no field is active, whatever the study count', () => {
  assert.equal(fieldCountLabel(0, 0), 'NO FIELDS');
  assert.equal(fieldCountLabel(0, 1), 'NO FIELDS');
  assert.equal(fieldCountLabel(0, 2), 'NO FIELDS');
});

test('fieldCountLabel uses the singular for one field and for one study', () => {
  assert.equal(fieldCountLabel(1, 1), '1 FIELD · 1 STUDY');
  assert.equal(fieldCountLabel(1, 2), '1 FIELD · 2 STUDIES');
  assert.equal(fieldCountLabel(3, 1), '3 FIELDS · 1 STUDY');
});

test('fieldCountLabel uses the plural for several fields and studies, and the module is import-safe', () => {
  assert.equal(fieldCountLabel(2, 2), '2 FIELDS · 2 STUDIES');
  assert.equal(fieldCountLabel(9, 3), '9 FIELDS · 3 STUDIES');
  // The import at the top of this file already proved the module loads without a DOM;
  // pin both facts so a later refactor that reads `document` at module scope fails here.
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof mountClinicalData, 'function');
});

// ---------------------------------------------------------------------------
// importRowFor: which CSV row `Import from CSV` may write onto the open study.

const HEADERS = ['study_id', 'age_yrs'];
const ROWS = [{ study_id: 'SP001', age_yrs: '58' }, { study_id: 'SP002', age_yrs: '44' }];
const MAPPING = [{ src: 'study_id', dest: null }, { src: 'age_yrs', dest: 'Age' }];
// Two different patients' films collide on basename; SP002 and SP003 are unique.
const SCAN = ['C:\\batch1\\SP001.dcm', 'C:\\batch1\\SP002.png', 'C:\\batch1\\SP003.png', 'C:\\batch2\\SP001.png'];

function csvState(overrides) {
  return {
    wsFolder: 'C:\\batch1', wsFiles: SCAN, wsCsv: 'C:\\clinical.csv',
    wsCsvHeaders: HEADERS, wsCsvRows: ROWS, wsMapping: MAPPING,
    ...overrides,
  };
}

function study(fileName, filePath) {
  return {
    id: 'SP-1000', source: 'real', fileName, filePath,
    addedAt: '2026-08-21T12:00:00.000Z', view: 'Standing lateral', thumbnail: null,
    measurements: null, geometry: null, qc: null, clinical: {},
  };
}

test('importRowFor returns the matched row for a scanned film whose stem is unique', () => {
  const decision = importRowFor(csvState(), study('SP002.png', 'C:\\batch1\\SP002.png'));
  assert.deepEqual(decision, { ok: true, values: { Age: '44' } });
});

test('importRowFor refuses a film whose stem is shared by another scanned film', () => {
  // The exact case the Workspace load counts `ambiguous` and attaches to NEITHER film.
  // Both colliding films refuse, and neither carries the row.
  const first = importRowFor(csvState(), study('SP001.dcm', 'C:\\batch1\\SP001.dcm'));
  const second = importRowFor(csvState(), study('SP001.png', 'C:\\batch2\\SP001.png'));
  assert.deepEqual(first, { ok: false, reason: 'ambiguous', stem: 'SP001' });
  assert.deepEqual(second, { ok: false, reason: 'ambiguous', stem: 'SP001' });
  // And the pin: the one-film join the drawer used to run DOES hand back the row, which is
  // precisely why joining `[study.fileName]` let the drawer write what the load refused.
  const oneFilm = joinClinical({ files: ['SP001.dcm'], headers: HEADERS, rows: ROWS, mapping: MAPPING });
  assert.deepEqual(oneFilm.byFile.get('SP001.dcm'), { Age: '58' });
});

test('importRowFor falls back to the filename for a film with no path, and for one outside the scan', () => {
  // No path at all: the film is not in the workspace, so the scan has no opinion about it.
  assert.deepEqual(importRowFor(csvState(), study('SP002.png', null)), { ok: true, values: { Age: '44' } });
  // A picked or dropped film from outside the scanned folder keeps the same one-film join.
  assert.deepEqual(importRowFor(csvState(), study('SP002.png', 'D:\\elsewhere\\SP002.png')),
    { ok: true, values: { Age: '44' } });
  // The scan is consulted case-insensitively, so a differently-cased path is still IN it.
  assert.deepEqual(importRowFor(csvState(), study('SP001.DCM', 'c:\\BATCH1\\sp001.dcm')),
    { ok: false, reason: 'ambiguous', stem: 'SP001' });
});

test('importRowFor reports no-row when nothing matches and no-csv when no CSV is loaded', () => {
  assert.deepEqual(importRowFor(csvState(), study('SP003.png', 'C:\\batch1\\SP003.png')),
    { ok: false, reason: 'no-row', stem: 'SP003' });
  assert.deepEqual(importRowFor(csvState(), study('SP404.png', null)),
    { ok: false, reason: 'no-row', stem: 'SP404' });
  assert.deepEqual(importRowFor(csvState({ wsCsv: null }), study('SP002.png', 'C:\\batch1\\SP002.png')),
    { ok: false, reason: 'no-csv', stem: 'SP002' });
});
