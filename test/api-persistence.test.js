import { test } from 'node:test';
import assert from 'node:assert/strict';

// disablePersistence is irreversible module state with no re-enable, so this test lives in its
// own file: node --test runs each test file in its own process, which removes any hazard from
// running after (or before) another test that touches the same module instance.
async function withWindow(windowValue, fn) {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const previousWindow = globalThis.window;
  globalThis.window = windowValue;
  try {
    await fn();
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
}

test('after disablePersistence, saveStudies and savePrediction reject without touching the bridge', async () => {
  const { disablePersistence, persistenceDisabledReason, saveStudies, savePrediction } = await import('../renderer/api.js');
  let touched = 0;
  await withWindow({ spineContour: { saveStudies: async () => { touched += 1; }, savePrediction: async () => { touched += 1; } } }, async () => {
    assert.equal(persistenceDisabledReason(), null);
    disablePersistence('the store was written by a newer version');
    assert.equal(persistenceDisabledReason(), 'the store was written by a newer version');
    await assert.rejects(saveStudies([]), /not being saved: the store was written by a newer version/);
    await assert.rejects(savePrediction('SP-1000', {}), /not being saved/);
    assert.equal(touched, 0);
  });
});
