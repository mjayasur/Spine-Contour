const MEASUREMENT_COLUMNS = [
  'LL L1-S1', 'PI', 'PT', 'SS', 'PI-LL Mismatch', 'L1PA',
  'LL L2-S1', 'LL L3-S1', 'LL L4-S1', 'LL L5-S1',
];

// Measurement columns are written to one decimal, matching what the Measurements panel
// displays, so a value read off the screen and the same value in the file agree. It also
// keeps float noise out of the data: PI 48.6 minus LL['L1-S1'] 49.0 computes to
// -0.3999999999999986, and sixteen digits of that beside a clean 48.6 in the same row reads
// as a defect to whoever opens the file. One decimal is finer than the segmentation's own
// accuracy, so nothing meaningful is lost.
function round1(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(1)) : '';
}

function measurementValue(study, column) {
  const m = study.measurements;
  if (!m) return '';
  const ll = m.LL;
  switch (column) {
    case 'LL L1-S1': return round1(ll?.['L1-S1']);
    case 'PI': return round1(m.PI);
    case 'PT': return round1(m.PT);
    case 'SS': return round1(m.SS);
    case 'PI-LL Mismatch': {
      if (!ll || m.PI == null) return '';
      const value = m.PI - ll['L1-S1'];
      return round1(value);
    }
    case 'L1PA': return round1(m.L1PA);
    case 'LL L2-S1': return round1(ll?.['L2-S1']);
    case 'LL L3-S1': return round1(ll?.['L3-S1']);
    case 'LL L4-S1': return round1(ll?.['L4-S1']);
    case 'LL L5-S1': return round1(ll?.['L5-S1']);
    default: return '';
  }
}

function escapeField(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(studies, fields, opts = {}) {
  const includeDemo = opts.includeDemo === true;
  const rows = studies.filter((study) => includeDemo || study.source !== 'demo');

  const citation = [
    '# Spine Contour export',
    '# Citation required for published use: Cody Woodhouse, MD; Michael Jayasuria, BS.',
    '# Investigational software. NOT FOR CLINICAL USE.',
  ];
  const header = ['Study ID', 'Source', 'View', ...MEASUREMENT_COLUMNS, ...fields];

  const lines = [...citation, header.map(escapeField).join(',')];
  for (const study of rows) {
    const cells = [
      study.id,
      study.source,
      study.view,
      ...MEASUREMENT_COLUMNS.map((column) => measurementValue(study, column)),
      ...fields.map((field) => (study.clinical && study.clinical[field] != null ? study.clinical[field] : '')),
    ];
    lines.push(cells.map(escapeField).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// CSV import: parse, auto-map, and the study_id join (plan 06). All pure.
// ---------------------------------------------------------------------------

/** @typedef {{src: string, dest: string|null}} Mapping */

export const KNOWN_FIELDS = ['Age', 'Sex', 'BMI', 'Diagnosis', 'ODI',
  'Treatment plan', 'Surgical history', 'Follow-up', 'Notes'];

// Hand-written RFC 4180 reader. Beyond quoted fields, embedded commas/newlines, doubled
// quotes and CRLF it also: strips a leading UTF-8 BOM (Excel "CSV UTF-8"); opens quoted mode
// ONLY while the field so far is empty or whitespace (that leading padding is discarded), so a
// quote after any other text — a stray inch mark in free text (5'11") — is a literal character
// rather than the start of a quoted run that would swallow every following row;
// ends a line on a lone CR; drops blank and whitespace-only lines; drops the extra cells of
// a row longer than the header and fills '' for a shorter one; and keeps the FIRST column
// when two headers share a name (the same first-wins rule autoMap applies to known fields).
// Values are not trimmed here — joinClinical trims what it copies.
export function parse(text) {
  const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = src.length;

  function pushField() {
    row.push(field);
    field = '';
  }

  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < len) {
    const char = src[i];

    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field.trim() === '') {
      // Field start, or only whitespace so far: `1, "Doe, Jane"` is the quoted form Excel and
      // hand-edited CSVs both produce. The padding before the quote is not data, so drop it.
      field = '';
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }

    if (char === '\r' && src[i + 1] === '\n') {
      pushRow();
      i += 2;
      continue;
    }

    if (char === '\n' || char === '\r') {
      pushRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // A blank or whitespace-only line parses to a single field with no text — drop those rather
  // than letting one become the header row or a data row. (This also drops a legitimate
  // single-column data row whose only value is whitespace; acceptable for this tool.)
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0];
  // First column wins for a duplicated header name. Indexed by NAME, not by `h in obj`: `{}`
  // inherits Object.prototype, so `'toString' in obj` is already true before anything is
  // written and a column headed `constructor`/`toString`/`valueOf`/`hasOwnProperty` would be
  // silently dropped from every row while `headers` still advertised it.
  const firstIndex = new Map();
  headers.forEach((h, idx) => { if (!firstIndex.has(h)) firstIndex.set(h, idx); });
  const dataRows = nonEmpty.slice(1).map((r) => {
    const obj = {};
    for (const [h, idx] of firstIndex) obj[h] = r[idx] !== undefined ? r[idx] : '';
    return obj;
  });

  return { headers, rows: dataRows };
}

function normalizeFieldName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A known field matches a header when the field's normalised name equals, or is a prefix of,
// the header's normalised name: odi_base → ODI, age_yrs → Age, "Diagnosis date" → Diagnosis.
// It is a convenience, not an authority — no synonym table (dx_text and tx_plan stay
// unmapped) and no word boundaries (agent → Age; the user corrects it in the mapping chip).
// Each known field is claimed by at most one header; the first matching header wins and any
// later match comes back unmapped, so one clinical value is never fed by two columns.
export function autoMap(headers) {
  const known = KNOWN_FIELDS.map((field) => ({ field, key: normalizeFieldName(field) }));
  const claimed = new Set();
  return headers.map((src) => {
    const key = normalizeFieldName(src);
    if (key === '') return { src, dest: null };
    const match = known.find((f) => key === f.key || key.startsWith(f.key));
    if (!match || claimed.has(match.field)) return { src, dest: null };
    claimed.add(match.field);
    return { src, dest: match.field };
  });
}

// Basename (either separator) without its last extension: 'a.b.dcm' → 'a.b', 'noext' → 'noext'.
// A leading dot is not an extension ('.hidden' → '.hidden').
export function fileStem(name) {
  const base = String(name).split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

// The join column is whichever header normalises to 'studyid' (study_id, Study ID, studyId…).
// It is found independently of autoMap: study_id is the join key, never a clinical field.
export function findJoinHeader(headers) {
  const found = headers.find((h) => normalizeFieldName(h) === 'studyid');
  return found === undefined ? null : found;
}

// Joins CSV rows to films on the film's filename stem, case-insensitively. A film has no id
// before it is loaded, so its filename is the only identity a row can name. Per row, in
// order: a blank study_id is unmatched; a study_id already seen is a duplicate (the first
// row wins); a stem no film carries is unmatched; a stem two or more films carry is
// ambiguous and attaches to none (a patient's data is never attached to an arbitrary film);
// otherwise the row is matched and every mapping with a dest copies row[src], trimmed,
// skipping empty values so absent data stays absent. byFile is keyed by the exact string
// given in `files`, so the caller reads it back with the same paths it passed in.
export function joinClinical({ files, headers, rows, mapping }) {
  const joinHeader = findJoinHeader(headers);
  if (joinHeader === null) {
    return { joinHeader: null, byFile: new Map(), matched: 0, unmatched: rows.length, duplicates: 0, ambiguous: 0 };
  }

  const filmsByStem = new Map();
  for (const filePath of files) {
    const stem = fileStem(filePath).toLowerCase();
    const list = filmsByStem.get(stem);
    if (list) list.push(filePath);
    else filmsByStem.set(stem, [filePath]);
  }

  const mapped = mapping.filter((m) => m.dest);
  const seen = new Set();
  const byFile = new Map();
  let matched = 0;
  let unmatched = 0;
  let duplicates = 0;
  let ambiguous = 0;

  for (const row of rows) {
    const key = String(row[joinHeader] ?? '').trim().toLowerCase();
    if (key === '') {
      unmatched += 1;
      continue;
    }
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    const films = filmsByStem.get(key);
    if (!films) {
      unmatched += 1;
      continue;
    }
    if (films.length > 1) {
      ambiguous += 1;
      continue;
    }
    matched += 1;
    const clinical = {};
    for (const m of mapped) {
      const value = String(row[m.src] ?? '').trim();
      if (value !== '') clinical[m.dest] = value;
    }
    byFile.set(films[0], clinical);
  }

  return { joinHeader, byFile, matched, unmatched, duplicates, ambiguous };
}

// The union of clinical field names over the studies: KNOWN_FIELDS order first, then custom
// names in first-seen order. Bootstrap seeds state.fields with it so persisted values are
// visible after a restart. A study without a clinical object contributes nothing.
export function clinicalFieldNames(studies) {
  const present = new Set();
  for (const study of studies) {
    const clinical = study && study.clinical;
    if (!clinical || typeof clinical !== 'object') continue;
    for (const name of Object.keys(clinical)) present.add(name);
  }
  const known = KNOWN_FIELDS.filter((name) => present.has(name));
  const custom = [...present].filter((name) => !KNOWN_FIELDS.includes(name));
  return [...known, ...custom];
}
