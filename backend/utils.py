"""Geometry derived from common-label spine and femoral masks."""

from __future__ import annotations

import math

import cv2
import numpy as np

try:
    from .models import LUMBAR_LEVELS, VertebraLabel
except ImportError:  # Support running modules directly from backend/.
    from models import LUMBAR_LEVELS, VertebraLabel


def _acute_angle(first: np.ndarray, second: np.ndarray) -> float:
    angles = [math.atan2(float(line[1, 1] - line[0, 1]), float(line[1, 0] - line[0, 0])) for line in (first, second)]
    difference = abs(math.degrees(math.atan2(math.sin(angles[1] - angles[0]), math.cos(angles[1] - angles[0]))))
    return float(min(difference, 180.0 - difference))


def vertebral_quadrilaterals(mask: np.ndarray) -> dict[str, dict[str, list[list[float]]]]:
    """Fit a convex-hull quadrilateral to each labeled lumbar body."""

    labels = np.asarray(mask)
    if labels.ndim != 2 or not np.issubdtype(labels.dtype, np.integer):
        raise ValueError("mask must be a two-dimensional integer common-label array")
    components, centers = [], []
    for level in LUMBAR_LEVELS:
        component = (labels == int(getattr(VertebraLabel, level))).astype(np.uint8)
        if not component.any():
            continue
        contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        contour = max(contours, key=cv2.contourArea)
        hull = cv2.convexHull(contour)
        perimeter = cv2.arcLength(hull, True)
        polygon = None
        for fraction in np.linspace(0.002, 0.08, 120):
            approximation = cv2.approxPolyDP(hull, float(fraction * perimeter), True)
            if len(approximation) == 4:
                polygon = approximation[:, 0].astype(np.float64)
                break
            if len(approximation) < 4:
                break
        if polygon is None:
            polygon = cv2.boxPoints(cv2.minAreaRect(hull)).astype(np.float64)
        y, x = np.nonzero(component)
        components.append((level, polygon))
        centers.append(np.asarray((x.mean(), y.mean()), dtype=np.float64))

    output = {}
    for index, ((level, polygon), center) in enumerate(zip(components, centers)):
        if len(centers) == 1:
            axis = np.asarray((0.0, 1.0))
        elif index == 0:
            axis = centers[1] - center
        elif index == len(centers) - 1:
            axis = center - centers[-2]
        else:
            axis = centers[index + 1] - centers[index - 1]
        axis /= max(float(np.linalg.norm(axis)), 1e-6)
        if axis[1] < 0:
            axis *= -1

        choices = []
        for start in (0, 1):
            edges, alignment = [], 0.0
            for edge_index in (start, start + 2):
                edge = np.vstack((polygon[edge_index % 4], polygon[(edge_index + 1) % 4]))
                vector = edge[1] - edge[0]
                alignment += abs(float(np.dot(vector / max(float(np.linalg.norm(vector)), 1e-6), axis)))
                edges.append(edge[np.argsort(edge[:, 0])])
            choices.append((alignment, edges))
        endplates = min(choices, key=lambda item: item[0])[1]
        endplates.sort(key=lambda edge: float(np.dot(edge.mean(axis=0) - center, axis)))
        output[level] = {
            "quadrilateral": polygon.tolist(),
            "superior": endplates[0].tolist(),
            "inferior": endplates[1].tolist(),
        }
    return output


def _femoral_geometry(mask: np.ndarray) -> tuple[np.ndarray, list[np.ndarray], dict[str, object]]:
    binary = (np.asarray(mask) > 0).astype(np.uint8)
    if binary.ndim != 2 or not binary.any():
        raise ValueError("femoral-head segmentation is empty")
    scale = min(1.0, 512.0 / max(binary.shape))
    working = cv2.resize(binary, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST) if scale < 1 else binary
    working = cv2.morphologyEx(working, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    working = cv2.morphologyEx(working, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, component_labels, stats, _ = cv2.connectedComponentsWithStats(working, connectivity=8)
    components = sorted(
        ((int(stats[label, cv2.CC_STAT_AREA]), (component_labels == label).astype(np.uint8)) for label in range(1, count) if stats[label, cv2.CC_STAT_AREA] >= 40),
        reverse=True,
        key=lambda item: item[0],
    )

    def fit_circle(component: np.ndarray) -> np.ndarray:
        contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        points = max(contours, key=cv2.contourArea)[:, 0].astype(np.float64)
        x, y = points[:, 0], points[:, 1]
        cx, cy, constant = np.linalg.lstsq(
            np.column_stack((2 * x, 2 * y, np.ones(len(x)))), x * x + y * y, rcond=None
        )[0]
        return np.asarray((cx, cy, math.sqrt(max(1.0, constant + cx * cx + cy * cy))))

    if len(components) >= 2:
        circles = [fit_circle(component) for _, component in components[:2]]
        method = "two_component_circle_fit"
    elif len(components) == 1:
        image = cv2.GaussianBlur(working * 255, (5, 5), 1.0)
        candidates = None
        for threshold in (18, 15, 12, 10, 8):
            candidates = cv2.HoughCircles(image, cv2.HOUGH_GRADIENT, 1, 10, param1=80, param2=threshold, minRadius=8, maxRadius=90)
            if candidates is not None and len(candidates[0]) >= 2:
                break
        best = None
        if candidates is not None:
            yy, xx = np.mgrid[: working.shape[0], : working.shape[1]]
            for first_index, first in enumerate(candidates[0]):
                for second in candidates[0][first_index + 1 :]:
                    if np.linalg.norm(first[:2] - second[:2]) < 5:
                        continue
                    rendered = ((xx - first[0]) ** 2 + (yy - first[1]) ** 2 <= first[2] ** 2) | ((xx - second[0]) ** 2 + (yy - second[1]) ** 2 <= second[2] ** 2)
                    score = float((rendered & (working > 0)).sum()) / max(int((rendered | (working > 0)).sum()), 1)
                    if best is None or score > best[0]:
                        best = (score, first.astype(np.float64), second.astype(np.float64))
        circles = [best[1], best[2]] if best else [fit_circle(components[0][1])] * 2
        method = "connected_union_hough_fit" if best else "single_component_circle_fit"
    else:
        raise ValueError("femoral-head segmentation is empty after cleanup")

    circles = [circle / scale for circle in circles]
    circles.sort(key=lambda value: (float(value[1]), float(value[0])))
    return 0.5 * (circles[0][:2] + circles[1][:2]), circles, {
        "method": method,
        "component_count": len(components),
        "foreground_pixels": int(binary.sum()),
    }


def spinopelvic_measurements(
    mask: np.ndarray, s1_superior: list[list[float]] | np.ndarray, femoral_mask: np.ndarray
) -> dict[str, object]:
    """Return SI, PI, PT, and L1-S1 through L5-S1 lordosis."""

    vertebrae = vertebral_quadrilaterals(mask)
    missing = [level for level in LUMBAR_LEVELS if level not in vertebrae]
    if missing:
        raise ValueError(f"lumbar segmentation is missing {', '.join(missing)}")
    s1 = np.asarray(s1_superior, dtype=np.float64)
    if s1.shape != (2, 2):
        raise ValueError("S1 superior landmarks must contain two image points")
    s1 = s1[np.argsort(s1[:, 0])]
    hip_midpoint, circles, femoral_qc = _femoral_geometry(femoral_mask)
    s1_midpoint = s1.mean(axis=0)
    s1_vector = s1[1] - s1[0]
    connection = hip_midpoint - s1_midpoint
    s1_angle = math.atan2(float(s1_vector[1]), float(s1_vector[0]))
    normal_angle = s1_angle - math.pi / 2
    connection_angle = math.atan2(float(connection[1]), float(connection[0]))
    incidence = abs(math.degrees(math.atan2(math.sin(connection_angle - normal_angle), math.cos(connection_angle - normal_angle))))
    measurements = {
        "SI": float(min(abs(math.degrees(s1_angle)), 180 - abs(math.degrees(s1_angle)))),
        "PI": float(min(incidence, 180 - incidence)),
        "PT": float(abs(math.degrees(math.atan2(float(s1_midpoint[0] - hip_midpoint[0]), float(hip_midpoint[1] - s1_midpoint[1]))))),
        "LL": {
            f"{level}-S1": _acute_angle(np.asarray(vertebrae[level]["superior"]), s1)
            for level in LUMBAR_LEVELS
        },
    }
    return {
        "measurements": measurements,
        "geometry": {
            "vertebrae": vertebrae,
            "s1_superior": s1.tolist(),
            "hip_midpoint": hip_midpoint.tolist(),
            "femoral_circles": [circle.tolist() for circle in circles],
        },
        "qc": {"femoral": femoral_qc},
    }


def lumbar_lordosis(mask: np.ndarray) -> float:
    """Return L1-S1 lordosis, falling back to the L5 inferior endplate."""

    labels = np.asarray(mask)
    vertebrae = vertebral_quadrilaterals(labels)
    if "L1" not in vertebrae:
        raise ValueError("mask does not contain L1")
    if (labels == int(VertebraLabel.S1)).any():
        temporary = np.where(labels == int(VertebraLabel.S1), int(VertebraLabel.L1), 0).astype(np.uint8)
        endpoint = np.asarray(vertebral_quadrilaterals(temporary)["L1"]["superior"])
    elif "L5" in vertebrae:
        endpoint = np.asarray(vertebrae["L5"]["inferior"])
    else:
        raise ValueError("mask must contain S1 or L5")
    return _acute_angle(np.asarray(vertebrae["L1"]["superior"]), endpoint)
