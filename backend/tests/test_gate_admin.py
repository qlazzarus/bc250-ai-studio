import pytest
from app.services.gate_admin import confirm_startup, confirm_startup_with_deployment_hold


class Lock:
    held = False

    def acquire(self):
        assert not self.held
        self.held = True

    def release(self):
        self.held = False


class Journal:
    def read(self):
        return {}


class Client:
    async def request(self, operation):
        assert operation == "pending"
        return {"operation": None}


class LLM:
    def __init__(self):
        self.holds = ["startup", "legacy"]
        self.released = False

    async def gate(self, method):
        return {"protocol": 2, "durable": True, "paused": bool(self.holds), "holds": self.holds,
                "deployment_generation": "a" * 32}

    async def drain(self):
        pass

    async def update_administrator_hold(self, hold_id, *, acquire):
        assert hold_id == "startup" and not acquire
        self.released = True


class Service:
    async def ensure_settled(self):
        pass

    async def healthy(self, model):
        assert model == "active"


class Registry:
    def current_model(self):
        return "active"


class DeploymentGate:
    def __init__(self, holds=("startup",)):
        self.holds = set(holds)

    async def gate(self, method):
        assert method == "GET"
        return {"protocol": 2, "durable": True, "paused": bool(self.holds),
                "holds": sorted(self.holds), "deployment_generation": "a" * 32}

    async def acquire_deployment_hold(self):
        if "admin-deployment" in self.holds:
            raise RuntimeError("hold already exists")
        self.holds.add("admin-deployment")
        return "a" * 32


class DeploymentRecord:
    def __init__(self, events=None, fail=None):
        self.events = events if events is not None else []
        self.fail = fail

    def __call__(self, event):
        if event == self.fail:
            raise OSError("record failed")
        self.events.append(event)

    def deployment_generation(self, generation):
        assert generation == "a" * 32


async def test_deployment_hold_preserves_pause_when_startup_response_is_lost():
    gate = DeploymentGate()
    attempts = []
    events = []

    async def confirm():
        attempts.append(1)
        gate.holds.remove("startup")
        raise TimeoutError("response lost")

    with pytest.raises(TimeoutError):
        await confirm_startup_with_deployment_hold(gate, confirm, record=DeploymentRecord(events))
    assert gate.holds == {"admin-deployment"}
    assert len(attempts) == 1
    assert events == ["deployment_hold:begin", "deployment_hold:confirmed", "deployment_confirmation:begin"]


async def test_deployment_hold_remains_after_success_and_other_holds_are_preserved():
    gate = DeploymentGate(("startup", "legacy"))

    async def confirm():
        gate.holds.remove("startup")

    events = []
    await confirm_startup_with_deployment_hold(gate, confirm, record=DeploymentRecord(events))
    assert gate.holds == {"admin-deployment", "legacy"}
    assert events[-1] == "deployment_confirmation:confirmed"


async def test_existing_deployment_hold_is_not_adopted_or_released():
    gate = DeploymentGate(("startup", "admin-deployment"))

    async def confirm():
        pytest.fail("confirmation must not run")

    with pytest.raises(RuntimeError):
        await confirm_startup_with_deployment_hold(gate, confirm, record=DeploymentRecord())
    assert gate.holds == {"startup", "admin-deployment"}


async def test_uncertain_hold_acquisition_does_not_confirm_startup():
    class LostAcquire(DeploymentGate):
        async def acquire_deployment_hold(self):
            await super().acquire_deployment_hold()
            raise TimeoutError("response lost")

    gate = LostAcquire()

    async def confirm():
        pytest.fail("confirmation must not run")

    with pytest.raises(TimeoutError):
        await confirm_startup_with_deployment_hold(gate, confirm, record=DeploymentRecord())
    assert gate.holds == {"startup", "admin-deployment"}


async def test_deployment_record_failure_stops_before_confirmation():
    gate = DeploymentGate()

    async def confirm():
        pytest.fail("confirmation must not run")

    with pytest.raises(OSError):
        await confirm_startup_with_deployment_hold(gate, confirm, record=DeploymentRecord(fail="deployment_hold:confirmed"))
    assert gate.holds == {"startup", "admin-deployment"}


async def test_deployment_hold_does_not_adopt_concurrent_acquisition():
    class ConcurrentGate(DeploymentGate):
        async def acquire_deployment_hold(self):
            # Another actor acquires the same hold between the read and PUT.
            self.holds.add("admin-deployment")
            await super().acquire_deployment_hold()

    gate = ConcurrentGate()
    confirmations = []

    async def confirm():
        confirmations.append(True)
        gate.holds.remove("startup")

    with pytest.raises(RuntimeError, match="already exists"):
        await confirm_startup_with_deployment_hold(gate, confirm, record=DeploymentRecord())
    assert not confirmations, "a concurrently acquired hold must not be adopted"


async def test_deployment_release_checks_health_and_preserves_existing_pause():
    class GuardedLLM(LLM):
        async def release_deployment_hold(self, generation):
            assert generation == "a" * 32
            self.holds.remove("admin-deployment")

    gate = GuardedLLM()
    gate.holds = ["admin-deployment", "legacy"]
    lock = Lock()
    await confirm_startup(lock, Journal(), Client(), gate, Service(), Registry(),
                          lambda: None, release_id="admin-deployment", check_deployment_ownership=lambda: True,
                          deployment_generation="a" * 32)
    assert gate.holds == ["legacy"] and not lock.held


async def test_deployment_release_rejects_existing_startup_hold():
    gate = LLM()
    gate.holds = ["startup", "admin-deployment"]
    with pytest.raises(RuntimeError, match="unresolved hold"):
        await confirm_startup(Lock(), Journal(), Client(), gate, Service(), Registry(),
                              lambda: None, release_id="admin-deployment", check_deployment_ownership=lambda: True,
                              deployment_generation="a" * 32)
    assert gate.holds == ["startup", "admin-deployment"]


async def test_deployment_release_rejects_hold_changes_during_health_check():
    gate = LLM()
    gate.holds = ["admin-deployment"]

    class ChangingService(Service):
        async def healthy(self, model):
            gate.holds.append("admin-external")

    with pytest.raises(RuntimeError, match="holds changed"):
        await confirm_startup(Lock(), Journal(), Client(), gate, ChangingService(), Registry(),
                              lambda: None, release_id="admin-deployment", check_deployment_ownership=lambda: True,
                              deployment_generation="a" * 32)
    assert gate.holds == ["admin-deployment", "admin-external"]


async def test_deployment_release_requires_ownership_check():
    gate = LLM()
    gate.holds = ["admin-deployment"]
    with pytest.raises(ValueError, match="ownership check"):
        await confirm_startup(Lock(), Journal(), Client(), gate, Service(), Registry(),
                              lambda: None, release_id="admin-deployment")
    assert gate.holds == ["admin-deployment"]


async def test_deployment_release_stops_if_ownership_is_lost_during_health_check():
    gate = LLM()
    gate.holds = ["admin-deployment"]
    checks = iter([True, False])
    with pytest.raises(RuntimeError, match="ownership changed"):
        await confirm_startup(Lock(), Journal(), Client(), gate, Service(), Registry(),
                              lambda: None, release_id="admin-deployment",
                              check_deployment_ownership=lambda: next(checks), deployment_generation="a" * 32)
    assert gate.holds == ["admin-deployment"]


async def test_startup_release_checks_all_barriers_while_holding_gpu_lock():
    lock, llm = Lock(), LLM()
    def check():
        assert lock.held

    await confirm_startup(lock, Journal(), Client(), llm, Service(), Registry(), check)
    assert llm.released and not lock.held


async def test_startup_release_rejects_unresolved_studio_or_switch_holds():
    lock, llm = Lock(), LLM()
    llm.holds.append("studio-" + "a" * 32)
    with pytest.raises(RuntimeError, match="unresolved hold"):
        await confirm_startup(lock, Journal(), Client(), llm, Service(), Registry(), lambda: None)
    assert not llm.released and not lock.held


async def test_startup_release_keeps_hold_when_model_health_fails():
    lock, llm = Lock(), LLM()
    class FailedService(Service):
        async def healthy(self, model):
            raise RuntimeError("model unhealthy")

    with pytest.raises(RuntimeError, match="model unhealthy"):
        await confirm_startup(lock, Journal(), Client(), llm, FailedService(), Registry(), lambda: None)
    assert not llm.released and not lock.held


async def test_startup_release_preserves_hold_if_client_credential_check_fails(monkeypatch):
    from app.services import client_gate_check, gate_admin

    lock, llm = Lock(), LLM()
    calls = []
    monkeypatch.setattr(gate_admin, "coordinated_studio_is_ready", lambda: calls.append("studio"))
    def fail_client(user):
        assert lock.held
        calls.append(user)
        raise RuntimeError("client credential mismatch")
    monkeypatch.setattr(client_gate_check, "verify_client_gate", fail_client)
    with pytest.raises(RuntimeError, match="client credential mismatch"):
        await confirm_startup(
            lock, Journal(), Client(), llm, Service(), Registry(),
            lambda: gate_admin.coordinated_participants_are_ready("yeppyshiba"),
        )
    assert calls == ["studio", "yeppyshiba"]
    assert not llm.released and not lock.held


async def test_startup_release_verifies_client_while_holding_lock(monkeypatch):
    from app.services import client_gate_check, gate_admin

    lock, llm = Lock(), LLM()
    monkeypatch.setattr(gate_admin, "coordinated_studio_is_ready", lambda: None)
    def verify_client(user):
        assert lock.held and user == "yeppyshiba"
    monkeypatch.setattr(client_gate_check, "verify_client_gate", verify_client)
    await confirm_startup(
        lock, Journal(), Client(), llm, Service(), Registry(),
        lambda: gate_admin.coordinated_participants_are_ready("yeppyshiba"),
    )
    assert llm.released and not lock.held


def test_startup_confirmation_checks_both_running_service_configurations(monkeypatch):
    from app.services import gate_admin

    admin_key = "admin-key-12345678901234567890"
    switch_key = "switch-key-12345678901234567890"
    calls = []
    monkeypatch.setattr(gate_admin, "service_ready", lambda unit, account: calls.append((unit, account)))
    monkeypatch.setattr(gate_admin, "read_key",
                        lambda name: admin_key if name == "gate-admin-key" else switch_key)
    monkeypatch.setattr(gate_admin, "check_gate_identity", lambda token, role: calls.append(role))
    monkeypatch.setattr(gate_admin, "check_studio_protocol", lambda token: calls.append("studio protocol"))
    gate_admin.coordinated_studio_is_ready()
    assert calls[2:4] == ["switch", "studio protocol"]


async def test_orphan_switch_release_requires_independent_hold_and_verified_health():
    from app.services.gate_admin import release_orphan_hold

    lock, llm = Lock(), LLM()
    hold = "switch-" + "a" * 32
    llm.holds = ["admin-reconciliation", hold]
    class Pending:
        async def request(self, operation):
            return {"operation": {"state": "recovery_required"}}
    class SwitchGate:
        def __init__(self):
            self.released = None
        async def release(self, hold_id):
            assert lock.held
            self.released = hold_id
    gate = SwitchGate()
    await release_orphan_hold(lock, Journal(), Pending(), llm, Service(), Registry(),
                                lambda: None, gate, hold)
    assert gate.released == hold and not lock.held


@pytest.mark.parametrize("holds", [
    ["switch-" + "a" * 32],
    ["startup", "switch-" + "a" * 32, "studio-" + "b" * 32],
])
async def test_orphan_switch_release_rejects_uncertain_holds(holds):
    from app.services.gate_admin import release_orphan_hold

    lock, llm = Lock(), LLM()
    llm.holds = holds
    class SwitchGate:
        async def release(self, hold_id):
            raise AssertionError("must not release")
    with pytest.raises(RuntimeError):
        await release_orphan_hold(lock, Journal(), Client(), llm, Service(), Registry(),
                                    lambda: None, SwitchGate(), "switch-" + "a" * 32)
    assert not lock.held


async def test_orphan_studio_hold_release_preserves_administrator_pause():
    from app.services.gate_admin import release_orphan_hold

    lock, llm = Lock(), LLM()
    hold = "studio-" + "b" * 32
    llm.holds = ["legacy", hold]
    class OwnerGate:
        released = None
        async def release(self, hold_id):
            self.released = hold_id

    gate = OwnerGate()
    await release_orphan_hold(lock, Journal(), Client(), llm, Service(), Registry(),
                              lambda: None, gate, hold, owner="studio")
    assert gate.released == hold and "legacy" in llm.holds and not lock.held
