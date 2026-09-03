/**
 * The nine fabricated demo studies (spec 5, 13.1; architecture contract
 * "renderer/data/demo-studies.js"). Compiled in, never written to disk.
 * Transcribed from the STUDIES array in design-reference/template.html
 * (line 655): p:[a,b,c,d,e] -> a=LL['L1-S1'], b=PI, c=PT, d=SS, e=PI-LL
 * (kept here only as a comment for verification, not stored).
 *
 * L1PA and lumbar-lordosis levels L2-S1..L5-S1 have no source data, so
 * they are omitted (not present as keys) rather than invented. Consumers
 * must render a missing key as "—", never 0 (see data/measurements.js).
 *
 * qc carries only { femoral: { confidence } } -- the design's `conf` field
 * divided by 100. The design's other qc.femoral fields (method,
 * component_count, circle_union_iou, radii_pixels, center_separation_pixels,
 * radius_ratio, qc_pass, foreground_pixels) have no source here and are left
 * absent rather than fabricated; only femoral.confidence is read anywhere in
 * the renderer.
 *
 * The design's `status`, `d` (disc heights), `sp` (slip), `film` and `date`
 * fields are deliberately not transcribed: status is derived, never stored
 * (data/status.js); disc heights and slip are not computed in this build;
 * film is a mockup rendering hint; date is superseded by the ISO addedAt
 * below.
 */

export const DEMO_STUDIES = [
  {
    id: 'SP-0042', source: 'demo', filePath: null, fileName: 'SP-0042.jpg',
    addedAt: '2026-08-21T12:10:00.000Z', view: 'Standing lateral', thumbnail: null,
    // p=[48.2,54.1,18.3,35.8,5.9] -> PT+SS=54.1=PI, PI-LL=5.9
    measurements: { PI: 54.1, PT: 18.3, SS: 35.8, LL: { 'L1-S1': 48.2 } },
    geometry: null,
    qc: { femoral: { confidence: 0.96 } },
    clinical: {},
    pt: 'P-8841', sex: 'F', age: 62, bmi: '27.4', odi: '46',
    dx: 'Anterior slip of L4 on L5 · Meyerding grade I', plan: 'Pending review', hx: 'L3 laminectomy, 2019',
    outcome: 'Awaiting operative decision. Baseline ODI 46.', conf: 96,
  },
  {
    id: 'SP-0041', source: 'demo', filePath: null, fileName: 'SP-0041.jpg',
    addedAt: '2026-08-21T12:00:00.000Z', view: 'Flexion lateral', thumbnail: null,
    // p=[31.7,48.9,22.6,26.3,17.2] -> PT+SS=48.9=PI, PI-LL=17.2
    measurements: { PI: 48.9, PT: 22.6, SS: 26.3, LL: { 'L1-S1': 31.7 } },
    geometry: null,
    qc: { femoral: { confidence: 0.88 } },
    clinical: {},
    pt: 'P-3306', sex: 'M', age: 57, bmi: '31.2', odi: '52',
    dx: 'Flatback with compensatory pelvic retroversion', plan: 'Deformity clinic referral', hx: 'None',
    outcome: 'Referred for deformity workup. ODI 52 at intake.', conf: 88,
  },
  {
    id: 'SP-0039', source: 'demo', filePath: null, fileName: 'SP-0039.jpg',
    addedAt: '2026-08-20T12:00:00.000Z', view: 'Standing lateral', thumbnail: null,
    // p=[52.4,49.8,12.1,37.7,-2.6] -> PT+SS=49.8=PI, PI-LL=-2.6
    measurements: { PI: 49.8, PT: 12.1, SS: 37.7, LL: { 'L1-S1': 52.4 } },
    geometry: null,
    qc: { femoral: { confidence: 0.97 } },
    clinical: {},
    pt: 'P-7712', sex: 'F', age: 15, bmi: '20.8', odi: '51',
    dx: 'Adolescent idiopathic scoliosis, Lenke 1A', plan: 'L4–L5 TLIF', hx: 'None',
    outcome: 'L4–L5 TLIF, posterior instrumentation. ODI 51→22 at 6 mo.', conf: 97,
  },
  {
    id: 'SP-0038', source: 'demo', filePath: null, fileName: 'SP-0038.jpg',
    addedAt: '2026-08-19T12:00:00.000Z', view: 'Extension lateral', thumbnail: null,
    // p=[24.9,52.3,29.8,22.5,27.4] -> PT+SS=52.3=PI, PI-LL=27.4
    measurements: { PI: 52.3, PT: 29.8, SS: 22.5, LL: { 'L1-S1': 24.9 } },
    geometry: null,
    qc: { femoral: { confidence: 0.92 } },
    clinical: {},
    pt: 'P-1054', sex: 'M', age: 71, bmi: '29.6', odi: '58',
    dx: 'Adjacent segment degeneration above prior L5–S1 fusion', plan: 'Extension of construct under discussion', hx: 'L5–S1 PLIF, 2016',
    outcome: 'Construct extension under discussion. ODI 58.', conf: 92,
  },
  {
    id: 'SP-0036', source: 'demo', filePath: null, fileName: 'SP-0036.jpg',
    addedAt: '2026-08-18T12:00:00.000Z', view: 'Standing lateral', thumbnail: null,
    // p=[44.7,55.6,21.4,34.2,10.9] -> PT+SS=55.6=PI, PI-LL=10.9
    measurements: { PI: 55.6, PT: 21.4, SS: 34.2, LL: { 'L1-S1': 44.7 } },
    geometry: null,
    qc: { femoral: { confidence: 0.94 } },
    clinical: {},
    pt: 'P-6420', sex: 'F', age: 44, bmi: '24.1', odi: '42',
    dx: 'Facet arthropathy L4–L5', plan: 'PT + facet injections', hx: 'None',
    outcome: 'Conservative: PT + L4–L5 facet injections. ODI 42→18 at 12 mo.', conf: 94,
  },
  {
    id: 'SP-0035', source: 'demo', filePath: null, fileName: 'SP-0035.jpg',
    addedAt: '2026-08-17T12:00:00.000Z', view: 'Lateral lumbar', thumbnail: null,
    // p=[27.9,46.2,25.1,21.1,18.3] -> PT+SS=46.2=PI, PI-LL=18.3
    measurements: { PI: 46.2, PT: 25.1, SS: 21.1, LL: { 'L1-S1': 27.9 } },
    geometry: null,
    qc: { femoral: { confidence: 0.82 } },
    clinical: {},
    pt: 'P-9013', sex: 'M', age: 66, bmi: '28.3', odi: '49',
    dx: 'Multilevel degenerative disc disease', plan: 'Repeat imaging in 3 mo', hx: 'None',
    outcome: 'Conservative management, repeat imaging at 3 mo. ODI 49.', conf: 82,
  },
  {
    id: 'SP-0033', source: 'demo', filePath: null, fileName: 'SP-0033.jpg',
    addedAt: '2026-08-15T12:00:00.000Z', view: 'Standing lateral', thumbnail: null,
    // p=[44.1,53.0,19.7,33.3,8.9] -> PT+SS=53.0=PI, PI-LL=8.9
    measurements: { PI: 53.0, PT: 19.7, SS: 33.3, LL: { 'L1-S1': 44.1 } },
    geometry: null,
    qc: { femoral: { confidence: 0.93 } },
    clinical: {},
    pt: 'P-2287', sex: 'F', age: 58, bmi: '26.0', odi: '38',
    dx: 'Degenerative disc disease L4–L5', plan: 'PT, activity modification', hx: 'None',
    outcome: 'PT + activity modification. ODI 38→21 at 9 mo.', conf: 93,
  },
  {
    id: 'SP-0031', source: 'demo', filePath: null, fileName: 'SP-0031.jpg',
    addedAt: '2026-08-14T12:00:00.000Z', view: 'Lateral lumbar', thumbnail: null,
    // p=[58.3,57.1,10.2,46.9,-1.2] -> PT+SS=57.1=PI, PI-LL=-1.2
    measurements: { PI: 57.1, PT: 10.2, SS: 46.9, LL: { 'L1-S1': 58.3 } },
    geometry: null,
    qc: { femoral: { confidence: 0.95 } },
    clinical: {},
    pt: 'P-5561', sex: 'M', age: 23, bmi: '22.5', odi: '29',
    dx: 'L5 spondylolysis without slip', plan: 'Bracing, activity restriction', hx: 'None',
    outcome: 'Bracing + activity restriction. ODI 29→9 at 6 mo.', conf: 95,
  },
  {
    id: 'SP-0030', source: 'demo', filePath: null, fileName: 'SP-0030.jpg',
    addedAt: '2026-08-12T12:00:00.000Z', view: 'Standing lateral', thumbnail: null,
    // p=[18.3,44.8,28.4,16.4,26.5] -> PT+SS=44.8=PI, PI-LL=26.5
    measurements: { PI: 44.8, PT: 28.4, SS: 16.4, LL: { 'L1-S1': 18.3 } },
    geometry: null,
    qc: { femoral: { confidence: 0.91 } },
    clinical: {},
    pt: 'P-4178', sex: 'F', age: 69, bmi: '30.1', odi: '61',
    dx: 'Sagittal imbalance after prior L2 compression fracture', plan: 'Osteoporosis workup, deformity clinic', hx: 'T12 kyphoplasty, 2021',
    outcome: 'Osteoporosis workup then staged correction. ODI 61.', conf: 91,
  },
];
