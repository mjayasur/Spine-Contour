"""Measurements derived from common-label vertebral segmentation masks."""

from __future__ import annotations

import numpy as np

try:
    from .models import VertebraLabel
except ImportError:  # Support running modules directly from backend/.
    from models import VertebraLabel


def _endplate_angle(level_mask: np.ndarray, superior: bool) -> float:
    y_coordinates, x_coordinates = np.nonzero(level_mask)
    unique_x = np.unique(x_coordinates)
    if unique_x.size < 5:
        raise ValueError("A vertebral body needs at least five populated columns")

    edge_y = np.asarray(
        [
            y_coordinates[x_coordinates == x].min()
            if superior
            else y_coordinates[x_coordinates == x].max()
            for x in unique_x
        ],
        dtype=np.float64,
    )
    edge_x = unique_x.astype(np.float64)

    # Remove the outer tenth where the body sidewalls can dominate the fit.
    lower, upper = np.quantile(edge_x, (0.1, 0.9))
    keep = (edge_x >= lower) & (edge_x <= upper)
    edge_x, edge_y = edge_x[keep], edge_y[keep]

    for _ in range(3):
        design = np.column_stack((edge_x, np.ones(edge_x.size)))
        slope, intercept = np.linalg.lstsq(design, edge_y, rcond=None)[0]
        residual = edge_y - (slope * edge_x + intercept)
        median_absolute_deviation = np.median(np.abs(residual - np.median(residual)))
        tolerance = max(1.0, 3.0 * 1.4826 * median_absolute_deviation)
        inliers = np.abs(residual) <= tolerance
        if inliers.all() or inliers.sum() < 5:
            break
        edge_x, edge_y = edge_x[inliers], edge_y[inliers]

    slope = float(np.linalg.lstsq(
        np.column_stack((edge_x, np.ones(edge_x.size))), edge_y, rcond=None
    )[0][0])
    return float(np.degrees(np.arctan(slope)))


def lumbar_lordosis(mask: np.ndarray) -> float:
    """Return the lumbar Cobb angle in degrees from a common-label mask.

    The angle is measured between the L1 superior endplate and the S1 superior
    endplate when S1 is present. Because the bundled model currently predicts
    only L1-L5, the L5 inferior endplate is used as the fallback endpoint.
    """

    labels = np.asarray(mask)
    if labels.ndim != 2:
        raise ValueError("mask must be a two-dimensional common-label array")
    if not np.issubdtype(labels.dtype, np.integer):
        raise ValueError("mask must contain integer labels")

    l1 = labels == int(VertebraLabel.L1)
    if not l1.any():
        raise ValueError("mask does not contain L1")

    s1 = labels == int(VertebraLabel.S1)
    if s1.any():
        endpoint = s1
        endpoint_is_superior = True
    else:
        endpoint = labels == int(VertebraLabel.L5)
        endpoint_is_superior = False
        if not endpoint.any():
            raise ValueError("mask must contain S1 or L5")

    first_angle = _endplate_angle(l1, superior=True)
    second_angle = _endplate_angle(endpoint, superior=endpoint_is_superior)
    difference = abs((first_angle - second_angle + 90.0) % 180.0 - 90.0)
    return float(difference)
