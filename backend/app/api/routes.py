import asyncio
import copy
import hmac
import os
import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select

from app.core.files import safe_path
from app.models.database import (
    Asset,
    Job,
    PixelAsset,
    PixelProject,
    PixelVersion,
    emit,
    job_dict,
    now,
    uid,
)
from app.models.schemas import (
    AcceptedJob,
    AssetView,
    JobRequest,
    JobView,
    PixelAssetCreate,
    PixelAssetView,
    PixelProcessRequest,
    PixelProjectCreate,
    PixelProjectUpdate,
    PixelProjectView,
    PixelVersionView,
    Policy,
    RecoveryRequest,
)
from app.pixel.service import process_image
from app.scheduler.runner import TERMINAL


def authenticate(request: Request, authorization: Annotated[str | None, Header()] = None):
    token = authorization.removeprefix("Bearer ") if authorization else ""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required", headers={"WWW-Authenticate": "Bearer"})
    settings = request.app.state.settings
    if hmac.compare_digest(token.encode(), settings.admin_key.encode()):
        return "admin"
    if hmac.compare_digest(token.encode(), settings.api_key.encode()):
        return "client"
    raise HTTPException(401, "Invalid token", headers={"WWW-Authenticate": "Bearer"})


def admin(role=Depends(authenticate)):
    if role != "admin":
        raise HTTPException(403, "Administrator credential required")


router = APIRouter(prefix="/api/v1", dependencies=[Depends(authenticate)])


def state(request):
    return request.app.state


def get_job(s, job_id):
    with s.db.session() as session:
        job = session.get(Job, job_id)
        if job is None:
            raise HTTPException(404, "Job not found")
        return job


def get_asset(s, asset_id):
    with s.db.session() as session:
        asset = session.get(Asset, asset_id)
        if asset is None:
            raise HTTPException(404, "Asset not found")
        return asset


def asset_dict(asset):
    return {
        "asset_id": asset.asset_id,
        "job_id": asset.job_id,
        "namespace": asset.namespace,
        "created_at": asset.created_at,
        "archived_at": asset.archived_at,
        "file_url": f"/api/v1/assets/{asset.asset_id}/file",
    }


def pixel_project_dict(project):
    return {
        "project_id": project.project_id,
        "name": project.name,
        "art_bible": project.art_bible,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def pixel_version_dict(version):
    return {
        "version_id": version.version_id,
        "asset_id": version.asset_id,
        "operation": version.operation,
        "details": version.details,
        "created_at": version.created_at,
        "file_url": f"/api/v1/pixel/versions/{version.version_id}/file",
    }


def pixel_asset_dict(session, pixel_asset):
    return {
        "asset_id": pixel_asset.asset_id,
        "project_id": pixel_asset.project_id,
        "kind": pixel_asset.kind,
        "name": pixel_asset.name,
        "source_asset_id": pixel_asset.source_asset_id,
        "status": pixel_asset.status,
        "approved_version_id": pixel_asset.approved_version_id,
        "created_at": pixel_asset.created_at,
        "updated_at": pixel_asset.updated_at,
        "archived_at": pixel_asset.archived_at,
        "versions": [
            pixel_version_dict(version)
            for version in session.scalars(
                select(PixelVersion)
                .where(PixelVersion.asset_id == pixel_asset.asset_id)
                .order_by(PixelVersion.created_at.desc(), PixelVersion.version_id)
            )
        ],
    }


@router.get("/system/health")
async def health(request: Request):
    with state(request).db.session() as session:
        session.execute(select(1))
    return {"status": "ok"}


@router.get("/system/status")
async def status(request: Request):
    s = state(request)
    return {
        "engine": s.settings.engine,
        "simulated": s.settings.engine == "fake",
        "policy": s.scheduler.mode,
        "gpu_owner": s.gpu.owner,
        "gpu_memory": s.gpu.memory_status,
        "recovery_required": s.gpu.blocked,
        "transition": s.db.get_state("transition", {}),
        "llm_recovery": s.db.get_state("recovery", {}),
        "error": s.db.get_state("error", {}),
        "active_job": s.scheduler.active_job,
        "scheduler_running": s.scheduler.task is not None and not s.scheduler.task.done(),
    }


@router.get("/system/capabilities")
async def capabilities(request: Request):
    return {
        "phase": 1,
        "engine": state(request).settings.engine,
        "job_types": ["image.generate", "image.batch"],
        "durable_sse": True,
        "pixel_processing": False,
        "phaser_export": False,
        "integrated_chat_proxy": False,
        "uploads": False,
    }


@router.get("/system/policies")
async def policies(request: Request):
    return {"mode": state(request).scheduler.mode}


@router.put("/system/policies", dependencies=[Depends(admin)])
async def update_policy(body: Policy, request: Request):
    s = state(request)
    s.db.state("policy", body.model_dump())
    s.scheduler.grants = 0
    s.scheduler.wake.set()
    return body


@router.post("/system/manual-grant", dependencies=[Depends(admin)])
async def grant(request: Request):
    s = state(request)
    if s.scheduler.mode != "manual":
        raise HTTPException(409, "Grant only applies to manual policy")
    if s.gpu.blocked:
        raise HTTPException(503, "GPU recovery required")
    s.scheduler.grants += 1
    s.scheduler.wake.set()
    return {"pending_grants": s.scheduler.grants}


@router.post("/system/recover", dependencies=[Depends(admin)])
async def recover(body: RecoveryRequest, request: Request):
    s = state(request)
    if s.scheduler.active_job or s.gpu.leased:
        raise HTTPException(409, "Wait for current job to finish")
    if not s.gpu.blocked:
        raise HTTPException(409, "No recovery is pending")
    try:
        await s.gpu.recover()
    except Exception as error:
        raise HTTPException(503, str(error)) from error
    return {"status": "recovered"}


@router.get("/models")
async def models(request: Request):
    return state(request).registry.list()


def model_or_404(s, model_id):
    try:
        return s.registry.get(model_id)
    except KeyError:
        raise HTTPException(404, "Model not found") from None


@router.get("/models/{model_id}")
async def model(model_id: str, request: Request):
    return model_or_404(state(request), model_id)


@router.get("/models/{model_id}/presets")
async def presets(model_id: str, request: Request):
    return model_or_404(state(request), model_id)["presets"]


def enqueue(s, spec, retry_of=None):
    with s.db.session.begin() as session:
        count = session.scalar(
            select(func.count()).select_from(Job).where(Job.status.not_in(TERMINAL))
        )
        if count >= s.settings.max_queue:
            raise HTTPException(429, "Queue capacity reached")
        job = Job(
            spec=spec,
            priority=spec["priority"],
            retry_of=retry_of,
            items=[
                {"index": i, "seed": spec["seed"] + i, "status": "pending"}
                for i in range(spec["batch_count"])
            ],
        )
        session.add(job)
        emit(session, job)
        result = {"job_id": job.job_id, "status": job.status}
    s.scheduler.wake.set()
    return result


@router.post("/jobs", status_code=202, response_model=AcceptedJob)
async def create_job(body: JobRequest, request: Request):
    s = state(request)
    try:
        spec = s.registry.resolve(body)
    except (KeyError, ValueError) as error:
        raise HTTPException(422, str(error)) from error
    return enqueue(s, spec)


@router.get("/jobs", response_model=list[JobView])
async def jobs(
    request: Request, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)
):
    with state(request).db.session() as session:
        return [
            job_dict(job)
            for job in session.scalars(
                select(Job).order_by(Job.created_at.desc(), Job.job_id).offset(offset).limit(limit)
            )
        ]


@router.get("/jobs/{job_id}", response_model=JobView)
async def job(job_id: str, request: Request):
    return job_dict(get_job(state(request), job_id))


@router.post("/jobs/{job_id}/cancel", response_model=JobView)
async def cancel(job_id: str, request: Request):
    s = state(request)
    get_job(s, job_id)
    with s.db.session.begin() as session:
        job = session.get(Job, job_id)
        if job.status in TERMINAL:
            raise HTTPException(409, "Job already terminal")
        job.cancel_requested = True
        if job.status == "queued":
            job.status = "cancelled"
            job.completed_at = now()
            job.items = [
                dict(item, status="cancelled") if item["status"] == "pending" else item
                for item in job.items
            ]
        emit(session, job)
        result = job_dict(job)
    return result


@router.post("/jobs/{job_id}/retry", status_code=202, response_model=AcceptedJob)
async def retry(job_id: str, request: Request):
    s = state(request)
    job = get_job(s, job_id)
    if job.status not in {"failed", "interrupted", "cancelled"}:
        raise HTTPException(409, "Only failed, interrupted or cancelled jobs can be retried")
    return enqueue(s, copy.deepcopy(job.spec), retry_of=job_id)


@router.get("/jobs/{job_id}/events")
async def events(
    job_id: str,
    request: Request,
    after: int = Query(0, ge=0),
    last_event_id: Annotated[str | None, Header()] = None,
):
    s = state(request)
    get_job(s, job_id)
    if last_event_id is not None:
        if not last_event_id.isascii() or not last_event_id.isdecimal() or len(last_event_id) > 18:
            raise HTTPException(422, "Last-Event-ID must be a non-negative integer")
        after = int(last_event_id)

    async def stream():
        cursor = after
        heartbeat = time.monotonic()
        while not await request.is_disconnected():
            # Read status before events: terminal status guarantees the terminal event
            # has committed. Reading events first can miss that event during a race.
            terminal = get_job(s, job_id).status in TERMINAL
            entries = s.db.events(job_id, cursor)
            for event_id, payload in entries:
                cursor = event_id
                yield f"id: {event_id}\nevent: job\ndata: {payload}\n\n"
            if terminal and not entries:
                yield ": end\n\n"
                break
            if time.monotonic() - heartbeat > 15:
                yield ": heartbeat\n\n"
                heartbeat = time.monotonic()
            if not entries:
                await asyncio.sleep(0.1)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/assets", response_model=list[AssetView])
async def assets(
    request: Request,
    namespace: Literal["rp", "nsfw", "pixel"] | None = None,
    archived: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    query = select(Asset)
    if namespace:
        query = query.where(Asset.namespace == namespace)
    query = query.where(Asset.archived_at.is_not(None) if archived else Asset.archived_at.is_(None))
    with state(request).db.session() as session:
        return [
            asset_dict(asset)
            for asset in session.scalars(
                query.order_by(Asset.created_at.desc()).offset(offset).limit(limit)
            )
        ]


@router.get("/assets/{asset_id}", response_model=AssetView)
async def asset(asset_id: str, request: Request):
    return asset_dict(get_asset(state(request), asset_id))


@router.get("/projects", response_model=list[PixelProjectView])
async def pixel_projects(request: Request):
    with state(request).db.session() as session:
        return [
            pixel_project_dict(project)
            for project in session.scalars(
                select(PixelProject).order_by(
                    PixelProject.updated_at.desc(), PixelProject.project_id
                )
            )
        ]


@router.post("/projects", status_code=201, response_model=PixelProjectView)
async def create_pixel_project(body: PixelProjectCreate, request: Request):
    s = state(request)
    with s.db.session.begin() as session:
        if session.scalar(select(PixelProject).where(PixelProject.name == body.name)):
            raise HTTPException(409, "Project name already exists")
        project = PixelProject(name=body.name, art_bible=body.art_bible)
        session.add(project)
        session.flush()
        return pixel_project_dict(project)


def get_project(session, project_id):
    project = session.get(PixelProject, project_id)
    if project is None:
        raise HTTPException(404, "Pixel project not found")
    return project


@router.get("/projects/{project_id}", response_model=PixelProjectView)
async def pixel_project(project_id: str, request: Request):
    with state(request).db.session() as session:
        return pixel_project_dict(get_project(session, project_id))


@router.put("/projects/{project_id}", response_model=PixelProjectView)
async def update_pixel_project(project_id: str, body: PixelProjectUpdate, request: Request):
    with state(request).db.session.begin() as session:
        project = get_project(session, project_id)
        values = body.model_dump(exclude_none=True)
        if "name" in values:
            duplicate = session.scalar(
                select(PixelProject).where(
                    PixelProject.name == values["name"], PixelProject.project_id != project_id
                )
            )
            if duplicate:
                raise HTTPException(409, "Project name already exists")
        for key, value in values.items():
            setattr(project, key, value)
        project.updated_at = now()
        return pixel_project_dict(project)


@router.get("/projects/{project_id}/assets", response_model=list[PixelAssetView])
async def pixel_assets(project_id: str, request: Request, archived: bool = Query(False)):
    with state(request).db.session() as session:
        get_project(session, project_id)
        return [
            pixel_asset_dict(session, pixel_asset)
            for pixel_asset in session.scalars(
                select(PixelAsset)
                .where(
                    PixelAsset.project_id == project_id,
                    PixelAsset.archived_at.is_not(None)
                    if archived
                    else PixelAsset.archived_at.is_(None),
                )
                .order_by(PixelAsset.updated_at.desc(), PixelAsset.asset_id)
            )
        ]


@router.post("/projects/{project_id}/assets", status_code=201, response_model=PixelAssetView)
async def create_pixel_asset(project_id: str, body: PixelAssetCreate, request: Request):
    s = state(request)
    with s.db.session.begin() as session:
        get_project(session, project_id)
        source = session.get(Asset, body.source_asset_id)
        if source is None or source.archived_at is not None:
            raise HTTPException(422, "Source image must be an active Studio asset")
        pixel_asset = PixelAsset(
            project_id=project_id,
            name=body.name,
            kind=body.kind,
            source_asset_id=source.asset_id,
        )
        session.add(pixel_asset)
        session.flush()
        return pixel_asset_dict(session, pixel_asset)


def get_pixel_asset(session, asset_id):
    pixel_asset = session.get(PixelAsset, asset_id)
    if pixel_asset is None:
        raise HTTPException(404, "Pixel asset not found")
    return pixel_asset


@router.post("/pixel/assets/{asset_id}/archive", response_model=PixelAssetView)
async def archive_pixel_asset(asset_id: str, request: Request):
    with state(request).db.session.begin() as session:
        pixel_asset = get_pixel_asset(session, asset_id)
        if pixel_asset.archived_at is None:
            pixel_asset.archived_at = now()
            pixel_asset.updated_at = pixel_asset.archived_at
        return pixel_asset_dict(session, pixel_asset)


@router.post("/pixel/assets/{asset_id}/restore", response_model=PixelAssetView)
async def restore_pixel_asset(asset_id: str, request: Request):
    with state(request).db.session.begin() as session:
        pixel_asset = get_pixel_asset(session, asset_id)
        if pixel_asset.archived_at is None:
            raise HTTPException(409, "Pixel asset is not archived")
        pixel_asset.archived_at = None
        pixel_asset.updated_at = now()
        return pixel_asset_dict(session, pixel_asset)


@router.delete("/pixel/assets/{asset_id}", status_code=204)
async def delete_pixel_asset(asset_id: str, request: Request):
    s = state(request)
    with s.db.session.begin() as session:
        pixel_asset = get_pixel_asset(session, asset_id)
        if pixel_asset.archived_at is None:
            raise HTTPException(409, "Archive a Pixel Asset before deleting it")
        versions = list(
            session.scalars(select(PixelVersion).where(PixelVersion.asset_id == asset_id))
        )
        trash = s.settings.data_dir / "trash" / "pixel"
        trash.mkdir(parents=True, exist_ok=True, mode=0o700)
        for version in versions:
            try:
                source = safe_path(s.settings.data_dir, version.relative_path)
            except ValueError:
                continue
            if source.is_file():
                os.replace(source, trash / f"{version.version_id}.png")
            session.delete(version)
        session.delete(pixel_asset)
    return Response(status_code=204)


@router.post("/assets/{asset_id}/process", status_code=201, response_model=PixelVersionView)
async def process_pixel_asset(asset_id: str, body: PixelProcessRequest, request: Request):
    s = state(request)
    with s.db.session.begin() as session:
        pixel_asset = get_pixel_asset(session, asset_id)
        source_asset = session.get(Asset, pixel_asset.source_asset_id)
        if source_asset is None:
            raise HTTPException(409, "Original Studio asset is no longer available")
        try:
            source = safe_path(s.settings.data_dir, source_asset.relative_path)
        except ValueError:
            raise HTTPException(404, "Source image unavailable") from None
        if not source.is_file():
            raise HTTPException(404, "Source image unavailable")
        version_id = uid()
        relative = (
            f"pixel/projects/{pixel_asset.project_id}/{pixel_asset.asset_id}/{version_id}.png"
        )
        target = safe_path(s.settings.data_dir, relative)
        options = body.model_dump()
        try:
            process_image(source, target, options)
        except Exception as error:
            raise HTTPException(422, f"Pixel processing failed: {error}") from error
        version = PixelVersion(
            version_id=version_id,
            asset_id=pixel_asset.asset_id,
            relative_path=relative,
            operation="pillow.pixelize",
            details=options,
        )
        session.add(version)
        session.flush()
        pixel_asset.updated_at = now()
        return pixel_version_dict(version)


@router.post("/assets/{asset_id}/approve", response_model=PixelAssetView)
async def approve_pixel_asset(asset_id: str, version_id: str, request: Request):
    with state(request).db.session.begin() as session:
        pixel_asset = get_pixel_asset(session, asset_id)
        version = session.get(PixelVersion, version_id)
        if version is None or version.asset_id != pixel_asset.asset_id:
            raise HTTPException(422, "Version does not belong to this pixel asset")
        pixel_asset.status = "approved"
        pixel_asset.approved_version_id = version_id
        pixel_asset.updated_at = now()
        return pixel_asset_dict(session, pixel_asset)


@router.get("/pixel/versions/{version_id}/file")
async def pixel_version_file(version_id: str, request: Request):
    s = state(request)
    with s.db.session() as session:
        version = session.get(PixelVersion, version_id)
        if version is None:
            raise HTTPException(404, "Pixel version not found")
        try:
            path = safe_path(s.settings.data_dir, version.relative_path)
        except ValueError:
            raise HTTPException(404, "Pixel version file unavailable") from None
    if not path.is_file():
        raise HTTPException(404, "Pixel version file unavailable")
    return FileResponse(path, media_type="image/png", filename=f"{version_id}.png")


@router.post("/assets/{asset_id}/archive", response_model=AssetView)
async def archive_asset(asset_id: str, request: Request):
    s = state(request)
    with s.db.session.begin() as session:
        row = session.get(Asset, asset_id)
        if row is None:
            raise HTTPException(404, "Asset not found")
        if row.archived_at is None:
            row.archived_at = now()
        return asset_dict(row)


@router.post("/assets/{asset_id}/restore", response_model=AssetView)
async def restore_asset(asset_id: str, request: Request):
    s = state(request)
    with s.db.session.begin() as session:
        row = session.get(Asset, asset_id)
        if row is None:
            raise HTTPException(404, "Asset not found")
        if row.archived_at is None:
            raise HTTPException(409, "Asset is not archived")
        row.archived_at = None
        return asset_dict(row)


@router.delete("/assets/{asset_id}", status_code=204)
async def delete_asset(asset_id: str, request: Request):
    s = state(request)
    with s.db.session.begin() as session:
        row = session.get(Asset, asset_id)
        if row is None:
            raise HTTPException(404, "Asset not found")
        if row.archived_at is None:
            raise HTTPException(409, "Archive an asset before deleting it")
        try:
            image = safe_path(s.settings.data_dir, row.relative_path)
        except ValueError:
            raise HTTPException(404, "Asset file unavailable") from None
        trash = s.settings.data_dir / "trash"
        trash.mkdir(parents=True, exist_ok=True, mode=0o700)
        for source in (image, image.with_suffix(".json")):
            if source.is_file():
                os.replace(source, trash / f"{row.asset_id}{source.suffix}")
        session.delete(row)
    return Response(status_code=204)


@router.get("/assets/{asset_id}/metadata")
async def metadata(asset_id: str, request: Request):
    details = dict(get_asset(state(request), asset_id).details)
    # Assets written before T04 have no explicit sampler/scheduler keys.
    # Normalize the read response without mutating historical metadata so old
    # settings remain inspectable and the client can distinguish absence.
    details.setdefault("sampling_method", None)
    details.setdefault("scheduler", None)
    return details


@router.get("/assets/{asset_id}/file")
async def asset_file(asset_id: str, request: Request):
    s = state(request)
    asset = get_asset(s, asset_id)
    try:
        path = safe_path(s.settings.data_dir, asset.relative_path)
    except ValueError:
        raise HTTPException(404, "Asset file unavailable") from None
    if not path.is_file():
        raise HTTPException(404, "Asset file unavailable")
    return FileResponse(
        path,
        media_type="image/png",
        filename=f"{asset.asset_id}.png",
        headers={"Cache-Control": "private, no-store"},
    )
