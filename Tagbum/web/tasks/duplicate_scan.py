from __future__ import annotations

from datetime import datetime
from threading import Thread

from ...config import settings
from ...db import SessionLocal, configure_database
from ...duplicates import scan_duplicates
from ..state import duplicate_lock, duplicate_status


def start_duplicate_scan(force: bool = False) -> None:
    if duplicate_lock.locked() and not force:
        return
    if not settings.profile_names:
        duplicate_status.update(
            {
                "running": False,
                "profile": "",
                "message": "还没有数据库，无法分析重复图片。",
                "phase": "",
                "current": 0,
                "total": 0,
                "cached": 0,
                "exact_sets": 0,
                "content_sets": 0,
                "finished_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
        return
    Thread(target=_duplicate_worker, args=(settings.active_profile_name,), daemon=True).start()


def _duplicate_worker(profile_name: str) -> None:
    if not duplicate_lock.acquire(blocking=False):
        return
    duplicate_status.update(
        {
            "running": True,
            "profile": profile_name,
            "message": "正在分析重复图片",
            "phase": "starting",
            "current": 0,
            "total": 0,
            "cached": 0,
            "finished_at": None,
        }
    )
    try:
        configure_database(profile_name)
        with SessionLocal() as session:
            summary = scan_duplicates(session, progress_callback=update_duplicate_progress)
        duplicate_status.update(
            {
                "running": False,
                "profile": profile_name,
                "message": f"分析完成：完全重复 {summary['exact_sets']} 组，内容相同但元数据不同 {summary['content_sets']} 组。",
                "phase": "done",
                "current": summary["images"],
                "total": summary["images"],
                "cached": summary["images"] - summary["rehashed"],
                "exact_sets": summary["exact_sets"],
                "content_sets": summary["content_sets"],
                "finished_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
    except Exception as exc:  # noqa: BLE001
        duplicate_status.update(
            {
                "running": False,
                "profile": profile_name,
                "message": f"重复分析失败: {exc}",
                "phase": "error",
                "finished_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
    finally:
        duplicate_lock.release()


def update_duplicate_progress(payload: dict) -> None:
    current = int(payload.get("current", 0) or 0)
    total = int(payload.get("total", 0) or 0)
    phase = str(payload.get("phase", "") or "")
    cached = int(payload.get("cached", 0) or 0)
    exact_sets = int(payload.get("exact_sets", duplicate_status.get("exact_sets", 0)) or 0)
    content_sets = int(payload.get("content_sets", duplicate_status.get("content_sets", 0)) or 0)
    if phase == "hashing":
        message = f"正在计算哈希，已缓存 {cached} 张"
    elif phase == "done":
        message = "重复分析完成"
    else:
        message = "正在准备重复分析"
    duplicate_status.update(
        {
            "running": phase != "done",
            "phase": phase,
            "current": current,
            "total": total,
            "cached": cached,
            "exact_sets": exact_sets,
            "content_sets": content_sets,
            "message": message,
        }
    )
