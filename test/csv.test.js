import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../renderer/data/csv.js';

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

test('toCsv leads with the citation and NOT FOR CLINICAL USE comment block', () => {
  const csv = toCsv([], [], {});
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '# Spine Contour export');
  assert.match(lines[1], /Cody Woodhouse, MD/);
  assert.match(lines[1], /Michael Jayasuria, BS/);
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
