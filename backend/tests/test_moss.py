"""MOSS integration tests use temporary files and a stub CLI, never a real GPU."""

import io
import sys
from copy import deepcopy

import pytest
from app.engines.sdcpp import SdCppEngine
from app.main import create_app
from app.models.schemas import JobRequest
from app.services.llm import FakeLLM
from app.services.registry import ModelDefinition, Registry
from conftest import HEADERS, wait_job
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

MODEL_ID = "moss-image-nsfw"


@pytest.fixture
def moss(settings, tmp_path):
    registry = Registry(settings.registry_path, "sdcpp")
    model = registry.models[MODEL_ID]
    for field in ("model_path", "text_encoder_path", "vae_path", "tokenizer_path"):
        path = tmp_path / field
        path.touch()
        model[field] = str(path)
    lora = tmp_path / "custom-adapter.gguf"
    lora.touch()
    model["lora"]["path"] = str(lora)
    return registry


def test_moss_command_and_presets(settings, moss, tmp_path):
    spec = moss.resolve(JobRequest(model_id=MODEL_ID, prompt="a landscape"))
    cmd = SdCppEngine(settings).command(spec, 42, tmp_path / "out.png")
    model = spec["model_snapshot"]
    expected = {
        "--diffusion-model": model["model_path"],
        "--llm": model["text_encoder_path"],
        "--vae": model["vae_path"],
        "--tokenizer": model["tokenizer_path"],
        "--lora-model-dir": str(tmp_path),
        "--flow-shift": "5.0",
        "--backend": "Vulkan0",
        "--cfg-scale": "3.0",
        "--steps": "20",
        "--sampling-method": "euler",
        "--scheduler": "discrete",
        "-W": "512",
        "-H": "512",
        "-p": "moss_xvstyle a landscape <lora:custom-adapter:0.7>",
    }
    for flag, value in expected.items():
        assert cmd.count(flag) == 1
        assert cmd[cmd.index(flag) + 1] == value
    assert spec["prompt"] == "a landscape"
    for preset in ("fast", "quality"):
        assert model["presets"][preset]["validation_status"] == "experimental"
    for changes in (
        {"cfg_scale": 4},
        {"negative_prompt": "blur"},
        {"sampling_method": "heun"},
        {"scheduler": "karras"},
    ):
        with pytest.raises(ValueError):
            moss.resolve(JobRequest(model_id=MODEL_ID, prompt="landscape", **changes))


@pytest.mark.parametrize(
    "prompt",
    [
        "moss_xvstyle a landscape <lora:custom-adapter:0.7>",
        "a landscape, moss_xvstyle, <lora:custom-adapter:0.4>",
    ],
)
def test_lora_deduplication(moss, prompt):
    model = moss.models[MODEL_ID]
    assert SdCppEngine.effective_prompt(prompt, model) == prompt


def test_trigger_boundaries_and_configured_strength(moss):
    model = moss.models[MODEL_ID]
    model["lora"].update(strength=0.25, trigger="custom_trigger")
    prompt = SdCppEngine.effective_prompt("custom_trigger_suffix", model)
    assert prompt == "custom_trigger custom_trigger_suffix <lora:custom-adapter:0.25>"
    assert SdCppEngine.effective_prompt(prompt, model) == prompt


@pytest.mark.parametrize(
    "field",
    [
        "model_path",
        "text_encoder_path",
        "vae_path",
        "tokenizer_path",
        "lora.path",
    ],
)
def test_missing_files_block_admission_and_worker(settings, moss, tmp_path, field):
    settings.sd_cli = tmp_path / "sd-cli"
    settings.sd_cli.touch(mode=0o700)
    spec = moss.resolve(JobRequest(model_id=MODEL_ID, prompt="landscape"))
    model = moss.models[MODEL_ID]
    from pathlib import Path

    Path(model["lora"]["path"] if field == "lora.path" else model[field]).unlink()
    assert moss.get(MODEL_ID)["missing_files"] == [field]
    with pytest.raises(ValueError, match="missing"):
        moss.resolve(JobRequest(model_id=MODEL_ID, prompt="landscape"))
    with pytest.raises(RuntimeError, match="files"):
        SdCppEngine(settings).validate(spec)


def test_disabled_lora_runs_base_moss(settings, moss, tmp_path):
    model = moss.models[MODEL_ID]
    model["lora"].update(enabled=False, path="/missing/adapter.gguf")
    spec = moss.resolve(JobRequest(model_id=MODEL_ID, prompt="landscape"))
    cmd = SdCppEngine(settings).command(spec, 1, tmp_path / "out.png")
    assert "--lora-model-dir" not in cmd
    assert cmd[cmd.index("-p") + 1] == "landscape"
    assert "--tokenizer" in cmd and "--flow-shift" in cmd
    settings.sd_cli = tmp_path / "sd-cli"
    settings.sd_cli.touch(mode=0o700)
    SdCppEngine(settings).validate(spec)


def test_per_job_lora_toggle_is_frozen_and_does_not_mutate_registry(settings, moss, tmp_path):
    assert moss.get(MODEL_ID)["lora_toggle_supported"] is True
    base = moss.resolve(JobRequest(model_id=MODEL_ID, prompt="landscape", lora_enabled=False))
    enabled = moss.resolve(JobRequest(model_id=MODEL_ID, prompt="landscape", lora_enabled=True))
    default = moss.resolve(JobRequest(model_id=MODEL_ID, prompt="landscape"))
    assert moss.models[MODEL_ID]["lora"]["enabled"] is True
    assert base["model_snapshot"]["lora"]["enabled"] is False
    assert enabled["model_snapshot"]["lora"]["enabled"] is True
    assert default["model_snapshot"]["lora"]["enabled"] is True
    cmd = SdCppEngine(settings).command(base, 1, tmp_path / 'base.png')
    assert '--lora-model-dir' not in cmd
    assert cmd[cmd.index('-p') + 1] == 'landscape'
    cmd_on = SdCppEngine(settings).command(enabled, 1, tmp_path / 'on.png')
    assert '--lora-model-dir' in cmd_on
    assert 'moss_xvstyle' in cmd_on[cmd_on.index('-p') + 1]
    moss.models[MODEL_ID]['lora']['strength'] = 0.2
    assert enabled['model_snapshot']['lora']['strength'] == 0.7


def test_lora_override_rejected_for_non_moss_and_non_boolean(moss):
    moss.models['non-moss'] = deepcopy(moss.models[MODEL_ID])
    moss.models['non-moss']['family'] = 'flux2'
    with pytest.raises(ValueError, match='per-job LoRA'):
        moss.resolve(JobRequest(model_id='non-moss', prompt='landscape', lora_enabled=False))
    with pytest.raises(ValidationError):
        JobRequest(model_id=MODEL_ID, prompt='landscape', lora_enabled='false')
    with pytest.raises(ValueError, match='LoRA tags'):
        moss.resolve(JobRequest(model_id=MODEL_ID, prompt='landscape <LoRA:adapter:0.7>', lora_enabled=False))


def test_moss_schema_rejects_incomplete_or_misplaced_options(moss):
    model = deepcopy(moss.models[MODEL_ID])
    for field in ("tokenizer_path", "flow_shift"):
        with pytest.raises(ValidationError):
            ModelDefinition.model_validate({**model, field: None})
    with pytest.raises(ValidationError):
        ModelDefinition.model_validate({**model, "family": "flux2"})
    with pytest.raises(ValidationError):
        ModelDefinition.model_validate({**model, "flow_shift": float("nan")})


@pytest.mark.parametrize(
    "model_id",
    [
        "klein-4b-q4",
        "klein-4b-q8",
        "pornmaster-klein-9b",
        "z-image-turbo",
        "z-image-nsfw-v2",
        "realistic-vision-v6",
    ],
)
def test_existing_models_have_no_moss_arguments(settings, tmp_path, model_id):
    registry = Registry(settings.registry_path, "fake")
    registry.models[model_id]["engine"] = "fake"
    spec = registry.resolve(JobRequest(model_id=model_id, prompt="landscape"))
    cmd = SdCppEngine(settings).command(spec, 1, tmp_path / "out.png")
    assert "--tokenizer" not in cmd
    assert "--flow-shift" not in cmd
    assert "--lora-model-dir" not in cmd
    assert cmd[cmd.index("-p") + 1] == "landscape"
    flag = "-m" if model_id == "realistic-vision-v6" else "--diffusion-model"
    assert cmd[cmd.index(flag) + 1] == spec["model_snapshot"]["model_path"]


def test_moss_api_queue_png_and_service_recovery(settings, moss, tmp_path):
    # Real engine process/PNG handling with a stub executable and FakeLLM.
    executable = tmp_path / "sd-cli"
    executable.write_text(
        f"#!{sys.executable}\n"
        "import sys\nfrom PIL import Image\n"
        "args = sys.argv[1:]\n"
        "assert '--tokenizer' in args and '--flow-shift' in args\n"
        "assert '<lora:custom-adapter:0.7>' in args[args.index('-p') + 1]\n"
        "Image.new('RGB', (512, 512)).save(args[args.index('-o') + 1])\n"
        "print('STUB CLI: no model inference performed')\n"
    )
    executable.chmod(0o700)
    settings.sd_cli = executable
    llm = FakeLLM()
    app = create_app(settings, engine=SdCppEngine(settings), llm=llm)
    with TestClient(app) as client:
        client.headers.update(HEADERS)
        app.state.registry = moss
        models = {m["model_id"]: m for m in client.get("/api/v1/models").json()}
        assert len(models) == 8
        assert models[MODEL_ID]["execution_enabled"]
        assert models[MODEL_ID]["presets"]["fast"]["validation_status"] == "experimental"
        response = client.post(
            "/api/v1/jobs",
            json={
                "model_id": MODEL_ID,
                "prompt": "a landscape",
                "seed": 42,
            },
        )
        assert response.status_code == 202, response.text
        job = wait_job(client, response.json()["job_id"])
        assert job["status"] == "completed", job
        asset_id = job["output_asset_ids"][0]
        png = client.get(f"/api/v1/assets/{asset_id}/file")
        with Image.open(io.BytesIO(png.content)) as image:
            assert image.format == "PNG" and image.size == (512, 512)
        metadata = client.get(f"/api/v1/assets/{asset_id}/metadata").json()
        assert metadata["model_snapshot"]["lora"]["strength"] == 0.7
        assert metadata["steps"] == 20
        assert llm.calls == ["pause", "drain", "stop", "start", "healthy", "resume"]
        assert llm.active and not llm.paused


def test_moss_lora_per_job_api_queue_and_gpu_recovery(settings, moss, tmp_path):
    executable = tmp_path / 'sd-cli'
    executable.write_text(
        f'#!{sys.executable}\n'
        'import sys\nfrom PIL import Image\n'
        'args = sys.argv[1:]\n'
        'prompt = args[args.index("-p") + 1]\n'
        'if "base scene" in prompt:\n'
        '    assert "--lora-model-dir" not in args and "moss_xvstyle" not in prompt\n'
        'else:\n'
        '    assert "--lora-model-dir" in args and "moss_xvstyle" in prompt\n'
        'Image.new("RGB", (512, 512)).save(args[args.index("-o") + 1])\n'
    )
    executable.chmod(0o700)
    settings.sd_cli = executable
    llm = FakeLLM()
    app = create_app(settings, engine=SdCppEngine(settings), llm=llm)
    with TestClient(app) as client:
        client.headers.update(HEADERS)
        app.state.registry = moss
        models = {m['model_id']: m for m in client.get('/api/v1/models').json()}
        assert models[MODEL_ID]['lora_toggle_supported'] is True
        for enabled, prompt in ((False, 'base scene'), (True, 'adapted scene')):
            response = client.post('/api/v1/jobs', json={'model_id': MODEL_ID, 'prompt': prompt, 'seed': 42, 'lora_enabled': enabled})
            assert response.status_code == 202, response.text
            job = wait_job(client, response.json()['job_id'])
            assert job['status'] == 'completed', job
            assert job['model_snapshot']['lora']['enabled'] is enabled
            assert job['lora_enabled'] is enabled
            assert llm.active and not llm.paused
        assert moss.models[MODEL_ID]['lora']['enabled'] is True
