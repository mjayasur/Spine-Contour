import { el } from '../dom.js';
import { getState, setState } from '../store.js';
import { measure } from '../api.js';
import { showToast } from './toast.js';
import {
  createLayeredCanvases, sizeCanvases, drawStaticLayer, drawDynamicLayer, constructionLabel,
} from '../viewer/canvas.js';
import { clientToImage, imageToClient, nearestLandmark, setLandmarkAt, femoralCircle, setFemoralCircle, fitCircle } from '../viewer/geometry.js';
import { zoomIn, zoomOut, vertebraAt, sameHandle, hitTestFemoral, nextSelection, nudge, arrowKeyDelta } from '../viewer/interactions.js';
import { createMeasureQueue } from '../viewer/measure-queue.js';

// Icons lifted verbatim from design-reference/template.html's Study Analysis toolbar.
// Same inline-SVG-through-innerHTML pattern plan 02 uses in components/sidebar.js and
// screens/landing.js. They replace the placeholder glyphs an earlier draft used, which
// also made every tooltip read as the glyph itself.
const SVG_OPEN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const ICONS = {
  zoomOut: `${SVG_OPEN}<circle cx="11" cy="11" r="7"></circle><path d="M8 11 H14"></path><path d="M16.5 16.5 L21 21"></path></svg>`,
  zoomIn: `${SVG_OPEN}<circle cx="11" cy="11" r="7"></circle><path d="M8 11 H14"></path><path d="M11 8 V14"></path><path d="M16.5 16.5 L21 21"></path></svg>`,
  fit: `${SVG_OPEN}<path d="M9 4 H5 V8"></path><path d="M15 4 H19 V8"></path><path d="M9 20 H5 V16"></path><path d="M15 20 H19 V16"></path></svg>`,
  pan: `${SVG_OPEN}<path d="M12 3 V21"></path><path d="M3 12 H21"></path><path d="M9.5 5.5 L12 3 L14.5 5.5"></path><path d="M9.5 18.5 L12 21 L14.5 18.5"></path><path d="M5.5 9.5 L3 12 L5.5 14.5"></path><path d="M18.5 9.5 L21 12 L18.5 14.5"></path></svg>`,
  overlays: `${SVG_OPEN}<path d="M12 3 L21 8 L12 13 L3 8 Z"></path><path d="M3 14 L12 19 L21 14"></path></svg>`,
  edit: `${SVG_OPEN}<path d="M12 20 H21"></path><path d="M16.5 3.5 a2.1 2.1 0 0 1 3 3 L7 19 L3 20 L4 16 Z"></path></svg>`,
  rerun: `${SVG_OPEN}<path d="M21 4 V10 H15"></path><path d="M3 20 V14 H9"></path><path d="M20.5 9.5 A8 8 0 0 0 5.6 6.6 L3 9"></path><path d="M3.5 14.5 A8 8 0 0 0 18.4 17.4 L21 15"></path></svg>`,
};

const MEASURE_DEBOUNCE_MS = 150;

// ---------------------------------------------------------------------------
// Transient interaction state. Module scope, NOT the store, per the architecture
// contract's viewer/interactions.js section: only committed geometry reaches the store.
//
// One `drag` for every kind of gesture -- pan, landmark handle, femoral handle -- so two
// gestures can never be live at once and there is one place to look for what the pointer
// is doing. Plan 03 kept the pan drag in a closure inside interactions.js; it moved here so
// plan 04's handle drag would not become a second copy. detach() resets all of it.
let drag = null;           // {kind:'pan', pointerId, clientX, clientY, panX, panY} | {kind:'handle', ...} | {kind:'label', ...} | null
let suppressClick = false; // a pointerdown that started a gesture eats the click that follows it
let hover = null;          // Selection | null -- the handle under the pointer
let retracing = false;
let tracePoints = [];      // [x, y][] in image space

// Where the user has dragged each construction's label, in image pixels, for the open study.
let labelOffsets = new Map(); // construction key ('L3', 'PI', ...) -> {dx, dy}
let labelStudyId = null;

const measureQueue = createMeasureQueue({ measure, getState, setState, showToast, debounceMs: MEASURE_DEBOUNCE_MS });
const { commitGeometry } = measureQueue;

// ---------------------------------------------------------------------------
// The raw /predict output per study: the target of RESET TO PREDICTION. Kept off the Study
// record (plan 05 persists and validates that record) and keyed by id, so a reset always
// returns to THIS study's own prediction, however many studies were opened in between.
const predictions = new Map();

export function recordPrediction(studyId, { measurements, geometry }, measuredGeometry = geometry) {
  const snapshot = { measurements: structuredClone(measurements), geometry: structuredClone(geometry) };
  predictions.set(studyId, snapshot);
  // A correction still pending or in flight belongs to the geometry this prediction just
  // replaced; only THIS study's is dropped. `measuredGeometry` is the geometry the study's
  // CURRENT measurements describe. It is the prediction's own for a fresh run; for a corrected
  // study restored from disk it is the stored geometry, so a failed /measure restores the
  // correction, never the prediction.
  measureQueue.replaceMeasured(studyId, measuredGeometry);
}

// Real <button>s, not <div>s: the toolbar has to be keyboard-reachable and
// screen-reader-nameable, and `title` has to be a sentence rather than the icon.
function toolButton(label, icon, onClick, props = {}) {
  return el('button', {
    type: 'button',
    class: 'viewer-tool',
    title: label,
    'aria-label': label,
    onClick,
    innerHTML: icon,
    ...props,
  });
}

// Text variant for the edit bar. Chivo Mono eyebrow, same 30px row as the icons.
function textButton(label, onClick, props = {}) {
  return el('button', { type: 'button', class: 'viewer-tool viewer-tool-text', onClick, ...props }, label);
}

function footerText(study) {
  // `study.pt` is the demo-set PATIENT label. It is not the PT pelvic-tilt measurement,
  // which lives at study.measurements.PT. Do not "fix" this to a number.
  const patient = study.pt ?? '\u2014';
  const sex = study.sex ?? '\u2014';
  const age = study.age ?? '\u2014';
  return `${study.id} \u00B7 ${patient} \u00B7 ${sex} \u00B7 ${age} \u2014 NOT FOR CLINICAL USE`;
}

// Redraw gating compares by REFERENCE, not by JSON.stringify: the dynamic key contains
// study.geometry, and stringifying a full geometry object on every pointermove frame is
// exactly the per-frame cost the layered design exists to avoid. Reference equality holds
// because nothing mutates the store's geometry in place: /predict and /measure replace it
// wholesale, and every edit in this file works on a structuredClone and commits that clone
// as a new reference (see handlePointerUp, handleKeyDown, applyFit, resetToPrediction).
function sameKey(a, b) {
  return a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);
}

function currentStudy() {
  const state = getState();
  return state.studies.find((s) => s.id === state.openId) ?? null;
}

export function mountViewer(container) {
  const stage = el('div', { class: 'viewer-stage' });
  const host = el('div', { class: 'viewer-host' });
  const { staticCanvas, dynamicCanvas, staticCtx, dynamicCtx } = createLayeredCanvases(host);
  // createLayeredCanvases already appended both canvases to `host`. Do not append again.

  // The selected construction's label is a DOM chip INSIDE the transformed host, so the
  // host's own translate/scale pans and zooms it with the film, it may sit in the black
  // space around the film, and it drags by itself. Positioned in host coordinates at zoom 1.
  const labelChip = el('div', { class: 'viewer-label is-hidden', 'aria-hidden': 'true' });
  host.append(labelChip);

  const chipId = el('div', { class: 'viewer-chip-id' });
  const chip = el('div', { class: 'viewer-chip' }, chipId);

  const zoomLabel = el('div', { class: 'viewer-zoom' }, '100%');
  const panButton = toolButton('Pan', ICONS.pan, () => setState((s) => ({ panMode: !s.panMode })), { 'aria-pressed': 'false' });
  const overlayButton = toolButton('Toggle segmentation overlay', ICONS.overlays, () => setState((s) => ({ overlays: !s.overlays })), { 'aria-pressed': 'false' });
  const editButton = toolButton('Edit landmarks', ICONS.edit, () => {
    if (getState().editing) exitEditMode();
    else setState({ editing: true });
  }, { 'aria-pressed': 'false', disabled: true });
  let runHandler = null;
  const rerunButton = toolButton('Re-run segmentation', ICONS.rerun, () => { if (runHandler) runHandler(); }, { disabled: true });
  const fillSlider = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    value: String(getState().overlayOpacity),
    class: 'viewer-fill-slider',
    'aria-label': 'Segmentation overlay opacity',
    onInput: (e) => setState({ overlayOpacity: Number(e.target.value) }),
  });

  const toolbar = el('div', { class: 'viewer-toolbar' },
    toolButton('Zoom out', ICONS.zoomOut, () => setState((s) => ({ zoom: zoomOut(s.zoom) }))),
    zoomLabel,
    toolButton('Zoom in', ICONS.zoomIn, () => setState((s) => ({ zoom: zoomIn(s.zoom) }))),
    toolButton('Fit to view', ICONS.fit, () => setState({ zoom: 1, panX: 0, panY: 0 })),
    el('div', { class: 'viewer-divider' }),
    panButton,
    overlayButton,
    el('div', { class: 'viewer-divider' }),
    el('div', { class: 'viewer-fill' },
      el('div', { class: 'viewer-fill-label' }, 'FILL'),
      fillSlider),
    el('div', { class: 'viewer-divider' }),
    editButton,
    rerunButton);

  // Shown only while editing: RETRACE, FIT and RESET TO PREDICTION alongside DONE.
  const retraceButton = textButton('RETRACE', () => toggleRetrace(), { 'aria-pressed': 'false', disabled: true });
  const fitButton = textButton('FIT', () => applyFit(), { disabled: true });
  const resetButton = textButton('RESET TO PREDICTION', () => resetToPrediction(), { disabled: true });
  const doneButton = textButton('DONE', () => exitEditMode());
  const editBar = el('div', { class: 'viewer-editbar is-hidden' },
    el('div', { class: 'viewer-editbar-label' }, 'EDITING LANDMARKS'),
    retraceButton,
    fitButton,
    resetButton,
    doneButton);

  const footer = el('div', { class: 'viewer-footer' });

  // Indeterminate ring plus one static description. It conveys "working" and nothing
  // more: /predict has no progress channel, so there is no stage to name and no
  // percentage to report. See BD-4 -- do not add a stage timer here.
  const runEyebrow = el('div', { class: 'run-eyebrow' });
  const runTitle = el('div', { class: 'run-title' });
  const runBody = el('div', { class: 'run-body' });
  const runSpinner = el('div', { class: 'run-spinner is-hidden' });
  const runButton = el('button', { type: 'button', class: 'run-button' }, 'Run segmentation');
  const runCard = el('div', { class: 'run-card is-hidden' },
    el('div', { class: 'run-card-inner' }, runEyebrow, runTitle, runBody, runSpinner, runButton));

  stage.append(host, chip, toolbar, editBar, footer, runCard);
  container.append(stage);

  let currentImages = null;
  let lastStatic = null;
  let lastDynamic = null;

  // 'loading' | 'missing' | null -- what this mount knows about the film for the open study.
  // A study restored from disk has numbers before it has bitmaps; screens/analysis.js drives
  // this while it reads the prediction sidecar. Closure state, not the store: it describes
  // this mount's progress, not the Study record, and plan 05 persists that record.
  let filmStatus = null;

  // Image pixels per CSS pixel at the current fit and zoom. Read from layout, so it is
  // right after a zoom, a resize or a sidebar collapse without anything having to say so.
  function pixelRatio() {
    const rect = dynamicCanvas.getBoundingClientRect();
    return rect.width > 0 ? dynamicCanvas.width / rect.width : 1;
  }

  // The geometry the stage should show right now: a live drag's working copy, else the store's.
  function liveGeometry() {
    if (drag && drag.kind === 'handle') return drag.geometry;
    const study = currentStudy();
    return study ? study.geometry : null;
  }

  // The ONE place the dynamic layer is drawn from. Store-driven redraws reach it through
  // updateViewer's reference-keyed gate; per-frame drag and hover redraws call it directly
  // with the working geometry. Both compose the same options, so there is exactly one
  // notion of what the dynamic layer shows.
  function redrawDynamic(geometry) {
    // Geometry is in the FILM's pixel space, and without the film there is nothing to draw it
    // on -- the canvases keep their default 300x150 until setImages sizes them, so painting
    // here would scatter image-space lines across a stub. A study restored from disk has its
    // geometry before its bitmaps, so this is the ordinary path, not an edge case.
    if (!currentImages) {
      dynamicCtx.clearRect(0, 0, dynamicCanvas.width, dynamicCanvas.height);
      labelChip.classList.add('is-hidden');
      return;
    }
    const state = getState();
    const study = currentStudy();
    drawDynamicLayer(dynamicCtx, dynamicCanvas, geometry, {
      selectedLevel: state.selectedLevel,
      measurements: study ? study.measurements : null,
      editing: state.editing,
      selection: state.selection,
      hover,
      tracePoints,
      retracing,
      pixelRatio: pixelRatio(),
    });
    placeLabel(geometry);
  }

  // Chip text sized with the film as laid out at zoom 1 (the host's scale does the rest),
  // clamped so a tiny film still reads and a huge one does not get a banner.
  function labelFontPx() {
    return Math.max(8, Math.min(13, dynamicCanvas.offsetHeight / 45));
  }

  function placeLabel(geometry) {
    const state = getState();
    const study = currentStudy();
    const label = constructionLabel(geometry, state.selectedLevel, study ? study.measurements : null);
    labelChip.classList.toggle('is-hidden', !label);
    if (!label) return;
    const offset = labelOffsets.get(state.selectedLevel) ?? { dx: 0, dy: 0 };
    // The canvas's untransformed layout box maps image px to host px at zoom 1.
    const scale = dynamicCanvas.offsetWidth / dynamicCanvas.width || 1;
    const x = dynamicCanvas.offsetLeft + (label.anchor[0] + offset.dx) * scale;
    const y = dynamicCanvas.offsetTop + (label.anchor[1] + offset.dy) * scale;
    labelChip.textContent = label.text;
    labelChip.style.fontSize = `${labelFontPx()}px`;
    labelChip.style.transform = `translate(${x}px, ${y}px) translate(${label.side < 0 ? '-100%' : '0'}, -50%)`;
  }

  // Handles and construction labels are sized in CSS pixels, so a stage resize (window,
  // sidebar collapse) changes their image-space size in every mode. drawDynamicLayer copes
  // with a null geometry, so this is safe before a study is open.
  const resizeObserver = new ResizeObserver(() => {
    redrawDynamic(liveGeometry());
  });
  resizeObserver.observe(stage);

  // Landmarks first, then femoral handles. The two sets are anatomically far apart, so the
  // order only matters in a degenerate geometry.
  function hitTestHandle(geometry, event) {
    const landmark = nearestLandmark(geometry, event.clientX, event.clientY, dynamicCanvas);
    if (landmark) return { kind: 'landmark', level: landmark.level, corner: landmark.corner };
    // hitTestFemoral is coordinate-space agnostic; feed it the circles in CLIENT space so
    // the hit radius is a constant 14 CSS pixels at any zoom, as nearestLandmark's is.
    const rect = dynamicCanvas.getBoundingClientRect();
    const scale = rect.width / dynamicCanvas.width;
    const circles = geometry.femoral_circles.map(([cx, cy, r]) => [...imageToClient([cx, cy], rect, dynamicCanvas), r * scale]);
    return hitTestFemoral(circles, event.clientX, event.clientY);
  }

  function setHover(next) {
    if (next === hover || sameHandle(hover, next)) return;
    hover = next;
    stage.classList.toggle('is-over-handle', Boolean(hover));
    redrawDynamic(liveGeometry());
  }

  function clearHover() {
    hover = null;
    stage.classList.remove('is-over-handle');
  }

  // NOTE ON COORDINATES, because this looks like a missing correction and is not.
  // clientToImage() derives its scale from canvas.getBoundingClientRect(), and the rect
  // ALREADY reflects the CSS `transform: translate(panX, panY) scale(zoom)` applied to the
  // canvases' shared host. Zoom and pan are therefore accounted for exactly once. Do not
  // "fix" a hit test by subtracting panX/panY or dividing by zoom -- that double-counts the
  // transform and every hit drifts further from the cursor the more you pan.

  function handleWheel(event) {
    event.preventDefault();
    setState((s) => ({ zoom: event.deltaY < 0 ? zoomIn(s.zoom) : zoomOut(s.zoom) }));
  }

  function startPan(event) {
    const state = getState();
    drag = { kind: 'pan', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, panX: state.panX, panY: state.panY };
    suppressClick = true;
    dynamicCanvas.setPointerCapture(event.pointerId);
  }

  // Gesture precedence: middle button pans in every mode; the primary button pans when the
  // pan toggle is on; while editing, a retrace press places a point and a handle press starts
  // a handle drag. A second pointer while a gesture is live is ignored. The construction
  // label has its own drag, on its own pointer events -- see handleLabelPointerDown below.
  function handlePointerDown(event) {
    if (drag) return;
    suppressClick = false;
    const state = getState();
    if (event.button === 1 || (event.button === 0 && state.panMode)) {
      event.preventDefault();
      startPan(event);
      return;
    }
    if (event.button !== 0) return;
    const study = currentStudy();
    if (!study || !study.geometry) return;
    if (state.editing && !state.running) {
      if (retracing) {
        event.preventDefault();
        suppressClick = true;
        tracePoints = [...tracePoints, clientToImage(event, dynamicCanvas)];
        updateEditBar(state, study);
        redrawDynamic(liveGeometry());
        return;
      }
      const hit = hitTestHandle(study.geometry, event);
      if (hit) {
        event.preventDefault();
        suppressClick = true;
        // Drag a WORKING COPY. The store's geometry is never mutated in place: the copy is
        // committed as a new reference on release, which is what this file's reference-keyed
        // redraw gate and router.js's key sets both require.
        drag = { kind: 'handle', pointerId: event.pointerId, selection: hit, geometry: structuredClone(study.geometry), studyId: study.id, moved: false };
        dynamicCanvas.setPointerCapture(event.pointerId);
        stage.classList.add('is-dragging-handle');
        setState({ selection: hit });
        return;
      }
    }
  }

  function handlePointerMove(event) {
    if (!drag) {
      const state = getState();
      if (!state.editing || retracing) return;
      const study = currentStudy();
      if (!study || !study.geometry) return;
      setHover(hitTestHandle(study.geometry, event));
      return;
    }
    if (event.pointerId !== drag.pointerId) return;
    if (drag.kind === 'pan') {
      setState({
        panX: drag.panX + (event.clientX - drag.clientX),
        panY: drag.panY + (event.clientY - drag.clientY),
      });
      return;
    }
    const point = clientToImage(event, dynamicCanvas);
    const { selection, geometry } = drag;
    if (selection.kind === 'landmark') {
      setLandmarkAt(geometry, selection.level, selection.corner, point);
    } else if (selection.part === 'center') {
      const [, , r] = femoralCircle(geometry, selection.side);
      setFemoralCircle(geometry, selection.side, [point[0], point[1], r]);
    } else {
      // Radius floored at 1px in setFemoralCircle: the backend rejects a non-positive
      // radius, and dragging the rim back through the centre must shrink smoothly, never
      // flip or go negative.
      const [cx, cy] = femoralCircle(geometry, selection.side);
      setFemoralCircle(geometry, selection.side, [cx, cy, Math.hypot(point[0] - cx, point[1] - cy)]);
    }
    drag.moved = true;
    redrawDynamic(geometry);
  }

  function handlePointerLeave() {
    if (!drag) setHover(null);
  }

  function handlePointerUp(event) {
    if (drag && event.pointerId !== drag.pointerId) return;
    if (dynamicCanvas.hasPointerCapture(event.pointerId)) dynamicCanvas.releasePointerCapture(event.pointerId);
    const ended = drag;
    drag = null;
    stage.classList.remove('is-dragging-handle');
    if (!ended || ended.kind !== 'handle') return;
    // A cancelled gesture (pen lifted out of range, window lost the pointer) discards the
    // working copy: the store still holds the pre-drag geometry, so redraw from it.
    if (event.type === 'pointercancel' || !ended.moved) {
      redrawDynamic(liveGeometry());
      return;
    }
    commitGeometry(ended.studyId, ended.geometry);
  }

  // The chip drags itself. Deltas are converted to image px through the live canvas rect so
  // the offset stays anchored to the film at any zoom; nothing is committed and no /measure
  // is scheduled. The shared `drag` keeps the canvas gestures and keyboard out while it runs.
  function handleLabelPointerDown(event) {
    if (event.button !== 0 || drag) return;
    const state = getState();
    event.preventDefault();
    const rect = dynamicCanvas.getBoundingClientRect();
    const perPx = dynamicCanvas.width / rect.width;
    const startOffset = labelOffsets.get(state.selectedLevel) ?? { dx: 0, dy: 0 };
    drag = { kind: 'label', pointerId: event.pointerId, key: state.selectedLevel, start: [event.clientX, event.clientY], startOffset, perPx };
    labelChip.setPointerCapture(event.pointerId);
    labelChip.classList.add('is-dragging');
  }

  function handleLabelPointerMove(event) {
    if (!drag || drag.kind !== 'label' || event.pointerId !== drag.pointerId) return;
    labelOffsets.set(drag.key, {
      dx: drag.startOffset.dx + (event.clientX - drag.start[0]) * drag.perPx,
      dy: drag.startOffset.dy + (event.clientY - drag.start[1]) * drag.perPx,
    });
    placeLabel(liveGeometry());
  }

  function handleLabelPointerUp(event) {
    if (!drag || drag.kind !== 'label' || event.pointerId !== drag.pointerId) return;
    if (labelChip.hasPointerCapture(event.pointerId)) labelChip.releasePointerCapture(event.pointerId);
    drag = null;
    labelChip.classList.remove('is-dragging');
  }

  labelChip.addEventListener('pointerdown', handleLabelPointerDown);
  labelChip.addEventListener('pointermove', handleLabelPointerMove);
  labelChip.addEventListener('pointerup', handleLabelPointerUp);
  labelChip.addEventListener('pointercancel', handleLabelPointerUp);

  // Coarse click-select: the vertebra under the pointer becomes the construction target.
  // A click that ended a gesture is not a selection.
  function handleClick(event) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const study = currentStudy();
    if (!study || !study.geometry) return;
    const level = vertebraAt(study.geometry, clientToImage(event, dynamicCanvas));
    // Clicking the selected vertebra again, or empty stage, clears the construction.
    const state = getState();
    const next = level && level !== state.selectedLevel ? level : null;
    if (next !== state.selectedLevel) setState({ selectedLevel: next });
  }

  // Retrace is bound to the selected femoral side (Task 14). Any selection change, and
  // every exit from edit mode, ends it.
  function cancelRetrace() {
    retracing = false;
    tracePoints = [];
  }

  // The one way out of edit mode. Clears every piece of transient edit state before the
  // store update so updateViewer sees a consistent picture.
  function exitEditMode() {
    cancelRetrace();
    clearHover();
    setState({ editing: false, selection: null });
  }

  function toggleRetrace() {
    const state = getState();
    if (!state.selection || state.selection.kind !== 'femoral') return;
    const next = !retracing;
    cancelRetrace();
    retracing = next;
    // No hover highlight while placing points. Cleared directly (not via setHover) so
    // this handler redraws exactly once.
    clearHover();
    updateEditBar(state, currentStudy());
    redrawDynamic(liveGeometry());
  }

  function applyFit() {
    const state = getState();
    const study = currentStudy();
    if (!study || !study.geometry || !state.selection || state.selection.kind !== 'femoral') return;
    const fitted = fitCircle(tracePoints);
    if (!fitted) {
      // Collinear points have no circle. Never apply a guess.
      showToast('Those points do not describe a circle. Place them along the head contour.');
      return;
    }
    const geometry = structuredClone(study.geometry);
    setFemoralCircle(geometry, state.selection.side, fitted);
    cancelRetrace();
    commitGeometry(study.id, geometry);
  }

  function resetToPrediction() {
    const study = currentStudy();
    const predicted = study ? predictions.get(study.id) : null;
    if (!predicted) return;
    cancelRetrace();
    // No /measure: the snapshot IS the prediction's own numbers. Orphan anything in flight.
    measureQueue.replaceMeasured(study.id, predicted.geometry);
    setState((current) => ({
      selection: null,
      studies: current.studies.map((item) => (item.id === study.id
        ? { ...item, measurements: structuredClone(predicted.measurements), geometry: structuredClone(predicted.geometry) }
        : item)),
    }));
  }

  // Edit-bar button states. Called from updateViewer on every notification and directly by
  // the retrace handlers; it only writes DOM, never the store.
  function updateEditBar(state, study) {
    const busy = state.running;
    const femoralSelected = Boolean(state.selection && state.selection.kind === 'femoral');
    retraceButton.disabled = busy || !femoralSelected;
    retraceButton.setAttribute('aria-pressed', String(retracing));
    retraceButton.classList.toggle('is-active', retracing);
    fitButton.disabled = busy || !retracing || tracePoints.length < 3;
    resetButton.disabled = busy || !study || !predictions.has(study.id);
    doneButton.disabled = busy;
  }

  // What the stage card shows for this study right now, or null when the film stands alone.
  // Task 9 adds the demo branch in front and keys busy-ness on the study's id.
  function describeCard(study, state, hasResult) {
    if (!hasResult || state.running) {
      const running = Boolean(state.running);
      return {
        eyebrow: running ? 'RUNNING' : 'QUEUED',
        title: running ? 'Segmenting and measuring…' : 'No segmentation yet',
        // Describes what the pipeline does; never which model is executing (BD-4).
        body: running
          ? 'Runs three models: vertebral segmentation, S1 keypoint detection, and femoral head fitting.'
          : 'This study was uploaded but has not been processed. Run segmentation to generate measurements.',
        spinner: running,
        button: { text: running ? 'Working…' : 'Run segmentation', disabled: running, title: '' },
      };
    }
    if (filmStatus === 'loading') {
      return { eyebrow: 'LOADING', title: 'Loading the film…', body: 'Reading the saved segmentation for this study.', spinner: true, button: null };
    }
    if (filmStatus === 'missing') {
      return {
        eyebrow: 'FILM UNAVAILABLE',
        title: 'The saved segmentation was not found',
        body: 'The film and overlay for this study are missing from this profile. Re-run segmentation to restore them; the measurements are unchanged.',
        spinner: false,
        button: { text: 'Re-run segmentation', disabled: Boolean(state.running), title: '' },
      };
    }
    return null;
  }

  // The ONLY writer of the card's nodes. Writes every property on every call.
  function applyCard(card) {
    runCard.classList.toggle('is-hidden', !card);
    if (!card) return;
    runEyebrow.textContent = card.eyebrow;
    runTitle.textContent = card.title;
    runBody.textContent = card.body;
    runSpinner.classList.toggle('is-hidden', !card.spinner);
    runButton.classList.toggle('is-hidden', !card.button);
    runButton.textContent = card.button ? card.button.text : '';
    runButton.disabled = card.button ? card.button.disabled : true;
    runButton.title = card.button ? card.button.title : '';
  }

  // Keyboard lives on window: the canvas is not focusable and the shortcuts must work
  // wherever focus happens to be on the Analysis screen, except inside a text control.
  // Tab and Arrow branches follow the Escape branch below.
  function handleKeyDown(event) {
    const state = getState();
    if (event.target instanceof Element && event.target.matches('input, select, textarea')) return;
    if (!state.editing) {
      // Outside edit mode Escape clears the construction -- the keyboard's way to get a
      // label plate off the stage. Inside edit mode Escape exits editing (below).
      if (event.key === 'Escape' && state.selectedLevel !== null && !drag) setState({ selectedLevel: null });
      return;
    }
    if (state.running || drag) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      exitEditMode();
      return;
    }
    if (event.key === 'Tab') {
      // Inside the edit bar, Tab stays ordinary focus movement so RETRACE / FIT / RESET /
      // DONE remain keyboard-operable once focus is there (BD-11 d).
      if (event.target instanceof Element && event.target.closest('.viewer-editbar')) return;
      event.preventDefault();
      cancelRetrace(); // retrace is bound to the selected side; a new selection ends it
      setState({ selection: nextSelection(state.selection, event.shiftKey ? -1 : 1) });
      return;
    }
    const delta = arrowKeyDelta(event.key, event.shiftKey);
    if (!delta || !state.selection) return;
    const study = currentStudy();
    if (!study || !study.geometry) return;
    event.preventDefault();
    const geometry = structuredClone(study.geometry);
    nudge(geometry, state.selection, delta.dx, delta.dy);
    commitGeometry(study.id, geometry);
  }

  stage.addEventListener('wheel', handleWheel, { passive: false });
  dynamicCanvas.addEventListener('pointerdown', handlePointerDown);
  dynamicCanvas.addEventListener('pointermove', handlePointerMove);
  dynamicCanvas.addEventListener('pointerleave', handlePointerLeave);
  dynamicCanvas.addEventListener('pointerup', handlePointerUp);
  dynamicCanvas.addEventListener('pointercancel', handlePointerUp);
  dynamicCanvas.addEventListener('click', handleClick);
  window.addEventListener('keydown', handleKeyDown);

  function detach() {
    stage.removeEventListener('wheel', handleWheel);
    dynamicCanvas.removeEventListener('pointerdown', handlePointerDown);
    dynamicCanvas.removeEventListener('pointermove', handlePointerMove);
    dynamicCanvas.removeEventListener('pointerleave', handlePointerLeave);
    dynamicCanvas.removeEventListener('pointerup', handlePointerUp);
    dynamicCanvas.removeEventListener('pointercancel', handlePointerUp);
    dynamicCanvas.removeEventListener('click', handleClick);
    window.removeEventListener('keydown', handleKeyDown);
    labelChip.removeEventListener('pointerdown', handleLabelPointerDown);
    labelChip.removeEventListener('pointermove', handleLabelPointerMove);
    labelChip.removeEventListener('pointerup', handleLabelPointerUp);
    labelChip.removeEventListener('pointercancel', handleLabelPointerUp);
    resizeObserver.disconnect();
    drag = null;
    suppressClick = false;
    hover = null;
    retracing = false;
    tracePoints = [];
    labelOffsets = new Map();
    labelStudyId = null;
  }

  function applyTransform(state) {
    // The two per-frame node writes BD-3 sanctions. Everything else below is a class.
    host.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    fillSlider.value = String(state.overlayOpacity);

    zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    stage.classList.toggle('is-pan-mode', state.panMode);
    panButton.classList.toggle('is-active', state.panMode);
    overlayButton.classList.toggle('is-active', state.overlays);
    panButton.setAttribute('aria-pressed', String(state.panMode));
    overlayButton.setAttribute('aria-pressed', String(state.overlays));
  }

  // Stores the decoded bitmaps and sizes the canvases to them. Deliberately does NOT
  // dispose the outgoing set: screens/analysis.js owns image lifetime and caches one
  // study's images across navigation, so disposing here would close bitmaps that are
  // still owned elsewhere. See BD-6.
  function setImages(images) {
    if (images === currentImages) return;
    currentImages = images;
    if (images) {
      // A film in hand ends whatever the sidecar read was reporting. The contract's sidecar
      // section says a re-run recreates a missing film; without this the FILM UNAVAILABLE card
      // and the disabled edit toggle would survive the re-run that fixed them, because a run
      // completing is not a restore and never calls setFilmStatus. restoreFilm still clears the
      // status explicitly before it gets here, so its path reads the same either way.
      filmStatus = null;
      sizeCanvases({ staticCanvas, dynamicCanvas }, images.width, images.height);
    }
    lastStatic = null;
    lastDynamic = null;
  }

  // 'loading' while the prediction sidecar is being read, 'missing' when it is not there, null
  // once the film is in hand. Repaints immediately so the card and the toolbar follow it: the
  // whole transition happens inside one mount, with no store change to ride on.
  function setFilmStatus(status) {
    filmStatus = status;
    const study = currentStudy();
    if (study) updateViewer(study);
  }

  function updateViewer(study) {
    const state = getState();
    applyTransform(state);
    if (study.id !== labelStudyId) {
      labelStudyId = study.id;
      labelOffsets = new Map();
    }
    chipId.textContent = study.id;
    footer.textContent = footerText(study);

    const hasResult = Boolean(study.measurements && study.geometry);
    applyCard(describeCard(study, state, hasResult));

    // Edit mode needs geometry to edit and must not start under a running prediction. A study
    // whose film is missing must still be able to re-run -- that is the remedy -- but must not
    // be editable until the film is back: the handles are drawn in the film's pixel space.
    editButton.disabled = !hasResult || state.running || filmStatus !== null;
    rerunButton.disabled = !hasResult || state.running || filmStatus === 'loading';
    editButton.setAttribute('aria-pressed', String(state.editing));
    editButton.classList.toggle('is-active', state.editing);
    const editLabel = state.editing ? 'Done editing' : 'Edit landmarks';
    editButton.title = editLabel;
    editButton.setAttribute('aria-label', editLabel);
    editBar.classList.toggle('is-hidden', !state.editing);
    stage.classList.toggle('is-editing', state.editing);
    updateEditBar(state, study);

    const staticKey = [state.overlays, state.overlayOpacity, currentImages];
    if (!sameKey(staticKey, lastStatic)) {
      lastStatic = staticKey;
      drawStaticLayer(staticCtx, staticCanvas, currentImages, {
        overlays: state.overlays,
        overlayOpacity: state.overlayOpacity,
      });
    }

    // editing, selection and zoom are in the key: handles appear and disappear with
    // editing, follow selection, and are sized in CSS pixels so zoom changes their image-
    // space size. panX/panY are deliberately NOT here -- a pan moves the host, not the pixels.
    const dynamicKey = [study.geometry, state.selectedLevel, study.measurements, state.editing, state.selection, state.zoom];
    if (!sameKey(dynamicKey, lastDynamic)) {
      lastDynamic = dynamicKey;
      redrawDynamic(liveGeometry());
    }
  }

  function setRunHandler(handler) {
    runHandler = handler;
    runButton.onclick = handler;
  }

  return { updateViewer, setImages, setFilmStatus, setRunHandler, detach };
}
