import pytest
from app.services import client_gate_check


def test_process_gate_key_reads_only_the_requested_variable(tmp_path, monkeypatch):
    process = tmp_path / "123"
    process.mkdir()
    (process / "environ").write_bytes(b"OTHER=private\0LLM_GATE_API_KEY=test-key\0")
    monkeypatch.setattr(client_gate_check, "Path", lambda _: tmp_path)
    assert client_gate_check.process_gate_key("123") == b"test-key"


@pytest.mark.parametrize("data", [
    b"OTHER=value\0",
    b"LLM_GATE_API_KEY=\0",
    b"LLM_GATE_API_KEY=one\0LLM_GATE_API_KEY=two\0",
    b"x" * (client_gate_check.MAX_ENVIRONMENT + 1),
])
def test_process_gate_key_rejects_ambiguous_or_oversized_environment(tmp_path, monkeypatch, data):
    process = tmp_path / "123"
    process.mkdir()
    (process / "environ").write_bytes(data)
    monkeypatch.setattr(client_gate_check, "Path", lambda _: tmp_path)
    with pytest.raises(RuntimeError):
        client_gate_check.process_gate_key("123")


def test_verify_client_gate_checks_role_and_stable_processes(monkeypatch):
    calls = []
    monkeypatch.setattr(client_gate_check, "service_ready", lambda unit, account: (
        calls.append((unit, account)) or ("123" if "client" in unit else "456")
    ))
    monkeypatch.setattr(client_gate_check, "process_gate_key", lambda pid: b"test-gate-key")
    monkeypatch.setattr(client_gate_check, "read_key", lambda name: "test-gate-key")
    roles = []
    monkeypatch.setattr(client_gate_check, "check_gate_identity", lambda key, role: roles.append(role))

    client_gate_check.verify_client_gate("yeppyshiba")

    assert calls == [
        ("bc250-llm-client.service", "yeppyshiba"),
        ("bc250-llm-gate.service", "ai-gate"),
        ("bc250-llm-client.service", "yeppyshiba"),
        ("bc250-llm-gate.service", "ai-gate"),
    ]
    assert roles == ["admin"]


def test_verify_client_gate_rejects_a_mismatched_key_before_calling_gate(monkeypatch):
    monkeypatch.setattr(client_gate_check, "service_ready", lambda unit, account: "123")
    monkeypatch.setattr(client_gate_check, "process_gate_key", lambda pid: b"old-key")
    monkeypatch.setattr(client_gate_check, "read_key", lambda name: "new-key")
    monkeypatch.setattr(client_gate_check, "check_gate_identity", lambda *args: pytest.fail("unexpected request"))
    with pytest.raises(RuntimeError, match="mismatch"):
        client_gate_check.verify_client_gate("yeppyshiba")


def test_verify_client_gate_rejects_a_restart(monkeypatch):
    pids = iter(["123", "456", "789"])
    monkeypatch.setattr(client_gate_check, "service_ready", lambda unit, account: next(pids))
    monkeypatch.setattr(client_gate_check, "process_gate_key", lambda pid: b"test-key")
    monkeypatch.setattr(client_gate_check, "read_key", lambda name: "test-key")
    monkeypatch.setattr(client_gate_check, "check_gate_identity", lambda *args: None)
    with pytest.raises(RuntimeError, match="restarted"):
        client_gate_check.verify_client_gate("yeppyshiba")


def test_cli_does_not_expose_exception_details(monkeypatch):
    monkeypatch.setattr(client_gate_check.os, "geteuid", lambda: 0)
    monkeypatch.setattr("sys.argv", ["client_gate_check", "--expected-user", "yeppyshiba"])
    def fail(_):
        raise RuntimeError("private diagnostic value")
    monkeypatch.setattr(client_gate_check, "verify_client_gate", fail)
    with pytest.raises(SystemExit) as error:
        client_gate_check.main()
    assert "private diagnostic value" not in str(error.value)
