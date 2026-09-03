import { validate } from './data/persistence.js';

const GENERIC_FALLBACK_MESSAGE = 'The application encountered an unexpected error.';
const BRIDGE_UNAVAILABLE_MESSAGE =
  'The application bridge is unavailable. Try restarting Spine Contour.';
const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error): /;

function isDisplayableMessage(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === 'undefined' || trimmed === 'null') return false;
  if (/^\[object .*\]$/.test(trimmed)) return false;
  return true;
}

function cleanMessage(error) {
  if (error instanceof Error && !error.message) {
    return GENERIC_FALLBACK_MESSAGE;
  }
  const raw = error && error.message ? error.message : String(error);
  const cleaned = raw.replace(IPC_PREFIX, '').trim();
  return isDisplayableMessage(cleaned) ? cleaned : GENERIC_FALLBACK_MESSAGE;
}

function getBridge() {
  return typeof window !== 'undefined' ? window.spineContour : undefined;
}

async function invoke(channel, ...args) {
  const bridge = getBridge();
  if (!bridge || typeof bridge[channel] !== 'function') {
    throw new Error(BRIDGE_UNAVAILABLE_MESSAGE);
  }
  try {
    return await bridge[channel](...args);
  } catch (error) {
    throw new Error(cleanMessage(error));
  }
}

export async function selectFile() {
  return invoke('selectFile');
}

export async function predict(request) {
  return invoke('predict', request);
}

export async function measure(geometry) {
  return invoke('measure', geometry);
}

export async function saveCsv(request) {
  return invoke('saveCsv', request);
}

export async function openExternal(url) {
  return invoke('openExternal', url);
}

// Set once, by the bootstrap, when the store on disk could not be loaded (a newer version, a
// record with a broken identity). From then on NOTHING is written for the session -- not
// studies.json and not a prediction sidecar -- because nextId() restarts at SP-1000 over a
// library it cannot see, and a sidecar write would replace another study's film.
let disabledReason = null;

const GENERIC_DISABLE_REASON = 'the saved studies could not be read';

export function disablePersistence(reason) {
  // A falsy or non-string reason must never CLEAR an existing disable: the contract gives
  // persistence no re-enable path, and disablePersistence('') or (null) would otherwise let
  // writes resume silently. Keep whatever reason is already set; if there is none, this call
  // still disables -- asking to stop writing always stops writing.
  const clean = typeof reason === 'string' && reason.trim().length > 0 ? reason : null;
  disabledReason = clean || disabledReason || GENERIC_DISABLE_REASON;
}

// The reason persistence is off this session, or null. Callers that would otherwise report a
// rejected write can say the plain thing instead of nesting three messages.
export function persistenceDisabledReason() {
  return disabledReason;
}

function assertWritable() {
  if (disabledReason) throw new Error(`Studies are not being saved: ${disabledReason}`);
}

// One display-ready sentence about what the main process had to do to the store on disk before
// it could be read -- today, that it quarantined studies.json and its sidecars -- or null.
// Parallel to persistenceDisabledReason() and read once by the bootstrap after the first render.
let loadNotice = null;

export function storeLoadNotice() {
  return loadNotice;
}

// The raw store crosses the bridge; validation happens here so every caller receives
// Study[] with the shapes the viewer and panel read unguarded. A throw from validate is
// display-ready and deliberately NOT wrapped: it is not an IPC failure.
//
// The store's `notice` is captured BEFORE validation so it survives a throw, and a store the
// main process marked `persistenceUnsafe` (its quarantined sidecars could not be moved aside, so
// a reused SP-1000 could still overwrite one) disables persistence from right here rather than
// leaving it to the caller -- there is exactly one caller today and no way to make it the
// caller's job safely.
export async function loadStudies() {
  const raw = await invoke('loadStudies');
  const notice = raw && typeof raw === 'object' && typeof raw.notice === 'string' && raw.notice.trim()
    ? raw.notice
    : null;
  loadNotice = notice;
  if (notice && raw.persistenceUnsafe) disablePersistence(notice);
  return validate(raw);
}

export async function saveStudies(studies) {
  assertWritable();
  return invoke('saveStudies', studies);
}

export async function loadPrediction(id) {
  return invoke('loadPrediction', id);
}

export async function savePrediction(id, response) {
  assertWritable();
  return invoke('savePrediction', id, response);
}

// Uint8Array of the file's bytes, or null when the file no longer exists.
export async function readFile(filePath) {
  const bytes = await invoke('readFile', filePath);
  return bytes == null ? null : bytes;
}

// Synchronous: the absolute path of a dropped File, or null when the bridge cannot provide
// one (an unavailable webUtils, an empty path). A null path never blocks a drop.
export function pathForFile(file) {
  const bridge = getBridge();
  if (!bridge || typeof bridge.pathForFile !== 'function') return null;
  try {
    const filePath = bridge.pathForFile(file);
    return typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
  } catch (_error) {
    return null;
  }
}
