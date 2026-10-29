import io
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.api.routes import capabilities
from app.services.gate_admin import check_studio_protocol
from app.services.gpu import GPUManager


async def test_studio_advertises_coordination_only_for_complete_configuration():
    settings = SimpleNamespace(admission_owned_holds=True, gpu_lock_secure_precreated=True,
                               engine="fake")
    gpu = SimpleNamespace(file_lock=SimpleNamespace(path=Path("/run/bc250-gpu/gpu.lock")),
                          switch_barrier=SimpleNamespace(
                              path=Path("/var/lib/bc250-model-control/switch.json")))
    gpu.s = settings
    gpu.model_switch_coordination_enabled = lambda: GPUManager.model_switch_coordination_enabled(gpu)
    state = SimpleNamespace(settings=settings, gpu=gpu)
    request = SimpleNamespace(app=SimpleNamespace(state=state))
    assert (await capabilities(request))["model_switch_coordination"] == {
        "protocol": 1, "enabled": True,
    }
    gpu.file_lock.path = Path("/run/bc250-ai-studio/gpu.lock")
    assert not (await capabilities(request))["model_switch_coordination"]["enabled"]
    gpu.file_lock.path = Path("/run/bc250-gpu/gpu.lock")
    settings.admission_owned_holds = False
    assert not (await capabilities(request))["model_switch_coordination"]["enabled"]


@pytest.mark.parametrize("data,accept", [
    ({"protocol": 1, "enabled": True, "transition_clear": True}, True),
    ({"phase": 1}, False),
    ({"protocol": 1, "enabled": False, "transition_clear": True}, False),
    ({"protocol": 1, "enabled": True, "transition_clear": False}, False),
])
def test_worker_rejects_old_or_incomplete_studio_protocol(monkeypatch, data, accept):
    seen = []
    class Reply(io.BytesIO):
        pass

    def urlopen(request, timeout):
        seen.append((request.full_url, request.headers))
        return Reply(json.dumps(data).encode())

    monkeypatch.setattr("app.services.gate_admin.open_local", urlopen)
    token = b"example-secret-value-never-in-url"
    if accept:
        check_studio_protocol(token)
    else:
        with pytest.raises(RuntimeError):
            check_studio_protocol(token)
    assert token.decode() not in seen[0][0]


async def test_internal_coordination_requires_dedicated_key_and_studio_gate_role(settings):
    import httpx
    from app.main import create_app
    from app.services.llm import FakeLLM

    settings.coordination_key = "studio-coordination-test-secret-12345"
    llm = FakeLLM()
    async def identity():
        return True

    llm.owned_control_identity = identity
    app = create_app(settings, llm=llm)
    async with app.router.lifespan_context(app):
        app.state.gpu.model_switch_coordination_enabled = lambda: True
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://test") as client:
            url = "/internal/model-switch/coordination"
            assert (await client.get(url)).status_code == 401
            assert (await client.get(url, headers={"Authorization": "Bearer " + settings.api_key})).status_code == 401
            headers = {"Authorization": "Bearer " + settings.coordination_key}
            assert (await client.get(url, headers=headers)).json() == {
                "protocol": 1, "enabled": True, "transition_clear": True,
            }
            app.state.db.state("transition", {"stage": "recovering"})
            assert not (await client.get(url, headers=headers)).json()["transition_clear"]


def test_local_admin_connection_disables_environment_proxies(monkeypatch):
    from app.services import gate_admin

    seen = []
    class Opener:
        def open(self, request, timeout):
            return "local"
    def build_opener(handler):
        seen.append(handler.proxies)
        return Opener()
    monkeypatch.setattr(gate_admin.urllib.request, "build_opener", build_opener)
    assert gate_admin.open_local("request", timeout=1) == "local"
    assert seen == [{}]
