from __future__ import annotations

from fastapi import APIRouter, Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from ...db import get_session
from ...duplicates import list_exact_duplicate_signatures, quarantine_exact_keep_one, quarantine_resource
from ..services.duplicates import format_exact_duplicate_message, run_duplicate_delete_action
from ..state import duplicate_status
from ..tasks.duplicate_scan import start_duplicate_scan


router = APIRouter()


@router.post("/tools/duplicates/scan")
def start_duplicate_scan_route():
    start_duplicate_scan(force=True)
    return RedirectResponse(url="/tools/duplicates", status_code=303)


@router.get("/api/tools/duplicates/status")
def api_duplicate_status() -> dict:
    return duplicate_status.copy()


@router.post("/tools/duplicates/exact/{signature}/apply")
def apply_exact_duplicate_action(
    signature: str,
    keep_resource_id: int | None = Form(None),
    session: Session = Depends(get_session),
):
    return run_duplicate_delete_action(
        action=lambda: quarantine_exact_keep_one(session, signature, keep_resource_id=keep_resource_id),
        redirect_url="/tools/duplicates?mode=exact",
        message_builder=format_exact_duplicate_message,
    )


@router.post("/tools/duplicates/exact/bulk-apply")
def apply_exact_duplicate_bulk_action(session: Session = Depends(get_session)):
    def action() -> dict:
        signatures = list_exact_duplicate_signatures()
        moved = 0
        groups = 0
        skipped = 0
        for signature in signatures:
            outcome = quarantine_exact_keep_one(session, signature)
            if outcome["moved"] > 0:
                groups += 1
            else:
                skipped += 1
            moved += outcome["moved"]
        return {"moved": moved, "groups": groups, "skipped": skipped, "mode": "bulk"}

    return run_duplicate_delete_action(
        action=action,
        redirect_url="/tools/duplicates?mode=exact",
        message_builder=lambda result: (
            f"智能删除已完成：处理了 {result['groups']} 组，移动了 {result['moved']} 个重复文件"
            + (f"，另有 {result['skipped']} 组没有可删除的纯图片项。" if result["skipped"] else "。")
        ),
    )


@router.post("/tools/duplicates/exact/{signature}/quarantine-half")
def quarantine_exact_duplicate_half(
    signature: str,
    keep_resource_id: int | None = Form(None),
    session: Session = Depends(get_session),
):
    return run_duplicate_delete_action(
        action=lambda: quarantine_exact_keep_one(session, signature, keep_resource_id=keep_resource_id),
        redirect_url="/tools/duplicates?mode=exact",
        message_builder=format_exact_duplicate_message,
    )


@router.post("/tools/duplicates/resources/{resource_id}/quarantine")
def quarantine_duplicate_resource_route(
    resource_id: int,
    mode: str = Form("content"),
    session: Session = Depends(get_session),
):
    next_mode = mode if mode in {"exact", "content"} else "content"
    return run_duplicate_delete_action(
        action=lambda: {"moved": 1 if quarantine_resource(session, resource_id) else 0},
        redirect_url=f"/tools/duplicates?mode={next_mode}",
        message_builder=lambda result: (
            "已将 1 个文件移动到隔离区。"
            if result["moved"]
            else "原文件不存在，已清理数据库记录。"
        ),
    )
