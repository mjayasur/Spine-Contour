"""Find the lumbosacral region on a film and frame it the way the models expect.

The models were trained on lumbar radiographs, where the L1-S1 landmarks fill
about half the frame height. A head-to-thigh standing lateral puts the same
anatomy inside a quarter of a much taller image, so letterboxed to the model
size it arrives at roughly a third of any scale seen in training, and the
pelvis additionally washes out under a percentile rescale whose percentiles
are set by the thorax. Two steps fix both:

  search   a box slides over the lower film at several scales. Each candidate
           is rescaled on its own pixels and scored by the S1 detector.
           Confidence only gates the candidates: it saturates on any window
           that holds a lumbar spine, including ones that cut the pelvis off.
           What chooses is a fixed point -- the correctly framed box is the one
           whose own height is the training multiple of the S1 endplate it
           detects inside itself, with that endplate where training puts it.
  reframe  the crop is rebuilt around the detected S1 endplate at the size the
           training corpus says it should be, in units of the endplate length
           L: enough headroom to clear L1 and enough footroom to clear the
           femoral heads.

Every crop's transform carries the crop's origin, so restored landmarks land in
the full film and a reframe is anchored to the film rather than to the previous
crop. On a lumbar-only film the search settles on a window close to the whole
film and the result matches whole-film inference.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import cv2
import numpy as np

try:
    from .models.models import LetterboxTransform, _letterbox, _robust_rescale
except ImportError:  # Support running modules directly from backend/.
    from models.models import LetterboxTransform, _letterbox, _robust_rescale


# Crop geometry in units of the S1 endplate length L, which the detector
# recovers reliably. Measured over the training corpus: L1's top sits 4.99L
# above the S1 midpoint (p95 5.82, p99 6.42) and the femoral heads reach 3.56L
# below it (p95 4.45, p99 5.12), in films 10.8L tall overall. Both clearances sit
# past p99 on purpose: clipping L1 does not read as a framing fault downstream, it
# reads as a lordosis bias, because the topmost body found is then labelled L1.
CROP_ABOVE_L = 8.7
CROP_BELOW_L = 5.3
CROP_ASPECT = 1.5           # crop height / width

# Sliding search: candidate crop heights as fractions of image height, and the
# band of the film they are centred over. The reframe re-derives the true scale
# from L, so the search only has to land on the lumbar spine.
SEARCH_SCALES = (0.20, 0.28, 0.38)
SEARCH_Y = (0.55, 0.97)
SEARCH_NY, SEARCH_NX = 7, 4
SEARCH_DOWNSCALE = 2048     # the search runs on a copy no larger than this
SEARCH_BATCH = 8            # windows scored per detector call
MIN_ENDPLATE_PX = 4.0

# The whole film competes as one more box, under one condition. The detector
# run over a whole full-spine film can return a confident endplate that is
# nothing of the kind, sized so the film looks self-consistent -- a detector-
# only gate on the whole film was tried and took exactly that bait. What tells
# the two films apart is the search itself. On a full-spine film the windows
# find the lumbar spine in many places and agree on the endplate's length, and
# the whole film's endplate must agree with them too. On a lumbar film the
# windows are crops smaller than the anatomy, find nothing they trust, and form
# no consensus at all; then the whole film is admitted and wins on cost.
STRONG_SEARCH_CONFIDENCE = 0.9      # the best window's detector confidence
STRONG_SEARCH_CANDIDATES = 5        # windows within 90% of that confidence
WHOLE_FILM_LENGTH_RATIO = (0.75, 1.33)

Window = tuple[int, int, int, int]      # left, top, right, bottom in source pixels


@dataclass(frozen=True)
class CropTransform:
    """Model frame <-> source film, for one crop. Folds the crop origin in."""

    window: Window
    inner: LetterboxTransform

    @property
    def scale(self) -> float:
        return self.inner.scale

    def restore_points(self, points: np.ndarray) -> np.ndarray:
        """Model-frame pixels -> full-film pixels."""
        left, top, _, _ = self.window
        restored = np.asarray(points, dtype=np.float64).reshape(-1, 2).copy()
        restored[:, 0] = (restored[:, 0] - self.inner.left) / self.inner.scale + left
        restored[:, 1] = (restored[:, 1] - self.inner.top) / self.inner.scale + top
        return restored

    def restore_mask(self, array: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
        """Model-frame label map -> a full-film label map, zero outside the crop."""
        left, top, right, bottom = self.window
        crop = array[
            self.inner.top : self.inner.top + self.inner.resized_height,
            self.inner.left : self.inner.left + self.inner.resized_width,
        ]
        resized = cv2.resize(crop.astype(np.uint8), (right - left, bottom - top),
                             interpolation=cv2.INTER_NEAREST)
        output = np.zeros(shape, dtype=np.uint8)
        output[top:bottom, left:right] = resized
        return output


def prepare_crop(image: np.ndarray, window: Window) -> tuple[np.ndarray, CropTransform]:
    """Rescale on the crop's own pixels, not the film's, then letterbox."""
    left, top, right, bottom = window
    canvas, inner = _letterbox(_robust_rescale(image[top:bottom, left:right]))
    return canvas, CropTransform(window, inner)


def clip_window(centre_x: float, centre_y: float, crop_w: float, crop_h: float,
                height: int, width: int) -> Window:
    left = int(round(max(0.0, min(width - 2.0, centre_x - crop_w / 2))))
    right = int(round(max(left + 1.0, min(float(width), centre_x + crop_w / 2))))
    top = int(round(max(0.0, min(height - 2.0, centre_y - crop_h / 2))))
    bottom = int(round(max(top + 1.0, min(float(height), centre_y + crop_h / 2))))
    return left, top, right, bottom


def search_windows(height: int, width: int) -> list[Window]:
    """Candidate crops, sized and placed to bracket the lumbosacral region."""
    out = []
    for fraction in SEARCH_SCALES:
        crop_h = fraction * height
        crop_w = min(float(width), crop_h / CROP_ASPECT)
        for centre_y in np.linspace(SEARCH_Y[0] * height, SEARCH_Y[1] * height, SEARCH_NY):
            for centre_x in np.linspace(crop_w / 2, width - crop_w / 2, SEARCH_NX):
                window = clip_window(centre_x, centre_y, crop_w, crop_h, height, width)
                if window[2] - window[0] > 64 and window[3] - window[1] > 64:
                    out.append(window)
    return sorted(set(out))


def reframe(s1_source: np.ndarray, shape: tuple[int, int],
            above: float = CROP_ABOVE_L, below: float = CROP_BELOW_L) -> Window | None:
    """The crop the training corpus says this S1 endplate should sit in.

    `s1_source` is the endplate as two full-film points, anterior first. Scaling
    off the endplate rather than off whatever the vertebra masks found keeps the
    box well defined when a level is missed, and is what pushes the bottom edge
    far enough below S1 to take in the femoral heads.
    """
    sa, sp = np.asarray(s1_source, dtype=np.float64)
    length = float(np.linalg.norm(sa - sp))
    if not np.isfinite(length) or length < MIN_ENDPLATE_PX:
        return None
    crop_h = (above + below) * length
    crop_w = crop_h / CROP_ASPECT
    midpoint = (sa + sp) / 2.0
    height, width = shape
    # Centre the crop between the two clearances, not on S1, so raising `above`
    # lifts the frame instead of only stretching it downward.
    return clip_window(midpoint[0], midpoint[1] - (above - below) / 2.0 * length,
                       crop_w, crop_h, height, width)


def select_candidate(candidates: list[dict], above: float = CROP_ABOVE_L,
                     below: float = CROP_BELOW_L) -> dict:
    """The fixed point: the box whose height matches the endplate it found.

    Each candidate carries `confidence`, `height`, `length` (the detected S1
    endplate, in the same pixels as `height`) and the endplate midpoint as
    fractions of the window, `x_fraction` and `y_fraction`.
    """
    ceiling = max(c["confidence"] for c in candidates)
    gated = [c for c in candidates if c["confidence"] >= 0.9 * ceiling] or candidates

    def cost(c: dict) -> float:
        target_h = (above + below) * c["length"]
        scale_error = abs(np.log(c["height"] / target_h))
        return (scale_error + 2.0 * abs(c["y_fraction"] - above / (above + below))
                + 1.0 * abs(c["x_fraction"] - 0.5))

    best = min(gated, key=cost)
    return {**best, "cost": float(cost(best))}


Scorer = Callable[[list[np.ndarray]], list[tuple[float, np.ndarray | None]]]


def _score_windows(image: np.ndarray, windows: list[Window], score_s1: Scorer,
                   batch: int = SEARCH_BATCH) -> list[dict]:
    """Every window that yields an S1 detection, as a fixed-point candidate."""
    candidates = []
    for start in range(0, len(windows), batch):
        chunk = windows[start : start + batch]
        prepared = [prepare_crop(image, window) for window in chunk]
        scored = score_s1([canvas for canvas, _ in prepared])
        for window, (_, transform), (confidence, keypoints) in zip(chunk, prepared, scored):
            if keypoints is None:
                continue
            left, top, right, bottom = window
            # Crop-relative on purpose: the fractions below are positions within
            # the window, and the endplate length is scale-free.
            sa, sp = transform.restore_points(keypoints) - [left, top]
            length = float(np.linalg.norm(sa - sp))
            if length < MIN_ENDPLATE_PX:
                continue
            midpoint = (sa + sp) / 2.0
            candidates.append({
                "confidence": float(confidence), "window": window, "length": length,
                "height": float(bottom - top),
                "y_fraction": midpoint[1] / max(1.0, bottom - top),
                "x_fraction": midpoint[0] / max(1.0, right - left),
            })
    return candidates


def search_is_strong(candidates: list[dict]) -> bool:
    """Did the windows find the spine confidently, and in more than one place?"""
    if not candidates:
        return False
    ceiling = max(c["confidence"] for c in candidates)
    gated = [c for c in candidates if c["confidence"] >= 0.9 * ceiling]
    return ceiling >= STRONG_SEARCH_CONFIDENCE and len(gated) >= STRONG_SEARCH_CANDIDATES


def whole_film_agrees(whole: dict, candidates: list[dict],
                      ratio: tuple[float, float] = WHOLE_FILM_LENGTH_RATIO) -> bool:
    """May the whole film compete with the search windows?

    Always, when the search is weak -- there is nothing to disagree with. When
    it is strong, only if the whole film's endplate length matches the median
    over the confident windows, which is robust to the odd window that read
    something else.
    """
    if not search_is_strong(candidates):
        return True
    ceiling = max(c["confidence"] for c in candidates)
    gated = [c for c in candidates if c["confidence"] >= 0.9 * ceiling]
    consensus = float(np.median([c["length"] for c in gated]))
    if consensus <= 0:
        return False
    return ratio[0] <= whole["length"] / consensus <= ratio[1]


def locate(image: np.ndarray, score_s1: Scorer,
           above: float = CROP_ABOVE_L, below: float = CROP_BELOW_L,
           downscale: int = SEARCH_DOWNSCALE) -> dict | None:
    """Slide a box over the lower film and pick the one that frames S1 right.

    `score_s1` takes a list of letterboxed model-frame images and returns, for
    each, the best S1 detection as (confidence, [[SA], [SP]] in model-frame
    pixels) or (0.0, None). The search runs on a downscaled copy, because it
    only has to find the spine; the chosen window is returned in full-film
    pixels. The whole film joins the candidates when its endplate agrees with
    the windows', which is how a lumbar radiograph ends up taken whole.
    """
    factor = min(1.0, downscale / max(image.shape))
    small = (cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
             if factor < 1.0 else image)
    height, width = small.shape

    candidates = _score_windows(small, search_windows(height, width), score_s1)
    whole = _score_windows(small, [(0, 0, width, height)], score_s1)
    whole_cost = float(select_candidate(whole, above, below)["cost"]) if whole else None
    whole_agrees = bool(whole and candidates and whole_film_agrees(whole[0], candidates))
    if whole_agrees:
        candidates = candidates + whole
    elif not candidates and whole:
        # Nothing but the whole film detected anything. Better than no frame.
        candidates = whole
    if not candidates:
        return None
    best = select_candidate(candidates, above, below)
    whole_won = best["window"] == (0, 0, width, height)
    window = ((0, 0, image.shape[1], image.shape[0]) if whole_won
              else tuple(int(round(v / factor)) for v in best["window"]))
    return {
        "window": window,
        "confidence": round(best["confidence"], 4),
        "cost": round(best["cost"], 4),
        "candidates": len(candidates), "searched": True,
        "search_strong": search_is_strong([c for c in candidates if c["window"] != (0, 0, width, height)]),
        "whole_film_won": whole_won, "whole_film_agrees": whole_agrees,
        "whole_film_cost": None if whole_cost is None else round(whole_cost, 4),
        "s1_length_px": round(best["length"] / factor, 1),
    }


def accept_reframe(current: Window, proposed: Window) -> bool:
    """Normalising the scale off the full-resolution S1 detection is worth a
    little, but a re-detection that moves the frame more than half its height,
    or rescales it wildly, is a failure to reject rather than follow."""
    height = current[3] - current[1]
    moved = abs((proposed[1] + proposed[3]) - (current[1] + current[3])) / 2.0
    resized = (proposed[3] - proposed[1]) / max(1.0, float(height))
    return moved < 0.5 * height and 0.6 < resized < 1.7
