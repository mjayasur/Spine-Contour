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
) -> dict[str, object]:
    """Return masks, fitted geometry, and spinopelvic measurements."""

    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The uploaded file exceeds 50 MB")

    try:
        pixel_array = _decode_grayscale(payload)
        prediction = await run_in_threadpool(
            spinopelvic_prediction,
            pixel_array,
            modality,
            body_part,
            view,
            laterality,
        )
        analysis = await run_in_threadpool(
            spinopelvic_measurements,
            prediction["mask"],
            prediction["landmarks"]["S1"]["superior"],
            prediction["femoral_mask"],
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    encoded = {}
    for name in ("image", "mask", "femoral_mask"):
        output = io.BytesIO()
        Image.fromarray(prediction[name]).save(output, format="PNG", optimize=True)
        encoded[f"{name}_png"] = base64.b64encode(output.getvalue()).decode("ascii")
    return {**encoded, **analysis, "labels": VERTEBRA_LABELS}


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
