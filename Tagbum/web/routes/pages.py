from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from ...config import settings
from ...db import get_session
from ..common import templates
from ..constants import DUPLICATE_PAGE_SIZE, HOME_PAGE_SIZE
from ..services.gallery import (
    count_groups,
    count_located_groups,
    first_group_date,
    load_kind_counts,
    load_groups,
    load_tags,
    map_center,
    page_window,
    resolve_offset_for_date,
    total_pages,
)
from ..services.settings import active_database_exists, profile_payload
from ..state import duplicate_status, scan_status
from ...duplicates import (
    cache_path as duplicate_cache_path,
    duplicate_summary,
    list_content_duplicate_sets,
    list_exact_duplicate_sets,
    quarantine_root as duplicate_quarantine_root,
)


router = APIRouter()


@router.get("/", response_class=HTMLResponse)
def home(
    request: Request,
    page: int = 1,
    jump_date: str | None = None,
    session: Session = Depends(get_session),
) -> HTMLResponse:
    total_groups = count_groups(session)
    if jump_date:
        offset = resolve_offset_for_date(session, jump_date)
    else:
        page = max(1, min(page, max(1, total_pages(total_groups, HOME_PAGE_SIZE))))
        offset = (page - 1) * HOME_PAGE_SIZE
    groups = load_groups(session, limit=1, offset=offset)
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "total_groups": total_groups,
            "current_date": first_group_date(groups),
            "initial_offset": offset,
            "page_size": HOME_PAGE_SIZE,
        },
    )


@router.get("/tag", response_class=HTMLResponse)
def tag_page(
    request: Request,
    status: str = "untagged",
    session: Session = Depends(get_session),
) -> HTMLResponse:
    active_status = status if status in {"tagged", "untagged"} else "untagged"
    return templates.TemplateResponse(
        request,
        "tag.html",
        {
            "tags": load_tags(session),
            "total_groups": count_groups(session, tag_status=active_status),
            "tagged_count": count_groups(session, tag_status="tagged"),
            "untagged_count": count_groups(session, tag_status="untagged"),
            "active_status": active_status,
            "current_date": first_group_date(load_groups(session, tag_status=active_status, limit=1)),
        },
    )


@router.get("/filter", response_class=HTMLResponse)
def filter_page(request: Request, tag: str | None = None, session: Session = Depends(get_session)) -> HTMLResponse:
    kind = request.query_params.get("kind")
    total_groups = count_groups(session, tag=tag, kind=kind)
    return templates.TemplateResponse(
        request,
        "filter.html",
        {
            "tags": load_tags(session),
            "kind_counts": load_kind_counts(session, tag=tag),
            "active_tag": tag,
            "active_kind": kind,
            "total_groups": total_groups,
            "current_date": first_group_date(load_groups(session, tag=tag, kind=kind, limit=1)),
            "page_size": HOME_PAGE_SIZE,
        },
    )


@router.get("/map", response_class=HTMLResponse)
def map_page(request: Request, session: Session = Depends(get_session)) -> HTMLResponse:
    center_lat, center_lon = map_center(session)
    return templates.TemplateResponse(
        request,
        "map.html",
        {
            "center_lat": center_lat,
            "center_lon": center_lon,
            "located_count": count_located_groups(session),
            "map_tile_provider": settings.map_tile_provider,
        },
    )


@router.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request) -> HTMLResponse:
    settings.reload()
    profiles = [profile_payload(settings.get_profile(name)) for name in settings.profile_names]
    return templates.TemplateResponse(
        request,
        "settings.html",
        {
            "active_profile": settings.active_profile_name,
            "database_ready": active_database_exists(),
            "profiles": profiles,
            "config_path": settings.config_path,
            "scan_status": scan_status.copy(),
            "map_tile_provider": settings.map_tile_provider,
        },
    )


@router.get("/tools", response_class=HTMLResponse)
def tools_index_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "tools_index.html",
        {
            "active_profile": settings.active_profile_name,
            "duplicate_summary": duplicate_summary(),
            "duplicate_status": duplicate_status.copy(),
        },
    )


@router.get("/tools/duplicates", response_class=HTMLResponse)
def duplicate_tools_page(
    request: Request,
    mode: str = "exact",
    page: int = 1,
    session: Session = Depends(get_session),
) -> HTMLResponse:
    active_mode = mode if mode in {"exact", "content"} else "exact"
    safe_page = max(1, page)
    if active_mode == "exact":
        results, total_sets = list_exact_duplicate_sets(session, page=safe_page, page_size=DUPLICATE_PAGE_SIZE)
    else:
        results, total_sets = list_content_duplicate_sets(session, page=safe_page, page_size=DUPLICATE_PAGE_SIZE)
    total_pages_value = total_pages(total_sets, DUPLICATE_PAGE_SIZE)
    safe_page = min(safe_page, total_pages_value)
    if safe_page != page:
        if active_mode == "exact":
            results, total_sets = list_exact_duplicate_sets(session, page=safe_page, page_size=DUPLICATE_PAGE_SIZE)
        else:
            results, total_sets = list_content_duplicate_sets(session, page=safe_page, page_size=DUPLICATE_PAGE_SIZE)
    return templates.TemplateResponse(
        request,
        "tools.html",
        {
            "mode": active_mode,
            "results": results,
            "summary": duplicate_summary(),
            "status": duplicate_status.copy(),
            "page": safe_page,
            "total_pages": total_pages_value,
            "total_sets": total_sets,
            "page_window": page_window(safe_page, total_pages_value),
            "cache_path": duplicate_cache_path(),
            "quarantine_path": duplicate_quarantine_root(),
            "active_profile": settings.active_profile_name,
        },
    )
