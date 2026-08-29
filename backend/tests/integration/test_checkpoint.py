import pytest
import torch

from backend.models import (
    FEMORAL_WEIGHTS_PATH,
    S1_WEIGHTS_PATH,
    VERTEBRA_WEIGHTS_PATH,
    build_s1_model,
    build_unet,
)


def test_authoritative_vertebra_checkpoint_loads_and_runs():
    checkpoint = torch.load(VERTEBRA_WEIGHTS_PATH, map_location="cpu", weights_only=True)
    model = build_unet(checkpoint, 6)
    model.load_state_dict(checkpoint["model"], strict=True)
    model.eval()

    with torch.inference_mode():
        output = model(torch.zeros((1, 1, 64, 64), dtype=torch.float32))
    assert output.shape == (1, 6, 64, 64)
    assert checkpoint["epoch"] == 53
    assert checkpoint["val_dice"] == pytest.approx(0.9353553)


def test_authoritative_femoral_checkpoint_loads_and_runs():
    checkpoint = torch.load(FEMORAL_WEIGHTS_PATH, map_location="cpu", weights_only=True)
    model = build_unet(checkpoint, 1)
    model.load_state_dict(checkpoint["model"], strict=True)
    model.eval()

    with torch.inference_mode():
        output = model(torch.zeros((1, 1, 64, 64), dtype=torch.float32))
    assert output.shape == (1, 1, 64, 64)
    assert checkpoint["epoch"] == 275
    assert checkpoint["val_dice"] == pytest.approx(0.9298734)


def test_authoritative_s1_checkpoint_loads_with_two_keypoints():
    checkpoint = torch.load(S1_WEIGHTS_PATH, map_location="cpu", weights_only=True)
    model = build_s1_model(int(checkpoint["size"]))
    model.load_state_dict(checkpoint["model"], strict=True)

    assert model.roi_heads.keypoint_predictor.kps_score_lowres.out_channels == 2
    assert checkpoint["size"] == 768
    assert checkpoint["epoch"] == 27
    assert checkpoint["metrics"]["mean_px"] == pytest.approx(4.2064867)
