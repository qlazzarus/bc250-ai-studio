"""Authenticated HTTP facade for the model control Unix socket (opt-in candidate)."""

import hmac
from typing import Annotated

from fastapi import FastAPI, Header, Request
from starlette.responses import JSONResponse

from app.api.model_management import SwitchRequest
from app.core.middleware import BodyLimit


def create_remote_model_management_app(client, api_key):
    if not isinstance(api_key, str) or len(api_key) < 24:
        raise ValueError("Dedicated model-management key must be at least 24 characters")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(BodyLimit, limit=4096)

    @app.middleware("http")
    async def authorize(request: Request, call_next):
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:].encode(), api_key.encode()):
            return JSONResponse({"code": "invalid_credential"}, 401,
                                headers={"WWW-Authenticate": "Bearer"})
        return await call_next(request)

    async def call(operation, **kwargs):
        try:
            result = await client.request(operation, **kwargs)
        except Exception:
            return JSONResponse({"code": "service_unavailable"}, 503)
        error = result.get("error")
        if error:
            status = {"not_found": 404, "invalid_request": 422,
                      "idempotency_conflict": 409,
                      "switch_busy_or_recovery_required": 409}.get(error, 503)
            code = error if status != 503 or error == "switch_disabled" else "service_unavailable"
            if code == "invalid_request":
                code = "invalid_model_or_key"
            return JSONResponse({"code": code}, status)
        return result

    @app.get("/api/v1/llm/models")
    async def models():
        return await call("models")

    @app.post("/api/v1/llm/switches", status_code=202)
    async def submit(body: SwitchRequest,
                     idempotency_key: Annotated[str, Header(alias="Idempotency-Key")]):
        return await call("submit", model=body.model, idempotency_key=idempotency_key)

    @app.get("/api/v1/llm/switches/{operation_id}")
    async def status(operation_id: str):
        return await call("get", id=operation_id)

    return app
