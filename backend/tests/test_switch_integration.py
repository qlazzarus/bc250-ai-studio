"""Exercise the assembled candidates without systemd, real models or a GPU."""

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from app.core.config import GateSettings
from app.core.files import FileLock
from app.gate import create_gate_app
from app.services.llm import SystemdLLM
from app.services.model_control import ActiveModelWriter, ModelRegistry
from app.services.model_switch import (
    ModelSwitch,
    SwitchFailed,
    SwitchJournal,
    SwitchRecoveryRequired,
)
from app.services.switch_adapters import AsyncGPULock, SwitchGate
from app.services.systemd_model import SystemdModelService

KEY = "test-gate-key-at-least-24-characters"


@asynccontextmanager
async def environment(tmp_path, settings, monkeypatch, failures=()):
    # Tests run unprivileged; production paths require the real root checks.
    monkeypatch.setattr(FileLock, "_check_trusted_directory", staticmethod(lambda info: None))
    monkeypatch.setattr(ModelRegistry, "_check_file", staticmethod(lambda info: None))
    base = tmp_path / "models-config"
    (base / "models").mkdir(parents=True)
    for name in ("old", "new"):
        path = tmp_path / f"{name}.gguf"
        path.write_bytes(b"test model")
        (base / "models" / f"{name}.conf").write_text(
            f"MODEL_NAME={name}\nMODEL_PATH={path}\nGPU_LAYERS=99\n"
        )
    (base / "active-model.conf").write_text("ACTIVE_MODEL=old\n")
    registry = ModelRegistry(base)

    class Systemctl:
        def __init__(self):
            self.loaded = "old"
            self.calls = []

        async def restart(self, timeout):
            target = registry.current_model()
            self.calls.append(target)
            if target in failures:
                raise RuntimeError("simulated restart failure")
            self.loaded = target

        async def show(self, timeout):
            return {"LoadState": "loaded", "KillMode": "control-group", "Job": "",
                    "ActiveState": "active", "MainPID": "42"}

    systemctl = Systemctl()
    path = tmp_path / "gate.json"
    path.write_text('{"holds": []}')
    app = create_gate_app(GateSettings(api_key=KEY, state_path=path))
    settings.llm_service = "test.service"
    settings.allowed_services = ["test.service"]
    settings.admission_url = "http://127.0.0.1:8081/control"
    settings.admission_key = KEY
    settings.llm_url = "http://127.0.0.1:8080"
    settings.drain_timeout = 2

    async with app.router.lifespan_context(app):
        gate_transport = httpx.ASGITransport(app=app)

        class Router(httpx.AsyncBaseTransport):
            async def handle_async_request(self, request):
                if request.url.port == 8081:
                    return await gate_transport.handle_async_request(request)
                if request.url.path == "/slots":
                    return httpx.Response(200, json=[{"is_processing": False}])
                if request.url.path == "/health":
                    return httpx.Response(200, json={"status": "ok"})
                if request.url.path == "/v1/models":
                    return httpx.Response(200, json={"data": [
                        {"id": registry.model_id(systemctl.loaded)}
                    ]})
                return httpx.Response(404)

        original, router = httpx.AsyncClient, Router()
        monkeypatch.setattr(
            httpx, "AsyncClient",
            lambda **kwargs: original(transport=router, **{k: v for k, v in kwargs.items()
                                                          if k != "transport"}),
        )
        gpu_path = tmp_path / "gpu.lock"
        journal_path = tmp_path / "switch.json"
        journal_path.write_text("{}")
        journal = SwitchJournal(journal_path)
        lock = AsyncGPULock(gpu_path, poll_interval=0.01, file_lock=FileLock(gpu_path))
        gate = SwitchGate(settings.admission_url, KEY, SystemdLLM(settings), transport=router)
        service = SystemdModelService(registry, ActiveModelWriter(registry), systemctl,
                                      health_timeout=1, settle_timeout=1, transport=router)
        yield ModelSwitch(journal, lock, gate, service), app, journal, systemctl, gpu_path, registry


async def test_switch_waits_for_image_and_active_chat(settings, tmp_path, monkeypatch):
    async with environment(tmp_path, settings, monkeypatch) as env:
        switch, app, journal, systemctl, gpu_path, registry = env
        await app.state.admission.enter()
        await app.state.admission.set_paused(True)  # Independent administrator hold.
        image_lock = FileLock(gpu_path)
        image_lock.acquire()
        task = asyncio.create_task(switch.switch("new"))
        try:
            await asyncio.sleep(0.05)
            assert journal.read() == {} and systemctl.calls == []
            image_lock.release()
            for _ in range(100):
                if any(h.startswith("switch-") for h in app.state.admission.holds):
                    break
                await asyncio.sleep(0.01)
            assert any(h.startswith("switch-") for h in app.state.admission.holds)
            assert systemctl.calls == []  # The admitted chat has not finished.
            await app.state.admission.leave()
            assert await asyncio.wait_for(task, 3) == "succeeded"
            assert registry.current_model() == "new" and journal.read() == {}
            assert app.state.admission.holds == {"legacy"}
        finally:
            image_lock.release()
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("failures,error,holds", [
    (("new",), SwitchFailed, {"legacy"}),
    (("new", "old"), SwitchRecoveryRequired, None),
])
async def test_restart_failure_preserves_gate_until_verified_recovery(
    settings, tmp_path, monkeypatch, failures, error, holds
):
    async with environment(tmp_path, settings, monkeypatch, failures) as env:
        switch, app, journal, systemctl, _, registry = env
        await app.state.admission.set_paused(True)
        with pytest.raises(error):
            await switch.switch("new")
        assert systemctl.calls == ["new", "old"]
        assert registry.current_model() == "old"
        if holds is None:
            assert journal.read()["mutation_started"]
            assert "legacy" in app.state.admission.holds
            assert len(app.state.admission.holds) == 2
        else:
            assert journal.read() == {} and app.state.admission.holds == holds


@pytest.mark.parametrize("failures, expected_state, expected_model", [
    ((), "succeeded", "new"),
    (("new",), "failed_rolled_back", "old"),
    (("new", "old"), "recovery_required", "old"),
])
async def test_http_through_socket_worker_real_gate_and_registry(
    settings, tmp_path, monkeypatch, failures, expected_state, expected_model
):
    import tempfile

    from app.api.remote_model_management import create_remote_model_management_app
    from app.services.model_control_bridge import ModelControlBridge, ModelControlClient
    from app.services.switch_operations import SwitchOperations
    from app.services.switch_worker import SwitchWorker

    # environment routes the switch adapters to the gate and mock llama; retain
    # the real client class for the outer HTTP API transport.
    http_client = httpx.AsyncClient
    async with environment(tmp_path, settings, monkeypatch, failures) as env:
        switch, gate_app, journal, systemctl, gpu_path, registry = env
        store = SwitchOperations(tmp_path / "operations.sqlite3")
        worker = SwitchWorker(store, switch, FileLock(tmp_path / "worker.lock"))
        bridge = ModelControlBridge(worker, os.getuid())
        bridge.start()
        with tempfile.TemporaryDirectory(prefix="s-") as directory:
            path = str(Path(directory) / "control.sock")
            server = await asyncio.start_unix_server(bridge.handle, path=path)
            api = create_remote_model_management_app(
                ModelControlClient(path), "test-management-key-at-least-24-characters"
            )
            headers = {"Authorization": "Bearer test-management-key-at-least-24-characters",
                       "Idempotency-Key": "request-1"}
            image_lock = FileLock(gpu_path)
            image_lock.acquire()
            await gate_app.state.admission.enter()
            await gate_app.state.admission.set_paused(True)
            try:
                async with http_client(transport=httpx.ASGITransport(app=api),
                                       base_url="http://test") as client:
                    response = await client.post("/api/v1/llm/switches", headers=headers,
                                                 json={"model": "new"})
                    assert response.status_code == 202
                    operation_id = response.json()["id"]
                    await asyncio.sleep(0.05)
                    assert systemctl.calls == [] and journal.read() == {}
                    image_lock.release()
                    for _ in range(100):
                        if any(h.startswith("switch-") for h in gate_app.state.admission.holds):
                            break
                        await asyncio.sleep(0.01)
                    assert systemctl.calls == []
                    await gate_app.state.admission.leave()
                    for _ in range(300):
                        result = (await client.get(f"/api/v1/llm/switches/{operation_id}",
                                                   headers=headers)).json()
                        if result["state"] == expected_state:
                            break
                        await asyncio.sleep(0.01)
                    assert result["state"] == expected_state
                    assert registry.current_model() == expected_model
                    models = (await client.get("/api/v1/llm/models", headers=headers)).json()
                    assert models["current"] == expected_model
                    assert "legacy" in gate_app.state.admission.holds
                    if expected_state == "recovery_required":
                        assert journal.read()["mutation_started"]
                        assert any(h.startswith("switch-") for h in gate_app.state.admission.holds)
                    else:
                        assert journal.read() == {} and gate_app.state.admission.holds == {"legacy"}
            finally:
                image_lock.release()
                server.close()
                await server.wait_closed()
                await bridge.close()
