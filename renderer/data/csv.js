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
