import { LEVELS, CORNERS, landmarkAt, femoralCircle, FEMORAL_SIDES } from './geometry.js';
import { sameHandle } from './interactions.js';

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

// The four off-theme literals the architecture contract sanctions for the stage itself;
// plan 04's edit-mode literals follow CANVAS_MONO below. Everything drawn as DOM
// over this canvas is styled from styles/screens/analysis.css -- see BD-3.
const STAGE_LINE_COLOR = '#38342F';
const STAGE_SELECTED_COLOR = '#D45A32';
const STAGE_LABEL_FILL = 'rgba(250,247,242,.75)';
const LABEL_PLATE_FILL = 'rgba(11,10,9,.78)';

// Canvas text cannot express font-variant-numeric: tabular-nums (the ctx.font shorthand
// has no slot for it), so every canvas-drawn label that contains a number uses Chivo
// Mono, which is monospaced and therefore tabular by construction.
const CANVAS_MONO = "'Chivo Mono', monospace";

// Plan 04 additions to this file's literal set. All of them are pixels drawn INTO the
// canvas, which is the exception the architecture contract grants viewer/canvas.js:
// the stage background (the contract's first literal) as the handle outline; the legacy
// editor's four per-corner colours (renderer.js:43, historical); the femoral handle colour,
// which is the overlay's own femoral green; and the retrace point colour.
const STAGE_BG_COLOR = '#0B0A09';
const CORNER_COLORS = { SA: '#32d4ff', SP: '#64e19a', IA: '#ffb259', IP: '#fa78d4' };
const FEMORAL_HANDLE_COLOR = `rgb(${FEMORAL_OVERLAY_COLOR.join(',')})`;
const TRACE_COLOR = '#ffe071';

// Handles keep a constant size ON SCREEN, unlike the outlines, which scale with the image.
// Every handle dimension below is in CSS pixels and is multiplied by opts.pixelRatio
// (image pixels per CSS pixel at the current fit and zoom) at draw time.
const HANDLE_RADIUS_PX = 5;
const HANDLE_HOVER_RADIUS_PX = 8;
const HANDLE_RING_RADIUS_PX = 10;
const HANDLE_LABEL_PX = 11;

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// Labels are sized ON SCREEN, like the handles: LABEL_PX CSS pixels through pixelRatio.
const LABEL_PX = 11;
const LABEL_GAP_PX = 8;

// Draws the level's name (L1..L5, S1) ONLY when that level is selected. Named for what
// it does: the unselected levels are identified by their outline, not by a label, so the
// stage is not covered in text.
function drawSelectedStageLabel(ctx, text, point, selected, pixelRatio) {
  if (!selected) return;
  const fontSize = LABEL_PX * pixelRatio;
  ctx.font = `700 ${fontSize}px ${CANVAS_MONO}`;
  ctx.fillStyle = STAGE_LABEL_FILL;
  ctx.fillText(text, point[0] + 6 * pixelRatio, point[1] - 6 * pixelRatio);
}

// The point just beyond an endplate's anterior corner, along the endplate, and which way a
// plate should extend from it (away from the body): +1 rightward, -1 leftward.
function beyondAnterior(sa, sp, pixelRatio) {
  const dx = sa[0] - sp[0];
  const dy = sa[1] - sp[1];
  const length = Math.hypot(dx, dy) || 1;
  const gap = LABEL_GAP_PX * pixelRatio;
  return { anchor: [sa[0] + (dx / length) * gap, sa[1] + (dy / length) * gap], side: dx >= 0 ? 1 : -1 };
}

// Draws `text` in a plate at `anchor` (image space) moved by `offset` (image space -- where
// the user dragged it), extending to `side`, kept inside the canvas. Returns the plate's rect
// in image space so the viewer can hit-test it. Backing plate: STAGE_LABEL_FILL and
// STAGE_SELECTED_COLOR are both light-on-dark and vanish over a bright region of a
// radiograph without it.
function drawMeasurementLabel(ctx, canvas, text, anchor, { pixelRatio, offset, side }) {
  const fontSize = LABEL_PX * pixelRatio;
  const pad = 4 * pixelRatio;
  ctx.font = `600 ${fontSize}px ${CANVAS_MONO}`;
  const width = ctx.measureText(text).width + 2 * pad;
  const height = fontSize + 2 * pad;
  const ax = anchor[0] + (offset ? offset.dx : 0);
  const ay = anchor[1] + (offset ? offset.dy : 0);
  const x = Math.max(0, Math.min(side < 0 ? ax - width : ax, canvas.width - width));
  const y = Math.max(0, Math.min(ay - height / 2, canvas.height - height));
  ctx.fillStyle = LABEL_PLATE_FILL;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = STAGE_SELECTED_COLOR;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x + pad, y + pad);
  ctx.textBaseline = 'alphabetic';
  return { x, y, width, height };
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

function drawSelectedMeasurement(ctx, canvas, geometry, selectedLevel, measurements, { pixelRatio, offset }) {
  if (!selectedLevel || !measurements) return null;
  let labelRect = null;
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
        labelRect = drawMeasurementLabel(
          ctx, canvas,
          `PI ${PI.toFixed(1)}\u00B0  PT ${PT.toFixed(1)}\u00B0  SS ${SS.toFixed(1)}\u00B0`,
          midpoint(s1Mid, hip),
          { pixelRatio, offset, side: 1 },
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
          const { anchor, side } = beyondAnterior(s1[0], s1[1], pixelRatio);
          labelRect = drawMeasurementLabel(ctx, canvas, `SS ${measurements.SS.toFixed(1)}\u00B0`, anchor, { pixelRatio, offset, side });
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
          labelRect = drawMeasurementLabel(ctx, canvas, `PT ${measurements.PT.toFixed(1)}\u00B0`, midpoint(hip, s1Mid), { pixelRatio, offset, side: 1 });
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
          labelRect = drawMeasurementLabel(ctx, canvas, `PI ${measurements.PI.toFixed(1)}\u00B0`, midpoint(s1Mid, hip), { pixelRatio, offset, side: 1 });
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
        labelRect = drawMeasurementLabel(ctx, canvas, `L1PA ${measurements.L1PA.toFixed(1)}\u00B0`, midpoint(hip, l1c), { pixelRatio, offset, side: 1 });
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
          const { anchor, side } = beyondAnterior(body.superior[0], body.superior[1], pixelRatio);
          labelRect = drawMeasurementLabel(ctx, canvas, `LL ${key} ${value.toFixed(1)}\u00B0`, anchor, { pixelRatio, offset, side });
        }
      }
    }
  } finally {
    ctx.restore();
  }
  return labelRect;
}

function drawHandle(ctx, canvas, point, color, { selected, hovered, label, pixelRatio }) {
  const radius = (hovered ? HANDLE_HOVER_RADIUS_PX : HANDLE_RADIUS_PX) * pixelRatio;
  if (selected) {
    ctx.beginPath();
    ctx.arc(point[0], point[1], HANDLE_RING_RADIUS_PX * pixelRatio, 0, 2 * Math.PI);
    ctx.strokeStyle = STAGE_SELECTED_COLOR;
    ctx.lineWidth = 2 * pixelRatio;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(point[0], point[1], radius, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = STAGE_BG_COLOR;
  ctx.lineWidth = pixelRatio;
  ctx.stroke();
  if (!(selected || hovered) || !label) return;
  const fontSize = HANDLE_LABEL_PX * pixelRatio;
  const pad = 4 * pixelRatio;
  ctx.font = `600 ${fontSize}px ${CANVAS_MONO}`;
  const width = ctx.measureText(label).width + 2 * pad;
  const height = fontSize + 2 * pad;
  // Keep the plate inside the canvas, as drawMeasurementLabel does.
  const x = Math.max(0, Math.min(point[0] + radius + 2 * pad, canvas.width - width));
  const y = Math.max(0, Math.min(point[1] - radius - height, canvas.height - height));
  ctx.fillStyle = LABEL_PLATE_FILL;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = STAGE_LABEL_FILL;
  ctx.textBaseline = 'top';
  ctx.fillText(label, x + pad, y + pad);
  ctx.textBaseline = 'alphabetic';
}

// 22 landmark handles (every corner of L1-L5, SA/SP of S1) and 4 femoral handles (centre
// and a rim handle at 3 o'clock per side). Order matters only for labels: a selected or
// hovered handle's label is drawn with it, so later handles can overlap it.
function drawHandles(ctx, canvas, geometry, { selection, hover, pixelRatio }) {
  const handleOpts = (handle, label) => ({
    selected: sameHandle(selection, handle),
    hovered: sameHandle(hover, handle),
    label,
    pixelRatio,
  });
  for (const level of [...LEVELS, 'S1']) {
    for (const corner of level === 'S1' ? ['SA', 'SP'] : CORNERS) {
      const handle = { kind: 'landmark', level, corner };
      drawHandle(ctx, canvas, landmarkAt(geometry, level, corner), CORNER_COLORS[corner], handleOpts(handle, `${level} ${corner}`));
    }
  }
  for (const side of FEMORAL_SIDES) {
    const [cx, cy, r] = femoralCircle(geometry, side);
    const name = side === 'left' ? 'Left head' : 'Right head';
    drawHandle(ctx, canvas, [cx, cy], FEMORAL_HANDLE_COLOR, handleOpts({ kind: 'femoral', side, part: 'center' }, name));
    drawHandle(ctx, canvas, [cx + r, cy], FEMORAL_HANDLE_COLOR, handleOpts({ kind: 'femoral', side, part: 'rim' }, `${name} \u00B7 resize`));
  }
}

function drawTracePoints(ctx, tracePoints, pixelRatio) {
  const fontSize = HANDLE_LABEL_PX * pixelRatio;
  ctx.font = `600 ${fontSize}px ${CANVAS_MONO}`;
  tracePoints.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(point[0], point[1], HANDLE_RADIUS_PX * pixelRatio, 0, 2 * Math.PI);
    ctx.fillStyle = TRACE_COLOR;
    ctx.fill();
    ctx.strokeStyle = STAGE_BG_COLOR;
    ctx.lineWidth = pixelRatio;
    ctx.stroke();
    ctx.fillStyle = STAGE_LABEL_FILL;
    ctx.fillText(String(index + 1), point[0] + 8 * pixelRatio, point[1] - 8 * pixelRatio);
  });
}

export function drawDynamicLayer(ctx, canvas, geometry, opts) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!geometry) return { labelRect: null };
  const pixelRatio = opts.pixelRatio ?? 1;
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
    drawSelectedStageLabel(ctx, level, body.quadrilateral[0], selected, pixelRatio);
  }
  const selectedS1 = selectedLevel === 'S1';
  ctx.strokeStyle = selectedS1 ? STAGE_SELECTED_COLOR : STAGE_LINE_COLOR;
  ctx.lineWidth = selectedS1 ? lineWidth * 1.6 : lineWidth;
  ctx.beginPath();
  ctx.moveTo(...geometry.s1_superior[0]);
  ctx.lineTo(...geometry.s1_superior[1]);
  ctx.stroke();
  drawSelectedStageLabel(ctx, 'S1', geometry.s1_superior[0], selectedS1, pixelRatio);

  geometry.femoral_circles.forEach(([x, y, r], index) => {
    const selectedCircle = Boolean(opts.editing) && opts.selection?.kind === 'femoral'
      && opts.selection.side === FEMORAL_SIDES[index];
    ctx.strokeStyle = selectedCircle ? STAGE_SELECTED_COLOR : STAGE_LINE_COLOR;
    ctx.lineWidth = selectedCircle ? lineWidth * 1.6 : lineWidth;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.stroke();
  });

  const labelRect = drawSelectedMeasurement(ctx, canvas, geometry, selectedLevel, opts.measurements, { pixelRatio, offset: opts.labelOffset ?? null });

  // Handles exist only in edit mode -- outside it the stage is exactly plan 03's
  // user-verified rendering -- and are drawn LAST so they sit above the construction lines.
  if (!opts.editing) return { labelRect };
  drawHandles(ctx, canvas, geometry, { selection: opts.selection ?? null, hover: opts.hover ?? null, pixelRatio });
  if (opts.retracing) drawTracePoints(ctx, opts.tracePoints ?? [], pixelRatio);
  return { labelRect };
}
