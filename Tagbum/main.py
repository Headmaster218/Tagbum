from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import Select, delete, func, select
from sqlalchemy.orm import Session, selectinload

from .db import get_session, init_db
from .models import AssetGroup, AssetResource, AssetTag, Tag

PACKAGE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Tagbum")
templates = Jinja2Templates(directory=PACKAGE_DIR / "templates")
app.mount("/static", StaticFiles(directory=PACKAGE_DIR / "static"), name="static")


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/", response_class=HTMLResponse)
def home(request: Request, session: Session = Depends(get_session)) -> HTMLResponse:
    groups = _load_groups(session, limit=72)
    tags = _load_tags(session)
    return templates.TemplateResponse(request, "index.html", {"groups": groups, "tags": tags})


@app.get("/tag", response_class=HTMLResponse)
def tag_page(request: Request, session: Session = Depends(get_session)) -> HTMLResponse:
    tags = _load_tags(session)
    total_groups = session.scalar(select(func.count(AssetGroup.id))) or 0
    return templates.TemplateResponse(request, "tag.html", {"tags": tags, "total_groups": total_groups})


@app.get("/filter", response_class=HTMLResponse)
def filter_page(request: Request, tag: str | None = None, session: Session = Depends(get_session)) -> HTMLResponse:
    groups = _load_groups(session, tag=tag, limit=144)
    tags = _load_tags(session)
    return templates.TemplateResponse(
        request, "filter.html", {"groups": groups, "tags": tags, "active_tag": tag}
    )


@app.get("/api/groups")
def api_groups(
    tag: str | None = None,
    limit: int = 144,
    offset: int = 0,
    session: Session = Depends(get_session),
) -> list[dict]:
    return [_group_payload(group) for group in _load_groups(session, tag=tag, limit=limit, offset=offset)]


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


@app.post("/groups/{group_id}/tags")
def add_tag_from_page(group_id: int, name: str = Form(...), session: Session = Depends(get_session)):
    add_tag(group_id, name, session)
    return RedirectResponse(url="/tag", status_code=303)


def _group_query(tag: str | None = None) -> Select[tuple[AssetGroup]]:
    query = select(AssetGroup).options(
        selectinload(AssetGroup.resources), selectinload(AssetGroup.tags).selectinload(AssetTag.tag)
    )
    if tag:
        query = query.join(AssetTag).join(Tag).where(Tag.name == tag.strip().lower())
    return query.order_by(AssetGroup.taken_at.desc().nullslast(), AssetGroup.id.desc())


def _load_groups(session: Session, tag: str | None = None, limit: int = 144, offset: int = 0) -> list[AssetGroup]:
    return list(session.scalars(_group_query(tag).offset(offset).limit(limit)))


def _get_group(session: Session, group_id: int) -> AssetGroup:
    group = session.scalar(_group_query().where(AssetGroup.id == group_id))
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


def _load_tags(session: Session) -> list[tuple[str, int]]:
    query = select(Tag.name, func.count(AssetTag.id)).join(AssetTag).group_by(Tag.id).order_by(Tag.name)
    return list(session.execute(query))


def _group_payload(group: AssetGroup, include_resources: bool = False) -> dict:
    payload = {
        "id": group.id,
        "display_name": group.display_name,
        "taken_at": group.taken_at.isoformat() if group.taken_at else None,
        "latitude": group.latitude,
        "longitude": group.longitude,
        "thumbnail_url": f"/thumbs/{group.id}.jpg" if group.thumbnail_path else None,
        "tags": sorted(asset_tag.tag.name for asset_tag in group.tags),
        "resource_kinds": sorted({resource.kind for resource in group.resources}),
    }
    if include_resources:
        payload["resources"] = [
            {
                "id": resource.id,
                "filename": resource.filename,
                "kind": resource.kind,
                "extension": resource.extension,
                "size_bytes": resource.size_bytes,
                "url": f"/media/{resource.id}",
            }
            for resource in group.resources
        ]
    return payload
