import torch

from backend.models import (
    FEMORAL_WEIGHTS_PATH,
    JOINT_WEIGHTS_PATH,
    WEIGHTS_PATH,
    JointLandmarkUNet,
    UNet2D,
)


def test_buu_checkpoint_loads_and_runs_with_the_bundled_architecture():
    checkpoint = torch.load(WEIGHTS_PATH, map_location="cpu", weights_only=True)
    model = UNet2D(int(checkpoint["config"]["base_channels"]))
    model.load_state_dict(checkpoint["model"], strict=True)
    model.eval()

    with torch.inference_mode():
        output = model(torch.zeros((1, 1, 32, 32), dtype=torch.float32))
    assert output.shape == (1, 1, 32, 32)


def test_joint_spine_landmark_checkpoint_loads_and_runs():
    checkpoint = torch.load(JOINT_WEIGHTS_PATH, map_location="cpu", weights_only=True)
    model = JointLandmarkUNet(int(checkpoint["config"].get("base_channels", 32)))
    model.load_state_dict(checkpoint["model"], strict=True)
    model.eval()

    with torch.inference_mode():
        segmentation, landmarks = model(torch.zeros((1, 2, 32, 32), dtype=torch.float32))
    assert segmentation.shape == (1, 1, 32, 32)
    assert landmarks.shape == (1, 22, 32, 32)


def test_femoral_checkpoint_loads_and_runs():
    checkpoint = torch.load(FEMORAL_WEIGHTS_PATH, map_location="cpu", weights_only=True)
    model = UNet2D(int(checkpoint["config"]["base_channels"]), in_channels=2)
    model.load_state_dict(checkpoint["model"], strict=True)
    model.eval()

    with torch.inference_mode():
        output = model(torch.zeros((1, 2, 32, 32), dtype=torch.float32))
    assert output.shape == (1, 1, 32, 32)
