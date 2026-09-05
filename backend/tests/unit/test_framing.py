import numpy as np
import pytest

from backend import framing
from backend.framing import (
    CROP_ABOVE_L,
    CROP_ASPECT,
    CROP_BELOW_L,
    CropTransform,
    accept_reframe,
    clip_window,
    locate,
    prepare_crop,
    reframe,
    search_windows,
    select_candidate,
)


def test_search_windows_stay_inside_the_film_and_bracket_its_lower_half():
    height, width = 3000, 1400
    windows = search_windows(height, width)
    assert windows and windows == sorted(set(windows))
    for left, top, right, bottom in windows:
        assert 0 <= left < right <= width
        assert 0 <= top < bottom <= height
        assert bottom - top > 64 and right - left > 64
    # Every candidate is centred over the lower part of the film, never the neck.
    assert min((t + b) / 2 for _, t, _, b in windows) > 0.45 * height


def test_clip_window_clamps_to_the_film_and_never_collapses():
    # A window partly off the film is clamped to its edge; one wholly off it
    # degenerates to a one-pixel box rather than raising or going negative.
    assert clip_window(20, 20, 100, 100, 400, 300) == (0, 0, 70, 70)
    assert clip_window(1000, 1000, 100, 100, 400, 300)[2:] == (300, 400)
    left, top, right, bottom = clip_window(-50, -50, 100, 100, 400, 300)
    assert (left, top) == (0, 0) and right > left and bottom > top
    left, top, right, bottom = clip_window(150, 200, 0.1, 0.1, 400, 300)
    assert right > left and bottom > top


def test_reframe_places_the_endplate_between_its_two_clearances():
    length = 100.0
    s1 = np.asarray([[1100.0, 4000.0], [1000.0, 4000.0]])      # anterior first
    window = reframe(s1, (10000, 4000))
    left, top, right, bottom = window
    midpoint_y = 4000.0
    assert midpoint_y - top == pytest.approx(CROP_ABOVE_L * length, abs=1)
    assert bottom - midpoint_y == pytest.approx(CROP_BELOW_L * length, abs=1)
    assert (bottom - top) / (right - left) == pytest.approx(CROP_ASPECT, rel=0.01)
    assert (left + right) / 2 == pytest.approx(1050.0, abs=1)


def test_reframe_rejects_a_degenerate_endplate():
    assert reframe(np.asarray([[10.0, 10.0], [11.0, 10.0]]), (500, 500)) is None


def test_select_candidate_prefers_the_self_consistent_box_over_confidence_alone():
    total = CROP_ABOVE_L + CROP_BELOW_L
    right_size = {"confidence": 0.98, "height": total * 40.0, "length": 40.0,
                  "y_fraction": CROP_ABOVE_L / total, "x_fraction": 0.5, "window": "good"}
    too_small = {"confidence": 1.00, "height": 0.5 * total * 40.0, "length": 40.0,
                 "y_fraction": 0.9, "x_fraction": 0.5, "window": "cuts hips off"}
    too_big = {"confidence": 0.99, "height": 2.0 * total * 40.0, "length": 40.0,
               "y_fraction": 0.3, "x_fraction": 0.5, "window": "thoracic"}
    assert select_candidate([too_small, right_size, too_big])["window"] == "good"


def test_select_candidate_gates_on_confidence_before_choosing():
    total = CROP_ABOVE_L + CROP_BELOW_L
    perfect_but_unsure = {"confidence": 0.2, "height": total * 40.0, "length": 40.0,
                          "y_fraction": CROP_ABOVE_L / total, "x_fraction": 0.5, "window": "a"}
    confident = {"confidence": 0.95, "height": 1.3 * total * 40.0, "length": 40.0,
                 "y_fraction": 0.5, "x_fraction": 0.5, "window": "b"}
    assert select_candidate([perfect_but_unsure, confident])["window"] == "b"


def test_accept_reframe_rejects_a_drift_or_a_wild_rescale():
    current = (0, 1000, 800, 2200)
    assert accept_reframe(current, (0, 1100, 800, 2350))
    assert not accept_reframe(current, (0, 100, 800, 1300))          # walked up the film
    assert not accept_reframe(current, (0, 1000, 800, 5000))         # tripled in height


def test_crop_transform_round_trips_points_into_the_full_film():
    film = np.zeros((3000, 1200), dtype=np.uint8)
    window = (200, 1500, 900, 2600)
    canvas, transform = prepare_crop(film, window)
    assert canvas.shape == (768, 768)
    source = np.asarray([[350.0, 1700.0], [880.0, 2590.0]])
    model = (source - [window[0], window[1]]) * transform.scale + [transform.inner.left, transform.inner.top]
    assert transform.restore_points(model) == pytest.approx(source, abs=1e-6)


def test_crop_transform_restores_a_mask_into_the_window_only():
    film = np.zeros((3000, 1200), dtype=np.uint8)
    window = (200, 1500, 900, 2600)
    _, transform = prepare_crop(film, window)
    frame = np.zeros((768, 768), dtype=np.uint8)
    frame[transform.inner.top:transform.inner.top + transform.inner.resized_height,
          transform.inner.left:transform.inner.left + transform.inner.resized_width] = 7
    restored = transform.restore_mask(frame, film.shape)
    assert restored.shape == film.shape
    assert restored[1500:2600, 200:900].min() == 7
    assert restored.sum() == 7 * 1100 * 700


def _fixed_point_scorer(film_small, target, length):
    """A scorer that finds one endplate, of a fixed length in film pixels, only
    in windows that contain the target -- the way a real endplate has one size
    no matter which box is drawn around it."""
    def score(canvases):
        out = []
        for canvas, window in zip(canvases, score.windows):
            left, top, right, bottom = window
            if not (left <= target[0] <= right and top <= target[1] <= bottom):
                out.append((0.0, None))
                continue
            _, transform = prepare_crop(film_small, window)
            pts = np.asarray([target + [length / 2, 0], target - [length / 2, 0]])
            model = (pts - [left, top]) * transform.scale + [transform.inner.left, transform.inner.top]
            out.append((0.99, model))
        return out
    return score


def _run_locate(film, scorer):
    """Wire the windows locate prepares into the fake scorer, in order."""
    import cv2
    factor = min(1.0, framing.SEARCH_DOWNSCALE / max(film.shape))
    original_score = framing._score_windows

    def tracked(image, windows, score_s1, batch=framing.SEARCH_BATCH):
        def with_windows(canvases):
            scorer.windows = windows[with_windows.at : with_windows.at + len(canvases)]
            with_windows.at += len(canvases)
            return scorer(canvases)
        with_windows.at = 0
        return original_score(image, windows, with_windows, batch)

    framing._score_windows = tracked
    try:
        return locate(film, scorer), factor
    finally:
        framing._score_windows = original_score


def test_locate_searches_a_tall_film_and_returns_a_window_containing_the_endplate():
    import cv2
    film = np.random.default_rng(0).integers(0, 255, (4000, 1600), dtype=np.uint8)
    factor = min(1.0, framing.SEARCH_DOWNSCALE / max(film.shape))
    film_small = cv2.resize(film, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
    target = np.asarray([700.0, 3200.0]) * factor
    # An endplate sized so that a mid-scale search window is the fixed point; the
    # whole film is several times too tall for it and must be searched.
    length = 0.28 * film_small.shape[0] / (CROP_ABOVE_L + CROP_BELOW_L)
    scorer = _fixed_point_scorer(film_small, target, length)
    found, factor = _run_locate(film, scorer)
    assert found is not None and found["whole_film_won"] is False
    left, top, right, bottom = found["window"]
    full_target = target / factor
    assert left <= full_target[0] <= right and top <= full_target[1] <= bottom


def test_locate_takes_a_lumbar_film_whole_when_its_endplate_matches_the_windows():
    film = np.random.default_rng(1).integers(0, 255, (1400, 1000), dtype=np.uint8)
    total = CROP_ABOVE_L + CROP_BELOW_L
    # The whole film is the fixed point, and every window that holds the target
    # reports the same endplate, so the film agrees with the consensus and wins.
    target = np.asarray([500.0, CROP_ABOVE_L / total * 1400.0])
    scorer = _fixed_point_scorer(film, target, 1400.0 / total)
    found, _ = _run_locate(film, scorer)
    assert found is not None and found["whole_film_agrees"] is True
    assert found["whole_film_won"] is True
    assert found["window"] == (0, 0, 1000, 1400)


def test_locate_rejects_a_whole_film_whose_endplate_disagrees_with_the_windows():
    # A tall film where the windows all find a short endplate but the whole-film
    # pass returns a long one that would make the film look self-consistent.
    import cv2
    film = np.random.default_rng(3).integers(0, 255, (4000, 1600), dtype=np.uint8)
    factor = min(1.0, framing.SEARCH_DOWNSCALE / max(film.shape))
    film_small = cv2.resize(film, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
    target = np.asarray([700.0, 3200.0]) * factor
    total = CROP_ABOVE_L + CROP_BELOW_L
    true_length = 0.28 * film_small.shape[0] / total
    inner = _fixed_point_scorer(film_small, target, true_length)

    def scorer(canvases):
        out = inner(canvases)
        for i, window in enumerate(inner.windows):
            if window == (0, 0, film_small.shape[1], film_small.shape[0]):
                _, transform = prepare_crop(film_small, window)
                bogus = film_small.shape[0] / total          # "self-consistent" by size
                pts = np.asarray([target + [bogus / 2, 0], target - [bogus / 2, 0]])
                model = (pts - [0, 0]) * transform.scale + [transform.inner.left, transform.inner.top]
                out[i] = (0.999, model)
        return out
    scorer.windows = None

    def tracked_scorer(canvases):
        inner.windows = scorer.windows
        return scorer(canvases)
    tracked_scorer.windows = None

    original = framing._score_windows
    def tracked(image, windows, score_s1, batch=framing.SEARCH_BATCH):
        def with_windows(canvases):
            tracked_scorer.windows = scorer.windows = windows[with_windows.at : with_windows.at + len(canvases)]
            with_windows.at += len(canvases)
            return tracked_scorer(canvases)
        with_windows.at = 0
        return original(image, windows, with_windows, batch)
    framing._score_windows = tracked
    try:
        found = locate(film, tracked_scorer)
    finally:
        framing._score_windows = original
    assert found is not None
    assert found["whole_film_agrees"] is False and found["whole_film_won"] is False
    left, top, right, bottom = found["window"]
    full_target = target / factor
    assert left <= full_target[0] <= right and top <= full_target[1] <= bottom


def test_locate_lets_the_whole_film_win_a_search_it_only_just_failed_to_skip():
    # Anatomy that fills most of a tall lumbar film: the whole film is nearer the
    # fixed point than any search window, but not near enough to skip the search.
    film = np.random.default_rng(2).integers(0, 255, (2600, 1000), dtype=np.uint8)
    total = CROP_ABOVE_L + CROP_BELOW_L
    target = np.asarray([500.0, 0.72 * 2600.0])
    scorer = _fixed_point_scorer(film, target, 2600.0 / total * 0.8)
    found, _ = _run_locate(film, scorer)
    assert found is not None and found["whole_film_agrees"] is True
    assert found["whole_film_won"] is True
    assert found["window"] == (0, 0, 1000, 2600)


def test_locate_admits_the_whole_film_when_the_windows_find_nothing_they_trust():
    # A lumbar film: every window is a crop smaller than the anatomy. One window
    # reads a short, unconfident endplate; the whole film reads the real one,
    # far longer. With no consensus to disagree with, the whole film competes
    # and wins.
    # Under SEARCH_DOWNSCALE on the long side, so the scorer's film pixels are locate's.
    film = np.random.default_rng(4).integers(0, 255, (1900, 1500), dtype=np.uint8)
    total = CROP_ABOVE_L + CROP_BELOW_L
    target = np.asarray([750.0, CROP_ABOVE_L / total * 1900.0])
    real = _fixed_point_scorer(film, target, 1900.0 / total)

    def scorer(canvases):
        out = []
        for canvas, window in zip(canvases, scorer.windows):
            if window == (0, 0, film.shape[1], film.shape[0]):
                real.windows = [window]
                out.append(real([canvas])[0])
            elif window == scorer.lucky:
                left, top, right, bottom = window
                _, transform = prepare_crop(film, window)
                pts = np.asarray([target + [30.0, 0], target - [30.0, 0]])
                model = (pts - [left, top]) * transform.scale + [transform.inner.left, transform.inner.top]
                out.append((0.55, model))
            else:
                out.append((0.0, None))
        return out
    scorer.windows = None
    scorer.lucky = None

    original = framing._score_windows
    def tracked(image, windows, score_s1, batch=framing.SEARCH_BATCH):
        if scorer.lucky is None:
            scorer.lucky = next(w for w in windows if w[0] <= target[0] <= w[2] and w[1] <= target[1] <= w[3])
        def with_windows(canvases):
            scorer.windows = windows[with_windows.at : with_windows.at + len(canvases)]
            with_windows.at += len(canvases)
            return scorer(canvases)
        with_windows.at = 0
        return original(image, windows, with_windows, batch)
    framing._score_windows = tracked
    try:
        found = locate(film, scorer)
    finally:
        framing._score_windows = original
    assert found is not None
    assert found["search_strong"] is False and found["whole_film_agrees"] is True
    assert found["whole_film_won"] is True and found["window"] == (0, 0, 1500, 1900)
