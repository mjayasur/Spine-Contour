import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predict, measure, loadStudies, readFile, pathForFile } from '../renderer/api.js';

const GENERIC_FALLBACK_MESSAGE = 'The application encountered an unexpected error.';
const BRIDGE_UNAVAILABLE_MESSAGE =
  'The application bridge is unavailable. Try restarting Spine Contour.';

// api.js reads the bare identifier `window`, which resolves through the
// module's global scope to `globalThis.window`. Each test stubs it and
// restores the previous value in `finally` so no test leaks state into the
// next one (tests in this file run sequentially, same as test/store.test.js,
// but nothing here should rely on that beyond what this helper already does).
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

test('a plain Error message passes through with the inner message preserved', async () => {
  await withWindow({ spineContour: { predict: async () => { throw new Error('boom'); } } }, async () => {
    await assert.rejects(predict({}), (err) => {
      assert.equal(err.message, 'boom');
      return true;
    });
  });
});

test('a TypeError IPC wrapper strips down to the inner message (Fix 1 regression)', async () => {
  await withWindow({
    spineContour: {
      predict: async () => {
        throw new Error("Error invoking remote method 'predict': TypeError: fetch failed");
      },
    },
  }, async () => {
    await assert.rejects(predict({}), (err) => {
      assert.equal(err.message, 'fetch failed');
      return true;
    });
  });
});

test('a RangeError IPC wrapper strips down to the inner message (Fix 1 regression)', async () => {
  await withWindow({
    spineContour: {
      measure: async () => {
        throw new Error("Error invoking remote method 'measure': RangeError: bad port");
      },
    },
  }, async () => {
    await assert.rejects(measure({}), (err) => {
      assert.equal(err.message, 'bad port');
      return true;
    });
  });
});

test('a plain Error IPC wrapper strips down to the inner message', async () => {
  await withWindow({
    spineContour: {
      measure: async () => {
        throw new Error("Error invoking remote method 'measure': Error: bad geometry");
      },
    },
  }, async () => {
    await assert.rejects(measure({}), (err) => {
      assert.equal(err.message, 'bad geometry');
      return true;
    });
  });
});

test('a wrapper whose inner message itself contains "Error: " keeps the inner text intact', async () => {
  await withWindow({
    spineContour: {
      predict: async () => {
        throw new Error("Error invoking remote method 'predict': Error: Model Error: weights missing");
      },
    },
  }, async () => {
    await assert.rejects(predict({}), (err) => {
      assert.equal(err.message, 'Model Error: weights missing');
      return true;
    });
  });
});

test('a bare message containing "Error: " with no IPC wrapper passes through whole', async () => {
  await withWindow({
    spineContour: {
      predict: async () => {
        throw new Error('Something Error: still here');
      },
    },
  }, async () => {
    await assert.rejects(predict({}), (err) => {
      assert.equal(err.message, 'Something Error: still here');
      return true;
    });
  });
});

test('a thrown undefined yields the generic fallback message', async () => {
  await withWindow({ spineContour: { predict: async () => { throw undefined; } } }, async () => {
    await assert.rejects(predict({}), (err) => {
      assert.equal(err.message, GENERIC_FALLBACK_MESSAGE);
      return true;
    });
  });
});

test('a thrown null yields the generic fallback message', async () => {
  await withWindow({ spineContour: { predict: async () => { throw null; } } }, async () => {
    await assert.rejects(predict({}), (err) => {
      assert.equal(err.message, GENERIC_FALLBACK_MESSAGE);
      return true;
    });
  });
});

test('a thrown bare object yields the generic fallback message', async () => {
  await withWindow({ spineContour: { predict: async () => { throw {}; } } }, async () => {
    await assert.rejects(predict({}), (err) => {
      assert.equal(err.message, GENERIC_FALLBACK_MESSAGE);
      return true;
    });
  });
});

test('an Error with an empty message yields the generic fallback message', async () => {
  await withWindow({ spineContour: { predict: async () => { throw new Error(''); } } }, async () => {
    await assert.rejects(predict({}), (err) => {
      assert.equal(err.message, GENERIC_FALLBACK_MESSAGE);
      return true;
    });
  });
});

test('a missing window.spineContour bridge yields the bridge-unavailable message', async () => {
  await withWindow({}, async () => {
    await assert.rejects(predict({}), (err) => {
      assert.equal(err.message, BRIDGE_UNAVAILABLE_MESSAGE);
      return true;
    });
  });
});

const IDENTITY = { id: 'SP-1000', source: 'real', fileName: 'film.dcm', addedAt: '2026-08-31T12:00:00.000Z', view: 'Standing lateral' };

test('loadStudies validates the raw store the bridge returns and fills in defaults', async () => {
  await withWindow({ spineContour: { loadStudies: async () => ({ version: 1, studies: [IDENTITY] }) } }, async () => {
    const studies = await loadStudies();
    assert.equal(studies.length, 1);
    assert.equal(studies[0].measurements, null);
    assert.deepEqual(studies[0].clinical, {});
  });
});

test('loadStudies rejects with a display-ready message when the store is not usable', async () => {
  await withWindow({ spineContour: { loadStudies: async () => ({ version: 2, studies: [] }) } }, async () => {
    await assert.rejects(loadStudies(), /version 2 is not supported/);
  });
  await withWindow({ spineContour: { loadStudies: async () => [] } }, async () => {
    await assert.rejects(loadStudies(), /not an object/);
  });
});

test('readFile passes a null (missing file) through as null', async () => {
  await withWindow({ spineContour: { readFile: async () => null } }, async () => {
    assert.equal(await readFile('C:/missing.dcm'), null);
  });
});

test('pathForFile returns the bridge path, and null for a missing bridge, an empty path, or a throw', async () => {
  await withWindow({ spineContour: { pathForFile: () => 'C:/films/a.dcm' } }, async () => { assert.equal(pathForFile({}), 'C:/films/a.dcm'); });
  await withWindow({ spineContour: { pathForFile: () => '' } }, async () => { assert.equal(pathForFile({}), null); });
  await withWindow({ spineContour: { pathForFile: () => { throw new Error('nope'); } } }, async () => { assert.equal(pathForFile({}), null); });
  await withWindow({}, async () => { assert.equal(pathForFile({}), null); });
});
