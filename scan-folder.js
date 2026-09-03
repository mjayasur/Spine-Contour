/**
 * Recursive film discovery for the Workspace folder scan (spec 9.3). Deliberately at the repo
 * root and CommonJS: it touches node:fs, which renderer/ cannot resolve, and main.js requires
 * it (the ESM tests import its named exports from the static module.exports literal below).
 *
 * Contract: scanFolder(dirPath) → Promise<{files: string[], skipped: number}>.
 *  - The ROOT readdir is not swallowed: a missing, deleted or unreadable chosen folder rejects
 *    (ENOENT / ENOTDIR / EACCES) and the IPC handler turns that into a display-ready message.
 *    An empty folder and an unreadable folder must never look the same on the Workspace card.
 *  - Entries are sorted by name in every directory and walked depth-first, so the order — and
 *    the SP-nnnn ids the Workspace assigns in that order — does not depend on the filesystem.
 *  - Links are never followed and count as skipped. Dirent.isSymbolicLink() is true for every
 *    reparse point on Windows (symlink or junction), so this is also the cycle guard.
 *  - A NESTED readdir failure is swallowed and counts as one skipped entry.
 *  - A file with a supported extension (case-insensitive) is collected; any other entry counts
 *    as skipped.
 */
const fsPromises = require('node:fs/promises');
const path = require('node:path');

// Mirrors main.js's select-file filter (line 52) and renderer/screens/studies.js FILM_EXTENSIONS
// (line 83) so the picker, the dropzone and the folder scan accept the same files. One-item
// superset of spec 9.3: `.dicom` is included because the other two paths already accept it.
const SUPPORTED_EXTENSIONS = new Set(['.dcm', '.dicom', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp']);

// Plain code-unit comparison, never localeCompare: deterministic on every machine and locale.
function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

async function readSortedEntries(dir) {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  entries.sort(byName);
  return entries;
}

async function scanFolder(dirPath) {
  const files = [];
  let skipped = 0;

  async function walk(currentDir, entries) {
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        // Never followed — directory or file, symlink or junction. Counted so a tree that
        // sits behind a link is reported on the card instead of vanishing silently.
        skipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        let nested;
        try {
          nested = await readSortedEntries(entryPath);
        } catch (_error) {
          // A subfolder that cannot be read (permissions, removed mid-scan) is reported as
          // one skipped entry; only the root folder's failure rejects the whole scan.
          skipped += 1;
          continue;
        }
        await walk(entryPath, nested);
        continue;
      }
      if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      } else {
        skipped += 1;
      }
    }
  }

  // Outside any try/catch on purpose: the chosen folder must be readable or the scan rejects.
  const rootEntries = await readSortedEntries(dirPath);
  await walk(dirPath, rootEntries);
  return { files, skipped };
}

// Static object literal: cjs-module-lexer exposes these names to the ESM test imports.
module.exports = { scanFolder, SUPPORTED_EXTENSIONS };
