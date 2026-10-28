import asyncio
import re
import time

import httpx


class BusyError(RuntimeError):
    pass


class FakeLLM:
    """Test service, also the default: never invokes systemd or network."""

    def __init__(self):
        self.active = True
        self.paused = False
        self.calls = []

    async def pause(self):
        self.calls.append("pause")
        self.paused = True

    async def resume(self):
        self.calls.append("resume")
        self.paused = False

    async def drain(self):
        self.calls.append("drain")

    async def stop(self):
        self.calls.append("stop")
        self.active = False

    async def start(self):
        self.calls.append("start")
        self.active = True

    async def healthy(self):
        self.calls.append("healthy")

    async def memory(self):
        return {"verified": False, "reason": "fake engine"}

    async def pending_chat(self):
        return False

    async def service_state(self):
        return {
            "ActiveState": "active" if self.active else "inactive",
            "MainPID": "1" if self.active else "0",
            "ControlGroup": "",
        }

    async def verify_stopped(self, state=None):
        state = state or await self.service_state()
        if state.get("ActiveState") != "inactive" or state.get("MainPID") != "0":
            raise RuntimeError("LLM service is not stopped")
        return state


class SystemdLLM:
    def __init__(self, settings):
        self.s = settings
        unit = settings.llm_service
        if not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.@-]*\.service", unit):
            raise ValueError("Explicit valid LLM service name required")
        if unit not in settings.allowed_services:
            raise ValueError("LLM service is not allowlisted")

    async def ctl(self, *args):
        process = await asyncio.create_subprocess_exec(
            str(self.s.systemctl),
            *args,
            self.s.llm_service,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(), 30)
        except BaseException:
            if process.returncode is None:
                process.kill()
            await process.wait()
            raise
        if process.returncode:
            raise RuntimeError(f"systemctl {args[0]} failed ({process.returncode})")
        return stdout.decode().strip()

    async def gate(self, method, payload=None):
        headers = {"Authorization": f"Bearer {self.s.admission_key}"}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.request(
                method, self.s.admission_url, json=payload, headers=headers
            )
            response.raise_for_status()
            value = response.json()
        if not isinstance(value, dict) or type(value.get("paused")) is not bool:
            raise RuntimeError("Admission gate returned an invalid state")
        if type(value.get("waiting_requests")) is not int or value["waiting_requests"] < 0:
            raise RuntimeError("Admission gate must report waiting_requests")
        return value

    async def pause(self):
        raw = await self.ctl("show", "--property=LoadState,KillMode")
        unit = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
        if unit.get("LoadState") != "loaded" or unit.get("KillMode") != "control-group":
            raise RuntimeError(
                "Service must be loaded with KillMode=control-group before switching"
            )
        if not (await self.gate("PUT", {"paused": True}))["paused"]:
            raise RuntimeError("Admission gate did not pause")

    async def service_state(self):
        """Return the systemd state used to decide whether a transition is needed."""
        raw = await self.ctl("show", "--property=ActiveState,MainPID,ControlGroup,KillMode")
        return dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)

    async def verify_stopped(self, state=None):
        """Fail closed unless systemd and its whole cgroup are demonstrably idle."""
        state = state or await self.service_state()
        if state.get("ActiveState") != "inactive" or state.get("MainPID") != "0":
            raise RuntimeError("LLM process termination could not be verified")
        if state.get("KillMode") != "control-group":
            raise RuntimeError("Verified KillMode=control-group is required")
        group = state.get("ControlGroup")
        if group:
            from pathlib import Path

            root = Path("/sys/fs/cgroup").resolve()
            folder = (root / group.lstrip("/")).resolve()
            if root not in folder.parents:
                raise RuntimeError("Invalid service cgroup")
            # A missing cgroup is normal after systemd has reaped an inactive unit.
            if folder.exists():
                for proc_file in folder.rglob("cgroup.procs"):
                    if proc_file.read_text().strip():
                        raise RuntimeError("LLM cgroup still contains processes")
        return state

    async def resume(self):
        if (await self.gate("PUT", {"paused": False}))["paused"]:
            raise RuntimeError("Admission gate did not resume")

    async def pending_chat(self):
        return (await self.gate("GET"))["waiting_requests"] > 0

    async def drain(self):
        end = time.monotonic() + self.s.drain_timeout
        headers = {"Authorization": f"Bearer {self.s.llm_api_key}"} if self.s.llm_api_key else {}
        async with httpx.AsyncClient(timeout=5, headers=headers) as client:
            while True:
                response = await client.get(self.s.llm_url.rstrip("/") + "/slots")
                response.raise_for_status()
                slots = response.json()
                if (
                    not isinstance(slots, list)
                    or not slots
                    or any(
                        not isinstance(slot, dict) or type(slot.get("is_processing")) is not bool
                        for slot in slots
                    )
                ):
                    raise RuntimeError("Cannot verify LLM active requests from /slots")
                if not any(slot["is_processing"] for slot in slots):
                    return
                if time.monotonic() >= end:
                    raise BusyError("LLM requests did not drain; no service stop attempted")
                await asyncio.sleep(0.25)

    async def stop(self):
        await self.ctl("stop")
        await self.verify_stopped()

    async def start(self):
        await self.ctl("start")

    async def healthy(self):
        end = time.monotonic() + self.s.health_timeout
        headers = {"Authorization": f"Bearer {self.s.llm_api_key}"} if self.s.llm_api_key else {}
        async with httpx.AsyncClient(timeout=5, headers=headers) as client:
            while True:
                try:
                    response = await client.get(self.s.llm_url.rstrip("/") + "/health")
                    if response.status_code == 200 and response.json().get("status") == "ok":
                        return
                except (httpx.HTTPError, ValueError, AttributeError):
                    pass
                if time.monotonic() >= end:
                    raise RuntimeError("LLM health check timed out")
                await asyncio.sleep(0.5)

    async def memory(self):
        path = self.s.gpu_memory_used_path
        if path is None:
            return {"verified": False, "reason": "No reliable GPU memory counter configured"}
        used = int(path.read_text().strip())
        if used > self.s.gpu_memory_limit_bytes:
            raise RuntimeError("GPU memory remains above configured idle limit")
        return {"verified": True, "used_bytes": used}
