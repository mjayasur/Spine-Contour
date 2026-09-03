/**
 * Atomic JSON read/write for the study store and the per-study prediction sidecars, with
 * corrupt-store recovery (spec 13, 13.1). Deliberately outside renderer/ — the only file in
 * the persistence stack that touches node:fs — and CommonJS, because the repo root is
 * CommonJS and main.js requires it. Mirrors renderer/data/persistence.js's STORE_VERSION;
 * test/store-io.test.js asserts they stay equal.
 */
const { readFile, writeFile, rename, mkdir } = require('node:fs/promises');
const path = require('node:path');

const STORE_VERSION = 1;

function isValidStoreShape(parsed) {
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.studies);
}

// Write to <path>.tmp then rename over the target, so a crash mid-write leaves the previous
// file intact. rename() replaces an existing file on Windows as well as POSIX.
async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmpPath, filePath);
}

// Missing or unparseable → null. No quarantine: a sidecar is derived data that a re-run recreates.
async function readJsonOrNull(filePath) {
  let raw;
  try { raw = await readFile(filePath, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try { return JSON.parse(raw); } catch (_error) { return null; }
}

function writeStudyStore(storePath, studies) {
  return writeJsonAtomic(storePath, { version: STORE_VERSION, studies });
}

// The store as parsed. A missing file is an empty store. An unparseable file, or JSON without a
// studies array, is renamed aside to <storePath>.corrupt-<timestamp> and replaced with an empty
// store rather than crashing the caller. `version` is passed through untouched: a store written
// by a newer build is shape-valid, and the renderer refuses it without overwriting it.
async function readStudyStore(storePath) {
  let raw;
  try { raw = await readFile(storePath, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return { version: STORE_VERSION, studies: [] };
    throw error;
  }
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_error) { parsed = null; }
  if (!isValidStoreShape(parsed)) {
    await rename(storePath, `${storePath}.corrupt-${Date.now()}`);
    await writeStudyStore(storePath, []);
    return { version: STORE_VERSION, studies: [] };
  }
  return parsed;
}

module.exports = { STORE_VERSION, isValidStoreShape, readStudyStore, writeStudyStore, readJsonOrNull, writeJsonAtomic };
