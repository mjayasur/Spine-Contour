import cv2
import numpy as np
import pytest

from backend.landmarks import (
    corners_from_label_map,
    label_map_from_corners,
    name_corners,
    quad_corners,
    to_contract,
)


def test_name_corners_uses_the_anterior_vector_not_image_side():
    quad = np.asarray([[10.0, 10.0], [50.0, 12.0], [48.0, 40.0], [12.0, 38.0]])
    facing_right = name_corners(quad, np.asarray([1.0, 0.0]))
    facing_left = name_corners(quad, np.asarray([-1.0, 0.0]))
    assert facing_right["SA"].tolist() == [50.0, 12.0] and facing_right["SP"].tolist() == [10.0, 10.0]
    assert facing_left["SA"].tolist() == [10.0, 10.0] and facing_left["SP"].tolist() == [50.0, 12.0]
    assert facing_right["IA"][1] > facing_right["SA"][1]          # inferior is lower


def test_quad_corners_recovers_a_wedge_and_ignores_noise():
    mask = np.zeros((200, 200), dtype=np.uint8)
    body = np.asarray([[40, 60], [150, 50], [155, 110], [45, 120]], dtype=np.int32)
    cv2.fillConvexPoly(mask, body, 1)
    mask[5, 5] = 1                                                     # a stray pixel
    corners = quad_corners(mask)
    assert corners is not None and corners.shape == (4, 2)
    for vertex in body:
        assert np.min(np.linalg.norm(corners - vertex, axis=1)) < 3.0
    assert quad_corners(np.zeros((50, 50), dtype=np.uint8)) is None


def test_label_map_round_trip_through_corners():
    values = {"L1": 1, "L2": 2}
    corners = {
        "L1": {"SA": np.asarray([120.0, 40.0]), "SP": np.asarray([40.0, 42.0]),
               "IA": np.asarray([118.0, 90.0]), "IP": np.asarray([42.0, 88.0])},
        "L2": {"SA": np.asarray([122.0, 110.0]), "SP": np.asarray([44.0, 112.0]),
               "IA": np.asarray([120.0, 160.0]), "IP": np.asarray([46.0, 158.0])},
    }
    label_map = label_map_from_corners(corners, values, (220, 220))
    assert set(np.unique(label_map)) == {0, 1, 2}
    recovered = corners_from_label_map(label_map, values, np.asarray([1.0, 0.0]))
    for level in values:
        for name, point in corners[level].items():
            assert np.linalg.norm(recovered[level][name] - point) < 2.5, (level, name)


def test_to_contract_orders_anterior_first_and_closes_the_quad():
    quad = {"SA": np.asarray([9.0, 1.0]), "SP": np.asarray([1.0, 1.0]),
            "IA": np.asarray([9.0, 5.0]), "IP": np.asarray([1.0, 5.0])}
    out = to_contract({"L3": quad})
    assert out["L3"]["superior"] == [[9.0, 1.0], [1.0, 1.0]]
    assert out["L3"]["inferior"] == [[9.0, 5.0], [1.0, 5.0]]
    assert out["L3"]["quadrilateral"] == [[9.0, 1.0], [1.0, 1.0], [1.0, 5.0], [9.0, 5.0]]
