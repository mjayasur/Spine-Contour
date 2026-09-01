const MEASUREMENT_COLUMNS = [
  'LL L1-S1', 'PI', 'PT', 'SS', 'PI-LL Mismatch', 'L1PA',
  'LL L2-S1', 'LL L3-S1', 'LL L4-S1', 'LL L5-S1',
];

function measurementValue(study, column) {
  const m = study.measurements;
  if (!m) return '';
  const ll = m.LL;
  // If LL is missing/null, return empty for all measurement columns
  if (!ll) return '';
  switch (column) {
    case 'LL L1-S1': return ll['L1-S1'] ?? '';
    case 'PI': return m.PI ?? '';
    case 'PT': return m.PT ?? '';
    case 'SS': return m.SS ?? '';
    case 'PI-LL Mismatch': {
      if (m.PI == null) return '';
      const value = m.PI - ll['L1-S1'];
      return Number.isFinite(value) ? value : '';
    }
    case 'L1PA': return m.L1PA ?? '';
    case 'LL L2-S1': return ll['L2-S1'] ?? '';
    case 'LL L3-S1': return ll['L3-S1'] ?? '';
    case 'LL L4-S1': return ll['L4-S1'] ?? '';
    case 'LL L5-S1': return ll['L5-S1'] ?? '';
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
