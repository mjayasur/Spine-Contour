"""FastAPI server for Spine-Contour inference."""

from __future__ import annotations

import base64
import io

import numpy as np
import pydicom
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

try:
    from .models import VERTEBRA_LABELS, spinopelvic_prediction
    from .utils import spinopelvic_measurements, spinopelvic_measurements_from_geometry
except ImportError:  # Support `uvicorn server:app` from backend/.
    from models import VERTEBRA_LABELS, spinopelvic_prediction
    from utils import spinopelvic_measurements, spinopelvic_measurements_from_geometry


MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_prediction_progress: dict[str, dict[str, object]] = {}

app = FastAPI(title="Spine-Contour", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


def _dicom_pixel_array(payload: bytes) -> np.ndarray:
    dataset = pydicom.dcmread(io.BytesIO(payload))
    pixels = np.asarray(dataset.pixel_array, dtype=np.float32)
    if pixels.ndim != 2:
        raise ValueError("Only single-frame grayscale DICOM files are supported")
    slope = float(getattr(dataset, "RescaleSlope", 1.0))
    intercept = float(getattr(dataset, "RescaleIntercept", 0.0))
    pixels = pixels * slope + intercept
    if str(getattr(dataset, "PhotometricInterpretation", "")).upper() == "MONOCHROME1":
        pixels = float(pixels.max() + pixels.min()) - pixels
    return pixels


def _decode_grayscale(payload: bytes) -> np.ndarray:
    try:
        with Image.open(io.BytesIO(payload)) as image:
            return np.asarray(image.convert("L"))
    except (UnidentifiedImageError, OSError):
        try:
            return _dicom_pixel_array(payload)
        except Exception as error:
            raise ValueError("The upload is not a readable image or grayscale DICOM file") from error


@app.post("/predict", summary="Segment and measure a lateral lumbar radiograph")
async def predict(
    file: UploadFile = File(...),
    modality: str = Form(...),
    body_part: str = Form(...),
    view: str | None = Form(None),
    laterality: str | None = Form(None),
    whole_spine: bool = Form(False),
    job_id: str | None = Form(None),
) -> dict[str, object]:
    """Return masks, fitted geometry, and spinopelvic measurements."""

    current_stage = {"message": "Reading the selected radiograph"}

    def report(percent: int, message: str) -> None:
        current_stage["message"] = message
        if job_id:
            _prediction_progress[job_id[:100]] = {
                "percent": max(0, min(100, int(percent))), "message": message
            }

    report(1, "Reading the selected radiograph")
    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    if not payload:
        message = "Reading the selected radiograph failed: the uploaded file is empty"
        report(100, message)
        raise HTTPException(status_code=400, detail=message)
    if len(payload) > MAX_UPLOAD_BYTES:
        message = "Reading the selected radiograph failed: the upload exceeds 50 MB"
        report(100, message)
        raise HTTPException(status_code=413, detail=message)

    try:
        report(3, "Decoding the grayscale radiograph")
        pixel_array = _decode_grayscale(payload)
        prediction = await run_in_threadpool(
            spinopelvic_prediction,
            pixel_array,
            modality,
            body_part,
            view,
            laterality,
            whole_spine,
            report,
        )
        report(88, "Calculating spinopelvic measurements")
        analysis = await run_in_threadpool(
            spinopelvic_measurements,
            prediction["mask"],
            prediction["landmarks"]["S1"]["superior"],
            prediction["femoral_mask"],
            prediction["landmarks"],
        )
        present_labels = set(np.unique(prediction["mask"]).tolist())
        missing_masks = [
            level for level in ("L1", "L2", "L3", "L4", "L5")
            if VERTEBRA_LABELS[level] not in present_labels
        ]
        if missing_masks:
            analysis.setdefault("warnings", []).append(
                "The vertebral segmentation mask did not identify "
                f"{', '.join(missing_masks)}. L1-L5 landmarks and spinal angles use the "
                "specialist landmark model."
            )
        crop = prediction.get("crop")
        if crop and float(crop["ranking_score"]) < 0.65:
            analysis.setdefault("warnings", []).append(
                "The automatic whole-spine crop had a low combined model-confidence score. "
                "Please review the landmarks before using the measurements."
            )
    except ValueError as error:
        message = f"{current_stage['message']} failed: {error}"
        report(100, message)
        raise HTTPException(status_code=422, detail=message) from error
    except FileNotFoundError as error:
        message = f"{current_stage['message']} failed because a model file is missing: {error}"
        report(100, message)
        raise HTTPException(status_code=500, detail=message) from error
    except RuntimeError as error:
        message = f"{current_stage['message']} failed during model inference: {error}"
        report(100, message)
        raise HTTPException(status_code=500, detail=message) from error
    except Exception as error:
        message = (
            f"{current_stage['message']} failed with {type(error).__name__}: {error}"
        )
        report(100, message)
        raise HTTPException(status_code=500, detail=message) from error

    report(95, "Preparing registered image overlays")
    encoded = {}
    for name in ("image", "mask", "femoral_mask"):
        output = io.BytesIO()
        Image.fromarray(prediction[name]).save(output, format="PNG", optimize=True)
        encoded[f"{name}_png"] = base64.b64encode(output.getvalue()).decode("ascii")
    report(100, "Measurements and overlays are ready")
    return {
        **encoded,
        **analysis,
        "labels": VERTEBRA_LABELS,
        "crop": prediction.get("crop"),
    }


@app.get("/progress/{job_id}", include_in_schema=False)
def prediction_progress(job_id: str) -> dict[str, object]:
    return _prediction_progress.get(
        job_id[:100], {"percent": 0, "message": "Waiting for prediction to start"}
    )


@app.post("/measure", summary="Recalculate measurements from corrected landmarks")
async def measure(geometry: dict[str, object]) -> dict[str, object]:
    """Return measurements after interactive landmark correction."""

    try:
        return await run_in_threadpool(
            spinopelvic_measurements_from_geometry,
            geometry.get("vertebrae"),
            geometry.get("s1_superior"),
            geometry.get("femoral_circles"),
        )
    except (AttributeError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/health", include_in_schema=False)
def health() -> dict[str, str]:
    return {"status": "ok"}
