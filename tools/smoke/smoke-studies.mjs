// Studies screen smoke (Task 7 of plan 05): summary, demo pills/status badges, search
// filtering with caret/focus preservation, opening/leaving a study, adding an unsegmented
// study the way inject-study.js does, and confirming the unsegmented record round-trips
// through window.spineContour.loadStudies(). Precondition: the app is running, any screen.
// The dropzone click (native picker) and a real file drop cannot be driven over CDP; those
// are Gate 1 steps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
}

const rowCount = (cdp) => cdp.evaluate("document.querySelectorAll('.studies-row').length");
const text = (cdp, selector) => cdp.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.textContent : null; })()`);
const clearSearch = (cdp) => cdp.evaluate("(() => { const el = document.querySelector('.studies-search'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })()");

const cdp = await connect();
try {
  // 1. Land on Studies with an empty query; heading, summary shape, row count.
  await cdp.setState('{ ack: true, screen: "studies", query: "" }');
  await cdp.settle();
  let s = await cdp.state();
  check('precondition: on the studies screen', s.screen === 'studies', s.screen);

  const heading = (await text(cdp, '.studies-heading') || '').trim();
  check('heading reads Studies', heading === 'Studies', heading);

  const summaryText = (await text(cdp, '.studies-summary') || '').trim();
  const summaryMatch = /^(\d+) STUDIES · (\d+) IN QUEUE$/.exec(summaryText);
  check('summary matches "{n} STUDIES · {m} IN QUEUE" with n >= 9', Boolean(summaryMatch) && Number(summaryMatch[1]) >= 9, summaryText);
  const n = summaryMatch ? Number(summaryMatch[1]) : null;

  const initialRows = await rowCount(cdp);
  check('.studies-row count equals n', initialRows === n, { initialRows, n });

  // 2. Demo pills and status badges; specific lordosis and date cells.
  const demoRows = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.studies-row')].filter((r) => /^SP-00(3[0-9]|4[0-2])$/.test(r.dataset.studyId));
    return rows.map((r) => ({
      id: r.dataset.studyId,
      hasDemoPill: Boolean(r.querySelector('.pill-demo')),
      hasSegBadge: Boolean(r.querySelector('.badge-seg')),
    }));
  })()`);
  check('SP-0030..SP-0042 rows exist', demoRows.length > 0, demoRows.length);
  check('every SP-0030..SP-0042 row carries .pill-demo and .badge-seg', demoRows.every((r) => r.hasDemoPill && r.hasSegBadge), demoRows);

  const cellDetail = await cdp.evaluate(`(() => {
    const row = (id) => document.querySelector('.studies-row[data-study-id="' + id + '"]');
    const lordosis = (id) => { const c = row(id).querySelector('.studies-lordosis'); return c ? { text: c.textContent, high: c.classList.contains('studies-lordosis-high') } : null; };
    return {
      sp0031: lordosis('SP-0031'),
      sp0030: lordosis('SP-0030'),
      sp0042Date: row('SP-0042').querySelector('.studies-cell-date')?.textContent,
    };
  })()`);
  check('SP-0031 lordosis reads 58° and carries studies-lordosis-high', cellDetail.sp0031?.text === '58°' && cellDetail.sp0031?.high === true, cellDetail.sp0031);
  check('SP-0030 lordosis reads 18° without studies-lordosis-high', cellDetail.sp0030?.text === '18°' && cellDetail.sp0030?.high === false, cellDetail.sp0030);
  check('SP-0042 date cell reads Aug 21, 2026', cellDetail.sp0042Date === 'Aug 21, 2026', cellDetail.sp0042Date);

  // 3. Search filtering: caret/focus preservation, diagnosis match, empty state, clear.
  const searchRect = await cdp.rect('.studies-search');
  check('search box has layout', Boolean(searchRect), searchRect);
  await cdp.click(searchRect.cx, searchRect.cy);
  await cdp.typeText('SP-0042');
  await cdp.settle();
  check('typing SP-0042 leaves one row', (await rowCount(cdp)) === 1, await rowCount(cdp));
  const afterType = await cdp.evaluate("(() => { const el = document.querySelector('.studies-search'); return { focused: document.activeElement === el, value: el.value, selectionStart: el.selectionStart }; })()");
  check('input keeps focus, value, and caret at the end', afterType.focused === true && afterType.value === 'SP-0042' && afterType.selectionStart === 7, afterType);
  const summaryAfterSearch = (await text(cdp, '.studies-summary') || '').trim();
  check('summary is unchanged while filtering', summaryAfterSearch === summaryText, summaryAfterSearch);

  await clearSearch(cdp);
  await cdp.typeText('anterior slip');
  await cdp.settle();
  const dxRows = await cdp.evaluate("[...document.querySelectorAll('.studies-row')].map((r) => r.dataset.studyId)");
  check('searching the diagnosis text leaves only SP-0042', dxRows.length === 1 && dxRows[0] === 'SP-0042', dxRows);

  await clearSearch(cdp);
  await cdp.typeText('zzzznomatch');
  await cdp.settle();
  const emptyText = (await text(cdp, '.studies-empty') || '').trim();
  check('a non-matching query shows the empty state', emptyText === 'No studies match that search.', emptyText);
  const summaryAfterEmpty = (await text(cdp, '.studies-summary') || '').trim();
  check('summary is unchanged for a non-matching query', summaryAfterEmpty === summaryText, summaryAfterEmpty);

  await clearSearch(cdp);
  await cdp.settle();
  check('clearing the query restores all n rows', (await rowCount(cdp)) === n, await rowCount(cdp));

  // 4. Opening a study resets the per-study view state; the back button returns to Studies.
  const sp0042Rect = await cdp.rect('.studies-row[data-study-id="SP-0042"]');
  check('SP-0042 row has layout', Boolean(sp0042Rect), sp0042Rect);
  await cdp.click(sp0042Rect.cx, sp0042Rect.cy);
  await cdp.settle();
  s = await cdp.state();
  check('clicking SP-0042 opens it with a fresh view', s.screen === 'analysis' && s.openId === 'SP-0042' && s.zoom === 1 && s.editing === false && s.selectedLevel === null, { screen: s.screen, openId: s.openId, zoom: s.zoom, editing: s.editing, selectedLevel: s.selectedLevel });

  const backRect = await cdp.rect('.icon-btn[aria-label="Back to studies"]');
  check('back button has layout', Boolean(backRect), backRect);
  await cdp.click(backRect.cx, backRect.cy);
  await cdp.settle();
  s = await cdp.state();
  check('back returns to Studies with all n rows', s.screen === 'studies' && (await rowCount(cdp)) === n, { screen: s.screen, rows: await rowCount(cdp) });

  // 5. Add an unsegmented study the way inject-study.js does.
  const injectExpression = fs.readFileSync(path.join(__dirname, 'inject-study.js'), 'utf8');
  const injected = await cdp.evaluate(injectExpression);
  check('inject-study.js parks SP-9000 and opens Analysis', injected.screen === 'analysis' && injected.openId === 'SP-9000', injected);
  s = await cdp.state();
  const sp9000 = s.studies.find((x) => x.id === 'SP-9000');
  check('SP-9000 is unsegmented (measurements === null)', Boolean(sp9000) && sp9000.measurements === null, sp9000);
  const runCard = await cdp.evaluate("(() => { const card = document.querySelector('.run-card'); const btn = document.querySelector('.run-button'); return { visible: Boolean(card) && !card.classList.contains('is-hidden'), label: btn ? btn.textContent : null }; })()");
  check('the run card is visible with a Run segmentation button', runCard.visible === true && runCard.label === 'Run segmentation', runCard);

  const backRect2 = await cdp.rect('.icon-btn[aria-label="Back to studies"]');
  await cdp.click(backRect2.cx, backRect2.cy);
  await cdp.settle();
  s = await cdp.state();
  const newRow = await cdp.evaluate(`(() => {
    const row = document.querySelector('.studies-row');
    if (!row) return null;
    return {
      id: row.dataset.studyId,
      badgeProc: Boolean(row.querySelector('.badge-proc')),
      badgeText: row.querySelector('.badge-proc')?.textContent,
      patient: row.querySelector('.studies-cell-patient')?.textContent.trim(),
      lordosis: row.querySelector('.studies-lordosis')?.textContent,
      demoPill: Boolean(row.querySelector('.pill-demo')),
    };
  })()`);
  check('the new study is the first row, Processing, no measurements, no DEMO pill', newRow && newRow.id === 'SP-9000' && newRow.badgeProc && newRow.badgeText === 'Processing' && newRow.patient === '—' && newRow.lordosis === '—' && newRow.demoPill === false, newRow);
  const summaryAfterAdd = (await text(cdp, '.studies-summary') || '').trim();
  check('summary reads n+1 studies, 1 in queue', summaryAfterAdd === `${n + 1} STUDIES · 1 IN QUEUE`, summaryAfterAdd);

  // 6. The unsegmented record round-trips through the persisted store.
  const persisted = await cdp.evaluate(`(async () => {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const raw = await window.spineContour.loadStudies();
      const found = (raw.studies || []).find((x) => x.id === 'SP-9000');
      if (found) return { found: true, measurements: found.measurements };
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return { found: false };
  })()`);
  check('window.spineContour.loadStudies() persisted SP-9000 with measurements: null', persisted.found === true && persisted.measurements === null, persisted);

  // 7. No console errors or exceptions during the run.
  check('no console errors or exceptions during the run', cdp.errors.length === 0, cdp.errors);
} finally {
  cdp.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${JSON.stringify(r.detail)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
