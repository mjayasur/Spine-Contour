/**
 * Clinical data drawer (spec 9.5). Mounted by screens/analysis.js into its
 * `section.clinical-data` host and driven from that screen's update() on every store
 * notification, exactly like components/measurements.js. Rows come from
 * visibleStudies(state) -- [open] in this plan; plan 07 swaps that one expression for the
 * open study plus the comparison study and nothing else here changes.
 *
 * Persistence: this module never imports saveStudies. A cell edit commits ONE new
 * `studies` array through setState and renderer/main.js's subscribed saver writes the
 * real-only list (architecture contract, Persistence). `fields` and `dataOpen` are session
 * state on the store; bootstrap seeds `fields` from the saved clinical keys (Task 6).
 */

import { el, clear } from '../dom.js';
import { getState, setState } from '../store.js';
import { showToast } from './toast.js';
import { KNOWN_FIELDS, joinClinical } from '../data/csv.js';

// 12x12 chevron pointing UP (the drawer is open by default); .clinical-toggle-closed rotates
// it 180deg in CSS. Same construction as sidebar.js's CHEVRON_SVG.
const CHEVRON_UP_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14 L12 8 L18 14"></path></svg>';
// 11x11 upload arrow for the Import button (design-reference/template.html:582).
const UPLOAD_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15 V4"></path><path d="M7.5 8.5 L12 4 L16.5 8.5"></path><path d="M5 19.5 H19"></path></svg>';

const EMPTY_COPY = 'No clinical fields yet — add the fields you want above, or import from the CSV.';
const DEMO_TITLE = 'Demo studies are not saved';
const NO_CSV_TITLE = 'Load a CSV in the Workspace first';

export function fieldCountLabel(fieldCount, studyCount) {
  if (!fieldCount) return 'NO FIELDS';
  return `${fieldCount} FIELD${fieldCount === 1 ? '' : 'S'} · ${studyCount} STUD${studyCount === 1 ? 'Y' : 'IES'}`;
}

function openStudy(state) {
  return state.studies.find((s) => s.id === state.openId) ?? null;
}

// The studies the grid shows, one row each, in row order. Plan 07 replaces this one
// expression with the open study plus the comparison study; every row, and the count
// label, is derived from the array so nothing else in this module assumes a count.
function visibleStudies(state) {
  const open = openStudy(state);
  return open ? [open] : [];
}

function sameKey(a, b) {
  return a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);
}

export function mountClinicalData(host) {
  clear(host);
  let lastKey = null;

  // ---- actions. All run from DOM events, never inside a store subscriber. ----------

  function addField(name) {
    const state = getState();
    if (state.fields.includes(name)) return;
    setState({ fields: [...state.fields, name] });
    refresh();
  }

  // Hides a COLUMN, never data: the name leaves the session's `fields`, every value stays on
  // its record and on disk, and bootstrap seeds `fields` from the stored keys again at the
  // next launch. That is why the control is labelled "Hide" rather than "Remove".
  function removeField(name) {
    setState((s) => ({ fields: s.fields.filter((f) => f !== name) }));
    refresh();
  }

  // ONE new-array write; the record is replaced, never mutated. The saver subscribed in
  // renderer/main.js persists this reference change on its own. The grid must NOT rebuild
  // here: `change` on a text input is dispatched during the BLUR half of the focus update,
  // when document.activeElement is already <body>, so rebuild()'s focus snapshot would come
  // back null and clear(host) would destroy the very cell the user is tabbing or clicking
  // into -- focus would end on <body>, where viewer.js's window keydown handler (its
  // input/select/textarea guard no longer matching) would turn the next arrow key into a
  // landmark nudge. The input already shows the typed value, so pre-arm the gate with the
  // array update() is about to see; any LATER external change to studies still rebuilds.
  function setValue(studyId, field, value) {
    setState((s) => {
      const studies = s.studies.map((study) => {
        if (study.id !== studyId) return study;
        const clinical = { ...study.clinical };
        // An emptied cell removes the key rather than storing '': joinClinical never writes
        // a blank key either, and Task 6 seeds state.fields from the keys that exist, so a
        // stored '' would resurrect the column at every launch with no way to drop it.
        // Non-empty text is stored exactly as typed -- clinical values are never reformatted
        // (the join stores its own values trimmed; typed text keeps whatever spacing it has).
        if (value.trim() === '') delete clinical[field];
        else clinical[field] = value;
        return { ...study, clinical };
      });
      if (lastKey !== null) lastKey = [studies, ...lastKey.slice(1)];
      return { studies };
    });
  }

  function onToggleOpen() {
    setState((s) => ({ dataOpen: !s.dataOpen }));
    refresh();
  }

  // Populates from the workspace CSV in the store (spec 9.5: the button "must not be lying").
  // The join is the same stem rule the Workspace load uses, run for this one film, so a study
  // added through the picker, or a CSV chosen after the folder was loaded, still imports.
  function onImportFromCsv() {
    const state = getState();
    const study = openStudy(state);
    if (!study || study.source !== 'real' || !state.wsCsv) return;
    const join = joinClinical({
      files: [study.fileName],
      headers: state.wsCsvHeaders,
      rows: state.wsCsvRows,
      mapping: state.wsMapping,
    });
    const fromCsv = join.byFile.get(study.fileName);
    if (!fromCsv) {
      showToast(`No CSV row matches ${study.fileName}.`);
      return;
    }
    // A matched row whose mapped cells are all empty imports zero fields; the toast says 0
    // rather than claiming no row matched.
    const keys = Object.keys(fromCsv);
    setState((s) => ({
      studies: s.studies.map((x) => (x.id === study.id
        ? { ...x, clinical: { ...x.clinical, ...fromCsv } }
        : x)),
      fields: [...s.fields, ...keys.filter((key) => !s.fields.includes(key))],
      dataOpen: true,
    }));
    refresh();
    showToast(`Imported ${keys.length} field${keys.length === 1 ? '' : 's'} from CSV`);
  }

  // ---- builders. Pure functions of the state they are handed. ------------------------

  function buildHeader(state, studies, open) {
    const isDemo = open !== null && open.source === 'demo';
    const canImport = open !== null && !isDemo && Boolean(state.wsCsv);
    // No tooltip on the enabled button (screens/analysis.js's Export CSV precedent).
    const importTitle = isDemo ? DEMO_TITLE : (canImport ? '' : NO_CSV_TITLE);
    return el('div', { class: 'clinical-header' },
      el('button', {
        type: 'button',
        class: `icon-btn clinical-toggle${state.dataOpen ? '' : ' clinical-toggle-closed'}`,
        'aria-label': 'Toggle clinical data',
        'aria-expanded': String(state.dataOpen),
        title: 'Toggle clinical data',
        'data-focus-key': 'toggle',
        innerHTML: CHEVRON_UP_SVG,
        onClick: onToggleOpen,
      }),
      el('div', { class: 'clinical-title' }, 'Clinical data'),
      el('div', { class: 'eyebrow clinical-count' }, fieldCountLabel(state.fields.length, studies.length)),
      el('div', { class: 'clinical-spacer' }),
      el('button', {
        type: 'button',
        class: 'btn btn-small clinical-import',
        disabled: !canImport,
        title: importTitle,
        'data-focus-key': 'import',
        onClick: onImportFromCsv,
      },
        el('span', { class: 'btn-icon', innerHTML: UPLOAD_SVG }),
        'Import from CSV'));
  }

  function buildChipRow(state) {
    const available = KNOWN_FIELDS.filter((name) => !state.fields.includes(name));
    const custom = el('input', {
      type: 'text',
      class: 'clinical-custom',
      placeholder: '+ Custom field…',
      'aria-label': 'Add a custom field',
      'data-focus-key': 'custom',
      onKeydown: (event) => {
        if (event.key !== 'Enter') return;
        const name = custom.value.trim();
        if (!name) return;
        addField(name);
        // addField's refresh() rebuilt the row, so `custom` is now the detached old node.
        // Clear and focus the LIVE input so several custom fields can be added in a row;
        // for a duplicate name (no rebuild) this is the same node and just clears it.
        const live = host.querySelector('.clinical-custom');
        if (live) { live.value = ''; live.focus(); }
      },
    });
    return el('div', { class: 'clinical-chip-row' },
      el('div', { class: 'eyebrow' }, 'ADD FIELD'),
      ...available.map((name) => el('button', {
        type: 'button',
        class: 'clinical-chip',
        'data-focus-key': `chip:${name}`,
        onClick: () => addField(name),
      }, el('span', { class: 'clinical-chip-plus' }, '+'), name)),
      custom);
  }

  function buildGrid(state, studies) {
    if (state.fields.length === 0) return el('div', { class: 'clinical-empty' }, EMPTY_COPY);

    const head = el('div', { class: 'clinical-grid-row clinical-grid-head' },
      el('div', { class: 'clinical-grid-cell' }, 'STUDY'),
      ...state.fields.map((name) => el('div', { class: 'clinical-grid-cell' },
        el('span', {}, name.toUpperCase()),
        el('button', {
          type: 'button',
          class: 'clinical-remove',
          'aria-label': `Hide ${name}`,
          title: 'Hide field — values are kept',
          'data-focus-key': `remove:${name}`,
          onClick: () => removeField(name),
        }, '×'))));

    const rows = studies.map((study) => {
      // Demo records are never written (the saver filters them), so an edit would silently
      // vanish at the next launch. Say so instead of accepting it.
      const isDemo = study.source === 'demo';
      return el('div', { class: 'clinical-grid-row' },
        el('div', { class: 'clinical-grid-cell clinical-grid-id' }, study.id),
        ...state.fields.map((name) => el('input', {
          type: 'text',
          class: 'clinical-cell',
          // A present value renders as itself -- String() keeps a numeric 0 from a hand-edited
          // store visible; only null/undefined is absent, and absent shows the placeholder.
          value: study.clinical?.[name] != null ? String(study.clinical[name]) : '',
          placeholder: '—',
          'aria-label': `${study.id} ${name}`,
          'data-focus-key': `cell:${study.id}:${name}`,
          // The cell's identity, readable back off the node after a rebuild replaced it.
          // Both go through setAttribute (they are not node properties), which is why they
          // are written as attribute names and not as a forbidden `dataset` prop.
          'data-study-id': study.id,
          'data-field': name,
          disabled: isDemo,
          title: isDemo ? DEMO_TITLE : undefined,
          onChange: (event) => setValue(study.id, name, event.target.value),
        })));
    });

    const grid = el('div', { class: 'clinical-grid' }, head, ...rows);
    // A CSS custom property set AFTER construction. `style` must never be an el() prop: the
    // `key in node` branch would assign to the read-only CSSStyleDeclaration and throw.
    grid.style.setProperty('--clinical-cols', `110px repeat(${state.fields.length}, minmax(150px, 1fr))`);
    return grid;
  }

  // ---- rebuild -------------------------------------------------------------------------

  function rebuild(state) {
    const studies = visibleStudies(state);
    const open = openStudy(state);

    // Focus snapshot. clear(host) destroys the focused node and the HTML focus spec then
    // drops document.activeElement to <body>; same fix as measurements.js: remember the
    // node's stable data-focus-key, rebuild, focus the node that now carries it. Only when
    // focus is inside this host -- a rebuild must never steal focus from elsewhere.
    // A focused TEXT FIELD carries more than focus: `change` has not fired yet, so what the
    // user has typed is on the node and nowhere else, and the rebuilt cell would render the
    // older store value. Snapshot the live value and the caret for the two editable controls
    // and put them back below, so a rebuild triggered from OUTSIDE this component (a run
    // finishing, another screen's setState) cannot eat a half-typed cell.
    const active = document.activeElement;
    const inHost = host.contains(active);
    const focusKey = inHost ? active.getAttribute('data-focus-key') : null;
    let typed = null;
    if (inHost && active.classList.contains('clinical-cell')) {
      typed = {
        studyId: active.getAttribute('data-study-id'),
        field: active.getAttribute('data-field'),
        value: active.value,
        selectionStart: active.selectionStart,
        selectionEnd: active.selectionEnd,
      };
    } else if (inHost && active.classList.contains('clinical-custom')) {
      typed = {
        custom: true,
        value: active.value,
        selectionStart: active.selectionStart,
        selectionEnd: active.selectionEnd,
      };
    }

    clear(host);
    host.append(buildHeader(state, studies, open));
    if (state.dataOpen) {
      host.append(el('div', { class: 'clinical-body' }, buildChipRow(state), buildGrid(state, studies)));
    }

    // The typing restore runs first and wins: it is the only path that carries a value the
    // store does not have yet. Nodes are compared attribute by attribute rather than through
    // a built selector -- a custom field name is user text and could carry a quote.
    if (typed) {
      let field = null;
      if (typed.custom) {
        field = host.querySelector('.clinical-custom');
      } else {
        for (const candidate of host.querySelectorAll('.clinical-cell')) {
          if (candidate.getAttribute('data-study-id') === typed.studyId
            && candidate.getAttribute('data-field') === typed.field) { field = candidate; break; }
        }
      }
      if (field && !field.disabled) {
        field.value = typed.value;
        // Both controls are type="text", so setSelectionRange is supported; a null selection
        // (never seen on a text input, but cheap to tolerate) just skips the caret restore.
        if (typed.selectionStart !== null && typed.selectionEnd !== null) {
          field.setSelectionRange(typed.selectionStart, typed.selectionEnd);
        }
        field.focus();
        return;
      }
      // The cell or the field is gone (the study left visibleStudies, the column was hidden,
      // the drawer collapsed): fall through to the plain focus-key restore below.
    }

    if (focusKey !== null) {
      let target = null;
      for (const candidate of host.querySelectorAll('[data-focus-key]')) {
        if (candidate.getAttribute('data-focus-key') === focusKey) { target = candidate; break; }
      }
      // The focused control itself may be gone (a clicked chip, the × of the hidden field,
      // the body of a collapsed drawer); the toggle always exists.
      if (!target) target = host.querySelector('.clinical-toggle');
      if (target && typeof target.focus === 'function') target.focus();
    }
  }

  // Rebuild gate. screens/analysis.js calls this on EVERY store notification, including
  // every pointermove pan frame; without it a pan would tear down the grid's inputs per
  // frame. rebuild() carries focus, the typed value and the caret across a rebuild that does
  // happen, but not rebuilding at all is cheaper and steadier. Compared by reference:
  // `studies` and `fields` are replaced wholesale, never mutated. `wsCsv` is in the key because the
  // Import button's disabled state reads it.
  function update() {
    const state = getState();
    const key = [state.studies, state.fields, state.dataOpen, state.openId, state.compareId, state.wsCsv];
    if (sameKey(key, lastKey)) return;
    lastKey = key;
    rebuild(state);
  }

  // Forced rebuild after this component's own actions. When the drawer is mounted through
  // screens/analysis.js the store notification has usually rebuilt already (each action
  // changes a key); this pass is the guarantee that does not depend on who is subscribed.
  function refresh() {
    lastKey = null;
    update();
  }

  return { update };
}
