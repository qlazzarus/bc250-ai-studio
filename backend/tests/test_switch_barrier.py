import json
import stat
import subprocess
import sys
from types import SimpleNamespace

import pytest
from app.core.files import FileLock, LockBusyError
from app.models.database import Database
from app.services.gpu import GPUManager
from app.services.llm import FakeLLM
from app.services.model_switch import StudioSwitchBarrier, SwitchJournal, SwitchRecoveryRequired


@pytest.fixture
def barrier(tmp_path, monkeypatch):
    monkeypatch.setattr(FileLock, "_check_trusted_directory", staticmethod(lambda info: None))
    monkeypatch.setattr(StudioSwitchBarrier, "_check_file", staticmethod(lambda info: None))
    path = tmp_path / "switch.json"
    path.write_text("{}")
    return StudioSwitchBarrier(path), path


def pending():
    return {"hold_id": "switch-" + "a" * 32, "old": "old", "target": "new",
            "stage": "switching", "mutation_started": True}


async def test_unresolved_switch_blocks_image_until_recovery(settings, barrier):
    check, path = barrier
    path.write_text(json.dumps(pending()))
    db = Database(settings.data_dir)
    db.migrate()
    llm = FakeLLM()
    gpu = GPUManager(settings, db, llm)
    gpu.switch_barrier = check
    with pytest.raises(LockBusyError, match="switch recovery"):
        await gpu.acquire("image")
    assert not gpu.leased and not gpu.lock.locked() and not llm.calls
    path.write_text("{}")
    await gpu.acquire("image")
    await gpu.release()
    db.engine.dispose()


async def test_unresolved_switch_blocks_studio_recovery(settings, barrier):
    check, path = barrier
    path.write_text(json.dumps(pending()))
    db = Database(settings.data_dir)
    db.migrate()
    db.state("transition", {"stopped_by_studio": True, "originally_running": True})
    llm = FakeLLM()
    gpu = GPUManager(settings, db, llm)
    gpu.switch_barrier = check
    with pytest.raises(LockBusyError):
        await gpu.recover()
    assert not llm.calls and gpu.blocked
    db.engine.dispose()


@pytest.mark.parametrize("data", ['{"old":"old"}', "not json", "x" * 8193])
def test_invalid_journal_fails_closed(barrier, data):
    check, path = barrier
    path.write_text(data)
    with pytest.raises((ValueError, SwitchRecoveryRequired)):
        check.read()


def test_barrier_refuses_untrusted_file_metadata():
    valid = SimpleNamespace(st_mode=stat.S_IFREG | 0o640, st_uid=0, st_nlink=1)
    StudioSwitchBarrier._check_file(valid)
    for mode, uid, nlink in [(0o660, 0, 1), (0o644, 0, 1), (0o640, 1000, 1), (0o640, 0, 2)]:
        with pytest.raises(SwitchRecoveryRequired):
            StudioSwitchBarrier._check_file(
                SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=uid, st_nlink=nlink)
            )


def test_journal_write_preserves_access_mode(tmp_path):
    path = tmp_path / "switch.json"
    path.write_text("{}")
    path.chmod(0o640)
    journal = SwitchJournal(path)
    journal.write(pending())
    assert stat.S_IMODE(path.stat().st_mode) == 0o640
    assert journal.read() == pending()


async def test_process_exit_releases_lock_but_journal_still_blocks_gpu(settings, barrier, tmp_path):
    check, path = barrier
    lock_path = tmp_path / "gpu.lock"
    code = (
        "import fcntl,json,os,sys; from pathlib import Path; "
        "from app.services.model_switch import SwitchJournal; "
        "f=open(sys.argv[1], 'a+'); fcntl.flock(f, fcntl.LOCK_EX); "
        "SwitchJournal(Path(sys.argv[2])).write(json.loads(sys.argv[3])); os._exit(0)"
    )
    subprocess.run([sys.executable, "-c", code, str(lock_path), str(path), json.dumps(pending())],
                   check=True)
    settings.gpu_lock_path = lock_path
    db = Database(settings.data_dir)
    db.migrate()
    llm = FakeLLM()
    gpu = GPUManager(settings, db, llm)
    gpu.switch_barrier = check
    with pytest.raises(LockBusyError, match="switch recovery"):
        await gpu.acquire("image")
    assert not llm.calls and not gpu.leased
    db.engine.dispose()
