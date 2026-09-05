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
    assert result["measurements"]["SS"] == pytest.approx(np.degrees(np.arctan(25 / 150)), abs=0.1)
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

    assert geometry["measurements"]["SS"] == pytest.approx(np.degrees(np.arctan(20 / 120)))
    assert geometry["measurements"]["LL"]["L1-S1"] == pytest.approx(
        geometry["measurements"]["SS"]
    )
    assert geometry["geometry"]["l1_center"] == pytest.approx([100, 30])
    assert geometry["geometry"]["hip_midpoint"] == pytest.approx([100, 260])


def test_model_s1_identity_orients_right_facing_vertebral_corners():
    mask = np.zeros((320, 320), dtype=np.uint8)
    for index, label in enumerate(range(int(VertebraLabel.L1), int(VertebraLabel.L5) + 1)):
        cv2.rectangle(mask, (70, 20 + 42 * index), (230, 45 + 42 * index), label, -1)
    femoral = np.zeros_like(mask)
    cv2.circle(femoral, (125, 290), 16, 1, -1)
    cv2.circle(femoral, (175, 290), 16, 1, -1)
    s1_sa_sp = [[225, 225], [75, 250]]

    result = spinopelvic_measurements(mask, s1_sa_sp, femoral)

    assert result["geometry"]["s1_superior"] == s1_sa_sp
    assert result["geometry"]["vertebrae"]["L1"]["superior"][0][0] > result["geometry"]["vertebrae"]["L1"]["superior"][1][0]


def _two_heads(first, second):
    mask = np.zeros((256, 256), dtype=np.uint8)
    for cx, cy, r in (first, second):
        cv2.circle(mask, (cx, cy), r, 1, -1)
    return mask


def _matched(circles, truth):
    a, b = np.asarray(circles), np.asarray(truth, dtype=float)
    direct = abs(a[0] - b[0]).max() + abs(a[1] - b[1]).max()
    swapped = abs(a[0] - b[1]).max() + abs(a[1] - b[0]).max()
    return min(direct, swapped)


def test_merged_femoral_heads_are_fitted_as_two_discs():
    mask = _two_heads((110, 200, 28), (140, 200, 28))

    midpoint, circles, qc = _femoral_geometry(mask)

    assert midpoint == pytest.approx([125, 200], abs=1)
    assert _matched(circles, [(110, 200, 28), (140, 200, 28)]) < 2.0
    assert qc["method"].startswith("two_disc_")
    assert qc["circle_union_iou"] > 0.97
    assert qc["qc_pass"] is True


def test_heavily_overlapping_heads_still_come_apart():
    # Centres half a radius apart: a Hough transform sees one circle here.
    mask = _two_heads((120, 180, 40), (140, 180, 40))

    midpoint, circles, qc = _femoral_geometry(mask)

    assert midpoint == pytest.approx([130, 180], abs=1.5)
    assert _matched(circles, [(120, 180, 40), (140, 180, 40)]) < 3.0
    assert qc["qc_pass"] is True


def test_unequal_heads_keep_their_own_radii():
    mask = _two_heads((100, 170, 44), (150, 195, 32))

    _, circles, qc = _femoral_geometry(mask)

    assert _matched(circles, [(100, 170, 44), (150, 195, 32)]) < 3.0
    assert qc["confidence"] >= 0.45


def test_superimposed_heads_are_reported_coincident_not_rejected():
    mask = _two_heads((128, 190, 36), (128, 190, 36))

    midpoint, circles, qc = _femoral_geometry(mask)

    assert midpoint == pytest.approx([128, 190], abs=1.5)
    assert qc["center_separation_pixels"] < 3.0
    assert qc["qc_pass"] is True


def test_a_head_the_frame_cut_off_is_not_invented():
    # Only a sliver of the second head is inside the frame; the fit collapses
    # onto the visible one instead of placing a second circle by guesswork.
    mask = _two_heads((128, 150, 40), (128, 240, 40))[:190]

    midpoint, circles, qc = _femoral_geometry(mask)

    # Whichever seeding wins, the answer is the visible head twice over: two
    # near-identical circles on it, and a hip axis at its centre.
    circles = np.asarray(circles)
    assert circles[:, 2].max() / circles[:, 2].min() < 1.2
    assert qc["center_separation_pixels"] < 0.35 * circles[:, 2].mean()
    assert midpoint == pytest.approx([128, 150], abs=4)
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


def test_a_merged_blob_that_is_not_two_discs_is_rejected():
    mask = np.zeros((256, 256), dtype=np.uint8)
    cv2.rectangle(mask, (40, 120), (220, 175), 1, -1)

    with pytest.raises(ValueError, match="circle_union_iou"):
        _femoral_geometry(mask)


def test_heads_on_a_tall_film_are_worked_at_the_same_size_as_on_a_lumbar_one():
    # The same two heads, once in a lumbar-sized frame and once dropped into a
    # film three times taller. Downsizing by the film alone would shrink the
    # second pair under the radius floor; the answer must be the same either way.
    small = _two_heads((120, 180, 30), (145, 180, 30))
    midpoint_small, circles_small, qc_small = _femoral_geometry(small)
    tall = np.zeros((2400, 800), dtype=np.uint8)
    tall[1900:2156, 300:556] = small
    midpoint_tall, circles_tall, qc_tall = _femoral_geometry(tall)

    assert qc_tall["qc_pass"] and qc_small["qc_pass"]
    assert midpoint_tall == pytest.approx(np.asarray(midpoint_small) + [300, 1900], abs=1.5)
    assert sorted(c[2] for c in circles_tall) == pytest.approx(sorted(c[2] for c in circles_small), abs=1.5)


def test_a_stray_speck_beside_merged_heads_is_not_taken_for_the_second_head():
    mask = _two_heads((120, 180, 30), (145, 180, 30))
    cv2.circle(mask, (200, 230), 6, 1, -1)                       # a stray blob, well under a head

    midpoint, circles, qc = _femoral_geometry(mask)

    assert qc["method"].startswith("two_disc_")
    assert midpoint == pytest.approx([132.5, 180], abs=1.5)
    assert min(c[2] for c in circles) > 25
