import asyncio

import httpx
import pytest
from app.core.config import GateSettings
from app.gate import create_gate_app
from fastapi.testclient import TestClient

KEY = "gate-test-key-12345678901234567890"
HEADERS = {"Authorization": f"Bearer {KEY}"}


@pytest.fixture
def gate():
    async def upstream(request):
        if request.url.path == "/v1/chat/completions":
            return httpx.Response(
                200, json={"method": request.method, "auth": request.headers.get("authorization")}
            )
        return httpx.Response(404)

    settings = GateSettings(api_key=KEY)
    with TestClient(create_gate_app(settings, transport=httpx.MockTransport(upstream))) as client:
        yield client


def test_control_requires_separate_key(gate):
    assert gate.get("/control").status_code == 401
    assert gate.put("/control", headers=HEADERS, json={"paused": "yes"}).status_code == 422
    status = gate.get("/control", headers=HEADERS).json()
    assert status == {"paused": False, "waiting_requests": 0, "active_requests": 0}


def test_proxy_forwards_llm_auth_and_blocks_while_paused(gate):
    response = gate.post("/v1/chat/completions", headers={"Authorization": "Bearer llama-key"})
    assert response.json() == {"method": "POST", "auth": "Bearer llama-key"}
    assert gate.put("/control", headers=HEADERS, json={"paused": True}).json()["paused"] is True

    async def request():
        return await asyncio.to_thread(gate.get, "/v1/models")

    async def scenario():
        task = asyncio.create_task(request())
        await asyncio.sleep(0.02)
        assert gate.get("/control", headers=HEADERS).json()["waiting_requests"] == 1
        gate.put("/control", headers=HEADERS, json={"paused": False})
        assert (await task).status_code == 404

    asyncio.run(scenario())
