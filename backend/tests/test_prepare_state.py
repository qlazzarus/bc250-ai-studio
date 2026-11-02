import importlib.util
from pathlib import Path

import pytest


@pytest.fixture
def script():
    path = Path(__file__).resolve().parents[2] / "deploy/model-control/prepare-state.py"
    spec = importlib.util.spec_from_file_location("prepare_state", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("mode", ["0", "1"])
def test_new_state_gets_policy_default_selinux_context(script, tmp_path, monkeypatch, mode):
    enforce = tmp_path / "enforce"
    enforce.write_text(mode)
    state = tmp_path / "state"
    calls = []
    monkeypatch.setattr(script, "SELINUX_ENFORCE", enforce)
    monkeypatch.setattr(script, "DIRECTORY", state)
    monkeypatch.setattr(script.subprocess, "run", lambda args, **kwargs: calls.append((args, kwargs)))

    script.label_new_state()

    assert calls == [([script.RESTORECON, "-F", str(state), str(state / "switch.json")],
                      {"check": True})]


def test_no_selinux_mount_skips_relabel(script, tmp_path, monkeypatch):
    monkeypatch.setattr(script, "SELINUX_ENFORCE", tmp_path / "missing")
    monkeypatch.setattr(script.subprocess, "run", lambda *args, **kwargs: pytest.fail("unexpected relabel"))
    script.label_new_state()


def test_unknown_selinux_state_fails_closed(script, tmp_path, monkeypatch):
    enforce = tmp_path / "enforce"
    enforce.write_text("unknown")
    monkeypatch.setattr(script, "SELINUX_ENFORCE", enforce)
    with pytest.raises(RuntimeError, match="SELinux mode"):
        script.label_new_state()
