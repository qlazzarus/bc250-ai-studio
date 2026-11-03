"""A local admission proxy that keeps new LLM requests out during GPU switches.

The proxy deliberately buffers an upstream response. It therefore counts a streaming
chat response as active until the upstream finishes, which is the safe boundary for
stopping the llama service. Existing clients must use this proxy rather than 8080.
"""

import asyncio
import hmac
import json
import re
import secrets
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response

from app.core.config import GateSettings
from app.core.files import atomic_json

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
    def __init__(self, state_path=None):
        self.condition = asyncio.Condition()
        self.state_path = state_path
        self.holds = set()
        self.deployment_generation = None
        if state_path is not None:
            # Provisioning must create this file explicitly. Never interpret a
            # missing or malformed durable state as permission to admit traffic.
            state = json.loads(state_path.read_text())
            if (not isinstance(state, dict) or set(state) not in ({"holds"}, {"holds", "deployment_generation"})
                    or not isinstance(state["holds"], list)
                    or any(not isinstance(x, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", x)
                           for x in state["holds"])):
                raise RuntimeError("Invalid durable gate state")
            self.holds = set(state["holds"])
            generation = state.get("deployment_generation")
            if "deployment_generation" in state and (not isinstance(generation, str)
                    or not re.fullmatch(r"[a-f0-9]{32}", generation)
                    or "admin-deployment" not in self.holds):
                raise RuntimeError("Invalid deployment hold generation")
            self.deployment_generation = generation
        self.active = 0
        self.waiting = 0

    @property
    def paused(self):
        return bool(self.holds)

    def persist(self, holds, *, generation=None):
        if self.state_path is not None:
            state = {"holds": sorted(holds)}
            if generation is not None:
                state["deployment_generation"] = generation
            atomic_json(self.state_path, state)

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

    async def status(self, *, include_holds=False):
        async with self.condition:
            state = {
                "paused": self.paused,
                "waiting_requests": self.waiting,
                "active_requests": self.active,
            }
            if include_holds:
                state.update(protocol=2, durable=True, holds=sorted(self.holds))
                if self.deployment_generation is not None:
                    state["deployment_generation"] = self.deployment_generation
            return state

    async def set_paused(self, paused):
        async with self.condition:
            holds = self.holds.copy()
            if paused:
                holds.add("legacy")
                # A failed write must not open admission in this process.
                self.holds.add("legacy")
            else:
                holds.discard("legacy")
            self.persist(holds, generation=self.deployment_generation)
            self.holds = holds
            if not self.paused:
                self.condition.notify_all()
            return {
                "paused": self.paused,
                "waiting_requests": self.waiting,
                "active_requests": self.active,
            }

    async def hold(self, hold_id, acquire, *, exclusive=False, expected_generation=None):
        if self.state_path is None:
            raise RuntimeError("Durable gate state is not configured")
        async with self.condition:
            holds = self.holds.copy()
            if exclusive and hold_id in holds:
                raise HTTPException(409, "Hold already exists")
            generation = self.deployment_generation
            if hold_id == "admin-deployment" and not acquire and expected_generation is not None and generation is None:
                raise HTTPException(412, "Deployment hold generation changed")
            if hold_id == "admin-deployment" and not acquire and generation is not None:
                if expected_generation is None or not hmac.compare_digest(expected_generation, generation):
                    raise HTTPException(412, "Deployment hold generation changed")
                generation = None
            if acquire:
                if exclusive:
                    generation = secrets.token_hex(16)
                    self.deployment_generation = generation
                holds.add(hold_id)
                self.holds.add(hold_id)
            else:
                holds.discard(hold_id)
            self.persist(holds, generation=generation)
            self.holds = holds
            self.deployment_generation = generation
            if not self.paused:
                self.condition.notify_all()
            result = {"paused": self.paused, "held": hold_id in self.holds}
            if exclusive:
                result["created"] = True
                result["generation"] = generation
            return result


def create_gate_app(settings: GateSettings | None = None, transport=None):
    settings = settings or GateSettings()

    @asynccontextmanager
    async def lifespan(app):
        app.state.admission = Admission(settings.state_path)
        if settings.owned_control:
            await app.state.admission.hold("startup", True)
        app.state.client = httpx.AsyncClient(timeout=settings.proxy_timeout, transport=transport,
                                            trust_env=False)
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
        keys = {"admin": settings.api_key}
        if settings.owned_control:
            keys.update(studio=settings.studio_key, switch=settings.switch_key)
        if authorization and authorization.startswith("Bearer "):
            for role, key in keys.items():
                if hmac.compare_digest(token.encode(), key.encode()):
                    return role
        raise HTTPException(401, "Invalid gate credential",
                            headers={"WWW-Authenticate": "Bearer"})

    @app.get("/control")
    async def control_get(authorization: str | None = Header(default=None)):
        control_auth(authorization)
        return await app.state.admission.status(include_holds=settings.owned_control)

    @app.get("/control/identity")
    async def control_identity(authorization: str | None = Header(default=None)):
        role = control_auth(authorization)
        return {"role": role, "protocol": 2 if settings.owned_control else 1}

    @app.put("/control")
    async def control_put(body: dict, authorization: str | None = Header(default=None)):
        role = control_auth(authorization)
        if role != "admin":
            raise HTTPException(403, "Administrator control required")
        if set(body) != {"paused"} or type(body["paused"]) is not bool:
            raise HTTPException(422, "Expected exactly {paused: boolean}")
        return await app.state.admission.set_paused(body["paused"])

    @app.put("/control/holds/{hold_id}")
    @app.delete("/control/holds/{hold_id}")
    async def control_hold(hold_id: str, request: Request,
                           authorization: str | None = Header(default=None),
                           if_none_match: str | None = Header(default=None),
                           if_match: str | None = Header(default=None)):
        role = control_auth(authorization)
        if hold_id == "legacy" or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", hold_id):
            raise HTTPException(422, "Invalid hold ID")
        if settings.owned_control:
            allowed = ((role == "admin" and (hold_id == "startup" or hold_id.startswith("admin-")))
                       or (role in {"studio", "switch"}
                           and re.fullmatch(role + r"-[0-9a-f]{32}", hold_id)))
            if not allowed:
                raise HTTPException(403, "Hold belongs to another controller")
        if settings.state_path is None:
            raise HTTPException(503, "Durable gate state is not configured")
        if if_none_match is not None and not (settings.owned_control and role == "admin"
                and hold_id == "admin-deployment" and request.method == "PUT"
                and if_none_match == "*"):
            raise HTTPException(400, "Unsupported hold precondition")
        if if_match is not None and not (settings.owned_control and role == "admin"
                and hold_id == "admin-deployment" and request.method == "DELETE"
                and re.fullmatch(r"[a-f0-9]{32}", if_match)):
            raise HTTPException(400, "Unsupported hold precondition")
        return await app.state.admission.hold(hold_id, request.method == "PUT",
                                              exclusive=if_none_match == "*", expected_generation=if_match)

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
