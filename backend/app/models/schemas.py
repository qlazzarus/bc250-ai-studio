from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

SamplingMethod = Literal[
    "euler",
    "euler_a",
    "heun",
    "dpm2",
    "dpm++2s_a",
    "dpm++2m",
    "dpm++2mv2",
    "ipndm",
    "ipndm_v",
    "lcm",
    "ddim_trailing",
    "tcd",
    "res_multistep",
    "res_2s",
    "er_sde",
    "euler_cfg_pp",
    "euler_a_cfg_pp",
    "euler_ge",
    "dpm++2m_sde",
    "dpm++2m_sde_bt",
    "lms",
]
Scheduler = Literal[
    "discrete",
    "karras",
    "exponential",
    "ays",
    "gits",
    "sgm_uniform",
    "simple",
    "smoothstep",
    "kl_optimal",
    "lcm",
    "bong_tangent",
    "ltx2",
    "logit_normal",
    "flux2",
    "flux",
    "beta",
    "llada_image",
]


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_type: Literal["image.generate", "image.batch"] = "image.generate"
    source: Literal["rp", "nsfw", "pixel"] = "rp"
    project_id: None = None
    model_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    prompt: str = Field(min_length=1, max_length=8000)
    negative_prompt: str = Field(default="", max_length=4000)
    width: int | None = Field(default=None, ge=64, le=2048, multiple_of=8)
    height: int | None = Field(default=None, ge=64, le=2048, multiple_of=8)
    steps: int | None = Field(default=None, ge=1, le=100)
    cfg_scale: float | None = Field(default=None, ge=0, le=30, allow_inf_nan=False)
    sampling_method: SamplingMethod | None = None
    scheduler: Scheduler | None = None
    seed: int = Field(default=-1, ge=-1, le=2147483631)
    priority: int = Field(default=0, ge=0, le=100)
    batch_count: int = Field(default=1, ge=1, le=16)
    preset: Literal["fast", "balanced", "quality"] = "balanced"
    lora_enabled: StrictBool | None = None
    client_reference: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def validate_batch(self):
        if self.job_type == "image.generate" and self.batch_count != 1:
            raise ValueError("Use image.batch for multiple images")
        if not self.prompt.strip():
            raise ValueError("Prompt must contain text")
        if "\x00" in self.prompt or "\x00" in self.negative_prompt:
            raise ValueError("NUL characters are not allowed")
        return self


class Policy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["manual", "chat_priority", "image_priority"]


class RecoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmed_no_image_worker: Literal[True]


JobStatus = Literal[
    "queued", "waiting_for_gpu", "running", "completed", "failed", "cancelled", "interrupted"
]


class AcceptedJob(BaseModel):
    job_id: str
    status: JobStatus


class BatchItem(BaseModel):
    index: int
    seed: int
    status: Literal["pending", "running", "completed", "failed", "cancelled", "interrupted"]
    asset_id: str | None = None
    error_message: str | None = None


class JobView(JobRequest):
    job_id: str
    status: JobStatus
    model_snapshot: dict
    items: list[BatchItem]
    output_asset_ids: list[str]
    cancel_requested: bool
    created_at: str
    started_at: str | None
    completed_at: str | None
    error_message: str | None
    retry_of: str | None


class AssetView(BaseModel):
    asset_id: str
    job_id: str
    namespace: Literal["rp", "nsfw", "pixel"]
    created_at: str
    archived_at: str | None
    file_url: str


PixelKind = Literal["unit", "building", "terrain", "decoration", "item", "ui", "effect"]


class PixelProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    art_bible: dict = Field(default_factory=dict)


class PixelProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    art_bible: dict | None = None


class PixelProjectView(BaseModel):
    project_id: str
    name: str
    art_bible: dict
    created_at: str
    updated_at: str


class PixelAssetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    kind: PixelKind
    source_asset_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-f0-9]+$")


class PixelProcessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    width: int = Field(ge=16, le=2048, multiple_of=8)
    height: int = Field(ge=16, le=2048, multiple_of=8)
    palette_colors: int = Field(default=16, ge=2, le=256)
    remove_solid_background: bool = True
    trim: bool = True
    center: bool = True


class PixelVersionView(BaseModel):
    version_id: str
    asset_id: str
    operation: str
    details: dict
    created_at: str
    file_url: str


class PixelAssetView(BaseModel):
    asset_id: str
    project_id: str
    kind: PixelKind
    name: str
    source_asset_id: str
    status: Literal["draft", "approved"]
    approved_version_id: str | None
    created_at: str
    updated_at: str
    archived_at: str | None
    versions: list[PixelVersionView] = Field(default_factory=list)
