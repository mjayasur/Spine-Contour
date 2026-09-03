/**
 * Study store logic: ids, shape validation, demo/real merge, and the
 * save-on-change coalescer (spec 13, 13.1; architecture contract
 * "renderer/data/persistence.js"). Pure — no fs, no Electron, no DOM —
 * safe to load in the browser via <script type="module"> and under
 * node --test alike. Disk I/O (atomic write, corrupt-store recovery)
 * lives in the root-level store-io.js, which only main.js imports.
 *
 * Accepted limitation: createStudySaver has no flush-at-quit. A change
 * committed and the window closed inside the same write cycle (two
 * sub-millisecond writes) loses the trailing write.
 */

import { DEMO_STUDIES } from './demo-studies.js';

export const STORE_VERSION = 1;

/**
 * @param {object[]} studies real + demo, merged or not
 * @returns {string} 'SP-1000' or higher, scanning real studies only
 */
export function nextId(studies) {
  let max = 999; // so the first id is SP-1000
  for (const study of studies || []) {
    if (!study || study.source !== 'real') continue;
    const match = /^SP-(\d+)$/.exec(study.id || '');
    if (!match) continue;
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  const next = Math.max(max + 1, 1000);
  return `SP-${String(next).padStart(4, '0')}`;
}

/**
 * @param {object[]} realStudies
 * @returns {object[]} real studies first, then all nine demo studies
 */
export function merge(realStudies) {
  return [...(realStudies || []), ...DEMO_STUDIES];
}

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function point(p) {
  return Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]);
}

function points(list, n) {
  return Array.isArray(list) && list.length === n && list.every(point);
}

function isValidMeasurements(m) {
  if (!m || typeof m !== 'object') return false;
  if (!finite(m.PI) || !finite(m.PT) || !finite(m.SS)) return false;
  if (!m.LL || typeof m.LL !== 'object' || !finite(m.LL['L1-S1'])) return false;
  if (m.L1PA != null && !finite(m.L1PA)) return false;
  for (const level of ['L2-S1', 'L3-S1', 'L4-S1', 'L5-S1']) {
    if (m.LL[level] != null && !finite(m.LL[level])) return false;
  }
  return true;
}

function isValidGeometry(g) {
  if (!g || typeof g !== 'object') return false;
  if (!g.vertebrae || typeof g.vertebrae !== 'object') return false;
  for (const level of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    const v = g.vertebrae[level];
    if (!v || typeof v !== 'object') return false;
    if (!points(v.superior, 2)) return false;
    if (!points(v.inferior, 2)) return false;
    if (!points(v.quadrilateral, 4)) return false;
  }
  if (!points(g.s1_superior, 2)) return false;
  if (!point(g.l1_center)) return false;
  if (!point(g.hip_midpoint)) return false;
  if (!Array.isArray(g.femoral_circles) || g.femoral_circles.length !== 2) return false;
  for (const circle of g.femoral_circles) {
    if (!Array.isArray(circle) || circle.length !== 3) return false;
    const [cx, cy, r] = circle;
    if (!finite(cx) || !finite(cy) || !finite(r) || !(r > 0)) return false;
  }
  return true;
}

/**
 * @param {*} raw the parsed contents of studies.json ({version, studies})
 * @returns {object[]} normalized real Study[]
 * @throws {Error} when raw is not a well-formed store, or a record's
 *   identity fields are wrong
 */
export function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Study store is not an object.');
  if (raw.version !== STORE_VERSION) {
    throw new Error(`Study store version ${raw.version ?? 'missing'} is not supported by this build (expected ${STORE_VERSION}).`);
  }
  if (!Array.isArray(raw.studies)) throw new Error('Study store is missing a "studies" array.');
  return raw.studies.map((entry, index) => validateStudy(entry, index));
}

function validateStudy(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Study at index ${index} is not an object.`);
  }
  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    throw new Error(`Study at index ${index} is missing an id.`);
  }
  if (entry.source !== 'real') {
    throw new Error(`Study ${entry.id} has source "${entry.source}"; only "real" studies may be persisted.`);
  }
  if (typeof entry.fileName !== 'string') {
    throw new Error(`Study ${entry.id} is missing fileName.`);
  }
  if (typeof entry.addedAt !== 'string') {
    throw new Error(`Study ${entry.id} is missing addedAt.`);
  }
  if (typeof entry.view !== 'string') {
    throw new Error(`Study ${entry.id} is missing view.`);
  }

  const measurements = isValidMeasurements(entry.measurements) ? entry.measurements : null;
  const geometry = isValidGeometry(entry.geometry) ? entry.geometry : null;
  const complete = measurements !== null && geometry !== null;
  if (!complete && (entry.measurements != null || entry.geometry != null)) {
    console.warn(`persistence: ${entry.id} has a malformed measurements/geometry payload; it will need to be re-run.`);
  }
  return {
    id: entry.id, source: 'real',
    filePath: typeof entry.filePath === 'string' ? entry.filePath : null,
    fileName: entry.fileName, addedAt: entry.addedAt, view: entry.view,
    thumbnail: typeof entry.thumbnail === 'string' && entry.thumbnail.startsWith('data:image/') ? entry.thumbnail : null,
    measurements: complete ? measurements : null,
    geometry: complete ? geometry : null,
    qc: entry.qc && typeof entry.qc === 'object' ? entry.qc : null,
    clinical: entry.clinical && typeof entry.clinical === 'object' && !Array.isArray(entry.clinical) ? entry.clinical : {},
  };
}

// Save-on-change with coalescing: one save in flight at a time; changes that arrive meanwhile
// collapse into one trailing save of the latest list. No timers, so the last change before quit
// is written as soon as the previous write finishes. Demo studies are filtered out here, so the
// main process never sees them.
export function createStudySaver({ save, onError, disabledReason = null, initial = null }) {
  let lastSeen = initial;
  let latest = null;      // the real studies waiting to be written, or null
  let inFlight = null;    // the promise of the write loop, or null
  let reported = false;

  async function drain() {
    while (latest !== null) {
      const batch = latest;
      latest = null;
      try { await save(batch); } catch (error) { onError(new Error(`Could not save studies: ${error.message}`)); }
    }
    inFlight = null;
  }

  function notify(state) {
    if (state.studies === lastSeen) return;
    lastSeen = state.studies;
    if (disabledReason) {
      if (!reported) { reported = true; onError(new Error(`Studies are not being saved: ${disabledReason}`)); }
      return;
    }
    latest = state.studies.filter((study) => study.source === 'real');
    if (!inFlight) inFlight = drain();
  }

  const flush = () => inFlight ?? Promise.resolve();
  return { notify, flush };
}
