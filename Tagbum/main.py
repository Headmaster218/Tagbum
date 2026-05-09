from __future__ import annotations

from datetime import date, datetime, timedelta
import math
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import Select, delete, func, select
from sqlalchemy.orm import Session, selectinload

from .db import get_session, init_db
from .media import WEB_IMAGE_EXTENSIONS, build_full_preview
from .models import AssetGroup, AssetResource, AssetTag, Tag

PACKAGE_DIR = Path(__file__).resolve().parent
HOME_PAGE_SIZE = 72
TAGGER_PAGE_SIZE = 80

app = FastAPI(title="Tagbum")
templates = Jinja2Templates(directory=PACKAGE_DIR / "templates")
app.mount("/static", StaticFiles(directory=PACKAGE_DIR / "static"), name="static")


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/", response_class=HTMLResponse)
def home(
    request: Request,
    page: int = 1,
    jump_date: str | None = None,
    session: Session = Depends(get_session),
) -> HTMLResponse:
    total_groups = _count_groups(session)
    if jump_date:
        offset = _resolve_offset_for_date(session, jump_date)
        page = offset // HOME_PAGE_SIZE + 1
    page = max(1, min(page, max(1, _total_pages(total_groups, HOME_PAGE_SIZE))))
    offset = (page - 1) * HOME_PAGE_SIZE
    groups = _load_groups(session, limit=HOME_PAGE_SIZE, offset=offset)
    tags = _load_tags(session)
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "groups": groups,
            "tags": tags,
            "page": page,
            "total_pages": _total_pages(total_groups, HOME_PAGE_SIZE),
            "total_groups": total_groups,
            "page_window": _page_window(page, _total_pages(total_groups, HOME_PAGE_SIZE)),
            "active_date": jump_date or "",
            "current_date": _first_group_date(groups),
        },
    )


@app.get("/tag", response_class=HTMLResponse)
def tag_page(
    request: Request,
    status: str = "untagged",
    session: Session = Depends(get_session),
) -> HTMLResponse:
    tags = _load_tags(session)
    active_status = status if status in {"tagged", "untagged"} else "untagged"
    total_groups = _count_groups(session, tag_status=active_status)
    tagged_count = _count_groups(session, tag_status="tagged")
    untagged_count = _count_groups(session, tag_status="untagged")
    return templates.TemplateResponse(
        request,
        "tag.html",
        {
            "tags": tags,
            "total_groups": total_groups,
            "tagged_count": tagged_count,
            "untagged_count": untagged_count,
            "active_status": active_status,
            "current_date": _first_group_date(_load_groups(session, tag_status=active_status, limit=1)),
        },
    )


@app.get("/filter", response_class=HTMLResponse)
def filter_page(request: Request, tag: str | None = None, session: Session = Depends(get_session)) -> HTMLResponse:
    groups = _load_groups(session, tag=tag, limit=144)
    tags = _load_tags(session)
    return templates.TemplateResponse(
        request, "filter.html", {"groups": groups, "tags": tags, "active_tag": tag}
    )


@app.get("/map", response_class=HTMLResponse)
def map_page(request: Request, session: Session = Depends(get_session)) -> HTMLResponse:
    center_lat, center_lon = _map_center(session)
    located_count = _count_located_groups(session)
    return templates.TemplateResponse(
        request,
        "map.html",
        {
            "center_lat": center_lat,
            "center_lon": center_lon,
            "located_count": located_count,
        },
    )


@app.get("/api/groups")
def api_groups(
    tag: str | None = None,
    tag_status: str | None = None,
    include_resources: bool = False,
    limit: int = 144,
    offset: int = 0,
    session: Session = Depends(get_session),
) -> list[dict]:
    return [
        _group_payload(group, include_resources=include_resources)
        for group in _load_groups(session, tag=tag, tag_status=tag_status, limit=limit, offset=offset)
    ]


@app.get("/api/position")
def api_position(
    jump_date: str | None = None,
    index: int | None = None,
    tag_status: str | None = None,
    session: Session = Depends(get_session),
) -> dict:
    total = _count_groups(session, tag_status=tag_status)
    if total == 0:
        return {"offset": 0, "total": 0}
    if jump_date:
        offset = _resolve_offset_for_date(session, jump_date, tag_status=tag_status)
    elif index is not None:
        offset = max(0, min(index - 1, total - 1))
    else:
        offset = 0
    return {"offset": offset, "total": total}


@app.get("/api/dates")
def api_dates(tag_status: str | None = None, session: Session = Depends(get_session)) -> dict:
    counts = _date_counts(session, tag_status=tag_status)
    if not counts:
        return {"dates": [], "min_date": None, "max_date": None}
    days = []
    months = sorted({(day.year, day.month) for day in counts})
    for year, month in months:
        current = date(year, month, 1)
        if month == 12:
            end = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            end = date(year, month + 1, 1) - timedelta(days=1)
        while current <= end:
            days.append({"date": current.isoformat(), "count": counts.get(current, 0)})
            current += timedelta(days=1)
    start = min(counts)
    end = max(counts)
    return {"dates": days, "min_date": start.isoformat(), "max_date": end.isoformat()}


@app.get("/api/map")
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
    query = _group_query().where(AssetGroup.latitude.is_not(None), AssetGroup.longitude.is_not(None))
    bounds: tuple[float, float, float, float] | None = None
    if None not in (west, south, east, north):
        south_bound = max(-90.0, min(float(south), float(north)))
        north_bound = min(90.0, max(float(south), float(north)))
        west_raw = float(west)
        east_raw = float(east)
        west_bound = _normalize_longitude(west_raw)
        east_bound = _normalize_longitude(east_raw)

        query = query.where(AssetGroup.latitude >= south_bound, AssetGroup.latitude <= north_bound)
        if abs(east_raw - west_raw) >= 360:
            pass
        elif west_bound <= east_bound:
            query = query.where(AssetGroup.longitude >= west_bound, AssetGroup.longitude <= east_bound)
        else:
            query = query.where((AssetGroup.longitude >= west_bound) | (AssetGroup.longitude <= east_bound))
        bounds = (west_bound, south_bound, east_bound, north_bound)
    groups = list(session.scalars(query))
    if bounds is None:
        return [_group_payload(group) for group in groups[:50]]
    return _map_grid_payload(groups, bounds=bounds, rows=rows, cols=cols)


@app.get("/api/groups/{group_id}")
def api_group(group_id: int, session: Session = Depends(get_session)) -> dict:
    group = _get_group(session, group_id)
    return _group_payload(group, include_resources=True)


@app.post("/api/groups/{group_id}/tags")
def add_tag(group_id: int, name: str = Form(...), session: Session = Depends(get_session)) -> dict:
    group = _get_group(session, group_id)
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
    return _group_payload(_get_group(session, group_id))


@app.delete("/api/groups/{group_id}/tags/{tag_name}")
def remove_tag(group_id: int, tag_name: str, session: Session = Depends(get_session)) -> dict:
    group = _get_group(session, group_id)
    tag = session.scalar(select(Tag).where(Tag.name == tag_name.strip().lower()))
    if tag is not None:
        session.execute(delete(AssetTag).where(AssetTag.group_id == group.id, AssetTag.tag_id == tag.id))
        session.commit()
    return _group_payload(_get_group(session, group_id))


@app.get("/api/tags")
def api_tags(session: Session = Depends(get_session)) -> list[dict]:
    return [{"name": name, "count": count} for name, count in _load_tags(session)]


@app.get("/thumbs/{group_id}.jpg")
def thumbnail(group_id: int, session: Session = Depends(get_session)) -> FileResponse:
    group = _get_group(session, group_id)
    paths = [Path(group.thumbnail_path)] if group.thumbnail_path else []
    paths.append(PACKAGE_DIR.parent / "data" / "thumbnails" / f"{group.id}.jpg")
    path = next((candidate for candidate in paths if candidate.exists()), None)
    if path is None:
        raise HTTPException(status_code=404, detail="Thumbnail missing")
    return FileResponse(path)


@app.get("/media/{resource_id}")
def media(resource_id: int, session: Session = Depends(get_session)) -> FileResponse:
    resource = session.get(AssetResource, resource_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    path = Path(resource.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(path)


@app.get("/previews/{resource_id}.jpg")
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


@app.post("/groups/{group_id}/tags")
def add_tag_from_page(group_id: int, name: str = Form(...), session: Session = Depends(get_session)):
    add_tag(group_id, name, session)
    return RedirectResponse(url="/tag", status_code=303)


def _group_query(tag: str | None = None, tag_status: str | None = None) -> Select[tuple[AssetGroup]]:
    query = select(AssetGroup).options(
        selectinload(AssetGroup.resources), selectinload(AssetGroup.tags).selectinload(AssetTag.tag)
    )
    if tag:
        query = query.join(AssetTag).join(Tag).where(Tag.name == tag.strip().lower())
    if tag_status == "tagged":
        query = query.where(AssetGroup.tags.any())
    elif tag_status == "untagged":
        query = query.where(~AssetGroup.tags.any())
    return query.order_by(AssetGroup.taken_at.desc().nullslast(), AssetGroup.id.desc())


def _load_groups(
    session: Session,
    tag: str | None = None,
    tag_status: str | None = None,
    limit: int = 144,
    offset: int = 0,
) -> list[AssetGroup]:
    return list(session.scalars(_group_query(tag, tag_status).offset(offset).limit(limit)))


def _get_group(session: Session, group_id: int) -> AssetGroup:
    group = session.scalar(_group_query().where(AssetGroup.id == group_id))
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


def _load_tags(session: Session) -> list[tuple[str, int]]:
    query = select(Tag.name, func.count(AssetTag.id)).join(AssetTag).group_by(Tag.id).order_by(Tag.name)
    return list(session.execute(query))


def _count_groups(session: Session, tag_status: str | None = None) -> int:
    query = select(func.count(AssetGroup.id))
    if tag_status == "tagged":
        query = query.where(AssetGroup.tags.any())
    elif tag_status == "untagged":
        query = query.where(~AssetGroup.tags.any())
    return session.scalar(query) or 0


def _count_located_groups(session: Session) -> int:
    query = select(func.count(AssetGroup.id)).where(
        AssetGroup.latitude.is_not(None),
        AssetGroup.longitude.is_not(None),
    )
    return session.scalar(query) or 0


def _normalize_longitude(value: float) -> float:
    return ((value + 180) % 360) - 180


def _longitude_span(west: float, east: float) -> float:
    span = east - west
    if span <= 0:
        span += 360
    return span


def _longitude_offset(lon: float, west: float) -> float:
    offset = _normalize_longitude(lon) - west
    if offset < 0:
        offset += 360
    return offset


def _mercator_y(lat: float) -> float:
    clamped = max(-85.0511, min(85.0511, lat))
    sin_lat = math.sin(math.radians(clamped))
    return 0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)


def _map_grid_payload(
    groups: list[AssetGroup],
    bounds: tuple[float, float, float, float],
    rows: int,
    cols: int,
) -> list[dict]:
    west, south, east, north = bounds
    lon_span = _longitude_span(west, east)
    north_y = _mercator_y(north)
    south_y = _mercator_y(south)
    y_span = south_y - north_y
    if lon_span <= 0 or y_span <= 0:
        return []

    cells: dict[tuple[int, int], dict] = {}
    for group in groups:
        if group.latitude is None or group.longitude is None:
            continue
        col = int((_longitude_offset(group.longitude, west) / lon_span) * cols)
        row = int(((_mercator_y(group.latitude) - north_y) / y_span) * rows)
        col = max(0, min(cols - 1, col))
        row = max(0, min(rows - 1, row))
        key = (row, col)
        cell = cells.setdefault(
            key,
            {
                "row": row,
                "col": col,
                "count": 0,
                "representative": group,
            },
        )
        cell["count"] += 1

    payload = []
    for cell in sorted(cells.values(), key=lambda item: (item["row"], item["col"])):
        group = cell["representative"]
        payload.append(
            {
                "row": cell["row"],
                "col": cell["col"],
                "count": cell["count"],
                "group": _group_payload(group),
            }
        )
    return payload


def _map_center(session: Session) -> tuple[float, float]:
    group = session.scalar(
        _group_query()
        .where(AssetGroup.latitude.is_not(None), AssetGroup.longitude.is_not(None))
        .limit(1)
    )
    if group is None or group.latitude is None or group.longitude is None:
        return 30.0, 104.0
    return float(group.latitude), float(group.longitude)


def _date_counts(session: Session, tag_status: str | None = None) -> dict[date, int]:
    day = func.date(AssetGroup.taken_at)
    query = select(day, func.count(AssetGroup.id)).where(AssetGroup.taken_at.is_not(None))
    if tag_status == "tagged":
        query = query.where(AssetGroup.tags.any())
    elif tag_status == "untagged":
        query = query.where(~AssetGroup.tags.any())
    query = query.group_by(day)
    counts: dict[date, int] = {}
    for raw_day, count in session.execute(query):
        if raw_day:
            counts[date.fromisoformat(raw_day)] = count
    return counts


def _first_group_date(groups: list[AssetGroup]) -> str:
    if not groups or groups[0].taken_at is None:
        return ""
    return groups[0].taken_at.date().isoformat()


def _total_pages(total: int, page_size: int) -> int:
    return max(1, (total + page_size - 1) // page_size)


def _page_window(page: int, total_pages: int, radius: int = 2) -> list[int]:
    start = max(1, page - radius)
    end = min(total_pages, page + radius)
    return list(range(start, end + 1))


def _resolve_offset_for_date(session: Session, raw_date: str, tag_status: str | None = None) -> int:
    try:
        target = date.fromisoformat(raw_date)
    except ValueError:
        return 0
    rows = list(session.scalars(_group_query(tag_status=tag_status).where(AssetGroup.taken_at.is_not(None))))
    if not rows:
        return 0
    same_day = [index for index, group in enumerate(rows) if group.taken_at and group.taken_at.date() == target]
    if same_day:
        return same_day[0]
    nearest_index, _ = min(
        enumerate(rows),
        key=lambda item: abs(((item[1].taken_at or datetime.min).date() - target).days),
    )
    return nearest_index


def _group_payload(group: AssetGroup, include_resources: bool = False) -> dict:
    resource_kinds = sorted({_payload_kind(resource, group) for resource in group.resources})
    payload = {
        "id": group.id,
        "display_name": group.display_name,
        "taken_at": group.taken_at.isoformat() if group.taken_at else None,
        "latitude": group.latitude,
        "longitude": group.longitude,
        "thumbnail_url": f"/thumbs/{group.id}.jpg" if group.thumbnail_path else None,
        "tags": sorted(asset_tag.tag.name for asset_tag in group.tags),
        "resource_kinds": resource_kinds,
    }
    if include_resources:
        payload["resources"] = [
            {
                "id": resource.id,
                "filename": resource.filename,
                "kind": _payload_kind(resource, group),
                "extension": resource.extension,
                "size_bytes": resource.size_bytes,
                "url": f"/media/{resource.id}",
                "preview_url": _preview_url(resource),
            }
            for resource in group.resources
        ]
    return payload


def _payload_kind(resource: AssetResource, group: AssetGroup) -> str:
    has_image = any(item.kind == "image" for item in group.resources)
    if resource.kind == "video" and has_image:
        return "live"
    return resource.kind


def _preview_url(resource: AssetResource) -> str:
    if resource.kind != "image":
        return f"/media/{resource.id}"
    if resource.extension in WEB_IMAGE_EXTENSIONS:
        return f"/media/{resource.id}"
    return f"/previews/{resource.id}.jpg"
