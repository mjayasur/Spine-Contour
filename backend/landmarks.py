"""Named vertebral corners from a label map, and the mask from named corners.

The corner names are anatomical -- SA, SP, IA, IP for the superior/inferior
anterior/posterior corners -- and anterior is decided by the S1 endplate's own
A/P identity, not by which side of the image a point sits on. A mirrored
lateral radiograph is a valid lateral radiograph of the same patient seen from
the other side; the anterior corner is still anterior.
"""

from __future__ import annotations

import cv2
import numpy as np

LUMBAR_LEVELS = ("L1", "L2", "L3", "L4", "L5")
MIN_BODY_AREA_PX = 200      # in model-frame pixels; below this a component is noise


def quad_corners(mask: np.ndarray) -> np.ndarray | None:
    """Four unnamed vertices for a body's mask, or None if there is no body."""
    binary = (np.asarray(mask) > 0).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < MIN_BODY_AREA_PX:
        return None
    hull = cv2.convexHull(contour)
    perimeter = cv2.arcLength(hull, True)
    for fraction in np.arange(0.010, 0.120, 0.004):
        approx = cv2.approxPolyDP(hull, fraction * perimeter, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float64)
    # A rotated rectangle cannot represent a wedge-shaped body, so this
    # fallback biases endplate angles; it is a last resort, not the norm.
    return cv2.boxPoints(cv2.minAreaRect(contour)).astype(np.float64)


def name_corners(corners: np.ndarray, anterior: np.ndarray) -> dict[str, np.ndarray]:
    """Name a quad's vertices SA/SP/IA/IP given a vector that points anterior."""
    centre = corners.mean(axis=0)
    order = np.argsort(np.arctan2(corners[:, 1] - centre[1], corners[:, 0] - centre[0]))
    ring = corners[order]
    edges = [(ring[i], ring[(i + 1) % 4], (ring[i][1] + ring[(i + 1) % 4][1]) / 2.0)
             for i in range(4)]
    top = int(np.argmin([e[2] for e in edges]))
    sup_p, sup_q, _ = edges[top]
    inf_p, inf_q, _ = edges[(top + 2) % 4]
    sa, sp = (sup_p, sup_q) if np.dot(sup_p - sup_q, anterior) > 0 else (sup_q, sup_p)
    ia, ip = (inf_p, inf_q) if np.dot(inf_p - inf_q, anterior) > 0 else (inf_q, inf_p)
    return {"SA": sa, "SP": sp, "IA": ia, "IP": ip}


def corners_from_label_map(label_map: np.ndarray, level_values: dict[str, int],
                           anterior: np.ndarray) -> dict[str, dict[str, np.ndarray]]:
    """Named corners for every level whose mask yields a body."""
    out = {}
    for level, value in level_values.items():
        corners = quad_corners(label_map == value)
        if corners is not None:
            out[level] = name_corners(corners, anterior)
    return out


def label_map_from_corners(corners: dict[str, dict[str, np.ndarray]],
                           level_values: dict[str, int], shape: tuple[int, int]) -> np.ndarray:
    """Rasterise named corners into a label map: each body is its convex hull."""
    label_map = np.zeros(shape, dtype=np.uint8)
    for level, value in level_values.items():
        quad = corners.get(level)
        if not quad:
            continue
        points = np.rint(np.stack([quad[k] for k in ("SA", "SP", "IP", "IA")])).astype(np.int32)
        cv2.fillConvexPoly(label_map, cv2.convexHull(points), int(value))
    return label_map


def to_contract(corners: dict[str, dict[str, np.ndarray]]) -> dict[str, dict[str, list]]:
    """The renderer's shape: superior [SA, SP], inferior [IA, IP], quad SA,SP,IP,IA."""
    return {
        level: {
            "superior": [quad["SA"].tolist(), quad["SP"].tolist()],
            "inferior": [quad["IA"].tolist(), quad["IP"].tolist()],
            "quadrilateral": [quad[k].tolist() for k in ("SA", "SP", "IP", "IA")],
        }
        for level, quad in corners.items()
    }
