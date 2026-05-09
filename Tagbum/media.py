from __future__ import annotations

from io import BytesIO
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps
from PIL.ExifTags import GPSTAGS, TAGS
from pillow_heif import register_heif_opener

from .config import settings

register_heif_opener()

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif", ".tif", ".tiff"}
WEB_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXTENSIONS = {".mov", ".mp4", ".m4v", ".avi", ".3gp"}
SIDECAR_EXTENSIONS = {".aae", ".xmp", ".db"}
RAW_EXTENSIONS = {".dng"}
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS | SIDECAR_EXTENSIONS | RAW_EXTENSIONS


def classify_resource(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in RAW_EXTENSIONS:
        return "raw"
    if ext in SIDECAR_EXTENSIONS:
        return "sidecar"
    return "other"


def normalized_stem(path: Path) -> str:
    stem = path.stem
    upper = stem.upper()
    if upper.startswith("IMG_E") and upper[5:].isdigit():
        return f"IMG_{stem[5:]}"
    return stem


def group_key(source_root: Path, path: Path) -> str:
    rel_parent = path.parent.relative_to(source_root).as_posix()
    return f"{rel_parent}/{normalized_stem(path).upper()}"


def read_image_metadata(path: Path) -> tuple[int | None, int | None, datetime | None, float | None, float | None]:
    try:
        with Image.open(path) as image:
            width, height = image.size
            exif = image.getexif()
            taken_at = _read_taken_at(exif)
            lat, lon = _read_gps(exif)
            return width, height, taken_at, lat, lon
    except Exception:
        return None, None, None, None, None


def build_thumbnail(source: Path, group_id: int) -> Path | None:
    if source.suffix.lower() not in IMAGE_EXTENSIONS:
        return None
    target = settings.thumbnail_dir / f"{group_id}.jpg"
    if target.exists():
        return target
    try:
        settings.thumbnail_dir.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((settings.thumbnail_size, settings.thumbnail_size))
            rgb = image.convert("RGB")
            rgb.save(target, "JPEG", quality=86, optimize=True)
        return target
    except Exception:
        return None


def build_full_preview(source: Path) -> bytes | None:
    if source.suffix.lower() not in IMAGE_EXTENSIONS:
        return None
    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image)
            rgb = image.convert("RGB")
            output = BytesIO()
            rgb.save(output, "JPEG", quality=94, optimize=True)
            return output.getvalue()
    except Exception:
        return None


def _read_taken_at(exif) -> datetime | None:
    for tag_name in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
        tag_id = next((key for key, value in TAGS.items() if value == tag_name), None)
        if tag_id is None:
            continue
        value = exif.get(tag_id)
        if not value:
            continue
        try:
            return datetime.strptime(str(value), "%Y:%m:%d %H:%M:%S")
        except ValueError:
            continue
    return None


def _read_gps(exif) -> tuple[float | None, float | None]:
    gps_tag = next((key for key, value in TAGS.items() if value == "GPSInfo"), None)
    if gps_tag is None:
        return None, None
    raw = exif.get_ifd(gps_tag) if hasattr(exif, "get_ifd") else exif.get(gps_tag)
    if not raw:
        return None, None
    gps = {GPSTAGS.get(key, key): value for key, value in raw.items()}
    lat = _coord_to_decimal(gps.get("GPSLatitude"), gps.get("GPSLatitudeRef"))
    lon = _coord_to_decimal(gps.get("GPSLongitude"), gps.get("GPSLongitudeRef"))
    return lat, lon


def _coord_to_decimal(coord, ref) -> float | None:
    if not coord or not ref:
        return None
    try:
        degrees = float(coord[0])
        minutes = float(coord[1])
        seconds = float(coord[2])
        value = degrees + minutes / 60 + seconds / 3600
        if str(ref).upper() in {"S", "W"}:
            value = -value
        return value
    except Exception:
        return None
