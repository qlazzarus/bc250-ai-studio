import json
import os
import socket
import stat
from types import SimpleNamespace

import httpx
import pytest
from app.core.files import FileLock
from app.services.model_control import (
    MAX_REQUEST,
    ActiveModelWriter,
    ModelRegistry,
    handle_request,
    serve_connection,
)
from app.services.systemd_model import SystemdModelService


@pytest.fixture
def registry(tmp_path, monkeypatch):
    monkeypatch.setattr(FileLock, "_check_trusted_directory", staticmethod(lambda info: None))
    monkeypatch.setattr(ModelRegistry, "_check_file", staticmethod(lambda info: None))
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "model-a.conf").write_text("MODEL_PATH=/secret/path.gguf\n")
    (tmp_path / "active-model.conf").write_text("ACTIVE_MODEL=model-a\n")
    return ModelRegistry(tmp_path)


def test_registry_uses_management_names_only(registry):
    assert registry.list_models() == ["model-a"]
    assert registry.current_model() == "model-a"


def test_registry_rejects_symlinked_configuration(registry, tmp_path):
    (tmp_path / "models" / "model-b.conf").symlink_to("model-a.conf")
    with pytest.raises(OSError):
        registry.list_models()


def test_registry_rejects_shell_syntax_in_active_configuration(registry, tmp_path):
    (tmp_path / "active-model.conf").write_text("ACTIVE_MODEL=model-a\nmalicious command\n")
    with pytest.raises(RuntimeError):
        registry.current_model()


def test_registry_rejects_untrusted_file_metadata():
    for mode, uid, links in [(stat.S_IFREG | 0o666, 0, 1),
                             (stat.S_IFREG | 0o644, 1000, 1),
                             (stat.S_IFREG | 0o644, 0, 2)]:
        with pytest.raises(RuntimeError):
            ModelRegistry._check_file(SimpleNamespace(st_mode=mode, st_uid=uid, st_nlink=links))


def test_model_id_is_the_configured_gguf_path_not_management_name(registry):
    assert registry.model_id("model-a") == "/secret/path.gguf"


def test_model_id_accepts_observed_gguf_path_format(registry, tmp_path):
    observed = "/opt/models/gemma4-e4b-hauhaucs/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf"
    (tmp_path / "models" / "model-a.conf").write_text(f"MODEL_PATH={observed}\n")
    assert registry.model_id("model-a") == observed


@pytest.mark.parametrize("contents", [
    "MODEL_PATH=$(touch /tmp/not-executed)\n",
    "MODEL_PATH=/x.gguf\nMODEL_PATH=/y.gguf\n",
    "MODEL_PATH=/x.gguf\necho unsafe\n",
    "MODEL_NAME=another\nMODEL_PATH=/x.gguf\n",
    "MODEL_PATH=/x/../y.gguf\n",
])
def test_model_mapping_rejects_shell_or_ambiguous_values(registry, tmp_path, contents):
    (tmp_path / "models" / "model-a.conf").write_text(contents)
    with pytest.raises(RuntimeError):
        registry.model_id("model-a")


def test_writer_changes_only_allowlisted_model_and_preserves_permissions(registry, tmp_path):
    model = tmp_path / "model-b.gguf"
    model.write_bytes(b"gguf")
    (tmp_path / "models" / "model-b.conf").write_text(
        f"MODEL_NAME=model-b\nMODEL_PATH={model}\nCONTEXT_SIZE=16384\n"
    )
    active = tmp_path / "active-model.conf"
    active.chmod(0o640)
    before = active.stat()
    ActiveModelWriter(registry).set_active("model-b")
    after = active.stat()
    assert active.read_text() == "ACTIVE_MODEL=model-b\n"
    assert (after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode)) == (
        before.st_uid, before.st_gid, 0o640,
    )
    assert registry.model_id("model-b") == str(model)


def test_writer_rejects_missing_or_empty_model_without_changing_active(registry, tmp_path):
    model = tmp_path / "empty.gguf"
    model.touch()
    (tmp_path / "models" / "model-b.conf").write_text(f"MODEL_PATH={model}\n")
    with pytest.raises(RuntimeError, match="missing or empty"):
        ActiveModelWriter(registry).set_active("model-b")
    assert (tmp_path / "active-model.conf").read_text() == "ACTIVE_MODEL=model-a\n"


def test_failed_file_sync_preserves_previous_active_model(registry, tmp_path, monkeypatch):
    model = tmp_path / "model-b.gguf"
    model.write_bytes(b"gguf")
    (tmp_path / "models" / "model-b.conf").write_text(f"MODEL_PATH={model}\n")
    monkeypatch.setattr(os, "fsync", lambda fd: (_ for _ in ()).throw(OSError("disk error")))
    with pytest.raises(OSError):
        ActiveModelWriter(registry).set_active("model-b")
    assert (tmp_path / "active-model.conf").read_text() == "ACTIVE_MODEL=model-a\n"
    assert not list(tmp_path.glob(".active-model-*"))


async def test_writer_and_health_use_configured_gguf_mapping(registry, tmp_path):
    model = tmp_path / "not-the-management-name.gguf"
    model.write_bytes(b"gguf")
    (tmp_path / "models" / "model-b.conf").write_text(
        f"MODEL_NAME=model-b\nMODEL_PATH={model}\nGPU_LAYERS=99\n"
    )

    class Systemctl:
        async def restart(self, timeout):
            pass

        async def show(self, timeout):
            return {"LoadState": "loaded", "KillMode": "control-group", "Job": "",
                    "ActiveState": "active", "MainPID": "42"}

    def response(request):
        if request.url.path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        return httpx.Response(200, json={"data": [{"id": str(model)}]})

    service = SystemdModelService(registry, ActiveModelWriter(registry), Systemctl(),
                                  transport=httpx.MockTransport(response))
    await service.apply("model-b")
    await service.healthy("model-b")
    assert registry.current_model() == "model-b"


def request(registry, body, allowed_uid=None):
    server, client = socket.socketpair()
    try:
        client.sendall(body)
        client.shutdown(socket.SHUT_WR)
        return handle_request(server, os.getuid() if allowed_uid is None else allowed_uid, registry)
    finally:
        server.close()
        client.close()


def test_protocol_checks_peer_and_rejects_arbitrary_commands(registry):
    assert request(registry, b'{"operation":"list"}\n', allowed_uid=os.getuid() + 1) == {
        "error": "forbidden"
    }
    assert request(registry, b'{"operation":"list"}\n') == {"models": ["model-a"]}
    assert request(registry, b'{"operation":"status"}\n') == {"current": "model-a"}
    for value in [{"operation": "switch"}, {"operation": "shell", "command": "id"},
                  {"operation": "list", "path": "/etc"}]:
        result = request(registry, json.dumps(value).encode() + b"\n")
        assert result["error"] in {"invalid_request", "unsupported_operation"}
    assert request(registry, b"x" * (MAX_REQUEST + 1) + b"\n") == {
        "error": "invalid_request"
    }


def test_socket_worker_returns_only_bounded_read_operations(registry):
    server, client = socket.socketpair()
    try:
        client.sendall(b'{"operation":"switch","model":"model-a"}\n')
        serve_connection(server, os.getuid(), registry)
        assert json.loads(client.recv(4096)) == {"error": "invalid_request"}
        assert registry.current_model() == "model-a"
    finally:
        server.close()
        client.close()


def test_socket_worker_hides_registry_error(registry, tmp_path):
    (tmp_path / "active-model.conf").unlink()
    server, client = socket.socketpair()
    try:
        client.sendall(b'{"operation":"status"}\n')
        serve_connection(server, os.getuid(), registry)
        assert json.loads(client.recv(4096)) == {"error": "unavailable"}
    finally:
        server.close()
        client.close()


def test_writer_rejects_changing_security_metadata(registry, tmp_path, monkeypatch):
    model = tmp_path / "model-b.gguf"
    model.write_bytes(b"gguf")
    (tmp_path / "models" / "model-b.conf").write_text(f"MODEL_PATH={model}\n")
    calls = 0

    def metadata(_fd):
        nonlocal calls
        calls += 1
        return {"security.selinux": b"original" if calls == 1 else b"different"}

    monkeypatch.setattr("app.services.model_control.protected_xattrs", metadata)
    before = registry.current_model()
    with pytest.raises(RuntimeError, match="ACL or SELinux label"):
        ActiveModelWriter(registry).set_active("model-b")
    assert registry.current_model() == before
