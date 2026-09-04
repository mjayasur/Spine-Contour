/**
 * Workspace screen (spec 9.3). Three step cards -- image folder, optional clinical CSV, column
 * mapping -- and one Load workspace button that turns every scanned film into an unsegmented
 * real Study in a single setState. render(state) returns the screen's root; because
 * router.js remounts this host only on screen/ack, every handler refreshes the screen itself
 * after its setState. Persistence is the store subscriber in renderer/main.js: nothing here
 * calls saveStudies.
 */

import { el, mount } from '../dom.js';
import { getState, setState } from '../store.js';
import { chooseFolder, scanFolder, chooseCsv, readCsv } from '../api.js';
import { parse, autoMap, KNOWN_FIELDS, findJoinHeader, joinClinical, clinicalFieldNames } from '../data/csv.js';
import { nextId } from '../data/persistence.js';
import { newStudy } from './studies.js';
import { showToast } from '../components/toast.js';

// Icon wells, lifted from the design (design-reference/template.html) the way sidebar.js and
// landing.js do. FOLDER_SVG is the sidebar's Workspace icon path at the card-well size.
const FOLDER_SVG = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7 C3.5 5.6 4.6 5 5.5 5 H9.5 L11.5 7.5 H18.5 C19.6 7.5 20.5 8.4 20.5 9.5 V17 C20.5 18.1 19.6 19 18.5 19 H5.5 C4.4 19 3.5 18.1 3.5 17 Z"></path></svg>';
const CSV_SVG = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 H14 L18.5 8 V20.5 H6 Z"></path><path d="M13.5 3.5 V8.5 H18.5"></path><path d="M9 13 H15.5"></path><path d="M9 16.5 H13"></path></svg>';
const ARROW_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12 H18"></path><path d="M12.5 6 L18.5 12 L12.5 18"></path></svg>';

// The last folder scan's skipped count, keyed to the folder it describes. Module scope, not
// a render() local: the router re-runs render() on every navigation while wsFolder/wsFiles
// survive in the store, and a count that came back as 0 would be a fabricated number. The
// clause renders only while lastScan.folder === state.wsFolder.
let lastScan = null; // { folder, skipped }

// Pure: the studies list a Load would commit, plus the counts the toast reports. Known films
// (same filePath, case-insensitively -- Windows paths) are never added twice; when the CSV has
// a row for a known film, the keys that record is MISSING (absent or empty) are filled onto a
// NEW object -- an existing value is never overwritten, and a record with nothing to fill is
// kept by reference and not counted. New records are front-inserted in scan order with
// consecutive ids; nextId is read once.
export function loadWorkspaceStudies(state) {
  const join = state.wsCsv
    ? joinClinical({ files: state.wsFiles, headers: state.wsCsvHeaders, rows: state.wsCsvRows, mapping: state.wsMapping })
    : null;

  const knownByPath = new Map();
  for (const study of state.studies) {
    if (study.source === 'real' && typeof study.filePath === 'string' && study.filePath) {
      knownByPath.set(study.filePath.toLowerCase(), study);
    }
  }

  let next = Number(nextId(state.studies).slice(3));
  const added = [];
  const replacements = new Map(); // study id -> the updated record
  let known = 0;
  let updated = 0;

  for (const filePath of state.wsFiles) {
    const existing = knownByPath.get(filePath.toLowerCase());
    if (existing) {
      known += 1;
      const fromCsv = join ? join.byFile.get(filePath) : undefined;
      // Load FILLS BLANKS; it never overwrites. A value already on the record was either
      // typed in the drawer or imported deliberately, and a second Load -- or an overlapping
      // folder scanned with a stale CSV -- must not silently replace it. Only the keys whose
      // current value is absent or empty are taken; if none is, the record is kept BY
      // REFERENCE and not counted, so `updated` never reports work that did not happen.
      // The explicit overwrite path is `Import from CSV` in the drawer (Task 5).
      const fills = {};
      for (const [key, value] of Object.entries(fromCsv ?? {})) {
        const current = existing.clinical ? existing.clinical[key] : undefined;
        if (current == null || current === '') fills[key] = value;
      }
      if (Object.keys(fills).length > 0) {
        replacements.set(existing.id, { ...existing, clinical: { ...existing.clinical, ...fills } });
        updated += 1;
      }
      continue;
    }
    const id = `SP-${String(next++).padStart(4, '0')}`;
    added.push({
      ...newStudy({ id, fileName: filePath.split(/[\\/]/).pop(), filePath }),
      // Spread, never the join's own object: Task 3's note guarantees the store never holds
      // a reference the join still owns.
      clinical: { ...(join?.byFile.get(filePath) ?? {}) },
    });
  }

  const existingWithUpdates = state.studies.map((study) => replacements.get(study.id) ?? study);
  return { studies: [...added, ...existingWithUpdates], added: added.length, known, updated, join };
}

// The drawer's columns after a load. `fields` is what the session already shows, in its
// existing order; every clinical key the loaded studies carry and it does not is appended.
// Without this the values the load just wrote are on the records and on disk while the drawer
// reads NO FIELDS and Export CSV writes no clinical columns, until a relaunch -- bootstrap
// seeds the same list from the same function (renderer/main.js), so this is the restart fix
// applied to the load path. `fields` stays session state; nothing new is persisted.
export function workspaceLoadedFields(fields, studies) {
  const loaded = clinicalFieldNames(studies);
  return [...fields, ...loaded.filter((name) => !fields.includes(name))];
}

// The post-load toast. Every clause describes something the load actually did.
export function workspaceLoadedMessage({ added, known, updated, join, mapping }) {
  return `Workspace loaded — ${added} ${added === 1 ? 'study' : 'studies'} added`
    + (known ? ` · ${known} already in the library` : '')
    + (updated ? ` (clinical data updated for ${updated})` : '')
    + (join
      ? (join.joinHeader === null
        ? ` · CSV has no study_id column — ${join.unmatched} row${join.unmatched === 1 ? '' : 's'} not linked`
        : (mapping.every((m) => !m.dest)
          ? ' · no columns mapped'
          // Nothing added and nothing updated, with rows that did match: the load wrote no
          // clinical data at all. That is the correction workflow -- fix a wrong Age in the
          // CSV, re-pick it, press Load -- and Load fills only BLANKS, so "clinical data
          // linked" would describe a write that did not happen. Say what happened instead,
          // and name the control that does overwrite.
          : (added === 0 && updated === 0 && join.matched > 0
            ? ` · CSV matched ${join.matched} row${join.matched === 1 ? '' : 's'}; no blank fields to fill (use Import from CSV to replace existing values)`
            : ` · clinical data linked (${join.matched} matched`
              + (join.unmatched ? `, ${join.unmatched} unmatched` : '')
              + (join.duplicates ? `, ${join.duplicates} duplicate study_id` : '')
              + (join.ambiguous ? `, ${join.ambiguous} ambiguous filename` : '')
              + ')')))
      : '');
}

export function render(state) {
  const inner = el('div', { class: 'workspace-page-inner' });
  const root = el('main', { class: 'workspace-page' }, inner);

  // SCREEN_KEYS carries no ws* key, so this screen rebuilds itself after each of its own
  // setState calls. Every caller is a DOM event handler, never a store subscriber.
  function refresh(live = getState()) {
    mount(inner, buildScreen(live));
  }

  async function onChooseFolder() {
    try {
      const folder = await chooseFolder();
      if (!folder) return;
      const { files, skipped } = await scanFolder(folder);
      lastScan = { folder, skipped };
      setState({ wsFolder: folder, wsFiles: files });
      refresh();
    } catch (error) {
      showToast(`Could not read folder: ${error.message}`);
    }
  }

  async function onChooseCsv() {
    try {
      const csvPath = await chooseCsv();
      if (!csvPath) return;
      const text = await readCsv(csvPath);
      const { headers, rows } = parse(text);
      // A fresh file means fresh defaults: manual overrides never leak across loads.
      setState({ wsCsv: csvPath, wsCsvHeaders: headers, wsCsvRows: rows, wsMapping: autoMap(headers) });
      refresh();
      if (!findJoinHeader(headers)) {
        showToast('This CSV has no study_id column — rows cannot be linked to films.');
      }
      if (new Set(headers).size !== headers.length || headers.includes('')) {
        showToast('The CSV has duplicate or blank column names; those columns cannot be mapped reliably.');
      }
    } catch (error) {
      showToast(`Could not read CSV: ${error.message}`);
    }
  }

  // One new-array setState; the subscribed saver persists it. screen: 'studies' is spec 9.3
  // ("then navigates to Studies"); openId is left alone -- no study is opened. `fields` goes in
  // the SAME setState as the studies it describes: the drawer renders its columns from
  // `fields`, so a load that wrote clinical values without seeding them shows NO FIELDS over
  // values that are already on the record and on disk.
  function onLoadWorkspace() {
    const live = getState();
    if (!live.wsFolder) return;
    const result = loadWorkspaceStudies(live);
    setState({
      studies: result.studies,
      fields: workspaceLoadedFields(live.fields, result.studies),
      screen: 'studies',
    });
    showToast(workspaceLoadedMessage({ ...result, mapping: live.wsMapping }));
  }

  function buildFolderCard(live) {
    const hasFolder = Boolean(live.wsFolder);
    const n = live.wsFiles.length;
    let meta = 'DICOM, PNG, JPG · subfolders included';
    if (hasFolder) {
      meta = `${n} radiograph${n === 1 ? '' : 's'} found`;
      if (lastScan && lastScan.folder === live.wsFolder) {
        // All three of scan-folder.js's causes are named. It increments the same counter for a
        // link it never follows, a SUBFOLDER IT COULD NOT READ, and an unsupported file, so a
        // legend naming only two of them tells a user whose permission-denied subtree holds
        // forty radiographs that one unsupported file was skipped.
        meta += ` · ${lastScan.skipped} skipped (unsupported files, links, or folders that could not be read)`;
      }
    }
    return el('div', { class: `card workspace-card${hasFolder ? ' workspace-card-set' : ''}` },
      el('div', { class: 'workspace-card-icon', 'aria-hidden': 'true', innerHTML: FOLDER_SVG }),
      el('div', { class: 'workspace-card-text' },
        el('div', { class: 'eyebrow' }, '01 — IMAGE FOLDER'),
        el('div', { class: 'workspace-card-value' }, hasFolder ? live.wsFolder : 'No folder selected'),
        el('div', { class: 'workspace-card-meta' }, meta)),
      el('button', { type: 'button', class: 'btn btn-small', onClick: onChooseFolder },
        hasFolder ? 'Change…' : 'Choose folder…'));
  }

  function buildCsvCard(live) {
    const hasCsv = Boolean(live.wsCsv);
    let meta = 'One row per study, with a study_id column';
    if (hasCsv) {
      const rows = live.wsCsvRows.length;
      const cols = live.wsCsvHeaders.length;
      const joinHeader = findJoinHeader(live.wsCsvHeaders);
      meta = `${rows} row${rows === 1 ? '' : 's'} · ${cols} column${cols === 1 ? '' : 's'} · `
        + (joinHeader ? `matched on ${joinHeader}` : 'no study_id column — rows cannot be matched');
    }
    return el('div', { class: `card workspace-card${hasCsv ? ' workspace-card-set' : ''}` },
      el('div', { class: 'workspace-card-icon', 'aria-hidden': 'true', innerHTML: CSV_SVG }),
      el('div', { class: 'workspace-card-text' },
        el('div', { class: 'eyebrow' }, '02 — CLINICAL DATA CSV · OPTIONAL'),
        el('div', { class: 'workspace-card-value' }, hasCsv ? live.wsCsv : 'No file selected'),
        el('div', { class: 'workspace-card-meta' }, meta)),
      el('button', { type: 'button', class: 'btn btn-small', onClick: onChooseCsv },
        hasCsv ? 'Change…' : 'Choose CSV…'));
  }

  // Each chip's destination is a <select>, not static text. autoMap is a convenience, not an
  // authority: it cannot know that `dx_text` means Diagnosis without a synonym table that
  // would guess wrong elsewhere, so the user gets the final say. Read state.wsMapping (not
  // autoMap) so manual overrides survive a re-render.
  function buildMappingCard(live) {
    const mapping = live.wsMapping;
    const chips = mapping.map((m, index) => {
      const select = el('select', {
        class: 'workspace-chip-select',
        'aria-label': `Map ${m.src}`,
        onChange: (event) => {
          const dest = event.target.value === '' ? null : event.target.value;
          setState((s) => ({
            wsMapping: s.wsMapping.map((row, i) => (i === index ? { ...row, dest } : row)),
          }));
          // Sibling selects drop or re-offer the field this chip just claimed or released,
          // and this chip's own mapped/unmapped styling changes; the change event has
          // already committed, so rebuilding (and losing focus) is acceptable.
          refresh();
        },
      });
      select.append(el('option', { value: '' }, 'Unmapped'));
      for (const field of KNOWN_FIELDS) {
        // A field already claimed by another column is not offered twice.
        const takenElsewhere = mapping.some((other, i) => i !== index && other.dest === field);
        if (takenElsewhere && m.dest !== field) continue;
        select.append(el('option', { value: field }, field));
      }
      select.value = m.dest ?? '';
      return el('div', { class: `workspace-chip ${m.dest ? 'workspace-chip-mapped' : 'workspace-chip-unmapped'}` },
        el('span', { class: 'workspace-chip-src' }, m.src),
        el('span', { class: 'workspace-chip-arrow' }, '→'),
        select);
    });

    // Live preview of the join this mapping would make. Pure, no new state: the same call
    // onLoadWorkspace makes, against the same files, headers, rows and mapping.
    const join = joinClinical({ files: live.wsFiles, headers: live.wsCsvHeaders, rows: live.wsCsvRows, mapping });
    const rows = live.wsCsvRows.length;
    const preview = join.joinHeader === null
      ? 'This CSV has no study_id column, so no row can be linked.'
      : `${join.matched} of ${rows} rows match a film`
        + (join.unmatched ? ` · ${join.unmatched} unmatched` : '')
        + (join.duplicates ? ` · ${join.duplicates} duplicate study_id` : '')
        + (join.ambiguous ? ` · ${join.ambiguous} ambiguous filename` : '')
        + '. Rows that match no film are counted when the workspace loads and are not attached to any study.';

    return el('div', { class: 'card workspace-card workspace-card-stack' },
      el('div', { class: 'eyebrow' }, '03 — COLUMN MAPPING'),
      el('div', { class: 'workspace-chip-row' }, ...chips),
      el('div', { class: 'workspace-card-note' },
        'Rows are matched to films by ',
        el('span', { class: 'workspace-card-code' }, 'study_id'),
        '. ',
        preview));
  }

  // Returns a fragment so the heading, copy, cards and load row are direct children of
  // .workspace-page-inner (the stylesheet's margin-top rules are sibling rules); mount()
  // appends a fragment's children and clears them again on the next refresh.
  function buildScreen(live) {
    const cards = [buildFolderCard(live), buildCsvCard(live)];
    if (live.wsCsv) cards.push(buildMappingCard(live));
    const loadDisabled = !live.wsFolder;

    const fragment = document.createDocumentFragment();
    fragment.append(
      el('h1', { class: 'workspace-heading' }, 'Workspace'),
      el('div', { class: 'workspace-copy' },
        'Point SpineContour at a folder of radiographs and, optionally, a CSV of clinical data. Nothing is uploaded — files are read from disk on this workstation.'),
      el('div', { class: 'workspace-cards' }, ...cards),
      el('div', { class: 'workspace-load-row' },
        el('button', {
          type: 'button', class: 'btn btn-primary workspace-load',
          disabled: loadDisabled, // boolean: el() assigns node.disabled, and '' would coerce to false
          onClick: onLoadWorkspace,
        }, 'Load workspace', el('span', { class: 'btn-icon', innerHTML: ARROW_SVG })),
        el('div', { class: 'workspace-load-hint' },
          loadDisabled
            ? 'Choose an image folder to continue.'
            : 'New films are added to Studies as Processing. Open one and run segmentation from its Analysis screen.')),
    );
    return fragment;
  }

  refresh(state);
  return root;
}
