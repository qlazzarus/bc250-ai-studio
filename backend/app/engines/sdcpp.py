import asyncio
import os
import re
import signal
from pathlib import Path

from PIL import Image


async def terminate_group(process):
    # A dead group leader does not prove its children have exited.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        await asyncio.wait_for(process.wait(), 5)
    except TimeoutError:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    await process.wait()


class SdCppEngine:
    def __init__(self, settings):
        self.settings = settings

    def validate(self, spec):
        if not self.settings.sd_cli.is_file() or not os.access(self.settings.sd_cli, os.X_OK):
            raise RuntimeError("Configured sd-cli is missing or not executable")
        model = spec["model_snapshot"]
        fields = ["model_path"]
        if model["family"] != "sd15":
            fields += ["text_encoder_path", "vae_path"]
        if model["family"] == "moss-image":
            fields += ["tokenizer_path"]
        paths = [model.get(field) for field in fields]
        lora = model.get("lora")
        if lora and lora["enabled"]:
            paths.append(lora["path"])
        if any(not path or not Path(path).is_file() for path in paths):
            raise RuntimeError("Queued model files are no longer available")

    @staticmethod
    def effective_prompt(prompt, model):
        """Apply configured LoRA without changing the saved user prompt."""
        lora = model.get("lora")
        if not lora or not lora["enabled"]:
            return prompt
        trigger = lora["trigger"]
        if trigger and not re.search(rf"(?<!\w){re.escape(trigger)}(?!\w)", prompt):
            prompt = f"{trigger} {prompt}"
        name = Path(lora["path"]).stem
        # Preserve an explicit user strength for the same LoRA.
        if not re.search(rf"<lora:{re.escape(name)}:[^<>]+>", prompt):
            prompt = f"{prompt} <lora:{name}:{lora['strength']:g}>"
        return prompt

    @staticmethod
    def without_option(args, option):
        """Remove one operator CLI option and its value without touching others."""

        result = []
        index = 0
        while index < len(args):
            argument = args[index]
            if argument == option:
                index += 2
                continue
            if argument.startswith(f"{option}="):
                index += 1
                continue
            result.append(argument)
            index += 1
        return result

    def command(self, spec, seed, output):
        model = spec["model_snapshot"]
        args = [str(self.settings.sd_cli)]
        if model["family"] == "sd15":
            args += ["-m", model["model_path"]]
        else:
            args += [
                "--diffusion-model",
                model["model_path"],
                "--llm",
                model["text_encoder_path"],
                "--vae",
                model["vae_path"],
            ]
        if model["family"] == "moss-image":
            args += [
                "--tokenizer",
                model["tokenizer_path"],
                "--flow-shift",
                str(model["flow_shift"]),
            ]
        lora = model.get("lora")
        if lora and lora["enabled"]:
            args += ["--lora-model-dir", str(Path(lora["path"]).parent)]
        args += [
            "-p",
            self.effective_prompt(spec["prompt"], model),
            "-W",
            str(spec["width"]),
            "-H",
            str(spec["height"]),
            "--steps",
            str(spec["steps"]),
            "--cfg-scale",
            str(spec["cfg_scale"]),
            "--seed",
            str(seed),
            "-o",
            str(output),
        ]
        if spec["negative_prompt"]:
            args += ["-n", spec["negative_prompt"]]
        cli_args = model["cli_args"]
        dynamic_args = []
        # Specs created before T04 do not have these keys.  Keep their frozen
        # operator arguments byte-for-byte compatible for retry/recovery.
        if spec.get("sampling_method") is not None:
            cli_args = self.without_option(cli_args, "--sampling-method")
            dynamic_args += ["--sampling-method", spec["sampling_method"]]
        if spec.get("scheduler") is not None:
            cli_args = self.without_option(cli_args, "--scheduler")
            dynamic_args += ["--scheduler", spec["scheduler"]]
        return args + cli_args + dynamic_args

    async def generate(self, spec, seed, output, log):
        with log.open("wb") as logfile:
            process = await asyncio.create_subprocess_exec(
                *self.command(spec, seed, output),
                stdout=logfile,
                stderr=logfile,
                start_new_session=True,
            )
            try:
                await asyncio.wait_for(process.wait(), self.settings.worker_timeout)
                if process.returncode:
                    raise RuntimeError(
                        f"sd-cli exited {process.returncode}; see private worker log"
                    )
            finally:
                await terminate_group(process)
        if not output.is_file():
            raise RuntimeError("sd-cli returned without the requested PNG")
        with Image.open(output) as result:
            if result.format != "PNG" or result.size != (spec["width"], spec["height"]):
                raise RuntimeError("sd-cli output format or dimensions mismatch")
            result.verify()
