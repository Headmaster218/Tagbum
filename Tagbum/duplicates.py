from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import hashlib
from pathlib import Path
import shutil
import sqlite3
import threading

from PIL import Image, ImageOps
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .importer import default_worker_count
from .models import AssetGroup, AssetResource


ProgressCallback = Callable[[dict], None]
_cache_lock = threading.Lock()


def cache_path() -> Path:
    return (settings.config_path.parent / "data" / "duplicate_cache.sqlite").resolve()


def quarantine_root() -> Path:
    return (settings.config_path.parent / "data" / "duplicate_quarantine").resolve()


def profile_cache_key() -> str:
    return str(settings.active_profile.database.resolve())


def init_duplicate_cache() -> None:
    path = cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS image_duplicate_cache (
                profile_key TEXT NOT NULL,
                resource_id INTEGER NOT NULL,
                path TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                mtime TEXT NOT NULL,
                file_sha256 TEXT,
                pixel_sha256 TEXT,
                width INTEGER,
                height INTEGER,
                error TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (profile_key, resource_id)
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_duplicate_cache_exact
            ON image_duplicate_cache (profile_key, file_sha256)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_duplicate_cache_pixels
            ON image_duplicate_cache (profile_key, pixel_sha256)
            """
        )
        connection.commit()


def scan_duplicates(session: Session, progress_callback: ProgressCallback | None = None, workers: int | None = None) -> dict:
    init_duplicate_cache()
    profile_key = profile_cache_key()
    worker_count = max(1, workers or default_worker_count())
    resources = list(
        session.scalars(
            select(AssetResource)
            .where(AssetResource.kind == "image")
            .order_by(AssetResource.id)
        )
    )
    cached = _load_cache_index(profile_key)
    current_ids = {resource.id for resource in resources}
    stale_ids = [resource_id for resource_id in cached if resource_id not in current_ids]
    if stale_ids:
        _delete_cached_resources(profile_key, stale_ids)

    pending: list[dict] = []
    for resource in resources:
        path = Path(resource.path)
        signature = (
            str(path),
            int(resource.size_bytes),
            resource.mtime.isoformat(timespec="seconds"),
        )
        cached_row = cached.get(resource.id)
        if cached_row is None or cached_row["signature"] != signature:
            pending.append(
                {
                    "resource_id": resource.id,
                    "path": path,
                    "size_bytes": int(resource.size_bytes),
                    "mtime": resource.mtime,
                }
            )

    if progress_callback:
        progress_callback(
            {
                "phase": "hashing",
                "current": 0,
                "total": len(pending),
                "cached": len(resources) - len(pending),
                "workers": worker_count,
            }
        )

    rows: list[dict] = []
    if pending:
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(_hash_resource, item) for item in pending]
            completed = 0
            for future in as_completed(futures):
                rows.append(future.result())
                completed += 1
                if progress_callback and (completed % 25 == 0 or completed == len(pending)):
                    progress_callback(
                        {
                            "phase": "hashing",
                            "current": completed,
                            "total": len(pending),
                            "cached": len(resources) - len(pending),
                            "workers": worker_count,
                        }
                    )
        _upsert_cache_rows(profile_key, rows)

    summary = duplicate_summary(profile_key)
    if progress_callback:
        progress_callback(
            {
                "phase": "done",
                "current": len(resources),
                "total": len(resources),
                "cached": len(resources) - len(pending),
                **summary,
            }
        )
    return {
        "images": len(resources),
        "rehashed": len(pending),
        **summary,
    }


def duplicate_summary(profile_key: str | None = None) -> dict:
    init_duplicate_cache()
    key = profile_key or profile_cache_key()
    with sqlite3.connect(cache_path()) as connection:
        exact_sets = connection.execute(
            """
            SELECT COUNT(*)
            FROM (
                SELECT file_sha256
                FROM image_duplicate_cache
                WHERE profile_key = ? AND file_sha256 IS NOT NULL AND file_sha256 != ''
                GROUP BY file_sha256
                HAVING COUNT(*) > 1
            )
            """,
            (key,),
        ).fetchone()[0]
        content_sets = connection.execute(
            """
            SELECT COUNT(*)
            FROM (
                SELECT pixel_sha256
                FROM image_duplicate_cache
                WHERE profile_key = ? AND pixel_sha256 IS NOT NULL AND pixel_sha256 != ''
                GROUP BY pixel_sha256
                HAVING COUNT(*) > 1 AND COUNT(DISTINCT file_sha256) > 1
            )
            """,
            (key,),
        ).fetchone()[0]
        exact_files = connection.execute(
            """
            SELECT COALESCE(SUM(file_count), 0)
            FROM (
                SELECT COUNT(*) AS file_count
                FROM image_duplicate_cache
                WHERE profile_key = ? AND file_sha256 IS NOT NULL AND file_sha256 != ''
                GROUP BY file_sha256
                HAVING COUNT(*) > 1
            )
            """,
            (key,),
        ).fetchone()[0]
        content_files = connection.execute(
            """
            SELECT COALESCE(SUM(file_count), 0)
            FROM (
                SELECT COUNT(*) AS file_count
                FROM image_duplicate_cache
                WHERE profile_key = ? AND pixel_sha256 IS NOT NULL AND pixel_sha256 != ''
                GROUP BY pixel_sha256
                HAVING COUNT(*) > 1 AND COUNT(DISTINCT file_sha256) > 1
            )
            """,
            (key,),
        ).fetchone()[0]
    return {
        "exact_sets": int(exact_sets or 0),
        "content_sets": int(content_sets or 0),
        "exact_files": int(exact_files or 0),
        "content_files": int(content_files or 0),
    }


def list_exact_duplicate_sets(session: Session, page: int = 1, page_size: int = 20) -> tuple[list[dict], int]:
    return _list_duplicate_sets(session, mode="exact", page=page, page_size=page_size)


def list_exact_duplicate_signatures() -> list[str]:
    init_duplicate_cache()
    profile_key = profile_cache_key()
    with sqlite3.connect(cache_path()) as connection:
        rows = connection.execute(
            """
            SELECT file_sha256
            FROM image_duplicate_cache
            WHERE profile_key = ? AND file_sha256 IS NOT NULL AND file_sha256 != ''
            GROUP BY file_sha256
            HAVING COUNT(*) > 1
            ORDER BY COUNT(*) DESC, MIN(path)
            """,
            (profile_key,),
        ).fetchall()
    return [str(row[0]) for row in rows if row[0]]


def list_content_duplicate_sets(session: Session, page: int = 1, page_size: int = 20) -> tuple[list[dict], int]:
    return _list_duplicate_sets(session, mode="content", page=page, page_size=page_size)


def quarantine_exact_keep_one(session: Session, signature: str, keep_resource_id: int | None = None) -> dict:
    rows = _duplicate_rows_for_signature(profile_cache_key(), "exact", signature)
    if len(rows) < 2:
        return {"moved": 0, "kept": keep_resource_id, "mode": "noop"}
    items = _hydrate_duplicate_items(session, rows)
    known_hashes = {int(row["resource_id"]): str(row.get("file_sha256") or "") for row in rows}
    plain_items = [item for item in items if not item["has_companions"]]
    companion_items = [item for item in items if item["has_companions"]]
    if companion_items and _groups_have_identical_bundles(session, items, known_hashes):
        keep_group_id = _earliest_group_id(session, items)
        if keep_group_id is not None:
            to_move_group_ids = {int(item["group_id"]) for item in items if int(item["group_id"]) != keep_group_id}
            moved = 0
            for group_id in sorted(to_move_group_ids):
                moved += quarantine_group(session, group_id)
            kept = [int(item["resource_id"]) for item in items if int(item["group_id"]) == keep_group_id]
            return {"moved": moved, "kept": kept, "mode": "keep_earliest_group"}
    if companion_items:
        to_move_ids = {int(item["resource_id"]) for item in plain_items}
        kept = [int(item["resource_id"]) for item in companion_items]
        mode = "remove_plain_only"
    else:
        default_keep_id = int(items[0]["resource_id"])
        keep_id = keep_resource_id if any(int(item["resource_id"]) == int(keep_resource_id or -1) for item in items) else default_keep_id
        to_move_ids = {int(item["resource_id"]) for item in items if int(item["resource_id"]) != keep_id}
        kept = [keep_id]
        mode = "keep_selected"
    moved = 0
    for item in items:
        if int(item["resource_id"]) not in to_move_ids:
            continue
        if quarantine_resource(session, item["resource_id"]):
            moved += 1
    return {"moved": moved, "kept": kept, "mode": mode}


def quarantine_resource(session: Session, resource_id: int) -> bool:
    resource = session.get(AssetResource, resource_id)
    if resource is None:
        return False
    source = Path(resource.path)
    if not source.exists():
        _delete_cached_resources(profile_cache_key(), [resource_id])
        _remove_resource_from_database(session, resource)
        return False
    target = _quarantine_target(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))
    _delete_cached_resources(profile_cache_key(), [resource_id])
    _remove_resource_from_database(session, resource)
    return True


def quarantine_group(session: Session, group_id: int) -> int:
    group = session.get(AssetGroup, group_id)
    if group is None:
        return 0
    resource_ids = [int(resource.id) for resource in group.resources]
    moved = 0
    for resource_id in resource_ids:
        if quarantine_resource(session, resource_id):
            moved += 1
    return moved


def _remove_resource_from_database(session: Session, resource: AssetResource) -> None:
    group = session.get(AssetGroup, resource.group_id)
    if group is None:
        session.delete(resource)
        session.commit()
        return
    session.delete(resource)
    session.flush()
    remaining_count = session.scalar(
        select(func.count(AssetResource.id)).where(AssetResource.group_id == group.id)
    ) or 0
    if remaining_count == 0:
        if group.thumbnail_path:
            thumb = Path(group.thumbnail_path)
            if thumb.exists():
                thumb.unlink(missing_ok=True)
        session.delete(group)
    session.commit()


def _duplicate_rows_for_signature(profile_key: str, mode: str, signature: str) -> list[dict]:
    init_duplicate_cache()
    if mode not in {"exact", "content"}:
        return []
    column = "file_sha256" if mode == "exact" else "pixel_sha256"
    with sqlite3.connect(cache_path()) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            f"""
            SELECT resource_id, path, size_bytes, mtime, file_sha256, pixel_sha256, width, height
            FROM image_duplicate_cache
            WHERE profile_key = ? AND {column} = ?
            ORDER BY path
            """,
            (profile_key, signature),
        ).fetchall()
    return [dict(row) for row in rows]


def _list_duplicate_sets(session: Session, mode: str, page: int, page_size: int) -> tuple[list[dict], int]:
    init_duplicate_cache()
    profile_key = profile_cache_key()
    safe_page = max(1, page)
    safe_size = max(1, min(page_size, 50))
    offset = (safe_page - 1) * safe_size
    if mode == "exact":
        signature_sql = """
            SELECT file_sha256 AS signature, COUNT(*) AS file_count
            FROM image_duplicate_cache
            WHERE profile_key = ? AND file_sha256 IS NOT NULL AND file_sha256 != ''
            GROUP BY file_sha256
            HAVING COUNT(*) > 1
            ORDER BY file_count DESC, MIN(path)
            LIMIT ? OFFSET ?
        """
        total_sql = """
            SELECT COUNT(*)
            FROM (
                SELECT file_sha256
                FROM image_duplicate_cache
                WHERE profile_key = ? AND file_sha256 IS NOT NULL AND file_sha256 != ''
                GROUP BY file_sha256
                HAVING COUNT(*) > 1
            )
        """
    else:
        signature_sql = """
            SELECT pixel_sha256 AS signature, COUNT(*) AS file_count
            FROM image_duplicate_cache
            WHERE profile_key = ? AND pixel_sha256 IS NOT NULL AND pixel_sha256 != ''
            GROUP BY pixel_sha256
            HAVING COUNT(*) > 1 AND COUNT(DISTINCT file_sha256) > 1
            ORDER BY file_count DESC, MIN(path)
            LIMIT ? OFFSET ?
        """
        total_sql = """
            SELECT COUNT(*)
            FROM (
                SELECT pixel_sha256
                FROM image_duplicate_cache
                WHERE profile_key = ? AND pixel_sha256 IS NOT NULL AND pixel_sha256 != ''
                GROUP BY pixel_sha256
                HAVING COUNT(*) > 1 AND COUNT(DISTINCT file_sha256) > 1
            )
        """
    with sqlite3.connect(cache_path()) as connection:
        connection.row_factory = sqlite3.Row
        total = int(connection.execute(total_sql, (profile_key,)).fetchone()[0] or 0)
        signatures = connection.execute(signature_sql, (profile_key, safe_size, offset)).fetchall()
    sets = []
    for row in signatures:
        items = _duplicate_rows_for_signature(profile_key, mode, row["signature"])
        hydrated_items = _hydrate_duplicate_items(session, items)
        known_hashes = {int(item["resource_id"]): str(item.get("file_sha256") or "") for item in items}
        can_reduce_with_companions = (
            mode == "exact"
            and any(item["has_companions"] for item in hydrated_items)
            and _groups_have_identical_bundles(session, hydrated_items, known_hashes)
        )
        sets.append(
            {
                "signature": row["signature"],
                "count": row["file_count"],
                "items": hydrated_items,
                "has_companions": any(item["has_companions"] for item in hydrated_items),
                "plain_count": sum(1 for item in hydrated_items if not item["has_companions"]),
                "companion_count": sum(1 for item in hydrated_items if item["has_companions"]),
                "can_reduce_with_companions": can_reduce_with_companions,
            }
        )
    return sets, total


def _hydrate_duplicate_items(session: Session, rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    resource_ids = [int(row["resource_id"]) for row in rows]
    resources = list(
        session.scalars(
            select(AssetResource)
            .where(AssetResource.id.in_(resource_ids))
        )
    )
    resource_map = {resource.id: resource for resource in resources}
    group_ids = sorted({resource.group_id for resource in resources})
    groups = list(
        session.scalars(
            select(AssetGroup)
            .where(AssetGroup.id.in_(group_ids))
        )
    )
    group_map = {group.id: group for group in groups}
    payload = []
    for row in rows:
        resource = resource_map.get(int(row["resource_id"]))
        if resource is None:
            continue
        group = group_map.get(resource.group_id)
        payload.append(
            {
                "resource_id": resource.id,
                "group_id": resource.group_id,
                "group_name": group.display_name if group else resource.filename,
                "thumbnail_url": f"/thumbs/{resource.group_id}.jpg" if group and group.thumbnail_path else None,
                "taken_at": group.taken_at.isoformat() if group and group.taken_at else None,
                "path": resource.path,
                "filename": resource.filename,
                "extension": resource.extension,
                "size_bytes": int(resource.size_bytes),
                "mtime": resource.mtime.isoformat(timespec="seconds"),
                "width": resource.width,
                "height": resource.height,
                "url": f"/media/{resource.id}",
                "file_sha256": row.get("file_sha256") or "",
                "pixel_sha256": row.get("pixel_sha256") or "",
                "companion_kinds": _group_companion_kinds(group) if group else [],
                "has_companions": bool(_group_companion_kinds(group)) if group else False,
                "group_first_mtime": _group_first_mtime(group).isoformat(timespec="seconds") if group else resource.mtime.isoformat(timespec="seconds"),
            }
        )
    payload.sort(key=lambda item: (item["group_first_mtime"], int(item["group_id"]), int(item["resource_id"])))
    return payload


def _group_companion_kinds(group: AssetGroup | None) -> list[str]:
    if group is None:
        return []
    has_image = any(resource.kind == "image" for resource in group.resources)
    labels: list[str] = []
    for resource in group.resources:
        if resource.kind == "image":
            continue
        if resource.kind == "video" and has_image:
            labels.append("live")
        elif resource.kind == "sidecar" and resource.extension == ".aae":
            labels.append("edited")
        else:
            labels.append(resource.kind)
    return sorted(set(labels))


def _group_first_mtime(group: AssetGroup | None) -> datetime:
    if group is None or not group.resources:
        return datetime.max
    return min(resource.mtime for resource in group.resources if resource.mtime is not None)


def _earliest_group_id(session: Session, items: list[dict]) -> int | None:
    group_ids = sorted({int(item["group_id"]) for item in items})
    groups = list(session.scalars(select(AssetGroup).where(AssetGroup.id.in_(group_ids))))
    if not groups:
        return None
    earliest = min(groups, key=lambda group: (_group_first_mtime(group), int(group.id)))
    return int(earliest.id)


def _groups_have_identical_bundles(session: Session, items: list[dict], known_hashes: dict[int, str]) -> bool:
    group_ids = sorted({int(item["group_id"]) for item in items})
    if len(group_ids) < 2:
        return False
    groups = list(session.scalars(select(AssetGroup).where(AssetGroup.id.in_(group_ids))))
    signatures = {_group_bundle_signature(group, known_hashes) for group in groups}
    return len(signatures) == 1


def _group_bundle_signature(group: AssetGroup, known_hashes: dict[int, str]) -> tuple[tuple[str, str, int, str], ...]:
    parts: list[tuple[str, str, int, str]] = []
    for resource in group.resources:
        file_hash = known_hashes.get(int(resource.id)) or _resource_sha256(Path(resource.path))
        parts.append((resource.kind, resource.extension, int(resource.size_bytes), file_hash))
    parts.sort()
    return tuple(parts)


def _resource_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return f"missing:{path}"


def _load_cache_index(profile_key: str) -> dict[int, dict]:
    init_duplicate_cache()
    with sqlite3.connect(cache_path()) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT resource_id, path, size_bytes, mtime
            FROM image_duplicate_cache
            WHERE profile_key = ?
            """,
            (profile_key,),
        ).fetchall()
    return {
        int(row["resource_id"]): {
            "signature": (row["path"], int(row["size_bytes"]), row["mtime"]),
        }
        for row in rows
    }


def _upsert_cache_rows(profile_key: str, rows: list[dict]) -> None:
    if not rows:
        return
    with _cache_lock:
        with sqlite3.connect(cache_path()) as connection:
            connection.executemany(
                """
                INSERT INTO image_duplicate_cache (
                    profile_key, resource_id, path, size_bytes, mtime,
                    file_sha256, pixel_sha256, width, height, error, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(profile_key, resource_id) DO UPDATE SET
                    path = excluded.path,
                    size_bytes = excluded.size_bytes,
                    mtime = excluded.mtime,
                    file_sha256 = excluded.file_sha256,
                    pixel_sha256 = excluded.pixel_sha256,
                    width = excluded.width,
                    height = excluded.height,
                    error = excluded.error,
                    updated_at = excluded.updated_at
                """,
                [
                    (
                        profile_key,
                        row["resource_id"],
                        row["path"],
                        row["size_bytes"],
                        row["mtime"],
                        row["file_sha256"],
                        row["pixel_sha256"],
                        row["width"],
                        row["height"],
                        row["error"],
                        row["updated_at"],
                    )
                    for row in rows
                ],
            )
            connection.commit()


def _delete_cached_resources(profile_key: str, resource_ids: list[int]) -> None:
    if not resource_ids:
        return
    placeholders = ", ".join("?" for _ in resource_ids)
    with _cache_lock:
        with sqlite3.connect(cache_path()) as connection:
            connection.execute(
                f"DELETE FROM image_duplicate_cache WHERE profile_key = ? AND resource_id IN ({placeholders})",
                [profile_key, *resource_ids],
            )
            connection.commit()


def _hash_resource(item: dict) -> dict:
    path = Path(item["path"])
    now = datetime.now().isoformat(timespec="seconds")
    if not path.exists():
        return {
            "resource_id": item["resource_id"],
            "path": str(path),
            "size_bytes": item["size_bytes"],
            "mtime": item["mtime"].isoformat(timespec="seconds"),
            "file_sha256": "",
            "pixel_sha256": "",
            "width": None,
            "height": None,
            "error": "missing",
            "updated_at": now,
        }
    try:
        file_sha256 = _file_sha256(path)
        pixel_sha256, width, height = _pixel_sha256(path)
        return {
            "resource_id": item["resource_id"],
            "path": str(path),
            "size_bytes": item["size_bytes"],
            "mtime": item["mtime"].isoformat(timespec="seconds"),
            "file_sha256": file_sha256,
            "pixel_sha256": pixel_sha256,
            "width": width,
            "height": height,
            "error": "",
            "updated_at": now,
        }
    except Exception as exc:
        return {
            "resource_id": item["resource_id"],
            "path": str(path),
            "size_bytes": item["size_bytes"],
            "mtime": item["mtime"].isoformat(timespec="seconds"),
            "file_sha256": "",
            "pixel_sha256": "",
            "width": None,
            "height": None,
            "error": str(exc),
            "updated_at": now,
        }


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _pixel_sha256(path: Path) -> tuple[str, int, int]:
    with Image.open(path) as image:
        normalized = ImageOps.exif_transpose(image)
        if normalized.mode not in {"RGB", "RGBA"}:
            normalized = normalized.convert("RGBA" if "A" in normalized.getbands() else "RGB")
        size = normalized.size
        digest = hashlib.sha256()
        digest.update(f"{normalized.mode}:{size[0]}x{size[1]}".encode("utf-8"))
        digest.update(normalized.tobytes())
        return digest.hexdigest(), size[0], size[1]


def _quarantine_target(source: Path) -> Path:
    root = quarantine_root()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_drive = source.drive.replace(":", "") if source.drive else "root"
    relative = [safe_drive] + [part.replace(":", "_") for part in source.parts[1:]]
    target = root / stamp
    for part in relative:
        target /= part
    if target.exists():
        target = target.with_name(f"{target.stem}-{datetime.now().strftime('%H%M%S%f')}{target.suffix}")
    return target
