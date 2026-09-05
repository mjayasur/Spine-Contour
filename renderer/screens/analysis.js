import { el } from '../dom.js';
import { getState, setState, subscribe } from '../store.js';
import {
  predict, saveCsv, savePrediction, loadPrediction, persistenceDisabledReason, readFile, selectFile,
} from '../api.js';
import { showToast } from '../components/toast.js';
import { toCsv } from '../data/csv.js';
import { loadStudyImages, disposeStudyImages, thumbnailDataUri } from '../viewer/canvas.js';
import { mountViewer, recordPrediction } from '../components/viewer.js';
import { describeModels } from '../data/models.js';
import { mountMeasurements } from '../components/measurements.js';
import { mountClinicalData } from '../components/clinical-data.js';

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

// Every id-keyed cache this module holds for one study, dropped when the study is deleted.
// Ids are max+1, so the next film added can reuse a deleted id; without this the new record
// would inherit the old film's bytes and decoded bitmaps.
export function releaseStudy(studyId) {
  filePayloads.delete(studyId);
  if (imageCache && imageCache.studyId === studyId) {
    // The entry always goes -- the next film can reuse this id. The bitmaps are CLOSED only
    // when no live viewer draws them (the same identity check cacheImages makes); a viewer
    // that still holds them keeps its own reference and repaints correctly until it detaches.
    if (!(mounted && mounted.studyId === studyId)) disposeStudyImages(imageCache.images);
    imageCache = null;
  }
}

let runRevision = 0;

// True while a relocate picker is open for a run that has not started. It refuses a second run
// (and so a second native dialog) WITHOUT claiming a segmentation is running -- the card must
// not say RUNNING while the app is waiting on a file dialog (no fabricated status).
let locating = false;

let restoreRevision = 0;

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

// The film bytes: this session's payload, else the file at filePath, else null (moved or never had a path).
async function filmBytes(study) {
  const cached = filePayloads.get(study.id);
  if (cached) return cached;
  if (!study.filePath) return null;
  const bytes = await readFile(study.filePath);
  if (bytes) filePayloads.set(study.id, bytes);
  return bytes;
}

// Spec 13: a study whose source moved still lists with its numbers and opens; the moment the
// film is needed, offer to relocate it. Cancelling leaves the record untouched.
async function relocateFilm(study) {
  showToast(`${study.fileName} was not found. Choose its new location.`);
  const chosen = await selectFile();
  if (!chosen) return null;
  // IDENTITY, not existence, and checked here rather than only in the caller: this function
  // writes to the record on its own. The picker is modeless, so while it is open the study can
  // be deleted and a new film dropped -- and ids are max+1, so the new record can already carry
  // this id. Parking the chosen bytes and rewriting fileName/filePath by id alone would replace
  // the film the user just added. A reused id can never carry the deleted record's addedAt.
  const live = getState().studies.find((s) => s.id === study.id);
  if (!live || live.addedAt !== study.addedAt) return null;
  filePayloads.set(study.id, chosen.data);
  setState((state) => ({
    studies: state.studies.map((s) => (s.id === study.id ? { ...s, fileName: chosen.name, filePath: chosen.path } : s)),
  }));
  return chosen.data;
}

async function runSegmentation(studyId) {
  if (locating) return;
  // The !study return sits ABOVE the revision bump on purpose: bumping and then returning
  // early invalidates an in-flight run, whose completion would then return at a revision
  // check WITHOUT clearing `running` -- and every card would read RUNNING forever.
  const study = getState().studies.find((s) => s.id === studyId);
  if (!study) return;
  // The record's identity, carried alongside its id for the checks after every await below.
  // Ids are max+1, so a deleted id is reused by the next film added; addedAt is not.
  const addedAt = study.addedAt;
  const revision = ++runRevision;
  let data = null;
  locating = true;
  try {
    data = await filmBytes(study);
    if (!data) data = await relocateFilm(study);
  } catch (error) {
    showToast(`Could not read ${study.fileName}: ${error.message}`);
  } finally {
    locating = false;
  }
  if (!data || revision !== runRevision) return;
  // After a relocation the record carries the NEW name; the `study` binding above is stale.
  // The filename matters: its extension drives the backend's decoder, so relocating a .jpg
  // to a .png has to send the new name with the new bytes.
  const current = getState().studies.find((s) => s.id === studyId);
  // Deleted while the bytes were being read or the relocate picker was open: nothing runs
  // for a record that is gone. The read above (filmBytes/relocateFilm) may have re-parked
  // the bytes under this id AFTER releaseStudy cleared them, so drop them again -- the next
  // film can reuse the id. runRevision is deliberately not bumped anywhere on delete.
  // `addedAt` as well as existence, because that reuse may already have happened: a record
  // with this id can be a DIFFERENT study, and running this study's bytes and measurements
  // onto it would silently replace the film the user just added.
  if (!current || current.addedAt !== addedAt) {
    filePayloads.delete(studyId);
    return;
  }

  // The id, not a boolean: with a Studies list the user can open study B while A's /predict
  // is in flight, and the viewer and the list have to be able to ask WHICH study is running.
  // Every existing truthiness check still reads "a run is in flight" (one run at a time).
  setState({ running: studyId });
  try {
    const response = await predict({
      name: current.fileName,
      data,
      modality: 'xray',
      bodyPart: 'lumbar',
      view: 'lateral',
      models: getState().models,
    });
    if (revision !== runRevision) return;

    const images = await loadStudyImages(response);
    if (revision !== runRevision) {
      disposeStudyImages(images);
      return;
    }

    const thumbnail = thumbnailDataUri(images.image);

    // The sidecar first, then the record: a record that says "segmented" must point at a film
    // that exists. A failed sidecar write is reported and the run still completes — the study
    // opens to FILM UNAVAILABLE next time, and a re-run recreates it. Neither toast starts with
    // "Could not": tools/smoke/run-and-wait.js treats that prefix as a failed run.
    if (persistenceDisabledReason()) {
      showToast('Studies are not being saved this session, so the segmentation images were not stored.');
    } else {
      try {
        await savePrediction(studyId, response);
      } catch (error) {
        showToast(`Saved the measurements, but the segmentation images could not be stored: ${error.message}`);
      }
    }
    if (revision !== runRevision) { disposeStudyImages(images); return; }

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

    // The finished study's own edit mode ends -- its geometry was just replaced under the
    // handles -- but ONLY if it is the study on screen. `editing` and `selection` belong to
    // `openId` (every writer of openId resets both, screens/studies.js FRESH_VIEW), and with a
    // Studies list the user may have opened study B and entered edit mode while A's /predict
    // was in flight: the viewer disables Edit only for the running study itself. A's completion
    // must not drop B out of edit mode. The error path below never touched either key.
    setState((state) => ({
      running: null,
      editing: state.openId === studyId ? false : state.editing,
      selection: state.openId === studyId ? null : state.selection,
      studies: state.studies.map((s) => (s.id === studyId
        ? { ...s, measurements: response.measurements, geometry: response.geometry, qc: response.qc ?? null, thumbnail }
        : s)),
    }));
  } catch (error) {
    if (revision === runRevision) {
      setState({ running: null });
      showToast(`Could not segment: ${error.message}`);
    }
  }
}

// A persisted study opened after a restart has numbers but no bitmaps. Read its sidecar,
// decode, hand the bitmaps to the live viewer, and re-record the prediction snapshot with the
// STORED geometry as the measured one. Guarded like runSegmentation: a newer restore, a run
// started meanwhile, or the study being deleted drops this one's result; navigation does not,
// and `imageCache` deliberately survives it.
async function restoreFilm(studyId) {
  const revision = ++restoreRevision;
  const runAtStart = runRevision;
  // The record's identity at the start, checked again below. `undefined` cannot reach here
  // (the caller restores the OPEN study), and a null placeholder still fails the comparison
  // against any real record, which is the safe direction.
  const addedAt = getState().studies.find((s) => s.id === studyId)?.addedAt ?? null;
  const live = () => mounted && mounted.studyId === studyId;
  if (live()) mounted.viewer.setFilmStatus('loading');
  try {
    // The sidecar READ is gated exactly like the writes. When the store on disk was refused
    // (a newer version, a broken record) persistence is off for the session and nextId()
    // restarts at SP-1000 over a library this build cannot see -- so predictions/SP-1000.json
    // is the PREVIOUS library's sidecar: another patient's radiograph, mask and geometry, and
    // recordPrediction would make them this study's RESET TO PREDICTION target. Treat it as a
    // missing sidecar, which already has a defined outcome (FILM UNAVAILABLE; a re-run
    // recreates it) rather than a wrong one.
    const sidecar = persistenceDisabledReason() ? null : await loadPrediction(studyId);
    if (revision !== restoreRevision || runAtStart !== runRevision) return;
    if (!sidecar) {
      if (live()) mounted.viewer.setFilmStatus('missing');
      return;
    }
    const images = await loadStudyImages(sidecar);
    const study = getState().studies.find((s) => s.id === studyId);
    // Deleted while the sidecar was being read and decoded: releaseStudy has already cleared
    // this id's caches, and nothing may be re-parked under an id the next film can reuse --
    // cacheImages + recordPrediction would restore the film, the snapshot AND the measured
    // geometry under a dead id, and the reusing record would open on the deleted study's film
    // with RESET TO PREDICTION live over its numbers. Existence is not enough: ids are max+1,
    // so a record with this id may be the film added AFTER the delete. Identity is `addedAt`,
    // which a reused id never carries.
    if (!study || study.addedAt !== addedAt || revision !== restoreRevision || runAtStart !== runRevision) {
      disposeStudyImages(images);
      return;
    }
    cacheImages(studyId, images);
    recordPrediction(studyId, sidecar, study.geometry ? study.geometry : sidecar.geometry);
    if (live()) {
      mounted.viewer.setFilmStatus(null);
      mounted.viewer.setImages(images);
      mounted.update();
    }
  } catch (error) {
    if (revision !== restoreRevision) return;
    if (live()) mounted.viewer.setFilmStatus('missing');
    showToast(`Could not load the film for ${studyId}: ${error.message}`);
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

  // The same DEMO pill the Studies list puts beside the patient. A demo study's numbers are
  // fabricated for exploring the interface; the header is where the user is looking when they
  // read them, so the pill belongs beside the id, not only back on the list.
  const header = el('header', { class: 'analysis-header' },
    backButton,
    headerMeta,
    study.source === 'demo' ? el('span', { class: 'pill-demo' }, 'DEMO') : null,
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
  // The clinical data drawer is the screen's LAST child, full width below the viewer/panel row
  // (spec 9.5). .analysis-screen is a flex column and .analysis-body is flex:1/min-height:0, so
  // the stage shrinks to make room and the drawer is always in view -- the app shell cannot
  // scroll (.app-shell is height:100vh/overflow:hidden), and it must not: the stage's
  // client-to-image hit-testing assumes a fixed stage. Mounted for demo studies too; the
  // component disables its inputs and its Import button for them.
  const clinicalHost = el('section', { class: 'clinical-data' });
  const root = el('main', { class: 'analysis-screen' }, header, body, clinicalHost);

  const viewer = mountViewer(viewerHost);
  const measurementsPanel = mountMeasurements(measurementsHost);
  const clinical = mountClinicalData(clinicalHost);

  viewer.setRunHandler(() => {
    const live = getState();
    // `locating` too: a relocate picker is already open for a run that has not started, and a
    // second click must not raise a second native dialog. It is not a run, so it never claims one.
    if (live.running || locating) return;
    runSegmentation(live.openId);
  });

  // Re-hand the cached bitmaps to the fresh viewer, so navigating back into an
  // already-segmented study shows its radiograph instead of a black stage.
  if (imageCache && imageCache.studyId === study.id) viewer.setImages(imageCache.images);
  // Only DECIDED here; the restore itself starts after the first paint, because restoreFilm's
  // live() reads `mounted`. A demo study has no film to restore and no sidecar to read.
  const needsRestore = !(imageCache && imageCache.studyId === study.id)
    && study.source === 'real' && Boolean(study.measurements && study.geometry);

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
    // The model that produced the numbers on screen, when the result recorded one. Older
    // records carry no provenance and show nothing extra rather than a guessed name.
    const produced = describeModels(open.qc);
    headerMeta.textContent = `${open.id} · ${(open.view ?? '').toUpperCase()} · ${open.pt ?? '—'}`
      + (produced ? ` · ${produced.toUpperCase()}` : '');
    confidenceValue.textContent = formatConfidence(open.qc);

    // toCsv already drops demo rows, so exporting a demo study would write a header and no
    // data. Disabling the button says why instead of handing back an empty file.
    const isDemo = open.source === 'demo';
    exportButton.disabled = isDemo;
    // No tooltip on the enabled button: it would only repeat the label it sits on.
    exportButton.title = isDemo ? 'Demo studies are not exported' : '';

    tabMeas.classList.toggle('is-active', live.tab === 'meas');
    tabSim.classList.toggle('is-active', live.tab === 'sim');
    measurementsHost.classList.toggle('is-hidden', live.tab !== 'meas');
    similarHost.classList.toggle('is-hidden', live.tab !== 'sim');

    viewer.updateViewer(open);
    measurementsPanel.updateMeasurements(open);
    // Same contract as updateMeasurements: this runs on EVERY store notification, pan frames
    // included, and the component's own reference-keyed gate decides whether to rebuild. It
    // reads the store itself, so it takes no argument.
    clinical.update();
  }

  // mounted.studyId is refreshed ONLY here, and render() runs only when the router sees a
  // SCREEN_KEYS ('screen', 'ack') change. Every writer that changes state.openId today also
  // sets screen, so the two stay in step. A future writer that changes openId WITHOUT screen
  // would leave a stale studyId behind and mis-gate all three of its readers -- the
  // setImages guard (~l.203), live() (~l.230) and needsRestore -- drawing one study's
  // geometry over another study's film. Add openId to SCREEN_KEYS, or refresh this in
  // update(), before writing such a caller.
  mounted = { viewer, update, studyId: study.id };
  update();
  if (needsRestore) restoreFilm(study.id);
  return root;
}
