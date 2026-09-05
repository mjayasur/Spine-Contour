import numpy as np
import pytest
import torch

from backend.models.hrnet import LANDMARKS, N_LANDMARKS, decode_heatmaps


def test_landmark_slots_are_four_corners_per_lumbar_body_then_the_s1_pair():
    assert N_LANDMARKS == 22
    assert LANDMARKS[:4] == (("L1", "SA"), ("L1", "SP"), ("L1", "IA"), ("L1", "IP"))
    assert LANDMARKS[-2:] == (("S1", "SA"), ("S1", "SP"))


def test_decode_heatmaps_is_sub_pixel_and_scales_by_stride():
    stride, size = 4, 48
    heat = torch.zeros((1, 2, size, size))
    yy, xx = torch.meshgrid(torch.arange(size), torch.arange(size), indexing="ij")
    for slot, (cx, cy) in enumerate(((10.3, 20.6), (30.0, 5.0))):
        heat[0, slot] = torch.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * 1.5 ** 2))
    points = decode_heatmaps(heat, stride)[0].numpy()
    assert points[0] == pytest.approx([10.3 * stride, 20.6 * stride], abs=0.4)
    assert points[1] == pytest.approx([30.0 * stride, 5.0 * stride], abs=1e-3)
