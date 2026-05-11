from __future__ import annotations

from datetime import datetime

from fastapi.responses import RedirectResponse

from ..state import duplicate_action_lock, duplicate_lock, duplicate_status


def run_duplicate_delete_action(action, redirect_url: str, message_builder) -> RedirectResponse:
    if duplicate_lock.locked():
        duplicate_status.update(
            {
                "message": "重复分析仍在进行中，请稍候再执行删除。",
                "finished_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
        return RedirectResponse(url=redirect_url, status_code=303)
    if not duplicate_action_lock.acquire(blocking=False):
        duplicate_status.update(
            {
                "message": "删除任务正在进行中，请不要重复点击。",
                "finished_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
        return RedirectResponse(url=redirect_url, status_code=303)
    try:
        result = action()
        duplicate_status.update(
            {
                "message": message_builder(result),
                "finished_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
    finally:
        duplicate_action_lock.release()
    return RedirectResponse(url=redirect_url, status_code=303)


def format_exact_duplicate_message(result: dict) -> str:
    if result.get("mode") == "keep_earliest_group":
        return f"已移动 {result['moved']} 个整组重复资源到隔离区，并保留了最早的那一组。"
    if result.get("mode") == "remove_plain_only":
        return f"已移动 {result['moved']} 个纯图片重复项到隔离区，并保留了所有带伴生资源的项。"
    if result.get("mode") == "keep_selected":
        return f"已移动 {result['moved']} 个完全相同的文件到隔离区，并保留了你选中的那一项。"
    return "这一组没有可处理的重复文件。"
