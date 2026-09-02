let state = {
  screen: 'landing',
  ack: false,
  theme: 'light',
  navCollapsed: false,
  settingsOpen: false,

  studies: [],
  query: '',
  openId: null,
  compareId: null,

  tab: 'meas',
  selectedLevel: null,
  overlays: true,
  overlayOpacity: 50,
  zoom: 1,
  panX: 0,
  panY: 0,
  panMode: false,
  showAllLordosis: false,

  editing: false,
  selection: null,
  running: false,
  runStage: null,

  wsFolder: null,
  wsFiles: [],
  wsCsv: null,
  wsCsvHeaders: [],
  wsCsvRows: [],
  wsMapping: [],

  fields: [],
  dataOpen: true,
  toast: '',
};

const listeners = new Set();

// True only while setState is iterating listeners for the current update.
// Enforces the architecture contract's rule that subscribers must not call
// setState during notification (see setState below).
let notifying = false;

export function getState() {
  return Object.freeze({ ...state });
}

export function setState(patchOrFn) {
  if (notifying) {
    throw new Error(
      'setState() must not be called from a subscriber; the contract forbids re-entrant updates.'
    );
  }
  const patch = typeof patchOrFn === 'function' ? patchOrFn(state) : patchOrFn;
  state = { ...state, ...patch };
  notifying = true;
  try {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        // One subscriber's throw must not silence the subscribers after it. Before this
        // guard, a TypeError inside a canvas draw function stopped the router's listener
        // too, and the whole UI froze instead of one layer going blank. The re-entrancy
        // error thrown by the nested setState() above is unaffected: it is raised inside
        // the offending subscriber, which is where it belongs.
        console.error('store: subscriber threw during notification', error);
      }
    }
  } finally {
    notifying = false;
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
