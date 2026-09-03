(async () => {
  const store = await import('./renderer/store.js');
  const button = document.querySelector('.run-button');
  if (!button) return { error: 'no run button' };
  const started = Date.now();
  const outcome = new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 400000);
    const un = store.subscribe((s) => {
      const st = s.studies.find((x) => x.id === s.openId);
      if (!s.running && st && st.measurements) { clearTimeout(timer); un(); resolve('done'); }
      if (!s.running && s.toast && s.toast.startsWith('Could not')) { clearTimeout(timer); un(); resolve('failed: ' + s.toast); }
    });
  });
  button.click();
  const result = await outcome;
  const s = store.getState();
  const st = s.studies.find((x) => x.id === s.openId);
  return {
    result, seconds: Math.round((Date.now() - started) / 1000), running: s.running, toast: s.toast,
    measurements: st.measurements, geometryKeys: st.geometry ? Object.keys(st.geometry) : null,
    femoral: st.geometry ? st.geometry.femoral_circles : null, confidence: st.qc ? st.qc.femoral.confidence : null,
    canvas: (() => { const c = document.querySelector('.viewer-canvas-dynamic'); return c ? [c.width, c.height] : null; })(),
  };
})()
