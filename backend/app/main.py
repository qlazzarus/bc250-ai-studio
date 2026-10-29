import hmac
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from starlette.responses import JSONResponse

from app.api.routes import authenticate, router
from app.core.config import Settings
from app.core.files import FileLock
from app.core.middleware import BodyLimit
from app.engines.fake import FakeEngine
from app.engines.sdcpp import SdCppEngine
from app.models.database import Database
from app.scheduler.runner import Scheduler
from app.services.gpu import GPUManager
from app.services.llm import FakeLLM, SystemdLLM
from app.services.registry import Registry


def create_app(settings=None, engine=None, llm=None):
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        os.umask(0o077)
        settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        instance = FileLock(settings.data_dir / "studio.lock")
        instance.acquire()
        db = None
        scheduler = None
        try:
            db = Database(settings.data_dir)
            db.migrate()
            db.recover_jobs()
            registry = Registry(settings.registry_path, settings.engine)
            service = llm or (FakeLLM() if settings.engine == "fake" else SystemdLLM(settings))
            worker = engine or (
                FakeEngine(settings.fake_delay)
                if settings.engine == "fake"
                else SdCppEngine(settings)
            )
            gpu = GPUManager(settings, db, service)
            scheduler = Scheduler(settings, db, worker, gpu)
            app.state.settings, app.state.db = settings, db
            app.state.registry, app.state.gpu, app.state.scheduler = registry, gpu, scheduler
            scheduler.start()
            yield
        finally:
            try:
                if scheduler:
                    await scheduler.stop()
            finally:
                if db:
                    db.engine.dispose()
                instance.release()

    app = FastAPI(
        title="BC-250 AI Studio",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(BodyLimit, limit=settings.max_body_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
    )
    app.include_router(router)

    @app.get("/internal/model-switch/coordination", include_in_schema=False)
    async def coordination(authorization: str | None = Header(default=None)):
        key = settings.coordination_key
        supplied = authorization.removeprefix("Bearer ") if authorization else ""
        if (not key or not authorization or not authorization.startswith("Bearer ")
                or not hmac.compare_digest(supplied.encode(), key.encode())):
            return JSONResponse({"code": "invalid_credential"}, status_code=401)
        s = app.state
        enabled = s.gpu.model_switch_coordination_enabled()
        if enabled:
            try:
                enabled = await s.gpu.llm.owned_control_identity()
            except Exception:
                enabled = False
        transition_clear = (not s.gpu.blocked and not s.gpu.leased
                            and not s.db.get_state("transition", {}))
        return {"protocol": 1, "enabled": bool(enabled), "transition_clear": bool(transition_clear)}

    @app.get("/openapi.json", include_in_schema=False, dependencies=[Depends(authenticate)])
    async def schema():
        return JSONResponse(app.openapi())

    @app.get("/docs", include_in_schema=False, dependencies=[Depends(authenticate)])
    async def docs():
        return get_swagger_ui_html(openapi_url="/openapi.json", title="Studio API")

    return app
