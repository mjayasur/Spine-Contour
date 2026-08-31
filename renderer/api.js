function cleanMessage(error) {
  const raw = error && error.message ? error.message : String(error);
  const marker = raw.lastIndexOf('Error: ');
  return marker >= 0 ? raw.slice(marker + 'Error: '.length).trim() : raw.trim();
}

async function invoke(channel, payload) {
  try {
    return await window.spineContour[channel](payload);
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
