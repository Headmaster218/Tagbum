from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi.responses import Response, StreamingResponse


def range_file_response(path: Path, range_header: str | None) -> Response:
    file_size = path.stat().st_size
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'inline; filename="{path.name}"',
    }
    if file_size <= 0:
        headers["Content-Length"] = "0"
        return Response(content=b"", media_type=media_type, headers=headers)

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
        media_type=media_type,
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
