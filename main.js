const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { readStudyStore, writeStudyStore, readJsonOrNull, writeJsonAtomic } = require('./store-io.js');
const { scanFolder } = require('./scan-folder.js');

// buildChannel is injected by electron-builder.preview.yml via extraMetadata.
// It is absent in development and in production builds, so both fall through
// to the plain title.
const pkg = require('./package.json');
const IS_PREVIEW = pkg.buildChannel === 'preview';
const APP_TITLE = IS_PREVIEW ? 'Spine-Contour Preview' : 'Spine-Contour';

// Development only: point a run at a scratch profile so smoke runs never write into the
// developer's real studies.json. Ignored in packaged builds. setPath throws on a directory
// that does not exist, so create it first.
if (!app.isPackaged && process.env.SPINE_CONTOUR_USER_DATA) {
  fs.mkdirSync(process.env.SPINE_CONTOUR_USER_DATA, { recursive: true });
  app.setPath('userData', process.env.SPINE_CONTOUR_USER_DATA);
}

const REAL_STUDY_ID = /^SP-\d{4,}$/;

function storePath() {
  return path.join(app.getPath('userData'), 'studies.json');
}

// Sidecar ids come from the renderer; the pattern check keeps them inside predictions/, and
// the range check keeps demo ids (SP-0030..SP-0042, which have no film) out of it.
function predictionPath(id) {
  if (typeof id !== 'string' || !REAL_STUDY_ID.test(id) || Number(id.slice(3)) < 1000) {
    throw new Error('Invalid study id.');
  }
  return path.join(app.getPath('userData'), 'predictions', `${id}.json`);
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const APP_ICON = path.join(__dirname, 'assets', 'branding', 'spinecontour-mark-dark.png');

let backendBaseUrl = null;
let backendProcess = null;
let backendStartupError = null;
let mainWindow = null;
let quitting = false;

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Radiographs', extensions: ['dcm', 'dicom', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  return {
    name: path.basename(filePath),
    data: await fsPromises.readFile(filePath),
    path: filePath,
  };
});

ipcMain.handle('predict', async (_event, request) => {
  if (!backendBaseUrl) throw new Error('The bundled backend is not ready.');
  if (!request || typeof request.name !== 'string') throw new Error('No radiograph was selected.');

  const bytes = request.data instanceof Uint8Array
    ? request.data
    : Uint8Array.from(request.data?.data || request.data || []);
  if (bytes.byteLength === 0) throw new Error('The selected file is empty.');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error('The selected file exceeds 50 MB.');

  const form = new FormData();
  form.append('file', new Blob([bytes]), request.name);
  form.append('modality', request.modality);
  form.append('body_part', request.bodyPart);
  form.append('view', request.view);

  const response = await fetch(`${backendBaseUrl}/predict`, { method: 'POST', body: form });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Segmentation failed with status ${response.status}.`);
  }
  return response.json();
});

ipcMain.handle('measure', async (_event, geometry) => {
  if (!backendBaseUrl) throw new Error('The bundled backend is not ready.');
  const response = await fetch(`${backendBaseUrl}/measure`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(geometry),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Measurement update failed with status ${response.status}.`);
  }
  return response.json();
});

ipcMain.handle('open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('Only http or https URLs can be opened externally.');
  }
  await shell.openExternal(url);
});

ipcMain.handle('save-csv', async (_event, request) => {
  if (!request || typeof request.text !== 'string') throw new Error('Nothing to export.');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export measurements',
    defaultPath: request.suggestedName || 'spine-contour-export.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  // Cancelling is a normal outcome, not an error: resolve null and let the renderer stay quiet.
  if (result.canceled || !result.filePath) return null;
  await fsPromises.writeFile(result.filePath, request.text, 'utf8');
  return result.filePath;
});

// A quarantined studies.json must take its sidecars with it (plan 05 final review). Left behind,
// predictions/ is a set of orphans the fresh store cannot see: nextId() restarts at SP-1000 and
// the first completed run's savePrediction writes over the previous library's film and overlay,
// irreversibly. Moving both aside under ONE timestamp makes the pair a single recoverable unit
// and leaves nothing a reused id can clobber, so persistence stays on.
//
// The notices below are display-ready: renderer/api.js hands them to showToast verbatim, so they
// name the two files and nothing else about the profile.
function quarantineNotice(storeFile, sidecarDir) {
  return `Your saved studies could not be read and were moved aside as ${storeFile} (with ${sidecarDir}). `
    + 'Spine-Contour is running on the demo studies. To recover, quit and rename both back.';
}

function sidecarMoveFailedNotice(storeFile) {
  return `Your saved studies could not be read and were moved aside as ${storeFile}, but the saved `
    + 'segmentation images could not be moved with them. Nothing is being saved this session, so none '
    + 'of them can be overwritten. Quit and move the predictions folder aside to recover.';
}

ipcMain.handle('load-studies', async () => {
  const store = await readStudyStore(storePath());
  if (!store.quarantined) return { ...store, notice: null };

  // Share the store's own timestamp so the two names pair up on sight.
  const stamp = /\.corrupt-(\d+)$/.exec(store.quarantined);
  const sidecarDir = `predictions.corrupt-${stamp ? stamp[1] : Date.now()}`;
  const root = app.getPath('userData');
  try {
    await fsPromises.rename(path.join(root, 'predictions'), path.join(root, sidecarDir));
  } catch (error) {
    // A fresh profile has no predictions/ at all. That is the normal case, not a failure.
    if (error.code !== 'ENOENT') {
      return { ...store, notice: sidecarMoveFailedNotice(store.quarantined), persistenceUnsafe: true };
    }
  }
  return { ...store, notice: quarantineNotice(store.quarantined, sidecarDir) };
});

ipcMain.handle('save-studies', async (_event, studies) => {
  if (!Array.isArray(studies)) throw new Error('Nothing to save.');
  await writeStudyStore(storePath(), studies);
});

ipcMain.handle('load-prediction', (_event, id) => readJsonOrNull(predictionPath(id)));

ipcMain.handle('save-prediction', async (_event, id, response) => {
  if (!response || typeof response !== 'object') throw new Error('Nothing to save.');
  await writeJsonAtomic(predictionPath(id), response);
});

// Removing a sidecar that is already gone is the outcome the caller wanted, not an error:
// a study that never completed a run has no sidecar, and neither does one whose run failed
// to write it. predictionPath validates the id, so nothing outside predictions/ is reachable.
ipcMain.handle('delete-prediction', async (_event, id) => {
  // ABOVE the try: predictionPath's `Invalid study id.` is already display-ready and must keep
  // propagating unchanged. Only the unlink itself is mapped below -- on Windows a held handle
  // (an antivirus scan, a synced profile, a read-only file) raises EPERM/EBUSY, and re-throwing
  // it puts an errno string and an absolute path containing the user's account name in a toast.
  const file = predictionPath(id);
  try {
    await fsPromises.unlink(file);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error('The file is locked or the folder is not writable. Close anything that may be using it, then try again.');
  }
});

// The film bytes for a persisted study. Resolves null when the file is gone — that is an
// outcome the renderer handles (relocate), not an error. Other failures throw.
ipcMain.handle('read-file', async (_event, filePath) => {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  if (!fs.existsSync(filePath)) return null;
  const stat = await fsPromises.stat(filePath);
  if (stat.size > MAX_UPLOAD_BYTES) throw new Error('The file exceeds 50 MB.');
  return fsPromises.readFile(filePath);
});

// Workspace pickers and readers (plan 06). Local filesystem and native dialogs only: none of
// these touch backendBaseUrl or fetch, so nothing leaves the machine. Both pickers are parented
// on mainWindow so they are modal, like save-csv above; cancelling resolves null, which the
// renderer treats as "nothing happened", never as an error. Every throw below is display-ready:
// renderer/api.js strips the IPC prefix and the Workspace hands the message to a toast verbatim.
ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// scanFolder's success shape is {files, skipped} with no error field, so a folder that cannot
// be read REJECTS rather than reporting an empty folder: "0 radiographs found" must never
// describe a permissions failure or a drive that went away between the pick and the scan.
// scan-folder.js lets its root readdir propagate for exactly this reason.
ipcMain.handle('scan-folder', async (_event, dirPath) => {
  if (typeof dirPath !== 'string' || !dirPath) throw new Error('No folder was selected.');
  if (!fs.existsSync(dirPath)) throw new Error('The folder was not found.');
  try {
    return await scanFolder(dirPath);
  } catch {
    throw new Error('The folder could not be read. Check that you still have permission to open it.');
  }
});

ipcMain.handle('choose-csv', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'CSV files', extensions: ['csv'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Mirrors read-file above (existence, the 50 MB cap, then the read), except that a missing CSV
// is an error here: the contract gives readCsv no null outcome and there is no relocate flow
// for a CSV -- the user simply picks it again. A raw ENOENT/EACCES string is not display-ready,
// so stat and read are both mapped.
ipcMain.handle('read-csv', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) throw new Error('No CSV file was selected.');
  if (!fs.existsSync(filePath)) throw new Error('The CSV file was not found.');
  let stat;
  try {
    stat = await fsPromises.stat(filePath);
  } catch {
    throw new Error('The CSV file could not be read. Check that you still have permission to open it.');
  }
  if (stat.size > MAX_UPLOAD_BYTES) throw new Error('The CSV file exceeds 50 MB.');
  try {
    return await fsPromises.readFile(filePath, 'utf8');
  } catch {
    throw new Error('The CSV file could not be read. Check that you still have permission to open it.');
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    title: APP_TITLE,
    icon: APP_ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The BrowserWindow `title` option is only the initial title: once the
  // renderer loads index.html, Chromium replaces it with that document's
  // <title>. Suppressing the event keeps APP_TITLE authoritative, which is
  // what distinguishes the preview window from the production one. This means
  // setting document.title later will silently do nothing: later plans that
  // need to change the window title must call mainWindow.setTitle() instead.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html')).catch((error) => {
    dialog.showErrorBox('Could not load Spine-Contour', error.message);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function developmentPython() {
  if (process.env.SPINE_CONTOUR_PYTHON) return process.env.SPINE_CONTOUR_PYTHON;
  const candidates = process.platform === 'win32'
    ? [path.join(__dirname, '.venv', 'Scripts', 'python.exe')]
    : [path.join(__dirname, '.venv', 'bin', 'python')];
  const localPython = candidates.find((candidate) => fs.existsSync(candidate));
  return localPython || (process.platform === 'win32' ? 'python' : 'python3');
}

function backendLaunch(port) {
  const binaryName = process.platform === 'win32' ? 'spine-contour-backend.exe' : 'spine-contour-backend';
  const bundledBinary = path.join(process.resourcesPath, 'backend-runtime', binaryName);
  if (app.isPackaged && fs.existsSync(bundledBinary)) {
    return {
      command: bundledBinary,
      args: ['--host', '127.0.0.1', '--port', String(port)],
      cwd: path.dirname(bundledBinary),
    };
  }
  return {
    command: developmentPython(),
    args: ['-m', 'uvicorn', 'backend.server:app', '--host', '127.0.0.1', '--port', String(port)],
    cwd: __dirname,
  };
}

async function waitForBackend() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (backendStartupError) throw backendStartupError;
    if (backendProcess?.exitCode !== null) {
      throw new Error(`The bundled backend exited with code ${backendProcess.exitCode}.`);
    }
    try {
      const response = await fetch(`${backendBaseUrl}/health`);
      if (response.ok) return;
    } catch (_error) {
      // The process is still importing its dependencies.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The bundled backend did not start within 120 seconds.');
}

async function startBackend() {
  const port = await getFreePort();
  backendBaseUrl = `http://127.0.0.1:${port}`;
  const launch = backendLaunch(port);
  backendProcess = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProcess.once('error', (error) => {
    backendStartupError = error;
  });
  backendProcess.stdout.on('data', (chunk) => console.log(`[backend] ${chunk.toString().trimEnd()}`));
  backendProcess.stderr.on('data', (chunk) => console.error(`[backend] ${chunk.toString().trimEnd()}`));
  backendProcess.once('exit', (code) => {
    if (!quitting && mainWindow) {
      dialog.showErrorBox('Spine-Contour backend stopped', `The bundled backend exited with code ${code}.`);
    }
  });
  await waitForBackend();
}

function stopBackend() {
  if (backendProcess && backendProcess.exitCode === null) backendProcess.kill();
  backendProcess = null;
  backendBaseUrl = null;
}

app.whenReady().then(async () => {
  try {
    if (process.platform === 'darwin') app.dock.setIcon(APP_ICON);
    await startBackend();
    createWindow();
  } catch (error) {
    dialog.showErrorBox(
      'Could not start Spine-Contour',
      `${error.message}\n\nRun the cross-platform setup script and try again.`,
    );
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && backendBaseUrl) createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
  stopBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
