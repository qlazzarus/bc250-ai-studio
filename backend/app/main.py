import hashlib
import hmac
import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from starlette.responses import JSONResponse

from app.api.compose import router as compose_router
from app.api.proposals import router as proposals_router
from app.api.routes import authenticate, router
from app.core.middleware import BodyLimit
from app.core.studio_config import Settings
from app.core.studio_files import FileLock
from app.engines.fake import FakeEngine
from app.engines.sdcpp import SdCppEngine
from app.models.database import Database
from app.scheduler.runner import Scheduler
from app.services.gpu import GPUManager
from app.services.llm import FakeLLM, SystemdLLM
from app.services.registry import Registry


def _ensure_app_logging() -> None:
    """Give this package's loggers a handler, once, without reconfiguring anything else.

    The unit starts Studio as ``uvicorn app.main:create_app --factory`` with no logging
    flags, and uvicorn's default config attaches handlers to its own ``uvicorn*`` loggers
    only. The root logger is left with none, so an ``app.*`` record reaches
    ``logging.lastResort``: WARNING and above to stderr, everything below discarded. The
    compose diagnostic's INFO line ("some candidates were dropped") would therefore never
    appear in the journal, which is exactly the case it exists to explain.

    This is deliberately narrow:

    * it touches only the ``app`` logger, never the root one, so uvicorn's access and error
      formatting is untouched;
    * it does nothing when a handler is already present, so a deployment that configures
      logging properly (or a test that captures with ``caplog``) keeps its own setup;
    * it adds no new format. The handler inherits whatever formatter the root has, and
      falls back to uvicorn's default shape via ``logging.lastResort`` semantics otherwise.

    ``disable_existing_loggers`` is not used and no dictConfig is applied: reconfiguring
    the root here would silently change every other logger in the process.
    """
    package = logging.getLogger("app")
    if package.handlers or logging.getLogger().handlers:
        # A real configuration exists; adding a second handler would duplicate lines.
        return
    handler = logging.StreamHandler()
    package.addHandler(handler)
    # INFO is what the compose diagnostic uses. `WARNING` would hide partial-success drops.
    package.setLevel(logging.INFO)


def create_app(settings=None, engine=None, llm=None):
    settings = settings or Settings()
    _ensure_app_logging()

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
    app.include_router(proposals_router)
    app.include_router(compose_router)

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

    @app.get("/internal/model-switch/recovery", include_in_schema=False)
    async def switch_recovery(authorization: str | None = Header(default=None)):
        key = settings.coordination_key
        supplied = authorization.removeprefix("Bearer ") if authorization else ""
        if (not key or not authorization or not authorization.startswith("Bearer ")
                or not hmac.compare_digest(supplied.encode(), key.encode())):
            return JSONResponse({"code": "invalid_credential"}, status_code=401)
        s = app.state
        enabled = s.gpu.model_switch_coordination_enabled()
        gate_verified = False
        if enabled:
            try:
                gate_verified = await s.gpu.llm.owned_control_identity()
            except Exception:
                pass
        # The switch worker holds the shared lock; attempting to acquire it here
        # would deadlock/fail the recovery check. Normal Studio acquire and
        # recover paths check this same journal while holding that lock.
        state = None
        if enabled:
            try:
                state = s.gpu.switch_barrier.read()
            except Exception:
                pass
        gpu_blocked = state is not None and s.gpu.shared_lock_held_by_root()
        digest = ""
        if state is not None:
            encoded = json.dumps(state, sort_keys=True, separators=(",", ":"),
                                 ensure_ascii=True).encode("ascii")
            digest = hashlib.sha256(encoded).hexdigest()
        clear = (not s.gpu.blocked and not s.gpu.leased
                 and not s.db.get_state("transition", {})
                 and not s.db.get_state("recovery", {}))
        return {"protocol": 1, "enabled": bool(enabled), "gpu_blocked": gpu_blocked,
                "studio_recovery_clear": bool(clear), "gate_verified": bool(gate_verified),
                "journal_sha256": digest}

    @app.get("/openapi.json", include_in_schema=False, dependencies=[Depends(authenticate)])
    async def schema():
        return JSONResponse(app.openapi())

    @app.get("/docs", include_in_schema=False, dependencies=[Depends(authenticate)])
    async def docs():
        return get_swagger_ui_html(openapi_url="/openapi.json", title="Studio API")

    return app
