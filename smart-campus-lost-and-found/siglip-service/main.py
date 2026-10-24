import base64
import binascii
import hmac
import io
import os
from typing import Literal

import torch
from fastapi import FastAPI, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel
from transformers import AutoModel, AutoProcessor
from starlette.responses import JSONResponse

MODEL_ID = "google/siglip2-base-patch16-224"
EMBEDDING_DIMENSIONS = 768
MAX_IMAGE_BYTES = 10 * 1024 * 1024
SERVICE_TOKEN = os.environ.get("SIGLIP_SERVICE_TOKEN")

if not SERVICE_TOKEN:
    raise RuntimeError("SIGLIP_SERVICE_TOKEN must be configured")

processor = AutoProcessor.from_pretrained(MODEL_ID)
model = AutoModel.from_pretrained(MODEL_ID).eval()

app = FastAPI()

@app.middleware("http")
async def authenticate_embedding(request: Request, call_next):
    if request.url.path == "/embed":
        try:
            check_token(request.headers.get("Authorization"))
        except HTTPException as error:
            return JSONResponse(
                {"detail": error.detail},
                status_code=error.status_code,
            )
    return await call_next(request)


class EmbeddingRequest(BaseModel):
    modality: Literal["text", "image"]
    text: str | None = None
    image_base64: str | None = None
    content_type: str | None = None


def check_token(authorization: str | None) -> None:
    if not authorization or not hmac.compare_digest(
        authorization, f"Bearer {SERVICE_TOKEN}"
    ):
        raise HTTPException(status_code=401, detail="Invalid service token")


def normalize_embedding(embedding: torch.Tensor) -> list[float]:
    values = torch.nn.functional.normalize(embedding.float(), p=2, dim=-1)[0]
    result = values.cpu().tolist()
    if len(result) != EMBEDDING_DIMENSIONS:
        raise HTTPException(status_code=500, detail="Unexpected model embedding size")
    return result


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ready", "model": MODEL_ID}


@app.post("/embed")
def create_embedding(
    payload: EmbeddingRequest,
) -> dict[str, list[float]]:
    with torch.inference_mode():
        if payload.modality == "text":
            if not payload.text or not payload.text.strip():
                raise HTTPException(status_code=400, detail="Text must not be empty")
            if len(payload.text) > 2000:
                raise HTTPException(status_code=413, detail="Text exceeds 2000 characters")
            inputs = processor(
                text=[payload.text.strip()],
                padding="max_length",
                truncation=True,
                return_tensors="pt",
            )
            embedding = model.get_text_features(**inputs)
        else:
            if not payload.image_base64:
                raise HTTPException(status_code=400, detail="Image data is required")
            try:
                image_bytes = base64.b64decode(payload.image_base64, validate=True)
            except (binascii.Error, ValueError) as error:
                raise HTTPException(status_code=400, detail="Invalid base64 image") from error
            if len(image_bytes) > MAX_IMAGE_BYTES:
                raise HTTPException(status_code=413, detail="Image exceeds 10 MB")
            try:
                image = Image.open(io.BytesIO(image_bytes))
                if image.width * image.height > 40_000_000:
                    raise HTTPException(status_code=413, detail="Image dimensions are too large")
                image = image.convert("RGB")
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
                raise HTTPException(status_code=400, detail="Unsupported image") from error
            inputs = processor(images=[image], return_tensors="pt")
            embedding = model.get_image_features(**inputs)

    return {"embedding": normalize_embedding(embedding)}
