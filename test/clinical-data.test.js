import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldCountLabel, mountClinicalData } from '../renderer/components/clinical-data.js';

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
