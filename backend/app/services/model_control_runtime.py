"""Deployment candidate. Switching is disabled until explicitly enabled."""

import asyncio
import os
import pwd
import signal
import socket
import stat
from pathlib import Path
from types import SimpleNamespace

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.files import FileLock
from app.services.llm import SystemdLLM
from app.services.model_control import ActiveModelWriter, ModelRegistry
from app.services.model_control_bridge import MAX_MESSAGE, ModelControlBridge
from app.services.model_switch import ModelSwitch, SwitchJournal
from app.services.switch_adapters import AsyncGPULock, SwitchGate
from app.services.switch_operations import SwitchOperations
from app.services.switch_worker import SwitchWorker
from app.services.systemd_model import SystemctlClient, SystemdModelService

STATE = Path("/var/lib/bc250-model-control")
GPU_LOCK = Path("/run/bc250-gpu/gpu.lock")
WORKER_LOCK = Path("/run/bc250-gpu/model-worker.lock")
SOCKET = "/run/bc250-model-control/control.sock"


class ControlSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MODEL_CONTROL_")
    switch_enabled: bool = False
    drain_timeout: float = Field(default=120, gt=0, le=900)
    health_timeout: float = Field(default=240, gt=0, le=900)
    settle_timeout: float = Field(default=90, gt=0, le=900)


def credential(name, *, optional=False):
    directory = os.environ.get("CREDENTIALS_DIRECTORY")
    if not directory:
        raise RuntimeError("systemd credentials are required")
    value = (Path(directory) / name).read_bytes()
    if len(value) > 4096:
        raise RuntimeError("Invalid credential length")
    value = value.decode("utf-8").rstrip("\r\n")
    if optional and not value:
        return ""
    if len(value) < 24 or any(c.isspace() for c in value):
        raise RuntimeError("Invalid credential")
    return value


def validate_state_directory():
    # This parent must never be writable by the unprivileged HTTP service.
    directory = ModelRegistry(STATE)._open_base()
    os.close(directory)
    for name in ("operations.sqlite3", "operations.sqlite3-wal", "operations.sqlite3-shm"):
        path = STATE / name
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0
                or info.st_nlink != 1 or info.st_mode & 0o077):
            raise RuntimeError("Untrusted operation database")


def build_worker(settings):
    if os.geteuid() != 0:
        raise RuntimeError("Model worker requires root")
    os.umask(0o077)
    validate_state_directory()
    journal = SwitchJournal(STATE / "switch.json", secure_precreated=True)
    journal.read()
    gate_key = credential("gate-key")
    llm_key = credential("llm-key", optional=True)
    llm_settings = SimpleNamespace(
        llm_service="llama-server.service", allowed_services=["llama-server.service"],
        systemctl=Path("/usr/bin/systemctl"), admission_url="http://127.0.0.1:8081/control",
        admission_key=gate_key, llm_url="http://127.0.0.1:8080", llm_api_key=llm_key,
        drain_timeout=settings.drain_timeout,
    )
    registry = ModelRegistry()
    service = SystemdModelService(
        registry, ActiveModelWriter(registry), SystemctlClient(),
        health_timeout=settings.health_timeout, settle_timeout=settings.settle_timeout,
        api_key=llm_key,
    )
    gate = SwitchGate(llm_settings.admission_url, gate_key, SystemdLLM(llm_settings),
                      require_owned_control=True)
    def verify_studio():
        # Lazy import keeps the privileged worker and administrator CLI independent.
        from app.services.gate_admin import coordinated_studio_is_ready

        coordinated_studio_is_ready()

    switch = ModelSwitch(journal, AsyncGPULock(GPU_LOCK), gate, service, preflight=verify_studio)
    return SwitchWorker(SwitchOperations(STATE / "operations.sqlite3"), switch,
                        FileLock(WORKER_LOCK, secure_precreated=True), verify_studio=verify_studio)


def inherited_socket():
    if os.environ.get("LISTEN_PID") != str(os.getpid()) or os.environ.get("LISTEN_FDS") != "1":
        raise RuntimeError("Exactly one systemd listening socket required")
    listener = socket.socket(fileno=3)
    if (listener.family != socket.AF_UNIX or listener.type != socket.SOCK_STREAM
            or listener.getsockname() != SOCKET
            or not listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN)):
        listener.close()
        raise RuntimeError("Invalid systemd listening socket")
    listener.setblocking(False)
    return listener


async def serve():
    settings = ControlSettings()
    listener = inherited_socket()
    bridge = ModelControlBridge(build_worker(settings), pwd.getpwnam("ai-studio").pw_uid,
                                switch_enabled=settings.switch_enabled)
    bridge.start()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        server = await asyncio.start_unix_server(bridge.handle, sock=listener, limit=MAX_MESSAGE)
        async with server:
            await stop.wait()
        await server.wait_closed()
    finally:
        # Do not cancel a switch merely because an HTTP caller disconnected or
        # systemd requested graceful shutdown. Hard termination leaves journals.
        await bridge.close()
        listener.close()


def main():
    try:
        asyncio.run(serve())
    except Exception:
        # Settings errors can contain supplied values. Never log their repr.
        raise SystemExit("Model worker startup/runtime failure; inspect configuration and state") from None


if __name__ == "__main__":
    main()
