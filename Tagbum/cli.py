from pathlib import Path

import click
import uvicorn

from .main import app
from .db import SessionLocal, init_db
from .importer import import_folder


@click.group()
def cli() -> None:
    """Tagbum command line."""


@cli.command("init-db")
def init_db_command() -> None:
    init_db()
    click.echo("Database initialized.")


@cli.command("import")
@click.argument("source", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--limit", type=int, default=None, help="Import only the first N supported files.")
@click.option("--commit-every", type=int, default=250, show_default=True, help="Commit progress every N files.")
def import_command(source: Path, limit: int | None, commit_every: int) -> None:
    with SessionLocal() as session:
        stats = import_folder(source, session, limit=limit, commit_every=commit_every)
    for key, value in stats.items():
        click.echo(f"{key}: {value}")


@cli.command("web")
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--port", default=8000, show_default=True)
@click.option("--reload", is_flag=True, help="Restart the server when source files change.")
def web_command(host: str, port: int, reload: bool) -> None:
    init_db()
    if reload:
        uvicorn.run("Tagbum.main:app", host=host, port=port, reload=True)
    else:
        uvicorn.run(app, host=host, port=port)
