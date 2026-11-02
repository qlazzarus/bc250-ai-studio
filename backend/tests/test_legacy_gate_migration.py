import importlib.util
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "deploy/model-control/migrate-legacy-gate.py"
spec = importlib.util.spec_from_file_location("legacy_gate_migration", SCRIPT)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


@pytest.mark.parametrize("paused", [True, False])
def test_capture_saves_previous_pause_before_pausing(tmp_path, monkeypatch, paused):
    snapshot = tmp_path / "legacy.json"
    requests = []

    def request(key, method, payload=None):
        requests.append((method, payload))
        if method == "GET":
            return {"paused": paused, "active_requests": 0, "waiting_requests": 0}
        assert json.loads(snapshot.read_text()) == {"paused_before_maintenance": paused}
        return {"paused": True, "active_requests": 0, "waiting_requests": 0}

    monkeypatch.setattr(migration, "request", request)
    monkeypatch.setattr(migration, "read_snapshot", lambda path: json.loads(path.read_text()))
    migration.capture("secret", snapshot)
    assert requests == [("GET", None), ("PUT", {"paused": True})]
    with pytest.raises(FileExistsError):
        migration.capture("secret", snapshot)


def test_failed_pause_preserves_record_for_retry(tmp_path, monkeypatch):
    snapshot = tmp_path / "legacy.json"
    def request(key, method, payload=None):
        if method == "GET":
            return {"paused": True, "active_requests": 0, "waiting_requests": 0}
        raise OSError("connection lost")

    monkeypatch.setattr(migration, "request", request)
    monkeypatch.setattr(migration, "read_snapshot", lambda path: json.loads(path.read_text()))
    with pytest.raises(OSError):
        migration.capture("secret", snapshot)
    assert json.loads(snapshot.read_text()) == {"paused_before_maintenance": True}


@pytest.mark.parametrize("paused, expected", [(True, ["legacy"]), (False, [])])
def test_create_state_preserves_prior_admin_hold_without_overwrite(tmp_path, monkeypatch, paused, expected):
    snapshot, gate_dir = tmp_path / "snapshot", tmp_path / "gate"
    monkeypatch.setattr(migration, "read_snapshot", lambda _: {"paused_before_maintenance": paused})
    stopped = []
    monkeypatch.setattr(migration, "verify_stopped", stopped.append)
    monkeypatch.setattr(migration.pwd, "getpwnam",
                        lambda _: SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid()))
    migration.create_state(snapshot, gate_dir)
    assert json.loads((gate_dir / "holds.json").read_text()) == {"holds": expected}
    assert stopped == ["bc250-ai-studio.service", "bc250-llm-gate.service"]
    with pytest.raises(FileExistsError):
        migration.create_state(snapshot, gate_dir)


def test_legacy_credential_parsing_rejects_duplicates(tmp_path):
    path = tmp_path / "gate.env"
    path.write_text('GATE_API_KEY="a-very-long-gate-key-example"\n')
    assert migration.legacy_key(path) == "a-very-long-gate-key-example"
    path.write_text(path.read_text() + "GATE_API_KEY=another-long-gate-key-example\n")
    with pytest.raises(RuntimeError):
        migration.legacy_key(path)


def test_status_is_read_only_and_does_not_print_key(monkeypatch, capsys):
    monkeypatch.setattr(migration.os, 'geteuid', lambda: 0)
    monkeypatch.setattr(sys, 'argv', ['migrate-legacy-gate.py', 'status'])
    monkeypatch.setattr(migration, 'validate_root_path', lambda path, **kwargs: None)
    monkeypatch.setattr(migration, 'legacy_key', lambda: 'secret-key-value')
    calls = []
    monkeypatch.setattr(migration, 'request', lambda key, method: (
        calls.append((key, method)) or
        {'paused': False, 'active_requests': 1, 'waiting_requests': 2}))
    migration.main()
    assert calls == [('secret-key-value', 'GET')]
    assert 'secret-key-value' not in capsys.readouterr().out


@pytest.mark.parametrize('original', [False, True])
def test_restore_pause_only_restores_the_captured_state(monkeypatch, original):
    monkeypatch.setattr(migration, 'read_snapshot', lambda _: {'paused_before_maintenance': original})
    calls = []
    state = {'paused': True, 'active_requests': 0, 'waiting_requests': 0}

    def request(key, method, payload=None):
        calls.append((method, payload))
        if payload is not None:
            state['paused'] = payload['paused']
        return dict(state)

    monkeypatch.setattr(migration, 'request', request)
    result = migration.restore_pause('secret')
    assert result['paused'] is original
    assert calls == ([('PUT', {'paused': True})] +
                     ([] if original else [('PUT', {'paused': False})]) + [('GET', None)])


def test_restore_pause_does_not_release_with_inflight_requests(monkeypatch):
    monkeypatch.setattr(migration, 'read_snapshot', lambda _: {'paused_before_maintenance': False})
    calls = []

    def request(key, method, payload=None):
        calls.append((method, payload))
        return {'paused': True, 'active_requests': 1, 'waiting_requests': 0}

    monkeypatch.setattr(migration, 'request', request)
    with pytest.raises(RuntimeError):
        migration.restore_pause('secret')
    assert calls == [('PUT', {'paused': True})]
