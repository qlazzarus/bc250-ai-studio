import pytest
from app.services.gate_admin import confirm_startup


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
        return {"protocol": 2, "durable": True, "paused": bool(self.holds), "holds": self.holds}

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
