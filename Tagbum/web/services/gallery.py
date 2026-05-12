from __future__ import annotations

from datetime import date, datetime
import math

from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from ...media import WEB_IMAGE_EXTENSIONS
from ...models import AssetGroup, AssetResource, AssetTag, Tag


def fallback_taken_at_expr():
    return select(func.min(AssetResource.mtime)).where(AssetResource.group_id == AssetGroup.id).scalar_subquery()


def effective_taken_at_expr():
    return func.coalesce(AssetGroup.taken_at, fallback_taken_at_expr())


def group_taken_at(group: AssetGroup) -> datetime | None:
    if group.taken_at is not None:
        return group.taken_at
    resource_times = [resource.mtime for resource in group.resources if resource.mtime is not None]
    return min(resource_times) if resource_times else None


def decorate_groups(groups: list[AssetGroup]) -> list[AssetGroup]:
    for group in groups:
        group.effective_taken_at = group_taken_at(group)
    return groups


def apply_kind_filter(query: Select[tuple[AssetGroup]], kind: str | None) -> Select[tuple[AssetGroup]]:
    if kind == "image":
        return query.where(AssetGroup.resources.any(AssetResource.kind == "image"))
    if kind == "live":
        return query.where(
            AssetGroup.resources.any(AssetResource.kind == "image"),
            AssetGroup.resources.any(AssetResource.kind == "video"),
        )
    if kind == "video":
        return query.where(
            AssetGroup.resources.any(AssetResource.kind == "video"),
            ~AssetGroup.resources.any(AssetResource.kind == "image"),
        )
    if kind == "edited":
        return query.where(
            AssetGroup.resources.any(
                (AssetResource.kind == "sidecar") & (AssetResource.extension == ".aae")
            )
        )
    return query


def group_query(tag: str | None = None, tag_status: str | None = None, kind: str | None = None) -> Select[tuple[AssetGroup]]:
    effective_taken_at = effective_taken_at_expr()
    query = select(AssetGroup).options(
        selectinload(AssetGroup.resources),
        selectinload(AssetGroup.tags).selectinload(AssetTag.tag),
    )
    if tag:
        query = query.join(AssetTag).join(Tag).where(Tag.name == tag.strip().lower())
    if tag_status == "tagged":
        query = query.where(AssetGroup.tags.any())
    elif tag_status == "untagged":
        query = query.where(~AssetGroup.tags.any())
    query = apply_kind_filter(query, kind)
    return query.order_by(effective_taken_at.desc().nullslast(), AssetGroup.id.desc())


def load_groups(
    session: Session,
    tag: str | None = None,
    tag_status: str | None = None,
    kind: str | None = None,
    limit: int = 144,
    offset: int = 0,
) -> list[AssetGroup]:
    query = group_query(tag, tag_status, kind).offset(offset).limit(limit)
    return decorate_groups(list(session.scalars(query)))


def get_group(session: Session, group_id: int) -> AssetGroup:
    group = session.scalar(group_query().where(AssetGroup.id == group_id))
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    decorate_groups([group])
    return group


def load_tags(session: Session) -> list[tuple[str, int]]:
    query = select(Tag.name, func.count(AssetTag.id)).join(AssetTag).group_by(Tag.id).order_by(Tag.name)
    return list(session.execute(query))


def load_kind_counts(session: Session, tag: str | None = None) -> list[tuple[str, int]]:
    return [
        ("image", count_groups(session, tag=tag, kind="image")),
        ("live", count_groups(session, tag=tag, kind="live")),
        ("video", count_groups(session, tag=tag, kind="video")),
        ("edited", count_groups(session, tag=tag, kind="edited")),
    ]


def count_groups(session: Session, tag: str | None = None, tag_status: str | None = None, kind: str | None = None) -> int:
    query = select(func.count(AssetGroup.id))
    if tag:
        query = query.join(AssetTag).join(Tag).where(Tag.name == tag.strip().lower())
    if tag_status == "tagged":
        query = query.where(AssetGroup.tags.any())
    elif tag_status == "untagged":
        query = query.where(~AssetGroup.tags.any())
    query = apply_kind_filter(query, kind)
    return session.scalar(query) or 0


def count_located_groups(session: Session) -> int:
    query = select(func.count(AssetGroup.id)).where(
        AssetGroup.latitude.is_not(None),
        AssetGroup.longitude.is_not(None),
    )
    return session.scalar(query) or 0


def normalize_longitude(value: float) -> float:
    return ((value + 180) % 360) - 180


def map_groups_for_bounds(
    session: Session,
    west: float | None,
    south: float | None,
    east: float | None,
    north: float | None,
) -> tuple[list[AssetGroup], tuple[float, float, float, float] | None]:
    query = group_query().where(AssetGroup.latitude.is_not(None), AssetGroup.longitude.is_not(None))
    bounds: tuple[float, float, float, float] | None = None
    if None not in (west, south, east, north):
        south_bound = max(-90.0, min(float(south), float(north)))
        north_bound = min(90.0, max(float(south), float(north)))
        west_raw = float(west)
        east_raw = float(east)
        west_bound = normalize_longitude(west_raw)
        east_bound = normalize_longitude(east_raw)

        query = query.where(AssetGroup.latitude >= south_bound, AssetGroup.latitude <= north_bound)
        if abs(east_raw - west_raw) < 360:
            if west_bound <= east_bound:
                query = query.where(AssetGroup.longitude >= west_bound, AssetGroup.longitude <= east_bound)
            else:
                query = query.where((AssetGroup.longitude >= west_bound) | (AssetGroup.longitude <= east_bound))
        bounds = (west_bound, south_bound, east_bound, north_bound)
    return list(session.scalars(query)), bounds


def longitude_span(west: float, east: float) -> float:
    span = east - west
    if span <= 0:
        span += 360
    return span


def longitude_offset(lon: float, west: float) -> float:
    offset = normalize_longitude(lon) - west
    if offset < 0:
        offset += 360
    return offset


def mercator_y(lat: float) -> float:
    clamped = max(-85.0511, min(85.0511, lat))
    sin_lat = math.sin(math.radians(clamped))
    return 0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)


def map_cell_position(
    group: AssetGroup,
    bounds: tuple[float, float, float, float],
    rows: int,
    cols: int,
) -> tuple[int, int] | None:
    if group.latitude is None or group.longitude is None:
        return None
    west, south, east, north = bounds
    lon_span = longitude_span(west, east)
    north_y = mercator_y(north)
    south_y = mercator_y(south)
    y_span = south_y - north_y
    if lon_span <= 0 or y_span <= 0:
        return None
    col = int((longitude_offset(group.longitude, west) / lon_span) * cols)
    row = int(((mercator_y(group.latitude) - north_y) / y_span) * rows)
    return max(0, min(rows - 1, row)), max(0, min(cols - 1, col))


def map_grid_payload(
    groups: list[AssetGroup],
    bounds: tuple[float, float, float, float],
    rows: int,
    cols: int,
) -> list[dict]:
    west, south, east, north = bounds
    lon_span = longitude_span(west, east)
    north_y = mercator_y(north)
    south_y = mercator_y(south)
    y_span = south_y - north_y
    if lon_span <= 0 or y_span <= 0:
        return []

    cells: dict[tuple[int, int], dict] = {}
    for group in groups:
        position = map_cell_position(group, bounds=bounds, rows=rows, cols=cols)
        if position is None:
            continue
        row, col = position
        cell = cells.setdefault((row, col), {"row": row, "col": col, "count": 0, "representative": group})
        cell["count"] += 1

    return [
        {
            "row": cell["row"],
            "col": cell["col"],
            "count": cell["count"],
            "group": group_payload(cell["representative"]),
        }
        for cell in sorted(cells.values(), key=lambda item: (item["row"], item["col"]))
    ]


def map_center(session: Session) -> tuple[float, float]:
    group = session.scalar(
        group_query().where(AssetGroup.latitude.is_not(None), AssetGroup.longitude.is_not(None)).limit(1)
    )
    if group is None or group.latitude is None or group.longitude is None:
        return 30.0, 104.0
    return float(group.latitude), float(group.longitude)


def date_counts(session: Session, tag: str | None = None, tag_status: str | None = None, kind: str | None = None) -> dict[date, int]:
    effective_taken_at = effective_taken_at_expr()
    day = func.date(effective_taken_at)
    query = select(day, func.count(AssetGroup.id)).where(effective_taken_at.is_not(None))
    if tag:
        query = query.join(AssetTag).join(Tag).where(Tag.name == tag.strip().lower())
    if tag_status == "tagged":
        query = query.where(AssetGroup.tags.any())
    elif tag_status == "untagged":
        query = query.where(~AssetGroup.tags.any())
    query = apply_kind_filter(query, kind)
    query = query.group_by(day)
    counts: dict[date, int] = {}
    for raw_day, count in session.execute(query):
        if raw_day:
            counts[date.fromisoformat(raw_day)] = count
    return counts


def first_group_date(groups: list[AssetGroup]) -> str:
    if not groups:
        return ""
    taken_at = group_taken_at(groups[0])
    return taken_at.date().isoformat() if taken_at else ""


def total_pages(total: int, page_size: int) -> int:
    return max(1, (total + page_size - 1) // page_size)


def page_window(page: int, total_pages_value: int, radius: int = 2) -> list[int]:
    start = max(1, page - radius)
    end = min(total_pages_value, page + radius)
    return list(range(start, end + 1))


def resolve_offset_for_date(session: Session, raw_date: str, tag: str | None = None, tag_status: str | None = None, kind: str | None = None) -> int:
    try:
        target = date.fromisoformat(raw_date)
    except ValueError:
        return 0
    effective_taken_at = effective_taken_at_expr()
    rows = decorate_groups(list(session.scalars(group_query(tag=tag, tag_status=tag_status, kind=kind).where(effective_taken_at.is_not(None)))))
    if not rows:
        return 0
    same_day = [
        index for index, group in enumerate(rows)
        if group.effective_taken_at and group.effective_taken_at.date() == target
    ]
    if same_day:
        return same_day[0]
    nearest_index, _ = min(
        enumerate(rows),
        key=lambda item: abs(((item[1].effective_taken_at or datetime.min).date() - target).days),
    )
    return nearest_index


def payload_kind(resource: AssetResource, group: AssetGroup) -> str:
    has_image = any(item.kind == "image" for item in group.resources)
    if resource.kind == "video" and has_image:
        return "live"
    if resource.kind == "sidecar" and resource.extension == ".aae":
        return "edited"
    return resource.kind


def kind_sort_key(kind: str) -> tuple[int, str]:
    order = {"image": 0, "live": 1, "video": 2, "edited": 3, "raw": 4, "sidecar": 5, "other": 6}
    return order.get(kind, 99), kind


def preview_url(resource: AssetResource) -> str:
    if resource.kind != "image":
        return f"/media/{resource.id}"
    if resource.extension in WEB_IMAGE_EXTENSIONS:
        return f"/media/{resource.id}"
    return f"/previews/{resource.id}.jpg"


def group_payload(group: AssetGroup, include_resources: bool = False) -> dict:
    resource_kinds = sorted({payload_kind(resource, group) for resource in group.resources}, key=kind_sort_key)
    taken_at = group_taken_at(group)
    payload = {
        "id": group.id,
        "display_name": group.display_name,
        "taken_at": taken_at.isoformat() if taken_at else None,
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
                "kind": payload_kind(resource, group),
                "extension": resource.extension,
                "size_bytes": resource.size_bytes,
                "url": f"/media/{resource.id}",
                "preview_url": preview_url(resource),
            }
            for resource in group.resources
        ]
    return payload
