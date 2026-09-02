import { el } from '../dom.js';
import { getState, setState, subscribe } from '../store.js';
import { predict, saveCsv } from '../api.js';
import { showToast } from '../components/toast.js';
import { toCsv } from '../data/csv.js';
import { loadStudyImages, disposeStudyImages } from '../viewer/canvas.js';
import { mountViewer, recordPrediction } from '../components/viewer.js';
import { mountMeasurements } from '../components/measurements.js';

const BACK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12 H5"></path><path d="M11 6 L5 12 L11 18"></path></svg>';

export function formatConfidence(qc) {
  const confidence = qc?.femoral?.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return '—';
  return `${Math.round(confidence * 100)}%`;
}

// ---------------------------------------------------------------------------
// Transient per-study binary state. None of this belongs on the Study record --
// plan 05 persists state.studies to disk and validates its shape, so anything
// hung on the record ships. See BD-6 and BD-7.

// Raw file bytes, keyed by study id. screens/studies.js writes; runSegmentation reads.
// Transitional: plan 06 scans folders into studies that carry a filePath and no payload.
const filePayloads = new Map();

export function setFilePayload(studyId, data) {
  filePayloads.set(studyId, data);
}

// Exactly one study's decoded bitmaps, deliberately kept ACROSS navigation so that
// returning to an already-segmented study repaints without re-running /predict. Bounded
// to a single entry: ImageBitmaps are large. Without this, studies -> analysis ->
// studies -> analysis leaves a study that has measurements, therefore no run card, and
// no image -- a black stage with outlines floating on it.
let imageCache = null; // { studyId, images } | null

function cacheImages(studyId, images) {
  const outgoing = imageCache;
  imageCache = { studyId, images };
  // Never close bitmaps the live viewer is still drawing. The completion path deliberately
  // skips setImages for a study that is no longer on screen, which leaves that viewer
  // holding the OLD cache entry -- disposing it here would detach bitmaps it still draws,
  // and ctx.drawImage on a detached ImageBitmap throws inside a store subscriber, which
  // stops every subscriber after it. Same identity check as the hand-off gate.
  if (outgoing && outgoing.images !== images
      && !(mounted && mounted.studyId === outgoing.studyId)) {
    disposeStudyImages(outgoing.images);
  }
}

// The live mount, or null when this screen is not on screen.
let mounted = null;

let runRevision = 0;

function currentStudy(state) {
  return state.studies.find((s) => s.id === state.openId) ?? null;
}

function teardown() {
  if (!mounted) return;
  mounted.viewer.detach();
  mounted = null;
  // imageCache deliberately survives -- that is the whole point of it.
}

// ---------------------------------------------------------------------------
// Subscribed ONCE, here at module scope, at import time. Not inside render().
//
// WHY NOT THE ROUTER (BD-2): this screen reads zoom/panX/panY/panMode, which change at
// pointermove rate. Adding them to router.js's SCREEN_KEYS would remount the screen host
// -- and therefore both <canvas> elements -- on every frame of a pan, orphaning the 2D
// contexts and stacking one set of listeners per frame. router.js:79-85 states this
// exception explicitly; its "add it here too" comment does not apply to this module.
//
// WHY NOT INSIDE render() (P2-3): render() runs on every navigation, so a subscription
// created there leaks one permanently-live listener per studies->analysis round trip,
// each rebuilding a detached tree on every later notification.
//
// ORDERING: this module's body evaluates before renderer/main.js's, because main.js
// imports router.js which imports this module, and store.js notifies listeners in
// insertion order. So on setState({screen: 'studies'}) the teardown below runs first and
// the router swaps the node second, which is the order that makes detach() correct.
subscribe((state) => {
  if (state.screen !== 'analysis') {
    teardown();
    return;
  }
  if (!mounted) return; // render() has not run for this navigation yet
  mounted.update();
});

async function runSegmentation(studyId) {
  const revision = ++runRevision;
  const study = getState().studies.find((s) => s.id === studyId);
  const data = study ? filePayloads.get(studyId) : undefined;
  if (!study || !data) {
    // A clinician must never be shown a raw "Cannot read properties of undefined".
    showToast('That study’s file is no longer available. Choose the radiograph again.');
    return;
  }

  setState({ running: true });
  try {
    const response = await predict({
      name: study.fileName,
      data,
      modality: 'xray',
      bodyPart: 'lumbar',
      view: 'lateral',
    });
    if (revision !== runRevision) return;

    const images = await loadStudyImages(response);
    if (revision !== runRevision) {
      disposeStudyImages(images);
      return;
    }

    // ORDER MATTERS (BD-6). setState notifies synchronously, so the module-scope
    // subscription's update() runs INSIDE the setState call below and asks the viewer to
    // repaint. The images have to be in place first, or that first paint sizes nothing
    // and draws nothing: every measurement populates while the stage stays black until
    // an unrelated click happens to fire the next update.
    cacheImages(studyId, images);
    // Hand off to the live viewer only if it is still showing the study this run was
    // for. The user may have navigated to a different study (or back to Studies) while
    // /predict was in flight -- runRevision only guards against a SECOND run for the
    // SAME study, not against navigation, so without this check a slow-resolving run for
    // A can paint A's bitmaps into B's live viewer. This is the completion-time sibling
    // of the re-hand guard below (`imageCache.studyId === study.id`): that one checks
    // identity before handing a freshly mounted viewer its cached bitmaps, this one
    // checks identity before handing a freshly resolved run its live viewer. The cache
    // write and the setState below stay unconditional -- A's results are real and belong
    // in the store regardless of what's on screen; only the live paint is gated.
    if (mounted && mounted.studyId === studyId) mounted.viewer.setImages(images);

    recordPrediction(studyId, response);

    setState((state) => ({
      running: false,
      editing: false,
      selection: null,
      studies: state.studies.map((s) => (s.id === studyId
        ? { ...s, measurements: response.measurements, geometry: response.geometry, qc: response.qc ?? null }
        : s)),
    }));
  } catch (error) {
    if (revision === runRevision) {
      setState({ running: false });
      showToast(`Could not segment: ${error.message}`);
    }
  }
}

export function render(state) {
  // A re-render (the router calls this whenever SCREEN_KEYS change) must not leave the
  // previous mount's listeners live.
  teardown();

  const study = currentStudy(state);
  if (!study) {
    // Not reachable from plan 03's UI -- screens/studies.js always sets openId and
    // screen together, and the sidebar has no Analysis nav item -- but rendering a
    // header-and-empty-viewer shell over a study that isn't there is worse than one
    // extra branch.
    return el('main', { class: 'placeholder-screen' }, el('p', {}, 'No study is open.'));
  }

  const backButton = el('button', {
    type: 'button',
    class: 'icon-btn',
    title: 'Back to studies',
    'aria-label': 'Back to studies',
    innerHTML: BACK_SVG,
    onClick: () => setState({ screen: 'studies', editing: false, selection: null }),
  });

  const headerMeta = el('div', { class: 'analysis-meta' });
  const confidenceValue = el('div', { class: 'confidence-value' });

  // Labelled FEMORAL FIT CONFIDENCE, not the mockup's SEGMENTATION CONFIDENCE, because
  // the number behind it is qc.femoral.confidence -- a femoral circle-fit score, not a
  // whole-segmentation score. The architecture contract's "never label a value with a
  // name it isn't" rule names this badge specifically. Do not rename it to match the
  // mockup. It stays visible with an em dash before a run, per the absent-value rule.
  const confidenceBadge = el('div', { class: 'confidence-badge' },
    el('div', { class: 'confidence-dot' }),
    el('div', { class: 'confidence-label' }, 'FEMORAL FIT CONFIDENCE'),
    confidenceValue);

  const header = el('header', { class: 'analysis-header' },
    backButton,
    headerMeta,
    el('div', { class: 'analysis-spacer' }),
    confidenceBadge);

  const tabMeas = el('button', {
    type: 'button', class: 'analysis-tab', onClick: () => setState({ tab: 'meas' }),
  }, 'Measurements');
  const tabSim = el('button', {
    type: 'button', class: 'analysis-tab', onClick: () => setState({ tab: 'sim' }),
  }, 'Find similar');

  const exportButton = el('button', {
    type: 'button', class: 'btn btn-small analysis-export', onClick: () => exportCsv(),
  }, 'Export CSV');

  const measurementsHost = el('div', { class: 'analysis-panel-host' });
  const similarHost = el('div', { class: 'analysis-similar is-hidden' },
    'Find similar arrives in a later build.');

  const panel = el('aside', { class: 'analysis-panel' },
    el('div', { class: 'analysis-tabs' },
      el('div', { class: 'analysis-tabgroup' }, tabMeas, tabSim)),
    el('div', { class: 'analysis-actions' }, exportButton),
    measurementsHost,
    similarHost);

  const viewerHost = el('div', { class: 'analysis-viewer-host' });
  const body = el('div', { class: 'analysis-body' }, viewerHost, panel);
  const root = el('main', { class: 'analysis-screen' }, header, body);

  const viewer = mountViewer(viewerHost);
  const measurementsPanel = mountMeasurements(measurementsHost);

  viewer.setRunHandler(() => {
    const live = getState();
    if (live.running) return;
    runSegmentation(live.openId);
  });

  // Re-hand the cached bitmaps to the fresh viewer, so navigating back into an
  // already-segmented study shows its radiograph instead of a black stage.
  if (imageCache && imageCache.studyId === study.id) viewer.setImages(imageCache.images);

  async function exportCsv() {
    const live = getState();
    // No includeDemo. It is a no-op today (openId is always a real study), but plan 05
    // makes the nine demo studies openable, at which point `includeDemo: true` would
    // silently write fabricated measurements into a research CSV.
    const csv = toCsv(live.studies.filter((s) => s.id === live.openId), live.fields, {});
    const open = currentStudy(live);
    try {
      const savedTo = await saveCsv({ text: csv, suggestedName: `${open ? open.id : 'export'}.csv` });
      // Cancelling the dialog is not an error and must not toast. saveCsv resolves null.
      if (savedTo) showToast(`Exported to ${savedTo}`);
    } catch (error) {
      showToast(`Could not export: ${error.message}`);
    }
  }

  function update() {
    const live = getState();
    const open = currentStudy(live);
    if (!open) return;

    // `open.pt` is the demo-set PATIENT label, not the PT pelvic-tilt measurement
    // (that is open.measurements.PT). Do not "fix" this to a number.
    headerMeta.textContent = `${open.id} · ${(open.view ?? '').toUpperCase()} · ${open.pt ?? '—'}`;
    confidenceValue.textContent = formatConfidence(open.qc);

    tabMeas.classList.toggle('is-active', live.tab === 'meas');
    tabSim.classList.toggle('is-active', live.tab === 'sim');
    measurementsHost.classList.toggle('is-hidden', live.tab !== 'meas');
    similarHost.classList.toggle('is-hidden', live.tab !== 'sim');

    viewer.updateViewer(open);
    measurementsPanel.updateMeasurements(open);
  }

  mounted = { viewer, update, studyId: study.id };
  update();
  return root;
}
