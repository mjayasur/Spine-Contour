import { debounce } from './interactions.js';

// The /measure round-trip, extracted from components/viewer.js so its bookkeeping is testable
// without a DOM: revisions are PER STUDY, the single debounce knows whose call it holds,
// committing on another study flushes the pending one instead of replacing it, replacing a
// study's geometry (a prediction, a reset) discards its pending or in-flight correction, and a
// failed round-trip restores the geometry the study's measurements actually describe -- the
// panel must never show numbers beside a geometry they were not computed from.
export function createMeasureQueue({ measure, getState, setState, showToast, debounceMs = 150 }) {
  const revisions = new Map(); // studyId -> latest revision issued
  const measured = new Map();  // studyId -> the geometry the study's current measurements describe
  let pendingId = null;        // the study whose call sits in the debounce, or null

  function bump(studyId) {
    const next = (revisions.get(studyId) ?? 0) + 1;
    revisions.set(studyId, next);
    return next;
  }

  function writeStudy(studyId, patch) {
    setState((current) => ({
      studies: current.studies.map((item) => (item.id === studyId ? { ...item, ...patch } : item)),
    }));
  }

  async function recalculate(studyId) {
    pendingId = null;
    const revision = bump(studyId);
    const study = getState().studies.find((item) => item.id === studyId);
    if (!study || !study.geometry) return;
    try {
      const result = await measure({
        vertebrae: study.geometry.vertebrae,
        s1_superior: study.geometry.s1_superior,
        femoral_circles: study.geometry.femoral_circles,
      });
      if (revision !== revisions.get(studyId)) return;
      measured.set(studyId, result.geometry);
      writeStudy(studyId, { measurements: result.measurements, geometry: result.geometry });
    } catch (error) {
      if (revision !== revisions.get(studyId)) return;
      // The edit is already in the store but no numbers describe it. Put back the geometry the
      // current numbers DO describe, so the panel and the stage agree, and say so.
      const known = measured.get(studyId);
      if (known) writeStudy(studyId, { geometry: structuredClone(known) });
      showToast(`The correction was not applied — could not update measurements: ${error.message}`);
    }
  }

  const schedule = debounce(recalculate, debounceMs);

  // Commits an edited geometry as a NEW reference and schedules the re-measure. Every edit
  // path ends here: drag release, keyboard nudge, retrace fit.
  function commitGeometry(studyId, geometry) {
    writeStudy(studyId, { geometry });
    if (pendingId !== null && pendingId !== studyId) {
      schedule.cancel();
      recalculate(pendingId);
    }
    pendingId = studyId;
    schedule(studyId);
  }

  // Drops any correction pending or in flight for ONE study, and records the geometry its
  // measurements now describe (a fresh prediction, a reset).
  function replaceMeasured(studyId, geometry) {
    bump(studyId);
    if (pendingId === studyId) {
      schedule.cancel();
      pendingId = null;
    }
    measured.set(studyId, geometry);
  }

  return { commitGeometry, replaceMeasured };
}
