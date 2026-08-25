"""Inference models and the shared vertebral-label convention."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from enum import IntEnum
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image


class VertebraLabel(IntEnum):
    """Stable integer labels used by every Spine-Contour segmentation mask.

    The usual 24 presacral vertebrae and five sacral segments keep contiguous
    IDs. T13 and L6 are reserved IDs for thoracolumbar and lumbosacral
    transitional anatomy.
    """

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
WEIGHTS_PATH = Path(__file__).resolve().parent.parent / "weights" / "best_unet2d.pt"
SUPPORTED_INPUT = ("xray", "lumbar", "lateral")


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

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        return self.block(tensor)


class UNet2D(nn.Module):
    """The 2D U-Net architecture used for the BUU-LSPINE checkpoint."""

    def __init__(self, base_channels: int = 32):
        super().__init__()
        channels = [base_channels * (2**index) for index in range(5)]
        self.enc1 = DoubleConv(1, channels[0])
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

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        enc1 = self.enc1(tensor)
        enc2 = self.enc2(self.pool(enc1))
        enc3 = self.enc3(self.pool(enc2))
        enc4 = self.enc4(self.pool(enc3))
        bottleneck = self.bottleneck(self.pool(enc4))
        dec4 = self.dec4(torch.cat((self.up4(bottleneck), enc4), dim=1))
        dec3 = self.dec3(torch.cat((self.up3(dec4), enc3), dim=1))
        dec2 = self.dec2(torch.cat((self.up2(dec3), enc2), dim=1))
        dec1 = self.dec1(torch.cat((self.up1(dec2), enc1), dim=1))
        return self.head(dec1)


@dataclass(frozen=True)
class LetterboxTransform:
    original_height: int
    original_width: int
    resized_height: int
    resized_width: int
    top: int
    left: int


def _normalize_choice(value: str | None) -> str:
    return (value or "").strip().lower().replace("-", "").replace("_", "")


def _validate_supported_input(
    modality: str,
    body_part: str,
    view: str | None,
    laterality: str | None,
) -> tuple[str, str, str]:
    normalized_view = _normalize_choice(view)
    normalized_laterality = _normalize_choice(laterality)
    if normalized_view and normalized_laterality and normalized_view != normalized_laterality:
        raise ValueError("view and laterality must agree when both are provided")
    selection = (
        _normalize_choice(modality),
        _normalize_choice(body_part),
        normalized_view or normalized_laterality,
    )
    if selection != SUPPORTED_INPUT:
        raise ValueError(
            "Unsupported model selection. The only available combination is "
            "modality='xray', body_part='lumbar', view='lateral'."
        )
    return selection


def _robust_rescale(pixel_array: np.ndarray) -> np.ndarray:
    array = np.asarray(pixel_array)
    if array.ndim != 2 or not np.issubdtype(array.dtype, np.number):
        raise ValueError("pixel_array must be a two-dimensional numeric grayscale array")
    if array.size == 0:
        raise ValueError("pixel_array cannot be empty")

    values = array.astype(np.float32, copy=True)
    finite = np.isfinite(values)
    if not finite.any():
        return np.zeros(values.shape, dtype=np.uint8)
    replacement = float(np.median(values[finite]))
    values[~finite] = replacement
    foreground = values[values > 0]
    sample = foreground if foreground.size >= 100 else values.ravel()
    low, high = np.percentile(sample, (0.5, 99.5))
    if high <= low + 1e-6:
        return np.zeros(values.shape, dtype=np.uint8)
    scaled = (values - float(low)) * (255.0 / float(high - low))
    return np.clip(scaled, 0, 255).astype(np.uint8)


def _letterbox(image: np.ndarray, size: int = MODEL_IMAGE_SIZE) -> tuple[np.ndarray, LetterboxTransform]:
    height, width = image.shape
    scale = min(size / height, size / width)
    resized_height = max(1, int(round(height * scale)))
    resized_width = max(1, int(round(width * scale)))
    resized = np.asarray(
        Image.fromarray(image).resize((resized_width, resized_height), Image.Resampling.LANCZOS)
    )
    output = np.zeros((size, size), dtype=np.uint8)
    top = (size - resized_height) // 2
    left = (size - resized_width) // 2
    output[top : top + resized_height, left : left + resized_width] = resized
    return output, LetterboxTransform(
        original_height=height,
        original_width=width,
        resized_height=resized_height,
        resized_width=resized_width,
        top=top,
        left=left,
    )


def _default_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


@lru_cache(maxsize=3)
def _load_model(weights_path: str, device: str) -> UNet2D:
    path = Path(weights_path)
    if not path.is_file():
        raise FileNotFoundError(f"Missing model weights: {path}")
    try:
        checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    except TypeError:  # Compatibility with torch versions predating weights_only.
        checkpoint = torch.load(path, map_location="cpu")
    base_channels = int(checkpoint.get("config", {}).get("base_channels", 32))
    model = UNet2D(base_channels)
    model.load_state_dict(checkpoint["model"], strict=True)
    return model.to(torch.device(device)).eval()


def _connected_components(binary_mask: np.ndarray) -> list[np.ndarray]:
    remaining = np.asarray(binary_mask, dtype=bool).copy()
    height, width = remaining.shape
    components: list[np.ndarray] = []
    for start_y, start_x in np.argwhere(remaining):
        if not remaining[start_y, start_x]:
            continue
        queue = deque([(int(start_y), int(start_x))])
        remaining[start_y, start_x] = False
        pixels: list[tuple[int, int]] = []
        while queue:
            y, x = queue.pop()
            pixels.append((y, x))
            for neighbor_y, neighbor_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if (
                    0 <= neighbor_y < height
                    and 0 <= neighbor_x < width
                    and remaining[neighbor_y, neighbor_x]
                ):
                    remaining[neighbor_y, neighbor_x] = False
                    queue.append((neighbor_y, neighbor_x))
        components.append(np.asarray(pixels, dtype=np.int32))
    return components


def _label_lumbar_components(binary_mask: np.ndarray) -> np.ndarray:
    """Assign up to five largest superior-to-inferior components to L1-L5."""

    binary = np.asarray(binary_mask, dtype=bool)
    if binary.ndim != 2:
        raise ValueError("binary_mask must be two-dimensional")
    components = _connected_components(binary)
    if not components:
        return np.zeros(binary.shape, dtype=np.uint8)

    minimum_area = max(16, int(round(binary.size * 0.0002)))
    candidates = [component for component in components if len(component) >= minimum_area]
    candidates = sorted(candidates, key=len, reverse=True)[:5]
    candidates.sort(key=lambda component: float(component[:, 0].mean()))

    labeled = np.zeros(binary.shape, dtype=np.uint8)
    lumbar_labels = tuple(range(int(VertebraLabel.L1), int(VertebraLabel.L5) + 1))
    for label, component in zip(lumbar_labels, candidates):
        labeled[component[:, 0], component[:, 1]] = label
    return labeled


def _restore_original_size(labeled_mask: np.ndarray, transform: LetterboxTransform) -> np.ndarray:
    cropped = labeled_mask[
        transform.top : transform.top + transform.resized_height,
        transform.left : transform.left + transform.resized_width,
    ]
    restored = Image.fromarray(cropped).resize(
        (transform.original_width, transform.original_height), Image.Resampling.NEAREST
    )
    return np.asarray(restored, dtype=np.uint8)


def vertebral_body_segmentation(
    pixel_array: np.ndarray,
    modality: str = "xray",
    body_part: str = "lumbar",
    view: str | None = "lateral",
    laterality: str | None = None,
) -> np.ndarray:
    """Segment a grayscale radiograph and return a common-label mask.

    The currently bundled BUU-LSPINE model supports only lateral lumbar
    radiographs. Its binary L1-L5 prediction is converted to labels 20-24 in
    superior-to-inferior order. The returned mask matches ``pixel_array`` in
    height and width and uses ``uint8`` label IDs from :class:`VertebraLabel`.

    ``laterality`` is accepted as an alias for ``view`` for API clients that
    use that field name.
    """

    _validate_supported_input(modality, body_part, view, laterality)
    image = _robust_rescale(pixel_array)
    letterboxed, transform = _letterbox(image)
    device = _default_device()
    model = _load_model(str(WEIGHTS_PATH), device)
    tensor = torch.from_numpy(letterboxed[None, None]).float().to(device).div_(255.0)
    tensor = (tensor - 0.5) / 0.25

    with torch.inference_mode():
        probability = torch.sigmoid(model(tensor))
        flipped = torch.flip(tensor, dims=(-1,))
        flipped_probability = torch.flip(torch.sigmoid(model(flipped)), dims=(-1,))
        probability = 0.5 * (probability + flipped_probability)
    binary = probability[0, 0].detach().cpu().numpy() >= MODEL_THRESHOLD
    labeled = _label_lumbar_components(binary)
    return _restore_original_size(labeled, transform)
