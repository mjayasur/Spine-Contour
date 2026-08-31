import base64
import io

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from backend import server
from backend.models import VertebraLabel


def test_predict_endpoint_returns_images_geometry_and_measurements(monkeypatch):
    def fake_prediction(pixel_array, modality, body_part, view, laterality):
        assert pixel_array.shape == (24, 16)
        assert (modality, body_part, view, laterality) == ("xray", "lumbar", "lateral", None)
        mask = np.zeros(pixel_array.shape, dtype=np.uint8)
        mask[4:12, 3:13] = int(VertebraLabel.L1)
        return {
            "image": pixel_array,
            "mask": mask,
            "femoral_mask": np.zeros_like(mask),
            "landmarks": {"S1": {"superior": [[2, 20], [14, 18]]}},
        }

    analysis = {
        "measurements": {"SS": 10.0, "PI": 42.0, "PT": 12.0, "LL": {"L1-S1": 50.0}},
        "geometry": {"vertebrae": {}, "s1_superior": [], "hip_midpoint": [], "femoral_circles": []},
        "qc": {},
    }
    monkeypatch.setattr(server, "spinopelvic_prediction", fake_prediction)
    monkeypatch.setattr(server, "spinopelvic_measurements", lambda *args: analysis)
    upload = io.BytesIO()
    Image.fromarray(np.full((24, 16), 127, dtype=np.uint8)).save(upload, format="PNG")

    response = TestClient(server.app).post(
        "/predict",
        data={"modality": "xray", "body_part": "lumbar", "view": "lateral"},
        files={"file": ("radiograph.png", upload.getvalue(), "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["measurements"] == analysis["measurements"]
    mask = np.asarray(Image.open(io.BytesIO(base64.b64decode(body["mask_png"]))))
    assert mask.shape == (24, 16)
    assert set(np.unique(mask)) == {0, int(VertebraLabel.L1)}
    assert body["labels"]["L1"] == int(VertebraLabel.L1)


def test_predict_endpoint_rejects_an_empty_upload():
    response = TestClient(server.app).post(
        "/predict",
        data={"modality": "xray", "body_part": "lumbar", "view": "lateral"},
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert response.status_code == 400


def test_measure_endpoint_recalculates_corrected_landmarks():
    vertebrae = {
        level: {
            "quadrilateral": [[20, top], [80, top], [80, top + 10], [20, top + 10]],
            "superior": [[20, top], [80, top]],
            "inferior": [[20, top + 10], [80, top + 10]],
        }
        for level, top in zip(("L1", "L2", "L3", "L4", "L5"), (10, 30, 50, 70, 90))
    }
    response = TestClient(server.app).post(
        "/measure",
        json={
            "vertebrae": vertebrae,
            "s1_superior": [[20, 120], [80, 110]],
            "femoral_circles": [[35, 145, 12], [65, 145, 12]],
        },
    )

    assert response.status_code == 200
    assert set(response.json()["measurements"]["LL"]) == {
        "L1-S1", "L2-S1", "L3-S1", "L4-S1", "L5-S1"
    }
    assert response.json()["geometry"]["hip_midpoint"] == [50.0, 145.0]


def test_health_endpoint_reports_ready():
    response = TestClient(server.app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
