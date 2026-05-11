from __future__ import annotations

from threading import Lock


scan_lock = Lock()
scan_status = {
    "running": False,
    "profile": "",
    "message": "尚未扫描",
    "started_at": None,
    "finished_at": None,
    "current_album": "",
    "current": 0,
    "total": 0,
    "percent": 0,
    "stats": [],
}

duplicate_lock = Lock()
duplicate_action_lock = Lock()
duplicate_status = {
    "running": False,
    "profile": "",
    "message": "尚未分析重复图片",
    "phase": "",
    "current": 0,
    "total": 0,
    "cached": 0,
    "exact_sets": 0,
    "content_sets": 0,
    "finished_at": None,
}
