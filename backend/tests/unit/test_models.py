import numpy as np
import pytest

from backend.models import VERTEBRA_LABELS, VertebraLabel, _label_lumbar_components
from backend.models import vertebral_body_segmentation
from backend.models.models import MODEL_IMAGE_SIZE, _letterbox, _restore_points


def test_common_labeling_covers_c1_through_sacrum_and_transitional_levels():
    assert VERTEBRA_LABELS["C1"] == 1
    assert VERTEBRA_LABELS["L1"] == 20
    assert VERTEBRA_LABELS["S5"] == 29
    assert VERTEBRA_LABELS["T13"] == 30
    assert VERTEBRA_LABELS["L6"] == 31


def test_binary_lumbar_components_are_labeled_superior_to_inferior():
    binary = np.zeros((120, 80), dtype=bool)
    for index in range(5):
        top = 5 + index * 22
        binary[top : top + 12, 20:60] = True
    binary[0, 0] = True  # A small false-positive component is discarded.

    labeled = _label_lumbar_components(binary)

    for index, level in enumerate(
        (VertebraLabel.L1, VertebraLabel.L2, VertebraLabel.L3, VertebraLabel.L4, VertebraLabel.L5)
    ):
        assert labeled[10 + index * 22, 30] == int(level)
    assert labeled[0, 0] == 0


def test_segmentation_rejects_an_unavailable_model_before_loading_weights():
    with pytest.raises(ValueError, match="only available combination"):
        vertebral_body_segmentation(
            np.zeros((32, 32), dtype=np.uint8),
            modality="mri",
            body_part="lumbar",
            view="lateral",
        )


def test_authoritative_letterbox_preserves_aspect_ratio_and_point_coordinates():
    image = np.zeros((2200, 1600), dtype=np.uint8)
    letterboxed, transform = _letterbox(image)
    source_points = np.asarray([[100, 200], [1400, 2000]], dtype=np.float64)
    model_points = source_points * transform.scale + [transform.left, transform.top]

    assert letterboxed.shape == (MODEL_IMAGE_SIZE, MODEL_IMAGE_SIZE) == (768, 768)
    assert (transform.resized_height, transform.resized_width) == (768, 559)
    assert _restore_points(model_points, transform) == pytest.approx(source_points)
