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
// reproduces the legacy renderer.js's hardcoded alpha of 58 exactly (116 * 0.5 = 58).
// That file was deleted by this plan's Task 11; the reference is historical.
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
  // Layout lives in styles/screens/analysis.css under .viewer-canvas. These used to be
  // five inline style writes pinning both canvases to width:100%/height:100%, which
  // stretched every radiograph to the stage's aspect ratio.
  staticCanvas.className = 'viewer-canvas';
  dynamicCanvas.className = 'viewer-canvas viewer-canvas-dynamic';
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
  // Clamp the plate into the canvas. An off-edge label is invisible, and the S1 overview's
  // three-parameter label used to run past the right edge of the stage and get cut mid-word.
  const x = Math.max(4, Math.min(point[0] - 4, canvas.width - width - 4));
  const y = Math.max(fontSize + 2, Math.min(point[1], canvas.height - 8));
  // Backing plate: STAGE_LABEL_FILL and STAGE_SELECTED_COLOR are both light-on-dark and
  // vanish over a bright region of a radiograph without it.
  ctx.fillStyle = LABEL_PLATE_FILL;
  ctx.fillRect(x, y - fontSize, width, fontSize + 7);
  ctx.fillStyle = STAGE_SELECTED_COLOR;
  ctx.fillText(text, x + 6, y + 2);
}

// Reference axes (horizontal, vertical, endplate normal) are drawn dashed and slightly
// faded so it is never ambiguous which line is the anatomy being measured and which is the
// datum it is measured against.
function strokeReference(ctx, from, to) {
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(...from);
  ctx.lineTo(...to);
  ctx.stroke();
  ctx.restore();
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
    } else if (selectedLevel === 'PI' || selectedLevel === 'PT' || selectedLevel === 'SS') {
      const s1 = geometry.s1_superior;
      const s1Mid = midpoint(s1[0], s1[1]);
      const hip = geometry.hip_midpoint;
      // Reference rays are drawn the same length as the S1-to-hip span so the angle reads at a
      // sensible scale on any image size.
      const span = Math.hypot(hip[0] - s1Mid[0], hip[1] - s1Mid[1]) || canvas.width / 6;

      if (selectedLevel === 'SS') {
        // Sacral slope: the S1 superior endplate against the HORIZONTAL.
        // backend: atan2(s1_vector.y, s1_vector.x)
        ctx.beginPath();
        ctx.moveTo(...s1[0]);
        ctx.lineTo(...s1[1]);
        ctx.stroke();
        // The horizontal extends OPPOSITE the endplate's own x-direction. Flipped from the
        // original on clinical review -- it reads better against the sacrum this way. The
        // reported angle is unaffected: the endplate is drawn as a full segment through
        // s1Mid, so the horizontal ray still forms the acute angle with one half of it
        // whichever side it sticks out.
        const dir = s1[1][0] >= s1[0][0] ? -1 : 1;
        strokeReference(ctx, s1Mid, [s1Mid[0] + dir * span, s1Mid[1]]);
        if (measurements.SS != null) {
          drawMeasurementLabel(ctx, canvas, `SS ${measurements.SS.toFixed(1)}\u00B0`, s1Mid);
        }
      } else if (selectedLevel === 'PT') {
        // Pelvic tilt: the hip-to-S1-midpoint line against the VERTICAL through the hip.
        // backend: atan2(s1_mid.x - hip.x, hip.y - s1_mid.y)
        ctx.beginPath();
        ctx.moveTo(...hip);
        ctx.lineTo(...s1Mid);
        ctx.stroke();
        strokeReference(ctx, hip, [hip[0], hip[1] - span]);
        if (measurements.PT != null) {
          drawMeasurementLabel(ctx, canvas, `PT ${measurements.PT.toFixed(1)}\u00B0`, midpoint(hip, s1Mid));
        }
      } else {
        // Pelvic incidence: the S1-midpoint-to-hip line against the PERPENDICULAR to the S1
        // endplate at its midpoint. backend: angle between the connection and normal_angle,
        // where normal_angle = s1_angle - pi/2, i.e. the endplate vector rotated -90deg.
        ctx.beginPath();
        ctx.moveTo(...s1Mid);
        ctx.lineTo(...hip);
        ctx.stroke();
        const vx = s1[1][0] - s1[0][0];
        const vy = s1[1][1] - s1[0][1];
        const length = Math.hypot(vx, vy) || 1;
        let normal = [vy / length, -vx / length];
        // Draw the perpendicular on the side the hip is on, so the two rays open into the angle
        // actually being reported rather than its supplement.
        if (normal[0] * (hip[0] - s1Mid[0]) + normal[1] * (hip[1] - s1Mid[1]) < 0) {
          normal = [-normal[0], -normal[1]];
        }
        strokeReference(ctx, s1Mid, [s1Mid[0] + normal[0] * span, s1Mid[1] + normal[1] * span]);
        if (measurements.PI != null) {
          drawMeasurementLabel(ctx, canvas, `PI ${measurements.PI.toFixed(1)}\u00B0`, midpoint(s1Mid, hip));
        }
      }
    } else if (selectedLevel === 'L1PA') {
      // L1 pelvic angle: the angle subtended at the hip midpoint between the L1 body
      // centroid and the S1 endplate midpoint. Two rays from the hip -- NOT an endplate
      // pair. This branch exists because falling through to the lordosis branch below drew
      // the wrong construction under the right label. See the contract's selectedLevel
      // section.
      const hip = geometry.hip_midpoint;
      const l1c = geometry.l1_center;
      const s1Mid = midpoint(geometry.s1_superior[0], geometry.s1_superior[1]);
      ctx.beginPath();
      ctx.moveTo(...hip);
      ctx.lineTo(...l1c);
      ctx.moveTo(...hip);
      ctx.lineTo(...s1Mid);
      ctx.stroke();
      if (measurements.L1PA != null) {
        drawMeasurementLabel(ctx, canvas, `L1PA ${measurements.L1PA.toFixed(1)}\u00B0`, midpoint(hip, l1c));
      }
    } else if (LEVELS.includes(selectedLevel)) {
      // Explicit branch, not a catch-all `else`. The architecture contract's selectedLevel
      // section makes this a binding rule: anything switching on selectedLevel must handle
      // non-level values explicitly rather than falling into a branch that assumes a
      // vertebra -- that exact shape is how L1PA once drew the lordosis line under its own
      // label. selectedLevel's domain also includes 'S1' | 'PI' | 'PT' | 'SS' | 'L1PA' | null,
      // all handled above; this branch is reached only for an actual vertebral level.
      const body = geometry.vertebrae?.[selectedLevel];
      const s1 = geometry.s1_superior;
      if (body) {
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
