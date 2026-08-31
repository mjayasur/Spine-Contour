const GENERIC_FALLBACK_MESSAGE = 'The application encountered an unexpected error.';
const BRIDGE_UNAVAILABLE_MESSAGE =
  'The application bridge is unavailable. Try restarting Spine Contour.';

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
  const marker = raw.lastIndexOf('Error: ');
  const cleaned = marker >= 0 ? raw.slice(marker + 'Error: '.length).trim() : raw.trim();
  return isDisplayableMessage(cleaned) ? cleaned : GENERIC_FALLBACK_MESSAGE;
}

function getBridge() {
  return typeof window !== 'undefined' ? window.spineContour : undefined;
}

async function invoke(channel, payload) {
  const bridge = getBridge();
  if (!bridge || typeof bridge[channel] !== 'function') {
    throw new Error(BRIDGE_UNAVAILABLE_MESSAGE);
  }
  try {
    return await bridge[channel](payload);
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

export async function openExternal(url) {
  return invoke('openExternal', url);
}
