from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class AssetGroup(Base):
    __tablename__ = "asset_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_key: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255), index=True)
    source_root: Mapped[str] = mapped_column(Text)
    source_dir: Mapped[str] = mapped_column(Text)
    taken_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    thumbnail_path: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    resources: Mapped[list["AssetResource"]] = relationship(
        back_populates="group", cascade="all, delete-orphan", order_by="AssetResource.kind"
    )
    tags: Mapped[list["AssetTag"]] = relationship(back_populates="group", cascade="all, delete-orphan")


class AssetResource(Base):
    __tablename__ = "asset_resources"
    __table_args__ = (UniqueConstraint("path", name="uq_asset_resource_path"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("asset_groups.id"), index=True)
    path: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(String(255), index=True)
    extension: Mapped[str] = mapped_column(String(16), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    mtime: Mapped[datetime] = mapped_column(DateTime)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)

    group: Mapped[AssetGroup] = relationship(back_populates="resources")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    groups: Mapped[list["AssetTag"]] = relationship(back_populates="tag", cascade="all, delete-orphan")


class AssetTag(Base):
    __tablename__ = "asset_tags"
    __table_args__ = (UniqueConstraint("group_id", "tag_id", name="uq_asset_tag"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("asset_groups.id"), index=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id"), index=True)
    source: Mapped[str] = mapped_column(String(32), default="manual", index=True)
    confidence: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    group: Mapped[AssetGroup] = relationship(back_populates="tags")
    tag: Mapped[Tag] = relationship(back_populates="groups")
