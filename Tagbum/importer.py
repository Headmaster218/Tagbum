from __future__ import annotations

from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session
from tqdm import tqdm

from .db import init_db
from .media import SUPPORTED_EXTENSIONS, build_thumbnail, classify_resource, group_key, read_image_metadata
from .models import AssetGroup, AssetResource


def import_folder(
    source_root: Path,
    session: Session,
    limit: int | None = None,
    commit_every: int = 250,
) -> dict[str, int]:
    init_db()
    source_root = source_root.resolve()
    files = [
        path
        for path in source_root.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    ]
    if limit:
        files = files[:limit]

    created_groups = 0
    created_resources = 0
    updated_resources = 0

    skipped_resources = 0

    for index, path in enumerate(tqdm(files, desc="Importing media", unit="file"), start=1):
        stat = path.stat()
        key = group_key(source_root, path)
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

        kind = classify_resource(path)
        width, height, taken_at, lat, lon = (None, None, None, None, None)
        if kind == "image":
            width, height, taken_at, lat, lon = read_image_metadata(path)
            if group.taken_at is None and taken_at is not None:
                group.taken_at = taken_at
            if group.latitude is None and lat is not None:
                group.latitude = lat
                group.longitude = lon

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
            existing = AssetResource(
                group_id=group.id,
                path=str(path),
                filename=path.name,
                extension=path.suffix.lower(),
                kind=kind,
                size_bytes=stat.st_size,
                mtime=mtime,
                width=width,
                height=height,
            )
            session.add(existing)
            created_resources += 1
        else:
            existing.group_id = group.id
            existing.kind = kind
            existing.size_bytes = stat.st_size
            existing.mtime = mtime
            existing.width = width
            existing.height = height
            updated_resources += 1

        if group.thumbnail_path is None and kind == "image":
            session.flush()
            thumb = build_thumbnail(path, group.id)
            if thumb:
                group.thumbnail_path = str(thumb)

        if index % commit_every == 0:
            session.commit()

    session.commit()
    return {
        "files_seen": len(files),
        "groups_created": created_groups,
        "resources_created": created_resources,
        "resources_updated": updated_resources,
        "resources_skipped": skipped_resources,
    }
