"""A local admission proxy that keeps new LLM requests out during GPU switches.

The proxy deliberately buffers an upstream response. It therefore counts a streaming
chat response as active until the upstream finishes, which is the safe boundary for
stopping the llama service. Existing clients must use this proxy rather than 8080.
"""

import asyncio
import hmac
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response

from app.core.config import GateSettings

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


class Admission:
    def __init__(self):
        self.condition = asyncio.Condition()
        self.paused = False
        self.active = 0
        self.waiting = 0

    async def enter(self):
        async with self.condition:
            while self.paused:
                self.waiting += 1
                try:
                    await self.condition.wait()
                finally:
                    self.waiting -= 1
            self.active += 1

    async def leave(self):
        async with self.condition:
            self.active -= 1
            self.condition.notify_all()

    async def status(self):
        async with self.condition:
            return {
                "paused": self.paused,
                "waiting_requests": self.waiting,
                "active_requests": self.active,
            }

    async def set_paused(self, paused):
        async with self.condition:
            self.paused = paused
            if not paused:
                self.condition.notify_all()
            return {
                "paused": self.paused,
                "waiting_requests": self.waiting,
                "active_requests": self.active,
            }


def create_gate_app(settings: GateSettings | None = None, transport=None):
    settings = settings or GateSettings()

    @asynccontextmanager
    async def lifespan(app):
        app.state.admission = Admission()
        app.state.client = httpx.AsyncClient(timeout=settings.proxy_timeout, transport=transport)
        try:
            yield
        finally:
            await app.state.client.aclose()

    app = FastAPI(
        title="BC-250 LLM admission gate",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    def control_auth(authorization: str | None):
        token = authorization.removeprefix("Bearer ") if authorization else ""
        if (
            not authorization
            or not authorization.startswith("Bearer ")
            or not hmac.compare_digest(token.encode(), settings.api_key.encode())
        ):
            raise HTTPException(
                401, "Invalid gate credential", headers={"WWW-Authenticate": "Bearer"}
            )

    @app.get("/control")
    async def control_get(authorization: str | None = Header(default=None)):
        control_auth(authorization)
        return await app.state.admission.status()

    @app.put("/control")
    async def control_put(body: dict, authorization: str | None = Header(default=None)):
        control_auth(authorization)
        if set(body) != {"paused"} or type(body["paused"]) is not bool:
            raise HTTPException(422, "Expected exactly {paused: boolean}")
        return await app.state.admission.set_paused(body["paused"])

    @app.api_route(
        "/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]
    )
    async def proxy(path: str, request: Request):
        await app.state.admission.enter()
        try:
            headers = {
                key: value
                for key, value in request.headers.items()
                if key.lower() not in HOP_BY_HOP_HEADERS
            }
            headers["x-forwarded-for"] = request.client.host if request.client else ""
            try:
                upstream = await app.state.client.request(
                    request.method,
                    settings.upstream_url.rstrip("/") + "/" + path,
                    params=request.query_params,
                    headers=headers,
                    content=await request.body(),
                )
            except httpx.HTTPError:
                return Response(status_code=503, content=b"LLM upstream unavailable")
            response_headers = {
                key: value
                for key, value in upstream.headers.items()
                if key.lower() not in HOP_BY_HOP_HEADERS
            }
            return Response(
                upstream.content,
                status_code=upstream.status_code,
                headers=response_headers,
                media_type=upstream.headers.get("content-type"),
            )
        finally:
            await app.state.admission.leave()

    return app
