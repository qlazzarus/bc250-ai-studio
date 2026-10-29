"""Local administrator verifies recovery before releasing the gate startup hold."""

import argparse
import asyncio
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path
from types import SimpleNamespace

from app.core.files import FileLock
from app.services.llm import SystemdLLM
from app.services.model_control import ActiveModelWriter, ModelRegistry
from app.services.model_control_bridge import ModelControlClient
from app.services.model_control_runtime import GPU_LOCK, SOCKET, STATE
from app.services.model_switch import SwitchJournal
from app.services.switch_adapters import SwitchGate
from app.services.systemd_model import SystemctlClient, SystemdModelService

CREDENTIAL_DIR = Path("/etc/bc250-model-control")


def open_local(request, *, timeout):
    return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=timeout)


def read_key(name, *, optional=False):
    value = (CREDENTIAL_DIR / name).read_text(encoding="utf-8").rstrip("\r\n")
    if not value and optional:
        return ""
    if len(value) < 24 or any(c.isspace() for c in value):
        raise RuntimeError("Invalid gate administrator credential")
    return value


def check_studio_protocol(token):
    # Never put the token in a URL, command line, or output.
    request = urllib.request.Request(
        "http://127.0.0.1:8090/internal/model-switch/coordination",
        headers={"Authorization": "Bearer " + token.decode("utf-8")},
    )
    with open_local(request, timeout=5) as response:
        data = json.load(response)
    if data != {"protocol": 1, "enabled": True, "transition_clear": True}:
        raise RuntimeError("Studio does not advertise the coordinated GPU contract")


def service_ready(unit, account):
    result = subprocess.run(
        ["/usr/bin/systemctl", "show", "--all",
         "--property=LoadState,ActiveState,MainPID,Job,KillMode,User,Group", unit],
        check=True, capture_output=True, text=True, timeout=10,
    )
    values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if (values.get("LoadState") != "loaded" or values.get("ActiveState") != "active"
            or values.get("Job") != "" or values.get("KillMode") != "control-group"
            or values.get("User") != account or values.get("Group") != account
            or not values.get("MainPID", "").isdigit() or int(values["MainPID"]) <= 0):
        raise RuntimeError("Service not settled or runs as the wrong account")
    return values["MainPID"]


def check_gate_identity(token, role):
    request = urllib.request.Request(
        "http://127.0.0.1:8081/control/identity",
        headers={"Authorization": "Bearer " + token},
    )
    with open_local(request, timeout=5) as response:
        data = json.load(response)
    if data != {"protocol": 2, "role": role}:
        raise RuntimeError("Gate control role mismatch")


def coordinated_studio_is_ready():
    studio_pid = service_ready("bc250-ai-studio.service", "ai-studio")
    gate_pid = service_ready("bc250-llm-gate.service", "ai-gate")
    check_gate_identity(read_key("switch-gate-key"), "switch")
    check_studio_protocol(read_key("studio-coordination-key").encode())
    if (studio_pid != service_ready("bc250-ai-studio.service", "ai-studio")
            or gate_pid != service_ready("bc250-llm-gate.service", "ai-gate")):
        raise RuntimeError("Service restarted during coordination verification")


async def confirm_startup(lock, journal, client, llm, service, registry, check_studio,
                          *, release_id="startup"):
    lock.acquire()
    try:
        if journal.read():
            raise RuntimeError("Model switch journal is not clear")
        pending = await client.request("pending")
        if set(pending) != {"operation"} or pending["operation"] is not None:
            raise RuntimeError("Model switch operation needs attention")
        check_studio()
        state = await llm.gate("GET")
        holds = state.get("holds")
        if (state.get("protocol") != 2 or state.get("durable") is not True
                or not isinstance(holds, list) or release_id not in holds
                or any(not isinstance(h, str) or not (
                    h == "startup" or h == "legacy" or h.startswith("admin-")
                ) for h in holds)):
            raise RuntimeError("Gate has an unknown or unresolved hold")
        await service.ensure_settled()
        await llm.drain()
        await service.healthy(registry.current_model())
        await llm.update_administrator_hold(release_id, acquire=False)
    finally:
        lock.release()


async def release_orphan_hold(lock, journal, client, llm, service, registry,
                                check_studio, owner_gate, hold_id, *, owner="switch"):
    if owner not in {"studio", "switch"} or not re.fullmatch(owner + r"-[0-9a-f]{32}", hold_id):
        raise ValueError("Invalid orphan hold")
    lock.acquire()
    try:
        if journal.read():
            raise RuntimeError("A switch journal requires recovery instead")
        pending = await client.request("pending")
        if set(pending) != {"operation"}:
            raise RuntimeError("Cannot verify the worker")
        operation = pending["operation"]
        if operation is not None and operation.get("state") != "recovery_required":
            raise RuntimeError("A switch is in progress")
        check_studio()
        status = await llm.gate("GET")
        holds = status.get("holds")
        if (status.get("protocol") != 2 or status.get("durable") is not True
                or status.get("paused") is not True or not isinstance(holds, list)
                or hold_id not in holds
                or not any(h in {"startup", "legacy", "admin-reconciliation"} for h in holds)
                or any(not isinstance(h, str) or not (
                    h in {"startup", "legacy", hold_id} or h.startswith("admin-")
                ) for h in holds)):
            raise RuntimeError("Independent hold and one orphan hold required")
        await service.ensure_settled()
        await llm.drain()
        await service.healthy(registry.current_model())
        after = await llm.gate("GET")
        if (after.get("protocol") != 2 or after.get("durable") is not True
                or after.get("paused") is not True or after.get("holds") != holds):
            raise RuntimeError("Gate state changed during verification")
        await owner_gate.release(hold_id)
    finally:
        lock.release()


class GateAdministrator(SystemdLLM):
    async def update_administrator_hold(self, hold_id, *, acquire):
        # No caller-supplied URL, token, command, or hold identifier.
        import httpx

        if hold_id not in {"startup", "admin-reconciliation"} or (acquire and hold_id == "startup"):
            raise ValueError("Unsupported administrator hold")
        async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
            response = await client.request(
                "PUT" if acquire else "DELETE", self.s.admission_url + "/holds/" + hold_id,
                headers={"Authorization": f"Bearer {self.s.admission_key}"},
            )
            response.raise_for_status()
            result = response.json()
        if (not isinstance(result, dict) or type(result.get("paused")) is not bool
                or result.get("held") is not acquire
                or (acquire and result.get("paused") is not True)):
            raise RuntimeError("Could not verify administrator hold")


async def run_confirm(operation, hold_id=None):
    llm_key = read_key("llm-key", optional=True)
    settings = SimpleNamespace(
        llm_service="llama-server.service", allowed_services=["llama-server.service"],
        systemctl=Path("/usr/bin/systemctl"), admission_url="http://127.0.0.1:8081/control",
        admission_key=read_key("gate-admin-key"), llm_url="http://127.0.0.1:8080",
        llm_api_key=llm_key, drain_timeout=120,
    )
    registry = ModelRegistry()
    service = SystemdModelService(registry, ActiveModelWriter(registry), SystemctlClient(),
                                  health_timeout=240, settle_timeout=90, api_key=llm_key)
    gate = GateAdministrator(settings)
    if operation == "status":
        state = await gate.gate("GET")
        return {key: state.get(key) for key in (
            "paused", "active_requests", "waiting_requests", "protocol", "durable", "holds"
        )}
    if operation == "hold-reconciliation":
        state = await gate.gate("GET")
        if state.get("protocol") != 2 or state.get("durable") is not True:
            raise RuntimeError("Owned durable gate protocol required")
        await gate.update_administrator_hold("admin-reconciliation", acquire=True)
        return
    if operation in {"release-orphan-switch", "release-orphan-studio"}:
        owner = "switch" if operation == "release-orphan-switch" else "studio"
        owner_key = read_key(owner + "-gate-key")
        check_gate_identity(owner_key, owner)
        if owner == "switch":
            owner_gate = SwitchGate(settings.admission_url, owner_key, gate,
                                    require_owned_control=True)
        else:
            class StudioGate:
                async def release(self, value):
                    studio_settings = SimpleNamespace(**{**vars(settings), "admission_key": owner_key})
                    await SystemdLLM(studio_settings).resume_owned(value)
            owner_gate = StudioGate()
        await release_orphan_hold(FileLock(GPU_LOCK, secure_precreated=True),
                                    SwitchJournal(STATE / "switch.json", secure_precreated=True),
                                    ModelControlClient(SOCKET), gate, service, registry,
                                    coordinated_studio_is_ready, owner_gate, hold_id, owner=owner)
        return
    release_id = "startup" if operation == "confirm-startup" else "admin-reconciliation"
    await confirm_startup(FileLock(GPU_LOCK, secure_precreated=True),
                          SwitchJournal(STATE / "switch.json", secure_precreated=True),
                          ModelControlClient(SOCKET), gate, service,
                          registry, coordinated_studio_is_ready, release_id=release_id)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("status", "confirm-startup", "hold-reconciliation",
                                              "release-reconciliation", "release-orphan-switch",
                                              "release-orphan-studio"))
    parser.add_argument("hold_id", nargs="?")
    args = parser.parse_args()
    if (args.operation in {"release-orphan-switch", "release-orphan-studio"}) != (args.hold_id is not None):
        parser.error("Only orphan-hold release requires a hold ID")
    if os.geteuid() != 0:
        parser.error("Run as root")
    try:
        result = asyncio.run(run_confirm(args.operation, args.hold_id))
    except Exception:
        raise SystemExit("Verification or release failed; inspect gate status before proceeding") from None
    if args.operation == "status":
        print(json.dumps(result, ensure_ascii=False))
    elif args.operation == "hold-reconciliation":
        print("Reconciliation hold acquired; other holds are unchanged.")
    else:
        print("Requested hold released after verification; other holds are unchanged.")


if __name__ == "__main__":
    main()
