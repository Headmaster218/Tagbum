from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TAGBUM_", env_file=".env", extra="ignore")

    data_dir: Path = Path("data")
    database_url: str | None = None
    thumbnail_size: int = 640

    @property
    def resolved_data_dir(self) -> Path:
        return self.data_dir.resolve()

    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        db_path = self.resolved_data_dir / "tagbum.sqlite"
        return f"sqlite:///{db_path.as_posix()}"

    @property
    def thumbnail_dir(self) -> Path:
        return self.resolved_data_dir / "thumbnails"


settings = Settings()
