from __future__ import annotations

import mimetypes
import subprocess
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import Response, StreamingResponse

from ...config import settings


WEB_NATIVE_VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm"}


def is_web_native_video(path: Path) -> bool:
    return path.suffix.lower() in WEB_NATIVE_VIDEO_EXTENSIONS


def cached_video_stream_path(source: Path, resource_id: int) -> Path:
    stat = source.stat()
    stamp = f"{int(stat.st_mtime)}-{stat.st_size}"
    return settings.video_cache_dir / f"{resource_id}-{stamp}.mp4"


def transcode_video_for_web(source: Path, resource_id: int) -> Path:
    if not source.exists():
        raise HTTPException(status_code=404, detail="File missing")
    target = cached_video_stream_path(source, resource_id)
    if target.exists() and target.stat().st_size > 0:
        return target
    settings.video_cache_dir.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(source),
        "-movflags",
        "+faststart",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        str(target),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0 or not target.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Video transcode failed: {(result.stderr or result.stdout).strip()[:300]}",
        )
    return target


def playable_video_path(source: Path, resource_id: int) -> Path:
    if is_web_native_video(source):
        return source
    return transcode_video_for_web(source, resource_id)


def range_file_response(path: Path, range_header: str | None, media_type: str | None = None) -> Response:
    file_size = path.stat().st_size
    guessed_type = media_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'inline; filename="{path.name}"',
    }
    if file_size <= 0:
        headers["Content-Length"] = "0"
        return Response(content=b"", media_type=guessed_type, headers=headers)

    start = 0
    end = file_size - 1
    status_code = 200
    if range_header:
        byte_range = range_header.strip().lower()
        if not byte_range.startswith("bytes=") or "," in byte_range:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}", "Accept-Ranges": "bytes"})
        raw_start, _, raw_end = byte_range[6:].partition("-")
        try:
            if raw_start:
                start = int(raw_start)
                end = int(raw_end) if raw_end else file_size - 1
            else:
                suffix_length = int(raw_end)
                start = max(0, file_size - suffix_length)
                end = file_size - 1
        except ValueError:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}", "Accept-Ranges": "bytes"})
        if start < 0 or end < start or start >= file_size:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}", "Accept-Ranges": "bytes"})
        end = min(end, file_size - 1)
        status_code = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    content_length = end - start + 1
    headers["Content-Length"] = str(content_length)
    return StreamingResponse(
        iter_file_range(path, start, content_length),
        status_code=status_code,
        media_type=guessed_type,
        headers=headers,
    )


def iter_file_range(path: Path, start: int, length: int):
    chunk_size = 1024 * 1024
    remaining = length
    with path.open("rb") as handle:
        handle.seek(start)
        while remaining > 0:
            chunk = handle.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
