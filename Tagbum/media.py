from __future__ import annotations

from io import BytesIO
import json
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


def read_image_metadata(path: Path) -> tuple[int | None, int | None, datetime | None, float | None, float | None, dict]:
    try:
        with Image.open(path) as image:
            width, height = image.size
            exif = image.getexif()
            taken_at = _read_taken_at(exif)
            lat, lon = _read_gps(exif)
            metadata = _read_exif_metadata(exif)
            metadata["width"] = width
            metadata["height"] = height
            if taken_at is not None:
                metadata.setdefault("DateTimeOriginal", taken_at.isoformat(sep=" ", timespec="seconds"))
            if lat is not None and lon is not None:
                metadata["GPSLatitude"] = lat
                metadata["GPSLongitude"] = lon
            return width, height, taken_at, lat, lon, metadata
    except Exception:
        return None, None, None, None, None, {}


def metadata_json_for_resource(path: Path, kind: str) -> str | None:
    if kind == "image":
        _, _, _, _, _, metadata = read_image_metadata(path)
        return json.dumps(metadata, ensure_ascii=False, sort_keys=True) if metadata else None
    try:
        stat = path.stat()
    except OSError:
        return None
    metadata = {
        "Path": str(path),
        "FileName": path.name,
        "Extension": path.suffix.lower(),
        "SizeBytes": stat.st_size,
        "ModifiedAt": datetime.fromtimestamp(stat.st_mtime).isoformat(sep=" ", timespec="seconds"),
    }
    return json.dumps(metadata, ensure_ascii=False, sort_keys=True)


def build_thumbnail(source: Path, group_id: int) -> Path | None:
    if source.suffix.lower() in IMAGE_EXTENSIONS:
        return build_image_thumbnail(source, group_id)
    if source.suffix.lower() in VIDEO_EXTENSIONS:
        return build_video_thumbnail(source, group_id)
    return None


def build_image_thumbnail(source: Path, group_id: int) -> Path | None:
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


def build_video_thumbnail(source: Path, group_id: int) -> Path | None:
    if source.suffix.lower() not in VIDEO_EXTENSIONS:
        return None
    target = settings.thumbnail_dir / f"{group_id}.jpg"
    if target.exists():
        return target
    try:
        import cv2

        settings.thumbnail_dir.mkdir(parents=True, exist_ok=True)
        capture = cv2.VideoCapture(str(source))
        if not capture.isOpened():
            return None
        frame = None
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = capture.get(cv2.CAP_PROP_FPS) or 0
        positions = [0]
        if fps > 0:
            positions.extend([int(fps), int(fps * 2)])
        if frame_count > 0:
            positions.append(frame_count // 2)
        for position in positions:
            capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, position))
            ok, candidate = capture.read()
            if ok and candidate is not None:
                frame = candidate
                break
        capture.release()
        if frame is None:
            return None
        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        image.thumbnail((settings.thumbnail_size, settings.thumbnail_size))
        image.save(target, "JPEG", quality=86, optimize=True)
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


def _read_exif_metadata(exif) -> dict:
    if not exif:
        return {}
    metadata: dict[str, str | int | float | list | dict] = {}
    for tag_id, raw_value in exif.items():
        tag_name = TAGS.get(tag_id, str(tag_id))
        if tag_name == "GPSInfo":
            continue
        if tag_name == "MakerNote":
            metadata[tag_name] = "<binary>"
            continue
        metadata[tag_name] = _normalize_exif_value(raw_value)
    return metadata


def _normalize_exif_value(value):
    if isinstance(value, bytes):
        return f"<{len(value)} bytes>"
    if isinstance(value, str):
        return value.strip("\x00")
    if isinstance(value, (int, float, bool)):
        return value
    if hasattr(value, "numerator") and hasattr(value, "denominator"):
        denominator = getattr(value, "denominator", 1) or 1
        numerator = getattr(value, "numerator", 0)
        if denominator == 1:
            return numerator
        return round(float(numerator) / float(denominator), 6)
    if isinstance(value, (list, tuple)):
        return [_normalize_exif_value(item) for item in value]
    try:
        return str(value)
    except Exception:
        return "<unsupported>"


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
