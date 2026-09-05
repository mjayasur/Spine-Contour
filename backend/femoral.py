"""Two femoral heads from one segmented blob.

On a lateral radiograph the two femoral heads overlap, and their mask is one
component: a peanut when the overlap is partial, a single disc when it is
near-total. A Hough transform on that blob tends to see one circle -- the two
accumulator peaks merge -- which is how the previous fit came to reject most
merged heads. This fits the shape as what it is, the union of two discs.

The distance transform is the seed: it peaks at each disc's centre, at that
disc's radius, and for a near-coincident pair it forms a ridge whose ends are
the two centres. Three seedings are tried (two peaks, the ridge's ends, and
one disc peeled off the other), each is refined on the contour points it owns
with a leashed robust circle fit, then polished directly against the one thing
that is actually known -- the union's overlap with the mask -- and the best
union wins. A head the frame has cut off comes back as a near-duplicate of the
visible one, which is the honest reading of such a mask.
"""
from __future__ import annotations
import math
import cv2
import numpy as np


def _algebraic_circle(points: np.ndarray) -> np.ndarray:
    x, y = points[:, 0], points[:, 1]
    cx, cy, c = np.linalg.lstsq(np.column_stack((2 * x, 2 * y, np.ones(len(x)))), x * x + y * y, rcond=None)[0]
    return np.asarray((cx, cy, math.sqrt(max(1.0, c + cx * cx + cy * cy))))


def _refine_circle(points: np.ndarray, circle: np.ndarray, r_bounds: tuple[float, float],
                   iterations: int = 12) -> tuple[np.ndarray, float]:
    """Huber-weighted Gauss-Newton, with a leash: a step that moves the centre
    by more than a radius or leaves the radius bounds is a divergence, not a fit."""
    x, y = points[:, 0], points[:, 1]
    circle = circle.astype(np.float64).copy()
    for _ in range(iterations):
        distance = np.hypot(x - circle[0], y - circle[1]).clip(1e-6)
        residual = distance - circle[2]
        robust_scale = max(0.5, 1.4826 * float(np.median(np.abs(residual - np.median(residual)))))
        cutoff = 2.5 * robust_scale
        weights = np.minimum(1.0, cutoff / np.maximum(np.abs(residual), 1e-6))
        jacobian = np.column_stack(((circle[0] - x) / distance, (circle[1] - y) / distance, -np.ones(len(x))))
        root_weights = np.sqrt(weights)
        update = np.linalg.lstsq(jacobian * root_weights[:, None], -residual * root_weights, rcond=None)[0]
        if not np.all(np.isfinite(update)) or np.hypot(update[0], update[1]) > circle[2]:
            break
        candidate = circle + update
        if not (r_bounds[0] <= candidate[2] <= r_bounds[1]):
            break
        circle = candidate
        if float(np.linalg.norm(update)) < 1e-3:
            break
    residual = np.abs(np.hypot(x - circle[0], y - circle[1]) - circle[2])
    confidence = math.exp(-float(np.median(residual)) / max(0.1 * circle[2], 1.0))
    return circle, confidence


class _Union:
    """Rasterised union-vs-mask IoU on a bounding window, cheap enough to optimise on."""

    def __init__(self, binary: np.ndarray):
        ys, xs = np.nonzero(binary)
        pad = int(0.5 * math.sqrt(binary.sum() / math.pi)) + 4
        self.y0, self.x0 = max(0, ys.min() - pad), max(0, xs.min() - pad)
        y1, x1 = min(binary.shape[0], ys.max() + pad + 1), min(binary.shape[1], xs.max() + pad + 1)
        self.mask = binary[self.y0:y1, self.x0:x1] > 0
        self.yy, self.xx = np.mgrid[self.y0:y1, self.x0:x1]
        self.area = int(self.mask.sum())

    def iou(self, circles) -> float:
        union = np.zeros(self.mask.shape, bool)
        for cx, cy, r in circles:
            union |= (self.xx - cx) ** 2 + (self.yy - cy) ** 2 <= r * r
        inter = int((union & self.mask).sum())
        return inter / max(1, int(union.sum()) + self.area - inter)


def _nelder_mead(f, x0: np.ndarray, step: np.ndarray, iterations: int = 220, tol: float = 1e-4) -> np.ndarray:
    """Compact Nelder-Mead; the problem is six-dimensional and the objective is a raster."""
    n = len(x0)
    simplex = [x0.copy()] + [x0 + np.eye(n)[i] * step[i] for i in range(n)]
    values = [f(p) for p in simplex]
    for _ in range(iterations):
        order = np.argsort(values); simplex = [simplex[i] for i in order]; values = [values[i] for i in order]
        if abs(values[-1] - values[0]) < tol:
            break
        centroid = np.mean(simplex[:-1], axis=0)
        reflected = centroid + (centroid - simplex[-1]); fr = f(reflected)
        if fr < values[0]:
            expanded = centroid + 2.0 * (centroid - simplex[-1]); fe = f(expanded)
            simplex[-1], values[-1] = (expanded, fe) if fe < fr else (reflected, fr)
        elif fr < values[-2]:
            simplex[-1], values[-1] = reflected, fr
        else:
            contracted = centroid + 0.5 * (simplex[-1] - centroid); fc = f(contracted)
            if fc < values[-1]:
                simplex[-1], values[-1] = contracted, fc
            else:
                simplex = [simplex[0]] + [simplex[0] + 0.5 * (p - simplex[0]) for p in simplex[1:]]
                values = [values[0]] + [f(p) for p in simplex[1:]]
    return simplex[int(np.argmin(values))]


def _distance_peaks(dist: np.ndarray, peak: float) -> list[np.ndarray]:
    window = max(3, int(round(0.3 * peak)) | 1)
    dilated = cv2.dilate(dist, np.ones((window, window), np.uint8))
    maxima = (dist >= dilated - 1e-6) & (dist >= 0.4 * peak)
    ys, xs = np.nonzero(maxima)
    if len(xs) < 2:
        return []
    order = np.argsort(-dist[ys, xs])
    first = np.asarray((xs[order[0]], ys[order[0]]), float)
    for k in order[1:]:
        p = np.asarray((xs[k], ys[k]), float)
        if np.linalg.norm(p - first) >= 0.3 * peak:
            return [np.asarray((*first, dist[int(first[1]), int(first[0])])),
                    np.asarray((*p, dist[int(p[1]), int(p[0])]))]
    return []


def _ridge_ends(dist: np.ndarray, peak: float) -> list[np.ndarray]:
    ys, xs = np.nonzero(dist >= 0.96 * peak)
    pts = np.column_stack((xs, ys)).astype(np.float64)
    centre = pts.mean(axis=0)
    axis = np.asarray((1.0, 0.0))
    if len(pts) >= 3:
        _, _, vt = np.linalg.svd(pts - centre, full_matrices=False); axis = vt[0]
    proj = (pts - centre) @ axis
    a, b = pts[int(np.argmin(proj))], pts[int(np.argmax(proj))]
    return [np.asarray((*a, peak)), np.asarray((*b, peak))]


def _peel(contour: np.ndarray, first: np.ndarray, r_bounds) -> list[np.ndarray]:
    """Fit the first disc, then a second to whatever contour it does not explain."""
    disc, _ = _refine_circle(contour, first, r_bounds)
    unexplained = contour[np.abs(np.hypot(contour[:, 0] - disc[0], contour[:, 1] - disc[1]) - disc[2]) > 0.08 * disc[2]]
    if len(unexplained) < 8:
        return [disc, disc.copy()]
    second = _algebraic_circle(unexplained)
    second[2] = float(np.clip(second[2], *r_bounds))
    return [disc, second]


def fit_two_discs(component: np.ndarray, polish: bool = True) -> dict | None:
    """Two circles whose union is this component, or None if there is no component."""
    binary = (np.asarray(component) > 0).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)[:, 0].astype(np.float64)
    r_eq = math.sqrt(cv2.contourArea(max(contours, key=cv2.contourArea)) / math.pi)
    r_bounds = (0.35 * r_eq, 1.6 * r_eq)
    dist = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    peak = float(dist.max())
    if peak < 2.0 or len(contour) < 16:
        return None

    seeds = {"two_peaks": _distance_peaks(dist, peak), "ridge": _ridge_ends(dist, peak)}
    top = np.unravel_index(int(dist.argmax()), dist.shape)
    seeds["peel"] = _peel(contour, np.asarray((top[1], top[0], peak), float), r_bounds)
    union = _Union(binary)

    def objective(p):
        """One minus the union's overlap with the mask, plus a wall at the radius bounds."""
        inside = r_bounds[0] <= min(p[2], p[5]) and max(p[2], p[5]) <= r_bounds[1]
        return 1.0 - union.iou([p[:3], p[3:]]) + (0.0 if inside else 1.0)

    best = None
    for method, seed in seeds.items():
        if not seed:
            continue
        circles = [np.asarray(s, float).copy() for s in seed]
        confidences = [0.0, 0.0]
        for _ in range(4):
            d = np.stack([np.abs(np.hypot(contour[:, 0] - c[0], contour[:, 1] - c[1]) - c[2]) for c in circles], axis=1)
            owner = np.argmin(d, axis=1)
            for i, c in enumerate(circles):
                mine = contour[owner == i]
                if len(mine) >= 8:
                    circles[i], confidences[i] = _refine_circle(mine, c, r_bounds)
        if polish:
            x0 = np.concatenate(circles)
            step = np.asarray([0.15 * r_eq, 0.15 * r_eq, 0.1 * r_eq] * 2)
            x = _nelder_mead(objective, x0, step)
            x = _nelder_mead(objective, x, step * 0.3)          # a finer pass from where the first settled
            circles = [x[:3].copy(), x[3:].copy()]
            d = np.stack([np.abs(np.hypot(contour[:, 0] - c[0], contour[:, 1] - c[1]) - c[2]) for c in circles], axis=1)
            owner = np.argmin(d, axis=1)
            confidences = []
            for i, c in enumerate(circles):
                mine = contour[owner == i]
                res = np.abs(np.hypot(mine[:, 0] - c[0], mine[:, 1] - c[1]) - c[2]) if len(mine) else np.asarray([c[2]])
                confidences.append(math.exp(-float(np.median(res)) / max(0.1 * c[2], 1.0)))
        cost = float(objective(np.concatenate(circles)))
        if best is None or cost < best["cost"]:
            best = {"circles": [c.copy() for c in circles], "method": method, "cost": cost,
                    "fit_confidence": float(min(confidences)), "iou": float(union.iou(circles))}
    return best


