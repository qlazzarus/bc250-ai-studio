"""Real root-owned path checks in an isolated user/mount namespace.

Run via the dedicated namespace harness; the ordinary suite skips these tests.
"""

import importlib.util
import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
from app.core.files import FileLock, LockBusyError
from app.services.model_control import ActiveModelWriter, ModelRegistry
from app.services.model_switch import StudioSwitchBarrier, SwitchJournal

pytestmark = pytest.mark.skipif(os.environ.get("BC250_ROOT_NAMESPACE_TEST") != "1",
                                reason="requires isolated root namespace harness")


@pytest.fixture
def root_area():
    assert os.getuid() == 0
    area = Path("/fixture") / uuid4().hex
    area.mkdir(mode=0o755)
    return area


def test_secure_lock_uses_root_owned_inode_and_rejects_symlink(root_area):
    path = root_area / "gpu.lock"
    path.touch(mode=0o600)
    first, second = FileLock(path, secure_precreated=True), FileLock(path, secure_precreated=True)
    first.acquire()
    try:
        with pytest.raises(LockBusyError):
            second.acquire()
    finally:
        first.release()
    second.acquire()
    second.release()
    path.unlink()
    path.symlink_to(root_area / "other")
    with pytest.raises(OSError):
        first.acquire()


def test_root_registry_and_shared_journal_keep_protected_metadata(root_area):
    base = root_area / "config"
    base.mkdir(mode=0o755)
    (base / "models").mkdir(mode=0o755)
    model = root_area / "model.gguf"
    model.write_bytes(b"model")
    (base / "models" / "old.conf").write_text(f"MODEL_PATH={model}\n")
    (base / "models" / "new.conf").write_text(f"MODEL_PATH={model}\n")
    active = base / "active-model.conf"
    active.write_text("ACTIVE_MODEL=old\n")
    active.chmod(0o640)
    registry = ModelRegistry(base)
    assert registry.current_model() == "old" and registry.list_models() == ["new", "old"]
    ActiveModelWriter(registry).set_active("new")
    assert registry.current_model() == "new"
    assert active.stat().st_uid == 0 and active.stat().st_mode & 0o777 == 0o640
    journal_path = root_area / "switch.json"
    journal_path.write_text("{}")
    journal_path.chmod(0o640)
    journal = SwitchJournal(journal_path, secure_precreated=True)
    state = {"hold_id": "switch-" + "a" * 32, "old": "old", "target": "new",
             "stage": "switching", "mutation_started": True}
    journal.write(state)
    assert StudioSwitchBarrier(journal_path).read() == state
    journal.clear()
    assert journal.read() == {}


def test_root_registry_rejects_group_writable_configuration(root_area):
    base = root_area / "config"
    base.mkdir(mode=0o755)
    (base / "models").mkdir(mode=0o755)
    model = base / "models" / "bad.conf"
    model.write_text("MODEL_PATH=/missing.gguf\n")
    model.chmod(0o666)
    with pytest.raises(RuntimeError, match="Untrusted"):
        ModelRegistry(base).list_models()


def load_deploy_script(name):
    path = Path("/workspace/deploy/model-control") / name
    spec = importlib.util.spec_from_file_location("deploy_" + name.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_root_secret_staging_is_private_and_never_overwrites(root_area, monkeypatch, capsys):
    module = load_deploy_script("prepare-secrets.py")
    config_dir = root_area / "credentials"
    monkeypatch.setattr(module, "DIRECTORY", config_dir)
    module.main()
    files = list(config_dir.iterdir())
    assert len(files) == 9
    assert config_dir.stat().st_uid == 0 and config_dir.stat().st_mode & 0o777 == 0o700
    assert all(p.stat().st_uid == 0 and p.stat().st_mode & 0o777 == 0o600 for p in files)
    output = capsys.readouterr().out
    names = ("gate-admin-key", "studio-gate-key", "switch-gate-key", "api-key",
             "studio-coordination-key")
    assert len({(config_dir / name).read_text() for name in names}) == len(names)
    for name in names:
        assert (config_dir / name).read_text().strip() not in output
    before = (config_dir / "api-key").read_text()
    with pytest.raises(SystemExit):
        module.main()
    assert (config_dir / "api-key").read_text() == before


def test_root_state_staging_keeps_existing_journal(root_area, monkeypatch):
    from types import SimpleNamespace

    module = load_deploy_script("prepare-state.py")
    state_dir = root_area / "model-state"
    monkeypatch.setattr(module, "DIRECTORY", state_dir)
    monkeypatch.setattr(module.grp, "getgrnam", lambda _: SimpleNamespace(gr_gid=0))
    module.main()
    journal = state_dir / "switch.json"
    assert json.loads(journal.read_text()) == {}
    assert state_dir.stat().st_mode & 0o777 == 0o750
    assert journal.stat().st_uid == 0 and journal.stat().st_mode & 0o777 == 0o640
    journal.write_text('{"preserve": true}')
    with pytest.raises(SystemExit):
        module.main()
    assert json.loads(journal.read_text()) == {"preserve": True}


@pytest.mark.skipif(os.environ.get("BC250_TEST_UV_CACHE") != "1", reason="offline uv cache unavailable")
def test_root_code_staging_installs_noneditable_package_without_services():
    import subprocess

    env = {**os.environ, "UV_CACHE_DIR": "/uv-cache", "UV_OFFLINE": "1"}
    result = subprocess.run(
        ["/usr/bin/bash", "/workspace/deploy/model-control/prepare-code.sh", "/workspace"],
        capture_output=True, text=True, env=env, timeout=120,
    )
    if result.returncode:
        writable = subprocess.run(["/usr/bin/find", "/opt/bc250-model-control", "!", "-type", "l",
                                   "-perm", "/022", "-print"], capture_output=True, text=True)
        pytest.fail(result.stdout + result.stderr + writable.stdout)
    assert "no service was changed" in result.stdout
    target = Path("/opt/bc250-model-control")
    assert target.stat().st_uid == 0 and not target.stat().st_mode & 0o022
    assert (target / ".venv/bin/python").exists()
