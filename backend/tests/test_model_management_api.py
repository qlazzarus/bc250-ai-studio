import asyncio
import sqlite3

import httpx
import pytest
from app.api.model_management import PRINCIPAL, create_model_management_app
from app.core.files import FileLock
from app.services.model_switch import ModelSwitch, SwitchJournal
from app.services.switch_operations import SwitchOperations
from app.services.switch_worker import SwitchWorker

KEY = "model-management-test-key-1234567890"
AUTH = {"Authorization": f"Bearer {KEY}"}


class Gate:
    def __init__(self):
        self.holds = {"legacy"}

    async def acquire(self, hold):
        self.holds.add(hold)

    async def drain(self):
        pass

    async def release(self, hold):
        self.holds.discard(hold)


class Service:
    def __init__(self):
        self.model = "old"
        self.started, self.release = asyncio.Event(), asyncio.Event()

    async def installed(self):
        return ["old", "new"]

    async def current(self):
        return self.model

    async def ensure_settled(self):
        pass

    async def apply(self, model):
        self.started.set()
        await self.release.wait()
        self.model = model

    async def healthy(self, model):
        if self.model != model:
            raise RuntimeError("wrong model")


@pytest.fixture
def components(tmp_path):
    path = tmp_path / "switch.json"
    path.write_text("{}")
    gate, service = Gate(), Service()
    store = SwitchOperations(tmp_path / "operations.sqlite3")
    switch = ModelSwitch(SwitchJournal(path), asyncio.Lock(), gate, service)
    worker = SwitchWorker(store, switch, FileLock(tmp_path / "worker.lock"))
    return worker, store, gate, service


async def test_management_auth_idempotency_progress_and_conflict(components):
    worker, store, gate, service = components
    app = create_model_management_app(worker, KEY)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            assert (await client.get("/api/v1/llm/models")).status_code == 401
            assert (await client.post("/api/v1/llm/switches", content=b"invalid")).status_code == 401
            models = await client.get("/api/v1/llm/models", headers=AUTH)
            assert models.json()["current"] == "old"
            assert (await client.post("/api/v1/llm/switches", headers=AUTH,
                                      json={"model": "new"})).status_code == 422
            async def oversized():
                yield b"a" * 3000
                yield b"b" * 3000

            too_large = await client.post("/api/v1/llm/switches", headers=AUTH,
                                          content=oversized())
            assert too_large.status_code == 413
            headers = {**AUTH, "Idempotency-Key": "request-1"}
            response = await client.post("/api/v1/llm/switches", headers=headers,
                                         json={"model": "new"})
            assert response.status_code == 202
            operation = response.json()
            assert "principal" not in operation and "idempotency_key" not in operation
            try:
                await asyncio.wait_for(service.started.wait(), 2)
                status = await client.get(f"/api/v1/llm/switches/{operation['id']}", headers=AUTH)
                assert status.json()["state"] == "switching"
                repeat = await client.post("/api/v1/llm/switches", headers=headers,
                                            json={"model": "new"})
                assert repeat.json()["id"] == operation["id"]
                conflict = await client.post("/api/v1/llm/switches",
                    headers={**AUTH, "Idempotency-Key": "request-2"}, json={"model": "old"})
                assert conflict.status_code == 409
                invalid = await client.post("/api/v1/llm/switches", headers=headers,
                                            json={"model": "new", "command": "id"})
                assert invalid.status_code == 422
            finally:
                service.release.set()
            for _ in range(100):
                if store.get(PRINCIPAL, operation["id"])["state"] == "succeeded":
                    break
                await asyncio.sleep(0.01)
            assert store.get(PRINCIPAL, operation["id"])["state"] == "succeeded"
            assert gate.holds == {"legacy"} and service.model == "new"


async def test_queued_request_is_resumed_after_service_restart(components):
    worker, store, _, service = components
    operation, _ = store.submit(PRINCIPAL, "new", "request-1")
    service.release.set()
    app = create_model_management_app(worker, KEY)
    async with app.router.lifespan_context(app):
        for _ in range(100):
            if store.get(PRINCIPAL, operation["id"])["state"] == "succeeded":
                break
            await asyncio.sleep(0.01)
        assert store.get(PRINCIPAL, operation["id"])["state"] == "succeeded"


async def test_unexpected_worker_failure_blocks_new_requests(components):
    worker, _, _, _ = components

    async def fail(*args):
        raise RuntimeError("private error must not be returned")

    worker.run = fail
    app = create_model_management_app(worker, KEY)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://test") as client:
            response = await client.post("/api/v1/llm/switches",
                headers={**AUTH, "Idempotency-Key": "request-1"}, json={"model": "new"})
            assert response.status_code == 202
            for _ in range(100):
                if not app.state.worker_healthy:
                    break
                await asyncio.sleep(0.01)
            response = await client.post("/api/v1/llm/switches",
                headers={**AUTH, "Idempotency-Key": "request-2"}, json={"model": "old"})
            assert response.status_code == 503
            assert response.json() == {"code": "service_unavailable"}


async def test_storage_failure_returns_safe_unavailable_error(components, monkeypatch):
    worker, store, _, _ = components
    app = create_model_management_app(worker, KEY)
    async with app.router.lifespan_context(app):
        def fail(*args):
            raise sqlite3.OperationalError("private database path")

        monkeypatch.setattr(store, "get", fail)
        monkeypatch.setattr(store, "find_idempotent", fail)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://test") as client:
            status = await client.get("/api/v1/llm/switches/" + "a" * 32, headers=AUTH)
            assert status.status_code == 503 and status.json() == {"code": "service_unavailable"}
            submit = await client.post("/api/v1/llm/switches",
                headers={**AUTH, "Idempotency-Key": "request-1"}, json={"model": "new"})
            assert submit.status_code == 503 and submit.json() == {"code": "service_unavailable"}


def test_dedicated_key_must_be_long_enough(components):
    with pytest.raises(ValueError):
        create_model_management_app(components[0], "short")
