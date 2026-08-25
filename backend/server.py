"""FastAPI server for Spine-Contour inference."""

from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
import pydicom
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

try:
    from .models import VERTEBRA_LABELS, vertebral_body_segmentation
except ImportError:  # Support `uvicorn server:app` from backend/.
    from models import VERTEBRA_LABELS, vertebral_body_segmentation


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


@app.post(
    "/predict",
    summary="Segment vertebral bodies",
    responses={200: {"content": {"image/png": {}}}},
)
async def predict(
    file: UploadFile = File(...),
    modality: str = Form(...),
    body_part: str = Form(...),
    view: str | None = Form(None),
    laterality: str | None = Form(None),
) -> Response:
    """Return a lossless PNG whose pixels contain common vertebral label IDs."""

    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The uploaded file exceeds 50 MB")

    try:
        pixel_array = _decode_grayscale(payload)
        mask = await run_in_threadpool(
            vertebral_body_segmentation,
            pixel_array,
            modality,
            body_part,
            view,
            laterality,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    output = io.BytesIO()
    Image.fromarray(mask).save(output, format="PNG", optimize=True)
    stem = Path(file.filename or "prediction").stem
    return Response(
        content=output.getvalue(),
        media_type="image/png",
        headers={
            "Content-Disposition": f'inline; filename="{stem}_mask.png"',
            "X-Mask-Encoding": "vertebra-label-id",
            "X-Vertebra-Labels": json.dumps(VERTEBRA_LABELS, separators=(",", ":")),
        },
    )
