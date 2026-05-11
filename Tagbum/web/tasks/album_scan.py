from __future__ import annotations

from datetime import datetime
from pathlib import Path
from threading import Thread

from ...config import NoActiveProfile, settings
from ...db import SessionLocal, configure_database, init_db
from ...importer import import_folder
from ..services.settings import active_database_exists
from ..state import scan_lock, scan_status


def start_album_scan(force: bool = False, allow_create: bool = False) -> None:
    if scan_lock.locked() and not force:
        return
    if not settings.profile_names:
        scan_status.update(
            {
                "running": False,
                "profile": "",
                "message": "还没有数据库，请先在设置页新增 profile 并导入相册。",
                "started_at": None,
                "finished_at": datetime.now().isoformat(timespec="seconds"),
                "current_album": "",
                "current": 0,
                "total": 0,
                "percent": 0,
                "stats": [],
            }
        )
        return
    profile_name = settings.active_profile_name
    try:
        albums = list(settings.album_paths)
    except NoActiveProfile:
        albums = []
    if not active_database_exists() and not allow_create:
        scan_status.update(
            {
                "running": False,
                "profile": profile_name,
                "message": "当前 profile 没有可用数据库。",
                "started_at": None,
                "finished_at": datetime.now().isoformat(timespec="seconds"),
                "current_album": "",
                "current": 0,
                "total": 0,
                "percent": 0,
                "stats": [],
            }
        )
        return
    if not albums:
        scan_status.update(
            {
                "running": False,
                "profile": profile_name,
                "message": "当前 profile 没有配置相册目录。",
                "started_at": None,
                "finished_at": datetime.now().isoformat(timespec="seconds"),
                "current_album": "",
                "current": 0,
                "total": 0,
                "percent": 0,
                "stats": [],
            }
        )
        return
    Thread(target=_scan_albums_worker, args=(profile_name, albums), daemon=True).start()


def _scan_albums_worker(profile_name: str, albums: list[Path]) -> None:
    if not scan_lock.acquire(blocking=False):
        return
    scan_status.update(
        {
            "running": True,
            "profile": profile_name,
            "message": "正在检测相册变化",
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "finished_at": None,
            "current_album": "",
            "current": 0,
            "total": 0,
            "percent": 0,
            "stats": [],
        }
    )
    try:
        configure_database(profile_name)
        init_db()
        all_stats = []
        with SessionLocal() as session:
            for album in albums:
                if not album.exists():
                    all_stats.append({"album": str(album), "error": "目录不存在"})
                    continue
                stats = import_folder(album, session, commit_every=250, progress_callback=scan_progress_callback)
                all_stats.append({"album": str(album), **stats})
        scan_status.update(
            {
                "running": False,
                "message": "相册检测完成",
                "finished_at": datetime.now().isoformat(timespec="seconds"),
                "current_album": "",
                "current": scan_status.get("total", 0),
                "percent": 100,
                "stats": all_stats,
            }
        )
    except Exception as exc:  # noqa: BLE001
        scan_status.update(
            {
                "running": False,
                "message": f"相册检测失败: {exc}",
                "finished_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
    finally:
        scan_lock.release()


def scan_progress_callback(progress: dict) -> None:
    current = int(progress.get("current") or 0)
    total = int(progress.get("total") or 0)
    phase = progress.get("phase")
    source = str(progress.get("source") or "")
    if phase == "discovering":
        message = "正在枚举相册文件"
        percent = 0
    elif phase == "metadata":
        message = f"正在并行读取图片信息（{progress.get('workers', '?')} 线程）"
        percent = min(100, int(current * 100 / total)) if total else 0
    elif phase == "thumbnails":
        message = "正在并行生成缩略图"
        percent = min(100, int(current * 100 / total)) if total else 100
    elif total:
        message = "正在导入相册变化"
        percent = min(100, int(current * 100 / total))
    else:
        message = "正在检测相册变化"
        percent = 0
    scan_status.update(
        {
            "message": message,
            "current_album": source,
            "current": current,
            "total": total,
            "percent": percent,
        }
    )
