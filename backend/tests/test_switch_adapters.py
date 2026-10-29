import asyncio

import httpx
import pytest
from app.core.config import GateSettings
from app.core.files import FileLock
from app.gate import create_gate_app
from app.services.llm import SystemdLLM
from app.services.switch_adapters import AsyncGPULock, SwitchGate

KEY = "test-gate-key-at-least-24-characters"
HOLD = "switch-" + "a" * 32


class LLM:
    def __init__(self):
        self.calls = 0

    async def drain(self):
        self.calls += 1


async def test_lock_waits_then_acquires_and_releases(tmp_path):
    path = tmp_path / "gpu.lock"
    image = FileLock(path)
    image.acquire()
    adapter = AsyncGPULock(path, poll_interval=0.01, file_lock=FileLock(path))
    entered = asyncio.Event()

    async def switch():
        async with adapter:
            entered.set()

    task = asyncio.create_task(switch())
    try:
        await asyncio.sleep(0.04)
        assert not entered.is_set()
        image.release()
        await asyncio.wait_for(task, 1)
        assert entered.is_set()
        image.acquire()
    finally:
        image.release()
        if not task.done():
            task.cancel()


async def test_cancelling_a_waiter_never_releases_existing_owner(tmp_path):
    path = tmp_path / "gpu.lock"
    image = FileLock(path)
    image.acquire()
    adapter = AsyncGPULock(path, poll_interval=0.01, file_lock=FileLock(path))

    async def switch():
        async with adapter:
            raise AssertionError("unexpected GPU ownership")

    task = asyncio.create_task(switch())
    try:
        await asyncio.sleep(0.03)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert image.handle is not None
        probe = FileLock(path)
        from app.core.files import LockBusyError

        with pytest.raises(LockBusyError):
            probe.acquire()
    finally:
        image.release()


async def test_gate_adapter_preserves_an_independent_admin_hold(tmp_path):
    path = tmp_path / "gate.json"
    path.write_text('{"holds": []}')
    app = create_gate_app(GateSettings(api_key=KEY, state_path=path))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8081") as client:
            await client.put("/control", headers={"Authorization": f"Bearer {KEY}"},
                             json={"paused": True})
            llm = LLM()
            gate = SwitchGate("http://127.0.0.1:8081/control", KEY, llm, transport=transport)
            await gate.acquire(HOLD)
            await gate.acquire(HOLD)  # Retry after an uncertain response is idempotent.
            await gate.drain()
            await gate.release(HOLD)
            status = await client.get("/control", headers={"Authorization": f"Bearer {KEY}"})
            assert status.json()["paused"] is True and llm.calls == 1


@pytest.mark.parametrize("url", ["http://example.com/control", "http://127.0.0.1/control",
                                "http://127.0.0.1:8081/control?token=x"])
def test_gate_rejects_non_loopback_or_ambiguous_control_urls(url):
    with pytest.raises(ValueError):
        SwitchGate(url, KEY, LLM())


async def test_gate_rejects_invalid_hold_before_network():
    gate = SwitchGate("http://127.0.0.1:8081/control", KEY, LLM())
    with pytest.raises(ValueError):
        await gate.acquire("../../control")


async def test_real_gate_and_drain_wait_for_active_request(tmp_path, settings, monkeypatch):
    import app.services.llm as llm_module

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
        slots_requests = []

        class Router(httpx.AsyncBaseTransport):
            async def handle_async_request(self, request):
                if request.url.port == 8081:
                    return await gate_transport.handle_async_request(request)
                slots_requests.append(request)
                return httpx.Response(200, json=[{"is_processing": False}])

        original = httpx.AsyncClient
        router = Router()
        monkeypatch.setattr(
            llm_module.httpx, "AsyncClient",
            lambda **kwargs: original(transport=router, **{k: v for k, v in kwargs.items()
                                                          if k != "transport"}),
        )
        gate = SwitchGate(settings.admission_url, KEY, SystemdLLM(settings))
        await app.state.admission.enter()  # An admitted LLM request is still active.
        await gate.acquire(HOLD)
        drain = asyncio.create_task(gate.drain())
        try:
            await asyncio.sleep(0.05)
            assert not drain.done() and not slots_requests
            await app.state.admission.leave()
            await asyncio.wait_for(drain, 2)
            assert len(slots_requests) == 1
            await gate.release(HOLD)
        finally:
            if not drain.done():
                drain.cancel()


async def test_owned_gate_preflight_blocks_uncertain_or_recovery_state():
    from app.services.model_switch import SwitchAdmissionBlocked

    def handler(request):
        return httpx.Response(200, json={"protocol": 2, "durable": True,
                                         "holds": ["studio-" + "f" * 32]})

    gate = SwitchGate("http://127.0.0.1:8081/control", KEY, LLM(),
                      transport=httpx.MockTransport(handler), require_owned_control=True)
    with pytest.raises(SwitchAdmissionBlocked):
        await gate.ensure_available()
    gate.transport = httpx.MockTransport(lambda request: httpx.Response(503))
    with pytest.raises(SwitchAdmissionBlocked):
        await gate.ensure_available()


async def test_recovery_drains_stopped_llm_without_calling_slots():
    from types import SimpleNamespace

    class StoppedLLM:
        s = SimpleNamespace(drain_timeout=1)

        async def service_state(self):
            return {"ActiveState": "failed", "MainPID": "0"}

        async def verify_stopped(self, state, *, allow_failed=False):
            assert state["ActiveState"] == "failed" and allow_failed

        async def gate(self, method):
            return {"paused": True, "active_requests": 0}

        async def drain(self):
            raise AssertionError("must not call /slots while llama is stopped")

    gate = SwitchGate("http://127.0.0.1:8081/control", KEY, StoppedLLM(),
                      require_owned_control=True)
    await gate.drain_recovery()
