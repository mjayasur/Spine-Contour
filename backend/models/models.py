"""Inference models and the shared vertebral-label convention."""

from __future__ import annotations

import copy
from collections import deque
from dataclasses import dataclass
from enum import IntEnum
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image


class VertebraLabel(IntEnum):
    BACKGROUND = 0
    C1 = 1
    C2 = 2
    C3 = 3
    C4 = 4
    C5 = 5
    C6 = 6
    C7 = 7
    T1 = 8
    T2 = 9
    T3 = 10
    T4 = 11
    T5 = 12
    T6 = 13
    T7 = 14
    T8 = 15
    T9 = 16
    T10 = 17
    T11 = 18
    T12 = 19
    L1 = 20
    L2 = 21
    L3 = 22
    L4 = 23
    L5 = 24
    S1 = 25
    S2 = 26
    S3 = 27
    S4 = 28
    S5 = 29
    T13 = 30
    L6 = 31


VERTEBRA_LABELS = {label.name: int(label) for label in VertebraLabel}
MODEL_IMAGE_SIZE = 512
MODEL_THRESHOLD = 0.5
WEIGHTS_DIRECTORY = Path(__file__).resolve().parent.parent / "weights"
WEIGHTS_PATH = WEIGHTS_DIRECTORY / "best_unet2d.pt"
JOINT_WEIGHTS_PATH = WEIGHTS_DIRECTORY / "best_joint_spine_landmark_unet.pt"
FEMORAL_WEIGHTS_PATH = WEIGHTS_DIRECTORY / "best_femoral_unet.pt"
SUPPORTED_INPUT = ("xray", "lumbar", "lateral")
LUMBAR_LEVELS = ("L1", "L2", "L3", "L4", "L5")
LANDMARK_COUNT = 22
FLIP_PERMUTATION = tuple(
    value for pair in ((index + 1, index) for index in range(0, LANDMARK_COUNT, 2)) for value in pair
)


class DoubleConv(nn.Module):
    def __init__(self, in_channels: int, out_channels: int):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
            nn.GroupNorm(min(8, out_channels), out_channels),
            nn.SiLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, 3, padding=1, bias=False),
            nn.GroupNorm(min(8, out_channels), out_channels),
            nn.SiLU(inplace=True),
        )

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        return self.block(value)


class UNet2D(nn.Module):
    def __init__(self, base_channels: int = 32, in_channels: int = 1):
        super().__init__()
        channels = [base_channels * (2**index) for index in range(5)]
        self.enc1 = DoubleConv(in_channels, channels[0])
        self.enc2 = DoubleConv(channels[0], channels[1])
        self.enc3 = DoubleConv(channels[1], channels[2])
        self.enc4 = DoubleConv(channels[2], channels[3])
        self.bottleneck = DoubleConv(channels[3], channels[4])
        self.pool = nn.MaxPool2d(2)
        self.up4 = nn.ConvTranspose2d(channels[4], channels[3], 2, stride=2)
        self.dec4 = DoubleConv(channels[3] * 2, channels[3])
        self.up3 = nn.ConvTranspose2d(channels[3], channels[2], 2, stride=2)
        self.dec3 = DoubleConv(channels[2] * 2, channels[2])
        self.up2 = nn.ConvTranspose2d(channels[2], channels[1], 2, stride=2)
        self.dec2 = DoubleConv(channels[1] * 2, channels[1])
        self.up1 = nn.ConvTranspose2d(channels[1], channels[0], 2, stride=2)
        self.dec1 = DoubleConv(channels[0] * 2, channels[0])
        self.head = nn.Conv2d(channels[0], 1, 1)

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        enc1 = self.enc1(value)
        enc2 = self.enc2(self.pool(enc1))
        enc3 = self.enc3(self.pool(enc2))
        enc4 = self.enc4(self.pool(enc3))
        bottleneck = self.bottleneck(self.pool(enc4))
        dec4 = self.dec4(torch.cat((self.up4(bottleneck), enc4), dim=1))
        dec3 = self.dec3(torch.cat((self.up3(dec4), enc3), dim=1))
        dec2 = self.dec2(torch.cat((self.up2(dec3), enc2), dim=1))
        dec1 = self.dec1(torch.cat((self.up1(dec2), enc1), dim=1))
        return self.head(dec1)


class JointLandmarkUNet(nn.Module):
    def __init__(self, base_channels: int = 32):
        super().__init__()
        self.backbone = UNet2D(base_channels, in_channels=2)
        for name in ("up4", "dec4", "up3", "dec3", "up2", "dec2", "up1", "dec1"):
            setattr(self, f"landmark_{name}", copy.deepcopy(getattr(self.backbone, name)))
        self.landmark_tower = copy.deepcopy(DoubleConv(base_channels, base_channels).block)
        self.landmark_head = nn.Conv2d(base_channels, LANDMARK_COUNT, 1)

    def forward(self, value: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        net = self.backbone
        e1 = net.enc1(value)
        e2 = net.enc2(net.pool(e1))
        e3 = net.enc3(net.pool(e2))
        e4 = net.enc4(net.pool(e3))
        bottleneck = net.bottleneck(net.pool(e4))
        d4 = net.dec4(torch.cat((net.up4(bottleneck), e4), dim=1))
        d3 = net.dec3(torch.cat((net.up3(d4), e3), dim=1))
        d2 = net.dec2(torch.cat((net.up2(d3), e2), dim=1))
        d1 = net.dec1(torch.cat((net.up1(d2), e1), dim=1))
        landmark_d4 = self.landmark_dec4(torch.cat((self.landmark_up4(bottleneck), e4), dim=1))
        landmark_d3 = self.landmark_dec3(torch.cat((self.landmark_up3(landmark_d4), e3), dim=1))
        landmark_d2 = self.landmark_dec2(torch.cat((self.landmark_up2(landmark_d3), e2), dim=1))
        landmark_d1 = self.landmark_dec1(torch.cat((self.landmark_up1(landmark_d2), e1), dim=1))
        features = landmark_d1 + 0.1 * self.landmark_tower(landmark_d1)
        return net.head(d1), self.landmark_head(features)


@dataclass(frozen=True)
class LetterboxTransform:
    original_height: int
    original_width: int
    resized_height: int
    resized_width: int
    top: int
    left: int


def _validate_supported_input(
    modality: str, body_part: str, view: str | None, laterality: str | None
) -> None:
    normalize = lambda value: (value or "").strip().lower().replace("-", "").replace("_", "")
    normalized_view, normalized_laterality = normalize(view), normalize(laterality)
    if normalized_view and normalized_laterality and normalized_view != normalized_laterality:
        raise ValueError("view and laterality must agree when both are provided")
    if (normalize(modality), normalize(body_part), normalized_view or normalized_laterality) != SUPPORTED_INPUT:
        raise ValueError(
            "Unsupported model selection. The only available combination is "
            "modality='xray', body_part='lumbar', view='lateral'."
        )


def _robust_rescale(pixel_array: np.ndarray) -> np.ndarray:
    array = np.asarray(pixel_array)
    if array.ndim != 2 or not np.issubdtype(array.dtype, np.number) or array.size == 0:
        raise ValueError("pixel_array must be a non-empty two-dimensional numeric grayscale array")
    values = array.astype(np.float32, copy=True)
    finite = np.isfinite(values)
    if not finite.any():
        return np.zeros(values.shape, dtype=np.uint8)
    values[~finite] = float(np.median(values[finite]))
    foreground = values[values > 0]
    low, high = np.percentile(foreground if foreground.size >= 100 else values, (0.5, 99.5))
    if high <= low + 1e-6:
        return np.zeros(values.shape, dtype=np.uint8)
    return np.clip((values - low) * (255.0 / (high - low)), 0, 255).astype(np.uint8)


def _letterbox(image: np.ndarray) -> tuple[np.ndarray, LetterboxTransform]:
    height, width = image.shape
    scale = min(MODEL_IMAGE_SIZE / height, MODEL_IMAGE_SIZE / width)
    resized_height, resized_width = max(1, round(height * scale)), max(1, round(width * scale))
    resized = np.asarray(
        Image.fromarray(image).resize((resized_width, resized_height), Image.Resampling.LANCZOS)
    )
    output = np.zeros((MODEL_IMAGE_SIZE, MODEL_IMAGE_SIZE), dtype=np.uint8)
    top, left = (MODEL_IMAGE_SIZE - resized_height) // 2, (MODEL_IMAGE_SIZE - resized_width) // 2
    output[top : top + resized_height, left : left + resized_width] = resized
    return output, LetterboxTransform(height, width, resized_height, resized_width, top, left)


def _default_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


@lru_cache(maxsize=4)
def _load_model(kind: str, device: str) -> nn.Module:
    path = JOINT_WEIGHTS_PATH if kind == "joint" else FEMORAL_WEIGHTS_PATH
    if not path.is_file():
        raise FileNotFoundError(f"Missing model weights: {path}")
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    base_channels = int(checkpoint.get("config", {}).get("base_channels", 32))
    model = JointLandmarkUNet(base_channels) if kind == "joint" else UNet2D(base_channels, 2)
    model.load_state_dict(checkpoint["model"], strict=True)
    return model.to(torch.device(device)).eval()


def _model_input(image: np.ndarray, device: str) -> torch.Tensor:
    grayscale = torch.from_numpy(image[None, None]).float().div_(255.0)
    kernel_x = grayscale.new_tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]).view(1, 1, 3, 3)
    kernel_y = grayscale.new_tensor([[-1, -2, -1], [0, 0, 0], [1, 2, 1]]).view(1, 1, 3, 3)
    magnitude = torch.sqrt(
        F.conv2d(grayscale, kernel_x, padding=1).square()
        + F.conv2d(grayscale, kernel_y, padding=1).square()
        + 1e-6
    )
    scale = magnitude.flatten(1).quantile(0.95, dim=1).view(1, 1, 1, 1).clamp_min(1e-3)
    edge = torch.clamp(magnitude / scale, 0, 1)
    return torch.cat(((grayscale - 0.5) / 0.25, (edge - 0.25) / 0.25), dim=1).to(device)


def _label_lumbar_components(binary_mask: np.ndarray) -> np.ndarray:
    binary = np.asarray(binary_mask, dtype=bool)
    remaining, components = binary.copy(), []
    height, width = binary.shape
    for start_y, start_x in np.argwhere(remaining):
        if not remaining[start_y, start_x]:
            continue
        queue, pixels = deque([(int(start_y), int(start_x))]), []
        remaining[start_y, start_x] = False
        while queue:
            y, x = queue.pop()
            pixels.append((y, x))
            for neighbor_y, neighbor_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= neighbor_y < height and 0 <= neighbor_x < width and remaining[neighbor_y, neighbor_x]:
                    remaining[neighbor_y, neighbor_x] = False
                    queue.append((neighbor_y, neighbor_x))
        if len(pixels) >= max(16, round(binary.size * 0.0002)):
            components.append(np.asarray(pixels, dtype=np.int32))
    components = sorted(sorted(components, key=len, reverse=True)[:5], key=lambda item: item[:, 0].mean())
    labeled = np.zeros(binary.shape, dtype=np.uint8)
    for label, component in zip(range(int(VertebraLabel.L1), int(VertebraLabel.L5) + 1), components):
        labeled[component[:, 0], component[:, 1]] = label
    return labeled


def _restore(array: np.ndarray, transform: LetterboxTransform) -> np.ndarray:
    crop = array[
        transform.top : transform.top + transform.resized_height,
        transform.left : transform.left + transform.resized_width,
    ]
    return np.asarray(
        Image.fromarray(crop.astype(np.uint8)).resize(
            (transform.original_width, transform.original_height), Image.Resampling.NEAREST
        )
    )


def _landmark_points(direct: torch.Tensor, mirrored: torch.Tensor, transform: LetterboxTransform) -> np.ndarray:
    direct = F.avg_pool2d(direct, 4, stride=4)
    mirrored = torch.flip(F.avg_pool2d(mirrored, 4, stride=4), dims=(-1,))[
        :, list(FLIP_PERMUTATION)
    ]
    probability = 0.5 * (
        torch.softmax(direct.flatten(2), dim=-1).view_as(direct)
        + torch.softmax(mirrored.flatten(2), dim=-1).view_as(mirrored)
    )
    planes = probability[0].detach().cpu().numpy()
    points = np.zeros((LANDMARK_COUNT, 2), dtype=np.float64)
    for index, plane in enumerate(planes):
        center_y, center_x = np.unravel_index(int(plane.argmax()), plane.shape)
        y0, y1, x0, x1 = max(0, center_y - 2), min(plane.shape[0], center_y + 3), max(0, center_x - 2), min(plane.shape[1], center_x + 3)
        patch = plane[y0:y1, x0:x1]
        patch = patch / max(float(patch.sum()), 1e-8)
        points[index] = (
            (float((patch * np.arange(x0, x1)[None]).sum()) + 0.5) * 4 - 0.5,
            (float((patch * np.arange(y0, y1)[:, None]).sum()) + 0.5) * 4 - 0.5,
        )
    points[:, 0] = (points[:, 0] - transform.left) * transform.original_width / transform.resized_width
    points[:, 1] = (points[:, 1] - transform.top) * transform.original_height / transform.resized_height
    points[:, 0] = np.clip(points[:, 0], 0, transform.original_width - 1)
    points[:, 1] = np.clip(points[:, 1], 0, transform.original_height - 1)
    return points


def spinopelvic_prediction(
    pixel_array: np.ndarray,
    modality: str = "xray",
    body_part: str = "lumbar",
    view: str | None = "lateral",
    laterality: str | None = None,
) -> dict[str, object]:
    """Run the joint spine/landmark model and femoral-head model once."""

    _validate_supported_input(modality, body_part, view, laterality)
    image = _robust_rescale(pixel_array)
    letterboxed, transform = _letterbox(image)
    device = _default_device()
    network_input = _model_input(letterboxed, device)
    joint, femoral = _load_model("joint", device), _load_model("femoral", device)
    with torch.inference_mode():
        spine_logits, landmark_logits = joint(network_input)
        flipped_input = torch.flip(network_input, dims=(-1,))
        flipped_spine, flipped_landmarks = joint(flipped_input)
        femoral_logits = femoral(network_input)
        flipped_femoral = femoral(flipped_input)
    spine_probability = 0.5 * (
        torch.sigmoid(spine_logits) + torch.flip(torch.sigmoid(flipped_spine), dims=(-1,))
    )
    femoral_probability = 0.5 * (
        torch.sigmoid(femoral_logits) + torch.flip(torch.sigmoid(flipped_femoral), dims=(-1,))
    )
    labeled = _label_lumbar_components(
        spine_probability[0, 0].detach().cpu().numpy() >= MODEL_THRESHOLD
    )
    points = _landmark_points(landmark_logits, flipped_landmarks, transform)
    landmarks = {
        level: {
            "superior": points[4 * index : 4 * index + 2].tolist(),
            "inferior": points[4 * index + 2 : 4 * index + 4].tolist(),
        }
        for index, level in enumerate(LUMBAR_LEVELS)
    }
    landmarks["S1"] = {"superior": points[20:22].tolist()}
    return {
        "image": image,
        "mask": _restore(labeled, transform),
        "femoral_mask": _restore(
            (femoral_probability[0, 0].detach().cpu().numpy() >= MODEL_THRESHOLD).astype(np.uint8),
            transform,
        ),
        "landmarks": landmarks,
    }


def vertebral_body_segmentation(
    pixel_array: np.ndarray,
    modality: str = "xray",
    body_part: str = "lumbar",
    view: str | None = "lateral",
    laterality: str | None = None,
) -> np.ndarray:
    """Return the common-label L1-L5 mask from the joint model."""

    return spinopelvic_prediction(pixel_array, modality, body_part, view, laterality)["mask"]
