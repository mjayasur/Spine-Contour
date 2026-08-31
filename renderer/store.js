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

export function getState() {
  return Object.freeze({ ...state });
}

export function setState(patchOrFn) {
  const patch = typeof patchOrFn === 'function' ? patchOrFn(state) : patchOrFn;
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
