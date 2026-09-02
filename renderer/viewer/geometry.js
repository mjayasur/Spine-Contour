export const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5'];
export const CORNERS = ['SA', 'SP', 'IA', 'IP'];

// Ported verbatim from the legacy root-level renderer.js:590-606. That file was
// deleted by this plan's Task 11 -- the citation is historical, and the source is
// recoverable from git history if this ever needs re-checking.
function solve3x3(matrix, values) {
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
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

// Ported verbatim from the legacy root-level renderer.js:608-622 (historical; see above).
export function fitCircle(points) {
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

export function landmarkAt(geometry, level, corner) {
  if (level === 'S1') return geometry.s1_superior[corner === 'SA' ? 0 : 1];
  const body = geometry.vertebrae[level];
  if (corner === 'SA') return body.superior[0];
  if (corner === 'SP') return body.superior[1];
  if (corner === 'IA') return body.inferior[0];
  return body.inferior[1];
}

export function setLandmarkAt(geometry, level, corner, point) {
  if (level === 'S1') {
    geometry.s1_superior[corner === 'SA' ? 0 : 1] = point;
    return geometry;
  }
  const body = geometry.vertebrae[level];
  if (corner === 'SA') body.superior[0] = point;
  else if (corner === 'SP') body.superior[1] = point;
  else if (corner === 'IA') body.inferior[0] = point;
  else body.inferior[1] = point;
  body.quadrilateral = [body.superior[0], body.superior[1], body.inferior[1], body.inferior[0]];
  return geometry;
}

export function clientToImage(ev, canvas) {
  const rect = canvas.getBoundingClientRect();
  return [
    Math.max(0, Math.min(canvas.width, ((ev.clientX - rect.left) * canvas.width) / rect.width)),
    Math.max(0, Math.min(canvas.height, ((ev.clientY - rect.top) * canvas.height) / rect.height)),
  ];
}

export function imageToClient(pt, rect, canvas) {
  return [
    rect.left + (pt[0] * rect.width) / canvas.width,
    rect.top + (pt[1] * rect.height) / canvas.height,
  ];
}

export function nearestLandmark(geometry, clientX, clientY, canvas, radius = 14) {
  const rect = canvas.getBoundingClientRect();
  let nearest = null;
  for (const level of [...LEVELS, 'S1']) {
    for (const corner of level === 'S1' ? ['SA', 'SP'] : CORNERS) {
      const point = landmarkAt(geometry, level, corner);
      const [x, y] = imageToClient(point, rect, canvas);
      const distance = Math.hypot(clientX - x, clientY - y);
      if (distance <= radius && (!nearest || distance < nearest.distance)) {
        nearest = { level, corner, distance };
      }
    }
  }
  return nearest;
}
