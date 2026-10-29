import json

import pytest
from app.core.files import LockBusyError
from app.gate import Admission
from app.models.database import Database
from app.services.gpu import GPUManager, RecoveryError
from app.services.llm import FakeLLM


class OwnedLLM(FakeLLM):
    def __init__(self, gate, db):
        super().__init__()
        self.gate, self.db = gate, db
        self.fail_health = False

    async def pause_owned(self, hold_id):
        assert self.db.get_state("transition", {})["admission_hold_id"] == hold_id
        await self.gate.hold(hold_id, True)

    async def ensure_image_admission(self):
        if any(h == "startup" or h.startswith(("switch-", "studio-")) for h in self.gate.holds):
            raise LockBusyError("Admission recovery must finish")

    async def resume_owned(self, hold_id):
        await self.gate.hold(hold_id, False)

    async def healthy(self):
        if self.fail_health:
            raise RuntimeError("health failed")


async def test_studio_releases_only_its_hold(settings, tmp_path):
    settings.admission_owned_holds = True
    path = tmp_path / "gate.json"
    path.write_text('{"holds": []}')
    gate = Admission(path)
    await gate.set_paused(True)
    db = Database(settings.data_dir)
    db.migrate()
    gpu = GPUManager(settings, db, OwnedLLM(gate, db))
    await gpu.acquire("image")
    await gpu.release()
    assert json.loads(path.read_text()) == {"holds": ["legacy"]}
    assert db.get_state("transition", {}) == {}
    db.engine.dispose()


async def test_studio_waits_for_gate_startup_recovery_without_stopping_llm(settings, tmp_path):
    settings.admission_owned_holds = True
    path = tmp_path / "gate.json"
    path.write_text('{"holds": ["startup"]}')
    gate = Admission(path)
    db = Database(settings.data_dir)
    db.migrate()
    llm = OwnedLLM(gate, db)
    gpu = GPUManager(settings, db, llm)
    with pytest.raises(LockBusyError):
        await gpu.acquire("image")
    assert llm.active and not gpu.leased and db.get_state("transition", {}) == {}
    await gate.hold("startup", False)
    await gpu.acquire("image")
    await gpu.release()
    db.engine.dispose()


async def test_recovery_after_restart_keeps_hold_until_healthy(settings, tmp_path):
    settings.admission_owned_holds = True
    path = tmp_path / "gate.json"
    path.write_text('{"holds": []}')
    gate = Admission(path)
    db = Database(settings.data_dir)
    db.migrate()
    llm = OwnedLLM(gate, db)
    gpu = GPUManager(settings, db, llm)
    await gpu.acquire("image")
    hold_id = gpu.transition["admission_hold_id"]
    # Simulate the old process losing its file descriptor after interruption.
    gpu._unlock()
    recovered = GPUManager(settings, db, llm)
    assert recovered.blocked
    llm.fail_health = True
    with pytest.raises(RecoveryError):
        await recovered.recover()
    assert hold_id in json.loads(path.read_text())["holds"]
    assert recovered.blocked
    llm.fail_health = False
    await recovered.recover()
    assert json.loads(path.read_text()) == {"holds": []}
    assert not recovered.blocked
    db.engine.dispose()


async def test_gpu_journal_updates_stage_on_each_step(settings):
    db = Database(settings.data_dir)
    db.migrate()
    gpu = GPUManager(settings, db, FakeLLM())
    gpu.journal("first", detail="retained")
    gpu.journal("second")
    assert db.get_state("transition", {})["stage"] == "second"
    assert db.get_state("transition", {})["detail"] == "retained"
    db.engine.dispose()
