import re
from copy import deepcopy
from pathlib import Path
from secrets import randbelow
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


class GenerationOption(BaseModel):
    """A display-only description of one model generation option.

    This is deliberately separate from ``supported_parameters``.  The latter
    controls what ``resolve`` accepts today; capabilities can describe a
    future/experimental option without making a request executable before the
    API and engine path are implemented.
    """

    model_config = ConfigDict(extra="forbid")
    mode: Literal["fixed", "experimental", "verified", "unsupported"]
    default: float | str | None = None
    allowed_values: list[float | str] = Field(default_factory=list)
    minimum: float | None = None
    maximum: float | None = None
    note: str | None = None
    requires: dict[str, list[float | str]] = Field(default_factory=dict)


class GenerationOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cfg_scale: GenerationOption
    negative_prompt: GenerationOption
    sampling_method: GenerationOption
    scheduler: GenerationOption


class LoraDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1)
    strength: float = Field(default=0.7, allow_inf_nan=False)
    trigger: str = ""
    enabled: bool = True


class ModelDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str = Field(pattern=r"^[a-zA-Z0-9_-]+$")
    display_name: str
    family: str
    engine: str = "sdcpp"
    model_path: str | None = None
    text_encoder_path: str | None = None
    vae_path: str | None = None
    tokenizer_path: str | None = None
    flow_shift: float | None = Field(default=None, allow_inf_nan=False)
    lora: LoraDefinition | None = None
    quantization: str = ""
    supported_resolutions: list[list[int]]
    supported_parameters: list[str]
    presets: dict[str, dict]
    enabled: bool = True
    validation_status: str = "configured"
    cli_args: list[str] = Field(default_factory=list)
    generation_options: GenerationOptions | None = None

    @model_validator(mode="after")
    def validate_moss_options(self):
        if self.family == "moss-image":
            if not self.tokenizer_path or self.flow_shift is None:
                raise ValueError("MOSS requires tokenizer_path and flow_shift")
        elif self.tokenizer_path is not None or self.flow_shift is not None:
            raise ValueError("tokenizer_path and flow_shift are only supported for MOSS")
        return self


def legacy_generation_options(model: dict) -> dict:
    """Provide a conservative response for pre-capability YAML definitions.

    The fallback does not infer that a CLI flag is generally safe for a model.
    It only exposes the existing preset/CLI defaults so an older operator
    config stays loadable and clients always receive the same response shape.
    """

    preset = model["presets"].get("balanced") or next(iter(model["presets"].values()))
    sampler = None
    args = model["cli_args"]
    if "--sampling-method" in args:
        index = args.index("--sampling-method")
        if index + 1 < len(args):
            sampler = args[index + 1]
    return GenerationOptions(
        cfg_scale=GenerationOption(
            mode="verified" if "cfg_scale" in model["supported_parameters"] else "fixed",
            default=preset["cfg_scale"],
            allowed_values=[preset["cfg_scale"]],
        ),
        negative_prompt=GenerationOption(
            mode="verified" if "negative_prompt" in model["supported_parameters"] else "unsupported"
        ),
        sampling_method=GenerationOption(
            mode="fixed", default=sampler, allowed_values=[sampler] if sampler else []
        ),
        scheduler=GenerationOption(mode="fixed"),
    ).model_dump()


class Registry:
    def __init__(self, path, engine):
        entries = yaml.safe_load(Path(path).read_text())["models"]
        self.models = {}
        self.engine = engine
        for entry in entries:
            model = ModelDefinition.model_validate(entry).model_dump()
            if model["generation_options"] is None:
                model["generation_options"] = legacy_generation_options(model)
            if model["model_id"] in self.models:
                raise ValueError("Duplicate model ID")
            self.models[model["model_id"]] = model

    def get(self, model_id):
        model = self.models[model_id].copy()
        required = ["model_path"]
        if model["family"] in {"flux2", "z-image", "moss-image"}:
            required += ["text_encoder_path", "vae_path"]
        if model["family"] == "moss-image":
            required += ["tokenizer_path"]
        missing = [
            field for field in required if not model[field] or not Path(model[field]).is_file()
        ]
        lora = model.get("lora")
        if lora and lora["enabled"] and not Path(lora["path"]).is_file():
            missing.append("lora.path")
        if model["engine"] == "fake":
            missing = []
        available = not missing and model["enabled"] and model["engine"] == self.engine
        model.update(
            availability_status="available" if available else "unavailable",
            missing_files=missing,
            execution_enabled=available,
            verification_status=model["validation_status"] if not missing else "unavailable",
            lora_toggle_supported=model["family"] == "moss-image" and bool(lora and lora["enabled"]),
        )
        return model

    def list(self):
        return [self.get(key) for key in self.models]

    @staticmethod
    def _option_allows(option, value):
        if value is None:
            return option["default"] is None
        allowed_values = option["allowed_values"]
        if allowed_values:
            return value in allowed_values
        minimum = option["minimum"]
        maximum = option["maximum"]
        if minimum is None and maximum is None:
            return value == option["default"]
        return (minimum is None or value >= minimum) and (maximum is None or value <= maximum)

    @classmethod
    def _resolve_option(cls, model, spec, field):
        option = model["generation_options"][field]
        requested = spec[field]
        value = option["default"] if requested is None else requested
        if option["mode"] == "unsupported" or not cls._option_allows(option, value):
            raise ValueError(f"Model does not support {field} value")
        spec[field] = value

    def resolve(self, request):
        model = self.get(request.model_id)
        if not model["execution_enabled"]:
            raise ValueError("Model is missing, disabled, or belongs to another engine mode")
        if model["validation_status"] == "failed":
            raise ValueError("Model failed validation; operator review required")
        spec = request.model_dump()
        lora_enabled = spec.get("lora_enabled")
        if lora_enabled is not None and not model["lora_toggle_supported"]:
            raise ValueError("Model does not support per-job LoRA control")
        if lora_enabled is False and re.search(r"<lora:", request.prompt, re.IGNORECASE):
            raise ValueError("LoRA tags are not allowed when LoRA is disabled")
        preset = model["presets"][request.preset]
        for field in ("width", "height", "steps"):
            if spec[field] is None:
                spec[field] = preset[field]
            elif field not in model["supported_parameters"] and spec[field] != preset[field]:
                raise ValueError(f"Model does not support changing {field}")
        if spec["cfg_scale"] is None:
            spec["cfg_scale"] = preset["cfg_scale"]
        self._resolve_option(model, spec, "cfg_scale")

        negative_prompt = model["generation_options"]["negative_prompt"]
        if spec["negative_prompt"] and negative_prompt["mode"] == "unsupported":
            raise ValueError("Model does not support negative_prompt")
        for required_field, allowed_values in negative_prompt["requires"].items():
            if spec["negative_prompt"] and spec.get(required_field) not in allowed_values:
                values = ", ".join(str(value) for value in allowed_values)
                raise ValueError(f"negative_prompt requires {required_field} value {values}")

        self._resolve_option(model, spec, "sampling_method")
        self._resolve_option(model, spec, "scheduler")
        if [spec["width"], spec["height"]] not in model["supported_resolutions"]:
            raise ValueError("Unsupported resolution")
        if spec["seed"] == -1:
            spec["seed"] = randbelow(2147483632)
        # Freeze the model configuration so queued jobs and retries stay reproducible.
        spec["model_snapshot"] = deepcopy(self.models[request.model_id])
        if lora_enabled is not None:
            spec["model_snapshot"]["lora"]["enabled"] = lora_enabled
        return spec
