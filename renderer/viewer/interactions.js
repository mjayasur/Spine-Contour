import { clientToImage, LEVELS, CORNERS, landmarkAt, setLandmarkAt, femoralCircle, setFemoralCircle } from './geometry.js';

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.4;
export const ZOOM_STEP = 1.25;

export function clampZoom(zoom) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

// NOTE ON COORDINATES, because this looks like a missing correction and is not.
// clientToImage() derives its scale from canvas.getBoundingClientRect(), and the rect
// ALREADY reflects the CSS `transform: translate(panX, panY) scale(zoom)` that
// components/viewer.js applies to the canvases' shared host. Zoom and pan are therefore
// accounted for exactly once. Do not "fix" the hit test by subtracting panX/panY or
// dividing by zoom -- that double-counts the transform and click-to-select drifts
// further from the cursor the more you pan.

export function zoomIn(zoom) {
  return clampZoom(zoom * ZOOM_STEP);
}

export function zoomOut(zoom) {
  return clampZoom(zoom / ZOOM_STEP);
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, a, b) {
  const [px, py] = point; const [ax, ay] = a; const [bx, by] = b;
  const dx = bx - ax; const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx; const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function vertebraAt(geometry, point, radius = 20) {
  for (const level of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    if (pointInPolygon(point, geometry.vertebrae[level].quadrilateral)) return level;
  }
  const [sa, sp] = geometry.s1_superior;
  if (distanceToSegment(point, sa, sp) <= radius) return 'S1';
  return null;
}

/**
 * Wires wheel-zoom, pan-toggle-drag, and click-to-select onto a stage/canvas pair.
 * options: {
 *   getZoom(): number, getPan(): {panX,panY}, getPanMode(): boolean, getGeometry(): Geometry|null,
 *   onZoom(zoom), onPan(panX, panY), onSelect(level),
 * }
 * Returns a detach() function that removes every listener it added.
 */
export function attachViewerInteractions(stage, canvas, options) {
  function handleWheel(event) {
    event.preventDefault();
    const zoom = options.getZoom();
    options.onZoom(event.deltaY < 0 ? zoomIn(zoom) : zoomOut(zoom));
  }

  let dragStart = null;
  function handlePointerDown(event) {
    if (!options.getPanMode()) return;
    const pan = options.getPan();
    dragStart = { x: event.clientX, y: event.clientY, panX: pan.panX, panY: pan.panY };
    canvas.setPointerCapture(event.pointerId);
  }
  function handlePointerMove(event) {
    if (!dragStart) return;
    options.onPan(dragStart.panX + (event.clientX - dragStart.x), dragStart.panY + (event.clientY - dragStart.y));
  }
  function handlePointerUp(event) {
    dragStart = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function handleClick(event) {
    if (options.getPanMode()) return;
    const geometry = options.getGeometry();
    if (!geometry) return;
    const point = clientToImage(event, canvas);
    const level = vertebraAt(geometry, point);
    if (level) options.onSelect(level);
  }

  stage.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('click', handleClick);

  return function detach() {
    stage.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerUp);
    canvas.removeEventListener('click', handleClick);
  };
}

/**
 * @typedef {Object} Selection
 * @property {'landmark'|'femoral'} kind
 * @property {string} [level]   'L1'..'L5'|'S1' — present when kind === 'landmark'
 * @property {string} [corner]  'SA'|'SP'|'IA'|'IP' — present when kind === 'landmark'
 * @property {'left'|'right'} [side]   present when kind === 'femoral'
 * @property {'center'|'rim'} [part]   present when kind === 'femoral'
 */

// The 22 landmark stops in anatomical order: L1 SA,SP,IA,IP · L2 … · L5 · S1 SA,SP.
export const TAB_ORDER = [
  ...LEVELS.flatMap((level) => CORNERS.map((corner) => ({ kind: 'landmark', level, corner }))),
  { kind: 'landmark', level: 'S1', corner: 'SA' },
  { kind: 'landmark', level: 'S1', corner: 'SP' },
];

// What Tab / Shift+Tab actually cycle: the landmarks plus the two femoral-head centres. The
// heads are not landmarks, so they are not in TAB_ORDER, but the spec requires them to be
// reachable by keyboard. Rim handles are not stops of their own -- see nextSelection.
export const FULL_ORDER = [
  ...TAB_ORDER,
  { kind: 'femoral', side: 'left', part: 'center' },
  { kind: 'femoral', side: 'right', part: 'center' },
];

// Exact handle identity. The canvas uses it to decide which handle is selected or hovered,
// and the viewer uses it to skip a hover redraw when nothing changed.
export function sameHandle(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'landmark') return a.level === b.level && a.corner === b.corner;
  return a.side === b.side && a.part === b.part;
}

// Tab stops are per femoral SIDE: the rim handle is not a stop of its own, so a rim
// selection resolves to its side's centre stop for cycling purposes.
function sameStop(stop, current) {
  if (stop.kind !== current.kind) return false;
  if (stop.kind === 'landmark') return stop.level === current.level && stop.corner === current.corner;
  return stop.side === current.side;
}

export function nextSelection(current, direction) {
  const step = direction < 0 ? -1 : 1;
  const last = FULL_ORDER.length - 1;
  const index = current ? FULL_ORDER.findIndex((stop) => sameStop(stop, current)) : -1;
  if (index === -1) return step > 0 ? FULL_ORDER[0] : FULL_ORDER[last];
  return FULL_ORDER[(index + step + FULL_ORDER.length) % FULL_ORDER.length];
}

// Moves the selected handle by (dx, dy) image pixels. Mutates `geometry` -- callers hand it
// a working copy, never the store's object (see components/viewer.js).
export function nudge(geometry, selection, dx, dy) {
  if (selection.kind === 'landmark') {
    const [x, y] = landmarkAt(geometry, selection.level, selection.corner);
    setLandmarkAt(geometry, selection.level, selection.corner, [x + dx, y + dy]);
    return geometry;
  }
  const [cx, cy, r] = femoralCircle(geometry, selection.side);
  if (selection.part === 'center') {
    return setFemoralCircle(geometry, selection.side, [cx + dx, cy + dy, r]);
  }
  // The rim has one degree of freedom. Right/up grow the radius, left/down shrink it,
  // floored at 1px: the backend rejects a non-positive radius (backend/utils.py:296).
  return setFemoralCircle(geometry, selection.side, [cx, cy, Math.max(1, r + dx - dy)]);
}
