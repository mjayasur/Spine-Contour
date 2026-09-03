import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanFolder, SUPPORTED_EXTENSIONS } from '../scan-folder.js';

const dirs = [];

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spine-contour-scan-'));
  dirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

test('scanFolder finds supported image extensions and counts every other file as skipped', async () => {
  const dir = await tempDir();
  await writeFile(path.join(dir, 'film1.dcm'), 'x');
  await writeFile(path.join(dir, 'film2.PNG'), 'x');
  await writeFile(path.join(dir, 'notes.txt'), 'x');
  await writeFile(path.join(dir, 'readme.md'), 'x');

  const result = await scanFolder(dir);

  assert.deepEqual(result.files, [path.join(dir, 'film1.dcm'), path.join(dir, 'film2.PNG')]);
  assert.equal(result.skipped, 2);
});

test('scanFolder recurses into subfolders and returns full paths', async () => {
  const dir = await tempDir();
  const sub = path.join(dir, 'batch1', 'nested');
  await mkdir(sub, { recursive: true });
  await writeFile(path.join(dir, 'top.jpg'), 'x');
  await writeFile(path.join(sub, 'deep.tiff'), 'x');

  const result = await scanFolder(dir);

  assert.deepEqual(result.files, [path.join(sub, 'deep.tiff'), path.join(dir, 'top.jpg')]);
  assert.equal(result.skipped, 0);
});

test('scanFolder matches all eight supported extensions case-insensitively', async () => {
  const dir = await tempDir();
  const names = ['a.dcm', 'b.PNG', 'c.Jpg', 'd.JPEG', 'e.tif', 'f.TIFF', 'g.bmp', 'h.DICOM'];
  for (const name of names) {
    await writeFile(path.join(dir, name), 'x');
  }

  const result = await scanFolder(dir);

  assert.equal(SUPPORTED_EXTENSIONS.size, 8);
  assert.deepEqual(result.files, names.map((name) => path.join(dir, name)));
  assert.equal(result.skipped, 0);
  // The set is the contract with main.js's select-file filter and studies.js's FILM_EXTENSIONS.
  assert.deepEqual([...SUPPORTED_EXTENSIONS].sort(), ['.bmp', '.dcm', '.dicom', '.jpeg', '.jpg', '.png', '.tif', '.tiff']);
});

test('scanFolder never follows a junction back into a cycle and counts it as one skipped entry', async (t) => {
  const dir = await tempDir();
  await writeFile(path.join(dir, 'real.dcm'), 'x');
  const linkPath = path.join(dir, 'loop');
  try {
    await symlink(dir, linkPath, 'junction');
  } catch (_error) {
    t.skip('symlink/junction creation is not permitted in this environment');
    return;
  }

  const result = await scanFolder(dir);

  assert.deepEqual(result.files, [path.join(dir, 'real.dcm')]);
  assert.equal(result.skipped, 1);
});

test('scanFolder on an empty folder returns no files and no skips', async () => {
  const dir = await tempDir();

  const result = await scanFolder(dir);

  assert.deepEqual(result, { files: [], skipped: 0 });
});

test('scanFolder rejects when the root folder is missing or is not a folder', async () => {
  const dir = await tempDir();
  await writeFile(path.join(dir, 'film.png'), 'x');

  await assert.rejects(scanFolder(path.join(dir, 'missing')), { code: 'ENOENT' });
  await assert.rejects(scanFolder(path.join(dir, 'film.png')));
});

test('scanFolder returns a sorted, deterministic order regardless of creation order', async () => {
  const dir = await tempDir();
  await mkdir(path.join(dir, 'z'));
  await mkdir(path.join(dir, 'a'));
  // Created deliberately out of name order, across two subfolders and the root.
  await writeFile(path.join(dir, 'z', '2.png'), 'x');
  await writeFile(path.join(dir, 'b.dcm'), 'x');
  await writeFile(path.join(dir, 'a', '1.png'), 'x');
  await writeFile(path.join(dir, 'a', '0.png'), 'x');
  await writeFile(path.join(dir, 'c.jpg'), 'x');
  await writeFile(path.join(dir, 'z', '1.png'), 'x');
  // Mixed case on purpose: 'B' < 'a' in code-unit order but sorts AFTER 'a' under
  // localeCompare, so this is the one pair that fails if byName ever goes locale-aware.
  await writeFile(path.join(dir, 'B.png'), 'x');

  const first = await scanFolder(dir);
  const second = await scanFolder(dir);

  assert.deepEqual(first.files, [
    path.join(dir, 'B.png'),
    path.join(dir, 'a', '0.png'),
    path.join(dir, 'a', '1.png'),
    path.join(dir, 'b.dcm'),
    path.join(dir, 'c.jpg'),
    path.join(dir, 'z', '1.png'),
    path.join(dir, 'z', '2.png'),
  ]);
  assert.deepEqual(second, first);
  assert.equal(first.skipped, 0);
});
