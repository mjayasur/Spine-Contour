# Workspace and Clinical Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a researcher point SpineContour at a folder of radiographs and an optional clinical-data CSV, load the folder as queued studies, and capture clinical fields for a study on the Analysis screen — all against real local files, with no network calls and no fabricated data.

**Architecture:** Four new local-only IPC channels (`chooseFolder`, `scanFolder`, `chooseCsv`, `readCsv`) let the renderer read the filesystem without Node integration in the renderer process. A dependency-free recursive scanner (`scan-folder.js`) and a hand-written CSV parser/auto-mapper (added to `renderer/data/csv.js`) do the real work; both are unit-tested with `node --test`. The Workspace screen and the clinical-data drawer are vanilla DOM components that read and write the shared store and persist through the `saveStudies`/`saveStudies`-backed API built in plan 05.

**Tech Stack:** Vanilla ES modules, Electron `ipcMain`/`contextBridge`, Node's `fs/promises`, Node's built-in test runner (`node --test`). No new npm dependencies.

## Global Constraints

- **No bundler, no framework, no npm runtime dependencies.** Vanilla ES modules only. `package.json` `dependencies` stays empty; `devDependencies` stays exactly `electron` and `electron-builder`.
- **CSP is `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'`.** It must not be loosened. No CDN, no Google Fonts, no remote anything.
- **Fonts are self-hosted** from `assets/fonts/`. Source Sans 3 and Chivo Mono, both SIL OFL.
- **Never display a fabricated measurement.** Absent values render the em dash `—`, never `0`, never `N/A`, never a guess.
- **Never label a value with a name it isn't.** See the `SS` rename (plan 02) and the `FEMORAL FIT CONFIDENCE` badge (plan 03).
- **Node's built-in test runner only** (`node --test`). No Jest, Vitest, or Mocha.
- **Every `<script>` is `type="module"`.** No global scope leakage.
- Target Electron 44 / Chromium — modern syntax is fine. No transpilation.
- Commit after every task. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `chore:`).

---

## Design notes specific to this plan

Two behaviors the spec describes in prose need a concrete mechanism; both are decided here so every task implements the same thing.

**The `study_id` join key is not one of the nine clinical fields.** `autoMap` (Task 3) only ever matches a CSV header against `KNOWN_FIELDS` — `Age`, `Sex`, `BMI`, `Diagnosis`, `ODI`, `Treatment plan`, `Surgical history`, `Follow-up`, `Notes` — exactly as bound by the architecture contract. A `study_id` column therefore comes back `dest: null` ("Unmapped") in the column-mapping chips, and that is correct: it is not a clinical field, it is the join key. The Workspace screen's "Load workspace" handler (Task 4) finds the join column itself, independently of `autoMap`, by normalizing every CSV header the same way (lowercase, strip non-alphanumerics) and looking for the one that reads `studyid`.

**A raw film on disk has no ID yet — IDs are assigned at load time.** The only identity a scanned file has before it becomes a `Study` is its filename. So the join in Task 4 matches a CSV row's `study_id` value against each film's filename stem (basename without extension), case-insensitively — e.g. a file `SP001.dcm` joins a CSV row with `study_id` `SP001` or `sp001`. Rows whose `study_id` matches no film's stem are counted as unmatched and reported in the post-load toast; they are not written anywhere (there is no dedicated `wsUnmatched*` store field — that would exceed the state shape the architecture contract fixes), which satisfies "kept and flagged": loading does not fail or drop data because of them, and the user is told the count.

**`autoMap` is a prefix match on stripped, lowercased strings — not a synonym table.** `odi_base` → `ODI` and `age_yrs` → `Age` both work because the known field's stripped name (`odi`, `age`) is a literal prefix of the stripped header (`odibase`, `ageyrs`). `tx_plan` stays unmapped because `txplan` is not a prefix of `treatmentplan` (or the reverse) — confirmed in Task 3's tests. Note: the task brief that produced this plan also asserted `dx_text` → `Diagnosis`, but `dxtext` is not a prefix of `diagnosis` under this same rule (nor the reverse), and a `dx`-means-diagnosis special case can't be added without also adding a `tx`-means-treatment case, which the brief explicitly forbids. Task 3 implements the one consistent rule and asserts `dx_text` stays unmapped, with a comment explaining why. Flagged here for the reviewer rather than silently resolved either way.

---

### Task 1: Pure recursive folder scanner

**Files:**
- Create: `scan-folder.js`
- Test: `test/scan-folder.test.js`

**Interfaces:**
- Consumes: Node built-ins only (`node:fs/promises`, `node:path`). No Electron, no other plan's code.
- Produces: `scanFolder(dirPath) → Promise<{files: string[], skipped: number}>`, required by Task 2's `scan-folder` IPC handler as `require('./scan-folder')`.

This is a standalone CommonJS module (matching `main.js`'s CommonJS style) with zero Electron dependency, specifically so it can be `require`d directly by `node --test` without Electron ever loading. `main.js` cannot be unit-tested the same way because requiring it executes `app.whenReady()` at module scope.

- [ ] **Step 1: Write the failing tests**

Create `test/scan-folder.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanFolder } = require('../scan-folder.js');

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'spine-contour-scan-'));
}

test('scanFolder finds supported image extensions and counts skipped files', async () => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, 'film1.dcm'), 'x');
  await fs.writeFile(path.join(dir, 'film2.PNG'), 'x');
  await fs.writeFile(path.join(dir, 'notes.txt'), 'x');
  await fs.writeFile(path.join(dir, 'readme.md'), 'x');

  const result = await scanFolder(dir);

  assert.equal(result.files.length, 2);
  assert.equal(result.skipped, 2);
  assert.ok(result.files.some((f) => f.endsWith('film1.dcm')));
  assert.ok(result.files.some((f) => f.endsWith('film2.PNG')));

  await fs.rm(dir, { recursive: true, force: true });
});

test('scanFolder recurses into subfolders', async () => {
  const dir = await makeTempDir();
  const sub = path.join(dir, 'batch1', 'nested');
  await fs.mkdir(sub, { recursive: true });
  await fs.writeFile(path.join(dir, 'top.jpg'), 'x');
  await fs.writeFile(path.join(sub, 'deep.tiff'), 'x');

  const result = await scanFolder(dir);

  assert.equal(result.files.length, 2);
  assert.equal(result.skipped, 0);
  assert.ok(result.files.some((f) => f.endsWith(path.join('nested', 'deep.tiff'))));

  await fs.rm(dir, { recursive: true, force: true });
});

test('scanFolder matches every supported extension case-insensitively', async () => {
  const dir = await makeTempDir();
  const names = ['a.dcm', 'b.PNG', 'c.Jpg', 'd.JPEG', 'e.tif', 'f.TIFF', 'g.bmp'];
  for (const name of names) {
    await fs.writeFile(path.join(dir, name), 'x');
  }

  const result = await scanFolder(dir);

  assert.equal(result.files.length, names.length);
  assert.equal(result.skipped, 0);

  await fs.rm(dir, { recursive: true, force: true });
});

test('scanFolder does not follow a symlinked directory back into a cycle', async (t) => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, 'real.dcm'), 'x');
  const linkPath = path.join(dir, 'loop');
  try {
    await fs.symlink(dir, linkPath, 'junction');
  } catch (_error) {
    await fs.rm(dir, { recursive: true, force: true });
    t.skip('symlink/junction creation is not permitted in this environment');
    return;
  }

  const result = await scanFolder(dir);

  assert.equal(result.files.length, 1);
  assert.equal(result.skipped, 0);

  await fs.rm(dir, { recursive: true, force: true });
});

test('scanFolder on an empty folder returns no files and no skips', async () => {
  const dir = await makeTempDir();

  const result = await scanFolder(dir);

  assert.deepEqual(result, { files: [], skipped: 0 });

  await fs.rm(dir, { recursive: true, force: true });
});
```

The `'junction'` symlink type is used because it works on Windows without Developer Mode or admin rights (unlike a plain directory symlink), and is simply ignored — a normal symlink is created — on macOS/Linux.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test test/scan-folder.test.js`
Expected: FAIL — `Cannot find module '../scan-folder.js'` (the module doesn't exist yet).

- [ ] **Step 3: Implement `scan-folder.js`**

Create `scan-folder.js`:

```js
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const SUPPORTED_EXTENSIONS = new Set(['.dcm', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp']);

async function scanFolder(dirPath) {
  const files = [];
  let skipped = 0;

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        // Never follow a symlink — directory or file. This is what keeps the
        // walk from cycling through a symlinked directory that points back
        // at an ancestor of itself.
        continue;
      }
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          files.push(entryPath);
        } else {
          skipped += 1;
        }
      }
    }
  }

  await walk(dirPath);
  return { files, skipped };
}

module.exports = { scanFolder, SUPPORTED_EXTENSIONS };
```

`path.join`/`path.extname` are used instead of manual string splitting so Windows backslash paths are handled the same way `path` handles them everywhere else in this codebase.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test test/scan-folder.test.js`
Expected: PASS — 5 tests, 0 failures (or 4 pass + 1 skipped if the sandbox forbids symlink creation).

- [ ] **Step 5: Commit**

```bash
git add scan-folder.js test/scan-folder.test.js
git commit -m "feat: add pure recursive folder scanner for workspace image discovery"
```

---

### Task 2: Workspace and CSV IPC channels

**Files:**
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `renderer/api.js` (created in plan 02/03; already exports `selectFile`, `predict`, `measure`, and — from plan 05 — `loadStudies`, `saveStudies`)

**Interfaces:**
- Consumes: `scanFolder` from Task 1's `scan-folder.js`; the existing `ipcMain.handle`/`contextBridge.exposeInMainWorld('spineContour', {...})` pattern already used for `select-file`/`predict`/`measure`.
- Produces: `window.spineContour.chooseFolder()`, `.scanFolder(dirPath)`, `.chooseCsv()`, `.readCsv(filePath)`; and `renderer/api.js`'s `chooseFolder()`, `scanFolder(dirPath)`, `chooseCsv()`, `readCsv(filePath)` — exact signatures from the architecture contract, consumed by Task 4 (`renderer/screens/workspace.js`).

This task can't be driven by `node --test` — it's Electron main-process wiring plus a renderer wrapper around `window.spineContour`, neither of which runs under plain Node. It gets a manual verification pass instead.

- [ ] **Step 1: Add the `scan-folder` require to `main.js`**

In `main.js`, after the existing requires:

```js
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
```

add:

```js
const { scanFolder } = require('./scan-folder');
```

so the block reads:

```js
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { scanFolder } = require('./scan-folder');
```

- [ ] **Step 2: Add the four IPC handlers to `main.js`**

Add these four `ipcMain.handle` blocks anywhere among the other `ipcMain.handle(...)` blocks in `main.js` (for example, directly after the existing `measure` handler, before `function createWindow() {` — if plan 05 already added `load-studies`/`save-studies` handlers in between, add these alongside them, order does not matter):

```js
ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('scan-folder', async (_event, dirPath) => {
  if (typeof dirPath !== 'string' || dirPath.length === 0) {
    throw new Error('No folder was selected.');
  }
  return scanFolder(dirPath);
});

ipcMain.handle('choose-csv', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'CSV files', extensions: ['csv'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('read-csv', async (_event, filePath) => {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('No CSV file was selected.');
  }
  return fsPromises.readFile(filePath, 'utf8');
});
```

None of these touch `backendBaseUrl` or `fetch` — they are pure filesystem/dialog operations, matching the CSP's `connect-src 'none'` and the spec's "nothing is uploaded" guarantee.

- [ ] **Step 3: Expose the four channels in `preload.js`**

In `preload.js`, inside the object passed to `contextBridge.exposeInMainWorld('spineContour', {...})`, add these four lines (alongside whatever `loadStudies`/`saveStudies` lines plan 05 already added):

```js
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  scanFolder: (dirPath) => ipcRenderer.invoke('scan-folder', dirPath),
  chooseCsv: () => ipcRenderer.invoke('choose-csv'),
  readCsv: (filePath) => ipcRenderer.invoke('read-csv', filePath),
```

So the full file reads (order of the four new lines relative to any plan-05 lines does not matter):

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spineContour', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  predict: (request) => ipcRenderer.invoke('predict', request),
  measure: (geometry) => ipcRenderer.invoke('measure', geometry),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  scanFolder: (dirPath) => ipcRenderer.invoke('scan-folder', dirPath),
  chooseCsv: () => ipcRenderer.invoke('choose-csv'),
  readCsv: (filePath) => ipcRenderer.invoke('read-csv', filePath),
});
```

- [ ] **Step 4: Add the four wrapper functions to `renderer/api.js`**

Open `renderer/api.js` and add these four functions after the existing exports (matching the delegation style already used for `selectFile`/`predict`/`measure`):

```js
export async function chooseFolder() {
  return window.spineContour.chooseFolder();
}

export async function scanFolder(dirPath) {
  return window.spineContour.scanFolder(dirPath);
}

export async function chooseCsv() {
  return window.spineContour.chooseCsv();
}

export async function readCsv(filePath) {
  return window.spineContour.readCsv(filePath);
}
```

`ipcRenderer.invoke` already rejects with an `Error` carrying the message thrown in the main-process handler, so no extra error-normalizing wrapper is needed here — this matches how `selectFile`/`predict`/`measure` already behave.

- [ ] **Step 5: MANUAL VERIFICATION**

Run: `npm run dev`

Once the window loads, open DevTools (`Ctrl+Shift+I`) and run in the console, one line at a time:

```js
const folder = await window.spineContour.chooseFolder();
console.log('folder:', folder);
```
Expected: the native folder picker opens; after choosing a real folder, `folder` logs its absolute path. Cancel a second attempt and confirm it logs `null`.

```js
const scan = await window.spineContour.scanFolder(folder);
console.log('scan:', scan);
```
Expected: `scan` is `{files: [...], skipped: N}` — `files` lists real absolute paths of every `.dcm`/`.png`/`.jpg`/`.jpeg`/`.tif`/`.tiff`/`.bmp` file in that folder and its subfolders, and `skipped` is the count of every other file encountered.

```js
const csvPath = await window.spineContour.chooseCsv();
console.log('csvPath:', csvPath);
const text = await window.spineContour.readCsv(csvPath);
console.log('text:', text.slice(0, 200));
```
Expected: the native file picker opens filtered to `.csv`; `csvPath` logs the chosen path; `text` logs the file's real contents (or `null`/an error if canceled/missing, handled the same way `selectFile` already handles cancellation).

- [ ] **Step 6: Commit**

```bash
git add main.js preload.js renderer/api.js
git commit -m "feat: add chooseFolder, scanFolder, chooseCsv, readCsv IPC channels"
```

---

### Task 3: CSV parsing and column auto-mapping

**Files:**
- Modify: `renderer/data/csv.js` (created in plan 03; already exports `toCsv(studies, fields, opts)` — do not rewrite it, only append to it)
- Modify: `test/csv.test.js` (created in plan 03 to test `toCsv`; append to it, do not remove its existing tests)

**Interfaces:**
- Consumes: nothing beyond the JS standard library.
- Produces: `KNOWN_FIELDS` (array of 9 strings), `parse(text) → {headers: string[], rows: Object[]}`, `autoMap(headers) → {src, dest}[]` — exact contract signatures, consumed by Task 4 (`workspace.js`) and Task 5 (`clinical-data.js`).

- [ ] **Step 1: Write the failing tests**

Open `test/csv.test.js`. If it already has an import line for `csv.js` (e.g. `import { toCsv } from '../renderer/data/csv.js';`), extend it to also import `parse`, `autoMap`, and `KNOWN_FIELDS`:

```js
import { toCsv, parse, autoMap, KNOWN_FIELDS } from '../renderer/data/csv.js';
```

If no such import exists yet, add that exact line at the top of the file. Then append these tests to the end of the file, after any existing `toCsv` tests:

```js
test('parse handles quoted fields with embedded commas and doubled quotes', () => {
  const { headers, rows } = parse('name,note\n"Doe, Jane","Says ""hi"" often"\n');
  assert.deepEqual(headers, ['name', 'note']);
  assert.deepEqual(rows, [{ name: 'Doe, Jane', note: 'Says "hi" often' }]);
});

test('parse handles embedded newlines inside quoted fields', () => {
  const { headers, rows } = parse('id,notes\r\n1,"line one\nline two"\r\n2,plain\r\n');
  assert.deepEqual(headers, ['id', 'notes']);
  assert.deepEqual(rows, [
    { id: '1', notes: 'line one\nline two' },
    { id: '2', notes: 'plain' },
  ]);
});

test('parse handles CRLF line endings', () => {
  const { headers, rows } = parse('a,b\r\n1,2\r\n3,4\r\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});

test('parse keeps an empty trailing field as an empty string', () => {
  const { headers, rows } = parse('a,b,c\n1,2,\n');
  assert.deepEqual(headers, ['a', 'b', 'c']);
  assert.deepEqual(rows, [{ a: '1', b: '2', c: '' }]);
});

test('parse on a header-only file (with trailing newline) returns zero data rows', () => {
  const { headers, rows } = parse('study_id,age,sex\n');
  assert.deepEqual(headers, ['study_id', 'age', 'sex']);
  assert.deepEqual(rows, []);
});

test('parse on a header-only file (no trailing newline) returns zero data rows', () => {
  const { headers, rows } = parse('study_id,age,sex');
  assert.deepEqual(headers, ['study_id', 'age', 'sex']);
  assert.deepEqual(rows, []);
});

test('autoMap matches odi_base -> ODI and age_yrs -> Age (stripped-prefix match)', () => {
  const mapping = autoMap(['odi_base', 'age_yrs', 'STUDY_ID']);
  assert.deepEqual(mapping[0], { src: 'odi_base', dest: 'ODI' });
  assert.deepEqual(mapping[1], { src: 'age_yrs', dest: 'Age' });
  assert.deepEqual(mapping[2], { src: 'STUDY_ID', dest: null });
});

test('autoMap leaves tx_plan unmapped — txplan is not a prefix of treatmentplan', () => {
  assert.deepEqual(autoMap(['tx_plan']), [{ src: 'tx_plan', dest: null }]);
});

test('autoMap leaves dx_text unmapped — there is no synonym table', () => {
  // "dx" is a common clinical abbreviation for diagnosis, but autoMap only
  // tests whether the stripped, lowercased known-field name is a literal
  // prefix of the stripped header (see the tx_plan case above). "dxtext" is
  // not a prefix of "diagnosis", nor the reverse, so this column comes back
  // unmapped like any other unrecognized header.
  assert.deepEqual(autoMap(['dx_text']), [{ src: 'dx_text', dest: null }]);
});

test('autoMap matches an exact, case-insensitive field name', () => {
  const mapping = autoMap(['diagnosis', 'NOTES']);
  assert.deepEqual(mapping, [
    { src: 'diagnosis', dest: 'Diagnosis' },
    { src: 'NOTES', dest: 'Notes' },
  ]);
});

test('autoMap returns an empty array for an empty header list', () => {
  assert.deepEqual(autoMap([]), []);
});

test('KNOWN_FIELDS lists exactly the nine clinical fields in order', () => {
  assert.deepEqual(KNOWN_FIELDS, ['Age', 'Sex', 'BMI', 'Diagnosis', 'ODI',
    'Treatment plan', 'Surgical history', 'Follow-up', 'Notes']);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test test/csv.test.js`
Expected: FAIL — `SyntaxError: The requested module '../renderer/data/csv.js' does not provide an export named 'parse'` (or similar, for `autoMap`/`KNOWN_FIELDS`).

- [ ] **Step 3: Append `parse`, `autoMap`, and `KNOWN_FIELDS` to `renderer/data/csv.js`**

Open `renderer/data/csv.js` and add the following to the **end** of the file, after the existing `toCsv` export — do not modify `toCsv` or anything above it:

```js
export const KNOWN_FIELDS = ['Age', 'Sex', 'BMI', 'Diagnosis', 'ODI',
  'Treatment plan', 'Surgical history', 'Follow-up', 'Notes'];

export function parse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  function pushField() {
    row.push(field);
    field = '';
  }

  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }

    if (char === '\r' && text[i + 1] === '\n') {
      pushRow();
      i += 2;
      continue;
    }

    if (char === '\n' || char === '\r') {
      pushRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // A fully blank line parses to a single empty field — drop those rather
  // than treating them as data.
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0];
  const dataRows = nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] !== undefined ? r[idx] : '';
    });
    return obj;
  });

  return { headers, rows: dataRows };
}

function normalizeFieldName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function autoMap(headers) {
  const normalizedFields = KNOWN_FIELDS.map((field) => ({ field, key: normalizeFieldName(field) }));
  return headers.map((src) => {
    const key = normalizeFieldName(src);
    const match = normalizedFields.find((f) => key === f.key || key.startsWith(f.key));
    return { src, dest: match ? match.field : null };
  });
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test test/csv.test.js`
Expected: PASS — every test in the file, including the pre-existing `toCsv` tests and the new ones above.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/csv.js test/csv.test.js
git commit -m "feat: add real CSV parsing and known-field auto-mapping"
```

---

### Task 4: Workspace screen

**Files:**
- Create: `renderer/screens/workspace.js`

**Interfaces:**
- Consumes: `el`, `clear`, `mount` from `renderer/dom.js`; `getState`, `setState` from `renderer/store.js`; `chooseFolder`, `scanFolder`, `chooseCsv`, `readCsv`, `saveStudies` from `renderer/api.js`; `parse`, `autoMap` from `renderer/data/csv.js`; `nextId` from `renderer/data/persistence.js`.
- Produces: `render(container)` — the screen's mount entry point, called by `renderer/router.js` (plan 02) whenever `state.screen === 'workspace'`.

- [ ] **Step 1: Implement `renderer/screens/workspace.js`**

Create `renderer/screens/workspace.js`:

```js
import { el, clear, mount } from '../dom.js';
import { getState, setState } from '../store.js';
import { chooseFolder, scanFolder, chooseCsv, readCsv, saveStudies } from '../api.js';
import { parse, autoMap, KNOWN_FIELDS } from '../data/csv.js';
import { nextId } from '../data/persistence.js';

function fileStem(filePath) {
  const base = filePath.split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function findJoinHeader(headers) {
  return headers.find((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '') === 'studyid') || null;
}

function workspaceLoadedMessage(count, hasCsv, matched, unmatched) {
  let message = `Workspace loaded — ${count} studies`;
  if (hasCsv) {
    message += ` · clinical data linked (${matched} matched`;
    message += unmatched ? `, ${unmatched} unmatched)` : ')';
  }
  return message;
}

export function render(container) {
  let skippedCount = 0;

  function refresh() {
    clear(container);
    mount(container, buildScreen());
  }

  async function onChooseFolder() {
    const folder = await chooseFolder();
    if (!folder) return;
    const { files, skipped } = await scanFolder(folder);
    skippedCount = skipped;
    setState({ wsFolder: folder, wsFiles: files });
    refresh();
  }

  async function onChooseCsv() {
    const csvPath = await chooseCsv();
    if (!csvPath) return;
    const text = await readCsv(csvPath);
    const { headers, rows } = parse(text);
    setState({ wsCsv: csvPath, wsCsvHeaders: headers, wsCsvRows: rows, wsMapping: autoMap(headers) });
    refresh();
  }

  async function onLoadWorkspace() {
    const state = getState();
    if (!state.wsFolder) return;

    const joinHeader = state.wsCsv ? findJoinHeader(state.wsCsvHeaders) : null;
    const filmsByStem = new Map();
    for (const filePath of state.wsFiles) {
      filmsByStem.set(fileStem(filePath).toLowerCase(), filePath);
    }

    const clinicalByFile = new Map();
    let matched = 0;
    let unmatched = 0;
    if (state.wsCsv) {
      if (joinHeader) {
        for (const row of state.wsCsvRows) {
          const key = String(row[joinHeader] || '').trim().toLowerCase();
          const filePath = key ? filmsByStem.get(key) : undefined;
          if (!filePath) {
            unmatched += 1;
            continue;
          }
          matched += 1;
          const clinical = clinicalByFile.get(filePath) || {};
          for (const mapping of state.wsMapping) {
            if (!mapping.dest) continue;
            const value = row[mapping.src];
            if (value !== undefined && value !== '') clinical[mapping.dest] = value;
          }
          clinicalByFile.set(filePath, clinical);
        }
      } else {
        unmatched = state.wsCsvRows.length;
      }
    }

    const draftStudies = [...state.studies];
    const nowIso = new Date().toISOString();
    for (const filePath of state.wsFiles) {
      const id = nextId(draftStudies);
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      draftStudies.push({
        id,
        source: 'real',
        filePath,
        fileName,
        addedAt: nowIso,
        view: 'Standing lateral',
        thumbnail: null,
        measurements: null,
        geometry: null,
        qc: null,
        clinical: clinicalByFile.get(filePath) || {},
      });
    }

    setState({
      studies: draftStudies,
      screen: 'studies',
      toast: workspaceLoadedMessage(state.wsFiles.length, !!state.wsCsv, matched, unmatched),
    });

    try {
      await saveStudies(getState().studies);
    } catch (_error) {
      setState({ toast: 'Workspace loaded, but saving to disk failed.' });
    }
  }

  function buildFolderCard(state) {
    const hasFolder = !!state.wsFolder;
    const metaText = hasFolder
      ? `${state.wsFiles.length} radiograph${state.wsFiles.length === 1 ? '' : 's'} found · ${skippedCount} unsupported file${skippedCount === 1 ? '' : 's'} skipped`
      : 'DICOM, PNG, JPG · subfolders included';
    return el('div', { class: 'workspace-card' + (hasFolder ? ' workspace-card--set' : '') },
      el('div', { class: 'workspace-card__eyebrow' }, '01 — IMAGE FOLDER'),
      el('div', { class: 'workspace-card__value' }, hasFolder ? state.wsFolder : 'No folder selected'),
      el('div', { class: 'workspace-card__meta' }, metaText),
      el('button', { class: 'workspace-card__button', onClick: onChooseFolder }, hasFolder ? 'Change…' : 'Choose folder…'));
  }

  function buildCsvCard(state) {
    const hasCsv = !!state.wsCsv;
    const metaText = hasCsv
      ? `${state.wsCsvRows.length} rows · ${state.wsCsvHeaders.length} columns · matched on study_id`
      : 'One row per study, with a study_id column';
    return el('div', { class: 'workspace-card' + (hasCsv ? ' workspace-card--set' : '') },
      el('div', { class: 'workspace-card__eyebrow' }, '02 — CLINICAL DATA CSV · OPTIONAL'),
      el('div', { class: 'workspace-card__value' }, hasCsv ? state.wsCsv : 'No file selected'),
      el('div', { class: 'workspace-card__meta' }, metaText),
      el('button', { class: 'workspace-card__button', onClick: onChooseCsv }, hasCsv ? 'Change…' : 'Choose CSV…'));
  }

  // Each chip's destination is a <select>, not static text. autoMap is a
  // convenience, not an authority: it cannot know that `dx_text` means
  // Diagnosis without a synonym table that would guess wrong elsewhere, so the
  // user gets the final say. Read state.wsMapping (not autoMap) so manual
  // overrides survive a re-render.
  function buildMappingCard(state) {
    const mapping = state.wsMapping;
    const chips = mapping.map((m, index) => {
      const select = el('select', {
        class: 'workspace-chip__select',
        onChange: (event) => {
          const dest = event.target.value === '' ? null : event.target.value;
          setState((s) => ({
            wsMapping: s.wsMapping.map((row, i) => (i === index ? { ...row, dest } : row)),
          }));
        },
      });
      select.append(el('option', { value: '' }, 'Unmapped'));
      for (const field of KNOWN_FIELDS) {
        // A field already claimed by another column is not offered twice.
        const takenElsewhere = mapping.some((o, i) => i !== index && o.dest === field);
        if (takenElsewhere && m.dest !== field) continue;
        select.append(el('option', { value: field }, field));
      }
      select.value = m.dest ?? '';
      return el('div', {
        class: 'workspace-chip' + (m.dest ? ' workspace-chip--mapped' : ' workspace-chip--unmapped'),
      },
        el('span', { class: 'workspace-chip__src' }, m.src),
        el('span', { class: 'workspace-chip__arrow' }, '→'),
        select);
    });
    return el('div', { class: 'workspace-card' },
      el('div', { class: 'workspace-card__eyebrow' }, '03 — COLUMN MAPPING'),
      el('div', { class: 'workspace-chip-row' }, ...chips),
      el('div', { class: 'workspace-card__note' },
        'Rows are matched to films by ',
        el('span', { class: 'workspace-card__code' }, 'study_id'),
        '. Unmatched rows are kept and flagged in the studies list.'));
  }

  function buildScreen() {
    const state = getState();
    const cards = [buildFolderCard(state), buildCsvCard(state)];
    if (state.wsCsv) cards.push(buildMappingCard(state));

    const loadDisabled = !state.wsFolder;
    const loadButton = el('button', {
      class: 'workspace-load-button',
      onClick: onLoadWorkspace,
      ...(loadDisabled ? { disabled: '' } : {}),
    }, 'Load workspace');

    return el('div', { class: 'workspace-content' },
      el('h1', { class: 'workspace-heading' }, 'Workspace'),
      el('div', { class: 'workspace-copy' },
        'Point SpineContour at a folder of radiographs and, optionally, a CSV of clinical data. Nothing is uploaded — files are read from disk on this workstation.'),
      el('div', { class: 'workspace-cards' }, ...cards),
      el('div', { class: 'workspace-load-row' },
        loadButton,
        el('div', { class: 'workspace-load-hint' },
          loadDisabled ? 'Choose an image folder to continue.' : 'Segmentation queues automatically for new films.')));
  }

  refresh();
}
```

- [ ] **Step 2: MANUAL VERIFICATION**

Prepare a real test folder before starting: a folder containing at least 3 image files with supported extensions (mix of case, e.g. `a.dcm`, `b.PNG`, `c.jpg`), 2 files with unsupported extensions (e.g. `notes.txt`, `readme.md`), and a subfolder containing one more supported image. Also prepare a small CSV file, e.g.:

```
study_id,age_yrs,sex,tx_plan
a,58,F,Fusion
b,61,M,Observation
zzz-no-match,70,F,Fusion
```
(`a`/`b` should match the stems of two of the image files above; `zzz-no-match` should match none.)

Run: `npm run dev`. Click **Workspace** in the sidebar (built in plan 02) to navigate to the Workspace screen.

1. Click **Choose folder…**, select the test folder.
   Expected: card 01 shows the real folder path, "N radiographs found · M unsupported files skipped" with the real counts (N = 4 including the subfolder one, M = 2), and the card's border/class switches to the "set" state.
2. Click **Choose CSV…**, select the test CSV.
   Expected: card 02 shows the real CSV path and "3 rows · 4 columns · matched on study_id". Card 03 ("03 — COLUMN MAPPING") appears with 4 chips, each ending in a dropdown: `study_id → [Unmapped]` (muted), `age_yrs → [Age]`, `sex → [Sex]`, `tx_plan → [Unmapped]` (muted).

   Then verify the override works, which is the whole point of the dropdown:

   a. Open the dropdown on the `tx_plan` chip.
      Expected: it lists `Unmapped` plus every field in `KNOWN_FIELDS` **except** `Age` and `Sex`, which the other two chips have already claimed.
   b. Select `Treatment plan`.
      Expected: the chip switches from the muted "unmapped" styling to the mapped styling and now reads `tx_plan → [Treatment plan]`.
   c. Open the `age_yrs` dropdown.
      Expected: `Treatment plan` is no longer offered, because `tx_plan` now holds it.
   d. Set `tx_plan` back to `Unmapped`, then re-open `age_yrs`.
      Expected: `Treatment plan` is offered again.
   e. Click **Choose CSV…** and pick the same file again.
      Expected: the mapping resets to `autoMap`'s output — a fresh file means fresh defaults, and manual overrides do not leak across loads.
3. Click **Load workspace**.
   Expected: navigates to the Studies screen; a toast reads `Workspace loaded — 4 studies · clinical data linked (2 matched, 1 unmatched)`; the 4 new studies appear in the list with status **Processing** (since `measurements` is `null`) and lordosis `—`.
4. Quit and relaunch the app (`npm run dev` again).
   Expected: the same 4 studies are still listed (persisted via `saveStudies`/`loadStudies` from plan 05), and the two that had matching CSV rows carry their `Age`/`Sex` clinical values (verify by opening one on the Analysis screen once Task 6 is done, or by inspecting `studies.json` under the app's `userData` folder directly).

- [ ] **Step 3: Commit**

```bash
git add renderer/screens/workspace.js
git commit -m "feat: build the Workspace screen with real folder scan and CSV mapping"
```

---

### Task 5: Clinical data drawer component

**Files:**
- Create: `renderer/components/clinical-data.js`

**Interfaces:**
- Consumes: `el`, `clear`, `mount` from `renderer/dom.js`; `getState`, `setState` from `renderer/store.js`; `saveStudies` from `renderer/api.js`; `KNOWN_FIELDS` from `renderer/data/csv.js`.
- Produces: `ClinicalData() → HTMLElement` — a self-contained, self-updating `<section>` factory, consumed by Task 6 (mounted into `renderer/screens/analysis.js`).

Scope for this plan is exactly one visible study — the study open on the Analysis screen (`state.openId`). Comparison mode (a second visible study) is plan 07's job; this component only ever renders one data row.

- [ ] **Step 1: Implement `renderer/components/clinical-data.js`**

Create `renderer/components/clinical-data.js`:

```js
import { el, clear, mount } from '../dom.js';
import { getState, setState } from '../store.js';
import { saveStudies } from '../api.js';
import { KNOWN_FIELDS } from '../data/csv.js';

export function ClinicalData() {
  const section = el('section', { class: 'clinical-data' });

  function refresh() {
    clear(section);
    mount(section, buildDrawer());
  }

  function currentStudy() {
    const state = getState();
    return state.studies.find((s) => s.id === state.openId) || null;
  }

  function persist(studies) {
    setState({ studies });
    saveStudies(studies).catch(() => {
      setState({ toast: 'Could not save — check disk permissions.' });
    });
  }

  function addField(name) {
    const state = getState();
    if (state.fields.includes(name)) return;
    setState({ fields: [...state.fields, name] });
    refresh();
  }

  function removeField(name) {
    const state = getState();
    setState({ fields: state.fields.filter((f) => f !== name) });
    refresh();
  }

  function setValue(studyId, field, value) {
    const state = getState();
    const studies = state.studies.map((s) => {
      if (s.id !== studyId) return s;
      return { ...s, clinical: { ...s.clinical, [field]: value } };
    });
    persist(studies);
  }

  function onImportFromCsv() {
    const study = currentStudy();
    if (!study) return;
    const keys = Object.keys(study.clinical || {});
    if (keys.length === 0) {
      setState({ toast: 'No CSV data matched for this study.' });
      return;
    }
    const state = getState();
    const nextFields = [...state.fields];
    keys.forEach((key) => { if (!nextFields.includes(key)) nextFields.push(key); });
    setState({ fields: nextFields, dataOpen: true, toast: `Imported ${keys.length} field${keys.length === 1 ? '' : 's'} from CSV` });
    refresh();
  }

  function onToggleOpen() {
    setState((s) => ({ dataOpen: !s.dataOpen }));
    refresh();
  }

  function onCustomKeyDown(event, input) {
    if (event.key !== 'Enter') return;
    const value = input.value.trim();
    if (!value) return;
    addField(value);
    input.value = '';
  }

  function buildHeader(state) {
    const fieldCountLabel = state.fields.length
      ? `${state.fields.length} FIELD${state.fields.length === 1 ? '' : 'S'} · 1 STUDY`
      : 'NO FIELDS';
    return el('div', { class: 'clinical-data__header' },
      el('div', {
        class: 'clinical-data__toggle',
        onClick: onToggleOpen,
        title: 'Toggle clinical data',
      }, state.dataOpen ? '▾' : '▸'),
      el('div', { class: 'clinical-data__title' }, 'Clinical data'),
      el('div', { class: 'clinical-data__count' }, fieldCountLabel),
      el('div', { class: 'clinical-data__spacer' }),
      el('button', { class: 'clinical-data__import', onClick: onImportFromCsv }, 'Import from CSV'));
  }

  function buildFieldChips(state) {
    const available = KNOWN_FIELDS.filter((f) => !state.fields.includes(f));
    const chips = available.map((name) => el('div', {
      class: 'clinical-data__chip',
      onClick: () => addField(name),
    }, '+ ' + name));

    const customInput = el('input', {
      class: 'clinical-data__custom-input',
      placeholder: '+ Custom field…',
    });
    customInput.addEventListener('keydown', (event) => onCustomKeyDown(event, customInput));

    return el('div', { class: 'clinical-data__chip-row' },
      el('div', { class: 'clinical-data__add-label' }, 'ADD FIELD'),
      ...chips,
      customInput);
  }

  function buildGrid(state, study) {
    if (state.fields.length === 0) {
      return el('div', { class: 'clinical-data__empty' },
        'No clinical fields yet — add the fields you want above, or import from the CSV.');
    }

    const headerRow = el('div', { class: 'clinical-data__grid-row clinical-data__grid-row--head' },
      el('div', { class: 'clinical-data__grid-cell clinical-data__grid-cell--study' }, 'STUDY'),
      ...state.fields.map((name) => el('div', { class: 'clinical-data__grid-cell' },
        el('span', {}, name.toUpperCase()),
        el('span', {
          class: 'clinical-data__remove',
          title: 'Remove field',
          onClick: () => removeField(name),
        }, '×'))));

    const dataRow = el('div', { class: 'clinical-data__grid-row' },
      el('div', { class: 'clinical-data__grid-cell clinical-data__grid-cell--study' }, study.id),
      ...state.fields.map((name) => {
        const input = el('input', {
          class: 'clinical-data__cell-input',
          value: (study.clinical && study.clinical[name]) || '',
          placeholder: '—',
        });
        input.addEventListener('change', (event) => setValue(study.id, name, event.target.value));
        return input;
      }));

    return el('div', { class: 'clinical-data__grid' }, headerRow, dataRow);
  }

  function buildDrawer() {
    const state = getState();
    const study = currentStudy();
    const header = buildHeader(state);
    if (!state.dataOpen || !study) return el('div', { class: 'clinical-data__wrap' }, header);

    return el('div', { class: 'clinical-data__wrap' },
      header,
      buildFieldChips(state),
      buildGrid(state, study));
  }

  refresh();
  return section;
}
```

- [ ] **Step 2: MANUAL VERIFICATION**

This component has no host yet — Task 6 mounts it. To verify it in isolation before wiring it in, run `npm run dev`, open any study on the Analysis screen so `state.openId` is set, open DevTools, and run in the console:

```js
const { ClinicalData } = await import('./renderer/components/clinical-data.js');
document.body.appendChild(ClinicalData());
```

This appends the drawer to the bottom of whatever is currently on screen — it will look out of place (no styling, no removal on navigation), which is fine, it is only there to exercise the component's logic. Then:

1. Confirm the drawer renders with header **"Clinical data"**, the count reading **"NO FIELDS"**, and the empty-state copy **"No clinical fields yet — add the fields you want above, or import from the CSV."**
2. Click two of the `+ Age`, `+ Sex`, … chips.
   Expected: they disappear from the chip row (no longer offered, since they're now active), the grid appears with one header row and one data row for the open study, count now reads **"2 FIELDS · 1 STUDY"**.
3. Type into a grid cell, click elsewhere (blur).
   Expected: no visible change other than the value staying in the input (this is the save happening silently); reopening DevTools' Application → Local storage is not relevant here — instead, quit and relaunch the app and confirm the value is still there.
4. Type a new field name into `+ Custom field…` and press Enter.
   Expected: a new grid column appears for it, count updates, and the input clears.
5. Click the `×` on a field header.
   Expected: that column disappears from the grid and its chip reappears in the `ADD FIELD` row.
6. Click **Import from CSV** on a study that has no `clinical` data.
   Expected: toast reads "No CSV data matched for this study." and nothing else changes.
7. Reload the app (`Ctrl+R` in the window, or restart `npm run dev`) to clear the scratch-appended element — no files were changed for this step. Task 6 adds the real, permanent mount point.

- [ ] **Step 3: Commit**

```bash
git add renderer/components/clinical-data.js
git commit -m "feat: build the clinical data drawer component"
```

---

### Task 6: Wire the clinical data drawer into Study Analysis

**Files:**
- Modify: `renderer/screens/analysis.js` (created in plan 03)

**Interfaces:**
- Consumes: `ClinicalData()` from Task 5's `renderer/components/clinical-data.js`.
- Produces: a fully working, end-to-end workspace-to-clinical-data flow.

`renderer/screens/analysis.js` is owned by plan 03, which was implemented before this component existed, so it has no mount point for it yet. This task adds one.

- [ ] **Step 1: Read the current file**

Run: `grep -n "return el(" renderer/screens/analysis.js` and `grep -n "class.*analysis" renderer/screens/analysis.js` to find where the screen composes its root element (the outermost node the screen's `render(container)`/equivalent function builds, per the same convention used in `renderer/screens/workspace.js` above). The spec (§9.5) places the clinical data section as its own full-width `<section>` below the viewer/right-panel row, so it belongs as the **last** child of the screen's root element, sibling to (not nested inside) the viewer and the right panel.

- [ ] **Step 2: Add the import**

At the top of `renderer/screens/analysis.js`, add:

```js
import { ClinicalData } from '../components/clinical-data.js';
```

- [ ] **Step 3: Mount the drawer as the last child of the screen root**

Find the line that builds and returns (or mounts) the screen's outermost element — it will look something like this (adapt to the file's actual variable/class names, found in Step 1):

```js
return el('div', { class: 'analysis-screen' }, headerEl, bodyEl);
```

Change it to append `ClinicalData()` as an additional final child:

```js
return el('div', { class: 'analysis-screen' }, headerEl, bodyEl, ClinicalData());
```

If the screen instead does `mount(container, el(...))`, apply the same change inside that `el(...)` call. Either way, the requirement is only that `ClinicalData()` ends up rendered once, spanning the full width below the viewer/panel row, whenever the Analysis screen is showing an open study.

- [ ] **Step 4: MANUAL VERIFICATION — full end-to-end walkthrough**

Run: `npm run dev`.

1. Navigate to Workspace, choose a real folder of radiographs and a real CSV (reuse the fixtures from Task 4's verification, or create new ones), confirm the column-mapping chips in card 03 look right, then click **Load workspace**.
   Expected: lands on Studies with the new films listed as **Processing**.
2. Open one of the newly-queued studies (the kind whose filename stem matched a CSV row).
   Expected: lands on Study Analysis; scroll to the bottom — the **Clinical data** drawer is visible below the viewer/panel row, open by default (`dataOpen` starts `true`).
3. Click **Import from CSV**.
   Expected: toast reports the number of fields imported; the grid now shows a column per matched clinical field (e.g. `AGE`, `SEX`) pre-filled with the values from the CSV row that matched this study during workspace load.
4. Add one more field via an `ADD FIELD` chip (e.g. `+ Notes`), type a value into it.
5. Click the collapse chevron.
   Expected: the chip row and grid hide; header (title + count + Import button) remains visible.
6. Click the chevron again to re-expand — confirm the values from step 4 are still there.
7. Quit the app entirely and run `npm run dev` again. Navigate back to Studies, reopen the same study.
   Expected: the Clinical data drawer shows the same fields and values as before the restart — proving the round trip through `saveStudies`/`loadStudies` (plan 05) works for clinical data, not just measurements.

- [ ] **Step 5: Commit**

```bash
git add renderer/screens/analysis.js
git commit -m "feat: mount the clinical data drawer on the Study Analysis screen"
```
