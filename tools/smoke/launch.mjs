// Starts the app from source for smoke runs, detached, on a SCRATCH user-data directory so
// smoke studies never land in the developer's real studies.json, and waits for the CDP port.
//
//   node tools/smoke/launch.mjs            (SPINE_CONTOUR_PYTHON must point at the venv python)
//   node tools/smoke/cdp.mjs --quit        (clean shutdown through Browser.close)
//
// Env: CDP_PORT (default 9222), SPINE_CONTOUR_USER_DATA (default <tmp>/spine-contour-smoke;
// main.js honours it from Task 5 onward), SMOKE_KEEP_PROFILE=1 to keep the scratch profile,
// SMOKE_ATTACH=1 to drive an instance that is ALREADY on the port instead of starting one.
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

// A JSON GET that returns null when NOTHING is listening, and {status, body} when something
// answered -- even if that something answered with unparseable garbage. The distinction is the
// whole point: any answer at all means the port is taken.
async function probe(endpoint) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`);
    let body = null;
    try { body = await response.json(); } catch (_parse) { body = null; }
    return { status: response.status, body };
  } catch (_error) {
    return null;
  }
}

const hasPageTarget = (list) => Array.isArray(list) && list.some((t) => t.type === 'page' && !/devtools/.test(t.url));

// A PORT BEING OPEN IS NOT EVIDENCE THAT IT IS YOUR APP -- the harness's "a process staying
// alive is not evidence of a successful launch" rule, one level up. Electron cannot bind a
// --remote-debugging-port another process already holds; it starts anyway and simply has no
// CDP endpoint. The readiness gate below would then be satisfied by the OTHER instance, this
// script would print {"ready":true} for it, and every suite would drive an app running
// different code on a different profile while reporting results that look real. That is not
// hypothetical: it cost a full verification cycle on plan 05 Task 9, where five checks
// "failed" against a stale Task 8 instance still holding 9222. So probe FIRST, and refuse.
const existing = await probe('/json/version');

if (process.env.SMOKE_ATTACH === '1') {
  if (!existing) {
    console.error(`SMOKE_ATTACH=1, but nothing is listening on CDP port ${port}. Drop SMOKE_ATTACH to start the app.`);
    process.exit(2);
  }
  if (!hasPageTarget((await probe('/json/list'))?.body)) {
    console.error(`SMOKE_ATTACH=1: port ${port} answers, but it has no page target to drive (window not up yet, or not an Electron/Chrome app).`);
    process.exit(1);
  }
  // Deliberately says ATTACHED and omits userData: this launcher did not choose that
  // instance's profile, did not wipe it, and cannot vouch for the code it is running.
  console.log(JSON.stringify({
    ready: true,
    attached: true,
    spawned: false,
    port: Number(port),
    browser: existing.body?.Browser ?? null,
    note: 'ATTACHED to an instance already on this port; launch.mjs did not start it, does not know its code revision or profile, and wiped nothing',
  }));
  process.exit(0);
}

if (existing) {
  console.error([
    `CDP port ${port} is already in use (${existing.body?.Browser ?? 'it answered but did not look like a browser'}).`,
    'Nothing was spawned and no profile was touched: an Electron started now could not bind the port,',
    'so every suite would silently drive the OTHER instance -- possibly older code on another profile.',
    'Quit it first:',
    '    node tools/smoke/cdp.mjs --quit',
    `If port ${port} stays open after that, kill the stray processes (Windows: taskkill /F /IM electron.exe)`,
    'and try again. To drive the existing instance on purpose, re-run with SMOKE_ATTACH=1.',
  ].join('\n'));
  process.exit(3);
}

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
    if (hasPageTarget(list)) {
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
