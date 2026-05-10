from pathlib import Path
import shutil

import click
import uvicorn

from .config import NoActiveProfile, settings
from .main import app
from .db import SessionLocal, configure_database, init_db
from .importer import import_folder


@click.group()
def cli() -> None:
    """Tagbum command line."""


@cli.command("init-db")
@click.option("--profile", default=None, help="Database profile to initialize.")
def init_db_command(profile: str | None) -> None:
    if profile:
        configure_database(profile)
    try:
        init_db()
    except NoActiveProfile as exc:
        raise click.ClickException("No database profile is configured. Create one from /settings or `python -m Tagbum profile add ...`.") from exc
    click.echo(f"Database initialized: {settings.active_profile.database}")


@cli.command("import")
@click.argument("source", required=False, type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--profile", default=None, help="Database profile to import into.")
@click.option("--limit", type=int, default=None, help="Import only the first N supported files.")
@click.option("--commit-every", type=int, default=250, show_default=True, help="Commit progress every N files.")
def import_command(source: Path | None, profile: str | None, limit: int | None, commit_every: int) -> None:
    if profile:
        configure_database(profile)
    try:
        init_db()
    except NoActiveProfile as exc:
        raise click.ClickException("No database profile is configured. Create one from /settings or `python -m Tagbum profile add ...`.") from exc
    sources = [source] if source else settings.album_paths
    if not sources:
        raise click.ClickException("No source provided and the active profile has no albums configured.")
    with SessionLocal() as session:
        for album in sources:
            click.echo(f"Importing {album} into {settings.active_profile_name}: {settings.active_profile.database}")
            stats = import_folder(album, session, limit=limit, commit_every=commit_every)
            for key, value in stats.items():
                click.echo(f"{key}: {value}")


@cli.group("profile")
def profile_group() -> None:
    """Manage database and album profiles."""


@profile_group.command("list")
def list_profiles() -> None:
    settings.reload()
    for name in settings.profile_names:
        profile = settings.get_profile(name)
        marker = "*" if name == settings.active_profile_name else " "
        click.echo(f"{marker} {name}: {profile.database}")
        for album in profile.albums:
            click.echo(f"    album: {album}")


@profile_group.command("use")
@click.argument("name")
def use_profile(name: str) -> None:
    settings.set_active_profile(name)
    click.echo(f"Active profile: {name}")


@profile_group.command("add")
@click.argument("name")
@click.option("--database", "database_path", required=True, type=click.Path(path_type=Path), help="SQLite path.")
@click.option("--album", "albums", multiple=True, type=click.Path(exists=True, file_okay=False, path_type=Path), help="Read-only album folder. Can be repeated.")
@click.option("--thumbnail-dir", type=click.Path(path_type=Path), default=None, help="Optional thumbnail folder.")
@click.option("--use", "activate", is_flag=True, help="Make this profile active after adding it.")
def add_profile(
    name: str,
    database_path: Path,
    albums: tuple[Path, ...],
    thumbnail_dir: Path | None,
    activate: bool,
) -> None:
    settings.upsert_profile(name, database=database_path, albums=list(albums), thumbnail_dir=thumbnail_dir)
    if activate:
        settings.set_active_profile(name)
    click.echo(f"Saved profile: {name}")


@profile_group.command("add-album")
@click.argument("album", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--profile", "profile_name", default=None, help="Profile to update. Defaults to active profile.")
def add_album(album: Path, profile_name: str | None) -> None:
    target = profile_name or settings.active_profile_name
    settings.add_album(target, album)
    click.echo(f"Added album to {target}: {album}")


@profile_group.command("move-db")
@click.argument("name")
@click.argument("destination", type=click.Path(path_type=Path))
@click.option("--copy", "copy_only", is_flag=True, help="Copy instead of moving the SQLite file.")
@click.option("--overwrite", is_flag=True, help="Overwrite the destination if it already exists.")
def move_database(name: str, destination: Path, copy_only: bool, overwrite: bool) -> None:
    profile = settings.get_profile(name)
    source = profile.database
    destination = destination.resolve()
    if not source.exists():
        raise click.ClickException(f"Database does not exist: {source}")
    if destination.exists() and not overwrite:
        raise click.ClickException(f"Destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if copy_only:
        shutil.copy2(source, destination)
    else:
        shutil.move(str(source), str(destination))
    raw_albums = [str(album) for album in profile.albums]
    settings.upsert_profile(name, database=destination, albums=raw_albums, thumbnail_dir=profile.thumbnail_dir)
    click.echo(f"{'Copied' if copy_only else 'Moved'} {name} database to: {destination}")


@cli.command("web")
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--port", default=8000, show_default=True)
@click.option("--profile", default=None, help="Database profile to use.")
@click.option("--reload", is_flag=True, help="Restart the server when source files change.")
def web_command(host: str, port: int, profile: str | None, reload: bool) -> None:
    if profile:
        configure_database(profile)
    if settings.active_profile_name:
        init_db()
    if reload:
        uvicorn.run("Tagbum.main:app", host=host, port=port, reload=True)
    else:
        uvicorn.run(app, host=host, port=port)
