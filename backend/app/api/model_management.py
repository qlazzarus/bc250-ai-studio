"""Candidate management API factory; not registered in the running Studio app.

The caller must provide a fully reconciled, singleton worker and expose this app
only through an authenticated private backend boundary. The factory does not
create root privileges, sockets, credentials, or a production service.
"""

import asyncio
import hmac
import sqlite3
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from app.core.middleware import BodyLimit
from app.services.switch_operations import IdempotencyConflict, OperationConflict
from app.services.switch_worker import ReconciliationError

PRINCIPAL = "single-admin"


class SwitchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


def create_model_management_app(worker, api_key):
    if not isinstance(api_key, str) or len(api_key) < 24:
        raise ValueError("Dedicated model-management key must be at least 24 characters")

    @asynccontextmanager
    async def lifespan(app):
        app.state.tasks = set()
        app.state.worker_healthy = True
        pending = worker.startup()
        try:
            # Only this service-owned principal is supported for now. Never trust
            # a caller-supplied ID as identity.
            if pending and worker.store.get(PRINCIPAL, pending["id"]) is None:
                raise RuntimeError("Unrecognized operation principal")
            if pending and pending["state"] == "queued":
                schedule(app, pending["id"])
            yield
        finally:
            if app.state.tasks:
                await asyncio.gather(*tuple(app.state.tasks), return_exceptions=True)
            worker.close()

    app = FastAPI(title="BC-250 model management (candidate)", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(BodyLimit, limit=4096)

    def schedule(app, operation_id):
        task = asyncio.create_task(worker.run(PRINCIPAL, operation_id))
        app.state.tasks.add(task)

        def finished(done):
            app.state.tasks.discard(done)
            if done.cancelled() or done.exception() is not None:
                app.state.worker_healthy = False

        task.add_done_callback(finished)

    @app.middleware("http")
    async def authorize(request: Request, call_next):
        authorization = request.headers.get("authorization")
        if (not authorization or not authorization.startswith("Bearer ")
                or not hmac.compare_digest(authorization[7:].encode(), api_key.encode())):
            return JSONResponse({"code": "invalid_credential"}, status_code=401,
                                headers={"WWW-Authenticate": "Bearer"})
        return await call_next(request)

    @app.get("/api/v1/llm/models")
    async def list_models():
        try:
            models = await worker.switch.service.installed()
            current = await worker.switch.service.current()
        except Exception:
            return JSONResponse({"code": "service_unavailable"}, status_code=503)
        return {"models": [{"name": name, "current": name == current} for name in models],
                "current": current}

    @app.post("/api/v1/llm/switches", status_code=202)
    async def switch_model(body: SwitchRequest, request: Request,
                           idempotency_key: Annotated[str, Header(alias="Idempotency-Key")]):
        if not request.app.state.worker_healthy:
            return JSONResponse({"code": "service_unavailable"}, status_code=503)
        try:
            operation, created = await worker.submit(PRINCIPAL, body.model, idempotency_key)
        except IdempotencyConflict:
            return JSONResponse({"code": "idempotency_conflict"}, status_code=409)
        except OperationConflict:
            return JSONResponse({"code": "switch_busy_or_recovery_required"}, status_code=409)
        except ValueError:
            return JSONResponse({"code": "invalid_model_or_key"}, status_code=422)
        except (ReconciliationError, OSError, sqlite3.Error):
            return JSONResponse({"code": "service_unavailable"}, status_code=503)
        if created:
            schedule(request.app, operation["id"])
        return operation

    @app.get("/api/v1/llm/switches/{operation_id}")
    async def get_switch(operation_id: str):
        try:
            operation = worker.store.get(PRINCIPAL, operation_id)
        except ValueError:
            raise HTTPException(404, "Operation not found") from None
        except (OSError, sqlite3.Error):
            return JSONResponse({"code": "service_unavailable"}, status_code=503)
        if operation is None:
            raise HTTPException(404, "Operation not found")
        return operation

    return app
