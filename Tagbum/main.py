from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import NoActiveProfile, settings
from .db import configure_database
from .web import PACKAGE_DIR
from .web.routes import api_router, pages_router, settings_router, tools_router
from .web.services.settings import active_database_exists, should_bypass_database_check
from .web.tasks.album_scan import start_album_scan


app = FastAPI(title="Tagbum")
app.mount("/static", StaticFiles(directory=PACKAGE_DIR / "static"), name="static")


@app.on_event("startup")
def startup() -> None:
    configure_database()
    start_album_scan()


@app.exception_handler(NoActiveProfile)
async def no_active_profile_handler(request: Request, exc: NoActiveProfile):
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": "No database profile is configured."}, status_code=409)
    return RedirectResponse(url="/settings?missing_db=1", status_code=303)


@app.middleware("http")
async def require_database_for_album_pages(request: Request, call_next):
    if should_bypass_database_check(request.url.path):
        return await call_next(request)
    settings.reload()
    if not active_database_exists():
        return RedirectResponse(url="/settings?missing_db=1", status_code=303)
    return await call_next(request)


app.include_router(pages_router)
app.include_router(settings_router)
app.include_router(tools_router)
app.include_router(api_router)
