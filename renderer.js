const chooseButton = document.querySelector('#choose-file');
const predictButton = document.querySelector('#predict');
const fileName = document.querySelector('#file-name');
const preview = document.querySelector('#preview');
const status = document.querySelector('#status');
const canvas = document.querySelector('#result');
const legend = document.querySelector('#legend');
const measurementControls = document.querySelector('#measurement-controls');

let selectedFile = null;
let previewUrl = null;
let result = null;

const labelColors = {
  20: [255, 99, 132],
  21: [255, 159, 64],
  22: [255, 205, 86],
  23: [75, 192, 192],
  24: [54, 162, 235],
};
const angleColors = {
  SI: '#ffd166',
  PI: '#ef476f',
  PT: '#06d6a0',
  'L1-S1': '#ff6384',
  'L2-S1': '#ff9f40',
  'L3-S1': '#ffcd56',
  'L4-S1': '#4bc0c0',
  'L5-S1': '#36a2eb',
};

legend.innerHTML = Object.entries(labelColors)
  .map(([label, color], index) => `<span><i class="swatch" style="background:rgb(${color.join(',')})"></i>L${index + 1} (label ${label})</span>`)
  .concat('<span><i class="swatch" style="background:#62d26f"></i>Femoral heads</span>')
  .join('');

chooseButton.addEventListener('click', async () => {
  const chosen = await window.spineContour.selectFile();
  if (!chosen) return;
  selectedFile = chosen;
  result = null;
  fileName.textContent = chosen.name;
  predictButton.disabled = false;
  status.textContent = 'Ready to measure.';
  measurementControls.hidden = true;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

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
  try {
    result = await window.spineContour.predict({
      name: selectedFile.name,
      data: selectedFile.data,
      modality: document.querySelector('#modality').value,
      bodyPart: document.querySelector('#body-part').value,
      view: document.querySelector('#view').value,
    });
    preview.src = `data:image/png;base64,${result.image_png}`;
    document.querySelectorAll('[data-value]').forEach((output) => {
      const name = output.dataset.value;
      const value = result.measurements[name] ?? result.measurements.LL[name];
      output.value = `${value.toFixed(1)}°`;
    });
    measurementControls.hidden = false;
    await renderResult();
    status.textContent = 'Measurements complete.';
  } catch (error) {
    status.textContent = `Could not measure: ${error.message}`;
  } finally {
    predictButton.disabled = false;
  }
});

measurementControls.addEventListener('change', () => renderResult());

async function bitmapFromBase64(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

async function renderResult() {
  if (!result) return;
  const [image, mask, femoral] = await Promise.all([
    bitmapFromBase64(result.image_png),
    bitmapFromBase64(result.mask_png),
    bitmapFromBase64(result.femoral_mask_png),
  ]);
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);

  const scratch = document.createElement('canvas');
  scratch.width = image.width;
  scratch.height = image.height;
  const scratchContext = scratch.getContext('2d');
  const overlay = context.createImageData(image.width, image.height);
  scratchContext.drawImage(mask, 0, 0);
  const maskPixels = scratchContext.getImageData(0, 0, image.width, image.height).data;
  scratchContext.clearRect(0, 0, image.width, image.height);
  scratchContext.drawImage(femoral, 0, 0);
  const femoralPixels = scratchContext.getImageData(0, 0, image.width, image.height).data;
  for (let offset = 0; offset < overlay.data.length; offset += 4) {
    const color = labelColors[maskPixels[offset]];
    if (color) {
      overlay.data.set([...color, 58], offset);
    } else if (femoralPixels[offset]) {
      overlay.data.set([98, 210, 111, 58], offset);
    }
  }
  scratchContext.putImageData(overlay, 0, 0);
  context.drawImage(scratch, 0, 0);

  const geometry = result.geometry;
  const width = Math.max(2, image.width / 600);
  context.lineWidth = width;
  context.lineJoin = 'round';
  Object.entries(geometry.vertebrae).forEach(([level, body], index) => {
    context.strokeStyle = `rgb(${labelColors[20 + index].join(',')})`;
    context.beginPath();
    body.quadrilateral.forEach((point, pointIndex) => pointIndex ? context.lineTo(...point) : context.moveTo(...point));
    context.closePath();
    context.stroke();
    body.quadrilateral.forEach((point) => {
      context.beginPath();
      context.arc(point[0], point[1], width * 1.6, 0, 2 * Math.PI);
      context.fillStyle = context.strokeStyle;
      context.fill();
    });
  });
  context.strokeStyle = '#62d26f';
  geometry.femoral_circles.forEach(([x, y, radius]) => {
    context.beginPath();
    context.arc(x, y, radius, 0, 2 * Math.PI);
    context.stroke();
  });

  const selected = new Set(
    [...document.querySelectorAll('[data-measurement]:checked')].map((input) => input.dataset.measurement),
  );
  const s1 = geometry.s1_superior;
  const s1Middle = midpoint(s1);
  const hip = geometry.hip_midpoint;
  const s1Length = distance(s1[0], s1[1]);

  if (selected.has('SI')) {
    drawLine(context, s1, angleColors.SI);
    drawLine(context, [[s1Middle[0] - s1Length / 2, s1Middle[1]], [s1Middle[0] + s1Length / 2, s1Middle[1]]], angleColors.SI);
    drawLabel(context, `SI ${result.measurements.SI.toFixed(1)}°`, [s1Middle[0], s1Middle[1] - 16 * width], angleColors.SI);
  }
  if (selected.has('PI')) {
    const endplateVector = [s1[1][0] - s1[0][0], s1[1][1] - s1[0][1]];
    let normal = [-endplateVector[1], endplateVector[0]];
    if (normal[0] * (hip[0] - s1Middle[0]) + normal[1] * (hip[1] - s1Middle[1]) < 0) normal = normal.map((value) => -value);
    const length = distance(s1Middle, hip);
    const magnitude = Math.max(distance([0, 0], normal), 1);
    const normalEnd = [s1Middle[0] + normal[0] * length / magnitude, s1Middle[1] + normal[1] * length / magnitude];
    drawLine(context, [s1Middle, normalEnd], angleColors.PI);
    drawLine(context, [s1Middle, hip], angleColors.PI);
    drawLabel(context, `PI ${result.measurements.PI.toFixed(1)}°`, midpoint([s1Middle, hip]), angleColors.PI);
  }
  if (selected.has('PT')) {
    drawLine(context, [hip, s1Middle], angleColors.PT);
    drawLine(context, [hip, [hip[0], s1Middle[1]]], angleColors.PT);
    drawLabel(context, `PT ${result.measurements.PT.toFixed(1)}°`, [hip[0], hip[1] + 16 * width], angleColors.PT);
  }
  Object.entries(result.measurements.LL).forEach(([name, value]) => {
    if (!selected.has(name)) return;
    const level = name.split('-')[0];
    const endplate = geometry.vertebrae[level].superior;
    drawLine(context, endplate, angleColors[name]);
    drawLine(context, s1, angleColors[name]);
    drawLabel(context, `LL ${name} ${value.toFixed(1)}°`, midpoint(endplate), angleColors[name]);
  });

  image.close();
  mask.close();
  femoral.close();
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
