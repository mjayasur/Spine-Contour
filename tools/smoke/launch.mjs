// Starts the app from source for smoke runs, detached, on a SCRATCH user-data directory so
// smoke studies never land in the developer's real studies.json, and waits for the CDP port.
//
//   node tools/smoke/launch.mjs            (SPINE_CONTOUR_PYTHON must point at the venv python)
//   node tools/smoke/cdp.mjs --quit        (clean shutdown through Browser.close)
//
// Env: CDP_PORT (default 9222), SPINE_CONTOUR_USER_DATA (default <tmp>/spine-contour-smoke;
// main.js honours it from Task 5 onward), SMOKE_KEEP_PROFILE=1 to keep the scratch profile.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = process.env.CDP_PORT || '9222';
const userData = process.env.SPINE_CONTOUR_USER_DATA || path.join(os.tmpdir(), 'spine-contour-smoke');
const outDir = path.join(root, 'tools', 'smoke', 'out');
fs.mkdirSync(outDir, { recursive: true });
if (!process.env.SMOKE_KEEP_PROFILE) fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });

if (!process.env.SPINE_CONTOUR_PYTHON) {
  console.error('set SPINE_CONTOUR_PYTHON to the venv python first (see docs/superpowers/HANDOFF.md)');
  process.exit(2);
}

const log = fs.openSync(path.join(outDir, 'app.log'), 'w');
const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
  cwd: root,
  env: { ...process.env, SPINE_CONTOUR_USER_DATA: userData },
  detached: true,
  stdio: ['ignore', log, log],
});
child.unref();

const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  try {
    // /json/version answers as soon as the Electron browser process itself is up, which is
    // long before main.js's window exists — main.js spawns the Python backend and waits on
    // /health first. Polling /json/version alone reports "ready" while there is nothing to
    // drive over CDP yet. cdp-lib.mjs's pageTarget() is what every suite actually needs
    // satisfied: a `type: 'page'` entry from /json/list. That is the real readiness gate, so
    // check it here too, rather than "simplifying" this back to the version endpoint.
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const hasPage = Array.isArray(list) && list.some((t) => t.type === 'page' && !/devtools/.test(t.url));
    if (hasPage) {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      console.log(JSON.stringify({ ready: true, pid: child.pid, port: Number(port), userData, browser: version.Browser }));
      process.exit(0);
    }
  } catch (_error) {
    // Port not open yet, or /json/list momentarily unparseable during startup — keep polling.
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.error(`the app did not open port ${port} within 180 s; see ${path.join(outDir, 'app.log')}`);
process.exit(1);
