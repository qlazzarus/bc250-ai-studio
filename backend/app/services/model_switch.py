"""Switch/recovery coordinator; deployment requires coordinated gate migration.

The root worker assembles the adapters, but production activation remains gated
on deployment validation and recovery testing.
"""

import asyncio
import json
import os
import stat
import tempfile
from pathlib import Path
from uuid import uuid4

from app.core.files import FileLock, protected_xattrs
from app.services.llm import BusyError
from app.services.model_control import MODEL_NAME


class SwitchRecoveryRequired(RuntimeError):
    pass


class SwitchFailed(RuntimeError):
    def __init__(self, message, *, error_code="service_unavailable"):
        super().__init__(message)
        self.error_code = error_code


class ModelRestartFailed(RuntimeError):
    pass


class ModelHealthTimeout(RuntimeError):
    pass


class SwitchOutcomeUnknown(RuntimeError):
    """A systemd operation may still be running; do not start rollback yet."""


class SwitchAdmissionBlocked(RuntimeError):
    """No mutation occurred; an independent hold requires operator attention."""


class SwitchJournal:
    """A pre-provisioned journal: missing or invalid state fails closed."""

    def __init__(self, path, *, secure_precreated=False):
        self.path = Path(path)
        self.secure_precreated = secure_precreated

    def read(self):
        if self.secure_precreated:
            return StudioSwitchBarrier(self.path).read()
        return self.decode(self.path.read_bytes())

    @staticmethod
    def decode(data):
        if len(data) > 8192:
            raise SwitchRecoveryRequired("Switch journal exceeds size limit")
        state = json.loads(data)
        if state == {}:
            return state
        base_fields = {"hold_id", "old", "target", "stage", "mutation_started"}
        if (not isinstance(state, dict)
                or set(state) not in (base_fields, base_fields | {"operation_id"})
                or ("operation_id" in state and
                    (not isinstance(state["operation_id"], str)
                     or len(state["operation_id"]) != 32
                     or any(c not in "0123456789abcdef" for c in state["operation_id"])))
                or not isinstance(state["hold_id"], str)
                or not state["hold_id"].startswith("switch-")
                or len(state["hold_id"]) != 39
                or any(c not in "0123456789abcdef" for c in state["hold_id"][7:])
                or not isinstance(state["old"], str) or not MODEL_NAME.fullmatch(state["old"])
                or not isinstance(state["target"], str) or not MODEL_NAME.fullmatch(state["target"])
                or state["stage"] not in {"pausing", "draining", "switching", "verifying"}
                or type(state["mutation_started"]) is not bool):
            raise SwitchRecoveryRequired("Invalid switch journal")
        return state

    def write(self, state):
        # Preserve root:group read access when atomically replacing the journal.
        # The file must be provisioned before the first write.
        if self.secure_precreated:
            self.read()  # Validate root-owned parents and the pre-provisioned file.
        self.decode(json.dumps(state).encode())
        metadata = self.path.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise SwitchRecoveryRequired("Invalid switch journal file")
        current = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            if os.fstat(current).st_ino != metadata.st_ino:
                raise SwitchRecoveryRequired("Switch journal changed during validation")
            attributes = protected_xattrs(current)
        finally:
            os.close(current)
        fd, temporary = tempfile.mkstemp(prefix=".switch-", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w") as file:
                os.fchown(file.fileno(), metadata.st_uid, metadata.st_gid)
                os.fchmod(file.fileno(), stat.S_IMODE(metadata.st_mode))
                if protected_xattrs(file.fileno()) != attributes:
                    raise SwitchRecoveryRequired("Switch journal ACL or SELinux label would change")
                json.dump(state, file)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def clear(self):
        self.write({})


class StudioSwitchBarrier:
    """Read a root-controlled journal while holding the shared GPU lock."""

    def __init__(self, path):
        self.path = Path(path)

    @staticmethod
    def _check_file(info):
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or info.st_mode & 0o027):
            raise SwitchRecoveryRequired("Untrusted switch journal permissions")

    def read(self):
        if not self.path.is_absolute() or ".." in self.path.parts:
            raise SwitchRecoveryRequired("Invalid switch journal path")
        directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            FileLock._check_trusted_directory(os.fstat(directory))
            for part in self.path.parts[1:-1]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                dir_fd=directory)
                os.close(directory)
                directory = child
                FileLock._check_trusted_directory(os.fstat(directory))
            fd = os.open(self.path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                         dir_fd=directory)
            try:
                self._check_file(os.fstat(fd))
                return SwitchJournal.decode(os.read(fd, 8193))
            finally:
                os.close(fd)
        finally:
            os.close(directory)


class ModelSwitch:
    def __init__(self, journal, lock, gate, service, *, preflight=None):
        self.journal, self.lock, self.gate, self.service = journal, lock, gate, service
        self.preflight = preflight

    async def switch(self, target, *, operation_id=None, progress=None):
        if not isinstance(target, str) or not MODEL_NAME.fullmatch(target):
            raise ValueError("Invalid model name")
        if operation_id is not None and (not isinstance(operation_id, str)
                or len(operation_id) != 32 or any(c not in "0123456789abcdef" for c in operation_id)):
            raise ValueError("Invalid operation ID")
        report = progress or (lambda stage: None)
        async with self.lock:
            if self.journal.read():
                raise SwitchRecoveryRequired("Previous switch requires recovery")
            if self.preflight is not None:
                try:
                    await asyncio.to_thread(self.preflight)
                except Exception as error:
                    raise SwitchAdmissionBlocked("Studio coordination could not be verified") from error
            if hasattr(self.gate, "ensure_available"):
                await self.gate.ensure_available()
            installed = await self.service.installed()
            if target not in installed:
                raise ValueError("Unknown model")
            old = await self.service.current()
            if not isinstance(old, str) or not MODEL_NAME.fullmatch(old) or old not in installed:
                raise SwitchRecoveryRequired("Cannot verify previous model")
            if target == old:
                await self.service.ensure_settled()
                await self.service.healthy(old)
                return "already_selected"
            state = dict(hold_id=f"switch-{uuid4().hex}", old=old, target=target,
                         stage="pausing", mutation_started=False)
            if operation_id is not None:
                state["operation_id"] = operation_id
            report("pausing")
            self.journal.write(state)
            try:
                await self.gate.acquire(state["hold_id"])
                state["stage"] = "draining"
                self.journal.write(state)
                report("draining")
                await self.gate.drain()
                state.update(stage="switching", mutation_started=True)
                self.journal.write(state)
                report("switching")
                await self.service.apply(target)
                state["stage"] = "verifying"
                self.journal.write(state)
                report("verifying")
                await self.service.healthy(target)
                await self.gate.release(state["hold_id"])
                self.journal.clear()
                return "succeeded"
            except SwitchOutcomeUnknown as error:
                # A killed or timed-out systemctl client does not cancel the
                # systemd job. Leave the durable hold and journal intact.
                raise SwitchRecoveryRequired("Systemd operation outcome is unknown") from error
            except Exception as original:
                try:
                    report("rolling_back")
                    await self._recover_locked(state)
                except Exception as recovery:
                    raise SwitchRecoveryRequired("Model recovery could not be verified") from recovery
                code = ("drain_timeout" if isinstance(original, BusyError) else
                        "restart_failed" if isinstance(original, ModelRestartFailed) else
                        "health_timeout" if isinstance(original, ModelHealthTimeout) else
                        "service_unavailable")
                raise SwitchFailed("Switch failed; previous model restored", error_code=code) from original

    async def recover(self):
        async with self.lock:
            state = self.journal.read()
            if not state:
                return "nothing_to_recover"
            try:
                await self._recover_locked(state)
            except Exception as error:
                raise SwitchRecoveryRequired("Model recovery could not be verified") from error
            return "restored"

    async def _recover_locked(self, state):
        # Reacquire idempotently: the interrupted request may have persisted a
        # hold even if its HTTP response was lost. Preserve unrelated holds.
        await self.gate.acquire(state["hold_id"])
        await self.service.ensure_settled()
        if hasattr(self.gate, "drain_recovery"):
            await self.gate.drain_recovery()
        else:
            await self.gate.drain()
        if state["mutation_started"]:
            await self.service.apply(state["old"])
        await self.service.healthy(state["old"])
        await self.gate.release(state["hold_id"])
        self.journal.clear()
