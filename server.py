import io
import os
import re
import time
import threading

from dotenv import load_dotenv
from functools import lru_cache
# Keep your other imports here.

load_dotenv()

APP_NAME = "ZeameBG"
from functools import lru_cache
from urllib.request import Request as URLRequest, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    HTTPException,
    Query,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from PIL import Image, UnidentifiedImageError, ImageOps
from rembg import new_session, remove
from starlette.concurrency import run_in_threadpool


# --------------------------------
# Configuration
# --------------------------------

APP_NAME = "ZeameBG"

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MAX_UNSPLASH_IMAGE_BYTES = 15 * 1024 * 1024

MODEL_NAME = "birefnet-general"
UNSPLASH_API = "https://api.unsplash.com"
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY", "").strip()

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

app = FastAPI(
    title="ZeameBG API",
    description="Background removal and image background editing.",
    version="2.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://zeamebg.vercel.app",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# --------------------------------
# AI model management
# --------------------------------

model_lock = threading.Lock()


@lru_cache(maxsize=1)
def get_session():
    start = time.perf_counter()
    print(f"Loading AI model: {MODEL_NAME}", flush=True)

    session = new_session(MODEL_NAME)

    elapsed = time.perf_counter() - start
    print(f"AI model loaded in {elapsed:.2f} seconds", flush=True)

    return session


# --------------------------------
# Upload helpers
# --------------------------------

async def read_upload(upload: UploadFile) -> bytes:
    data = await upload.read(MAX_UPLOAD_BYTES + 1)

    if not data:
        raise HTTPException(
            status_code=400,
            detail="Please upload an image.",
        )

    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image is too large. Maximum size is 10 MB.",
        )

    return data


def decode_image(data: bytes) -> Image.Image:
    try:
        with Image.open(io.BytesIO(data)) as check:
            if check.width * check.height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    413,
                    "Image dimensions are too large.",
                )
            check.verify()

        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    413,
                    "Image dimensions are too large.",
                )

            image.load()
            image = ImageOps.exif_transpose(image)
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
            400,
            "Invalid or damaged image. Please try another file.",
        ) from exc


# --------------------------------
# Image output helpers
# --------------------------------

def image_to_png_bytes(image: Image.Image) -> io.BytesIO:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=False)
    buffer.seek(0)
    return buffer


def image_response(
    image: Image.Image,
    output_format: str = "png",
) -> StreamingResponse:

    output_format = output_format.lower()

    if output_format in ("jpg", "jpeg"):
        foreground = image.convert("RGBA")
        background = Image.new("RGB", foreground.size, (255, 255, 255))

        background.paste(
            foreground,
            mask=foreground.getchannel("A"),
        )

        buffer = io.BytesIO()
        background.save(
            buffer,
            format="JPEG",
            quality=95,
            subsampling=0,
        )
        buffer.seek(0)

        return StreamingResponse(
            buffer,
            media_type="image/jpeg",
            headers={
                "Content-Disposition":
                'attachment; filename="zeamebg-result.jpg"',
            },
        )

    if output_format != "png":
        raise HTTPException(
            400,
            "Unsupported format. Choose PNG or JPG.",
        )

    return StreamingResponse(
        image_to_png_bytes(image),
        media_type="image/png",
        headers={
            "Content-Disposition":
            'attachment; filename="zeamebg-result.png"',
        },
    )


# --------------------------------
# Background removal
# --------------------------------

def remove_background(image: Image.Image) -> Image.Image:
    try:
        start = time.perf_counter()
        original_size = image.size

        with model_lock:
            session = get_session()

            result = remove(
                image,
                session=session,
                alpha_matting=False,
                post_process_mask=False,
            )

        result = result.convert("RGBA")

        elapsed = time.perf_counter() - start
        print(
            f"Background removal: {elapsed:.2f}s "
            f"| Image: {original_size[0]}x{original_size[1]}",
            flush=True,
        )

        return result

    except Exception as exc:
        print(f"Background removal error: {exc}", flush=True)

        raise HTTPException(
            500,
            "Background removal failed. Please try again.",
        ) from exc


# --------------------------------
# Color helper
# --------------------------------

def parse_hex_color(color: str) -> tuple[int, int, int]:
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise HTTPException(400, "Invalid color. Use #RRGGBB.")

    return tuple(
        int(color[index:index + 2], 16)
        for index in (1, 3, 5)
    )


# --------------------------------
# Unsplash helpers
# --------------------------------

def require_unsplash_key() -> str:
    if not UNSPLASH_ACCESS_KEY:
        raise HTTPException(
            503,
            "Unsplash is not configured. Set UNSPLASH_ACCESS_KEY "
            "in the backend environment variables.",
        )

    return UNSPLASH_ACCESS_KEY


def unsplash_request(
    path: str,
    params: dict | None = None,
) -> dict:
    key = require_unsplash_key()

    url = f"{UNSPLASH_API}{path}"

    if params:
        url += "?" + urlencode(params)

    request = URLRequest(
        url,
        headers={
            "Authorization": f"Client-ID {key}",
            "Accept-Version": "v1",
            "User-Agent": "ZeameBG/2.2",
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=20) as response:
            import json
            return json.loads(response.read(2 * 1024 * 1024 + 1))

    except HTTPError as exc:
        if exc.code == 401:
            raise HTTPException(
                502,
                "Unsplash rejected the API key. Check your configuration.",
            ) from exc

        if exc.code == 403:
            raise HTTPException(
                502,
                "Unsplash denied the request. Check your app permissions "
                "or API limits.",
            ) from exc

        if exc.code == 404:
            raise HTTPException(404, "Unsplash photo not found.") from exc

        if exc.code == 429:
            raise HTTPException(
                429,
                "Unsplash rate limit reached. Please try again later.",
            ) from exc

        raise HTTPException(
            502,
            "Unsplash could not complete the request.",
        ) from exc

    except (URLError, TimeoutError, OSError) as exc:
        raise HTTPException(
            502,
            "Unable to connect to Unsplash. Please try again.",
        ) from exc


def unsplash_image_url(photo_id: str, request: Request) -> str:
    base_url = "https://zearome-zeamebg.ms.fun"
    return f"{base_url}/unsplash/image/{photo_id}"


# --------------------------------
# Core routes
# --------------------------------

@app.get("/")
def home():
    return {
        "message": "Welcome to ZeameBG API",
        "docs": "/docs",
        "health": "/health",
        "model": MODEL_NAME,
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": APP_NAME,
    }


# --------------------------------
# Remove background
# --------------------------------

@app.post("/remove-bg")
@app.post("/upload")
async def remove_bg(
    file: UploadFile = File(...),
    output_format: str = Form("png", alias="format"),
):
    data = await read_upload(file)

    def process():
        image = decode_image(data)
        result = remove_background(image)
        return image_response(result, output_format)

    return await run_in_threadpool(process)


# --------------------------------
# Replace background with color
# --------------------------------

@app.post("/replace-color")
async def replace_color(
    file: UploadFile = File(...),
    color: str = Form("#5f9d8a"),
):
    data = await read_upload(file)
    rgb = parse_hex_color(color)

    def process():
        image = decode_image(data)
        cutout = remove_background(image)

        background = Image.new(
            "RGBA",
            cutout.size,
            rgb + (255,),
        )

        result = Image.alpha_composite(background, cutout)
        return image_response(result, "png")

    return await run_in_threadpool(process)


# --------------------------------
# Background fitting
# --------------------------------

def fit_background(
    background: Image.Image,
    target_size: tuple[int, int],
    fit: str,
) -> Image.Image:

    target_width, target_height = target_size

    if fit == "stretch":
        return background.resize(
            target_size,
            Image.Resampling.LANCZOS,
        )

    if fit == "contain":
        background.thumbnail(
            target_size,
            Image.Resampling.LANCZOS,
        )

        canvas = Image.new(
            "RGBA",
            target_size,
            (0, 0, 0, 0),
        )

        x = (target_width - background.width) // 2
        y = (target_height - background.height) // 2

        canvas.alpha_composite(background, (x, y))
        return canvas

    if fit == "cover":
        source_width, source_height = background.size

        scale = max(
            target_width / source_width,
            target_height / source_height,
        )

        resized_width = max(1, round(source_width * scale))
        resized_height = max(1, round(source_height * scale))

        background = background.resize(
            (resized_width, resized_height),
            Image.Resampling.LANCZOS,
        )

        left = (resized_width - target_width) // 2
        top = (resized_height - target_height) // 2

        return background.crop((
            left,
            top,
            left + target_width,
            top + target_height,
        ))

    raise HTTPException(
        400,
        "Invalid fit mode. Choose cover, contain, or stretch.",
    )


# --------------------------------
# Replace background with image
# --------------------------------

@app.post("/replace-bg")
async def replace_bg(
    file: UploadFile = File(...),
    background_file: UploadFile = File(...),
    fit: str = Form("cover"),
):
    if fit not in {"cover", "contain", "stretch"}:
        raise HTTPException(
            400,
            "Invalid fit mode. Choose cover, contain, or stretch.",
        )

    original_data = await read_upload(file)
    background_data = await read_upload(background_file)

    def process():
        original = decode_image(original_data)
        background = decode_image(background_data)

        cutout = remove_background(original)

        fitted_background = fit_background(
            background,
            cutout.size,
            fit,
        )

        # Keep the final background opaque, including contain-mode
        # areas that would otherwise be transparent.
        white_canvas = Image.new(
            "RGBA",
            cutout.size,
            (255, 255, 255, 255),
        )
        white_canvas.alpha_composite(fitted_background)

        result = Image.alpha_composite(
            white_canvas,
            cutout,
        )

        return image_response(result, "png")

    return await run_in_threadpool(process)


# --------------------------------
# Unsplash: search backgrounds
# --------------------------------

@app.get("/unsplash/search")
def search_unsplash(
    request: Request,
    query: str = Query(..., min_length=1, max_length=120),
    page: int = Query(1, ge=1, le=100),
    per_page: int = Query(12, ge=1, le=30),
):
    query = query.strip()

    if not query:
        raise HTTPException(400, "Enter a background search term.")

    data = unsplash_request(
        "/search/photos",
        {
            "query": query,
            "page": page,
            "per_page": per_page,
            "content_filter": "high",
            "orientation": "landscape",
        },
    )

    results = []

    for photo in data.get("results", []):
        photo_id = photo.get("id")

        if not photo_id:
            continue

        user = photo.get("user") or {}
        links = photo.get("links") or {}

        results.append({
            "id": photo_id,
            "description": (
                photo.get("alt_description")
                or photo.get("description")
                or "Unsplash background"
            ),
            "image_url": unsplash_image_url(photo_id, request),
            "download_location": links.get("download_location"),
            "photographer": user.get("name", "Unsplash photographer"),
            "photographer_url": (
                (user.get("links") or {}).get("html", "")
            ),
            "photo_url": links.get("html", ""),
        })

    return {
        "results": results,
        "total": data.get("total", 0),
        "total_pages": data.get("total_pages", 0),
        "page": page,
    }


# --------------------------------
# Unsplash: image proxy
# --------------------------------

@app.get("/unsplash/image/{photo_id}")
def get_unsplash_image(photo_id: str):
    # Unsplash photo IDs contain letters, numbers, underscores,
    # and hyphens. Reject anything else.
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", photo_id):
        raise HTTPException(400, "Invalid photo ID.")

    photo = unsplash_request(f"/photos/{photo_id}")
    image_url = (photo.get("urls") or {}).get("regular")

    if not image_url:
        raise HTTPException(
            502,
            "Unsplash did not provide an image for this photo.",
        )

    # Only retrieve images from the official Unsplash image host.
    from urllib.parse import urlparse

    parsed = urlparse(image_url)

    if (
        parsed.scheme != "https"
        or parsed.hostname != "images.unsplash.com"
    ):
        raise HTTPException(
            502,
            "Unsplash returned an unexpected image URL.",
        )

    image_request = URLRequest(
        image_url,
        headers={"User-Agent": "ZeameBG/2.2"},
    )

    try:
        with urlopen(image_request, timeout=20) as response:
            content_type = response.headers.get("Content-Type", "")

            if not content_type.lower().startswith("image/"):
                raise HTTPException(
                    502,
                    "Unsplash returned an invalid image response.",
                )

            image_data = response.read(
                MAX_UNSPLASH_IMAGE_BYTES + 1
            )

        if len(image_data) > MAX_UNSPLASH_IMAGE_BYTES:
            raise HTTPException(
                413,
                "Selected background image is too large.",
            )

        # Validate that the returned bytes really form an image
        # before sending them to the browser.
        decode_image(image_data)

        return Response(
            content=image_data,
            media_type=content_type.split(";")[0],
            headers={
                "Cache-Control": "public, max-age=3600",
                "X-Content-Type-Options": "nosniff",
            },
        )

    except HTTPException:
        raise

    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise HTTPException(
            502,
            "Unable to retrieve this Unsplash image.",
        ) from exc


# --------------------------------
# Unsplash: track photo download
# --------------------------------

@app.post("/unsplash/track-download")
def track_unsplash_download(payload: dict):
    from urllib.parse import urlparse, parse_qsl

    download_location = payload.get("download_location")

    if not isinstance(download_location, str):
        raise HTTPException(
            status_code=400,
            detail="A valid download_location is required.",
        )

    parsed = urlparse(download_location)

    # Only permit the official Unsplash API domain.
    if (
        parsed.scheme != "https"
        or parsed.hostname != "api.unsplash.com"
        or parsed.port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or not re.fullmatch(
            r"/photos/[A-Za-z0-9_-]{1,100}/download",
            parsed.path,
        )
        or parsed.fragment
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid Unsplash download location.",
        )

    # Only allow known, harmless query parameters.
    allowed_params = {"ixid"}

    if any(
        key not in allowed_params
        for key, value in parse_qsl(
            parsed.query,
            keep_blank_values=True,
        )
    ):
        raise HTTPException(
            status_code=400,
            detail="Unsupported Unsplash download parameters.",
        )

    photo_id = parsed.path.split("/")[2]

    result = unsplash_request(
        f"/photos/{photo_id}/download"
    )

    return {
        "success": True,
        "url": result.get("url"),
    }


# --------------------------------
# Image to 3D
# --------------------------------

@app.post("/to-3d")
async def to_3d(
    file: UploadFile = File(...),
):
    raise HTTPException(
        status_code=501,
        detail=(
            "Image-to-3D conversion is not implemented yet. "
            "This feature requires a dedicated 3D reconstruction model."
        ),
    )
