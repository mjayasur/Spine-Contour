import { el } from '../dom.js';
import { getState, setState } from '../store.js';
import {
  createLayeredCanvases, sizeCanvases, drawStaticLayer, drawDynamicLayer,
} from '../viewer/canvas.js';
import { attachViewerInteractions, zoomIn, zoomOut } from '../viewer/interactions.js';

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
};

// Real <button>s, not <div>s: the toolbar has to be keyboard-reachable and
// screen-reader-nameable, and `title` has to be a sentence rather than the icon.
function toolButton(label, icon, onClick) {
  return el('button', {
    type: 'button',
    class: 'viewer-tool',
    title: label,
    'aria-label': label,
    onClick,
    innerHTML: icon,
  });
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
// exactly the per-frame cost the layered design exists to avoid.
//
// PLAN 04, READ THIS. Reference equality is correct for plan 03 because geometry is only
// ever replaced wholesale by a /predict response. Landmark dragging must therefore
// REPLACE the geometry object (or the level within it), never mutate the existing one in
// place and re-set the same reference -- that compares equal here and the outline would
// not follow the handle. renderer/router.js:44-52 carries the same warning for its own
// key sets, for the same reason.
function sameKey(a, b) {
  return a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);
}

export function mountViewer(container) {
  const stage = el('div', { class: 'viewer-stage' });
  const host = el('div', { class: 'viewer-host' });
  const { staticCanvas, dynamicCanvas, staticCtx, dynamicCtx } = createLayeredCanvases(host);
  // createLayeredCanvases already appended both canvases to `host`. Do not append again.

  const chipId = el('div', { class: 'viewer-chip-id' });
  const chip = el('div', { class: 'viewer-chip' }, chipId);

  const zoomLabel = el('div', { class: 'viewer-zoom' }, '100%');
  const panButton = toolButton('Pan', ICONS.pan, () => setState((s) => ({ panMode: !s.panMode })));
  const overlayButton = toolButton('Toggle segmentation overlay', ICONS.overlays, () => setState((s) => ({ overlays: !s.overlays })));
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
      fillSlider));

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

  stage.append(host, chip, toolbar, footer, runCard);
  container.append(stage);

  let currentImages = null;
  let lastStatic = null;
  let lastDynamic = null;

  const detach = attachViewerInteractions(stage, dynamicCanvas, {
    getZoom: () => getState().zoom,
    getPan: () => ({ panX: getState().panX, panY: getState().panY }),
    getPanMode: () => getState().panMode,
    getGeometry: () => {
      const state = getState();
      const study = state.studies.find((s) => s.id === state.openId);
      return study ? study.geometry : null;
    },
    onZoom: (zoom) => setState({ zoom }),
    onPan: (panX, panY) => setState({ panX, panY }),
    onSelect: (level) => setState({ selectedLevel: level }),
  });

  function applyTransform(state) {
    // The two per-frame node writes BD-3 sanctions. Everything else below is a class.
    host.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    fillSlider.value = String(state.overlayOpacity);

    zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    stage.classList.toggle('is-pan-mode', state.panMode);
    panButton.classList.toggle('is-active', state.panMode);
    overlayButton.classList.toggle('is-active', state.overlays);
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
    runCard.classList.toggle('is-hidden', hasResult);
    if (!hasResult) {
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

    const staticKey = [state.overlays, state.overlayOpacity, currentImages];
    if (!sameKey(staticKey, lastStatic)) {
      lastStatic = staticKey;
      drawStaticLayer(staticCtx, staticCanvas, currentImages, {
        overlays: state.overlays,
        overlayOpacity: state.overlayOpacity,
      });
    }

    const dynamicKey = [study.geometry, state.selectedLevel, study.measurements];
    if (!sameKey(dynamicKey, lastDynamic)) {
      lastDynamic = dynamicKey;
      drawDynamicLayer(dynamicCtx, dynamicCanvas, study.geometry, {
        selectedLevel: state.selectedLevel,
        measurements: study.measurements,
      });
    }
  }

  function setRunHandler(handler) {
    runButton.onclick = handler;
  }

  return { updateViewer, setImages, setRunHandler, detach };
}
