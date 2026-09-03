// Small CDP client for driving the running Electron renderer with TRUSTED input events.
// Synthetic DOM PointerEvents cannot be used for the viewer's drags: setPointerCapture()
// rejects a pointerId that no real pointer owns. Input.dispatchMouseEvent produces real ones.
import fs from 'node:fs';

const KEYS = {
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Enter: { code: 'Enter', vk: 13 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
};
const MODIFIER_SHIFT = 8;

async function pageTarget(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && !/devtools/.test(t.url));
  if (!page) throw new Error(`no page target on port ${port}: ${JSON.stringify(targets.map((t) => [t.type, t.url]))}`);
  return page;
}

async function openSocket(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method && listeners.has(message.method)) {
      for (const fn of listeners.get(message.method)) fn(message.params);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };
  return { ws, send, on, close: () => ws.close() };
}

// Closes the whole Electron app cleanly through the browser-level endpoint, so main.js's
// quit handlers run and the Python backend goes down with it.
export async function quitApp(port = process.env.CDP_PORT || '9222') {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await openSocket(version.webSocketDebuggerUrl);
  // The browser tears the socket down before answering, so resolve on close as well.
  const closed = new Promise((resolve) => { browser.ws.onclose = resolve; });
  await Promise.race([browser.send('Browser.close').catch(() => {}), closed]);
  browser.close();
}

export async function connect(port = process.env.CDP_PORT || '9222') {
  const page = await pageTarget(port);
  const socket = await openSocket(page.webSocketDebuggerUrl);
  const { send, on } = socket;

  // Console errors and uncaught exceptions are collected for the whole session; the
  // manual gates ask "no console errors", so the smoke scripts assert it too.
  const errors = [];
  on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`));
  on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'assert') {
      errors.push(`console.${p.type}: ${p.args.map((a) => a.description || a.value).join(' ')}`);
    }
  });
  await send('Runtime.enable');

  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page exception: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });
  const BUTTONS = { left: 1, middle: 4, right: 2 };

  async function click(x, y, button = 'left') {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button, buttons: BUTTONS[button], clickCount: 1 });
    await mouse('mouseReleased', x, y, { button, buttons: 0, clickCount: 1 });
  }

  async function drag(x0, y0, x1, y1, { button = 'left', steps = 6 } = {}) {
    await mouse('mouseMoved', x0, y0);
    await mouse('mousePressed', x0, y0, { button, buttons: BUTTONS[button], clickCount: 1 });
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      await mouse('mouseMoved', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, { button, buttons: BUTTONS[button] });
    }
    await mouse('mouseReleased', x1, y1, { button, buttons: 0, clickCount: 1 });
  }

  const move = (x, y) => mouse('mouseMoved', x, y);
  const wheel = (x, y, deltaY) => mouse('mouseWheel', x, y, { deltaX: 0, deltaY });

  async function key(name, { shift = false } = {}) {
    const spec = KEYS[name];
    if (!spec) throw new Error(`unknown key ${name}`);
    const modifiers = shift ? MODIFIER_SHIFT : 0;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: spec.code, windowsVirtualKeyCode: spec.vk, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: spec.code, windowsVirtualKeyCode: spec.vk, modifiers });
  }

  // Types into the focused element with Input.insertText, which fires the same input events a
  // keyboard does. Needed for the Studies search box.
  const typeText = (text) => send('Input.insertText', { text });

  async function screenshot(path) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  }

  // Store access through the page's own module instance (shared with the running app).
  const state = () => evaluate("import('./renderer/store.js').then((m) => m.getState())");
  const setState = (patchSource) => evaluate(`import('./renderer/store.js').then((m) => { m.setState(${patchSource}); return m.getState().screen; })`);

  // Client-space rectangle of the first element matching a selector, or null.
  const rect = (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);

  // Image-space point -> client space, using the live dynamic canvas.
  const toClient = (x, y) => evaluate(`(() => { const c = document.querySelector('.viewer-canvas-dynamic'); const r = c.getBoundingClientRect(); return { x: r.left + (${x} * r.width) / c.width, y: r.top + (${y} * r.height) / c.height }; })()`);

  const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

  return { send, on, evaluate, mouse, click, drag, move, wheel, key, typeText, screenshot, state, setState, rect, toClient, settle, errors, close: socket.close };
}
