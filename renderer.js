const chooseButton = document.querySelector('#choose-file');
const predictButton = document.querySelector('#predict');
const fileName = document.querySelector('#file-name');
const preview = document.querySelector('#preview');
const status = document.querySelector('#status');
const canvas = document.querySelector('#result');
const legend = document.querySelector('#legend');
const measurementControls = document.querySelector('#measurement-controls');
const results = document.querySelector('#results');
const viewerStage = document.querySelector('#viewer-stage');
const stageHint = document.querySelector('#stage-hint');
const annotationPanel = document.querySelector('#annotation-panel');
const imageSurface = document.querySelector('#image-surface');
const editToggle = document.querySelector('#edit-toggle');
const showMask = document.querySelector('#show-mask');
const spineTools = document.querySelector('#spine-tools');
const femoralTools = document.querySelector('#femoral-tools');
const traceSide = document.querySelector('#trace-side');
const traceCount = document.querySelector('#trace-count');
const fitCircleButton = document.querySelector('#fit-circle');
const undoTraceButton = document.querySelector('#undo-trace');
const clearTraceButton = document.querySelector('#clear-trace');
const usePredictedCircleButton = document.querySelector('#use-predicted-circle');

let selectedFile = null;
let previewUrl = null;
let result = null;
let images = null;
let segmentationOverlay = null;
let originalGeometry = null;
let geometry = null;
let editing = false;
let activeTool = 'spine';
let activeLevel = 'L1';
let activeCorner = 'SA';
let zoom = 1;
let pan = { x: 0, y: 0 };
let dragging = null;
let measureRevision = 0;
const traces = { left: [], right: [] };

const levels = ['L1', 'L2', 'L3', 'L4', 'L5'];
const corners = ['SA', 'SP', 'IA', 'IP'];
const cornerColors = { SA: '#32d4ff', SP: '#64e19a', IA: '#ffb259', IP: '#fa78d4' };
const labelColors = {
  20: [255, 99, 132], 21: [255, 159, 64], 22: [255, 205, 86],
  23: [75, 192, 192], 24: [54, 162, 235],
};
const angleColors = {
  SI: '#ffd166', PI: '#ef476f', PT: '#06d6a0', L1PA: '#a78bfa',
  'L1-S1': '#ff6384', 'L2-S1': '#ff9f40', 'L3-S1': '#ffcd56',
  'L4-S1': '#4bc0c0', 'L5-S1': '#36a2eb',
};

legend.innerHTML = Object.entries(labelColors)
  .map(([, color], index) => `<span><i class="swatch" style="background:rgb(${color.join(',')})"></i>L${index + 1}</span>`)
  .concat('<span><i class="swatch" style="background:#62d26f"></i>Femoral heads</span>')
  .join('');

preview.addEventListener('load', () => {
  if (!result) resetView();
});
new ResizeObserver(() => {
  if (result || preview.naturalWidth) fitSurface();
}).observe(viewerStage);

chooseButton.addEventListener('click', async () => {
  const chosen = await window.spineContour.selectFile();
  if (!chosen) return;
  selectedFile = chosen;
  closeImages();
  result = null;
  geometry = null;
  originalGeometry = null;
  setEditing(false);
  fileName.textContent = chosen.name;
  predictButton.disabled = false;
  status.textContent = 'Ready to measure.';
  status.className = '';
  measurementControls.hidden = true;
  editToggle.disabled = true;
  showMask.disabled = true;
  document.querySelectorAll('#zoom-out, #zoom-reset, #zoom-in').forEach((button) => { button.disabled = true; });
  canvas.hidden = true;
  preview.hidden = false;
  resetView();

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  const extension = chosen.name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'].includes(extension)) {
    previewUrl = URL.createObjectURL(new Blob([chosen.data]));
    preview.src = previewUrl;
  } else {
    preview.removeAttribute('src');
    preview.alt = 'DICOM selected; a preview will appear after measurement.';
  }
});

predictButton.addEventListener('click', async () => {
  if (!selectedFile) return;
  predictButton.disabled = true;
  status.textContent = 'Segmenting and measuring…';
  status.className = '';
  try {
    result = await window.spineContour.predict({
      name: selectedFile.name,
      data: selectedFile.data,
      modality: document.querySelector('#modality').value,
      bodyPart: document.querySelector('#body-part').value,
      view: document.querySelector('#view').value,
    });
    originalGeometry = clone(result.geometry);
    geometry = clone(result.geometry);
    traces.left = [];
    traces.right = [];
    await prepareImages();
    preview.hidden = true;
    canvas.hidden = false;
    measurementControls.hidden = false;
    editToggle.disabled = false;
    showMask.disabled = false;
    document.querySelectorAll('#zoom-out, #zoom-reset, #zoom-in').forEach((button) => { button.disabled = false; });
    updateMeasurementOutputs();
    updateEditor();
    resetView();
    renderResult();
    status.textContent = result.warnings?.length
      ? `Measurements completed with warnings: ${result.warnings.join(' ')}`
      : 'Measurements complete. Select Edit landmarks to refine the model output.';
    status.classList.toggle('warning', Boolean(result.warnings?.length));
  } catch (error) {
    status.textContent = `Could not measure: ${error.message}`;
    status.className = 'error';
  } finally {
    predictButton.disabled = false;
  }
});

measurementControls.addEventListener('change', renderResult);
showMask.addEventListener('change', renderResult);
editToggle.addEventListener('click', () => setEditing(!editing));
document.querySelector('#zoom-in').addEventListener('click', () => changeZoom(0.2));
document.querySelector('#zoom-out').addEventListener('click', () => changeZoom(-0.2));
document.querySelector('#zoom-reset').addEventListener('click', resetView);

document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => {
  activeTool = button.dataset.tool;
  updateEditor();
  renderResult();
}));
document.querySelectorAll('[data-level]').forEach((button) => button.addEventListener('click', () => {
  activeLevel = button.dataset.level;
  if (activeLevel === 'S1' && !['SA', 'SP'].includes(activeCorner)) activeCorner = 'SA';
  activeTool = 'spine';
  updateEditor();
  renderResult();
}));
document.querySelectorAll('[data-corner]').forEach((button) => button.addEventListener('click', () => {
  if (button.disabled) return;
  activeCorner = button.dataset.corner;
  activeTool = 'spine';
  updateEditor();
  renderResult();
}));

fitCircleButton.addEventListener('click', async () => {
  const side = activeTool === 'right-head' ? 'right' : 'left';
  const fitted = fitCircle(traces[side]);
  if (!fitted) return;
  geometry.femoral_circles[side === 'left' ? 0 : 1] = fitted;
  renderResult();
  if (geometry.femoral_circles.filter(Boolean).length === 2) await recalculateMeasurements();
  else status.textContent = 'One femoral head is set. Trace and fit the other head to calculate PI, PT, and L1PA.';
});
undoTraceButton.addEventListener('click', () => {
  const side = activeTool === 'right-head' ? 'right' : 'left';
  traces[side].pop();
  updateEditor();
  renderResult();
});
clearTraceButton.addEventListener('click', () => {
  const side = activeTool === 'right-head' ? 'right' : 'left';
  traces[side] = [];
  updateEditor();
  renderResult();
});
usePredictedCircleButton.addEventListener('click', async () => {
  const side = activeTool === 'right-head' ? 'right' : 'left';
  const index = side === 'left' ? 0 : 1;
  if (!originalGeometry.femoral_circles[index]) return;
  geometry.femoral_circles[index] = clone(originalGeometry.femoral_circles[index]);
  traces[side] = [];
  updateEditor();
  renderResult();
  await recalculateMeasurements();
});
document.querySelector('#reset-annotation').addEventListener('click', async () => {
  geometry = clone(originalGeometry);
  traces.left = [];
  traces.right = [];
  updateEditor();
  renderResult();
  await recalculateMeasurements();
});

viewerStage.addEventListener('wheel', (event) => {
  if (!result) return;
  event.preventDefault();
  changeZoom(event.deltaY < 0 ? 0.16 : -0.16);
}, { passive: false });

canvas.addEventListener('pointerdown', (event) => {
  if (!editing || !geometry) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  if (activeTool === 'pan') {
    dragging = { kind: 'pan', clientX: event.clientX, clientY: event.clientY, x: pan.x, y: pan.y };
    viewerStage.classList.add('panning');
    return;
  }
  const point = imageCoordinates(event);
  if (activeTool === 'left-head' || activeTool === 'right-head') {
    const side = activeTool === 'right-head' ? 'right' : 'left';
    const index = nearestTrace(side, event.clientX, event.clientY);
    if (index >= 0) dragging = { kind: 'trace', side, index };
    else {
      traces[side].push(point);
      updateEditor();
      renderResult();
    }
    return;
  }
  const nearest = nearestLandmark(event.clientX, event.clientY);
  if (nearest) {
    activeLevel = nearest.level;
    activeCorner = nearest.corner;
    dragging = { kind: 'landmark', level: nearest.level, corner: nearest.corner };
    updateEditor();
    renderResult();
  } else {
    setLandmark(activeLevel, activeCorner, point);
    dragging = { kind: 'landmark', level: activeLevel, corner: activeCorner };
    renderResult();
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  if (dragging.kind === 'pan') {
    pan = {
      x: dragging.x + event.clientX - dragging.clientX,
      y: dragging.y + event.clientY - dragging.clientY,
    };
    applyView();
    return;
  }
  const point = imageCoordinates(event);
  if (dragging.kind === 'landmark') setLandmark(dragging.level, dragging.corner, point);
  else traces[dragging.side][dragging.index] = point;
  renderResult();
});

async function stopDragging(event) {
  if (!dragging) return;
  const shouldMeasure = dragging.kind === 'landmark';
  dragging = null;
  viewerStage.classList.remove('panning');
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (shouldMeasure) await recalculateMeasurements();
}
canvas.addEventListener('pointerup', stopDragging);
canvas.addEventListener('pointercancel', stopDragging);

window.addEventListener('keydown', (event) => {
  if (!result || event.target.matches('input, select, textarea')) return;
  if (event.key === '+' || event.key === '=') changeZoom(0.2);
  if (event.key === '-') changeZoom(-0.2);
  if (event.key === '0') resetView();
  if (event.key === 'Escape' && editing) setEditing(false);
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setEditing(value) {
  editing = Boolean(value && result);
  editToggle.classList.toggle('active', editing);
  editToggle.textContent = editing ? 'Done editing' : 'Edit landmarks';
  annotationPanel.hidden = !editing;
  results.classList.toggle('annotating', editing);
  viewerStage.classList.toggle('editing', editing);
  if (!editing) viewerStage.classList.remove('pan-tool', 'panning');
  updateEditor();
  renderResult();
}

function updateEditor() {
  if (!geometry) return;
  document.querySelectorAll('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === activeTool));
  document.querySelectorAll('[data-level]').forEach((button) => button.classList.toggle('active', button.dataset.level === activeLevel));
  document.querySelectorAll('[data-corner]').forEach((button) => {
    button.disabled = activeLevel === 'S1' && !['SA', 'SP'].includes(button.dataset.corner);
    button.classList.toggle('active', button.dataset.corner === activeCorner);
  });
  const headTool = activeTool === 'left-head' || activeTool === 'right-head';
  spineTools.hidden = activeTool !== 'spine';
  femoralTools.hidden = !headTool;
  viewerStage.classList.toggle('pan-tool', editing && activeTool === 'pan');
  stageHint.hidden = !editing;
  if (activeTool === 'spine') stageHint.textContent = `Drag a point, or click to set ${activeLevel} ${activeCorner}.`;
  else if (activeTool === 'pan') stageHint.textContent = 'Drag to pan. Scroll to zoom.';
  else stageHint.textContent = 'Place points along the visible femoral-head arc.';
  if (headTool) {
    const side = activeTool === 'right-head' ? 'right' : 'left';
    const count = traces[side].length;
    traceSide.textContent = `${side === 'left' ? 'Left' : 'Right'} femoral head`;
    traceCount.textContent = `${count} arc point${count === 1 ? '' : 's'}`;
    fitCircleButton.disabled = count < 3;
    undoTraceButton.disabled = count === 0;
    clearTraceButton.disabled = count === 0;
    const index = side === 'left' ? 0 : 1;
    usePredictedCircleButton.disabled = !originalGeometry.femoral_circles[index];
  }
}

function changeZoom(delta) {
  zoom = Math.max(0.5, Math.min(6, zoom + delta));
  applyView();
}

function resetView() {
  zoom = 1;
  pan = { x: 0, y: 0 };
  fitSurface();
  applyView();
}

function applyView() {
  imageSurface.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
}

function fitSurface() {
  const sourceWidth = result ? canvas.width : preview.naturalWidth;
  const sourceHeight = result ? canvas.height : preview.naturalHeight;
  if (!sourceWidth || !sourceHeight || !viewerStage.clientWidth || !viewerStage.clientHeight) return;
  const scale = Math.min(
    viewerStage.clientWidth / sourceWidth,
    viewerStage.clientHeight / sourceHeight,
  );
  imageSurface.style.width = `${Math.max(1, Math.round(sourceWidth * scale))}px`;
  imageSurface.style.height = `${Math.max(1, Math.round(sourceHeight * scale))}px`;
}

function imageCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  return [
    Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
    Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
  ];
}

function landmark(level, corner) {
  if (level === 'S1') return geometry.s1_superior[corner === 'SA' ? 0 : 1];
  const body = geometry.vertebrae[level];
  if (corner === 'SA') return body.superior[0];
  if (corner === 'SP') return body.superior[1];
  if (corner === 'IA') return body.inferior[0];
  return body.inferior[1];
}

function setLandmark(level, corner, point) {
  if (level === 'S1') {
    geometry.s1_superior[corner === 'SA' ? 0 : 1] = point;
    return;
  }
  const body = geometry.vertebrae[level];
  if (corner === 'SA') body.superior[0] = point;
  else if (corner === 'SP') body.superior[1] = point;
  else if (corner === 'IA') body.inferior[0] = point;
  else body.inferior[1] = point;
  body.quadrilateral = [body.superior[0], body.superior[1], body.inferior[1], body.inferior[0]];
}

function nearestLandmark(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  let nearest = null;
  for (const level of [...levels, 'S1']) {
    for (const corner of level === 'S1' ? ['SA', 'SP'] : corners) {
      const point = landmark(level, corner);
      const x = rect.left + point[0] * rect.width / canvas.width;
      const y = rect.top + point[1] * rect.height / canvas.height;
      const distance = Math.hypot(clientX - x, clientY - y);
      if (distance <= 14 && (!nearest || distance < nearest.distance)) nearest = { level, corner, distance };
    }
  }
  return nearest;
}

function nearestTrace(side, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  let nearest = -1;
  let closest = Infinity;
  traces[side].forEach((point, index) => {
    const x = rect.left + point[0] * rect.width / canvas.width;
    const y = rect.top + point[1] * rect.height / canvas.height;
    const distance = Math.hypot(clientX - x, clientY - y);
    if (distance <= 14 && distance < closest) { nearest = index; closest = distance; }
  });
  return nearest;
}

async function recalculateMeasurements() {
  const revision = ++measureRevision;
  status.textContent = 'Updating measurements from corrected landmarks…';
  try {
    const measured = await window.spineContour.measure({
      vertebrae: geometry.vertebrae,
      s1_superior: geometry.s1_superior,
      femoral_circles: geometry.femoral_circles,
    });
    if (revision !== measureRevision) return;
    result.measurements = measured.measurements;
    result.warnings = measured.warnings || [];
    geometry = measured.geometry;
    result.geometry = geometry;
    updateMeasurementOutputs();
    renderResult();
    status.textContent = result.warnings.length
      ? `Measurements updated with warnings: ${result.warnings.join(' ')}`
      : 'Measurements updated from corrected landmarks.';
    status.className = result.warnings.length ? 'warning' : '';
  } catch (error) {
    if (revision === measureRevision) {
      status.textContent = `Could not update measurements: ${error.message}`;
      status.className = 'error';
    }
  }
}

function updateMeasurementOutputs() {
  document.querySelectorAll('[data-value]').forEach((output) => {
    const name = output.dataset.value;
    const value = Object.hasOwn(result.measurements, name)
      ? result.measurements[name]
      : result.measurements.LL[name];
    const input = output.closest('.measurement-option').querySelector('input');
    const available = Number.isFinite(value);
    output.textContent = available ? `${value.toFixed(1)}°` : 'Unavailable';
    if (!available) input.checked = false;
    input.disabled = !available;
  });
}

async function bitmapFromBase64(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

function closeImages() {
  if (images) Object.values(images).forEach((image) => image.close());
  images = null;
  segmentationOverlay = null;
}

async function prepareImages() {
  closeImages();
  const [image, mask, femoral] = await Promise.all([
    bitmapFromBase64(result.image_png), bitmapFromBase64(result.mask_png), bitmapFromBase64(result.femoral_mask_png),
  ]);
  images = { image, mask, femoral };
  canvas.width = image.width;
  canvas.height = image.height;
  const scratch = document.createElement('canvas');
  scratch.width = image.width;
  scratch.height = image.height;
  const context = scratch.getContext('2d');
  const overlay = context.createImageData(image.width, image.height);
  context.drawImage(mask, 0, 0);
  const maskPixels = context.getImageData(0, 0, image.width, image.height).data;
  context.clearRect(0, 0, image.width, image.height);
  context.drawImage(femoral, 0, 0);
  const femoralPixels = context.getImageData(0, 0, image.width, image.height).data;
  for (let offset = 0; offset < overlay.data.length; offset += 4) {
    const color = labelColors[maskPixels[offset]];
    if (color) overlay.data.set([...color, 58], offset);
    else if (femoralPixels[offset]) overlay.data.set([98, 210, 111, 58], offset);
  }
  context.putImageData(overlay, 0, 0);
  segmentationOverlay = scratch;
}

function renderResult() {
  if (!result || !images || !geometry) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(images.image, 0, 0);
  if (showMask.checked && segmentationOverlay) context.drawImage(segmentationOverlay, 0, 0);
  drawAnatomy(context);
  drawMeasurements(context);
}

function drawAnatomy(context) {
  const lineWidth = Math.max(2, canvas.width / 600);
  context.lineJoin = 'round';
  levels.forEach((level, index) => {
    const body = geometry.vertebrae[level];
    const polygon = [body.superior[0], body.superior[1], body.inferior[1], body.inferior[0]];
    context.strokeStyle = `rgb(${labelColors[20 + index].join(',')})`;
    context.lineWidth = lineWidth;
    context.beginPath();
    polygon.forEach((point, pointIndex) => pointIndex ? context.lineTo(...point) : context.moveTo(...point));
    context.closePath();
    context.stroke();
    polygon.forEach((point, pointIndex) => {
      const corner = ['SA', 'SP', 'IP', 'IA'][pointIndex];
      const selected = editing && activeTool === 'spine' && activeLevel === level && activeCorner === corner;
      drawPoint(context, point, editing ? cornerColors[corner] : context.strokeStyle, selected, `${level} ${corner}`);
    });
  });
  geometry.s1_superior.forEach((point, index) => {
    const corner = index ? 'SP' : 'SA';
    const selected = editing && activeTool === 'spine' && activeLevel === 'S1' && activeCorner === corner;
    drawPoint(context, point, cornerColors[corner], selected, `S1 ${corner}`);
  });
  context.strokeStyle = '#62d26f';
  context.lineWidth = lineWidth;
  geometry.femoral_circles.forEach(([x, y, radius]) => {
    context.beginPath();
    context.arc(x, y, radius, 0, 2 * Math.PI);
    context.stroke();
  });
  for (const side of ['left', 'right']) {
    const active = editing && activeTool === `${side}-head`;
    const color = side === 'left' ? '#ffe071' : '#ff8ea1';
    traces[side].forEach((point, index) => {
      drawPoint(context, point, color, active, active ? String(index + 1) : '');
    });
  }
}

function drawPoint(context, point, color, selected, labelText) {
  const radius = Math.max(3, canvas.width / 280);
  if (selected) {
    context.beginPath();
    context.arc(point[0], point[1], radius * 2.1, 0, 2 * Math.PI);
    context.strokeStyle = '#fff';
    context.lineWidth = Math.max(1.2, canvas.width / 900);
    context.stroke();
  }
  context.beginPath();
  context.arc(point[0], point[1], radius, 0, 2 * Math.PI);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = '#061019';
  context.lineWidth = Math.max(1, canvas.width / 1200);
  context.stroke();
  if (selected && labelText) {
    const fontSize = Math.max(11, canvas.width / 70);
    context.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    context.fillStyle = color;
    context.fillText(labelText, point[0] + radius * 2.5, point[1] - radius * 1.8);
  }
}

function drawMeasurements(context) {
  const selected = new Set(
    [...document.querySelectorAll('[data-measurement]:checked')].map((input) => input.dataset.measurement),
  );
  const s1 = geometry.s1_superior;
  const s1Middle = midpoint(s1);
  const hip = geometry.hip_midpoint;
  const l1Center = geometry.l1_center;
  const s1Length = distance(s1[0], s1[1]);
  const width = Math.max(2, canvas.width / 600);

  if (selected.has('SI')) {
    drawLine(context, s1, angleColors.SI);
    drawLine(context, [[s1Middle[0] - s1Length / 2, s1Middle[1]], [s1Middle[0] + s1Length / 2, s1Middle[1]]], angleColors.SI);
    drawLabel(context, `SI ${result.measurements.SI.toFixed(1)}°`, [s1Middle[0], s1Middle[1] - 16 * width], angleColors.SI);
  }
  if (selected.has('PI') && Number.isFinite(result.measurements.PI) && hip) {
    const vector = [s1[1][0] - s1[0][0], s1[1][1] - s1[0][1]];
    let normal = [-vector[1], vector[0]];
    if (normal[0] * (hip[0] - s1Middle[0]) + normal[1] * (hip[1] - s1Middle[1]) < 0) normal = normal.map((value) => -value);
    const length = distance(s1Middle, hip);
    const magnitude = Math.max(distance([0, 0], normal), 1);
    const normalEnd = [s1Middle[0] + normal[0] * length / magnitude, s1Middle[1] + normal[1] * length / magnitude];
    drawLine(context, [s1Middle, normalEnd], angleColors.PI);
    drawLine(context, [s1Middle, hip], angleColors.PI);
    drawLabel(context, `PI ${result.measurements.PI.toFixed(1)}°`, midpoint([s1Middle, hip]), angleColors.PI);
  }
  if (selected.has('PT') && Number.isFinite(result.measurements.PT) && hip) {
    drawLine(context, [hip, s1Middle], angleColors.PT);
    drawLine(context, [hip, [hip[0], s1Middle[1]]], angleColors.PT);
    drawLabel(context, `PT ${result.measurements.PT.toFixed(1)}°`, [hip[0], hip[1] + 16 * width], angleColors.PT);
  }
  if (selected.has('L1PA') && Number.isFinite(result.measurements.L1PA) && hip) {
    drawLine(context, [hip, l1Center], angleColors.L1PA);
    drawLine(context, [hip, s1Middle], angleColors.L1PA);
    drawLabel(context, `L1PA ${result.measurements.L1PA.toFixed(1)}°`, midpoint([hip, l1Center]), angleColors.L1PA);
  }
  Object.entries(result.measurements.LL).forEach(([name, value]) => {
    if (!selected.has(name) || !Number.isFinite(value)) return;
    const level = name.split('-')[0];
    const endplate = geometry.vertebrae[level].superior;
    drawLine(context, endplate, angleColors[name]);
    drawLine(context, s1, angleColors[name]);
    drawLabel(context, `LL ${name} ${value.toFixed(1)}°`, midpoint(endplate), angleColors[name]);
  });
}

function solve3x3(matrix, values) {
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-9) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let entry = column; entry < 4; entry += 1) augmented[column][entry] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry < 4; entry += 1) augmented[row][entry] -= factor * augmented[column][entry];
    }
  }
  return [augmented[0][3], augmented[1][3], augmented[2][3]];
}

function fitCircle(points) {
  if (points.length < 3) return null;
  let sxx = 0; let syy = 0; let sxy = 0; let sx = 0; let sy = 0;
  let sbx = 0; let sby = 0; let sb = 0;
  for (const [x, y] of points) {
    const b = x * x + y * y;
    sxx += 4 * x * x; syy += 4 * y * y; sxy += 4 * x * y; sx += 2 * x; sy += 2 * y;
    sbx += 2 * x * b; sby += 2 * y * b; sb += b;
  }
  const solved = solve3x3([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, points.length]], [sbx, sby, sb]);
  if (!solved) return null;
  const [cx, cy, constant] = solved;
  const radiusSquared = cx * cx + cy * cy + constant;
  return Number.isFinite(radiusSquared) && radiusSquared > 0 ? [cx, cy, Math.sqrt(radiusSquared)] : null;
}

function midpoint(line) {
  return [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2];
}

function distance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function drawLine(context, line, color) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, canvas.width / 400);
  context.beginPath();
  context.moveTo(...line[0]);
  context.lineTo(...line[1]);
  context.stroke();
  context.restore();
}

function drawLabel(context, text, point, color) {
  context.save();
  const fontSize = Math.max(15, canvas.width / 45);
  context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  const width = context.measureText(text).width + 12;
  context.fillStyle = 'rgba(5, 7, 10, .78)';
  context.fillRect(point[0] - 4, point[1] - fontSize, width, fontSize + 7);
  context.fillStyle = color;
  context.fillText(text, point[0] + 2, point[1] + 2);
  context.restore();
}
