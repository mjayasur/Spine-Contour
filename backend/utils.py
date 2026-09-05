"""Geometry derived from common-label spine and femoral masks."""

from __future__ import annotations

import math

import cv2
import numpy as np

try:
    from .femoral import fit_two_discs
    from .models import LUMBAR_LEVELS, VertebraLabel
except ImportError:  # Support running modules directly from backend/.
    from femoral import fit_two_discs
    from models import LUMBAR_LEVELS, VertebraLabel

# A union of two discs that explains less of a merged blob than this is not a
# pair of femoral heads. The two-component path keeps its own, older gate.
MERGED_MIN_IOU = 0.8

# The femoral mask is fitted at a working size of at most 512 px on the film's
# long side. On a full-spine film that is two or three times coarser than on a
# lumbar one, and a normal head can shrink under the radius floor below. So the
# foreground is never worked at less than this many pixels across, whatever the
# film around it measures; every threshold below then means the same thing on
# every film.
MIN_FOREGROUND_WORKING_PX = 96.0

# A second component only counts as the second head if it is of comparable
# size to the first. Femoral heads are near-equal; a speck a fraction of the
# size is a stray, and pairing it with a real head produced a "head" of a few
# pixels that the radius floor then rejected.
SECOND_HEAD_MIN_AREA_FRACTION = 0.2

# A femoral mask that runs into the edge of the film is a head the frame cut
# off. The circles fitted to what is left are a guess about the rest, and the
# hip axis with them, so the fit's confidence is capped under the renderer's
# review threshold and the reason is recorded.
EDGE_TOUCH_MAX_CONFIDENCE = 0.5


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
    rows, columns = np.nonzero(binary)
    foreground_extent = float(max(rows.max() - rows.min(), columns.max() - columns.min()) + 1)
    touches_edge = bool(rows.min() == 0 or columns.min() == 0
                        or rows.max() == binary.shape[0] - 1 or columns.max() == binary.shape[1] - 1)
    scale = min(1.0, max(512.0 / max(binary.shape), MIN_FOREGROUND_WORKING_PX / foreground_extent))
    working = (
        cv2.resize(binary, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
        if scale < 1
        else binary
    )
    working = cv2.morphologyEx(working, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    working = cv2.morphologyEx(working, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, component_labels, stats, _ = cv2.connectedComponentsWithStats(working, connectivity=8)
    components = sorted(
        (
            (int(stats[label, cv2.CC_STAT_AREA]), (component_labels == label).astype(np.uint8))
            for label in range(1, count)
            if stats[label, cv2.CC_STAT_AREA] >= 80
        ),
        reverse=True,
        key=lambda item: item[0],
    )
    if components:
        largest = components[0][0]
        components = [c for c in components if c[0] >= SECOND_HEAD_MIN_AREA_FRACTION * largest]

    def fit_circle(component: np.ndarray) -> tuple[np.ndarray, float]:
        contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        points = max(contours, key=cv2.contourArea)[:, 0].astype(np.float64)
        points = points[
            (points[:, 0] > 1)
            & (points[:, 0] < working.shape[1] - 2)
            & (points[:, 1] > 1)
            & (points[:, 1] < working.shape[0] - 2)
        ]
        if len(points) < 8:
            raise ValueError("insufficient non-border femoral contour for circle fitting")
        x, y = points[:, 0], points[:, 1]
        cx, cy, constant = np.linalg.lstsq(
            np.column_stack((2 * x, 2 * y, np.ones(len(x)))), x * x + y * y, rcond=None
        )[0]
        circle = np.asarray((cx, cy, math.sqrt(max(1.0, constant + cx * cx + cy * cy))))
        for _ in range(12):
            distance = np.hypot(x - circle[0], y - circle[1]).clip(1e-6)
            residual = distance - circle[2]
            robust_scale = max(0.5, 1.4826 * float(np.median(np.abs(residual - np.median(residual)))))
            cutoff = 2.5 * robust_scale
            weights = np.minimum(1.0, cutoff / np.maximum(np.abs(residual), 1e-6))
            jacobian = np.column_stack(((circle[0] - x) / distance, (circle[1] - y) / distance, -np.ones(len(x))))
            root_weights = np.sqrt(weights)
            update = np.linalg.lstsq(jacobian * root_weights[:, None], -residual * root_weights, rcond=None)[0]
            circle += update
            circle[2] = max(1.0, circle[2])
            if float(np.linalg.norm(update)) < 1e-3:
                break
        residual = np.abs(np.hypot(x - circle[0], y - circle[1]) - circle[2])
        confidence = math.exp(-float(np.median(residual)) / max(0.1 * circle[2], 1.0))
        return circle, confidence

    yy, xx = np.mgrid[: working.shape[0], : working.shape[1]]

    def circle_union(values: list[np.ndarray]) -> np.ndarray:
        rendered = np.zeros(working.shape, dtype=bool)
        for cx, cy, radius in values:
            rendered |= (xx - cx) ** 2 + (yy - cy) ** 2 <= radius**2
        return rendered

    if len(components) == 2:
        fitted = [fit_circle(component) for _, component in components]
        circles = [value[0] for value in fitted]
        fit_confidence = min(value[1] for value in fitted)
        method = "two_component_robust_circle_fit"
    elif len(components) == 1:
        # Two heads in one blob. Fit them as the union of two discs; see femoral.py.
        fit = fit_two_discs(components[0][1])
        if fit is None:
            raise ValueError("could not fit the merged femoral heads")
        circles = [np.asarray(c, dtype=np.float64) for c in fit["circles"]]
        fit_confidence = float(fit["iou"])
        method = "two_disc_" + fit["method"]
    elif len(components) > 2:
        raise ValueError(f"questionable femoral segmentation: found {len(components)} components")
    else:
        raise ValueError("femoral-head segmentation is empty after cleanup")

    rendered = circle_union(circles)
    intersection = int((rendered & (working > 0)).sum())
    union = int((rendered | (working > 0)).sum())
    iou = intersection / max(union, 1)
    radii = np.asarray([circle[2] for circle in circles])
    separation = float(np.linalg.norm(circles[0][:2] - circles[1][:2]))
    radius_ratio = float(radii.max() / max(radii.min(), 1e-6))
    merged = method.startswith("two_disc_")
    if merged:
        # Superimposed heads are the normal case on a true lateral, so a small
        # separation is not evidence against the fit; how much of the blob the
        # two discs explain is.
        confidence = min(iou, 1.0 / radius_ratio)
    else:
        separation_confidence = min(
            1.0,
            separation / max(7.0, 0.25 * float(radii.mean())),
            4.0 * float(radii.max()) / max(separation, 1e-6),
        )
        confidence = min(iou, 1.0 / radius_ratio, separation_confidence, fit_confidence)
    reasons = []
    if iou < (MERGED_MIN_IOU if merged else 0.45):
        reasons.append(f"circle_union_iou={iou:.3f}")
    if radii.min() < 8 or radii.max() > 90:
        reasons.append(f"radii={radii.tolist()}")
    if radius_ratio > 2.5:
        reasons.append(f"radius_ratio={radius_ratio:.3f}")
    if separation > 4 * radii.max() or (not merged and separation < 7):
        reasons.append(f"center_separation={separation:.3f}")
    if confidence < 0.45:
        reasons.append(f"confidence={confidence:.3f}")
    if touches_edge:
        confidence = min(confidence, EDGE_TOUCH_MAX_CONFIDENCE)
    if reasons:
        raise ValueError("femoral-head geometry rejected: " + ", ".join(reasons))

    circles = [circle / scale for circle in circles]
    circles.sort(key=lambda value: (float(value[1]), float(value[0])))
    return 0.5 * (circles[0][:2] + circles[1][:2]), circles, {
        "method": method,
        "component_count": len(components),
        "circle_union_iou": iou,
        "radii_pixels": (radii / scale).tolist(),
        "center_separation_pixels": separation / scale,
        "radius_ratio": radius_ratio,
        "confidence": confidence,
        "touches_frame_edge": touches_edge,
        "qc_pass": True,
        "foreground_pixels": int(binary.sum()),
    }


def spinopelvic_measurements(
    mask: np.ndarray, s1_superior: list[list[float]] | np.ndarray, femoral_mask: np.ndarray
) -> dict[str, object]:
    """Return SS, PI, PT, and L1-S1 through L5-S1 lordosis."""

    vertebrae = vertebral_quadrilaterals(mask)
    missing = [level for level in LUMBAR_LEVELS if level not in vertebrae]
    if missing:
        raise ValueError(f"lumbar segmentation is missing {', '.join(missing)}")
    s1 = np.asarray(s1_superior, dtype=np.float64)
    if s1.shape != (2, 2):
        raise ValueError("S1 superior landmarks must contain two image points")
    anterior_is_left = bool(s1[0, 0] < s1[1, 0])
    for body in vertebrae.values():
        superior = np.asarray(body["superior"], dtype=np.float64)
        inferior = np.asarray(body["inferior"], dtype=np.float64)
        if not anterior_is_left:
            superior, inferior = superior[::-1], inferior[::-1]
        body["superior"] = superior.tolist()
        body["inferior"] = inferior.tolist()
        body["quadrilateral"] = [
            superior[0].tolist(), superior[1].tolist(),
            inferior[1].tolist(), inferior[0].tolist(),
        ]
    hip_midpoint, circles, femoral_qc = _femoral_geometry(femoral_mask)
    l1_y, l1_x = np.nonzero(np.asarray(mask) == int(VertebraLabel.L1))
    l1_center = np.asarray((l1_x.mean(), l1_y.mean()))
    output = spinopelvic_measurements_from_geometry(vertebrae, s1, circles, l1_center)
    output["qc"] = {"femoral": femoral_qc}
    return output


def spinopelvic_measurements_from_landmarks(
    vertebrae: dict[str, dict[str, list[list[float]]]],
    s1_superior: list[list[float]] | np.ndarray,
    femoral_mask: np.ndarray,
    mask: np.ndarray | None = None,
) -> dict[str, object]:
    """Measurements from named corners, the S1 endplate, and the femoral mask.

    The corners arrive already named -- anterior first on every endplate -- so
    unlike `spinopelvic_measurements` nothing here re-derives the orientation
    from the picture. The femoral heads are fitted from their mask exactly as
    before, with the same quality gate.
    """

    missing = [level for level in LUMBAR_LEVELS if level not in vertebrae]
    if missing:
        raise ValueError(f"lumbar segmentation is missing {', '.join(missing)}")
    s1 = np.asarray(s1_superior, dtype=np.float64)
    if s1.shape != (2, 2):
        raise ValueError("S1 superior landmarks must contain two image points")
    _, circles, femoral_qc = _femoral_geometry(femoral_mask)
    l1_center = None
    if mask is not None:
        l1_y, l1_x = np.nonzero(np.asarray(mask) == int(VertebraLabel.L1))
        if len(l1_x):
            l1_center = np.asarray((l1_x.mean(), l1_y.mean()))
    output = spinopelvic_measurements_from_geometry(vertebrae, s1, circles, l1_center)
    output["qc"] = {"femoral": femoral_qc}
    return output


def spinopelvic_measurements_from_geometry(
    vertebrae: dict[str, dict[str, list[list[float]]]],
    s1_superior: list[list[float]] | np.ndarray,
    femoral_circles: list[list[float]] | np.ndarray,
    l1_center: list[float] | np.ndarray | None = None,
) -> dict[str, object]:
    """Recalculate measurements after manual landmark correction."""

    missing = [level for level in LUMBAR_LEVELS if level not in vertebrae]
    if missing:
        raise ValueError(f"vertebral geometry is missing {', '.join(missing)}")
    s1 = np.asarray(s1_superior, dtype=np.float64)
    circles = np.asarray(femoral_circles, dtype=np.float64)
    if s1.shape != (2, 2) or not np.isfinite(s1).all():
        raise ValueError("S1 superior landmarks must contain two finite image points")
    if circles.shape != (2, 3) or not np.isfinite(circles).all() or (circles[:, 2] <= 0).any():
        raise ValueError("femoral geometry must contain two finite positive-radius circles")
    endplates = {}
    for level in LUMBAR_LEVELS:
        superior = np.asarray(vertebrae[level].get("superior"), dtype=np.float64)
        if superior.shape != (2, 2) or not np.isfinite(superior).all():
            raise ValueError(f"{level} superior endplate must contain two finite image points")
        endplates[level] = superior
    hip_midpoint = circles[:, :2].mean(axis=0)
    s1_midpoint = s1.mean(axis=0)
    if l1_center is None:
        polygon = np.asarray(vertebrae["L1"].get("quadrilateral"), dtype=np.float64)
        if polygon.shape != (4, 2) or not np.isfinite(polygon).all():
            raise ValueError("L1 quadrilateral must contain four finite image points")
        l1_center_array = polygon.mean(axis=0)
    else:
        l1_center_array = np.asarray(l1_center, dtype=np.float64)
        if l1_center_array.shape != (2,) or not np.isfinite(l1_center_array).all():
            raise ValueError("L1 center must be one finite image point")
    l1_vector, s1_hip_vector = l1_center_array - hip_midpoint, s1_midpoint - hip_midpoint
    l1pa = math.degrees(
        math.atan2(
            abs(l1_vector[0] * s1_hip_vector[1] - l1_vector[1] * s1_hip_vector[0]),
            float(np.dot(l1_vector, s1_hip_vector)),
        )
    )
    s1_vector = s1[1] - s1[0]
    connection = hip_midpoint - s1_midpoint
    s1_angle = math.atan2(float(s1_vector[1]), float(s1_vector[0]))
    normal_angle = s1_angle - math.pi / 2
    connection_angle = math.atan2(float(connection[1]), float(connection[0]))
    incidence = abs(math.degrees(math.atan2(math.sin(connection_angle - normal_angle), math.cos(connection_angle - normal_angle))))
    measurements = {
        "SS": float(min(abs(math.degrees(s1_angle)), 180 - abs(math.degrees(s1_angle)))),
        "PI": float(min(incidence, 180 - incidence)),
        "PT": float(abs(math.degrees(math.atan2(float(s1_midpoint[0] - hip_midpoint[0]), float(hip_midpoint[1] - s1_midpoint[1]))))),
        "L1PA": l1pa,
        "LL": {
            f"{level}-S1": _acute_angle(endplates[level], s1)
            for level in LUMBAR_LEVELS
        },
    }
    return {
        "measurements": measurements,
        "geometry": {
            "vertebrae": vertebrae,
            "s1_superior": s1.tolist(),
            "l1_center": l1_center_array.tolist(),
            "hip_midpoint": hip_midpoint.tolist(),
            "femoral_circles": [circle.tolist() for circle in circles],
        },
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
