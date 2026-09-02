import { el } from '../dom.js';
import { getState, setState } from '../store.js';
import { measure } from '../api.js';
import { showToast } from './toast.js';
import {
  createLayeredCanvases, sizeCanvases, drawStaticLayer, drawDynamicLayer,
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
let drag = null;           // {kind:'pan', pointerId, clientX, clientY, panX, panY} | {kind:'handle', ...} | null
let suppressClick = false; // a pointerdown that started a gesture eats the click that follows it
let hover = null;          // Selection | null -- the handle under the pointer
let retracing = false;
let tracePoints = [];      // [x, y][] in image space

const measureQueue = createMeasureQueue({ measure, getState, setState, showToast, debounceMs: MEASURE_DEBOUNCE_MS });
const { commitGeometry } = measureQueue;

// ---------------------------------------------------------------------------
// The raw /predict output per study: the target of RESET TO PREDICTION. Kept off the Study
// record (plan 05 persists and validates that record) and keyed by id, so a reset always
// returns to THIS study's own prediction, however many studies were opened in between.
const predictions = new Map();

export function recordPrediction(studyId, { measurements, geometry }) {
  const snapshot = { measurements: structuredClone(measurements), geometry: structuredClone(geometry) };
  predictions.set(studyId, snapshot);
  // A correction still pending or in flight belongs to the geometry this prediction just
  // replaced; only THIS study's is dropped, and its numbers now describe the prediction.
  measureQueue.replaceMeasured(studyId, snapshot.geometry);
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
  }

  // Handle sizes are in CSS pixels, so a stage resize (window, sidebar collapse) changes
  // their image-space radius. Only edit mode draws anything size-dependent.
  const resizeObserver = new ResizeObserver(() => {
    if (getState().editing) redrawDynamic(liveGeometry());
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

  // Gesture precedence: middle button pans in every mode (spec 12); the primary button pans
  // when the toolbar's pan toggle is on; in edit mode it places a trace point while
  // retracing, else picks up a landmark or femoral handle under the pointer; otherwise the
  // click that follows does the coarse vertebra select. A second pointer while one gesture
  // is live (a second finger; the primary button pressed during a middle-drag) is ignored --
  // it would otherwise overwrite `drag` and re-capture under a different pointerId.
  function handlePointerDown(event) {
    if (drag) return;
    suppressClick = false;
    const state = getState();
    if (event.button === 1 || (event.button === 0 && state.panMode)) {
      event.preventDefault();
      startPan(event);
      return;
    }
    if (event.button !== 0 || !state.editing || state.running) return;
    const study = currentStudy();
    if (!study || !study.geometry) return;
    if (retracing) {
      event.preventDefault();
      suppressClick = true;
      tracePoints = [...tracePoints, clientToImage(event, dynamicCanvas)];
      updateEditBar(state, study);
      redrawDynamic(liveGeometry());
      return;
    }
    const hit = hitTestHandle(study.geometry, event);
    if (!hit) return; // empty stage: the click that follows still does the coarse vertebra select
    event.preventDefault();
    suppressClick = true;
    // Drag a WORKING COPY. The store's geometry is never mutated in place: the copy is
    // committed as a new reference on release, which is what this file's reference-keyed
    // redraw gate and router.js's key sets both require.
    drag = { kind: 'handle', pointerId: event.pointerId, selection: hit, geometry: structuredClone(study.geometry), studyId: study.id, moved: false };
    dynamicCanvas.setPointerCapture(event.pointerId);
    stage.classList.add('is-dragging-handle');
    setState({ selection: hit });
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

  // Keyboard lives on window: the canvas is not focusable and the shortcuts must work
  // wherever focus happens to be on the Analysis screen, except inside a text control.
  // Tab and Arrow branches follow the Escape branch below.
  function handleKeyDown(event) {
    const state = getState();
    if (event.target instanceof Element && event.target.matches('input, select, textarea')) return;
    if (!state.editing) {
      // Outside edit mode Escape clears the construction -- the keyboard's way to get a
      // label plate off the stage. Inside edit mode Escape exits editing (below).
      if (event.key === 'Escape' && state.selectedLevel !== null) setState({ selectedLevel: null });
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
    resizeObserver.disconnect();
    drag = null;
    suppressClick = false;
    hover = null;
    retracing = false;
    tracePoints = [];
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
    if (images) sizeCanvases({ staticCanvas, dynamicCanvas }, images.width, images.height);
    lastStatic = null;
    lastDynamic = null;
  }

  function updateViewer(study) {
    const state = getState();
    applyTransform(state);
    chipId.textContent = study.id;
    footer.textContent = footerText(study);

    const hasResult = Boolean(study.measurements && study.geometry);
    // Visible before the first run AND during a re-run: a study that already has a result
    // must still show that segmentation is in progress. The card is a scrim over the whole
    // stage, so it also keeps the pointer off the handles while the geometry is about to
    // be replaced.
    const showRunCard = !hasResult || state.running;
    runCard.classList.toggle('is-hidden', !showRunCard);
    if (showRunCard) {
      const running = state.running;
      runEyebrow.textContent = running ? 'RUNNING' : 'QUEUED';
      runTitle.textContent = running ? 'Segmenting and measuring\u2026' : 'No segmentation yet';
      // Describes what the pipeline does. Deliberately makes no claim about which model
      // is currently executing -- see the indeterminate-progress note above and BD-4.
      runBody.textContent = running
        ? 'Runs three models: vertebral segmentation, S1 keypoint detection, and femoral head fitting.'
        : 'This study was uploaded but has not been processed. Run segmentation to generate measurements.';
      runSpinner.classList.toggle('is-hidden', !running);
      runButton.textContent = running ? 'Working\u2026' : 'Run segmentation';
      runButton.disabled = running;
    }

    // Edit mode needs geometry to edit and must not start under a running prediction.
    editButton.disabled = !hasResult || state.running;
    rerunButton.disabled = !hasResult || state.running;
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

  return { updateViewer, setImages, setRunHandler, detach };
}
