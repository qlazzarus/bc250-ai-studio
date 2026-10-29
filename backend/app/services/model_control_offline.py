"""Root-only offline recovery of an orphan switch journal.

The operator must stop the socket and service first. The lifetime and GPU locks,
fixed unit names, and trusted journal are still enforced; no shell is accepted.
"""

import asyncio
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

from app.core.files import FileLock
from app.services.gate_admin import coordinated_studio_is_ready, read_key
from app.services.llm import SystemdLLM
from app.services.model_control import ActiveModelWriter, ModelRegistry
from app.services.model_control_runtime import GPU_LOCK, STATE, WORKER_LOCK
from app.services.model_switch import ModelSwitch, SwitchJournal
from app.services.switch_adapters import AsyncGPULock, SwitchGate
from app.services.systemd_model import SystemctlClient, SystemdModelService


def assert_worker_stopped():
    for unit in ("bc250-model-worker.socket", "bc250-model-worker.service"):
        output = subprocess.run(
            ["/usr/bin/systemctl", "show", "--all",
             "--property=LoadState,ActiveState,Job,MainPID,KillMode,ControlGroup", unit],
            check=True, capture_output=True, text=True, timeout=10,
        ).stdout
        fields = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
        if (fields.get("LoadState") != "loaded" or fields.get("ActiveState") != "inactive"
                or fields.get("Job") != ""):
            raise RuntimeError("Stop the model worker socket and service first")
        if unit.endswith(".service"):
            if fields.get("MainPID") != "0" or fields.get("KillMode") != "control-group":
                raise RuntimeError("Model worker process state is uncertain")
            group = fields.get("ControlGroup", "")
            if group:
                root = Path("/sys/fs/cgroup").resolve()
                folder = (root / group.lstrip("/")).resolve()
                if root not in folder.parents:
                    raise RuntimeError("Invalid worker cgroup")
                if folder.exists() and any(p.read_text().strip() for p in folder.rglob("cgroup.procs")):
                    raise RuntimeError("Model worker cgroup still contains processes")


async def recover_orphan(lifetime_lock, switch, *, check_stopped, check_studio):
    check_stopped()
    lifetime_lock.acquire()
    try:
        check_stopped()
        async with switch.lock:
            check_stopped()
            await asyncio.to_thread(check_studio)
            state = switch.journal.read()
            if not state:
                raise RuntimeError("No switch journal to recover")
            gate = switch.gate
            status = await gate.llm.gate("GET")
            holds = status.get("holds")
            if (status.get("protocol") != 2 or status.get("durable") is not True
                    or status.get("paused") is not True or not isinstance(holds, list)
                    or not any(h == "startup" or h == "legacy" or h == "admin-reconciliation"
                               for h in holds)
                    or any(not isinstance(h, str) or not (
                        h in {"startup", "legacy", "admin-reconciliation", state["hold_id"]}
                        or h.startswith("admin-")
                    ) for h in holds)):
                raise RuntimeError("Independent gate hold and no unrelated recovery hold required")
            await switch._recover_locked(state)
    finally:
        lifetime_lock.release()


async def run():
    switch_key = read_key("switch-gate-key")
    llm_key = read_key("llm-key", optional=True)
    settings = SimpleNamespace(
        llm_service="llama-server.service", allowed_services=["llama-server.service"],
        systemctl=Path("/usr/bin/systemctl"), admission_url="http://127.0.0.1:8081/control",
        admission_key=switch_key, llm_url="http://127.0.0.1:8080", llm_api_key=llm_key,
        drain_timeout=120,
    )
    registry = ModelRegistry()
    gate = SwitchGate(settings.admission_url, switch_key, SystemdLLM(settings),
                      require_owned_control=True)
    service = SystemdModelService(registry, ActiveModelWriter(registry), SystemctlClient(),
                                  health_timeout=240, settle_timeout=90, api_key=llm_key)
    switch = ModelSwitch(SwitchJournal(STATE / "switch.json", secure_precreated=True),
                         AsyncGPULock(GPU_LOCK), gate, service)
    await recover_orphan(FileLock(WORKER_LOCK, secure_precreated=True), switch,
                         check_stopped=assert_worker_stopped,
                         check_studio=coordinated_studio_is_ready)


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run as root")
    try:
        asyncio.run(run())
    except Exception:
        raise SystemExit("Offline recovery not verified; retain all records and gate holds") from None
    print("Journal model restored and health verified; independent holds remain in place.")


if __name__ == "__main__":
    main()
