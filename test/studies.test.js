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
