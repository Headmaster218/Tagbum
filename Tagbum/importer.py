from __future__ import annotations

import os
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session
from tqdm import tqdm

from .config import settings
from .db import init_db
from .media import SUPPORTED_EXTENSIONS, build_thumbnail, classify_resource, group_key, read_image_metadata
from .models import AssetGroup, AssetResource


ProgressCallback = Callable[[dict], None]


def default_worker_count() -> int:
    cpu_count = os.cpu_count() or 4
    return max(2, min(32, round(cpu_count * 0.75)))


def import_folder(
    source_root: Path,
    session: Session,
    limit: int | None = None,
    commit_every: int = 250,
    progress_callback: ProgressCallback | None = None,
    workers: int | None = None,
) -> dict[str, int]:
    init_db()
    source_root = source_root.resolve()
    worker_count = max(1, workers or default_worker_count())

    if progress_callback:
        progress_callback({"phase": "discovering", "source": str(source_root), "current": 0, "total": 0})

    files = [
        path
        for path in source_root.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    ]
    if limit:
        files = files[:limit]

    if progress_callback:
        progress_callback(
            {
                "phase": "metadata",
                "source": str(source_root),
                "current": 0,
                "total": len(files),
                "workers": worker_count,
            }
        )

    records = _read_file_records(source_root, files, worker_count, progress_callback)

    created_groups = 0
    created_resources = 0
    updated_resources = 0
    skipped_resources = 0
    thumbnail_jobs: list[tuple[int, Path, Future[Path | None]]] = []

    iterator = records if progress_callback else tqdm(records, desc="Importing media", unit="file")
    with ThreadPoolExecutor(max_workers=worker_count) as thumbnail_executor:
        for index, record in enumerate(iterator, start=1):
            path = record["path"]
            stat = record["stat"]
            key = record["group_key"]
            kind = record["kind"]

            group = session.scalar(select(AssetGroup).where(AssetGroup.group_key == key))
            if group is None:
                group = AssetGroup(
                    group_key=key,
                    display_name=path.stem,
                    source_root=str(source_root),
                    source_dir=str(path.parent),
                    taken_at=None,
                    latitude=None,
                    longitude=None,
                )
                session.add(group)
                session.flush()
                created_groups += 1

            if kind == "image":
                if group.taken_at is None and record["taken_at"] is not None:
                    group.taken_at = record["taken_at"]
                if group.latitude is None and record["lat"] is not None:
                    group.latitude = record["lat"]
                    group.longitude = record["lon"]

            existing = session.scalar(select(AssetResource).where(AssetResource.path == str(path)))
            mtime = datetime.fromtimestamp(stat.st_mtime)
            unchanged = (
                existing is not None
                and existing.size_bytes == stat.st_size
                and existing.mtime == mtime
                and existing.group_id == group.id
            )

            if unchanged:
                skipped_resources += 1
            elif existing is None:
                session.add(
                    AssetResource(
                        group_id=group.id,
                        path=str(path),
                        filename=path.name,
                        extension=path.suffix.lower(),
                        kind=kind,
                        size_bytes=stat.st_size,
                        mtime=mtime,
                        width=record["width"],
                        height=record["height"],
                    )
                )
                created_resources += 1
            else:
                existing.group_id = group.id
                existing.kind = kind
                existing.size_bytes = stat.st_size
                existing.mtime = mtime
                existing.width = record["width"]
                existing.height = record["height"]
                updated_resources += 1

            if group.thumbnail_path is None and kind in {"image", "video"}:
                session.flush()
                target = thumbnail_target(group.id)
                group.thumbnail_path = str(target)
                if not target.exists():
                    thumbnail_jobs.append((group.id, target, thumbnail_executor.submit(build_thumbnail, path, group.id)))

            if progress_callback and (index % 25 == 0 or index == len(records)):
                progress_callback(
                    {"phase": "importing", "source": str(source_root), "current": index, "total": len(records)}
                )

            if index % commit_every == 0:
                session.commit()

        _finalize_thumbnail_jobs(session, thumbnail_jobs, progress_callback, str(source_root))

    session.commit()
    if progress_callback:
        progress_callback({"phase": "done", "source": str(source_root), "current": len(files), "total": len(files)})
    return {
        "files_seen": len(files),
        "groups_created": created_groups,
        "resources_created": created_resources,
        "resources_updated": updated_resources,
        "resources_skipped": skipped_resources,
    }


def _read_file_records(
    source_root: Path,
    files: list[Path],
    workers: int,
    progress_callback: ProgressCallback | None,
) -> list[dict]:
    if not files:
        return []
    if workers <= 1:
        return [_read_file_record(source_root, path) for path in files]

    records: list[dict] = []
    completed = 0
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(_read_file_record, source_root, path) for path in files]
        for future in as_completed(futures):
            records.append(future.result())
            completed += 1
            if progress_callback and (completed % 50 == 0 or completed == len(files)):
                progress_callback(
                    {
                        "phase": "metadata",
                        "source": str(source_root),
                        "current": completed,
                        "total": len(files),
                        "workers": workers,
                    }
                )
    records.sort(key=lambda item: str(item["path"]))
    return records


def _read_file_record(source_root: Path, path: Path) -> dict:
    stat = path.stat()
    kind = classify_resource(path)
    width, height, taken_at, lat, lon = (None, None, None, None, None)
    if kind == "image":
        width, height, taken_at, lat, lon = read_image_metadata(path)
    return {
        "path": path,
        "stat": stat,
        "group_key": group_key(source_root, path),
        "kind": kind,
        "width": width,
        "height": height,
        "taken_at": taken_at,
        "lat": lat,
        "lon": lon,
    }


def _finalize_thumbnail_jobs(
    session: Session,
    thumbnail_jobs: list[tuple[int, Path, Future[Path | None]]],
    progress_callback: ProgressCallback | None,
    source: str,
) -> None:
    total = len(thumbnail_jobs)
    for index, (group_id, target, future) in enumerate(thumbnail_jobs, start=1):
        thumb = future.result()
        if thumb is None:
            group = session.get(AssetGroup, group_id)
            if group is not None and group.thumbnail_path == str(target):
                group.thumbnail_path = None
        if progress_callback and (index % 25 == 0 or index == total):
            progress_callback({"phase": "thumbnails", "source": source, "current": index, "total": total})


def thumbnail_target(group_id: int) -> Path:
    return settings.thumbnail_dir / f"{group_id}.jpg"
