from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from ...config import NoActiveProfile, settings
from ...db import dispose_database


def should_bypass_database_check(path: str) -> bool:
    return (
        path == "/settings"
        or path.startswith("/settings/")
        or path.startswith("/api/settings/")
        or path.startswith("/static/")
        or path == "/favicon.ico"
    )


def active_database_exists() -> bool:
    if settings.database_url:
        return True
    try:
        return settings.active_profile.database.exists()
    except (KeyError, NoActiveProfile):
        return False


def delete_sqlite_files(database: Path) -> None:
    for path in [
        database,
        Path(f"{database}-wal"),
        Path(f"{database}-shm"),
        Path(f"{database}-journal"),
    ]:
        if path.exists():
            path.unlink()


def default_database_path(name: str) -> Path:
    safe_name = "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in name).strip("_")
    if not safe_name:
        safe_name = "tagbum"
    return (settings.config_path.parent / "data" / f"{safe_name}.sqlite").resolve()


def pick_windows_folder() -> str:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=501, detail=f"当前环境无法打开文件夹选择器: {exc}") from exc

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        folder = filedialog.askdirectory(title="选择相册目录")
    finally:
        root.destroy()
    return folder or ""


def profile_payload(profile) -> dict:
    return {
        "name": profile.name,
        "active": profile.name == settings.active_profile_name,
        "database": profile.database,
        "database_exists": profile.database.exists(),
        "albums": [{"path": path, "exists": path.exists()} for path in profile.albums],
        "thumbnail_dir": profile.thumbnail_dir or profile.database.parent / f"{profile.database.stem}_thumbnails",
    }
