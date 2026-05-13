from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import NoActiveProfile, settings


class Base(DeclarativeBase):
    pass


engine: Engine | None = None
_engine_url: str | None = None
SessionLocal = sessionmaker(autoflush=False, expire_on_commit=False)


def configure_database(profile: str | None = None) -> None:
    global engine, _engine_url
    if profile:
        settings.set_active_profile(profile)
    else:
        settings.reload()
    try:
        next_url = settings.db_url
    except NoActiveProfile:
        dispose_database()
        return
    if engine is not None and _engine_url == next_url:
        return
    if engine is not None:
        engine.dispose()
    settings.resolved_data_dir.mkdir(parents=True, exist_ok=True)
    engine = create_engine(next_url, connect_args={"check_same_thread": False})
    SessionLocal.configure(bind=engine)
    _engine_url = next_url


def dispose_database() -> None:
    global engine, _engine_url
    if engine is not None:
        engine.dispose()
    engine = None
    _engine_url = None


def init_db() -> None:
    configure_database()
    if engine is None:
        raise NoActiveProfile("No database profile is configured.")
    settings.resolved_data_dir.mkdir(parents=True, exist_ok=True)
    settings.thumbnail_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema()


def get_session() -> Iterator[Session]:
    configure_database()
    if engine is None:
        raise NoActiveProfile("No database profile is configured.")
    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema()
    with SessionLocal() as session:
        yield session


def ensure_runtime_schema() -> None:
    if engine is None:
        return
    inspector = inspect(engine)
    resource_columns = {column["name"] for column in inspector.get_columns("asset_resources")}
    if "metadata_json" not in resource_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE asset_resources ADD COLUMN metadata_json TEXT"))
