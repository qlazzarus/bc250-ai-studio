import json
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest
import yaml
from app.core.files import safe_path
from app.engines.fake import FakeEngine
from app.main import create_app
from app.models.database import Asset, Database, Job, emit
from app.models.schemas import JobRequest
from app.services.registry import ModelDefinition, Registry
from conftest import ADMIN, HEADERS, submit, wait_job
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError


def test_registry_missing_files_and_presets(settings):
    registry = Registry(settings.registry_path, "fake")
    assert len(registry.list()) == 8
    assert registry.get("fake")["execution_enabled"]
    model = registry.get("z-image-nsfw-v2")
    assert not model["execution_enabled"]
    assert model["verification_status"] == "unavailable"
    assert model["presets"]["balanced"]["steps"] == 6
    assert model["presets"]["balanced"]["width"] == 768
    realistic = registry.get("realistic-vision-v6")
    assert realistic["enabled"]
    assert realistic["model_path"] == "/opt/sd-models/realistic-vision-v6-fp16.safetensors"


def test_models_publish_typed_generation_capabilities(client, settings):
    models = {model["model_id"]: model for model in client.get("/api/v1/models").json()}
    pornmaster = models["pornmaster-klein-9b"]
    options = pornmaster["generation_options"]

    assert options["cfg_scale"] == {
        "mode": "verified",
        "default": 1.0,
        "allowed_values": [1.0, 1.5, 2.0],
        "minimum": None,
        "maximum": None,
        "note": "BC-250 verified at 512x512, 4 steps, Euler, seed 4242. Negative prompt requires cfg_scale 2.0; 8-step recipes remain unverified.",
        "requires": {},
    }
    assert options["negative_prompt"]["requires"] == {"cfg_scale": [2.0]}
    assert options["sampling_method"]["default"] == "euler"
    assert options["scheduler"] == {
        "mode": "fixed",
        "default": None,
        "allowed_values": [],
        "minimum": None,
        "maximum": None,
        "note": None,
        "requires": {},
    }

    # Capability is the option-policy source; supported_parameters continues
    # to cover the older width/height/steps admission fields.
    registry = Registry(settings.registry_path, "sdcpp")
    assert "cfg_scale" not in registry.models["pornmaster-klein-9b"]["supported_parameters"]


def test_job_option_enums_reject_sd_cli_aliases_and_fixed_scheduler(client):
    body = {"model_id": "fake", "prompt": "A blue chicken"}
    assert client.post("/api/v1/jobs", json=body | {"sampling_method": "normal"}).status_code == 422
    assert client.post("/api/v1/jobs", json=body | {"scheduler": "normal"}).status_code == 422
    fixed = client.post("/api/v1/jobs", json=body | {"scheduler": "karras"})
    assert fixed.status_code == 422
    assert "scheduler" in fixed.json()["detail"]


def test_registry_generation_capability_has_legacy_fallback_and_is_type_checked(tmp_path):
    config = tmp_path / "models.yaml"
    config.write_text(
        """models:
- model_id: legacy
  display_name: Legacy model
  family: fake
  engine: fake
  supported_resolutions: [[64, 64]]
  supported_parameters: [width, height, steps, seed]
  presets:
    balanced: {width: 64, height: 64, steps: 1, cfg_scale: 1.0}
"""
    )
    legacy = Registry(config, "fake").get("legacy")["generation_options"]
    assert legacy["cfg_scale"]["mode"] == "fixed"
    assert legacy["cfg_scale"]["allowed_values"] == [1.0]
    assert legacy["negative_prompt"]["mode"] == "unsupported"

    with pytest.raises(ValidationError, match="Input should be"):
        ModelDefinition.model_validate(
            {
                "model_id": "bad-capability",
                "display_name": "Bad capability",
                "family": "fake",
                "engine": "fake",
                "supported_resolutions": [[64, 64]],
                "supported_parameters": [],
                "presets": {"balanced": {"cfg_scale": 1.0}},
                "generation_options": {
                    "cfg_scale": {"mode": "not-a-status"},
                    "negative_prompt": {"mode": "unsupported"},
                    "sampling_method": {"mode": "fixed"},
                    "scheduler": {"mode": "fixed"},
                },
            }
        )


def test_generate_assets_metadata_and_namespace(client):
    job = wait_job(client, submit(client, seed=42, source="nsfw", client_reference="message-8"))
    assert job["status"] == "completed"
    assert job["items"][0]["seed"] == 42
    asset = job["output_asset_ids"][0]
    assert client.get(f"/api/v1/assets/{asset}/file").content.startswith(b"\x89PNG")
    metadata = client.get(f"/api/v1/assets/{asset}/metadata").json()
    assert metadata["seed"] == 42 and metadata["prompt"] == "A blue chicken"
    assert metadata["client_reference"] == "message-8"
    assert metadata["simulated"] is True
    assert len(client.get("/api/v1/assets?namespace=nsfw").json()) == 1
    assert client.get("/api/v1/assets?namespace=pixel").json() == []


def test_jobs_and_nsfw_assets_support_offset_pagination(client):
    job_ids = [wait_job(client, submit(client, seed=seed, source="nsfw"))["job_id"] for seed in (51, 52, 53)]
    first_jobs = client.get("/api/v1/jobs?limit=2&offset=0").json()
    second_jobs = client.get("/api/v1/jobs?limit=2&offset=2").json()
    assert len(first_jobs) == 2 and len(second_jobs) == 1
    assert {job["job_id"] for job in first_jobs + second_jobs} == set(job_ids)

    first_assets = client.get("/api/v1/assets?namespace=nsfw&limit=2&offset=0").json()
    second_assets = client.get("/api/v1/assets?namespace=nsfw&limit=2&offset=2").json()
    assert len(first_assets) == 2 and len(second_assets) == 1
    assert not {asset["asset_id"] for asset in first_assets}.intersection(
        asset["asset_id"] for asset in second_assets
    )


def test_archive_restore_and_recoverable_delete(client, settings):
    job = wait_job(client, submit(client, seed=91, source="nsfw"))
    asset_id = job["output_asset_ids"][0]

    archived = client.post(f"/api/v1/assets/{asset_id}/archive")
    assert archived.status_code == 200 and archived.json()["archived_at"]
    assert client.get("/api/v1/assets?namespace=nsfw").json() == []
    assert [
        item["asset_id"]
        for item in client.get("/api/v1/assets?namespace=nsfw&archived=true").json()
    ] == [asset_id]
    assert client.get(f"/api/v1/assets/{asset_id}/file").status_code == 200

    restored = client.post(f"/api/v1/assets/{asset_id}/restore")
    assert restored.status_code == 200 and restored.json()["archived_at"] is None
    assert client.post(f"/api/v1/assets/{asset_id}/restore").status_code == 409
    assert client.delete(f"/api/v1/assets/{asset_id}").status_code == 409

    assert client.post(f"/api/v1/assets/{asset_id}/archive").status_code == 200
    assert client.delete(f"/api/v1/assets/{asset_id}").status_code == 204
    assert client.get(f"/api/v1/assets/{asset_id}").status_code == 404
    assert (settings.data_dir / "trash" / f"{asset_id}.png").is_file()
    assert (settings.data_dir / "trash" / f"{asset_id}.json").is_file()


def test_pixel_project_asset_processing_and_approval(client):
    project = client.post(
        "/api/v1/projects",
        json={"name": "Chicken Farm", "art_bible": {"palette": ["#000000", "#ffffff"]}},
    )
    assert project.status_code == 201
    project_id = project.json()["project_id"]
    assert client.post("/api/v1/projects", json={"name": "Chicken Farm"}).status_code == 409

    job = wait_job(client, submit(client, seed=92, source="pixel"))
    source_id = job["output_asset_ids"][0]
    created = client.post(
        f"/api/v1/projects/{project_id}/assets",
        json={"name": "Chicken", "kind": "unit", "source_asset_id": source_id},
    )
    assert created.status_code == 201
    asset_id = created.json()["asset_id"]

    processed = client.post(
        f"/api/v1/assets/{asset_id}/process",
        json={"width": 64, "height": 64, "palette_colors": 8},
    )
    assert processed.status_code == 201
    version = processed.json()
    image = Image.open(BytesIO(client.get(version["file_url"]).content))
    assert image.size == (64, 64) and image.mode == "RGBA"

    approved = client.post(f"/api/v1/assets/{asset_id}/approve?version_id={version['version_id']}")
    assert approved.status_code == 200
    assert approved.json()["approved_version_id"] == version["version_id"]
    assert approved.json()["status"] == "approved"
    archived = client.post(f"/api/v1/pixel/assets/{asset_id}/archive")
    assert archived.status_code == 200 and archived.json()["archived_at"]
    assert client.get(f"/api/v1/projects/{project_id}/assets").json() == []
    assert (
        client.get(f"/api/v1/projects/{project_id}/assets?archived=true").json()[0]["asset_id"]
        == asset_id
    )
    assert client.post(f"/api/v1/pixel/assets/{asset_id}/restore").status_code == 200
    assert client.post(f"/api/v1/pixel/assets/{asset_id}/archive").status_code == 200
    assert client.delete(f"/api/v1/pixel/assets/{asset_id}").status_code == 204
    assert (
        client.app.state.settings.data_dir / "trash" / "pixel" / f"{version['version_id']}.png"
    ).is_file()
    updated = client.put(
        f"/api/v1/projects/{project_id}", json={"art_bible": {"pixel_density": "low"}}
    )
    assert updated.status_code == 200 and updated.json()["art_bible"]["pixel_density"] == "low"


def test_batch_seed_and_results(client):
    job = wait_job(client, submit(client, job_type="image.batch", batch_count=3, seed=8))
    assert job["status"] == "completed"
    assert [item["seed"] for item in job["items"]] == [8, 9, 10]
    assert len(set(job["output_asset_ids"])) == 3


def test_authentication_and_admin(client):
    assert client.get("/api/v1/system/health", headers={"Authorization": ""}).status_code == 401
    assert client.get("/openapi.json", headers={"Authorization": "Bearer bad"}).status_code == 401
    assert client.put("/api/v1/system/policies", json={"mode": "manual"}).status_code == 403
    assert (
        client.put("/api/v1/system/policies", json={"mode": "manual"}, headers=ADMIN).status_code
        == 200
    )
    assert client.get("/openapi.json").status_code == 200
    assert (
        client.post("/api/v1/system/recover", json={"confirmed_no_image_worker": True}).status_code
        == 403
    )


def test_manual_grant_and_cancel(settings):
    settings.policy = "manual"
    with TestClient(create_app(settings), headers=HEADERS) as client:
        first = submit(client)
        assert client.get(f"/api/v1/jobs/{first}").json()["status"] == "queued"
        cancelled = client.post(f"/api/v1/jobs/{first}/cancel").json()
        assert cancelled["status"] == "cancelled"
        assert cancelled["items"][0]["status"] == "cancelled"
        second = submit(client)
        assert client.post("/api/v1/system/manual-grant", headers=ADMIN).status_code == 200
        assert wait_job(client, second)["status"] == "completed"


def test_running_cancel_preserves_partial_outputs(settings):
    settings.fake_delay = 0.15
    with TestClient(create_app(settings), headers=HEADERS) as client:
        job_id = submit(client, job_type="image.batch", batch_count=4)
        wait_job(client, job_id, {"running"})
        assert client.post(f"/api/v1/jobs/{job_id}/cancel").status_code == 200
        job = wait_job(client, job_id)
        assert job["status"] == "cancelled"
        assert len(job["output_asset_ids"]) == 1
        assert job["items"][0]["status"] == "completed"
        assert job["items"][1]["status"] == "cancelled"


class FailOnce(FakeEngine):
    def __init__(self):
        super().__init__()
        self.failed = False

    async def generate(self, *args):
        if not self.failed:
            self.failed = True
            raise RuntimeError("Injected worker failure")
        await super().generate(*args)


def test_failed_retry_preserves_settings(settings):
    with TestClient(create_app(settings, engine=FailOnce()), headers=HEADERS) as client:
        first = wait_job(client, submit(client, seed=456))
        assert first["status"] == "failed"
        assert first["items"][0]["status"] == "failed"
        result = client.post(f"/api/v1/jobs/{first['job_id']}/retry")
        assert result.status_code == 202
        second = wait_job(client, result.json()["job_id"])
        assert second["status"] == "completed"
        assert second["seed"] == first["seed"]
        assert second["retry_of"] == first["job_id"]
        assert second["model_snapshot"] == first["model_snapshot"]
        assert client.post(f"/api/v1/jobs/{second['job_id']}/retry").status_code == 409


def test_generation_options_survive_job_metadata_and_retry(settings, tmp_path):
    config = yaml.safe_load(settings.registry_path.read_text())
    fake = next(model for model in config["models"] if model["model_id"] == "fake")
    fake["generation_options"]["sampling_method"] = {
        "mode": "verified",
        "default": "euler",
        "allowed_values": ["euler"],
    }
    fake["generation_options"]["scheduler"] = {
        "mode": "verified",
        "default": "discrete",
        "allowed_values": ["discrete"],
    }
    settings.registry_path = tmp_path / "models-with-options.yaml"
    settings.registry_path.write_text(yaml.safe_dump(config))
    request_options = {
        "cfg_scale": 8.0,
        "negative_prompt": "avoid blur",
        "sampling_method": "euler",
        "scheduler": "discrete",
    }

    with TestClient(create_app(settings, engine=FailOnce()), headers=HEADERS) as client:
        response = client.post(
            "/api/v1/jobs", json={"model_id": "fake", "prompt": "A blue chicken", **request_options}
        )
        assert response.status_code == 202, response.text
        first = wait_job(client, response.json()["job_id"])
        assert first["status"] == "failed"
        for key, value in request_options.items():
            assert first[key] == value
        assert first["model_snapshot"]["generation_options"]["scheduler"]["default"] == "discrete"

        retried = client.post(f"/api/v1/jobs/{first['job_id']}/retry")
        assert retried.status_code == 202
        second = wait_job(client, retried.json()["job_id"])
        assert second["status"] == "completed"
        assert second["retry_of"] == first["job_id"]
        assert second["model_snapshot"] == first["model_snapshot"]
        for key, value in request_options.items():
            assert second[key] == value

        metadata = client.get(f"/api/v1/assets/{second['output_asset_ids'][0]}/metadata").json()
        for key, value in request_options.items():
            assert metadata[key] == value
        assert metadata["model_snapshot"] == second["model_snapshot"]


def test_legacy_job_and_metadata_default_new_option_fields_without_reinterpretation(settings):
    with TestClient(create_app(settings), headers=HEADERS) as client:
        registry = Registry(settings.registry_path, "fake")
        legacy_spec = registry.resolve(JobRequest(model_id="fake", prompt="legacy", seed=123))
        legacy_spec.pop("sampling_method")
        legacy_spec.pop("scheduler")
        asset_id = "legacy-asset"
        with client.app.state.db.session.begin() as session:
            session.add(
                Job(
                    job_id="legacy-job",
                    status="failed",
                    priority=legacy_spec["priority"],
                    spec=legacy_spec,
                    items=[{"index": 0, "seed": 123, "status": "failed"}],
                    output_asset_ids=[],
                )
            )
            session.add(
                Asset(
                    asset_id=asset_id,
                    job_id="legacy-job",
                    namespace="nsfw",
                    relative_path="outputs/nsfw/legacy-job/legacy-asset.png",
                    details={"asset_id": asset_id, "model_id": "fake", "prompt": "legacy"},
                )
            )

        legacy = client.get("/api/v1/jobs/legacy-job")
        assert legacy.status_code == 200
        assert legacy.json()["sampling_method"] is None
        assert legacy.json()["scheduler"] is None
        metadata = client.get(f"/api/v1/assets/{asset_id}/metadata")
        assert metadata.status_code == 200
        assert metadata.json()["sampling_method"] is None
        assert metadata.json()["scheduler"] is None

        retried = client.post("/api/v1/jobs/legacy-job/retry")
        assert retried.status_code == 202
        result = wait_job(client, retried.json()["job_id"])
        assert result["status"] == "completed"
        assert result["sampling_method"] is None
        assert result["scheduler"] is None
        assert result["model_snapshot"] == legacy_spec["model_snapshot"]


def test_restart_recovery_keeps_queued_work(settings):
    settings.policy = "manual"
    with TestClient(create_app(settings), headers=HEADERS) as client:
        job_id = submit(client)
        queued_id = submit(client)
    db = Database(settings.data_dir)
    with db.session.begin() as session:
        job = session.get(Job, job_id)
        job.status = "running"
        job.items = [dict(job.items[0], status="running")]
        emit(session, job)
    db.engine.dispose()
    with TestClient(create_app(settings), headers=HEADERS) as client:
        job = client.get(f"/api/v1/jobs/{job_id}").json()
        assert job["status"] == "interrupted"
        assert job["items"][0]["status"] == "interrupted"
        assert client.get(f"/api/v1/jobs/{queued_id}").json()["status"] == "queued"


def test_sse_replay_terminal_and_bad_cursor(client):
    job = wait_job(client, submit(client))
    url = f"/api/v1/jobs/{job['job_id']}/events"
    response = client.get(url)
    ids = [int(line[4:]) for line in response.text.splitlines() if line.startswith("id: ")]
    data = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    assert len(ids) >= 5 and ids == sorted(set(ids))
    assert data[-1]["status"] == "completed"
    replay = client.get(url, headers={"Last-Event-ID": str(ids[-2])})
    assert f"id: {ids[-1]}\n" in replay.text
    assert f"id: {ids[-2]}\n" not in replay.text
    assert client.get(url, headers={"Last-Event-ID": str(ids[-1])}).text == ": end\n\n"
    assert client.get(url, headers={"Last-Event-ID": "-1"}).status_code == 422


@pytest.mark.parametrize(
    "changes",
    [
        {"width": 65},
        {"width": 2048, "height": 2048},
        {"steps": 0},
        {"seed": -2},
        {"job_type": "sprite.atlas"},
        {"batch_count": 2},
        {"source": "../secret"},
        {"model_id": "../../etc/passwd"},
        {"unknown": True},
        {"prompt": "\x00"},
        {"project_id": "not-implemented"},
        {"model_id": "z-image-nsfw-v2"},
    ],
)
def test_invalid_inputs(client, changes):
    payload = {"model_id": "fake", "prompt": "test"} | changes
    assert client.post("/api/v1/jobs", json=payload).status_code == 422


def test_body_limit(client):
    assert client.post("/api/v1/jobs", content=b"x" * 70000).status_code == 413


def test_traversal_and_symlink(client, settings, tmp_path):
    with pytest.raises(ValueError):
        safe_path(settings.data_dir, "../secret")
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"secret")
    link = settings.data_dir / "bad.png"
    link.symlink_to(outside)
    with client.app.state.db.session.begin() as session:
        session.add(
            Asset(asset_id="bad", job_id="x", namespace="rp", relative_path="bad.png", details={})
        )
    assert client.get("/api/v1/assets/bad/file").status_code == 404


def test_concurrent_submissions(client):
    with ThreadPoolExecutor(max_workers=8) as pool:
        ids = list(pool.map(lambda _: submit(client), range(12)))
    assert len(set(ids)) == 12
    assert all(wait_job(client, id)["status"] == "completed" for id in ids)


def test_single_instance_lock(settings):
    with TestClient(create_app(settings)):
        with pytest.raises(RuntimeError, match="owns lock"):
            with TestClient(create_app(settings)):
                pass


def test_journal_blocks_until_admin_recovery(settings):
    db = Database(settings.data_dir)
    db.migrate()
    db.state("transition", {"stage": "image_execution", "legacy_pause_started": True,
                            "legacy_initially_paused": False, "legacy_pause_confirmed": True})
    db.engine.dispose()
    with TestClient(create_app(settings), headers=HEADERS) as client:
        id = submit(client)
        assert client.get("/api/v1/system/status").json()["recovery_required"]
        assert client.get(f"/api/v1/jobs/{id}").json()["status"] == "queued"
        result = client.post(
            "/api/v1/system/recover", headers=ADMIN, json={"confirmed_no_image_worker": True}
        )
        assert result.status_code == 200
        assert wait_job(client, id)["status"] == "completed"


def test_old_journal_with_unknown_pause_ownership_fails_closed(settings):
    db = Database(settings.data_dir)
    db.migrate()
    db.state("transition", {"stage": "image_execution"})
    db.engine.dispose()
    with TestClient(create_app(settings), headers=HEADERS) as client:
        result = client.post(
            "/api/v1/system/recover", headers=ADMIN, json={"confirmed_no_image_worker": True}
        )
        assert result.status_code == 503
        assert client.get("/api/v1/system/status").json()["recovery_required"]
