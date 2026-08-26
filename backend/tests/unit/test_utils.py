import cv2
import numpy as np
import pytest

from backend.models import VertebraLabel
from backend.utils import lumbar_lordosis, spinopelvic_measurements, vertebral_quadrilaterals


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
