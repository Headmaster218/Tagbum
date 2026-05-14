from __future__ import annotations

from datetime import datetime
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Body, Depends, Form, HTTPException, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ...db import get_session
from ...media import build_full_preview
from ...models import AssetResource, AssetTag, Tag
from ..common import PACKAGE_DIR
from ..services.gallery import (
    count_groups,
    date_counts,
    get_group,
    group_payload,
    load_groups,
    load_tags,
    map_cell_position,
    map_grid_payload,
    map_groups_for_bounds,
    normalize_filter_expression,
    resolve_offset_for_date,
)
from ..services.media import playable_video_path, range_file_response
from ..services.tag_graph import add_relation, expand_filter_expression, graph_snapshot, remove_relation


router = APIRouter()


@router.get("/api/groups")
def api_groups(
    tag: str | None = None,
    kind: str | None = None,
    filter_expr: str | None = None,
    tag_status: str | None = None,
    include_resources: bool = False,
    limit: int = 144,
    offset: int = 0,
    session: Session = Depends(get_session),
) -> list[dict]:
    tag_graph = graph_snapshot(session)
    normalized = expand_filter_expression(session, normalize_filter_expression(filter_expr, tag=tag, kind=kind))
    return [
        group_payload(group, include_resources=include_resources, tag_graph=tag_graph)
        for group in load_groups(session, tag_status=tag_status, filter_expr=normalized, limit=limit, offset=offset)
    ]


@router.get("/api/position")
def api_position(
    jump_date: str | None = None,
    index: int | None = None,
    tag: str | None = None,
    kind: str | None = None,
    filter_expr: str | None = None,
    tag_status: str | None = None,
    session: Session = Depends(get_session),
) -> dict:
    normalized = expand_filter_expression(session, normalize_filter_expression(filter_expr, tag=tag, kind=kind))
    total = count_groups(session, tag_status=tag_status, filter_expr=normalized)
    if total == 0:
        return {"offset": 0, "total": 0}
    if jump_date:
        offset = resolve_offset_for_date(session, jump_date, tag_status=tag_status, filter_expr=normalized)
    elif index is not None:
        offset = max(0, min(index - 1, total - 1))
    else:
        offset = 0
    return {"offset": offset, "total": total}


@router.get("/api/dates")
def api_dates(
    tag: str | None = None,
    kind: str | None = None,
    filter_expr: str | None = None,
    tag_status: str | None = None,
    session: Session = Depends(get_session),
) -> dict:
    normalized = expand_filter_expression(session, normalize_filter_expression(filter_expr, tag=tag, kind=kind))
    counts = date_counts(session, tag_status=tag_status, filter_expr=normalized)
    if not counts:
        return {"dates": [], "min_date": None, "max_date": None}
    days = []
    months = sorted({(day.year, day.month) for day in counts})
    for year, month in months:
        current = date(year, month, 1)
        end = date(year + (month == 12), 1 if month == 12 else month + 1, 1) - timedelta(days=1)
        while current <= end:
            days.append({"date": current.isoformat(), "count": counts.get(current, 0)})
            current += timedelta(days=1)
    start = min(counts)
    end = max(counts)
    return {"dates": days, "min_date": start.isoformat(), "max_date": end.isoformat()}


@router.get("/api/map")
def api_map(
    west: float | None = None,
    south: float | None = None,
    east: float | None = None,
    north: float | None = None,
    rows: int = 7,
    cols: int = 12,
    session: Session = Depends(get_session),
) -> list[dict]:
    rows = max(1, min(rows, 20))
    cols = max(1, min(cols, 24))
    groups, bounds = map_groups_for_bounds(session, west, south, east, north)
    if bounds is None:
        return [group_payload(group) for group in groups[:50]]
    return map_grid_payload(groups, bounds=bounds, rows=rows, cols=cols)


@router.get("/api/map/cell")
def api_map_cell(
    row: int,
    col: int,
    west: float,
    south: float,
    east: float,
    north: float,
    rows: int = 7,
    cols: int = 12,
    session: Session = Depends(get_session),
) -> list[dict]:
    rows = max(1, min(rows, 20))
    cols = max(1, min(cols, 24))
    row = max(0, min(rows - 1, row))
    col = max(0, min(cols - 1, col))
    groups, bounds = map_groups_for_bounds(session, west, south, east, north)
    if bounds is None:
        return []
    selected = [group for group in groups if map_cell_position(group, bounds=bounds, rows=rows, cols=cols) == (row, col)]
    tag_graph = graph_snapshot(session)
    return [group_payload(group, include_resources=True, tag_graph=tag_graph) for group in selected]


@router.get("/api/groups/{group_id}")
def api_group(group_id: int, session: Session = Depends(get_session)) -> dict:
    return group_payload(get_group(session, group_id), include_resources=True, tag_graph=graph_snapshot(session))


@router.patch("/api/groups/{group_id}/metadata")
def update_group_metadata(group_id: int, payload: dict = Body(...), session: Session = Depends(get_session)) -> dict:
    group = get_group(session, group_id)

    if "display_name" in payload:
        display_name = str(payload.get("display_name") or "").strip()
        if not display_name:
            raise HTTPException(status_code=400, detail="Display name is required.")
        group.display_name = display_name

    if "taken_at" in payload:
        raw_taken_at = payload.get("taken_at")
        if raw_taken_at in (None, ""):
            group.taken_at = None
        else:
            try:
                group.taken_at = datetime.fromisoformat(str(raw_taken_at))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid taken_at value.") from exc

    lat_provided = "latitude" in payload
    lon_provided = "longitude" in payload
    if lat_provided or lon_provided:
        raw_lat = payload.get("latitude")
        raw_lon = payload.get("longitude")
        if raw_lat in (None, "") and raw_lon in (None, ""):
            group.latitude = None
            group.longitude = None
        else:
            if raw_lat in (None, "") or raw_lon in (None, ""):
                raise HTTPException(status_code=400, detail="Latitude and longitude must be set together.")
            try:
                latitude = float(raw_lat)
                longitude = float(raw_lon)
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail="Invalid latitude or longitude.") from exc
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                raise HTTPException(status_code=400, detail="Coordinates are out of range.")
            group.latitude = latitude
            group.longitude = longitude

    session.commit()
    session.refresh(group)
    return group_payload(get_group(session, group_id), include_resources=True, tag_graph=graph_snapshot(session))


@router.post("/api/groups/{group_id}/tags")
def add_tag(group_id: int, name: str = Form(...), session: Session = Depends(get_session)) -> dict:
    group = get_group(session, group_id)
    cleaned = name.strip().lower()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Tag name is required.")
    tag = session.scalar(select(Tag).where(Tag.name == cleaned))
    if tag is None:
        tag = Tag(name=cleaned)
        session.add(tag)
        session.flush()
    exists = session.scalar(select(AssetTag).where(AssetTag.group_id == group.id, AssetTag.tag_id == tag.id))
    if exists is None:
        session.add(AssetTag(group_id=group.id, tag_id=tag.id, source="manual"))
    session.commit()
    return group_payload(get_group(session, group_id), tag_graph=graph_snapshot(session))


@router.delete("/api/groups/{group_id}/tags/{tag_name}")
def remove_tag(group_id: int, tag_name: str, session: Session = Depends(get_session)) -> dict:
    group = get_group(session, group_id)
    tag = session.scalar(select(Tag).where(Tag.name == tag_name.strip().lower()))
    if tag is not None:
        session.execute(delete(AssetTag).where(AssetTag.group_id == group.id, AssetTag.tag_id == tag.id))
        session.commit()
    return group_payload(get_group(session, group_id), tag_graph=graph_snapshot(session))


@router.post("/api/groups/{group_id}/tag-complete")
def complete_group_tags(group_id: int, payload: dict | None = Body(default=None), session: Session = Depends(get_session)) -> dict:
    group = get_group(session, group_id)
    group.tag_completed = bool((payload or {}).get("completed", True))
    session.commit()
    session.refresh(group)
    return group_payload(get_group(session, group_id), include_resources=True, tag_graph=graph_snapshot(session))


@router.get("/api/tags")
def api_tags(session: Session = Depends(get_session)) -> list[dict]:
    return [{"name": name, "count": count} for name, count in load_tags(session)]


@router.get("/api/tag-graph")
def api_tag_graph(session: Session = Depends(get_session)) -> dict:
    return graph_snapshot(session)


@router.post("/api/tag-relations")
def api_add_tag_relation(payload: dict = Body(...), session: Session = Depends(get_session)) -> dict:
    return add_relation(session, payload.get("parent", ""), payload.get("child", ""))


@router.delete("/api/tag-relations")
def api_remove_tag_relation(parent: str, child: str, session: Session = Depends(get_session)) -> dict:
    return remove_relation(session, parent, child)


@router.get("/thumbs/{group_id}.jpg")
def thumbnail(group_id: int, session: Session = Depends(get_session)) -> FileResponse:
    group = get_group(session, group_id)
    paths = [Path(group.thumbnail_path)] if group.thumbnail_path else []
    paths.append(PACKAGE_DIR.parent / "data" / "thumbnails" / f"{group.id}.jpg")
    path = next((candidate for candidate in paths if candidate.exists()), None)
    if path is None:
        raise HTTPException(status_code=404, detail="Thumbnail missing")
    return FileResponse(path)


@router.get("/media/{resource_id}")
def media(resource_id: int, request: Request, session: Session = Depends(get_session)) -> Response:
    resource = session.get(AssetResource, resource_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    path = Path(resource.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing")
    if resource.kind == "video":
        return range_file_response(path, request.headers.get("range"))
    return FileResponse(path)


@router.get("/video-stream/{resource_id}")
def video_stream(resource_id: int, request: Request, session: Session = Depends(get_session)) -> Response:
    resource = session.get(AssetResource, resource_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    if resource.kind != "video":
        raise HTTPException(status_code=400, detail="Resource is not a video")
    source = Path(resource.path)
    if not source.exists():
        raise HTTPException(status_code=404, detail="File missing")
    playable = playable_video_path(source, resource.id)
    return range_file_response(playable, request.headers.get("range"), media_type="video/mp4" if playable.suffix.lower() == ".mp4" else None)


@router.get("/previews/{resource_id}.jpg")
def preview(resource_id: int, session: Session = Depends(get_session)) -> Response:
    resource = session.get(AssetResource, resource_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    source = Path(resource.path)
    if not source.exists():
        raise HTTPException(status_code=404, detail="File missing")
    content = build_full_preview(source)
    if content is None:
        raise HTTPException(status_code=404, detail="Preview missing")
    return Response(content=content, media_type="image/jpeg")


@router.post("/groups/{group_id}/tags")
def add_tag_from_page(group_id: int, name: str = Form(...), session: Session = Depends(get_session)):
    add_tag(group_id, name, session)
    from fastapi.responses import RedirectResponse

    return RedirectResponse(url="/tag", status_code=303)
