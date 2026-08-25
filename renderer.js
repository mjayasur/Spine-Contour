const chooseButton = document.querySelector('#choose-file');
const predictButton = document.querySelector('#predict');
const fileName = document.querySelector('#file-name');
const preview = document.querySelector('#preview');
const status = document.querySelector('#status');
const canvas = document.querySelector('#mask');
const legend = document.querySelector('#legend');

let selectedFile = null;
let previewUrl = null;

const labelColors = {
  20: [255, 99, 132],
  21: [255, 159, 64],
  22: [255, 205, 86],
  23: [75, 192, 192],
  24: [54, 162, 235],
};

legend.innerHTML = Object.entries(labelColors)
  .map(([label, color], index) => `<span><i class="swatch" style="background:rgb(${color.join(',')})"></i>L${index + 1} (label ${label})</span>`)
  .join('');

chooseButton.addEventListener('click', async () => {
  const chosen = await window.spineContour.selectFile();
  if (!chosen) return;
  selectedFile = chosen;
  fileName.textContent = chosen.name;
  predictButton.disabled = false;
  status.textContent = 'Ready to segment.';
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  const extension = chosen.name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'].includes(extension)) {
    previewUrl = URL.createObjectURL(new Blob([chosen.data]));
    preview.src = previewUrl;
  } else {
    preview.removeAttribute('src');
    preview.alt = 'DICOM selected; segmentation is available through the backend.';
  }
});

predictButton.addEventListener('click', async () => {
  if (!selectedFile) return;
  predictButton.disabled = true;
  status.textContent = 'Segmenting…';
  try {
    const maskBytes = await window.spineContour.predict({
      name: selectedFile.name,
      data: selectedFile.data,
      modality: document.querySelector('#modality').value,
      bodyPart: document.querySelector('#body-part').value,
      view: document.querySelector('#view').value,
    });
    await renderMask(new Blob([maskBytes], { type: 'image/png' }));
    status.textContent = 'Segmentation complete.';
  } catch (error) {
    status.textContent = `Could not segment: ${error.message}`;
  } finally {
    predictButton.disabled = false;
  }
});

async function renderMask(blob) {
  const bitmap = await createImageBitmap(blob);
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const color = labelColors[pixels.data[offset]];
    if (color) {
      pixels.data[offset] = color[0];
      pixels.data[offset + 1] = color[1];
      pixels.data[offset + 2] = color[2];
      pixels.data[offset + 3] = 255;
    } else {
      pixels.data[offset] = 4;
      pixels.data[offset + 1] = 7;
      pixels.data[offset + 2] = 10;
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  bitmap.close();
}
