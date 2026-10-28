
import io
import re
from functools import lru_cache

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError
from rembg import new_session, remove


# -----------------------------
# Configuration
# -----------------------------

APP_NAME = "ZeameBG"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_IMAGE_PIXELS = 25_000_000

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

app = FastAPI(
    title="ZeameBG API",
    description="Background removal and image background editing.",
    version="2.0.0",
)

# For development. Restrict this to your real frontend origin in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# Load the AI model only when background removal is first requested.
@lru_cache(maxsize=1)
def get_session():
    return new_session("isnet-general-use")


# -----------------------------
# Image helpers
# -----------------------------

def read_upload(upload: UploadFile) -> bytes:
    """Read an upload and enforce the file-size limit."""
    upload.file.seek(0)
    data = upload.file.read(MAX_UPLOAD_BYTES + 1)

    if not data:
        raise HTTPException(400, "Please upload an image.")

    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            "Image is too large. The maximum upload size is 10 MB."
        )

    return data


def decode_image(data: bytes) -> Image.Image:
    """Validate image data and return a safe RGBA image."""
    try:
        with Image.open(io.BytesIO(data)) as check:
            if check.width * check.height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    413, "Image dimensions are too large."
                )
            check.verify()

        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    413, "Image dimensions are too large."
                )
            image.load()
            return image.convert("RGBA")

    except HTTPException:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise HTTPException(
            400, "Invalid or damaged image. Please try another file."
        ) from exc


def image_to_png_bytes(image: Image.Image) -> io.BytesIO:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def image_response(
    image: Image.Image,
    output_format: str = "png",
) -> StreamingResponse:
    """Return an image with the correct format and download filename."""
    output_format = output_format.lower()

    if output_format in ("jpg", "jpeg"):
        # JPEG cannot preserve transparency.
        background = Image.new("RGB", image.size, (255, 255, 255))
        foreground = image.convert("RGBA")
        background.paste(foreground, mask=foreground.getchannel("A"))

        buffer = io.BytesIO()
        background.save(buffer, format="JPEG", quality=95)
        buffer.seek(0)

        return StreamingResponse(
            buffer,
            media_type="image/jpeg",
            headers={
                "Content-Disposition":
                    'attachment; filename="zeamebg-result.jpg"'
            },
        )

    if output_format != "png":
        raise HTTPException(
            400, "Unsupported format. Choose PNG or JPG."
        )

    return StreamingResponse(
        image_to_png_bytes(image),
        media_type="image/png",
        headers={
            "Content-Disposition":
                'attachment; filename="zeamebg-result.png"'
        },
    )


def remove_background(image: Image.Image) -> Image.Image:
    try:
        return remove(image, session=get_session()).convert("RGBA")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            500,
            "Background removal failed. Please try again."
        ) from exc


def parse_hex_color(color: str) -> tuple[int, int, int]:
    """Accept a color in #RRGGBB format."""
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise HTTPException(
            400, "Invalid color. Use a hex color such as #5f9d8a."
        )

    return tuple(
        int(color[index:index + 2], 16)
        for index in (1, 3, 5)
    )


# -----------------------------
# Routes
# -----------------------------

@app.get("/")
def home():
    return {
        "message": "Welcome to ZeameBG API",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": APP_NAME,
    }


@app.post("/remove-bg")
@app.post("/upload")
async def remove_bg(
    file: UploadFile = File(...),
    output_format: str = Form("png", alias="format"),
):
    data = read_upload(file)
    image = decode_image(data)
    result = remove_background(image)

    return image_response(result, output_format)


@app.post("/replace-color")
async def replace_color(
    file: UploadFile = File(...),
    color: str = Form("#5f9d8a"),
):
    data = read_upload(file)
    image = decode_image(data)
    cutout = remove_background(image)

    rgb = parse_hex_color(color)
    background = Image.new(
        "RGBA", cutout.size, rgb + (255,)
    )

    result = Image.alpha_composite(background, cutout)
    return image_response(result, "png")


@app.post("/replace-bg")
async def replace_bg(
    file: UploadFile = File(...),
    background_file: UploadFile = File(...),
):
    """
    Replace the background using a second uploaded image.

    Send the original image as 'file' and the new background
    image as 'background_file'.
    """
    original_data = read_upload(file)
    background_data = read_upload(background_file)

    original = decode_image(original_data)
    background = decode_image(background_data)

    cutout = remove_background(original)

    background = background.resize(
        cutout.size, Image.Resampling.LANCZOS
    )

    # Ensure the replacement background is fully opaque.
    opaque_background = Image.new("RGBA", background.size, "white")
    opaque_background.alpha_composite(background)

    result = Image.alpha_composite(opaque_background, cutout)
    return image_response(result, "png")


@app.post("/to-3d")
async def to_3d(file: UploadFile = File(...)):
    # Do not return a fake 3D box as if it represented the subject.
    raise HTTPException(
        status_code=501,
        detail=(
            "Image-to-3D conversion is not implemented yet. "
            "This feature needs a dedicated 3D reconstruction model."
        ),
    )
