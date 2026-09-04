import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, matchesQuery, newStudy } from '../renderer/screens/studies.js';

test('formatDate renders a short month/day/year', () => {
  // Noon UTC renders as the same calendar day from UTC-12 to UTC+11, so this holds on the
  // developer's machine and on CI alike.
  assert.equal(formatDate('2026-08-21T12:00:00.000Z'), 'Aug 21, 2026');
});

test('formatDate renders an em dash for a missing or invalid date', () => {
  assert.equal(formatDate(null), '\u2014');
  assert.equal(formatDate(undefined), '\u2014');
  assert.equal(formatDate('not a date'), '\u2014');
});

test('matchesQuery matches on id, patient, diagnosis, and view, case-insensitively', () => {
  const study = { id: 'SP-0042', pt: 'P-8841', dx: 'Anterior slip of L4 on L5', view: 'Standing lateral' };
  assert.equal(matchesQuery(study, 'sp-0042'), true);
  assert.equal(matchesQuery(study, 'p-8841'), true);
  assert.equal(matchesQuery(study, 'anterior slip'), true);
  assert.equal(matchesQuery(study, 'standing'), true);
  assert.equal(matchesQuery(study, 'flexion'), false);
});

test('matchesQuery tolerates studies with no patient or diagnosis fields', () => {
  const study = { id: 'SP-1000', view: 'Standing lateral' };
  assert.equal(matchesQuery(study, 'sp-1000'), true);
  assert.equal(matchesQuery(study, 'nonexistent'), false);
});

test('matchesQuery treats an empty query as matching everything', () => {
  assert.equal(matchesQuery({ id: 'SP-1000', view: 'Standing lateral' }, ''), true);
});

// `pt` and `dx` exist only on the nine compiled-in demo records. On a real study the patient
// and the diagnosis arrive as imported clinical values, and the box that offers to search a
// diagnosis has to find one.
test('matchesQuery finds a real study by an imported clinical value', () => {
  const study = {
    id: 'SP-1004', view: 'Standing lateral',
    clinical: { Age: '58', Diagnosis: 'Adult degenerative scoliosis', 'Treatment plan': 'L3-S1 fusion' },
  };
  assert.equal(matchesQuery(study, 'scoliosis'), true);
  assert.equal(matchesQuery(study, 'DEGENERATIVE'), true);
  assert.equal(matchesQuery(study, 'fusion'), true);
  assert.equal(matchesQuery(study, '58'), true);
  assert.equal(matchesQuery(study, 'spondylolisthesis'), false);
});

test('matchesQuery tolerates a record with no clinical object and a non-string clinical value', () => {
  // No clinical object at all (a demo record, or a store written before plan 06).
  assert.equal(matchesQuery({ id: 'SP-1000', view: 'Standing lateral' }, 'sp-1000'), true);
  assert.equal(matchesQuery({ id: 'SP-1000', view: 'Standing lateral' }, 'scoliosis'), false);
  // An empty one, and one holding values that are not strings: the string filter keeps the
  // join from throwing, so a hand-edited store cannot break the search box.
  assert.equal(matchesQuery({ id: 'SP-1001', view: 'Standing lateral', clinical: {} }, 'sp-1001'), true);
  const odd = { id: 'SP-1002', view: 'Standing lateral', clinical: { Age: 58, Notes: null, ODI: { v: 1 } } };
  assert.equal(matchesQuery(odd, 'sp-1002'), true);
  assert.equal(matchesQuery(odd, '58'), false);
});

test('newStudy builds an unsegmented real study with nulls, never zeros', () => {
  const study = newStudy({ id: 'SP-1000', fileName: 'film.dcm', filePath: 'C:/films/film.dcm' });
  assert.equal(study.id, 'SP-1000');
  assert.equal(study.source, 'real');
  assert.equal(study.fileName, 'film.dcm');
  assert.equal(study.filePath, 'C:/films/film.dcm');
  assert.equal(study.view, 'Standing lateral');
  assert.equal(study.thumbnail, null);
  assert.equal(study.measurements, null);
  assert.equal(study.geometry, null);
  assert.equal(study.qc, null);
  assert.deepEqual(study.clinical, {});
  assert.ok(!Number.isNaN(new Date(study.addedAt).getTime()));
});

test('newStudy stores a missing path as null', () => {
  assert.equal(newStudy({ id: 'SP-1001', fileName: 'a.png', filePath: undefined }).filePath, null);
});
