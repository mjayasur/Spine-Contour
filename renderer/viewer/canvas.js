import { LEVELS } from './geometry.js';

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

export async function bitmapFromBase64(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

export async function loadStudyImages(predictResponse) {
  const [image, mask, femoral] = await Promise.all([
    bitmapFromBase64(predictResponse.image_png),
    bitmapFromBase64(predictResponse.mask_png),
    bitmapFromBase64(predictResponse.femoral_mask_png),
  ]);
  const scratch = document.createElement('canvas');
  scratch.width = image.width;
  scratch.height = image.height;
  const context = scratch.getContext('2d');
  context.drawImage(mask, 0, 0);
  const maskPixels = context.getImageData(0, 0, image.width, image.height).data;
  context.clearRect(0, 0, image.width, image.height);
  context.drawImage(femoral, 0, 0);
  const femoralPixels = context.getImageData(0, 0, image.width, image.height).data;
  const colorByLabel = buildLabelColorMap(predictResponse.labels);
  const overlayPixels = buildOverlayPixels(maskPixels, femoralPixels, colorByLabel, BASE_OVERLAY_ALPHA);
  context.clearRect(0, 0, image.width, image.height);
  context.putImageData(new ImageData(overlayPixels, image.width, image.height), 0, 0);
  return { image, mask, femoral, overlayCanvas: scratch, width: image.width, height: image.height };
}

export function disposeStudyImages(images) {
  if (!images) return;
  images.image.close();
  images.mask.close();
  images.femoral.close();
}

export function createLayeredCanvases(host) {
  const staticCanvas = document.createElement('canvas');
  const dynamicCanvas = document.createElement('canvas');
  for (const canvas of [staticCanvas, dynamicCanvas]) {
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }
  dynamicCanvas.style.touchAction = 'none';
  host.append(staticCanvas, dynamicCanvas);
  return {
    staticCanvas,
    dynamicCanvas,
    staticCtx: staticCanvas.getContext('2d'),
    dynamicCtx: dynamicCanvas.getContext('2d'),
  };
}

export function sizeCanvases(canvases, width, height) {
  canvases.staticCanvas.width = width;
  canvases.staticCanvas.height = height;
  canvases.dynamicCanvas.width = width;
  canvases.dynamicCanvas.height = height;
}

export function drawStaticLayer(ctx, canvas, images, opts) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!images) return;
  ctx.drawImage(images.image, 0, 0);
  if (opts.overlays && images.overlayCanvas) {
    ctx.globalAlpha = Math.max(0, Math.min(1, opts.overlayOpacity / 100));
    ctx.drawImage(images.overlayCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }
}

// The four off-theme literals the architecture contract sanctions for this file, and
// the only hardcoded colours anywhere in plan 03's JavaScript. Everything drawn as DOM
// over this canvas is styled from styles/screens/analysis.css -- see BD-3.
const STAGE_LINE_COLOR = '#38342F';
const STAGE_SELECTED_COLOR = '#D45A32';
const STAGE_LABEL_FILL = 'rgba(250,247,242,.75)';
const LABEL_PLATE_FILL = 'rgba(11,10,9,.78)';

// Canvas text cannot express font-variant-numeric: tabular-nums (the ctx.font shorthand
// has no slot for it), so every canvas-drawn label that contains a number uses Chivo
// Mono, which is monospaced and therefore tabular by construction.
const CANVAS_MONO = "'Chivo Mono', monospace";

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// Draws the level's name (L1..L5, S1) ONLY when that level is selected. Named for what
// it does: the unselected levels are identified by their outline, not by a label, so the
// stage is not covered in text.
function drawSelectedStageLabel(ctx, text, point, selected, canvasWidth) {
  if (!selected) return;
  const fontSize = Math.max(11, canvasWidth / 70);
  ctx.font = `700 ${fontSize}px ${CANVAS_MONO}`;
  ctx.fillStyle = STAGE_LABEL_FILL;
  ctx.fillText(text, point[0] + 10, point[1] - 10);
}

function drawMeasurementLabel(ctx, canvas, text, point) {
  const fontSize = Math.max(12, canvas.width / 60);
  ctx.font = `600 ${fontSize}px ${CANVAS_MONO}`;
  const width = ctx.measureText(text).width + 12;
  // Backing plate: STAGE_LABEL_FILL and STAGE_SELECTED_COLOR are both light-on-dark and
  // vanish over a bright region of a radiograph without it.
  ctx.fillStyle = LABEL_PLATE_FILL;
  ctx.fillRect(point[0] - 4, point[1] - fontSize, width, fontSize + 7);
  ctx.fillStyle = STAGE_SELECTED_COLOR;
  ctx.fillText(text, point[0] + 2, point[1] + 2);
}

function drawSelectedMeasurement(ctx, canvas, geometry, selectedLevel, measurements) {
  if (!selectedLevel || !measurements) return;
  ctx.save();
  try {
    ctx.strokeStyle = STAGE_SELECTED_COLOR;
    ctx.lineWidth = Math.max(2, canvas.width / 400);
    if (selectedLevel === 'S1') {
      const s1 = geometry.s1_superior;
      const s1Mid = midpoint(s1[0], s1[1]);
      const hip = geometry.hip_midpoint;
      ctx.beginPath();
      ctx.moveTo(...s1Mid);
      ctx.lineTo(...hip);
      ctx.stroke();
      // Guarded the same way the LL branch below is. An unguarded .toFixed() on a null
      // PI/PT/SS throws inside the render loop, which aborts the whole dynamic layer and
      // blanks every outline -- a much larger failure than one missing label.
      const { PI, PT, SS } = measurements;
      if (PI != null && PT != null && SS != null) {
        drawMeasurementLabel(
          ctx, canvas,
          `PI ${PI.toFixed(1)}\u00B0  PT ${PT.toFixed(1)}\u00B0  SS ${SS.toFixed(1)}\u00B0`,
          midpoint(s1Mid, hip),
        );
      }
    } else {
      const body = geometry.vertebrae[selectedLevel];
      const s1 = geometry.s1_superior;
      ctx.beginPath();
      ctx.moveTo(...body.superior[0]);
      ctx.lineTo(...body.superior[1]);
      ctx.moveTo(...s1[0]);
      ctx.lineTo(...s1[1]);
      ctx.stroke();
      const key = `${selectedLevel}-S1`;
      const value = measurements.LL?.[key];
      if (value != null) {
        drawMeasurementLabel(ctx, canvas, `LL ${key} ${value.toFixed(1)}\u00B0`, midpoint(body.superior[0], body.superior[1]));
      }
    }
  } finally {
    ctx.restore();
  }
}

export function drawDynamicLayer(ctx, canvas, geometry, opts) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!geometry) return;
  const selectedLevel = opts.selectedLevel ?? null;
  const lineWidth = Math.max(2, canvas.width / 600);
  ctx.lineJoin = 'round';
  for (const level of LEVELS) {
    const body = geometry.vertebrae[level];
    const selected = level === selectedLevel;
    ctx.strokeStyle = selected ? STAGE_SELECTED_COLOR : STAGE_LINE_COLOR;
    ctx.lineWidth = selected ? lineWidth * 1.6 : lineWidth;
    ctx.beginPath();
    body.quadrilateral.forEach((point, index) => (index ? ctx.lineTo(...point) : ctx.moveTo(...point)));
    ctx.closePath();
    ctx.stroke();
    drawSelectedStageLabel(ctx, level, body.quadrilateral[0], selected, canvas.width);
  }
  const selectedS1 = selectedLevel === 'S1';
  ctx.strokeStyle = selectedS1 ? STAGE_SELECTED_COLOR : STAGE_LINE_COLOR;
  ctx.lineWidth = selectedS1 ? lineWidth * 1.6 : lineWidth;
  ctx.beginPath();
  ctx.moveTo(...geometry.s1_superior[0]);
  ctx.lineTo(...geometry.s1_superior[1]);
  ctx.stroke();
  drawSelectedStageLabel(ctx, 'S1', geometry.s1_superior[0], selectedS1, canvas.width);

  ctx.strokeStyle = STAGE_LINE_COLOR;
  ctx.lineWidth = lineWidth;
  geometry.femoral_circles.forEach(([x, y, r]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.stroke();
  });

  drawSelectedMeasurement(ctx, canvas, geometry, selectedLevel, opts.measurements);
}
