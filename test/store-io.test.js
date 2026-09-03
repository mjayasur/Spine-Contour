import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { STORE_VERSION, readStudyStore, writeStudyStore, readJsonOrNull, writeJsonAtomic } from '../store-io.js';

const dirs = [];

async function tempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function tempStorePath() {
  const dir = await tempDir('spine-contour-store-');
  return path.join(dir, 'studies.json');
}

after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

test('STORE_VERSION matches renderer/data/persistence.js', async () => {
  const { STORE_VERSION: rendererVersion } = await import('../renderer/data/persistence.js');
  assert.equal(STORE_VERSION, rendererVersion);
});

test('readStudyStore returns an empty store when the file does not exist', async () => {
  const storePath = await tempStorePath();
  const loaded = await readStudyStore(storePath);
  assert.deepEqual(loaded, { version: STORE_VERSION, studies: [] });
  // A fresh profile is NOT a quarantine: main.js keys the sidecar move on this field, so a
  // stray value here would move a healthy predictions/ aside on every first launch.
  assert.equal(loaded.quarantined ?? null, null);
});

test('writeStudyStore then readStudyStore round-trips the studies array', async () => {
  const storePath = await tempStorePath();
  const studies = [{ id: 'SP-1000', source: 'real', fileName: 'film.dcm' }];
  await writeStudyStore(storePath, studies);
  const loaded = await readStudyStore(storePath);
  assert.deepEqual(loaded.studies, studies);
  assert.equal(loaded.version, STORE_VERSION);
  assert.equal(loaded.quarantined ?? null, null);
});

test('writeStudyStore writes the version alongside the studies', async () => {
  const storePath = await tempStorePath();
  await writeStudyStore(storePath, []);
  const raw = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(raw.version, STORE_VERSION);
  assert.deepEqual(raw.studies, []);
});

test('writeStudyStore leaves no .tmp file behind after a successful write', async () => {
  const storePath = await tempStorePath();
  await writeStudyStore(storePath, [{ id: 'SP-1000', source: 'real' }]);
  const exists = await access(`${storePath}.tmp`).then(() => true).catch(() => false);
  assert.equal(exists, false);
});

test('readStudyStore quarantines an unparseable file and returns an empty store', async () => {
  const storePath = await tempStorePath();
  await writeFile(storePath, '{ this is not valid json', 'utf8');

  const loaded = await readStudyStore(storePath);
  assert.equal(loaded.version, STORE_VERSION);
  assert.deepEqual(loaded.studies, []);

  const dir = path.dirname(storePath);
  const entries = await readdir(dir);
  const corruptEntry = entries.find((name) => name.startsWith('studies.json.corrupt-'));
  assert.ok(corruptEntry, 'expected a studies.json.corrupt-<timestamp> file');
  const corruptContent = await readFile(path.join(dir, corruptEntry), 'utf8');
  assert.equal(corruptContent, '{ this is not valid json');

  // The quarantine has to be reportable: main.js reads this bare filename both to move
  // predictions/ aside under the SAME timestamp and to name the file in the user's toast.
  assert.equal(loaded.quarantined, corruptEntry);
  assert.match(loaded.quarantined, /^studies\.json\.corrupt-\d+$/);

  const freshRaw = JSON.parse(await readFile(storePath, 'utf8'));
  assert.deepEqual(freshRaw.studies, []);
});

test('readStudyStore quarantines well-formed JSON with the wrong shape', async () => {
  const storePath = await tempStorePath();
  await writeFile(storePath, JSON.stringify({ hello: 'world' }), 'utf8');

  const loaded = await readStudyStore(storePath);
  assert.equal(loaded.version, STORE_VERSION);
  assert.deepEqual(loaded.studies, []);

  const dir = path.dirname(storePath);
  const entries = await readdir(dir);
  assert.ok(entries.some((name) => name.startsWith('studies.json.corrupt-')));
  assert.ok(entries.includes(loaded.quarantined), 'quarantined must name a file that exists');
});

test('readStudyStore quarantines a JSON array at the root instead of an object', async () => {
  const storePath = await tempStorePath();
  await writeFile(storePath, JSON.stringify([1, 2, 3]), 'utf8');

  const loaded = await readStudyStore(storePath);
  assert.equal(loaded.version, STORE_VERSION);
  assert.deepEqual(loaded.studies, []);

  const dir = path.dirname(storePath);
  const entries = await readdir(dir);
  assert.ok(entries.some((name) => name.startsWith('studies.json.corrupt-')));
  assert.ok(entries.includes(loaded.quarantined), 'quarantined must name a file that exists');
});

test('quarantined is a bare filename, not a path -- main.js joins it against userData itself', async () => {
  const storePath = await tempStorePath();
  await writeFile(storePath, 'not json at all', 'utf8');
  const loaded = await readStudyStore(storePath);
  assert.equal(loaded.quarantined.includes('/'), false);
  assert.equal(loaded.quarantined.includes('\\'), false);
  assert.equal(path.basename(loaded.quarantined), loaded.quarantined);
});

test('readStudyStore passes an unknown version through untouched (the renderer decides)', async () => {
  const storePath = await tempStorePath();
  await writeFile(storePath, JSON.stringify({ version: 99, studies: [] }), 'utf8');
  const loaded = await readStudyStore(storePath);
  assert.equal(loaded.version, 99);
  const entries = await readdir(path.dirname(storePath));
  assert.equal(entries.some((name) => name.includes('corrupt')), false);
  // The store is passed through untouched, so it carries no quarantine field at all: the
  // renderer refuses this store on its version and nothing of the user's is moved aside.
  assert.equal(Object.prototype.hasOwnProperty.call(loaded, 'quarantined'), false);
});

test('writeJsonAtomic creates missing parent directories and readJsonOrNull round-trips', async () => {
  const dir = await tempDir('spine-contour-json-');
  const file = path.join(dir, 'predictions', 'SP-1000.json');
  await writeJsonAtomic(file, { hello: 'world' });
  assert.deepEqual(await readJsonOrNull(file), { hello: 'world' });
  const tmpLeft = await access(`${file}.tmp`).then(() => true).catch(() => false);
  assert.equal(tmpLeft, false);
});

test('readJsonOrNull is null for a missing file and for unparseable JSON, without quarantining', async () => {
  const dir = await tempDir('spine-contour-json-');
  const file = path.join(dir, 'x.json');
  assert.equal(await readJsonOrNull(file), null);
  await writeFile(file, '{ nope', 'utf8');
  assert.equal(await readJsonOrNull(file), null);
  assert.deepEqual((await readdir(dir)), ['x.json']);
});
