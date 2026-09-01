import { el } from '../dom.js';
import { selectFile } from '../api.js';
import { showToast } from '../components/toast.js';

const UPLOAD_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16 V4"></path><path d="M7.5 8.5 L12 4 L16.5 8.5"></path><path d="M4.5 19.5 H19.5"></path></svg>';

async function handleChoose() {
  try {
    const chosen = await selectFile();
    if (!chosen) return;
    showToast(`${chosen.name} selected.`);
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
