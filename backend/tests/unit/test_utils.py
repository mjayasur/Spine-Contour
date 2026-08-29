import cv2
import numpy as np
import pytest

from backend.models import VertebraLabel
from backend.utils import (
    _femoral_geometry,
    lumbar_lordosis,
    spinopelvic_measurements,
    spinopelvic_measurements_from_geometry,
    vertebral_quadrilaterals,
)


def _sloped_body(mask, label, x_start, x_stop, top_intercept, slope, height):
    for x in range(x_start, x_stop):
        top = int(round(top_intercept + slope * x))
        mask[top : top + height, x] = int(label)


def test_lumbar_lordosis_uses_l1_and_s1_superior_endplates():
    mask = np.zeros((180, 180), dtype=np.uint8)
    _sloped_body(mask, VertebraLabel.L1, 30, 150, 22, 0.20, 18)
    _sloped_body(mask, VertebraLabel.S1, 30, 150, 130, -0.50, 22)

    expected = abs(np.degrees(np.arctan(0.20)) - np.degrees(np.arctan(-0.50)))
    assert lumbar_lordosis(mask) == pytest.approx(expected, abs=1.5)


def test_lumbar_lordosis_falls_back_to_l5_inferior_endplate():
    mask = np.zeros((180, 180), dtype=np.uint8)
    _sloped_body(mask, VertebraLabel.L1, 30, 150, 22, 0.10, 18)
    _sloped_body(mask, VertebraLabel.L5, 30, 150, 115, -0.35, 20)

    expected = abs(np.degrees(np.arctan(0.10)) - np.degrees(np.arctan(-0.35)))
    assert lumbar_lordosis(mask) == pytest.approx(expected, abs=0.5)


def test_lumbar_lordosis_requires_l1():
    with pytest.raises(ValueError, match="L1"):
        lumbar_lordosis(np.zeros((50, 50), dtype=np.uint8))


def test_quadrilaterals_and_all_spinopelvic_measurements():
    mask = np.zeros((320, 320), dtype=np.uint8)
    for index, label in enumerate(range(int(VertebraLabel.L1), int(VertebraLabel.L5) + 1)):
        top = 22 + 42 * index
        polygon = np.asarray(((70, top), (230, top + 3 * index), (226, top + 27 + 3 * index), (74, top + 25)), dtype=np.int32)
        cv2.fillConvexPoly(mask, polygon, label)
    femoral = np.zeros_like(mask)
    cv2.circle(femoral, (125, 290), 16, 1, -1)
    cv2.circle(femoral, (175, 290), 16, 1, -1)
    s1 = np.asarray(((75, 250), (225, 225)), dtype=np.float64)

    quadrilaterals = vertebral_quadrilaterals(mask)
    result = spinopelvic_measurements(mask, s1, femoral)

    assert set(quadrilaterals) == {"L1", "L2", "L3", "L4", "L5"}
    assert all(len(body["quadrilateral"]) == 4 for body in quadrilaterals.values())
    assert set(result["measurements"]["LL"]) == {"L1-S1", "L2-S1", "L3-S1", "L4-S1", "L5-S1"}
    assert result["measurements"]["SI"] == pytest.approx(np.degrees(np.arctan(25 / 150)), abs=0.1)
    assert result["geometry"]["hip_midpoint"] == pytest.approx([150, 290], abs=1.0)
    l1_y, l1_x = np.nonzero(mask == int(VertebraLabel.L1))
    l1_center = np.asarray((l1_x.mean(), l1_y.mean()))
    hip = np.asarray(result["geometry"]["hip_midpoint"])
    u, v = l1_center - hip, s1.mean(axis=0) - hip
    expected_l1pa = np.degrees(np.arctan2(abs(u[0] * v[1] - u[1] * v[0]), np.dot(u, v)))
    assert result["measurements"]["L1PA"] == pytest.approx(expected_l1pa)
    assert result["geometry"]["l1_center"] == pytest.approx(l1_center)


def test_corrected_geometry_recalculates_measurements():
    vertebrae = {
        level: {
            "quadrilateral": [[40, top], [160, top], [160, top + 20], [40, top + 20]],
            "superior": [[40, top], [160, top]],
            "inferior": [[40, top + 20], [160, top + 20]],
        }
        for level, top in zip(("L1", "L2", "L3", "L4", "L5"), (20, 55, 90, 125, 160))
    }
    geometry = spinopelvic_measurements_from_geometry(
        vertebrae,
        [[40, 220], [160, 200]],
        [[75, 260, 25], [125, 260, 25]],
    )

    assert geometry["measurements"]["SI"] == pytest.approx(np.degrees(np.arctan(20 / 120)))
    assert geometry["measurements"]["LL"]["L1-S1"] == pytest.approx(
        geometry["measurements"]["SI"]
    )
    assert geometry["geometry"]["l1_center"] == pytest.approx([100, 30])
    assert geometry["geometry"]["hip_midpoint"] == pytest.approx([100, 260])


def test_merged_femoral_heads_use_the_best_hough_circle_union():
    mask = np.zeros((256, 256), dtype=np.uint8)
    cv2.circle(mask, (110, 200), 28, 1, -1)
    cv2.circle(mask, (140, 200), 28, 1, -1)

    midpoint, circles, qc = _femoral_geometry(mask)

    assert midpoint == pytest.approx([125, 200], abs=2)
    assert len(circles) == 2
    assert qc["method"] == "connected_union_hough_pair"
    assert qc["circle_union_iou"] > 0.9
    assert qc["qc_pass"] is True


def test_circle_fit_ignores_cropped_detector_border_segments():
    mask = np.zeros((256, 256), dtype=np.uint8)
    cv2.circle(mask, (60, 245), 30, 1, -1)
    cv2.circle(mask, (160, 245), 30, 1, -1)

    midpoint, circles, qc = _femoral_geometry(mask)

    assert midpoint == pytest.approx([110, 245], abs=2)
    assert [circle[2] for circle in circles] == pytest.approx([30, 30], abs=2)
    assert qc["method"] == "two_component_robust_circle_fit"
    assert qc["confidence"] >= 0.45


def test_questionable_femoral_geometry_is_rejected():
    mask = np.zeros((256, 256), dtype=np.uint8)
    cv2.rectangle(mask, (20, 180), (90, 200), 1, -1)
    cv2.rectangle(mask, (150, 180), (220, 200), 1, -1)

    with pytest.raises(ValueError, match="geometry rejected"):
        _femoral_geometry(mask)
