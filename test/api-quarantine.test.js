import { test } from 'node:test';
import assert from 'node:assert/strict';

// `persistenceUnsafe` makes loadStudies() call disablePersistence() itself, which is
// irreversible module state with no re-enable path. Same reason test/api-persistence.test.js
// is its own file: node --test runs each file in its own process, so nothing here can leak
// into the loadStudies tests in test/api.test.js.
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

const UNSAFE_NOTICE =
  'Your saved studies could not be read and were moved aside as studies.json.corrupt-42, but '
  + 'the saved segmentation images could not be moved with them. Nothing will be saved this '
  + 'session so none of them can be overwritten.';

test('a persistenceUnsafe store disables persistence from inside loadStudies, so no caller can forget', async () => {
  const { loadStudies, storeLoadNotice, persistenceDisabledReason, saveStudies, savePrediction } =
    await import('../renderer/api.js');
  let touched = 0;
  await withWindow({
    spineContour: {
      loadStudies: async () => ({ version: 1, studies: [], notice: UNSAFE_NOTICE, persistenceUnsafe: true }),
      saveStudies: async () => { touched += 1; },
      savePrediction: async () => { touched += 1; },
    },
  }, async () => {
    assert.equal(persistenceDisabledReason(), null);

    const studies = await loadStudies();
    assert.deepEqual(studies, []); // the store still validates: it is a well-formed empty store

    assert.equal(storeLoadNotice(), UNSAFE_NOTICE);
    assert.equal(persistenceDisabledReason(), UNSAFE_NOTICE);

    // The point of the whole path: the orphaned predictions/<id>.json files are still there,
    // so nextId()'s reused SP-1000 must not be able to write over one of them.
    await assert.rejects(saveStudies([]), /not being saved/);
    await assert.rejects(savePrediction('SP-1000', {}), /not being saved/);
    assert.equal(touched, 0);
  });
});
