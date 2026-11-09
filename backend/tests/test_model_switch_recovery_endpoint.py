import hashlib
import json

from app.main import create_app
from app.services.llm import FakeLLM
from fastapi.testclient import TestClient


def test_recovery_endpoint_checks_studio_state_and_journal(settings, monkeypatch):
    settings.coordination_key = 'coordination-key-for-tests'
    app = create_app(settings, llm=FakeLLM())
    with TestClient(app) as client:
        gpu = app.state.gpu
        monkeypatch.setattr(gpu, 'model_switch_coordination_enabled', lambda: True)
        monkeypatch.setattr(gpu, 'shared_lock_held_by_root', lambda: True)

        async def identity():
            return True

        monkeypatch.setattr(gpu.llm, 'owned_control_identity', identity, raising=False)
        monkeypatch.setattr(gpu, 'switch_barrier', type('Barrier', (), {'read': lambda self: {}})())
        url = '/internal/model-switch/recovery'
        assert client.get(url).status_code == 401
        response = client.get(url, headers={'Authorization': 'Bearer coordination-key-for-tests'})
        assert response.status_code == 200
        assert response.json() == {
            'protocol': 1, 'enabled': True, 'gpu_blocked': True,
            'studio_recovery_clear': True, 'gate_verified': True,
            'journal_sha256': hashlib.sha256(json.dumps({}, separators=(',', ':')).encode()).hexdigest(),
        }
        gpu.leased = True
        response = client.get(url, headers={'Authorization': 'Bearer coordination-key-for-tests'})
        assert response.json()['studio_recovery_clear'] is False
