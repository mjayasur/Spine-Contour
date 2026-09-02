const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

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
  form.append('whole_spine', request.wholeSpine ? 'true' : 'false');
  const jobId = randomUUID();
  form.append('job_id', jobId);

  let polling = true;
  const progressTask = (async () => {
    while (polling) {
      try {
        const response = await fetch(`${backendBaseUrl}/progress/${jobId}`);
        if (response.ok && !_event.sender.isDestroyed()) {
          _event.sender.send('prediction-progress', await response.json());
        }
      } catch (_error) {
        // The prediction response will provide the actionable backend error.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  let response;
  try {
    response = await fetch(`${backendBaseUrl}/predict`, { method: 'POST', body: form });
  } finally {
    polling = false;
    await progressTask;
  }
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    title: 'Spine-Contour',
    icon: APP_ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
