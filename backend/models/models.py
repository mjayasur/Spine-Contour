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
import torch
import torch.nn as nn
from torchvision.models.detection import keypointrcnn_resnet50_fpn
from torchvision.models.detection.keypoint_rcnn import KeypointRCNNPredictor

try:
    from .hrnet import LANDMARKS as HRNET_LANDMARKS, build_hrnet_model, decode_heatmaps
except ImportError:  # Support running modules directly from backend/.
    from hrnet import LANDMARKS as HRNET_LANDMARKS, build_hrnet_model, decode_heatmaps


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
HRNET_WEIGHTS_PATH = WEIGHTS_DIRECTORY / "hrnet_landmarks.pt"
SUPPORTED_INPUT = ("xray", "lumbar", "lateral")
LUMBAR_LEVELS = ("L1", "L2", "L3", "L4", "L5")

# Which model reads which structure. The vertebral corners have two sources --
# the U-Net's masks, or HRNet's regressed landmarks -- and the caller picks; the
# femoral heads and the S1 endplate each have one. Every response records the
# choice under `qc.models`, so a stored measurement says what produced it.
MODEL_CHOICES = {
    "vertebrae": ("unet", "hrnet"),
    "femoral": ("unet",),
    "s1": ("keypointrcnn",),
}
DEFAULT_MODELS = {"vertebrae": "unet", "femoral": "unet", "s1": "keypointrcnn"}


def resolve_models(models: dict[str, str] | None) -> dict[str, str]:
    """Fill defaults and reject anything that is not an offered model."""

    chosen = dict(DEFAULT_MODELS)
    for structure, name in (models or {}).items():
        if structure not in MODEL_CHOICES:
            raise ValueError(f"Unknown model slot '{structure}'; expected one of "
                             f"{', '.join(MODEL_CHOICES)}")
        if name is None or name == "":
            continue
        if name not in MODEL_CHOICES[structure]:
            raise ValueError(f"Unknown {structure} model '{name}'; available: "
                             f"{', '.join(MODEL_CHOICES[structure])}")
        chosen[structure] = name
    return chosen


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


@lru_cache(maxsize=8)
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
    if kind == "hrnet":
        model = build_hrnet_model(checkpoint)
        model.heatmap_stride = int(checkpoint["stride"])
        return model.to(torch.device(device)).eval()
    model = (
        build_s1_model(int(checkpoint.get("size", MODEL_IMAGE_SIZE)))
        if kind == "s1"
        else build_unet(checkpoint, int(classes))
    )
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


def _s1_from_output(output: dict[str, torch.Tensor]) -> tuple[float, np.ndarray | None]:
    if not len(output["keypoints"]):
        return 0.0, None
    best = int(output["scores"].argmax())
    points = output["keypoints"][best, :, :2].detach().cpu().numpy().astype(np.float64)
    return float(output["scores"][best]), points


def _score_s1(letterboxed: list[np.ndarray]) -> list[tuple[float, np.ndarray | None]]:
    """Best S1 detection on each model-frame image, for the crop search."""

    device = _detection_device()
    model = _load_model("s1", device)
    with torch.inference_mode():
        outputs = model([_detection_input(image, device) for image in letterboxed])
    return [_s1_from_output(output) for output in outputs]


def _read_frame(letterboxed: np.ndarray, choice: dict[str, str]) -> dict[str, object]:
    """Run every model this choice needs on one model-frame image."""

    segmentation_device = _segmentation_device()
    detection_device = _detection_device()
    femoral = _load_model("femoral", segmentation_device)
    s1_model = _load_model("s1", detection_device)
    segmentation_input = _segmentation_input(letterboxed, segmentation_device)
    detection_input = _detection_input(letterboxed, detection_device)
    with torch.inference_mode():
        femoral_logits = femoral(segmentation_input)
        s1_confidence, s1_points = _s1_from_output(s1_model([detection_input])[0])
        if choice["vertebrae"] == "unet":
            vertebra = _load_model("vertebra", segmentation_device)
            vertebra_labels = vertebra(segmentation_input)[0].argmax(0).detach().cpu().numpy()
            hrnet_points = None
        else:
            hrnet = _load_model("hrnet", segmentation_device)
            heat = hrnet(segmentation_input).float()
            hrnet_points = decode_heatmaps(heat, hrnet.heatmap_stride)[0].cpu().numpy()
            vertebra_labels = None
    return {
        "vertebra_labels": None if vertebra_labels is None else vertebra_labels.astype(np.uint8),
        "hrnet_points": None if hrnet_points is None else hrnet_points.astype(np.float64),
        "femoral": (
            torch.sigmoid(femoral_logits[0, 0]).detach().cpu().numpy() >= MODEL_THRESHOLD
        ).astype(np.uint8),
        "s1": s1_points,
        "s1_confidence": s1_confidence,
    }


def _clip_to_film(points: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    clipped = np.asarray(points, dtype=np.float64).copy()
    clipped[:, 0] = np.clip(clipped[:, 0], 0, shape[1] - 1)
    clipped[:, 1] = np.clip(clipped[:, 1], 0, shape[0] - 1)
    return clipped


def spinopelvic_prediction(
    pixel_array: np.ndarray,
    modality: str = "xray",
    body_part: str = "lumbar",
    view: str | None = "lateral",
    laterality: str | None = None,
    models: dict[str, str] | None = None,
) -> dict[str, object]:
    """Locate the lumbosacral region, frame it, and run the chosen models.

    The film is searched for the lumbar spine first and the models run on a
    crop framed the way their training data was, so a full-spine radiograph
    measures like a lumbar one. See `framing.py` for the search and why it is
    needed. Returns the film, the label maps, every landmark in full-film
    pixels, and a record of the crop and the models that produced them.
    """

    try:
        from .. import framing, landmarks
    except ImportError:  # Support running modules directly from backend/.
        import framing, landmarks

    _validate_supported_input(modality, body_part, view, laterality)
    choice = resolve_models(models)
    raw = np.asarray(pixel_array)
    if raw.ndim != 2 or not np.issubdtype(raw.dtype, np.number) or raw.size == 0:
        raise ValueError("pixel_array must be a non-empty two-dimensional numeric grayscale array")
    if raw.dtype != np.uint8:
        raw = raw.astype(np.float32)
    image = _robust_rescale(raw)

    located = framing.locate(raw, _score_s1)
    if located is None:
        raise ValueError("Could not locate the lumbar spine on this radiograph")
    window = located["window"]
    canvas, transform = framing.prepare_crop(raw, window)
    frame = _read_frame(canvas, choice)
    if frame["s1"] is None:
        raise ValueError("S1 keypoint model did not return an endplate")

    # After a search, one reframe from the full-resolution detection, accepted
    # only if it agrees with the search; an unanchored re-detection is how a
    # crop drifts. A film taken whole is left whole: it is already the frame the
    # models expect, and re-cropping it would only change their input.
    reframed = False
    proposed = (framing.reframe(transform.restore_points(frame["s1"]), raw.shape)
                if not located.get("whole_film_won") else None)
    if proposed is not None and proposed != window and framing.accept_reframe(window, proposed):
        canvas, transform = framing.prepare_crop(raw, proposed)
        candidate = _read_frame(canvas, choice)
        if candidate["s1"] is not None:
            window, frame, reframed = proposed, candidate, True
        else:
            canvas, transform = framing.prepare_crop(raw, window)

    model_values = {level: index for index, level in enumerate(LUMBAR_LEVELS, start=1)}
    if choice["vertebrae"] == "unet":
        anterior = frame["s1"][0] - frame["s1"][1]
        corners = landmarks.corners_from_label_map(frame["vertebra_labels"], model_values, anterior)
        label_map = frame["vertebra_labels"]
    else:
        corners = {}
        for slot, (level, corner) in enumerate(HRNET_LANDMARKS):
            if level in model_values:
                corners.setdefault(level, {})[corner] = frame["hrnet_points"][slot]
        label_map = landmarks.label_map_from_corners(corners, model_values, canvas.shape)
    common_labels = np.where(label_map > 0, label_map + int(VertebraLabel.L1) - 1, 0).astype(np.uint8)

    corners_source = {
        level: {name: _clip_to_film(transform.restore_points(point), raw.shape)[0]
                for name, point in quad.items()}
        for level, quad in corners.items()
    }
    s1_source = _clip_to_film(transform.restore_points(frame["s1"]), raw.shape)
    return {
        "image": image,
        "mask": transform.restore_mask(common_labels, raw.shape),
        "femoral_mask": transform.restore_mask(frame["femoral"], raw.shape),
        "landmarks": {
            "S1": {"superior": s1_source.tolist()},
            "vertebrae": landmarks.to_contract(corners_source),
        },
        "models": choice,
        "framing": {
            "window": [int(v) for v in window],
            "reframed": reframed,
            "searched": located["searched"],
            "whole_film_won": bool(located.get("whole_film_won")),
            "whole_film_agrees": bool(located.get("whole_film_agrees")),
            "whole_film_cost": located["whole_film_cost"],
            "search_confidence": located["confidence"],
            "search_cost": located["cost"],
            "candidates": located["candidates"],
            "s1_confidence": round(float(frame["s1_confidence"]), 4),
        },
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
