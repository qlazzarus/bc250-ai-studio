import os
import sys
from copy import deepcopy

import pytest
from app.engines.sdcpp import SdCppEngine
from app.models.schemas import JobRequest
from app.services.registry import Registry


def test_argument_array_and_model_specific_options(settings, tmp_path):
    engine = SdCppEngine(settings)
    spec = Registry(settings.registry_path, "fake").resolve(
        JobRequest(model_id="fake", prompt="$(touch /tmp/never); 'quoted'")
    )
    spec["model_snapshot"].update(family="sd15", model_path="/models/test file.gguf")
    cmd = engine.command(spec, 42, tmp_path / "out.png")
    assert cmd[cmd.index("-p") + 1] == spec["prompt"]
    assert cmd[cmd.index("-m") + 1] == "/models/test file.gguf"
    assert "--diffusion-model" not in cmd


def test_tested_klein_uses_verified_vulkan_autofit_settings(settings, tmp_path):
    registry = Registry(settings.registry_path, "fake")
    spec = {
        "model_snapshot": registry.models["klein-4b-q4"],
        "prompt": "a chicken",
        "negative_prompt": "",
        "width": 512,
        "height": 512,
        "steps": 4,
        "cfg_scale": 1.0,
    }
    command = SdCppEngine(settings).command(spec, 42, tmp_path / "out.png")
    assert spec["model_snapshot"]["validation_status"] == "tested"
    assert command[command.index("--backend") + 1] == "Vulkan0"
    assert "--offload-to-cpu" not in command


def test_dynamic_sampler_and_scheduler_are_emitted_once_and_legacy_specs_keep_cli_args(
    settings, tmp_path
):
    registry = Registry(settings.registry_path, "fake")
    model = deepcopy(registry.models["klein-4b-q4"])
    model["cli_args"] += ["--scheduler", "discrete"]
    spec = {
        "model_snapshot": model,
        "prompt": "a chicken",
        "negative_prompt": "",
        "width": 512,
        "height": 512,
        "steps": 4,
        "cfg_scale": 1.0,
        "sampling_method": "euler",
        "scheduler": "karras",
    }
    command = SdCppEngine(settings).command(spec, 42, tmp_path / "out.png")
    assert command.count("--sampling-method") == 1
    assert command[command.index("--sampling-method") + 1] == "euler"
    assert command.count("--scheduler") == 1
    assert command[command.index("--scheduler") + 1] == "karras"
    assert "discrete" not in command

    legacy = deepcopy(spec)
    legacy.pop("sampling_method")
    legacy.pop("scheduler")
    legacy_command = SdCppEngine(settings).command(legacy, 42, tmp_path / "legacy.png")
    assert legacy_command.count("--sampling-method") == 1
    assert legacy_command[legacy_command.index("--sampling-method") + 1] == "euler"
    assert legacy_command.count("--scheduler") == 1
    assert legacy_command[legacy_command.index("--scheduler") + 1] == "discrete"


def test_pornmaster_cfg_and_negative_prompt_contract_is_resolved_before_execution(settings):
    registry = Registry(settings.registry_path, "fake")
    # Test the configured production model without relying on its BC-250 files.
    registry.models["pornmaster-klein-9b"]["engine"] = "fake"

    spec = registry.resolve(
        JobRequest(
            model_id="pornmaster-klein-9b",
            prompt="test",
            cfg_scale=2.0,
            negative_prompt="avoid blur",
            sampling_method="euler",
        )
    )
    assert spec["cfg_scale"] == 2.0
    assert spec["negative_prompt"] == "avoid blur"
    assert spec["sampling_method"] == "euler"
    assert spec["scheduler"] is None
    assert spec["model_snapshot"]["generation_options"]["cfg_scale"]["mode"] == "verified"

    with pytest.raises(ValueError, match="cfg_scale"):
        registry.resolve(JobRequest(model_id="pornmaster-klein-9b", prompt="test", cfg_scale=1.25))
    with pytest.raises(ValueError, match="negative_prompt requires cfg_scale value 2.0"):
        registry.resolve(
            JobRequest(
                model_id="pornmaster-klein-9b",
                prompt="test",
                cfg_scale=1.0,
                negative_prompt="avoid blur",
            )
        )
    with pytest.raises(ValueError, match="sampling_method"):
        registry.resolve(
            JobRequest(model_id="pornmaster-klein-9b", prompt="test", sampling_method="heun")
        )
    with pytest.raises(ValueError, match="scheduler"):
        registry.resolve(
            JobRequest(model_id="pornmaster-klein-9b", prompt="test", scheduler="karras")
        )


async def test_worker_timeout_reaps_process(settings, tmp_path):
    executable = tmp_path / "fake-cli"
    pid_file = tmp_path / "pid"
    executable.write_text(
        f"#!{sys.executable}\nimport os,time\n"
        f"open({str(pid_file)!r},'w').write(str(os.getpid()))\n"
        "time.sleep(20)\n"
    )
    executable.chmod(0o700)
    settings.sd_cli = executable
    settings.worker_timeout = 0.2
    spec = Registry(settings.registry_path, "fake").resolve(JobRequest(model_id="fake", prompt="x"))
    spec["model_snapshot"].update(family="sd15", model_path="/unused")
    with pytest.raises(TimeoutError):
        await SdCppEngine(settings).generate(spec, 0, tmp_path / "out.png", tmp_path / "log")
    pid = int(pid_file.read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)
