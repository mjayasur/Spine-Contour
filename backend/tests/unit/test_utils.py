import numpy as np
import pytest

from backend.models import VertebraLabel
from backend.utils import lumbar_lordosis


def _sloped_body(mask, label, x_start, x_stop, top_intercept, slope, height):
    for x in range(x_start, x_stop):
        top = int(round(top_intercept + slope * x))
        mask[top : top + height, x] = int(label)


def test_lumbar_lordosis_uses_l1_and_s1_superior_endplates():
    mask = np.zeros((180, 180), dtype=np.uint8)
    _sloped_body(mask, VertebraLabel.L1, 30, 150, 22, 0.20, 18)
    _sloped_body(mask, VertebraLabel.S1, 30, 150, 130, -0.50, 22)

    expected = abs(np.degrees(np.arctan(0.20)) - np.degrees(np.arctan(-0.50)))
    assert lumbar_lordosis(mask) == pytest.approx(expected, abs=0.5)


def test_lumbar_lordosis_falls_back_to_l5_inferior_endplate():
    mask = np.zeros((180, 180), dtype=np.uint8)
    _sloped_body(mask, VertebraLabel.L1, 30, 150, 22, 0.10, 18)
    _sloped_body(mask, VertebraLabel.L5, 30, 150, 115, -0.35, 20)

    expected = abs(np.degrees(np.arctan(0.10)) - np.degrees(np.arctan(-0.35)))
    assert lumbar_lordosis(mask) == pytest.approx(expected, abs=0.5)


def test_lumbar_lordosis_requires_l1():
    with pytest.raises(ValueError, match="L1"):
        lumbar_lordosis(np.zeros((50, 50), dtype=np.uint8))
