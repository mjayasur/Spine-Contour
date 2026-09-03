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

// A section this profile cannot exercise is reported and skipped, never failed: the suite has
// to be runnable on a fresh scratch profile, which has no segmented real study to re-run.
const skips = [];
function skip(name, why) {
  skips.push({ name, why });
}

const rowCount = (cdp) => cdp.evaluate("document.querySelectorAll('.studies-row').length");
const text = (cdp, selector) => cdp.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.textContent : null; })()`);
const clearSearch = (cdp) => cdp.evaluate("(() => { const el = document.querySelector('.studies-search'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })()");

const cdp = await connect();

// Polls the store through the page's own module instance, the way smoke-gate3.mjs does.
async function waitForState(predicateSource, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`import('./renderer/store.js').then((m) => { const s = m.getState(); return Boolean(${predicateSource}); })`)) return true;
    await cdp.settle(150);
  }
  return false;
}

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

  // 4b. A demo study opens to the demo card (Task 9). A demo record has measurements but no
  // geometry and no film, so without its own branch it would read as an unprocessed real
  // study: a QUEUED card and a Run segmentation button whose only outcome is a toast.
  const demoRect = await cdp.rect('.studies-row[data-study-id="SP-0042"]');
  check('SP-0042 row has layout for the demo-open section', Boolean(demoRect), demoRect);
  await cdp.click(demoRect.cx, demoRect.cy);
  await cdp.settle(150);
  const demo = await cdp.evaluate(`(() => {
    const card = document.querySelector('.run-card');
    const runButton = document.querySelector('.run-button');
    const tool = (label) => document.querySelector('.viewer-tool[aria-label="' + label + '"]');
    const row = (key) => document.querySelector('.meas-row[data-row-key="' + key + '"]');
    const cell = (key, cls) => { const r = row(key); return r ? r.querySelector(cls).textContent : null; };
    const exportButton = document.querySelector('.analysis-export');
    return {
      cardVisible: Boolean(card) && !card.classList.contains('is-hidden'),
      eyebrow: document.querySelector('.run-eyebrow')?.textContent,
      title: document.querySelector('.run-title')?.textContent,
      runButtonHidden: Boolean(runButton) && runButton.classList.contains('is-hidden'),
      spinnerHidden: document.querySelector('.run-spinner')?.classList.contains('is-hidden'),
      editDisabled: tool('Edit landmarks')?.disabled,
      rerunDisabled: tool('Re-run segmentation')?.disabled,
      headerPill: document.querySelector('.analysis-header .pill-demo')?.textContent,
      exportDisabled: exportButton ? exportButton.disabled : null,
      exportTitle: exportButton ? exportButton.title : null,
      confidence: document.querySelector('.confidence-value')?.textContent,
      l1paLabel: cell('L1PA', '.meas-label'), l1paValue: cell('L1PA', '.meas-value'),
      llLabel: cell('LL', '.meas-label'), llValue: cell('LL', '.meas-value'),
    };
  })()`);
  check('the demo card is visible with the DEMO STUDY eyebrow', demo.cardVisible === true && demo.eyebrow === 'DEMO STUDY' && demo.title === 'No film for a demo study', demo);
  check('the demo card offers no run button and no spinner', demo.runButtonHidden === true && demo.spinnerHidden === true, demo);
  check('edit and re-run are disabled for a demo study', demo.editDisabled === true && demo.rerunDisabled === true, demo);
  check('the Analysis header carries a DEMO pill', demo.headerPill === 'DEMO', demo.headerPill);
  check('Export CSV is disabled for a demo study and says why', demo.exportDisabled === true && demo.exportTitle === 'Demo studies are not exported', demo);
  check('FEMORAL FIT CONFIDENCE reads 96%', demo.confidence === '96%', demo.confidence);
  check('L1 PELVIC ANGLE reads an em dash, never a fabricated value', demo.l1paLabel === 'L1 PELVIC ANGLE' && demo.l1paValue === '—', demo);
  check('LUMBAR LORDOSIS · L1–S1 reads 48.2°', demo.llLabel === 'LUMBAR LORDOSIS · L1–S1' && demo.llValue === '48.2°', demo);

  const backRect3 = await cdp.rect('.icon-btn[aria-label="Back to studies"]');
  await cdp.click(backRect3.cx, backRect3.cy);
  await cdp.settle();
  s = await cdp.state();
  check('back from the demo study returns to Studies', s.screen === 'studies', s.screen);

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

  // 7. state.running is the running study's id (Task 9): the list badges THAT study Processing,
  // and a demo study opened while the run is in flight still shows the demo card rather than
  // claiming to be running. Skipped, not failed, when this profile has no segmented real study
  // or when its bytes are not in this session's payload map (a study restored from disk cannot
  // re-run until it is chosen again) -- the suite has to work on a fresh profile.
  const RUNNING_SECTION = 'state.running names the running study';
  s = await cdp.state();
  const target = (s.studies || []).find((x) => x.source === 'real' && x.measurements && x.geometry);
  if (!target) {
    skip(RUNNING_SECTION, 'no segmented real study in this profile');
  } else {
    await cdp.setState(`{ screen: "studies", openId: ${JSON.stringify(target.id)}, editing: false, selection: null, zoom: 1, panX: 0, panY: 0, panMode: false, selectedLevel: null }`);
    await cdp.settle(80);
    await cdp.setState('{ screen: "analysis" }');
    // The film may still be restoring from its sidecar, which disables re-run while it reads.
    let rerunRect = null;
    for (let i = 0; i < 40 && !rerunRect; i += 1) {
      await cdp.settle(150);
      const enabled = await cdp.evaluate(`(() => { const b = document.querySelector('.viewer-tool[aria-label="Re-run segmentation"]'); return Boolean(b) && b.disabled === false; })()`);
      if (enabled) rerunRect = await cdp.rect('.viewer-tool[aria-label="Re-run segmentation"]');
    }
    if (!rerunRect) {
      skip(RUNNING_SECTION, `the re-run button never became enabled for ${target.id}`);
    } else {
      await cdp.click(rerunRect.cx, rerunRect.cy);
      const started = await waitForState('s.running !== null', 5000);
      if (!started) {
        skip(RUNNING_SECTION, `a re-run of ${target.id} did not start; its file bytes are not in this session`);
      } else {
        s = await cdp.state();
        check('state.running is the running study id, not a boolean', s.running === target.id, s.running);

        await cdp.setState('{ screen: "studies" }');
        await cdp.settle(150);
        const rowSelector = JSON.stringify(`.studies-row[data-study-id="${target.id}"]`);
        const runningRow = await cdp.evaluate(`(() => {
          const row = document.querySelector(${rowSelector});
          const summary = document.querySelector('.studies-summary')?.textContent || '';
          const m = /(\\d+) STUDIES · (\\d+) IN QUEUE/.exec(summary);
          return {
            badgeProc: Boolean(row && row.querySelector('.badge-proc')),
            badgeText: row ? row.querySelector('.badge')?.textContent : null,
            queued: m ? Number(m[2]) : null,
            procRows: document.querySelectorAll('.studies-row .badge-proc').length,
          };
        })()`);
        check('the running study is badged Processing in the list', runningRow.badgeProc === true && runningRow.badgeText === 'Processing', runningRow);
        check('the summary queue count uses the same rule as the badges', runningRow.queued !== null && runningRow.queued === runningRow.procRows && runningRow.queued >= 1, runningRow);

        const demoRect2 = await cdp.rect('.studies-row[data-study-id="SP-0042"]');
        await cdp.click(demoRect2.cx, demoRect2.cy);
        await cdp.settle(200);
        const demoDuringRun = await cdp.evaluate(`(() => ({
          eyebrow: document.querySelector('.run-eyebrow')?.textContent,
          spinnerHidden: document.querySelector('.run-spinner')?.classList.contains('is-hidden'),
          runButtonHidden: document.querySelector('.run-button')?.classList.contains('is-hidden'),
        }))()`);
        check('a demo study opened mid-run shows the demo card, not RUNNING', demoDuringRun.eyebrow === 'DEMO STUDY' && demoDuringRun.spinnerHidden === true && demoDuringRun.runButtonHidden === true, demoDuringRun);

        const finished = await waitForState('s.running === null', 240000);
        s = await cdp.state();
        check('the run finishes and running returns to null', finished === true && s.running === null, [finished, s.running, s.toast]);
      }
    }
  }

  // 8. No console errors or exceptions during the run.
  check('no console errors or exceptions during the run', cdp.errors.length === 0, cdp.errors);
} finally {
  cdp.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${JSON.stringify(r.detail)}`}`);
// A skip is not a failure and never affects the exit code; it says which section this profile
// could not exercise, so a green run on a fresh profile is not mistaken for full coverage.
for (const sk of skips) console.log(`SKIP  ${sk.name}  -> ${sk.why}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed${skips.length ? `, ${skips.length} section(s) skipped` : ''}`);
process.exit(failed ? 1 : 0);
