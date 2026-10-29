import asyncio
from uuid import uuid4

from app.core.files import FileLock, LockBusyError
from app.models.database import now
from app.services.model_switch import StudioSwitchBarrier


class RecoveryError(RuntimeError):
    """A restoration failure which says whether GPU ownership is still known safe."""

    def __init__(self, error, gpu_safe):
        super().__init__(f"LLM recovery failed: {error}")
        self.gpu_safe = gpu_safe


class GPUManager:
    def __init__(self, settings, db, llm):
        self.s, self.db, self.llm = settings, db, llm
        self.lock = asyncio.Lock()
        self.file_lock = FileLock(
            settings.gpu_lock_path or settings.data_dir / "gpu.lock",
            secure_precreated=settings.gpu_lock_secure_precreated,
        )
        self.owner = None
        self.switch_barrier = (
            StudioSwitchBarrier(settings.switch_journal_path) if settings.switch_journal_path else None
        )
        self.leased = False
        self.transition = db.get_state("transition", {})
        self.blocked = bool(self.transition)
        self.memory_status = {"verified": False, "reason": "not measured"}

    def model_switch_coordination_enabled(self):
        return bool(
            self.s.admission_owned_holds and self.s.gpu_lock_secure_precreated
            and str(self.file_lock.path) == "/run/bc250-gpu/gpu.lock"
            and self.switch_barrier is not None
            and str(self.switch_barrier.path) == "/var/lib/bc250-model-control/switch.json"
        )

    def journal(self, stage, **details):
        self.transition = {**self.transition, **details, "stage": stage, "at": now()}
        self.db.state("transition", self.transition)

    def error(self, message):
        self.db.state("error", {"message": message, "at": now()})

    async def _verify_gpu_idle(self, state=None):
        await self.llm.verify_stopped(state)
        self.memory_status = await self.llm.memory()
        self.transition["gpu_verified_idle"] = True

    async def acquire(self, owner):
        await self.lock.acquire()
        try:
            if self.blocked:
                raise RuntimeError("GPU recovery required before execution")
            self.file_lock.acquire()
            self._check_switch_barrier()
            if self.s.admission_owned_holds:
                await self.llm.ensure_image_admission()
        except BaseException:
            self.file_lock.release()
            self.lock.release()
            raise
        self.owner, self.leased = owner, True
        self.transition = {
            "originally_running": False,
            "stopped_by_studio": False,
            "gpu_verified_idle": False,
            "legacy_pause_started": False,
        }
        if self.s.admission_owned_holds:
            self.transition["admission_hold_id"] = f"studio-{uuid4().hex}"
        try:
            # Inspect systemd before touching /slots. An inactive server has no
            # endpoint to drain, but the admission proxy is still paused first.
            state = await self.llm.service_state()
            active = state.get("ActiveState") == "active" and state.get("MainPID") not in {"", "0"}
            inactive = state.get("ActiveState") == "inactive" and state.get("MainPID") == "0"
            if not (active or inactive):
                raise RuntimeError("LLM service state is neither active nor safely inactive")
            self.transition["originally_running"] = active
            self.journal("pausing_admission")
            hold_id = self.transition.get("admission_hold_id")
            if hold_id:
                await self.llm.pause_owned(hold_id)
            else:
                self.transition["legacy_initially_paused"] = await self.llm.admission_paused()
                self.transition["legacy_pause_started"] = True
                self.journal("pausing_admission")
                await self.llm.pause()
                self.transition["legacy_pause_confirmed"] = True
                self.journal("paused_admission")
            if active:
                self.journal("draining")
                await self.llm.drain()
                self.transition["stopped_by_studio"] = True
                self.journal("stopping_llm")
                await self.llm.stop()
                state = None
            else:
                self.journal("verifying_inactive_llm")
                await self.llm.verify_stopped(state)
            await self._verify_gpu_idle(state)
            self.journal("image_execution")
        except BaseException as original:
            self.error(str(original))
            # Never replace the admission/drain/stop error with a recovery error.
            try:
                await self._restore()
            except RecoveryError:
                pass
            # _restore records its own diagnostic in `recovery`; keep the error
            # visible to the job/scheduler as the operation that actually failed.
            self.error(str(original))
            self._unlock()
            raise

    async def _restore(self):
        start = self.transition.get("stopped_by_studio", False)
        originally_running = self.transition.get("originally_running", False)
        try:
            self.journal("restoring_llm")
            if start:
                await self.llm.start()
                await self.llm.healthy()
            # A previously inactive LLM must not be started or health-checked.
            hold_id = self.transition.get("admission_hold_id")
            if hold_id:
                await self.llm.resume_owned(hold_id)
            elif self.transition.get("legacy_initially_paused") is True:
                pass  # Preserve an administrator pause that predates this image.
            elif self.transition.get("legacy_pause_started") is False:
                pass  # No legacy pause was attempted.
            elif self.transition.get("legacy_pause_confirmed") is True:
                await self.llm.resume()
            else:
                raise RuntimeError("Legacy admission pause ownership is unknown; inspect manually")
            self.db.state("transition", {})
            self.transition = {}
            self.blocked = False
            self.db.state("recovery", {})
        except BaseException as error:
            # A failed start may have left a process holding the GPU. For an
            # originally inactive service, independently re-check idleness before
            # deciding whether this is an availability issue or a GPU safety one.
            gpu_safe = False
            if not originally_running:
                try:
                    await self._verify_gpu_idle()
                    gpu_safe = True
                except BaseException:
                    pass
            # A failed restoration needs reconciliation even if the GPU is idle:
            # admission state and the transition record may still be unresolved.
            self.blocked = True
            guidance = (
                "Inspect systemctl state and GPU processes, then call /system/recover."
                if self.blocked
                else "LLM remains unavailable; inspect the admission gate and service logs."
            )
            self.db.state(
                "recovery",
                {"message": str(error), "gpu_safe": gpu_safe, "action": guidance, "at": now()},
            )
            self.error(f"LLM recovery failed: {error}")
            raise RecoveryError(error, gpu_safe) from error

    def _unlock(self):
        self.owner = None
        self.leased = False
        self.file_lock.release()
        self.lock.release()

    def _check_switch_barrier(self):
        if self.switch_barrier and self.switch_barrier.read():
            raise LockBusyError("Model switch recovery required before GPU work")

    async def release(self):
        if not self.leased:
            return
        try:
            await self._restore()
        finally:
            self._unlock()

    async def recover(self):
        async with self.lock:
            if not self.blocked:
                return
            self.file_lock.acquire()
            try:
                self._check_switch_barrier()
                await self._restore()
                self.db.state("error", {})
            finally:
                self.file_lock.release()
