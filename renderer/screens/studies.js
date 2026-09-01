import { el } from '../dom.js';
import { getState, setState } from '../store.js';
import { selectFile } from '../api.js';
import { showToast } from '../components/toast.js';
import { setFilePayload } from './analysis.js';

const UPLOAD_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16 V4"></path><path d="M7.5 8.5 L12 4 L16.5 8.5"></path><path d="M4.5 19.5 H19.5"></path></svg>';

// Local stand-in for data/persistence.js's nextId(), which arrives in plan 05. Scans
// real studies only and starts at SP-1000, exactly as the architecture contract
// specifies. Deliberately NOT a separate `SP-DRAFT-n` namespace: plan 05 persists these
// records, and nextId() parsing 'SP-DRAFT-1' yields NaN. Derived from state rather than
// from a module-scope counter so it cannot collide with studies that are already loaded.
function nextLocalId(studies) {
  let highest = 999;
  for (const study of studies) {
    if (study.source !== 'real') continue;
    const match = /^SP-(\d+)$/.exec(study.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `SP-${highest + 1}`;
}

async function handleChoose() {
  try {
    const chosen = await selectFile();
    if (!chosen) return;

    const id = nextLocalId(getState().studies);

    // The raw bytes are held OFF the Study record, in screens/analysis.js's payload map.
    // Plan 05 persists state.studies to disk and validates its shape, so a `_fileData`
    // field would either write megabytes of binary into the store or fail validate().
    // See BD-7.
    setFilePayload(id, chosen.data);

    setState((state) => ({
      studies: [...state.studies, {
        id,
        source: 'real',
        filePath: chosen.path,
        fileName: chosen.name,
        addedAt: new Date().toISOString(),
        view: 'Standing lateral',
        thumbnail: null,
        measurements: null,
        geometry: null,
        qc: null,
        clinical: {},
      }],
      openId: id,
      screen: 'analysis',
      // Reset the per-study view state so a new film does not inherit the last one's
      // zoom, pan or selection.
      selectedLevel: null,
      zoom: 1,
      panX: 0,
      panY: 0,
      panMode: false,
    }));
  } catch (error) {
    showToast(`Could not open file: ${error.message}`);
  }
}

function dropzone() {
  return el('div', { class: 'dropzone' },
    el('div', { class: 'dropzone-icon', innerHTML: UPLOAD_SVG }),
    el('div', { class: 'dropzone-text' },
      el('div', { class: 'dropzone-title' }, 'Drop a DICOM series or lateral radiograph'),
      el('div', { class: 'dropzone-subtitle' }, 'De-identified files only. Segmentation runs locally on the workstation.'),
    ),
    el('button', { type: 'button', class: 'btn btn-primary btn-small', onClick: handleChoose }, 'Choose radiograph'),
  );
}

export function render() {
  return el('main', { class: 'studies-page' },
    el('div', { class: 'studies-page-inner' },
      el('div', { class: 'studies-header' },
        el('h1', { class: 'studies-heading' }, 'Studies'),
      ),
      dropzone(),
    ),
  );
}
