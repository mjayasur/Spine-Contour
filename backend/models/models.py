"""Inference models and the shared vertebral-label convention."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from enum import IntEnum
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
import segmentation_models_pytorch as smp
import timm
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision.models.detection import keypointrcnn_resnet50_fpn
from torchvision.models.detection.keypoint_rcnn import KeypointRCNNPredictor


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
MODEL_IMAGE_SIZE = 768
MODEL_THRESHOLD = 0.5
WEIGHTS_DIRECTORY = Path(__file__).resolve().parent.parent / "weights"
VERTEBRA_WEIGHTS_PATH = WEIGHTS_DIRECTORY / "vertebra_unet.pt"
FEMORAL_WEIGHTS_PATH = WEIGHTS_DIRECTORY / "femoral_unet.pt"
S1_WEIGHTS_PATH = WEIGHTS_DIRECTORY / "s1_keypointrcnn.pt"
HRNET_WEIGHTS_PATH = WEIGHTS_DIRECTORY / "landmarks_hrnet.pt"
SUPPORTED_INPUT = ("xray", "lumbar", "lateral")
LUMBAR_LEVELS = ("L1", "L2", "L3", "L4", "L5")
LANDMARK_CORNERS = ("SA", "SP", "IA", "IP")
HRNET_STRIDE = 4


@dataclass(frozen=True)
class LetterboxTransform:
    original_height: int
    original_width: int
    scale: float
    resized_height: int
    resized_width: int
    top: int
    left: int


def build_unet(checkpoint: dict[str, object], classes: int) -> nn.Module:
    """Build the exact ResNet-34 U-Net used for both segmentation checkpoints."""

    return smp.Unet(
        encoder_name=str(checkpoint.get("encoder", "resnet34")),
        encoder_weights=None,
        in_channels=1,
        classes=classes,
    )


def build_s1_model(size: int = MODEL_IMAGE_SIZE) -> nn.Module:
    """Build the two-keypoint R-CNN used for the S1 superior endplate."""

    model = keypointrcnn_resnet50_fpn(
        weights=None,
        weights_backbone=None,
        num_keypoints=17,
        min_size=size,
        max_size=size,
        image_mean=[0.449] * 3,
        image_std=[0.226] * 3,
        box_detections_per_img=5,
    )
    channels = model.roi_heads.keypoint_predictor.kps_score_lowres.in_channels
    model.roi_heads.keypoint_predictor = KeypointRCNNPredictor(channels, num_keypoints=2)
    return model


class HRNetLandmarks(nn.Module):
    """Exact high-resolution landmark network used by the specialist checkpoint."""

    def __init__(self, backbone: str = "hrnet_w32", landmarks: int = 22):
        super().__init__()
        self.trunk = timm.create_model(
            backbone, pretrained=False, features_only=True, in_chans=1
        )
        channels = self.trunk.feature_info.channels()
        self.project = nn.ModuleList(nn.Conv2d(value, 64, 1, bias=False) for value in channels)
        self.head = nn.Sequential(
            nn.Conv2d(64 * len(channels), 256, 3, padding=1, bias=False),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.Conv2d(256, landmarks, 1),
        )

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        features = self.trunk(value)
        size = features[1].shape[-2:]
        projected = [
            F.interpolate(layer(feature), size=size, mode="bilinear", align_corners=False)
            for layer, feature in zip(self.project, features)
        ]
        return self.head(torch.cat(projected, dim=1))


def decode_heatmaps(heatmaps: torch.Tensor, stride: int, window: int = 3) -> torch.Tensor:
    """Decode specialist HRNet heatmaps with its training-time sub-pixel method."""

    batch, landmarks, height, width = heatmaps.shape
    flat = heatmaps.flatten(2)
    index = flat.argmax(dim=2)
    peak_y, peak_x = (index // width).float(), (index % width).float()
    offsets = torch.arange(-window, window + 1, device=heatmaps.device, dtype=torch.float32)
    delta_y, delta_x = torch.meshgrid(offsets, offsets, indexing="ij")
    ys = (peak_y.view(batch, landmarks, 1, 1) + delta_y).clamp(0, height - 1)
    xs = (peak_x.view(batch, landmarks, 1, 1) + delta_x).clamp(0, width - 1)
    gather = (ys.long() * width + xs.long()).flatten(2)
    weights = flat.gather(2, gather).clamp_min(0)
    weights /= weights.sum(dim=2, keepdim=True).clamp_min(1e-6)
    y = (ys.flatten(2) * weights).sum(dim=2)
    x = (xs.flatten(2) * weights).sum(dim=2)
    return torch.stack((x, y), dim=2) * stride


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
    image = array.astype(np.float32, copy=True)
    finite = np.isfinite(image)
    if not finite.any():
        return np.zeros(image.shape, dtype=np.uint8)
    image[~finite] = float(np.median(image[finite]))
    foreground = image[image > 0]
    values = foreground if foreground.size >= 100 else image.reshape(-1)
    low, high = np.percentile(values, (0.5, 99.5))
    if high <= low + 1:
        return np.clip(image, 0, 255).astype(np.uint8)
    return np.clip((image - low) * (255.0 / (high - low)), 0, 255).astype(np.uint8)


def _letterbox(image: np.ndarray) -> tuple[np.ndarray, LetterboxTransform]:
    height, width = image.shape
    scale = min(MODEL_IMAGE_SIZE / height, MODEL_IMAGE_SIZE / width)
    resized_height = max(1, int(round(height * scale)))
    resized_width = max(1, int(round(width * scale)))
    resized = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_AREA)
    top = (MODEL_IMAGE_SIZE - resized_height) // 2
    left = (MODEL_IMAGE_SIZE - resized_width) // 2
    output = np.zeros((MODEL_IMAGE_SIZE, MODEL_IMAGE_SIZE), dtype=np.uint8)
    output[top : top + resized_height, left : left + resized_width] = resized
    return output, LetterboxTransform(
        height, width, scale, resized_height, resized_width, top, left
    )


def _segmentation_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _detection_device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


@lru_cache(maxsize=6)
def _load_model(kind: str, device: str) -> nn.Module:
    if kind == "vertebra":
        path, classes = VERTEBRA_WEIGHTS_PATH, 6
    elif kind == "femoral":
        path, classes = FEMORAL_WEIGHTS_PATH, 1
    elif kind == "s1":
        path, classes = S1_WEIGHTS_PATH, None
    elif kind == "hrnet":
        path, classes = HRNET_WEIGHTS_PATH, None
    else:
        raise ValueError(f"unknown model kind: {kind}")
    if not path.is_file():
        raise FileNotFoundError(f"Missing model weights: {path}")
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if kind == "s1":
        model = build_s1_model(int(checkpoint.get("size", MODEL_IMAGE_SIZE)))
    elif kind == "hrnet":
        model = HRNetLandmarks(
            str(checkpoint.get("backbone", "hrnet_w32")), len(checkpoint["landmarks"])
        )
    else:
        model = build_unet(checkpoint, int(classes))
    model.load_state_dict(checkpoint["model"], strict=True)
    return model.to(torch.device(device)).eval()


def _segmentation_input(image: np.ndarray, device: str) -> torch.Tensor:
    value = torch.from_numpy(image[None, None]).float().div_(255.0)
    return ((value - 0.449) / 0.226).to(device)


def _detection_input(image: np.ndarray, device: str) -> torch.Tensor:
    value = torch.from_numpy(image).float().div_(255.0)
    return value.unsqueeze(0).repeat(3, 1, 1).to(device)


def _label_lumbar_components(binary_mask: np.ndarray) -> np.ndarray:
    """Label the five largest components L1 through L5 for compatibility."""

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
            for neighbor_y, neighbor_x in (
                (y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)
            ):
                if (
                    0 <= neighbor_y < height
                    and 0 <= neighbor_x < width
                    and remaining[neighbor_y, neighbor_x]
                ):
                    remaining[neighbor_y, neighbor_x] = False
                    queue.append((neighbor_y, neighbor_x))
        if len(pixels) >= max(16, round(binary.size * 0.0002)):
            components.append(np.asarray(pixels, dtype=np.int32))
    components = sorted(
        sorted(components, key=len, reverse=True)[:5], key=lambda item: item[:, 0].mean()
    )
    labeled = np.zeros(binary.shape, dtype=np.uint8)
    for label, component in zip(
        range(int(VertebraLabel.L1), int(VertebraLabel.L5) + 1), components
    ):
        labeled[component[:, 0], component[:, 1]] = label
    return labeled


def _restore_mask(array: np.ndarray, transform: LetterboxTransform) -> np.ndarray:
    crop = array[
        transform.top : transform.top + transform.resized_height,
        transform.left : transform.left + transform.resized_width,
    ]
    return cv2.resize(
        crop.astype(np.uint8),
        (transform.original_width, transform.original_height),
        interpolation=cv2.INTER_NEAREST,
    )


def _restore_points(points: np.ndarray, transform: LetterboxTransform) -> np.ndarray:
    restored = np.asarray(points, dtype=np.float64).copy()
    restored[:, 0] = (restored[:, 0] - transform.left) / transform.scale
    restored[:, 1] = (restored[:, 1] - transform.top) / transform.scale
    restored[:, 0] = np.clip(restored[:, 0], 0, transform.original_width - 1)
    restored[:, 1] = np.clip(restored[:, 1], 0, transform.original_height - 1)
    return restored


def spinopelvic_prediction(
    pixel_array: np.ndarray,
    modality: str = "xray",
    body_part: str = "lumbar",
    view: str | None = "lateral",
    laterality: str | None = None,
) -> dict[str, object]:
    """Run the authoritative vertebra, femoral-head, and S1 models."""

    _validate_supported_input(modality, body_part, view, laterality)
    image = _robust_rescale(pixel_array)
    letterboxed, transform = _letterbox(image)
    segmentation_device = _segmentation_device()
    detection_device = _detection_device()
    vertebra = _load_model("vertebra", segmentation_device)
    femoral = _load_model("femoral", segmentation_device)
    hrnet = _load_model("hrnet", segmentation_device)
    s1_model = _load_model("s1", detection_device)
    segmentation_input = _segmentation_input(letterboxed, segmentation_device)
    detection_input = _detection_input(letterboxed, detection_device)
    with torch.inference_mode():
        vertebra_logits = vertebra(segmentation_input)
        femoral_logits = femoral(segmentation_input)
        landmark_heatmaps = hrnet(segmentation_input)
        s1_output = s1_model([detection_input])[0]
    model_labels = vertebra_logits[0].argmax(0).detach().cpu().numpy().astype(np.uint8)
    common_labels = np.where(model_labels > 0, model_labels + int(VertebraLabel.L1) - 1, 0)
    femoral_mask = (
        torch.sigmoid(femoral_logits[0, 0]).detach().cpu().numpy() >= MODEL_THRESHOLD
    ).astype(np.uint8)
    if not len(s1_output["keypoints"]):
        raise ValueError("S1 keypoint model did not return an endplate")
    best = int(s1_output["scores"].argmax())
    s1_points = s1_output["keypoints"][best, :, :2].detach().cpu().numpy()
    landmark_points = decode_heatmaps(landmark_heatmaps.float(), HRNET_STRIDE)[0, :20].cpu().numpy()
    landmark_points = _restore_points(landmark_points, transform)
    landmarks = {
        level: {
            corner: landmark_points[4 * level_index + corner_index].tolist()
            for corner_index, corner in enumerate(LANDMARK_CORNERS)
        }
        for level_index, level in enumerate(LUMBAR_LEVELS)
    }
    landmarks["S1"] = {"superior": _restore_points(s1_points, transform).tolist()}
    return {
        "image": image,
        "mask": _restore_mask(common_labels, transform),
        "femoral_mask": _restore_mask(femoral_mask, transform),
        "landmarks": landmarks,
    }


def vertebral_body_segmentation(
    pixel_array: np.ndarray,
    modality: str = "xray",
    body_part: str = "lumbar",
    view: str | None = "lateral",
    laterality: str | None = None,
) -> np.ndarray:
    """Return the common-label L1-L5 mask from the authoritative U-Net."""

    return spinopelvic_prediction(pixel_array, modality, body_part, view, laterality)["mask"]
