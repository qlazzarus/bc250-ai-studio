import asyncio
import copy

from sqlalchemy import select

from app.core.files import atomic_json, safe_path
from app.models.database import Asset, Job, emit, now, uid
from app.services.llm import BusyError

TERMINAL = {"completed", "failed", "cancelled", "interrupted"}


class Scheduler:
    def __init__(self, settings, db, engine, gpu):
        self.s, self.db, self.engine, self.gpu = settings, db, engine, gpu
        self.task = None
        self.stopping = False
        self.grants = 0
        self.active_job = None
        self.wake = asyncio.Event()

    @property
    def mode(self):
        return self.db.get_state("policy", {"mode": self.s.policy})["mode"]

    def start(self):
        self.task = asyncio.create_task(self.loop(), name="studio-scheduler")

    async def stop(self):
        self.stopping = True
        self.wake.set()
        if self.task:
            # Graceful stop finishes the current image and restores LLM; never cancels recovery.
            await self.task

    def next_job(self):
        with self.db.session() as session:
            return session.scalar(
                select(Job)
                .where(Job.status == "queued")
                .order_by(Job.priority.desc(), Job.created_at, Job.job_id)
                .limit(1)
            )

    async def idle(self):
        try:
            await asyncio.wait_for(self.wake.wait(), self.s.poll_interval)
        except TimeoutError:
            pass
        self.wake.clear()

    async def loop(self):
        try:
            while not self.stopping:
                try:
                    job = self.next_job()
                    if self.gpu.blocked or not job or (self.mode == "manual" and not self.grants):
                        if self.gpu.leased:
                            await self.gpu.release()
                        await self.idle()
                        continue
                    if self.mode == "manual":
                        self.grants -= 1
                    self.active_job = job.job_id
                    await self.run_job(job.job_id)
                except Exception as error:
                    self.gpu.error(f"Scheduler error: {error}")
                    await self.idle()
                finally:
                    self.active_job = None
        finally:
            if self.gpu.leased:
                try:
                    await self.gpu.release()
                except Exception as error:
                    self.gpu.error(str(error))

    def update(self, job_id, **values):
        with self.db.session.begin() as session:
            job = session.get(Job, job_id)
            for key, value in values.items():
                setattr(job, key, value)
            emit(session, job)

    def load(self, job_id):
        with self.db.session() as session:
            return session.get(Job, job_id)

    async def run_job(self, job_id):
        job = self.load(job_id)
        if job.status != "queued":
            return
        starting_mode = self.mode
        self.update(job_id, status="waiting_for_gpu")
        final_status, error = "completed", None
        try:
            if hasattr(self.engine, "validate"):
                self.engine.validate(job.spec)
            if not self.gpu.leased:
                await self.gpu.acquire(job_id)
            else:
                self.gpu.owner = job_id
            self.update(job_id, status="running", started_at=job.started_at or now())
            for index in range(job.spec["batch_count"]):
                current = self.load(job_id)
                if current.items[index]["status"] == "completed":
                    continue
                if current.cancel_requested:
                    final_status = "cancelled"
                    break
                if self.stopping:
                    final_status = "interrupted"
                    error = "Server shutdown at image boundary"
                    break
                items = copy.deepcopy(current.items)
                items[index]["status"] = "running"
                self.update(job_id, items=items)
                try:
                    asset_id = uid()
                    relative = f"outputs/{job.spec['source']}/{job_id}/{asset_id}.png"
                    output = safe_path(self.s.data_dir, relative)
                    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    log = safe_path(self.s.data_dir, f"logs/{job_id}-{index}.log")
                    log.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    await self.engine.generate(job.spec, items[index]["seed"], output, log)
                    metadata = dict(
                        job.spec,
                        seed=items[index]["seed"],
                        batch_index=index,
                        asset_id=asset_id,
                        job_id=job_id,
                        simulated=self.s.engine == "fake",
                    )
                    atomic_json(output.with_suffix(".json"), metadata)
                    with self.db.session.begin() as session:
                        row = session.get(Job, job_id)
                        session.add(
                            Asset(
                                asset_id=asset_id,
                                job_id=job_id,
                                namespace=job.spec["source"],
                                relative_path=relative,
                                details=metadata,
                            )
                        )
                        items[index].update(status="completed", asset_id=asset_id)
                        row.items = items
                        row.output_asset_ids = row.output_asset_ids + [asset_id]
                        emit(session, row)
                except Exception as exception:
                    items[index].update(status="failed", error_message=str(exception))
                    self.update(job_id, items=items)
                    final_status, error = "failed", str(exception)
                    break
                if index + 1 < job.spec["batch_count"] and (
                    self.mode != starting_mode
                    or (self.mode == "chat_priority" and await self.gpu.llm.pending_chat())
                ):
                    final_status = "queued"  # Resume remaining images with the same seeds.
                    break
        except BusyError:
            final_status = "queued"
        except Exception as exception:
            final_status, error = "failed", str(exception)
        finally:
            retain = (
                final_status == "completed"
                and self.mode == "image_priority"
                and not self.stopping
                and self.next_job() is not None
            )
            if self.gpu.leased and not retain:
                try:
                    await self.gpu.release()
                except Exception as exception:
                    # The image is already durable. Report an independent LLM
                    # recovery problem without discarding that successful result.
                    if final_status == "completed" and self.load(job_id).output_asset_ids:
                        error = str(exception)
                    elif error is None:
                        error = str(exception)
                        final_status = "failed"
            current = self.load(job_id)
            if current.cancel_requested and final_status in {"queued", "completed"}:
                final_status = "cancelled"
            items = copy.deepcopy(current.items)
            if final_status in TERMINAL:
                for item in items:
                    if item["status"] in {"pending", "running"}:
                        item["status"] = (
                            "cancelled" if final_status == "cancelled" else "interrupted"
                        )
            self.update(
                job_id,
                status=final_status,
                error_message=error,
                items=items,
                completed_at=now() if final_status in TERMINAL else None,
            )
            if final_status == "queued":
                await self.idle()
