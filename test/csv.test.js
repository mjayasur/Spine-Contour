import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, parse, autoMap, KNOWN_FIELDS, fileStem, findJoinHeader, joinClinical, clinicalFieldNames } from '../renderer/data/csv.js';

function study(overrides) {
  return {
    id: 'SP-1000',
    source: 'real',
    filePath: 'C:/films/a.dcm',
    fileName: 'a.dcm',
    addedAt: '2026-08-31T00:00:00Z',
    view: 'Standing lateral',
    thumbnail: null,
    measurements: null,
    geometry: null,
    qc: null,
    clinical: {},
    ...overrides,
  };
}

test('toCsv leads with the attribution and NOT FOR CLINICAL USE comment block', () => {
  const csv = toCsv([], [], {});
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '# Spine Contour export');
  assert.match(lines[1], /^# Created by /);
  assert.match(lines[1], /Cody Woodhouse, MD/);
  assert.match(lines[1], /Michael Jayasuriya, BS/);
  // The export names its authors; it does not demand a citation. Pinned so the old wording
  // cannot come back by accident -- a paper will be cited here when there is one.
  assert.doesNotMatch(lines[1], /citation/i);
  assert.match(lines[2], /NOT FOR CLINICAL USE/);
});

test('toCsv excludes demo studies by default and includes them with opts.includeDemo', () => {
  const studies = [study({ id: 'SP-1000', source: 'real' }), study({ id: 'SP-0030', source: 'demo' })];
  const excluded = toCsv(studies, [], {});
  assert.ok(excluded.includes('SP-1000'));
  assert.ok(!excluded.includes('SP-0030'));
  const included = toCsv(studies, [], { includeDemo: true });
  assert.ok(included.includes('SP-0030'));
});

test('toCsv exports absent measurements as empty cells, never 0', () => {
  const csv = toCsv([study({ measurements: null })], [], {});
  const dataLine = csv.split('\r\n').find((line) => line.startsWith('SP-1000'));
  const cells = dataLine.split(',');
  // Study ID, Source, View, then the ten measurement columns.
  for (let i = 3; i < 3 + 10; i += 1) assert.equal(cells[i], '');
});

test('toCsv exports real measurements including the derived PI-LL mismatch column', () => {
  const measurements = {
    SS: 38.2, PI: 52.7, PT: 14.6, L1PA: 21.3,
    LL: { 'L1-S1': 47.1, 'L2-S1': 40.0, 'L3-S1': 30.5, 'L4-S1': 18.2, 'L5-S1': 6.4 },
  };
  const csv = toCsv([study({ measurements })], [], {});
  const header = csv.split('\r\n')[3].split(',');
  const dataLine = csv.split('\r\n')[4].split(',');
  const mismatchIndex = header.indexOf('PI-LL Mismatch');
  assert.ok(Math.abs(Number(dataLine[mismatchIndex]) - (52.7 - 47.1)) < 1e-9);
});

test('toCsv appends one column per clinical field and quotes fields containing commas', () => {
  const csv = toCsv(
    [study({ clinical: { Diagnosis: 'Spondylolisthesis, grade 2' } })],
    ['Diagnosis'],
    {},
  );
  const dataLine = csv.split('\r\n').find((line) => line.startsWith('SP-1000'));
  assert.ok(dataLine.includes('"Spondylolisthesis, grade 2"'));
});

test('toCsv is safe against incompletely populated measurements', () => {
  // Study with LL absent but PI/PT/SS/L1PA present: those values should export, LL-dependent columns empty
  const missingLl = study({ id: 'SP-2000', measurements: { PI: 52.7, PT: 14.6, SS: 38.2, L1PA: 21.3 } });
  const csvNoLl = toCsv([missingLl], [], {});
  const headerNoLl = csvNoLl.split('\r\n')[3].split(',');
  const dataLineNoLl = csvNoLl.split('\r\n')[4].split(',');

  // PI, PT, SS, L1PA should have their real values
  const piIndex = headerNoLl.indexOf('PI');
  const ptIndex = headerNoLl.indexOf('PT');
  const ssIndex = headerNoLl.indexOf('SS');
  const l1paIndex = headerNoLl.indexOf('L1PA');
  assert.equal(dataLineNoLl[piIndex], '52.7');
  assert.equal(dataLineNoLl[ptIndex], '14.6');
  assert.equal(dataLineNoLl[ssIndex], '38.2');
  assert.equal(dataLineNoLl[l1paIndex], '21.3');

  // Five LL* and PI-LL Mismatch should be empty
  const llL1Index = headerNoLl.indexOf('LL L1-S1');
  const llL2Index = headerNoLl.indexOf('LL L2-S1');
  const llL3Index = headerNoLl.indexOf('LL L3-S1');
  const llL4Index = headerNoLl.indexOf('LL L4-S1');
  const llL5Index = headerNoLl.indexOf('LL L5-S1');
  const mismatchIndex = headerNoLl.indexOf('PI-LL Mismatch');
  assert.equal(dataLineNoLl[llL1Index], '');
  assert.equal(dataLineNoLl[llL2Index], '');
  assert.equal(dataLineNoLl[llL3Index], '');
  assert.equal(dataLineNoLl[llL4Index], '');
  assert.equal(dataLineNoLl[llL5Index], '');
  assert.equal(dataLineNoLl[mismatchIndex], '');

  // Study with LL present but PI absent: LL values export, PI-LL Mismatch empty, no NaN
  const missingPi = study({ id: 'SP-2001', measurements: { PT: 14.6, SS: 38.2, L1PA: 21.3, LL: { 'L1-S1': 47.1, 'L2-S1': 40.0, 'L3-S1': 30.5, 'L4-S1': 18.2, 'L5-S1': 6.4 } } });
  const csvNoPi = toCsv([missingPi], [], {});
  assert.ok(!csvNoPi.includes('NaN'));
  const headerNoPi = csvNoPi.split('\r\n')[3].split(',');
  const dataLineNoPi = csvNoPi.split('\r\n')[4].split(',');

  // PI should be empty
  const piIndexNoPi = headerNoPi.indexOf('PI');
  assert.equal(dataLineNoPi[piIndexNoPi], '');

  // PI-LL Mismatch should be empty (needs PI)
  const mismatchIndexNoPi = headerNoPi.indexOf('PI-LL Mismatch');
  assert.equal(dataLineNoPi[mismatchIndexNoPi], '');

  // Five LL* should still have values
  const llL1IndexNoPi = headerNoPi.indexOf('LL L1-S1');
  const llL2IndexNoPi = headerNoPi.indexOf('LL L2-S1');
  const llL3IndexNoPi = headerNoPi.indexOf('LL L3-S1');
  const llL4IndexNoPi = headerNoPi.indexOf('LL L4-S1');
  const llL5IndexNoPi = headerNoPi.indexOf('LL L5-S1');
  assert.ok(Math.abs(Number(dataLineNoPi[llL1IndexNoPi]) - 47.1) < 1e-9);
  assert.ok(Math.abs(Number(dataLineNoPi[llL2IndexNoPi]) - 40.0) < 1e-9);
  assert.ok(Math.abs(Number(dataLineNoPi[llL3IndexNoPi]) - 30.5) < 1e-9);
  assert.ok(Math.abs(Number(dataLineNoPi[llL4IndexNoPi]) - 18.2) < 1e-9);
  assert.ok(Math.abs(Number(dataLineNoPi[llL5IndexNoPi]) - 6.4) < 1e-9);
});

test('toCsv rounds the derived PI-LL mismatch to one decimal, clearing float noise', () => {
  const measurements = {
    SS: 42.7, PI: 48.6, PT: 5.9, L1PA: 3.8,
    LL: { 'L1-S1': 49.0, 'L2-S1': 40.0, 'L3-S1': 30.5, 'L4-S1': 18.2, 'L5-S1': 6.4 },
  };
  const csv = toCsv([study({ measurements })], [], {});
  const header = csv.split('\r\n')[3].split(',');
  const dataLine = csv.split('\r\n')[4].split(',');
  const mismatchIndex = header.indexOf('PI-LL Mismatch');
  assert.equal(dataLine[mismatchIndex], '-0.4');
  assert.ok(!csv.includes('-0.3999999999999986'));
  assert.ok(!/\.\d{2,}/.test(csv.replace(/^#.*$/gm, '')));
});

test('toCsv exports a real measured 0 as 0, not an empty cell', () => {
  const measurements = {
    SS: 0, PI: 52.7, PT: 14.6, L1PA: 21.3,
    LL: { 'L1-S1': 0, 'L2-S1': 40.0, 'L3-S1': 30.5, 'L4-S1': 18.2, 'L5-S1': 6.4 },
  };
  const csv = toCsv([study({ measurements })], [], {});
  const header = csv.split('\r\n')[3].split(',');
  const dataLine = csv.split('\r\n')[4].split(',');
  const ssIndex = header.indexOf('SS');
  const llL1Index = header.indexOf('LL L1-S1');
  assert.equal(dataLine[ssIndex], '0');
  assert.equal(dataLine[llL1Index], '0');
});

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

test('parse handles quoted fields with embedded commas and doubled quotes', () => {
  const { headers, rows } = parse('name,note\n"Doe, Jane","Says ""hi"" often"\n');
  assert.deepEqual(headers, ['name', 'note']);
  assert.deepEqual(rows, [{ name: 'Doe, Jane', note: 'Says "hi" often' }]);
});

test('parse handles embedded newlines inside quoted fields', () => {
  const { headers, rows } = parse('id,notes\r\n1,"line one\nline two"\r\n2,plain\r\n');
  assert.deepEqual(headers, ['id', 'notes']);
  assert.deepEqual(rows, [
    { id: '1', notes: 'line one\nline two' },
    { id: '2', notes: 'plain' },
  ]);
});

test('parse handles CRLF line endings', () => {
  const { headers, rows } = parse('a,b\r\n1,2\r\n3,4\r\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});

test("parse fills '' for a trailing empty cell and for a row shorter than the header", () => {
  const { headers, rows } = parse('a,b,c\n1,2,\n');
  assert.deepEqual(headers, ['a', 'b', 'c']);
  assert.deepEqual(rows, [{ a: '1', b: '2', c: '' }]);
  // A row that simply stops short of the header fills '' too, never undefined.
  assert.deepEqual(parse('a,b,c\n1,2\n').rows, [{ a: '1', b: '2', c: '' }]);
});

test('parse on a header-only file returns zero data rows, with or without a trailing newline', () => {
  const withNewline = parse('study_id,age,sex\n');
  assert.deepEqual(withNewline.headers, ['study_id', 'age', 'sex']);
  assert.deepEqual(withNewline.rows, []);
  const withoutNewline = parse('study_id,age,sex');
  assert.deepEqual(withoutNewline.headers, ['study_id', 'age', 'sex']);
  assert.deepEqual(withoutNewline.rows, []);
});

test('parse strips a leading UTF-8 BOM so the first header is clean', () => {
  // Excel's "CSV UTF-8" writes U+FEFF first; Node's readFile(path, 'utf8') keeps it.
  const { headers, rows } = parse('\uFEFFa,b\r\n1,2\r\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});

test('parse treats a double quote inside an unquoted field as a literal character', () => {
  // A quote opens quoted mode only while the field so far is empty or whitespace (RFC 4180
  // plus a leading-space tolerance). An inch mark arrives after real text, so it must not
  // swallow every following row into one cell.
  const { headers, rows } = parse('a,b\n1,5\'11"\n2,x\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '5\'11"' }, { a: '2', b: 'x' }]);
});

test('parse opens a quoted field after leading whitespace and discards the padding', () => {
  // Hand-edited and Excel-exported CSVs both write `, "Doe, Jane"`. The space before the
  // quote is padding, not data: the quote still opens, and the value carries no leading space.
  assert.deepEqual(parse('a,b\n1, "Doe, Jane"\n').rows, [{ a: '1', b: 'Doe, Jane' }]);
});

test('parse drops the extra cells of a row longer than the header', () => {
  const { headers, rows } = parse('a,b\n1,2,3\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});

test('parse drops blank and whitespace-only lines instead of treating them as data', () => {
  const { headers, rows } = parse('a,b\n   \n1,2\n\n3,4\n\t\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});

test('parse keeps the first column when two headers share a name', () => {
  const { headers, rows } = parse('a,a\n1,2\n');
  assert.deepEqual(headers, ['a', 'a']);
  assert.deepEqual(rows, [{ a: '1' }]);
});

test('parse treats a lone CR as a line ending', () => {
  const { headers, rows } = parse('a,b\r1,2\r3,4\r');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});

// ---------------------------------------------------------------------------
// autoMap
// ---------------------------------------------------------------------------

test('autoMap matches odi_base -> ODI and age_yrs -> Age and leaves STUDY_ID unmapped', () => {
  const mapping = autoMap(['odi_base', 'age_yrs', 'STUDY_ID']);
  assert.deepEqual(mapping, [
    { src: 'odi_base', dest: 'ODI' },
    { src: 'age_yrs', dest: 'Age' },
    { src: 'STUDY_ID', dest: null },
  ]);
});

test('autoMap leaves tx_plan unmapped — txplan is not a prefix of treatmentplan', () => {
  assert.deepEqual(autoMap(['tx_plan']), [{ src: 'tx_plan', dest: null }]);
});

test('autoMap leaves dx_text unmapped — there is no synonym table', () => {
  // "dx" is a common clinical abbreviation for diagnosis, but autoMap only tests whether
  // the stripped, lowercased known-field name is a literal prefix of the stripped header.
  // "dxtext" is not a prefix of "diagnosis", nor the reverse, so this column comes back
  // unmapped like any other unrecognised header. Teaching it dx would force teaching it tx.
  assert.deepEqual(autoMap(['dx_text']), [{ src: 'dx_text', dest: null }]);
});

test('autoMap matches an exact, case-insensitive field name', () => {
  assert.deepEqual(autoMap(['diagnosis', 'NOTES']), [
    { src: 'diagnosis', dest: 'Diagnosis' },
    { src: 'NOTES', dest: 'Notes' },
  ]);
});

test('autoMap returns an empty array for an empty header list', () => {
  assert.deepEqual(autoMap([]), []);
});

test('autoMap lets the first header claim a known field; a later match comes back unmapped', () => {
  assert.deepEqual(autoMap(['odi_base', 'odi_6mo']), [
    { src: 'odi_base', dest: 'ODI' },
    { src: 'odi_6mo', dest: null },
  ]);
});

test('autoMap leaves a blank header unmapped', () => {
  // A trailing comma in the header line yields a '' column; it cannot be mapped honestly.
  assert.deepEqual(autoMap(['', 'age']), [
    { src: '', dest: null },
    { src: 'age', dest: 'Age' },
  ]);
});

test('autoMap maps agent -> Age: the known cost of the prefix rule, corrected in the mapping chip', () => {
  // "age" is a prefix of "agent". This is documented, not a bug: the rule has no word
  // boundaries and no synonym table, and the user overrides it in the Workspace chip.
  assert.deepEqual(autoMap(['agent']), [{ src: 'agent', dest: 'Age' }]);
});

// ---------------------------------------------------------------------------
// KNOWN_FIELDS
// ---------------------------------------------------------------------------

test('KNOWN_FIELDS lists exactly the nine clinical fields in order', () => {
  assert.deepEqual(KNOWN_FIELDS, ['Age', 'Sex', 'BMI', 'Diagnosis', 'ODI',
    'Treatment plan', 'Surgical history', 'Follow-up', 'Notes']);
});

// ---------------------------------------------------------------------------
// fileStem
// ---------------------------------------------------------------------------

test('fileStem returns the basename without its last extension, for either path separator', () => {
  assert.equal(fileStem('C:\\films\\batch\\a.b.dcm'), 'a.b');
  assert.equal(fileStem('/films/batch/SP001.PNG'), 'SP001');
  assert.equal(fileStem('SP002.jpeg'), 'SP002');
});

test('fileStem returns a name without an extension unchanged', () => {
  assert.equal(fileStem('noext'), 'noext');
  assert.equal(fileStem('C:/films/noext'), 'noext');
});

// ---------------------------------------------------------------------------
// findJoinHeader
// ---------------------------------------------------------------------------

test('findJoinHeader finds the study_id column under any spelling', () => {
  assert.equal(findJoinHeader(['age', 'study_id']), 'study_id');
  assert.equal(findJoinHeader(['Study ID', 'age']), 'Study ID');
  assert.equal(findJoinHeader(['studyId']), 'studyId');
});

test('findJoinHeader returns null when no header normalises to studyid', () => {
  assert.equal(findJoinHeader(['id', 'age', 'patient_id']), null);
  assert.equal(findJoinHeader([]), null);
});

// ---------------------------------------------------------------------------
// joinClinical
// ---------------------------------------------------------------------------

const JOIN_MAPPING = [
  { src: 'study_id', dest: null },
  { src: 'age_yrs', dest: 'Age' },
];

test('joinClinical matches a row to the film whose stem equals its study_id, case-insensitively', () => {
  const files = ['C:\\films\\SP001.dcm', 'C:\\films\\sub\\sp002.PNG'];
  const join = joinClinical({
    files,
    headers: ['study_id', 'age_yrs'],
    rows: [{ study_id: 'sp001', age_yrs: '58' }, { study_id: 'SP002', age_yrs: '61' }],
    mapping: JOIN_MAPPING,
  });
  assert.equal(join.joinHeader, 'study_id');
  assert.equal(join.matched, 2);
  assert.equal(join.unmatched, 0);
  assert.equal(join.duplicates, 0);
  assert.equal(join.ambiguous, 0);
  assert.deepEqual(join.byFile.get('C:\\films\\SP001.dcm'), { Age: '58' });
  assert.deepEqual(join.byFile.get('C:\\films\\sub\\sp002.PNG'), { Age: '61' });
});

test('joinClinical counts a row with a blank study_id as unmatched', () => {
  const join = joinClinical({
    files: ['a.png'],
    headers: ['study_id', 'age_yrs'],
    rows: [{ study_id: '   ', age_yrs: '58' }, { study_id: '', age_yrs: '61' }],
    mapping: JOIN_MAPPING,
  });
  assert.equal(join.matched, 0);
  assert.equal(join.unmatched, 2);
  assert.equal(join.byFile.size, 0);
});

test('joinClinical with no study_id column links nothing and counts every row as unmatched', () => {
  const join = joinClinical({
    files: ['a.png', 'b.png'],
    headers: ['id', 'age_yrs'],
    rows: [{ id: 'a', age_yrs: '58' }, { id: 'b', age_yrs: '61' }, { id: 'c', age_yrs: '70' }],
    mapping: [{ src: 'id', dest: null }, { src: 'age_yrs', dest: 'Age' }],
  });
  assert.deepEqual(join, {
    joinHeader: null, byFile: new Map(), matched: 0, unmatched: 3, duplicates: 0, ambiguous: 0,
  });
});

test('joinClinical keeps the first row for a repeated study_id and counts the rest as duplicates', () => {
  const join = joinClinical({
    files: ['a.png'],
    headers: ['study_id', 'age_yrs'],
    rows: [{ study_id: 'a', age_yrs: '58' }, { study_id: 'A', age_yrs: '99' }],
    mapping: JOIN_MAPPING,
  });
  assert.equal(join.matched, 1);
  assert.equal(join.duplicates, 1);
  assert.equal(join.unmatched, 0);
  assert.deepEqual(join.byFile.get('a.png'), { Age: '58' });
});

test('joinClinical attaches a row to no film when two films share its stem, and counts it ambiguous', () => {
  const join = joinClinical({
    files: ['C:\\films\\batch1\\SP001.dcm', 'C:\\films\\batch2\\SP001.png'],
    headers: ['study_id', 'age_yrs'],
    rows: [{ study_id: 'SP001', age_yrs: '58' }],
    mapping: JOIN_MAPPING,
  });
  assert.equal(join.ambiguous, 1);
  assert.equal(join.matched, 0);
  assert.equal(join.unmatched, 0);
  assert.equal(join.byFile.size, 0);
});

test('joinClinical copies only mapped columns under their dest names and trims key and values', () => {
  const join = joinClinical({
    files: ['a.png'],
    headers: ['study_id', 'age_yrs', 'sex', 'tx_plan'],
    rows: [{ study_id: ' a ', age_yrs: ' 58 ', sex: 'F', tx_plan: 'Fusion' }],
    mapping: [
      { src: 'study_id', dest: null },
      { src: 'age_yrs', dest: 'Age' },
      { src: 'sex', dest: 'Sex' },
      { src: 'tx_plan', dest: null },
    ],
  });
  assert.equal(join.matched, 1);
  assert.deepEqual(join.byFile.get('a.png'), { Age: '58', Sex: 'F' });
});

test('joinClinical skips empty and whitespace-only values so absent data stays absent', () => {
  const join = joinClinical({
    files: ['a.png'],
    headers: ['study_id', 'age_yrs', 'sex'],
    rows: [{ study_id: 'a', age_yrs: '', sex: '  ' }],
    mapping: [
      { src: 'study_id', dest: null },
      { src: 'age_yrs', dest: 'Age' },
      { src: 'sex', dest: 'Sex' },
    ],
  });
  assert.equal(join.matched, 1);
  assert.deepEqual(join.byFile.get('a.png'), {});
  assert.equal('Age' in join.byFile.get('a.png'), false);
});

// ---------------------------------------------------------------------------
// clinicalFieldNames
// ---------------------------------------------------------------------------

test('clinicalFieldNames lists known fields in KNOWN_FIELDS order, then custom fields in first-seen order', () => {
  const studies = [
    { id: 'SP-1000', clinical: { Notes: 'x', Zeta: '1' } },
    { id: 'SP-1001', clinical: { Age: '58', Alpha: '2' } },
    { id: 'SP-1002', clinical: {} },
  ];
  assert.deepEqual(clinicalFieldNames(studies), ['Age', 'Notes', 'Zeta', 'Alpha']);
});

test('clinicalFieldNames returns [] with no clinical data and never repeats a field', () => {
  assert.deepEqual(clinicalFieldNames([]), []);
  assert.deepEqual(clinicalFieldNames([{ id: 'SP-1000', clinical: {} }, { id: 'SP-0042' }]), []);
  assert.deepEqual(
    clinicalFieldNames([{ id: 'SP-1000', clinical: { Age: '58' } }, { id: 'SP-1001', clinical: { Age: '61' } }]),
    ['Age'],
  );
});
