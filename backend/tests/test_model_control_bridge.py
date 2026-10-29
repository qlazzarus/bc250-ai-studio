import asyncio
import os
import tempfile

import httpx
import pytest
from app.api.remote_model_management import create_remote_model_management_app
from app.core.files import FileLock
from app.services.model_control_bridge import ModelControlBridge, ModelControlClient
from app.services.model_switch import ModelSwitch, SwitchJournal
from app.services.switch_operations import SwitchOperations
from app.services.switch_worker import SwitchWorker

KEY = "dedicated-management-key-for-testing"
AUTH = {"Authorization": "Bearer " + KEY}


@pytest.fixture
def socket_path():
    with tempfile.TemporaryDirectory(prefix="s-") as directory:
        yield os.path.join(directory, "socket")


class Gate:
    async def acquire(self, hold):
        pass

    async def drain(self):
        pass

    async def release(self, hold):
        pass


class Service:
    def __init__(self):
        self.model = "old"
        self.started = asyncio.Event()
        self.proceed = asyncio.Event()

    async def installed(self):
        return ["old", "new"]

    async def current(self):
        return self.model

    async def apply(self, model):
        self.started.set()
        await self.proceed.wait()
        self.model = model

    async def healthy(self, model):
        assert self.model == model


async def test_http_socket_worker_lifecycle_and_conflict(tmp_path, socket_path):
    journal_path = tmp_path / "journal"
    journal_path.write_text("{}")
    service = Service()
    store = SwitchOperations(tmp_path / "operations.db")
    switch = ModelSwitch(SwitchJournal(journal_path), asyncio.Lock(), Gate(), service)
    worker = SwitchWorker(store, switch, FileLock(tmp_path / "worker.lock"))
    bridge = ModelControlBridge(worker, os.getuid())
    bridge.start()
    server = await asyncio.start_unix_server(bridge.handle, path=str(socket_path))
    app = create_remote_model_management_app(ModelControlClient(socket_path), KEY)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://test") as client:
            assert (await client.get("/api/v1/llm/models")).status_code == 401
            assert (await client.get("/api/v1/llm/models", headers=AUTH)).json()["current"] == "old"
            headers = {**AUTH, "Idempotency-Key": "one"}
            r = await client.post("/api/v1/llm/switches", headers=headers, json={"model": "new"})
            assert r.status_code == 202
            op = r.json()["id"]
            await asyncio.wait_for(service.started.wait(), 2)
            r = await client.post("/api/v1/llm/switches", headers=headers, json={"model": "new"})
            assert r.json()["id"] == op
            r = await client.post("/api/v1/llm/switches",
                                  headers={**AUTH, "Idempotency-Key": "two"}, json={"model": "old"})
            assert r.status_code == 409
            assert (await client.get(f"/api/v1/llm/switches/{op}", headers=AUTH)).json()["state"] == "switching"
            service.proceed.set()
            for _ in range(100):
                status = (await client.get(f"/api/v1/llm/switches/{op}", headers=AUTH)).json()
                if status["state"] == "succeeded":
                    break
                await asyncio.sleep(0.01)
            assert status["state"] == "succeeded"
            assert (await client.get("/api/v1/llm/models", headers=AUTH)).json()["current"] == "new"
    finally:
        service.proceed.set()
        server.close()
        await server.wait_closed()
        await bridge.close()


async def test_unix_peer_and_request_boundaries(socket_path):
    class Unused:
        pass

    path = socket_path
    bridge = ModelControlBridge(Unused(), os.getuid() + 1)
    server = await asyncio.start_unix_server(bridge.handle, path=str(path))
    try:
        assert await ModelControlClient(path).request("models") == {"error": "forbidden"}
        bridge.allowed_uid = os.getuid()
        assert await ModelControlClient(path).request("exec", command="id") == {"error": "invalid_request"}
    finally:
        server.close()
        await server.wait_closed()


def _crash_worker(socket_path, state_dir, checkpoint="apply"):
    """A separate process with file-backed gate and a simulated stalled restart."""
    import json
    from pathlib import Path

    from app.services.switch_adapters import AsyncGPULock

    directory = Path(state_dir)

    async def checkpoint_at(name):
        if checkpoint == name:
            (directory / "started").write_text(name)
            await asyncio.Event().wait()

    class PersistentGate:
        async def acquire(self, hold):
            await checkpoint_at("before_hold")
            (directory / "hold").write_text(hold)
            await checkpoint_at("after_hold")

        async def drain(self):
            await checkpoint_at("drain")

        async def release(self, hold):
            (directory / "hold").unlink(missing_ok=True)
            await checkpoint_at("after_release")

    class StalledService(Service):
        async def apply(self, model):
            await checkpoint_at("apply")
            self.model = model
            (directory / "active").write_text(model)

        async def healthy(self, model):
            await checkpoint_at("health")
            assert self.model == model

    async def run():
        store = SwitchOperations(directory / "operations.db")
        switch = ModelSwitch(SwitchJournal(directory / "journal"),
                             AsyncGPULock(directory / "gpu", file_lock=FileLock(directory / "gpu")),
                             PersistentGate(), StalledService())
        worker = SwitchWorker(store, switch, FileLock(directory / "worker.lock"))
        bridge = ModelControlBridge(worker, os.getuid())
        bridge.start()
        server = await asyncio.start_unix_server(bridge.handle, path=socket_path)
        (directory / "ready").write_text(json.dumps(True))
        async with server:
            await server.serve_forever()

    asyncio.run(run())


@pytest.mark.parametrize("checkpoint,stage,hold_expected", [
    ("before_hold", "pausing", False),
    ("after_hold", "pausing", True),
    ("drain", "draining", True),
    ("apply", "switching", True),
    ("health", "verifying", True),
    ("after_release", "verifying", False),
])
async def test_process_kill_preserves_recovery_barrier(
    tmp_path, socket_path, checkpoint, stage, hold_expected
):
    import json
    import multiprocessing
    import signal

    (tmp_path / "journal").write_text("{}")
    context = multiprocessing.get_context("spawn")
    process = context.Process(target=_crash_worker, args=(socket_path, str(tmp_path), checkpoint))
    process.start()
    try:
        for _ in range(300):
            if (tmp_path / "ready").exists():
                break
            await asyncio.sleep(0.01)
        assert (tmp_path / "ready").exists()
        client = ModelControlClient(socket_path)
        result = await client.request("submit", model="new", idempotency_key="crash-test")
        for _ in range(300):
            if (tmp_path / "started").exists():
                break
            await asyncio.sleep(0.01)
        assert (tmp_path / "started").exists()
        os.kill(process.pid, signal.SIGKILL)
        process.join(timeout=5)
        assert process.exitcode is not None
        journal = json.loads((tmp_path / "journal").read_text())
        assert journal["operation_id"] == result["id"] and journal["stage"] == stage
        assert journal["mutation_started"] == (stage in {"switching", "verifying"})
        assert (tmp_path / "hold").exists() == hold_expected
        if hold_expected:
            assert (tmp_path / "hold").read_text() == journal["hold_id"]
        if checkpoint == "after_release":
            # The hold is released only after the target passed health checks.
            assert (tmp_path / "active").read_text() == "new"
        (tmp_path / "ready").unlink()
        restarted = context.Process(target=_crash_worker, args=(socket_path, str(tmp_path)))
        restarted.start()
        try:
            for _ in range(300):
                if (tmp_path / "ready").exists():
                    break
                await asyncio.sleep(0.01)
            assert (tmp_path / "ready").exists()
            status = await client.request("get", id=result["id"])
            assert status["state"] == "recovery_required"
            assert await client.request("submit", model="old", idempotency_key="new") == {
                "error": "switch_busy_or_recovery_required"
            }
            assert (tmp_path / "hold").exists() == hold_expected
        finally:
            restarted.terminate()
            restarted.join(timeout=5)
    finally:
        if process.is_alive():
            process.terminate()
            process.join(timeout=5)
