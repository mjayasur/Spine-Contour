"""HRNet landmark head: L1-L5 corners and the S1 endplate as heatmaps.

An alternative source for the vertebral corners. The U-Net path reads a body's
corners off its mask, which cannot place a corner where the mask has no pixels;
this head regresses each corner directly, so it recovers a body the mask missed
and never leaves a level out -- and, for the same reason, it has no "missing
level" to report when it is wrong. The two are offered as a choice rather than
one replacing the other.
"""

from __future__ import annotations

import timm
import torch
import torch.nn as nn
import torch.nn.functional as F

LANDMARK_LEVELS = ("L1", "L2", "L3", "L4", "L5", "S1")
CORNERS = ("SA", "SP", "IA", "IP")
# Heatmap slot order, fixed by training: four corners per lumbar body, then the
# two S1 endplate points. The checkpoint carries the same list under "landmarks".
LANDMARKS = tuple((level, corner) for level in LANDMARK_LEVELS[:5] for corner in CORNERS) \
    + (("S1", "SA"), ("S1", "SP"))
N_LANDMARKS = len(LANDMARKS)


class HRNetLandmarks(nn.Module):
    """HRNet trunk with a stride-4 multi-branch fusion head."""

    def __init__(self, backbone: str = "hrnet_w32", n_landmarks: int = N_LANDMARKS,
                 pretrained: bool = False, head_channels: int = 256, proj: int = 64):
        super().__init__()
        self.trunk = timm.create_model(backbone, pretrained=pretrained, features_only=True,
                                       in_chans=1)
        channels = self.trunk.feature_info.channels()
        self.project = nn.ModuleList(nn.Conv2d(c, proj, 1, bias=False) for c in channels)
        self.head = nn.Sequential(
            nn.Conv2d(proj * len(channels), head_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(head_channels), nn.ReLU(inplace=True),
            nn.Conv2d(head_channels, n_landmarks, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.trunk(x)
        target = features[1].shape[-2:]                       # stride 4
        fused = torch.cat(
            [F.interpolate(p(f), size=target, mode="bilinear", align_corners=False)
             for p, f in zip(self.project, features)], dim=1)
        return self.head(fused)


def build_hrnet_model(checkpoint: dict[str, object]) -> nn.Module:
    """Build the landmark head the checkpoint was trained as."""
    model = HRNetLandmarks(str(checkpoint.get("backbone", "hrnet_w32")), pretrained=False)
    model.load_state_dict(checkpoint["model"], strict=True)
    return model


def decode_heatmaps(heat: torch.Tensor, stride: int, window: int = 3) -> torch.Tensor:
    """Sub-pixel decode: soft-argmax over a window around each peak.

    Plain argmax quantises to the heatmap grid, which at stride 4 is 4 input
    pixels and would dominate the error budget. Returns (batch, landmarks, 2)
    as x, y in model-frame pixels.
    """
    b, k, h, w = heat.shape
    flat = heat.flatten(2)
    idx = flat.argmax(dim=2)
    py, px = (idx // w).float(), (idx % w).float()

    offsets = torch.arange(-window, window + 1, device=heat.device, dtype=torch.float32)
    dy, dx = torch.meshgrid(offsets, offsets, indexing="ij")
    ys = (py.view(b, k, 1, 1) + dy).clamp(0, h - 1)
    xs = (px.view(b, k, 1, 1) + dx).clamp(0, w - 1)
    gather = (ys.long() * w + xs.long()).flatten(2)
    weights = flat.gather(2, gather).clamp_min(0)
    total = weights.sum(dim=2, keepdim=True).clamp_min(1e-6)
    weights = weights / total
    cy = (ys.flatten(2) * weights).sum(dim=2)
    cx = (xs.flatten(2) * weights).sum(dim=2)
    # Exact inverse of the training target, which places the peak at
    # point/stride with no half-pixel offset. Adding one would bias every
    # landmark by 1.5 px.
    return torch.stack([cx, cy], dim=2) * stride
