import asyncio

import pytest
from app.core.files import FileLock, LockBusyError
from app.engines.fake import FakeEngine
from app.main import create_app
from app.models.database import Database
from app.services.gpu import GPUManager
from app.services.llm import BusyError, FakeLLM
from conftest import HEADERS, submit, wait_job
from fastapi.testclient import TestClient


class BrokenLLM(FakeLLM):
    def __init__(self, failure):
        super().__init__()
        self.failure = failure

    async def stop(self):
        await super().stop()
        if self.failure == "stop":
            raise RuntimeError("stop failed")

    async def start(self):
        await super().start()
        if self.failure == "start":
            raise RuntimeError("start failed")

    async def drain(self):
        await super().drain()
        if self.failure == "busy":
            raise BusyError("busy")


class FailedEngine(FakeEngine):
    async def generate(self, *args):
        raise RuntimeError("image worker failed")


@pytest.mark.parametrize("failure", ["stop", "start", "worker"])
def test_llm_recovery_after_failure(settings, failure):
    llm = BrokenLLM(failure)
    engine = FailedEngine() if failure == "worker" else FakeEngine()
    with TestClient(create_app(settings, llm=llm, engine=engine), headers=HEADERS) as client:
        result = wait_job(client, submit(client))
        # A successful image remains available even when only the later LLM
        # restoration failed.
        assert result["status"] == ("completed" if failure == "start" else "failed")
        assert "start" in llm.calls
        status = client.get("/api/v1/system/status").json()
        assert status["recovery_required"] == (failure == "start")
        if failure == "start":
            assert "recovery failed" in status["error"]["message"]
            assert len(result["output_asset_ids"]) == 1
            assert "recovery failed" in result["error_message"]
            assert llm.paused  # Do not release chat to an unhealthy server.
        else:
            assert llm.active and not llm.paused
        assert client.get("/api/v1/system/health").status_code == 200


def test_inactive_llm_skips_drain_stop_and_health(settings):
    llm = FakeLLM()
    llm.active = False
    with TestClient(create_app(settings, llm=llm), headers=HEADERS) as client:
        result = wait_job(client, submit(client))
        assert result["status"] == "completed"
        assert "pause" in llm.calls and "resume" in llm.calls
        assert not {"drain", "stop", "start", "healthy"}.intersection(llm.calls)
        status = client.get("/api/v1/system/status").json()
        assert status["gpu_memory"]["verified"] is False
        assert not status["recovery_required"]


class GateFailureLLM(FakeLLM):
    async def pause(self):
        raise RuntimeError("admission gate unavailable")


class OrphanLLM(FakeLLM):
    def __init__(self):
        super().__init__()
        self.active = False

    async def verify_stopped(self, state=None):
        raise RuntimeError("LLM cgroup still contains processes")


@pytest.mark.parametrize("llm, message", [
    (GateFailureLLM(), "admission gate unavailable"),
    (OrphanLLM(), "cgroup still contains processes"),
])
async def test_inactive_llm_fails_closed_when_gate_or_gpu_safety_is_unknown(settings, llm, message):
    db = Database(settings.data_dir)
    db.migrate()
    gpu = GPUManager(settings, db, llm)
    with pytest.raises(RuntimeError, match=message):
        await gpu.acquire("job")
    assert not gpu.leased
    db.engine.dispose()


async def test_gpu_serializes_simultaneous_leases(settings):
    db = Database(settings.data_dir)
    db.migrate()
    llm = FakeLLM()
    gpu = GPUManager(settings, db, llm)
    active = 0
    maximum = 0

    async def worker(id):
        nonlocal active, maximum
        await gpu.acquire(id)
        active += 1
        maximum = max(maximum, active)
        await asyncio.sleep(0.01)
        active -= 1
        await gpu.release()

    await asyncio.gather(*(worker(str(i)) for i in range(5)))
    assert maximum == 1
    assert llm.calls == ["pause", "drain", "stop", "start", "healthy", "resume"] * 5
    db.engine.dispose()


async def test_busy_drain_does_not_stop_llm(settings):
    db = Database(settings.data_dir)
    db.migrate()
    llm = BrokenLLM("busy")
    gpu = GPUManager(settings, db, llm)
    with pytest.raises(BusyError):
        await gpu.acquire("job")
    assert "stop" not in llm.calls and "start" not in llm.calls
    assert not llm.paused and not gpu.blocked and not gpu.leased
    db.engine.dispose()


async def test_gpu_lock_across_instances(settings):
    db = Database(settings.data_dir)
    db.migrate()
    first = GPUManager(settings, db, FakeLLM())
    second = GPUManager(settings, db, FakeLLM())
    await first.acquire("first")
    with pytest.raises(LockBusyError, match="owns lock"):
        await second.acquire("second")
    await first.release()
    assert not second.lock.locked()
    db.engine.dispose()


def test_external_gpu_lock_retries_without_losing_manual_grant(settings):
    from conftest import ADMIN

    settings.policy = "manual"
    external = FileLock(settings.data_dir / "gpu.lock")
    external.acquire()
    try:
        with TestClient(create_app(settings), headers=HEADERS) as client:
            job_id = submit(client)
            client.post("/api/v1/system/manual-grant", headers=ADMIN)
            import time
            time.sleep(0.15)
            job = client.get(f"/api/v1/jobs/{job_id}").json()
            assert job["status"] in {"queued", "waiting_for_gpu"}
            assert not job["error_message"]
            external.release()
            assert wait_job(client, job_id)["status"] == "completed"
    finally:
        external.release()


class CountingEngine(FakeEngine):
    def __init__(self, llm, fail_second=False):
        super().__init__(0.01)
        self.llm = llm
        self.snapshots = []
        self.fail_second = fail_second

    async def generate(self, *args):
        self.snapshots.append(self.llm.calls.copy())
        if self.fail_second and len(self.snapshots) == 2:
            raise RuntimeError("Second image failed")
        await super().generate(*args)


def test_batch_failure_preserves_first_image(settings):
    llm = FakeLLM()
    engine = CountingEngine(llm, fail_second=True)
    with TestClient(create_app(settings, llm=llm, engine=engine), headers=HEADERS) as client:
        job = wait_job(client, submit(client, job_type="image.batch", batch_count=3))
        assert job["status"] == "failed"
        assert [item["status"] for item in job["items"]] == ["completed", "failed", "interrupted"]
        assert len(job["output_asset_ids"]) == 1
        assert llm.active and not llm.paused


def test_image_priority_retains_lease_across_queued_jobs(settings):
    from conftest import ADMIN

    settings.policy = "manual"
    llm = FakeLLM()
    engine = CountingEngine(llm)
    with TestClient(create_app(settings, llm=llm, engine=engine), headers=HEADERS) as client:
        ids = [submit(client) for _ in range(3)]
        client.put("/api/v1/system/policies", json={"mode": "image_priority"}, headers=ADMIN)
        for id in ids:
            assert wait_job(client, id)["status"] == "completed"
        assert llm.calls.count("stop") == 1
        assert llm.calls.count("start") == 1
        assert all("start" not in calls for calls in engine.snapshots)


class PendingChatLLM(FakeLLM):
    async def pending_chat(self):
        return True


def test_chat_priority_yields_batch_at_image_boundary(settings):
    settings.policy = "chat_priority"
    llm = PendingChatLLM()
    with TestClient(create_app(settings, llm=llm), headers=HEADERS) as client:
        job = wait_job(client, submit(client, job_type="image.batch", batch_count=3, seed=1))
        assert job["status"] == "completed"
        assert llm.calls.count("stop") == 3
        assert llm.calls.count("start") == 3
        assert [item["seed"] for item in job["items"]] == [1, 2, 3]


def test_policy_change_waits_for_image_boundary(settings):
    from conftest import ADMIN

    settings.fake_delay = 0.1
    llm = FakeLLM()
    with TestClient(create_app(settings, llm=llm), headers=HEADERS) as client:
        id = submit(client, job_type="image.batch", batch_count=3)
        wait_job(client, id, {"running"})
        client.put("/api/v1/system/policies", json={"mode": "manual"}, headers=ADMIN)
        job = wait_job(client, id, {"queued"})
        assert len(job["output_asset_ids"]) == 1
        assert llm.active and not llm.paused
        client.post("/api/v1/system/manual-grant", headers=ADMIN)
        assert wait_job(client, id)["status"] == "completed"


async def test_inactive_llm_gate_failure_remains_recoverable(settings):
    class ResumeFailsOnce(FakeLLM):
        def __init__(self):
            super().__init__()
            self.active = False
            self.fail_resume = True

        async def resume(self):
            if self.fail_resume:
                raise RuntimeError("gate unavailable")
            await super().resume()

    from app.services.gpu import RecoveryError

    db = Database(settings.data_dir)
    db.migrate()
    llm = ResumeFailsOnce()
    gpu = GPUManager(settings, db, llm)
    await gpu.acquire("image")
    with pytest.raises(RecoveryError):
        await gpu.release()
    assert gpu.blocked and db.get_state("transition", {})
    llm.fail_resume = False
    await gpu.recover()
    assert not gpu.blocked and not db.get_state("transition", {}) and not llm.active
    db.engine.dispose()


async def test_legacy_administrator_pause_is_not_released_by_image(settings):
    db = Database(settings.data_dir)
    db.migrate()
    llm = FakeLLM()
    llm.paused = True
    gpu = GPUManager(settings, db, llm)
    await gpu.acquire("image")
    await gpu.release()
    assert llm.paused and "resume" not in llm.calls and not gpu.blocked
    db.engine.dispose()


async def test_legacy_pause_response_loss_does_not_resume_unknown_pause(settings):
    class LostPauseResponse(FakeLLM):
        async def pause(self):
            await super().pause()
            raise RuntimeError("pause response lost")

    db = Database(settings.data_dir)
    db.migrate()
    llm = LostPauseResponse()
    gpu = GPUManager(settings, db, llm)
    with pytest.raises(RuntimeError, match="pause response lost"):
        await gpu.acquire("image")
    assert llm.paused and gpu.blocked and "resume" not in llm.calls
    assert db.get_state("transition", {})["legacy_pause_started"]
    db.engine.dispose()
