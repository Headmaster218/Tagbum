from __future__ import annotations

from pathlib import Path
import shutil

from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import RedirectResponse

from ...config import settings
from ...db import configure_database, dispose_database, init_db
from ..services.settings import active_database_exists, default_database_path, delete_sqlite_files, pick_windows_folder
from ..state import scan_status
from ..tasks.album_scan import start_album_scan


router = APIRouter()


@router.post("/settings/map")
def update_map_settings(map_tile_provider: str = Form(...)):
    try:
        settings.set_map_tile_provider(map_tile_provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RedirectResponse(url="/settings", status_code=303)


@router.post("/settings/profiles/{profile_name}/use")
def use_profile(profile_name: str):
    try:
        configure_database(profile_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if active_database_exists():
        init_db()
        start_album_scan()
    return RedirectResponse(url="/settings", status_code=303)


@router.post("/settings/profiles")
def create_profile(
    name: str = Form(...),
    database: str = Form(""),
    albums: str = Form(""),
    activate: bool = Form(False),
):
    cleaned = name.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="profile 名称不能为空")
    album_paths = [line.strip() for line in albums.splitlines() if line.strip()]
    database_path = Path(database).expanduser() if database.strip() else default_database_path(cleaned)
    settings.upsert_profile(
        cleaned,
        database=database_path,
        albums=[Path(item).expanduser() for item in album_paths],
    )
    if activate:
        configure_database(cleaned)
        init_db()
        start_album_scan()
    return RedirectResponse(url="/settings", status_code=303)


@router.post("/settings/profiles/{profile_name}/move-db")
def move_profile_database(profile_name: str, destination: str = Form(...), overwrite: bool = Form(False)):
    try:
        profile = settings.get_profile(profile_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    target = Path(destination).expanduser().resolve()
    if target.exists() and not overwrite:
        raise HTTPException(status_code=400, detail="目标数据库已存在。勾选覆盖或换一个路径。")
    if not profile.database.exists():
        raise HTTPException(status_code=404, detail=f"数据库不存在: {profile.database}")
    target.parent.mkdir(parents=True, exist_ok=True)
    was_active = profile_name == settings.active_profile_name
    if was_active:
        dispose_database()
    shutil.move(str(profile.database), str(target))
    settings.upsert_profile(
        profile_name,
        database=target,
        albums=[str(path) for path in profile.albums],
        thumbnail_dir=profile.thumbnail_dir,
    )
    if was_active:
        configure_database(profile_name)
        init_db()
    return RedirectResponse(url="/settings", status_code=303)


@router.post("/settings/profiles/{profile_name}/delete-db")
def delete_profile_database(profile_name: str, confirm_name: str = Form(...)):
    try:
        profile = settings.get_profile(profile_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if confirm_name.strip() != profile_name:
        raise HTTPException(status_code=400, detail="确认名称不匹配，未删除数据库。")
    if scan_status.get("running") and scan_status.get("profile") == profile_name:
        raise HTTPException(status_code=400, detail="当前数据库正在扫描。请等待扫描完成后再删除。")
    was_active = profile_name == settings.active_profile_name
    if was_active:
        dispose_database()
    try:
        delete_sqlite_files(profile.database)
        settings.remove_profile(profile_name)
        if was_active and settings.active_profile_name and active_database_exists():
            configure_database(settings.active_profile_name)
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail="数据库文件正在被占用，请稍后再试。") from exc
    return RedirectResponse(url="/settings", status_code=303)


@router.post("/settings/scan")
def scan_albums_now():
    start_album_scan(force=True, allow_create=True)
    return RedirectResponse(url="/settings", status_code=303)


@router.post("/settings/init-db")
def init_active_database():
    if not settings.profile_names:
        return RedirectResponse(url="/settings?missing_db=1", status_code=303)
    init_db()
    return RedirectResponse(url="/settings", status_code=303)


@router.get("/api/settings/default-database")
def api_default_database(name: str) -> dict:
    return {"database": str(default_database_path(name.strip()))}


@router.post("/api/settings/pick-folder")
def api_pick_folder() -> dict:
    return {"path": pick_windows_folder()}


@router.get("/api/settings/scan-status")
def api_scan_status() -> dict:
    return scan_status.copy()
