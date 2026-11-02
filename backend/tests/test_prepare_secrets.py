import importlib.util
import stat
from pathlib import Path

import pytest


def test_client_gate_credential_is_private_and_matches_gate_admin(tmp_path, monkeypatch, capsys):
    path = Path(__file__).resolve().parents[2] / "deploy/model-control/prepare-secrets.py"
    spec = importlib.util.spec_from_file_location("prepare_secrets", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    directory = tmp_path / "new-credentials"
    monkeypatch.setattr(module, "DIRECTORY", directory)
    monkeypatch.setattr(module.os, "geteuid", lambda: 0)
    monkeypatch.setattr(module.os, "umask", lambda _: 0)

    module.main()

    admin = (directory / "gate-admin-key").read_text().strip()
    client = directory / "client-gate.env"
    assert client.read_text() == f"LLM_GATE_API_KEY={admin}\n"
    assert f"GATE_API_KEY={admin}\n" in (directory / "gate.env").read_text()
    assert stat.S_IMODE(client.stat().st_mode) == 0o600
    assert admin not in capsys.readouterr().out
    with pytest.raises(SystemExit, match="already exists"):
        module.main()
    assert client.read_text() == f"LLM_GATE_API_KEY={admin}\n"
