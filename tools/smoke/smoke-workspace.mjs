// Workspace + clinical data smoke (Task 8 of plan 06). Drives, on a launched app over CDP:
// the folder scan and CSV read through renderer/api.js (display-ready rejections included),
// the Workspace screen seeded from a fixture (cards, chips, the mapping override, the note
// preview), Load workspace twice (added, then already-in-the-library), the clinical data
// drawer on Analysis (Import from CSV, a chip, typing, collapse/expand), the persisted store
// through the bridge, and the two-step delete with its sidecar. Ends with the console-error
// assertion every suite carries. Fixture: tools/smoke/out/workspace-fixture/ (a.png, b.PNG,
// batch/c.jpg, notes.txt) plus tools/smoke/out/workspace-fixture.csv beside it.
//
// PRECONDITIONS
//   * A FRESH scratch profile from `node tools/smoke/launch.mjs` (SPINE_CONTOUR_PYTHON set; the
//     backend must come up for the window to exist, although nothing here segments). The
//     drawer's count label is asserted exactly, which holds only when no persisted record
//     carries clinical values before the load (bootstrap seeds state.fields from them) --
//     true on a fresh profile, before or after smoke-studies.mjs.
//   * NEVER between `smoke-persist.mjs --phase run` and `--phase restart`: this suite writes the
//     store through the saver (three records added, one deleted).
//   * It leaves the app on Studies with two fixture studies (a.png, batch/c.jpg) unsegmented and
//     nothing mounted on Analysis.
//
// NOT DRIVEABLE HERE (Gate 2 human steps): the native folder and CSV pickers, cancelling them,
// and card 01's ` · N skipped (unsupported files, links, or folders that could not be read)`
// clause -- workspace.js records the skipped count in module scope only when ITS folder handler
// ran the scan, and the suite seeds the state directly, so the meta reads `3 radiographs found`
// without the clause.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'out', 'workspace-fixture');
// BESIDE the scanned folder, not inside it: a .csv inside would be a second skipped file and
// the scan would read "3 films, 2 skipped". Same placement as Task 4's and Task 6's fixtures.
const CSV_PATH = path.join(__dirname, 'out', 'workspace-fixture.csv');

// A 1x1 transparent RGBA PNG, 70 bytes. Nothing in this suite decodes a film: the scanner keys on
// the extension, the join on the filename stem, and no fixture study is ever segmented.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Recreated on every run so a stale file can never skew a count. `b.PNG` is upper-case on
// purpose (case-insensitive extensions and stems); `batch/c.jpg` proves recursion; `notes.txt`
// is the one skipped file. The CSV lives beside the folder (see CSV_PATH) and is written the
// way Excel's "CSV UTF-8" writes it -- a BOM and CRLF -- and its rows are: two matches (a, b),
// one row with no film (zzz), and one duplicate study_id (`A` repeats `a` case-insensitively;
// first row wins, the duplicate is counted).
function writeFixture() {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURE, 'batch'), { recursive: true });
  const png = Buffer.from(PNG_1X1, 'base64');
  fs.writeFileSync(path.join(FIXTURE, 'a.png'), png);
  fs.writeFileSync(path.join(FIXTURE, 'b.PNG'), png);
  fs.writeFileSync(path.join(FIXTURE, 'batch', 'c.jpg'), png); // the extension is all the scanner reads
  fs.writeFileSync(path.join(FIXTURE, 'notes.txt'), 'not a film\r\n');
  const csv = '\uFEFFstudy_id,age_yrs,sex,tx_plan\r\n'
    + 'a,58,F,Fusion\r\n'
    + 'b,61,M,Observation\r\n'
    + 'zzz,70,F,Fusion\r\n'
    + 'A,99,F,dup\r\n';
  fs.writeFileSync(CSV_PATH, csv, 'utf8');
}

const EXPECTED_HEADERS = ['study_id', 'age_yrs', 'sex', 'tx_plan'];
const EXPECTED_MAPPING = [
  { src: 'study_id', dest: null },
  { src: 'age_yrs', dest: 'Age' },
  { src: 'sex', dest: 'Sex' },
  { src: 'tx_plan', dest: null },
];
const KNOWN_FIELDS = ['Age', 'Sex', 'BMI', 'Diagnosis', 'ODI', 'Treatment plan', 'Surgical history', 'Follow-up', 'Notes'];

// The join for this fixture: a and b match, zzz is unmatched, A is a duplicate of a.
const NOTE_PREVIEW = '2 of 4 rows match a film · 1 unmatched · 1 duplicate study_id';
const LINKED_CLAUSE = 'clinical data linked (2 matched, 1 unmatched, 1 duplicate study_id)';
// workspaceLoadedMessage: added=3, known=0, updated=0, join present, tx_plan mapped by then.
const TOAST_FIRST_LOAD = `Workspace loaded — 3 studies added · ${LINKED_CLAUSE}`;
// Second load: added=0, known=3, updated=0 -- a and b already carry every CSV key from the
// first load and Load only fills BLANKS, so this load wrote NOTHING. The message says so and
// names the control that does overwrite, instead of the success-shaped `clinical data linked`
// clause; `matched` is still 2 (a and b), which is the number it reports.
const TOAST_SECOND_LOAD = 'Workspace loaded — 0 studies added · 3 already in the library'
  + ' · CSV matched 2 rows; no blank fields to fill (use Import from CSV to replace existing values)';
const CLINICAL_A = { Age: '58', Sex: 'F', 'Treatment plan': 'Fusion' };
const CLINICAL_B = { Age: '61', Sex: 'M', 'Treatment plan': 'Observation' };
const NOTE_TEXT = 'smoke note';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
}

// Key-order-insensitive deep equality: clinical objects reach us in mapping order from the
// store and in whatever order JSON.parse kept from the file.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const idPlus = (base, k) => `SP-${String(Number(base.slice(3)) + k).padStart(4, '0')}`;

const cdp = await connect();

const text = (selector) => cdp.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.textContent : null; })()`);
const rowCount = () => cdp.evaluate("document.querySelectorAll('.studies-row').length");
const summaryParts = async () => {
  const m = /^(\d+) STUDIES · (\d+) IN QUEUE$/.exec(((await text('.studies-summary')) || '').trim());
  return m ? { studies: Number(m[1]), queued: Number(m[2]) } : null;
};
// Client-space centre of the element a page-side finder returns, scrolled into view first (the
// drawer sits at the bottom of Analysis and the load row at the bottom of Workspace).
const rectBy = (finderSource) => cdp.evaluate(`(() => {
  const e = (${finderSource})();
  if (!e) return null;
  e.scrollIntoView({ block: 'center' });
  const r = e.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width, height: r.height };
})()`);

// Polls the store through the page's own module instance, the way smoke-studies.mjs does.
async function waitForState(predicateSource, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`import('./renderer/store.js').then((m) => { const s = m.getState(); return Boolean(${predicateSource}); })`)) return true;
    await cdp.settle(150);
  }
  return false;
}

// The raw store through the bridge, polled until `predicate` holds on it (the saver writes
// asynchronously after each studies change) or the deadline passes; returns the last store read.
async function waitForStore(predicateSource, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let raw = null;
  while (Date.now() < deadline) {
    raw = await cdp.evaluate('window.spineContour.loadStudies()');
    const studies = (raw && raw.studies) || [];
    if ((new Function('studies', `return Boolean(${predicateSource});`))(studies)) return { ok: true, raw };
    await cdp.settle(150);
  }
  return { ok: false, raw };
}

const chipsSnapshot = () => cdp.evaluate(`[...document.querySelectorAll('.workspace-chip')].map((c) => ({
  src: c.querySelector('.workspace-chip-src')?.textContent ?? null,
  mapped: c.classList.contains('workspace-chip-mapped'),
  unmapped: c.classList.contains('workspace-chip-unmapped'),
  value: c.querySelector('.workspace-chip-select')?.value ?? null,
  label: c.querySelector('.workspace-chip-select')?.getAttribute('aria-label') ?? null,
  options: [...c.querySelectorAll('.workspace-chip-select option')].map((o) => o.textContent),
}))`);

// The drawer as it reads: head cells (field names, upper-cased by the component), one entry per
// data row with its inputs in head order, the count label, and the grid's column template.
const drawerGrid = () => cdp.evaluate(`(() => {
  const d = document.querySelector('.clinical-data');
  if (!d) return null;
  const heads = [...d.querySelectorAll('.clinical-grid-head .clinical-grid-cell')].map((c) => (c.querySelector('span') ? c.querySelector('span').textContent : c.textContent));
  const rows = [...d.querySelectorAll('.clinical-grid-row')].filter((r) => !r.classList.contains('clinical-grid-head')).map((r) => ({
    id: r.querySelector('.clinical-grid-id')?.textContent ?? null,
    cells: [...r.querySelectorAll('.clinical-cell')].map((i) => ({ value: i.value, disabled: i.disabled, placeholder: i.placeholder, title: i.title })),
  }));
  return {
    heads,
    rows,
    count: d.querySelector('.clinical-count')?.textContent ?? null,
    cols: d.querySelector('.clinical-grid')?.style.getPropertyValue('--clinical-cols').trim() ?? null,
    removeLabels: [...d.querySelectorAll('.clinical-remove')].map((b) => b.getAttribute('aria-label')),
    chips: [...d.querySelectorAll('.clinical-chip')].map((b) => b.textContent.replace(/^\\+/, '')),
    gridPresent: Boolean(d.querySelector('.clinical-grid')),
    emptyPresent: Boolean(d.querySelector('.clinical-empty')),
  };
})()`);
// { FIELD NAME (upper-cased) -> cell } for the first data row.
function cellsByField(grid) {
  const out = {};
  if (!grid || !grid.rows[0]) return out;
  const fields = grid.heads.slice(1); // heads[0] is STUDY
  fields.forEach((name, i) => { out[name] = grid.rows[0].cells[i] ?? null; });
  return out;
}

try {
  writeFixture();

  // 0. Ready means renderer/main.js's top-level `await loadStudies()` has resolved -- a page target
  // alone is not enough (HANDOFF "three layers of alive is not ready"). The demo studies are
  // merged in at bootstrap, so a resolved store is never empty.
  check('precondition: the store has loaded (studies.length > 0)', await waitForState('s.studies.length > 0', 30000), (await cdp.state()).studies.length);

  // 1. scanFolder through renderer/api.js (the invoke() path, which strips the IPC prefix).
  const scan = await cdp.evaluate(`import('./renderer/api.js').then((m) => m.scanFolder(${JSON.stringify(FIXTURE)}))`);
  check('scanFolder finds 3 films and skips 1 file', scan && scan.files.length === 3 && scan.skipped === 1, scan);
  const scanNames = (scan?.files || []).map((f) => f.split(/[\\/]/).pop());
  check('scan order is a.png, b.PNG, batch/c.jpg (sorted by name, depth-first)',
    same(scanNames, ['a.png', 'b.PNG', 'c.jpg']) && /[\\/]batch[\\/]c\.jpg$/.test(scan?.files?.[2] || ''), scan?.files);
  const emptyFolderMessage = await cdp.evaluate("import('./renderer/api.js').then((m) => m.scanFolder('')).then(() => null, (e) => e.message)");
  check("scanFolder('') rejects with the display-ready message, no IPC prefix", emptyFolderMessage === 'No folder was selected.', emptyFolderMessage);
  const missingCsvMessage = await cdp.evaluate(`import('./renderer/api.js').then((m) => m.readCsv(${JSON.stringify(path.join(FIXTURE, 'missing.csv'))})).then(() => null, (e) => e.message)`);
  check('readCsv on a missing file rejects with the display-ready message', missingCsvMessage === 'The CSV file was not found.', missingCsvMessage);

  // 2. readCsv + parse/autoMap/findJoinHeader in the page, on the BOM + CRLF file.
  const csv = await cdp.evaluate(`(async () => {
    const api = await import('./renderer/api.js');
    const csvMod = await import('./renderer/data/csv.js');
    const raw = await api.readCsv(${JSON.stringify(CSV_PATH)});
    const parsed = csvMod.parse(raw);
    return {
      bom: raw.charCodeAt(0) === 0xFEFF,
      crlf: raw.includes('\\r\\n'),
      headers: parsed.headers,
      rows: parsed.rows,
      mapping: csvMod.autoMap(parsed.headers),
      joinHeader: csvMod.findJoinHeader(parsed.headers),
    };
  })()`);
  check('readCsv returns the raw text (BOM and CRLF intact)', csv.bom === true && csv.crlf === true, { bom: csv.bom, crlf: csv.crlf });
  check('parse strips the BOM: headers are study_id, age_yrs, sex, tx_plan', same(csv.headers, EXPECTED_HEADERS), csv.headers);
  check('parse yields 4 rows; the first is a/58/F/Fusion and the last has study_id A',
    csv.rows.length === 4 && same(csv.rows[0], { study_id: 'a', age_yrs: '58', sex: 'F', tx_plan: 'Fusion' }) && csv.rows[3].study_id === 'A', csv.rows);
  check('autoMap claims Age and Sex, leaves study_id and tx_plan unmapped', same(csv.mapping, EXPECTED_MAPPING), csv.mapping);
  check('findJoinHeader finds study_id', csv.joinHeader === 'study_id', csv.joinHeader);

  // 3. Seed the workspace state the way the two handlers would, then mount the screen. The
  // router remounts only on SCREEN_KEYS, so the ws* keys go in first and `screen` last; starting
  // from Studies also bounces the screen if the app were already on Workspace.
  await cdp.setState('{ ack: true, screen: "studies", query: "" }');
  await cdp.settle();
  const startState = await cdp.state();
  const startCount = startState.studies.length;
  const startSummary = await summaryParts();
  check('precondition: on Studies with a readable summary', startState.screen === 'studies' && startSummary !== null && startSummary.studies === startCount, { screen: startState.screen, startSummary, startCount });
  const baseId = await cdp.evaluate("Promise.all([import('./renderer/store.js'), import('./renderer/data/persistence.js')]).then(([s, p]) => p.nextId(s.getState().studies))");
  check('nextId yields a real id to assign to the first film', /^SP-\d{4,}$/.test(baseId || ''), baseId);
  const ID_A = baseId;
  const ID_B = idPlus(baseId, 1);
  const ID_C = idPlus(baseId, 2);

  await cdp.setState(JSON.stringify({
    wsFolder: FIXTURE, wsFiles: scan.files,
    wsCsv: CSV_PATH, wsCsvHeaders: csv.headers, wsCsvRows: csv.rows, wsMapping: csv.mapping,
  }));
  await cdp.setState('{ screen: "workspace" }');
  await cdp.settle(100);
  let s = await cdp.state();
  check('the Workspace screen mounts', s.screen === 'workspace' && Boolean(await cdp.rect('.workspace-page')), s.screen);
  check('heading reads Workspace', ((await text('.workspace-heading')) || '').trim() === 'Workspace', await text('.workspace-heading'));

  const cards = await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.workspace-card')];
    const read = (c) => (c ? {
      set: c.classList.contains('workspace-card-set'),
      eyebrow: c.querySelector('.eyebrow')?.textContent ?? null,
      value: c.querySelector('.workspace-card-value')?.textContent ?? null,
      meta: c.querySelector('.workspace-card-meta')?.textContent ?? null,
      button: c.querySelector('button.btn')?.textContent ?? null,
    } : null);
    const load = document.querySelector('.workspace-load');
    return {
      count: cards.length, c1: read(cards[0]), c2: read(cards[1]), c3Eyebrow: cards[2]?.querySelector('.eyebrow')?.textContent ?? null,
      loadDisabled: load ? load.disabled : null, loadText: load ? load.textContent.trim() : null,
      hint: document.querySelector('.workspace-load-hint')?.textContent ?? null,
      note: document.querySelector('.workspace-card-note')?.textContent ?? null,
    };
  })()`);
  check('three cards render with the folder and CSV cards in the set state', cards.count === 3 && cards.c1?.set === true && cards.c2?.set === true, cards);
  check('card 01: eyebrow, the folder path, 3 radiographs found, and a Change… button',
    cards.c1?.eyebrow === '01 — IMAGE FOLDER' && cards.c1?.value === FIXTURE && cards.c1?.meta === '3 radiographs found' && cards.c1?.button === 'Change…', cards.c1);
  check('card 02: eyebrow, the CSV path, 4 rows · 4 columns · matched on study_id',
    cards.c2?.eyebrow === '02 — CLINICAL DATA CSV · OPTIONAL' && cards.c2?.value === CSV_PATH && cards.c2?.meta === '4 rows · 4 columns · matched on study_id' && cards.c2?.button === 'Change…', cards.c2);
  check('card 03 is the column mapping card', cards.c3Eyebrow === '03 — COLUMN MAPPING', cards.c3Eyebrow);
  check('the note preview reads the fixture join numbers', typeof cards.note === 'string' && cards.note.includes(NOTE_PREVIEW), cards.note);
  check('Load workspace is enabled (boolean disabled) and the hint describes what happens next',
    cards.loadDisabled === false && cards.loadText === 'Load workspace'
    && cards.hint === 'New films are added to Studies as Processing. Open one and run segmentation from its Analysis screen.', cards);

  let chips = await chipsSnapshot();
  check('four chips in header order', same(chips.map((c) => c.src), EXPECTED_HEADERS), chips.map((c) => c.src));
  check('age_yrs and sex are mapped chips selecting Age and Sex',
    chips[1]?.mapped && !chips[1]?.unmapped && chips[1]?.value === 'Age' && chips[2]?.mapped && chips[2]?.value === 'Sex', [chips[1], chips[2]]);
  check('study_id and tx_plan are unmapped chips with an empty selection',
    chips[0]?.unmapped && !chips[0]?.mapped && chips[0]?.value === '' && chips[3]?.unmapped && chips[3]?.value === '', [chips[0], chips[3]]);
  check('each select is labelled Map <src>', chips.every((c) => c.label === `Map ${c.src}`), chips.map((c) => c.label));
  check('the tx_plan select offers Unmapped plus every known field not claimed elsewhere (no Age, no Sex)',
    same(chips[3]?.options, ['Unmapped', ...KNOWN_FIELDS.filter((f) => f !== 'Age' && f !== 'Sex')]), chips[3]?.options);
  check('the age_yrs select keeps its own Age and omits the Sex claimed by another chip',
    same(chips[1]?.options, ['Unmapped', ...KNOWN_FIELDS.filter((f) => f !== 'Sex')]), chips[1]?.options);

  // The override, dispatched as the DOM would: set the value, fire `change`.
  await cdp.evaluate(`(() => {
    const chip = [...document.querySelectorAll('.workspace-chip')].find((c) => c.querySelector('.workspace-chip-src')?.textContent === 'tx_plan');
    const select = chip.querySelector('.workspace-chip-select');
    select.value = 'Treatment plan';
    select.dispatchEvent(new Event('change'));
  })()`);
  await cdp.settle(100);
  s = await cdp.state();
  check('changing tx_plan to Treatment plan updates wsMapping', s.wsMapping[3]?.src === 'tx_plan' && s.wsMapping[3]?.dest === 'Treatment plan', s.wsMapping);
  chips = await chipsSnapshot();
  check('the tx_plan chip re-renders as mapped and selected', chips[3]?.mapped && !chips[3]?.unmapped && chips[3]?.value === 'Treatment plan', chips[3]);
  check('Treatment plan is no longer offered on the age_yrs select', Array.isArray(chips[1]?.options) && !chips[1].options.includes('Treatment plan'), chips[1]?.options);
  check('the note preview is unchanged by the mapping (the join is by study_id)', ((await text('.workspace-card-note')) || '').includes(NOTE_PREVIEW), await text('.workspace-card-note'));

  // 4. Load workspace: one setState, Studies, the toast, three new records at the top.
  const loadRect = await rectBy("() => document.querySelector('.workspace-load')");
  check('Load workspace has layout', Boolean(loadRect), loadRect);
  await cdp.click(loadRect.cx, loadRect.cy);
  await cdp.settle(150);
  s = await cdp.state();
  check('Load navigates to Studies', s.screen === 'studies', s.screen);
  check('the toast reports 3 studies added and the join numbers', s.toast === TOAST_FIRST_LOAD, s.toast);
  check('studies grew by exactly 3', s.studies.length === startCount + 3, { before: startCount, after: s.studies.length });
  const top = s.studies.slice(0, 3);
  check('the three new records are at the top, in scan order, with consecutive ids from nextId',
    same(top.map((x) => x.id), [ID_A, ID_B, ID_C]) && same(top.map((x) => x.fileName), ['a.png', 'b.PNG', 'c.jpg']) && same(top.map((x) => x.filePath), scan.files), top.map((x) => [x.id, x.fileName, x.filePath]));
  check('each new record is real and unsegmented', top.every((x) => x.source === 'real' && x.measurements === null && x.geometry === null), top.map((x) => [x.source, x.measurements]));
  check('a.png and b.PNG carry their CSV row (Age, Sex, Treatment plan); c.jpg carries {}',
    same(top[0]?.clinical, CLINICAL_A) && same(top[1]?.clinical, CLINICAL_B) && same(top[2]?.clinical, {}), top.map((x) => x.clinical));
  // The same setState seeds the drawer's columns from the keys the load actually wrote.
  // Without this the values above are on the records and on disk while the drawer reads
  // NO FIELDS and Export CSV writes no clinical columns until the next launch.
  check('the load seeds state.fields with the three keys it wrote', same([...s.fields].sort(), ['Age', 'Sex', 'Treatment plan']), s.fields);
  const listAfterLoad = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.studies-row')];
    const row = (id) => document.querySelector('.studies-row[data-study-id="' + id + '"]');
    return {
      firstThree: rows.slice(0, 3).map((r) => ({ id: r.dataset.studyId, proc: Boolean(r.querySelector('.badge-proc')), badge: r.querySelector('.badge')?.textContent ?? null })),
      deleteA: row(${JSON.stringify(ID_A)})?.querySelector('.studies-delete')?.getAttribute('aria-label') ?? null,
      deleteDemo: Boolean(row('SP-0042')?.querySelector('.studies-delete')),
    };
  })()`);
  check('the first three rows are the new studies, badged Processing',
    same(listAfterLoad.firstThree.map((r) => r.id), [ID_A, ID_B, ID_C]) && listAfterLoad.firstThree.every((r) => r.proc && r.badge === 'Processing'), listAfterLoad.firstThree);
  const summaryAfterLoad = await summaryParts();
  check('the summary grew by 3 studies and 3 in queue', summaryAfterLoad && summaryAfterLoad.studies === startCount + 3 && summaryAfterLoad.queued === startSummary.queued + 3, { startSummary, summaryAfterLoad });
  check('a real row has a Delete <id> button; a demo row has none', listAfterLoad.deleteA === `Delete ${ID_A}` && listAfterLoad.deleteDemo === false, listAfterLoad);

  // 5. Load again from the same state: idempotent -- nothing added, the three counted as known.
  await cdp.setState('{ screen: "workspace" }');
  await cdp.settle(100);
  const loadRect2 = await rectBy("() => document.querySelector('.workspace-load')");
  check('Load workspace is back with layout for the second load', Boolean(loadRect2), loadRect2);
  await cdp.click(loadRect2.cx, loadRect2.cy);
  await cdp.settle(150);
  s = await cdp.state();
  check('the second load reports 0 added · 3 already in the library and says it wrote nothing, pointing at Import from CSV', s.screen === 'studies' && s.toast === TOAST_SECOND_LOAD, s.toast);
  check('the second load adds nothing and keeps the same top three', s.studies.length === startCount + 3 && same(s.studies.slice(0, 3).map((x) => x.id), [ID_A, ID_B, ID_C]), s.studies.slice(0, 4).map((x) => x.id));
  check('a.png still carries exactly its CSV row after the second load', same(s.studies[0]?.clinical, CLINICAL_A), s.studies[0]?.clinical);

  // 6. Open a.png: the drawer sits below the viewer/panel row, open, already showing the three
  // columns the load wrote (state.fields was seeded in the load's own setState).
  const rowA = await cdp.rect(`.studies-row[data-study-id="${ID_A}"]`);
  check('the a.png row has layout', Boolean(rowA), rowA);
  await cdp.click(rowA.cx, rowA.cy);
  await cdp.settle(150);
  s = await cdp.state();
  check('clicking the row opens it on Analysis', s.screen === 'analysis' && s.openId === ID_A, { screen: s.screen, openId: s.openId });
  const drawer = await cdp.evaluate(`(() => {
    const d = document.querySelector('.clinical-data');
    const body = document.querySelector('.analysis-body');
    const toggle = d?.querySelector('.clinical-toggle');
    const imp = d?.querySelector('.clinical-import');
    return {
      present: Boolean(d),
      afterBody: Boolean(body) && body.nextElementSibling === d,
      inScreen: Boolean(d) && Boolean(d.parentElement) && d.parentElement.classList.contains('analysis-screen'),
      title: d?.querySelector('.clinical-title')?.textContent ?? null,
      count: d?.querySelector('.clinical-count')?.textContent ?? null,
      expanded: toggle?.getAttribute('aria-expanded') ?? null,
      closedClass: toggle ? toggle.classList.contains('clinical-toggle-closed') : null,
      importDisabled: imp ? imp.disabled : null,
      importText: imp ? imp.textContent.trim() : null,
      empty: Boolean(d?.querySelector('.clinical-empty')),
      grid: Boolean(d?.querySelector('.clinical-grid')),
      chips: [...(d ? d.querySelectorAll('.clinical-chip') : [])].map((b) => b.textContent.replace(/^\\+/, '')),
      custom: d?.querySelector('.clinical-custom')?.placeholder ?? null,
    };
  })()`);
  check('.clinical-data is the third child of the Analysis screen, directly after .analysis-body', drawer.present && drawer.afterBody && drawer.inScreen, drawer);
  check('the drawer header reads Clinical data · 3 FIELDS · 1 STUDY, expanded', drawer.title === 'Clinical data' && drawer.count === '3 FIELDS · 1 STUDY' && drawer.expanded === 'true' && drawer.closedClass === false, drawer);
  check('Import from CSV is enabled for a real study with a workspace CSV', drawer.importDisabled === false && drawer.importText === 'Import from CSV', { importDisabled: drawer.importDisabled, importText: drawer.importText });
  check('the loaded fields render as a grid, with no empty state', drawer.empty === false && drawer.grid === true, { empty: drawer.empty, grid: drawer.grid });
  const loadedGrid = await drawerGrid();
  const loadedCells = cellsByField(loadedGrid);
  check('the columns are AGE, SEX and TREATMENT PLAN, holding the values the load linked',
    loadedGrid && same([...loadedGrid.heads.slice(1)].sort(), ['AGE', 'SEX', 'TREATMENT PLAN'])
    && loadedGrid.rows.length === 1 && loadedGrid.rows[0].id === ID_A
    && loadedCells.AGE?.value === '58' && loadedCells.SEX?.value === 'F' && loadedCells['TREATMENT PLAN']?.value === 'Fusion', { heads: loadedGrid?.heads, loadedCells });
  check('ADD FIELD offers the six known fields that are not columns yet, plus the custom input',
    same(drawer.chips, KNOWN_FIELDS.filter((f) => !['Age', 'Sex', 'Treatment plan'].includes(f))) && drawer.custom === '+ Custom field…', { chips: drawer.chips, custom: drawer.custom });

  // 7. Import from CSV: the matched row's mapped columns are written again, explicitly. The
  // load already filled them, so the three fields and their values are unchanged -- what this
  // proves is that the button reports what it wrote, and joins against the whole scan.
  const importRect = await rectBy("() => document.querySelector('.clinical-import')");
  check('Import from CSV has layout', Boolean(importRect), importRect);
  await cdp.click(importRect.cx, importRect.cy);
  await cdp.settle(150);
  s = await cdp.state();
  check('the import toast counts 3 fields', s.toast === 'Imported 3 fields from CSV', s.toast);
  check('state.fields holds Age, Sex and Treatment plan', same([...s.fields].sort(), ['Age', 'Sex', 'Treatment plan']), s.fields);
  let grid = await drawerGrid();
  let cells = cellsByField(grid);
  check('the grid has one row, for the open study', grid && grid.rows.length === 1 && grid.rows[0].id === ID_A, grid?.rows);
  check('the head row is STUDY then the three fields, each with a Hide button',
    grid && grid.heads[0] === 'STUDY' && same([...grid.heads.slice(1)].sort(), ['AGE', 'SEX', 'TREATMENT PLAN']) && same([...grid.removeLabels].sort(), ['Hide Age', 'Hide Sex', 'Hide Treatment plan']), { heads: grid?.heads, removeLabels: grid?.removeLabels });
  check('AGE, SEX and TREATMENT PLAN cells hold the CSV values, enabled',
    cells.AGE?.value === '58' && cells.SEX?.value === 'F' && cells['TREATMENT PLAN']?.value === 'Fusion' && [cells.AGE, cells.SEX, cells['TREATMENT PLAN']].every((c) => c && c.disabled === false), cells);
  check('the count label reads 3 FIELDS · 1 STUDY', grid?.count === '3 FIELDS · 1 STUDY', grid?.count);
  check('--clinical-cols is set for three fields', grid?.cols === '110px repeat(3, minmax(150px, 1fr))', grid?.cols);
  check('the imported fields leave the ADD FIELD row', same(grid?.chips, KNOWN_FIELDS.filter((f) => !['Age', 'Sex', 'Treatment plan'].includes(f))), grid?.chips);

  // 8. Add the Notes field from its chip.
  const notesChipRect = await rectBy("() => [...document.querySelectorAll('.clinical-chip')].find((b) => b.textContent.replace(/^\\+/, '') === 'Notes')");
  check('the + Notes chip has layout', Boolean(notesChipRect), notesChipRect);
  await cdp.click(notesChipRect.cx, notesChipRect.cy);
  await cdp.settle(100);
  s = await cdp.state();
  grid = await drawerGrid();
  cells = cellsByField(grid);
  check('adding Notes appends it to state.fields', s.fields.length === 4 && s.fields.includes('Notes'), s.fields);
  check('a NOTES column appears, empty, with the — placeholder', cells.NOTES && cells.NOTES.value === '' && cells.NOTES.placeholder === '—', cells.NOTES);
  check('the count label reads 4 FIELDS · 1 STUDY and Notes leaves the chip row', grid?.count === '4 FIELDS · 1 STUDY' && !grid?.chips.includes('Notes'), { count: grid?.count, chips: grid?.chips });

  // 9. Type into the Notes cell and leave it (Tab): `change` commits ONE new record to the store.
  const notesCellRect = await rectBy(`() => {
    const d = document.querySelector('.clinical-data');
    const heads = [...d.querySelectorAll('.clinical-grid-head .clinical-grid-cell')].map((c) => (c.querySelector('span') ? c.querySelector('span').textContent : c.textContent));
    const i = heads.indexOf('NOTES') - 1;
    const row = [...d.querySelectorAll('.clinical-grid-row')].find((r) => !r.classList.contains('clinical-grid-head'));
    return i >= 0 && row ? row.querySelectorAll('.clinical-cell')[i] : null;
  }`);
  check('the NOTES cell has layout', Boolean(notesCellRect), notesCellRect);
  await cdp.click(notesCellRect.cx, notesCellRect.cy);
  await cdp.typeText(NOTE_TEXT);
  await cdp.key('Tab');
  const noteCommitted = await waitForState(`(s.studies.find((x) => x.id === ${JSON.stringify(ID_A)}) || {}).clinical?.Notes === ${JSON.stringify(NOTE_TEXT)}`, 3000);
  s = await cdp.state();
  const recordA = s.studies.find((x) => x.id === ID_A);
  check('leaving the cell writes study.clinical.Notes on the record', noteCommitted === true && recordA?.clinical?.Notes === NOTE_TEXT, recordA?.clinical);
  check('the other fields on the record and the other records are untouched',
    same(recordA?.clinical, { ...CLINICAL_A, Notes: NOTE_TEXT }) && same(s.studies.find((x) => x.id === ID_B)?.clinical, CLINICAL_B) && same(s.studies.find((x) => x.id === ID_C)?.clinical, {}), s.studies.slice(0, 3).map((x) => x.clinical));
  grid = await drawerGrid();
  cells = cellsByField(grid);
  // setValue pre-arms the rebuild gate, so the commit does NOT tear the grid down (a rebuild
  // during the blur-dispatched `change` would strand focus on <body>); the cell the user typed
  // into keeps its value and the next cell keeps the focus Tab just gave it.
  check('the cell still shows the typed note after the commit', cells.NOTES?.value === NOTE_TEXT, cells.NOTES);

  // 10. The persisted store, through the bridge: real records only, with the clinical values.
  const persisted = await waitForStore(`studies.some((x) => x.id === ${JSON.stringify(ID_A)} && x.clinical && x.clinical.Notes === ${JSON.stringify(NOTE_TEXT)})`, 5000);
  const stored = (persisted.raw && persisted.raw.studies) || [];
  check('loadStudies() shows the note persisted on a.png', persisted.ok === true, stored.find((x) => x.id === ID_A)?.clinical);
  check('the store holds real records only (no demo ids, every source real)', stored.length > 0 && stored.every((x) => x.source === 'real' && !/^SP-00\d\d$/.test(x.id)), stored.map((x) => [x.id, x.source]));
  check('the store carries the three fixture records with their clinical values',
    same(stored.find((x) => x.id === ID_A)?.clinical, { ...CLINICAL_A, Notes: NOTE_TEXT }) && same(stored.find((x) => x.id === ID_B)?.clinical, CLINICAL_B) && same(stored.find((x) => x.id === ID_C)?.clinical, {}), [ID_A, ID_B, ID_C].map((id) => stored.find((x) => x.id === id)?.clinical));

  // 11. Chevron: collapse hides the body, expand brings the values back.
  const toggleRect = await rectBy("() => document.querySelector('.clinical-toggle')");
  check('the chevron has layout', Boolean(toggleRect), toggleRect);
  await cdp.click(toggleRect.cx, toggleRect.cy);
  await cdp.settle(100);
  s = await cdp.state();
  const collapsed = await cdp.evaluate(`(() => { const d = document.querySelector('.clinical-data'); const t = d?.querySelector('.clinical-toggle'); return { grid: Boolean(d?.querySelector('.clinical-grid')), body: Boolean(d?.querySelector('.clinical-body')), title: d?.querySelector('.clinical-title')?.textContent ?? null, expanded: t?.getAttribute('aria-expanded') ?? null, closedClass: t ? t.classList.contains('clinical-toggle-closed') : null, count: d?.querySelector('.clinical-count')?.textContent ?? null }; })()`);
  check('collapsing sets dataOpen false, hides the body and keeps the header', s.dataOpen === false && collapsed.grid === false && collapsed.body === false && collapsed.title === 'Clinical data' && collapsed.expanded === 'false' && collapsed.closedClass === true && collapsed.count === '4 FIELDS · 1 STUDY', { dataOpen: s.dataOpen, ...collapsed });
  const toggleRect2 = await rectBy("() => document.querySelector('.clinical-toggle')");
  await cdp.click(toggleRect2.cx, toggleRect2.cy);
  await cdp.settle(100);
  s = await cdp.state();
  grid = await drawerGrid();
  cells = cellsByField(grid);
  check('expanding restores the grid with every value, the note included', s.dataOpen === true && grid?.gridPresent === true && cells.AGE?.value === '58' && cells.NOTES?.value === NOTE_TEXT, { dataOpen: s.dataOpen, cells });

  // 11b. A demo study's cells are disabled and say why (Task 6's walkthrough item, kept here so
  // it is checked on every run). Back to Studies first, the way a user would.
  const backRect = await cdp.rect('.icon-btn[aria-label="Back to studies"]');
  check('back button has layout', Boolean(backRect), backRect);
  await cdp.click(backRect.cx, backRect.cy);
  await cdp.settle(100);
  const demoRow = await cdp.rect('.studies-row[data-study-id="SP-0042"]');
  check('the SP-0042 row has layout', Boolean(demoRow), demoRow);
  await cdp.click(demoRow.cx, demoRow.cy);
  await cdp.settle(150);
  const demoDrawer = await cdp.evaluate(`(() => {
    const d = document.querySelector('.clinical-data');
    const imp = d?.querySelector('.clinical-import');
    const cells = [...(d ? d.querySelectorAll('.clinical-cell') : [])].map((i) => ({ disabled: i.disabled, title: i.title }));
    return { present: Boolean(d), importDisabled: imp ? imp.disabled : null, importTitle: imp ? imp.title : null, cells, count: d?.querySelector('.clinical-count')?.textContent ?? null };
  })()`);
  check('a demo study mounts the drawer with every cell disabled and titled Demo studies are not saved',
    demoDrawer.present && demoDrawer.cells.length === 4 && demoDrawer.cells.every((c) => c.disabled === true && c.title === 'Demo studies are not saved') && demoDrawer.count === '4 FIELDS · 1 STUDY', demoDrawer);
  check('Import from CSV is disabled on a demo study and says why', demoDrawer.importDisabled === true && demoDrawer.importTitle === 'Demo studies are not saved', { importDisabled: demoDrawer.importDisabled, importTitle: demoDrawer.importTitle });
  const backRect2 = await cdp.rect('.icon-btn[aria-label="Back to studies"]');
  await cdp.click(backRect2.cx, backRect2.cy);
  await cdp.settle(100);
  s = await cdp.state();
  check('back on Studies with the three fixture rows still listed', s.screen === 'studies' && (await rowCount()) === startCount + 3, { screen: s.screen, rows: await rowCount() });

  // 12. Delete b.PNG, two steps. A sidecar is written first through the bridge so "the sidecar
  // is gone" is a real assertion: b.PNG was never segmented, and without this the file would be
  // absent before AND after the delete. The stub is never read -- restoreFilm only reads a
  // sidecar for a record with measurements and geometry, and b.PNG has neither.
  const sidecarBefore = await cdp.evaluate(`window.spineContour.savePrediction(${JSON.stringify(ID_B)}, { smoke: 'sidecar' }).then(() => window.spineContour.loadPrediction(${JSON.stringify(ID_B)}))`);
  check('precondition: a sidecar exists for b.PNG', sidecarBefore && sidecarBefore.smoke === 'sidecar', sidecarBefore);
  const countBeforeDelete = (await cdp.state()).studies.length;
  const summaryBeforeDelete = await summaryParts();

  const deleteRect = await rectBy(`() => document.querySelector('.studies-delete[aria-label="Delete ${ID_B}"]')`);
  check('the b.PNG row has a Delete button with layout', Boolean(deleteRect), deleteRect);
  await cdp.click(deleteRect.cx, deleteRect.cy);
  await cdp.settle(100);
  const promptState = () => cdp.evaluate(`(() => {
    const row = document.querySelector('.studies-row[data-study-id="${ID_B}"]');
    if (!row) return null;
    const buttons = [...row.querySelectorAll('button.btn')].map((b) => b.textContent.trim());
    return {
      prompt: row.querySelector('.studies-delete-prompt')?.textContent ?? null,
      confirm: row.querySelector('.studies-delete-confirm')?.textContent.trim() ?? null,
      cancel: buttons.includes('Cancel'),
      deleteButton: Boolean(row.querySelector('.studies-delete')),
    };
  })()`);
  let prompt = await promptState();
  check('the first click shows Delete this study? with Delete and Cancel in place of the action cell',
    prompt && prompt.prompt === 'Delete this study?' && prompt.confirm === 'Delete' && prompt.cancel === true && prompt.deleteButton === false, prompt);
  s = await cdp.state();
  check('the first click deletes nothing and stays on Studies', s.screen === 'studies' && s.studies.length === countBeforeDelete, { screen: s.screen, count: s.studies.length });

  const cancelRect = await rectBy(`() => [...document.querySelector('.studies-row[data-study-id="${ID_B}"]').querySelectorAll('button.btn')].find((b) => b.textContent.trim() === 'Cancel')`);
  check('Cancel has layout', Boolean(cancelRect), cancelRect);
  await cdp.click(cancelRect.cx, cancelRect.cy);
  await cdp.settle(100);
  prompt = await promptState();
  check('Cancel restores the Delete button and removes the prompt', prompt && prompt.prompt === null && prompt.confirm === null && prompt.deleteButton === true, prompt);
  check('the record is still there after Cancel', (await cdp.state()).studies.some((x) => x.id === ID_B), ID_B);

  const deleteRect2 = await rectBy(`() => document.querySelector('.studies-delete[aria-label="Delete ${ID_B}"]')`);
  await cdp.click(deleteRect2.cx, deleteRect2.cy);
  await cdp.settle(100);
  const confirmRect = await rectBy(`() => document.querySelector('.studies-row[data-study-id="${ID_B}"] .studies-delete-confirm')`);
  check('the confirm button has layout', Boolean(confirmRect), confirmRect);
  await cdp.click(confirmRect.cx, confirmRect.cy);
  const removed = await waitForState(`!s.studies.some((x) => x.id === ${JSON.stringify(ID_B)})`, 5000);
  await cdp.settle(150);
  s = await cdp.state();
  check('confirming removes the record from the store', removed === true && s.studies.length === countBeforeDelete - 1, { removed, count: s.studies.length });
  check('the toast reads Deleted <id> and the app stays on Studies', s.toast === `Deleted ${ID_B}` && s.screen === 'studies', { toast: s.toast, screen: s.screen });
  check('a.png and c.jpg survive the delete with their clinical values',
    same(s.studies.find((x) => x.id === ID_A)?.clinical, { ...CLINICAL_A, Notes: NOTE_TEXT }) && s.studies.some((x) => x.id === ID_C), s.studies.slice(0, 3).map((x) => x.id));
  const rowsAfterDelete = await cdp.evaluate(`[...document.querySelectorAll('.studies-row')].map((r) => r.dataset.studyId)`);
  const summaryAfterDelete = await summaryParts();
  check('the row is gone and the summary shrank by one study and one in queue',
    !rowsAfterDelete.includes(ID_B) && rowsAfterDelete.length === countBeforeDelete - 1 && summaryAfterDelete && summaryBeforeDelete
    && summaryAfterDelete.studies === summaryBeforeDelete.studies - 1 && summaryAfterDelete.queued === summaryBeforeDelete.queued - 1, { rowsAfterDelete, summaryBeforeDelete, summaryAfterDelete });
  const sidecarAfter = await cdp.evaluate(`window.spineContour.loadPrediction(${JSON.stringify(ID_B)})`);
  check('loadPrediction returns null for the deleted study (the sidecar is gone)', sidecarAfter === null, sidecarAfter);
  const storeAfterDelete = await waitForStore(`!studies.some((x) => x.id === ${JSON.stringify(ID_B)})`, 5000);
  const storedAfter = (storeAfterDelete.raw && storeAfterDelete.raw.studies) || [];
  check('loadStudies() no longer lists the deleted study and still lists a.png and c.jpg',
    storeAfterDelete.ok === true && storedAfter.some((x) => x.id === ID_A) && storedAfter.some((x) => x.id === ID_C), storedAfter.map((x) => x.id));

  // 13. No console errors or exceptions during the run.
  check('no console errors or exceptions during the run', cdp.errors.length === 0, cdp.errors);
} finally {
  cdp.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${JSON.stringify(r.detail)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
