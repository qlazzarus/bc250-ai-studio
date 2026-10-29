import pytest
from app.services.llm import SystemdLLM


def configured(settings):
    settings.llm_service = "verified-test.service"
    settings.allowed_services = ["verified-test.service"]
    return SystemdLLM(settings)


async def paused_idle_gate(*args):
    return {"paused": True, "active_requests": 0, "waiting_requests": 0}


def test_service_name_must_be_explicitly_allowlisted(settings):
    settings.llm_service = "other.service"
    with pytest.raises(ValueError, match="allowlisted"):
        SystemdLLM(settings)
    settings.llm_service = "--evil.service"
    settings.allowed_services = ["other.service"]
    with pytest.raises(ValueError):
        SystemdLLM(settings)


async def test_bad_kill_mode_rejected_before_gate_mutation(settings):
    llm = configured(settings)
    calls = []

    async def ctl(*args):
        calls.append(args)
        return "LoadState=loaded\nKillMode=process"

    llm.ctl = ctl
    with pytest.raises(RuntimeError, match="KillMode"):
        await llm.pause()
    assert len(calls) == 1 and calls[0][0] == "show"


async def test_service_state_and_inactive_cgroup_are_verified(settings):
    llm = configured(settings)
    calls = []

    async def ctl(*args):
        calls.append(args)
        return "ActiveState=inactive\nMainPID=0\nControlGroup=\nKillMode=control-group"

    llm.ctl = ctl
    state = await llm.service_state()
    assert state["ActiveState"] == "inactive" and state["MainPID"] == "0"
    await llm.verify_stopped(state)
    assert calls == [("show", "--property=ActiveState,MainPID,ControlGroup,KillMode")]


async def test_memory_counter_unknown_and_excess(settings, tmp_path):
    llm = configured(settings)
    assert (await llm.memory())["verified"] is False
    path = tmp_path / "memory"
    path.write_text("1024")
    settings.gpu_memory_used_path = path
    settings.gpu_memory_limit_bytes = 512
    with pytest.raises(RuntimeError, match="memory"):
        await llm.memory()
    path.write_text("256")
    assert await llm.memory() == {"verified": True, "used_bytes": 256}


@pytest.mark.parametrize("payload", [{}, [], [{"is_processing": "false"}], [{"id": 1}]])
async def test_unknown_slot_state_fails_closed(settings, monkeypatch, payload):
    import app.services.llm as module
    import httpx

    llm = configured(settings)
    llm.gate = paused_idle_gate
    original = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    monkeypatch.setattr(
        module.httpx, "AsyncClient", lambda **kwargs: original(transport=transport, **kwargs)
    )
    with pytest.raises(RuntimeError, match="active requests"):
        await llm.drain()


async def test_slots_busy_timeout_and_idle(settings, monkeypatch):
    import app.services.llm as module
    import httpx
    from app.services.llm import BusyError

    llm = configured(settings)
    llm.gate = paused_idle_gate
    settings.drain_timeout = 0.001
    busy = True
    original = httpx.AsyncClient
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json=[{"is_processing": busy}])
    )
    monkeypatch.setattr(
        module.httpx, "AsyncClient", lambda **kwargs: original(transport=transport, **kwargs)
    )
    with pytest.raises(BusyError):
        await llm.drain()
    busy = False
    await llm.drain()


async def test_unverified_gate_fails_closed(settings, monkeypatch):
    import app.services.llm as module
    import httpx

    llm = configured(settings)
    settings.admission_url = "http://localhost/control"
    original = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"paused": True}))
    monkeypatch.setattr(
        module.httpx, "AsyncClient", lambda **kwargs: original(transport=transport, **kwargs)
    )
    with pytest.raises(RuntimeError, match="waiting_requests"):
        await llm.gate("PUT", {"paused": True})


async def test_optional_llm_key_is_not_sent_when_unconfigured(settings, monkeypatch):
    import app.services.llm as module
    import httpx

    llm = configured(settings)
    llm.gate = paused_idle_gate
    observed = []
    original = httpx.AsyncClient

    def upstream(request):
        observed.append(request.headers)
        return httpx.Response(200, json=[{"is_processing": False}])

    transport = httpx.MockTransport(upstream)
    monkeypatch.setattr(
        module.httpx, "AsyncClient", lambda **kwargs: original(transport=transport, **kwargs)
    )
    await llm.drain()
    assert "authorization" not in observed[0]


async def test_drain_waits_for_gate_requests_before_checking_slots(settings, monkeypatch):
    import app.services.llm as module
    import httpx

    llm = configured(settings)
    counts = iter([1, 0])
    calls = []

    async def gate(*args):
        return {"paused": True, "active_requests": next(counts), "waiting_requests": 0}

    original = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: (calls.append(request),
                                     httpx.Response(200, json=[{"is_processing": False}]))[1])
    monkeypatch.setattr(module.httpx, "AsyncClient", lambda **kw: original(transport=transport, **kw))
    llm.gate = gate
    await llm.drain()
    assert len(calls) == 1


async def test_drain_rejects_unpaused_gate(settings):
    llm = configured(settings)

    async def gate(*args):
        return {"paused": False, "active_requests": 0, "waiting_requests": 0}

    llm.gate = gate
    with pytest.raises(RuntimeError, match="not paused"):
        await llm.drain()


async def test_owned_resume_allows_another_hold_to_remain(settings, monkeypatch):
    import app.services.llm as module
    import httpx

    llm = configured(settings)
    settings.admission_url = "http://localhost/control"
    original = httpx.AsyncClient
    seen = []

    def gate(request):
        seen.append(request)
        return httpx.Response(200, json={"paused": True, "held": False})

    transport = httpx.MockTransport(gate)
    monkeypatch.setattr(
        module.httpx, "AsyncClient", lambda **kwargs: original(transport=transport, **kwargs)
    )
    await llm.resume_owned("studio-" + "a" * 32)
    assert seen[0].method == "DELETE"
