from __future__ import annotations

from collections import defaultdict, deque

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ...models import AssetTag, Tag, TagRelation


def clean_tag_name(name: str) -> str:
    cleaned = str(name or "").strip().lower()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Tag name is required.")
    return cleaned


def get_or_create_tag(session: Session, name: str) -> Tag:
    cleaned = clean_tag_name(name)
    tag = session.scalar(select(Tag).where(Tag.name == cleaned))
    if tag is None:
        tag = Tag(name=cleaned)
        session.add(tag)
        session.flush()
    return tag


def tag_counts(session: Session) -> dict[str, int]:
    rows = session.execute(
        select(Tag.name, func.count(AssetTag.id))
        .outerjoin(AssetTag, AssetTag.tag_id == Tag.id)
        .group_by(Tag.id)
    )
    return {name: count for name, count in rows}


def graph_snapshot(session: Session) -> dict:
    tags = list(session.scalars(select(Tag).order_by(Tag.name)))
    counts = tag_counts(session)
    id_to_name = {tag.id: tag.name for tag in tags}
    children: dict[str, set[str]] = defaultdict(set)
    parents: dict[str, set[str]] = defaultdict(set)
    relation_rows = []
    for relation in session.scalars(select(TagRelation)):
        parent = id_to_name.get(relation.parent_tag_id)
        child = id_to_name.get(relation.child_tag_id)
        if not parent or not child:
            continue
        children[parent].add(child)
        parents[child].add(parent)
        relation_rows.append({"parent": parent, "child": child, "type": relation.relation_type})
    return {
        "tags": [{"name": tag.name, "count": counts.get(tag.name, 0)} for tag in tags],
        "relations": sorted(relation_rows, key=lambda item: (item["parent"], item["child"])),
        "children": {key: sorted(value) for key, value in children.items()},
        "parents": {key: sorted(value) for key, value in parents.items()},
    }


def descendants(snapshot: dict, tag_name: str, include_self: bool = True) -> set[str]:
    start = clean_tag_name(tag_name)
    found = {start} if include_self else set()
    queue = deque(snapshot.get("children", {}).get(start, []))
    while queue:
        name = queue.popleft()
        if name in found:
            continue
        found.add(name)
        queue.extend(snapshot.get("children", {}).get(name, []))
    return found


def ancestors(snapshot: dict, tag_name: str) -> set[str]:
    start = clean_tag_name(tag_name)
    found: set[str] = set()
    queue = deque(snapshot.get("parents", {}).get(start, []))
    while queue:
        name = queue.popleft()
        if name in found:
            continue
        found.add(name)
        queue.extend(snapshot.get("parents", {}).get(name, []))
    return found


def ancestor_paths(snapshot: dict, tag_name: str) -> list[list[str]]:
    start = clean_tag_name(tag_name)
    parents = snapshot.get("parents", {})
    if not parents.get(start):
        return [[start]]
    paths: list[list[str]] = []

    def visit(name: str, trail: list[str]) -> None:
        next_parents = parents.get(name, [])
        if not next_parents:
            paths.append(trail)
            return
        for parent in next_parents:
            if parent in trail:
                continue
            visit(parent, [parent, *trail])

    visit(start, [start])
    return sorted(paths)


def inferred_for_tags(snapshot: dict, tag_names: list[str]) -> tuple[list[str], list[list[str]]]:
    explicit = {clean_tag_name(name) for name in tag_names}
    inferred: set[str] = set()
    paths: list[list[str]] = []
    for name in sorted(explicit):
        for path in ancestor_paths(snapshot, name):
            paths.append(path)
            inferred.update(path[:-1])
    return sorted(inferred - explicit), paths


def expand_filter_expression(session: Session, expression: dict | None) -> dict | None:
    if not expression:
        return expression
    snapshot = graph_snapshot(session)

    def visit(node: dict) -> dict:
        node = dict(node)
        if node.get("kind") == "condition" and node.get("field") == "tag":
            value = clean_tag_name(node.get("value", ""))
            if node.get("include_descendants", True):
                node["expanded_values"] = sorted(descendants(snapshot, value, include_self=True))
        elif node.get("kind") == "group":
            node["items"] = [visit(item) for item in node.get("items", [])]
        return node

    return visit(expression)


def add_relation(session: Session, parent_name: str, child_name: str) -> dict:
    parent = get_or_create_tag(session, parent_name)
    child = get_or_create_tag(session, child_name)
    if parent.id == child.id:
        raise HTTPException(status_code=400, detail="A tag cannot be its own parent.")
    snapshot = graph_snapshot(session)
    if parent.name in descendants(snapshot, child.name, include_self=True):
        raise HTTPException(status_code=400, detail="This relation would create a cycle.")
    exists = session.scalar(
        select(TagRelation).where(
            TagRelation.parent_tag_id == parent.id,
            TagRelation.child_tag_id == child.id,
        )
    )
    if exists is None:
        session.add(TagRelation(parent_tag_id=parent.id, child_tag_id=child.id, relation_type="parent"))
        session.commit()
    return graph_snapshot(session)


def remove_relation(session: Session, parent_name: str, child_name: str) -> dict:
    parent = session.scalar(select(Tag).where(Tag.name == clean_tag_name(parent_name)))
    child = session.scalar(select(Tag).where(Tag.name == clean_tag_name(child_name)))
    if parent is not None and child is not None:
        session.execute(
            delete(TagRelation).where(
                TagRelation.parent_tag_id == parent.id,
                TagRelation.child_tag_id == child.id,
            )
        )
        session.commit()
    return graph_snapshot(session)
