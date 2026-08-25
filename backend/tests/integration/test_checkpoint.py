import torch

from backend.models import UNet2D, WEIGHTS_PATH


def test_buu_checkpoint_loads_and_runs_with_the_bundled_architecture():
    checkpoint = torch.load(WEIGHTS_PATH, map_location="cpu", weights_only=True)
    model = UNet2D(int(checkpoint["config"]["base_channels"]))
    model.load_state_dict(checkpoint["model"], strict=True)
    model.eval()

    with torch.inference_mode():
        output = model(torch.zeros((1, 1, 32, 32), dtype=torch.float32))
    assert output.shape == (1, 1, 32, 32)
