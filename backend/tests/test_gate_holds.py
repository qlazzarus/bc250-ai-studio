import asyncio
import json

import httpx
import pytest
from app.core.config import GateSettings
from app.gate import Admission, create_gate_app


async def test_owned_holds_survive_restart_and_legacy_resume(tmp_path):
    path = tmp_path / "gate.json"
    path.write_text('{"holds": []}')
    gate = Admission(path)
    await gate.set_paused(True)
    await gate.hold("studio-1", True)
    await gate.hold("switch-1", True)
    await gate.set_paused(False)
    gate = Admission(path)
    assert (await gate.status())["paused"]
    await gate.hold("studio-1", False)
    assert (await gate.status())["paused"]
    waiter = asyncio.create_task(gate.enter())
    await asyncio.sleep(0)
    assert not waiter.done()
    await gate.hold("switch-1", False)
    await waiter
    await gate.leave()
    assert json.loads(path.read_text()) == {"holds": []}


@pytest.mark.parametrize("content", ["{}", '{"holds": [42]}', "invalid"])
def test_invalid_durable_state_fails_closed(tmp_path, content):
    path = tmp_path / "gate.json"
    path.write_text(content)
    with pytest.raises((RuntimeError, ValueError)):
        Admission(path)


def test_missing_durable_state_refuses_start(tmp_path):
    with pytest.raises(FileNotFoundError):
        Admission(tmp_path / "missing")


async def test_hold_write_failure_keeps_current_process_paused(tmp_path, monkeypatch):
    path = tmp_path / "gate.json"
    path.write_text('{"holds": []}')
    gate = Admission(path)

    def fail(*args):
        raise OSError("disk failure")

    monkeypatch.setattr("app.gate.atomic_json", fail)
    with pytest.raises(OSError):
        await gate.hold("studio-1", True)
    assert (await gate.status())["paused"]


async def test_http_hold_contract_and_legacy_resume(tmp_path):
    path = tmp_path / "gate.json"
    path.write_text('{"holds": []}')
    key = "test-gate-key-at-least-24-characters"
    app = create_gate_app(GateSettings(api_key=key, state_path=path))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            url = "/control/holds/studio-1"
            assert (await client.put(url)).status_code == 401
            headers = {"Authorization": f"Bearer {key}"}
            assert (await client.put(url, headers=headers)).json() == {
                "paused": True, "held": True,
            }
            result = await client.put("/control", headers=headers, json={"paused": False})
            assert result.json()["paused"] is True
            assert (await client.delete(url, headers=headers)).json() == {
                "paused": False, "held": False,
            }


async def test_owned_control_separates_roles_and_restart_requires_confirmation(tmp_path):
    path = tmp_path / "owned-gate.json"
    path.write_text('{"holds": []}')
    keys = {"admin": "admin-key-12345678901234567890", "studio": "studio-key-12345678901234567890",
            "switch": "switch-key-12345678901234567890"}
    settings = GateSettings(api_key=keys["admin"], studio_key=keys["studio"],
                            switch_key=keys["switch"], state_path=path, owned_control=True)
    studio_id = "studio-" + "a" * 32
    switch_id = "switch-" + "b" * 32
    def headers(role):
        return {"Authorization": "Bearer " + keys[role]}

    app = create_gate_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://test") as client:
            state = (await client.get("/control", headers=headers("studio"))).json()
            assert state["protocol"] == 2 and state["durable"] and state["holds"] == ["startup"]
            for role in ("admin", "studio", "switch"):
                identity = await client.get("/control/identity", headers=headers(role))
                assert identity.json() == {"role": role, "protocol": 2}
            assert (await client.delete("/control/holds/startup", headers=headers("studio"))).status_code == 403
            assert (await client.delete("/control/holds/startup", headers=headers("admin"))).status_code == 200
            assert (await client.put("/control/holds/" + studio_id, headers=headers("studio"))).status_code == 200
            assert (await client.put("/control/holds/" + switch_id, headers=headers("switch"))).status_code == 200
            assert (await client.delete("/control/holds/" + studio_id, headers=headers("switch"))).status_code == 403
            assert (await client.delete("/control/holds/" + switch_id, headers=headers("admin"))).status_code == 403
            assert (await client.put("/control", headers=headers("studio"),
                                     json={"paused": False})).status_code == 403
            assert (await client.delete("/control/holds/" + studio_id, headers=headers("studio"))).json()["paused"]
    restarted = create_gate_app(settings)
    async with restarted.router.lifespan_context(restarted):
        assert restarted.state.admission.holds == {"startup", switch_id}


def test_owned_control_requires_distinct_credentials_and_durable_state(tmp_path):
    key = "same-key-12345678901234567890"
    with pytest.raises(ValueError):
        GateSettings(api_key=key, studio_key=key, switch_key=key,
                     state_path=tmp_path / "gate.json", owned_control=True)


async def test_gate_restart_remains_paused_after_hold_persist_failure(tmp_path, monkeypatch):
    path = tmp_path / "state.json"
    path.write_text('{"holds": []}')
    settings = GateSettings(api_key="admin-key-12345678901234567890",
                            studio_key="studio-key-12345678901234567890",
                            switch_key="switch-key-12345678901234567890",
                            state_path=path, owned_control=True)
    app = create_gate_app(settings)
    async with app.router.lifespan_context(app):
        await app.state.admission.hold("startup", False)
        def fail(*args):
            raise OSError("simulated disk error")
        with monkeypatch.context() as context:
            context.setattr("app.gate.atomic_json", fail)
            with pytest.raises(OSError):
                await app.state.admission.hold("studio-" + "a" * 32, True)
            assert (await app.state.admission.status())["paused"]
    restarted = create_gate_app(settings)
    async with restarted.router.lifespan_context(restarted):
        assert restarted.state.admission.holds == {"startup"}
        assert (await restarted.state.admission.status())["paused"]


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8080@evil.example", "http://127.0.0.1:8080/path",
    "http://127.0.0.1:8080/?token=secret", "http://127.0.0.1:invalid",
])
def test_gate_rejects_ambiguous_or_nonlocal_upstream(url):
    with pytest.raises(ValueError):
        GateSettings(api_key="test-gate-key-at-least-24-characters", upstream_url=url)
