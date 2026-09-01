export const LEVEL_RGB = {
  L1: [255, 99, 132],
  L2: [255, 159, 64],
  L3: [255, 205, 86],
  L4: [75, 192, 192],
  L5: [54, 162, 235],
};
export const FEMORAL_OVERLAY_COLOR = [98, 210, 111];
// Baked into the overlay pixel data once per prediction. The static layer scales this by
// (overlayOpacity / 100) via ctx.globalAlpha at draw time, so the default overlayOpacity of 50
// reproduces renderer.js's original hardcoded alpha of 58 exactly (116 * 0.5 = 58).
export const BASE_OVERLAY_ALPHA = 116;

export function buildLabelColorMap(labels) {
  const map = {};
  for (const level of Object.keys(LEVEL_RGB)) {
    const id = labels?.[level];
    if (typeof id === 'number') map[id] = LEVEL_RGB[level];
  }
  return map;
}

export function buildOverlayPixels(maskPixels, femoralPixels, colorByLabel, alpha) {
  const overlay = new Uint8ClampedArray(maskPixels.length);
  for (let offset = 0; offset < maskPixels.length; offset += 4) {
    const labelId = maskPixels[offset];
    const color = colorByLabel[labelId];
    if (color) {
      overlay[offset] = color[0];
      overlay[offset + 1] = color[1];
      overlay[offset + 2] = color[2];
      overlay[offset + 3] = alpha;
    } else if (femoralPixels[offset]) {
      overlay[offset] = FEMORAL_OVERLAY_COLOR[0];
      overlay[offset + 1] = FEMORAL_OVERLAY_COLOR[1];
      overlay[offset + 2] = FEMORAL_OVERLAY_COLOR[2];
      overlay[offset + 3] = alpha;
    }
  }
  return overlay;
}
