import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatConfidence } from '../renderer/screens/analysis.js';

test('formatConfidence renders rounded percent from qc.femoral.confidence', () => {
  assert.equal(formatConfidence({ femoral: { confidence: 0.873 } }), '87%');
  assert.equal(formatConfidence({ femoral: { confidence: 1 } }), '100%');
});

test('formatConfidence renders em dash when qc is absent or malformed', () => {
  assert.equal(formatConfidence(null), '—');
  assert.equal(formatConfidence({}), '—');
  assert.equal(formatConfidence({ femoral: {} }), '—');
});

// A confidence of exactly 0 is a measured value, not a missing one, so it renders as a
// number. The em dash is reserved for "the backend did not report this", per the
// architecture contract's absent-value rule.
test('formatConfidence renders 0% for a measured zero, not an em dash', () => {
  assert.equal(formatConfidence({ femoral: { confidence: 0 } }), '0%');
});
