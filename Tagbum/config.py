from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "tagbum.config.json"


@dataclass
class Profile:
    name: str
    database: Path
    albums: list[Path] = field(default_factory=list)
    thumbnail_dir: Path | None = None


class NoActiveProfile(RuntimeError):
    pass


class Settings:
    def __init__(self) -> None:
        self.thumbnail_size = int(os.environ.get("TAGBUM_THUMBNAIL_SIZE", "640"))
        self.config_path = Path(os.environ.get("TAGBUM_CONFIG", DEFAULT_CONFIG_PATH)).resolve()
        self._raw: dict[str, Any] = {}
        self._active_profile = "default"
        self.reload()

    def reload(self) -> None:
        if self.config_path.exists():
            self._raw = json.loads(self.config_path.read_text(encoding="utf-8"))
        else:
            self._raw = self._default_config()
        self._active_profile = str(self._raw.get("active_profile") or "default")
        if not self._profiles_raw:
            self._active_profile = ""
            self._raw["active_profile"] = ""
            return
        if self._active_profile not in self._profiles_raw:
            self._active_profile = "default" if "default" in self._profiles_raw else next(iter(self._profiles_raw))
        if "TAGBUM_DATABASE_URL" in os.environ or "TAGBUM_DATA_DIR" in os.environ:
            self._raw = self._legacy_env_config()
            self._active_profile = "env"

    @property
    def _profiles_raw(self) -> dict[str, Any]:
        profiles = self._raw.setdefault("profiles", {})
        if not isinstance(profiles, dict):
            self._raw["profiles"] = {}
        return self._raw["profiles"]

    @property
    def active_profile_name(self) -> str:
        return self._active_profile

    @property
    def profile_names(self) -> list[str]:
        return sorted(self._profiles_raw)

    @property
    def active_profile(self) -> Profile:
        if not self._active_profile:
            raise NoActiveProfile("No database profile is configured.")
        return self.get_profile(self._active_profile)

    def get_profile(self, name: str) -> Profile:
        raw = self._profiles_raw.get(name)
        if raw is None:
            raise KeyError(f"Unknown profile: {name}")
        database = self._resolve_config_path(raw.get("database", "data/tagbum.sqlite"))
        albums = [self._resolve_config_path(item) for item in raw.get("albums", [])]
        thumbnail_dir = raw.get("thumbnail_dir")
        return Profile(
            name=name,
            database=database,
            albums=albums,
            thumbnail_dir=self._resolve_config_path(thumbnail_dir) if thumbnail_dir else None,
        )

    def set_active_profile(self, name: str) -> None:
        if name not in self._profiles_raw:
            raise KeyError(f"Unknown profile: {name}")
        self._active_profile = name
        self._raw["active_profile"] = name
        self.save()

    def remove_profile(self, name: str) -> None:
        if name not in self._profiles_raw:
            raise KeyError(f"Unknown profile: {name}")
        del self._profiles_raw[name]
        if self._active_profile == name:
            self._active_profile = "default" if "default" in self._profiles_raw else next(iter(self._profiles_raw), "")
            self._raw["active_profile"] = self._active_profile
        self.save()

    def upsert_profile(
        self,
        name: str,
        database: Path | str | None = None,
        albums: list[Path | str] | None = None,
        thumbnail_dir: Path | str | None = None,
    ) -> None:
        raw = self._profiles_raw.setdefault(name, {})
        if database is not None:
            raw["database"] = self._serialize_path(Path(database))
        if albums is not None:
            raw["albums"] = [self._serialize_path(Path(item)) for item in albums]
        elif "albums" not in raw:
            raw["albums"] = []
        if thumbnail_dir is not None:
            raw["thumbnail_dir"] = self._serialize_path(Path(thumbnail_dir))
        self.save()

    def add_album(self, profile_name: str, album: Path | str) -> None:
        raw = self._profiles_raw.setdefault(profile_name, {})
        albums = list(raw.get("albums", []))
        serialized = self._serialize_path(Path(album))
        if serialized not in albums:
            albums.append(serialized)
        raw["albums"] = albums
        self.save()

    def save(self) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(json.dumps(self._raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    @property
    def database_url(self) -> str | None:
        return os.environ.get("TAGBUM_DATABASE_URL")

    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        if not self._active_profile:
            raise NoActiveProfile("No database profile is configured.")
        return f"sqlite:///{self.active_profile.database.as_posix()}"

    @property
    def resolved_data_dir(self) -> Path:
        return self.active_profile.database.parent

    @property
    def thumbnail_dir(self) -> Path:
        profile = self.active_profile
        if profile.thumbnail_dir:
            return profile.thumbnail_dir
        if profile.database == (PROJECT_ROOT / "data" / "tagbum.sqlite").resolve():
            return PROJECT_ROOT / "data" / "thumbnails"
        return profile.database.parent / f"{profile.database.stem}_thumbnails"

    @property
    def album_paths(self) -> list[Path]:
        return self.active_profile.albums

    def _default_config(self) -> dict[str, Any]:
        return {
            "active_profile": "",
            "profiles": {},
        }

    def _legacy_env_config(self) -> dict[str, Any]:
        data_dir = Path(os.environ.get("TAGBUM_DATA_DIR", "data"))
        database = data_dir / "tagbum.sqlite"
        return {
            "active_profile": "env",
            "profiles": {
                "env": {
                    "database": self._serialize_path(database),
                    "albums": [],
                    "thumbnail_dir": self._serialize_path(data_dir / "thumbnails"),
                }
            },
        }

    def _resolve_config_path(self, value: str | Path) -> Path:
        path = Path(value)
        if not path.is_absolute():
            path = self.config_path.parent / path
        return path.resolve()

    def _serialize_path(self, path: Path) -> str:
        resolved = path.resolve()
        try:
            return resolved.relative_to(self.config_path.parent).as_posix()
        except ValueError:
            return str(resolved)


settings = Settings()
