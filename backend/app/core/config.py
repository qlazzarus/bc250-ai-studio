from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="STUDIO_", extra="forbid")
    data_dir: Path = Path.home() / ".local/share/bc250-ai-studio"
    registry_path: Path = ROOT / "config/models.yaml"
    api_key: str = ""
    admin_key: str = ""
    engine: Literal["fake", "sdcpp"] = "fake"
    policy: Literal["manual", "chat_priority", "image_priority"] = "manual"
    cors_origins: list[str] = Field(default_factory=list)
    sd_cli: Path = Path("/opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli")
    gpu_test_approved: bool = False
    llm_service: str = ""
    allowed_services: list[str] = Field(default_factory=list)
    systemctl: Path = Path("/usr/bin/systemctl")
    llm_url: str = "http://127.0.0.1:8080"
    llm_api_key: str = ""
    admission_url: str = ""
    admission_key: str = ""
    gpu_lock_path: Path | None = None
    gpu_memory_used_path: Path | None = None
    gpu_memory_limit_bytes: int = Field(default=512 * 1024 * 1024, ge=0)
    drain_timeout: float = Field(default=60, gt=0)
    health_timeout: float = Field(default=120, gt=0)
    worker_timeout: float = Field(default=600, gt=0)
    poll_interval: float = Field(default=0.2, gt=0)
    fake_delay: float = Field(default=0.02, ge=0)
    max_queue: int = Field(default=1000, ge=1)
    max_body_bytes: int = Field(default=65536, ge=1024)

    @model_validator(mode="after")
    def validate_settings(self):
        if len(self.api_key) < 24 or len(self.admin_key) < 24:
            raise ValueError("STUDIO_API_KEY and STUDIO_ADMIN_KEY must each be >=24 characters")
        if self.api_key == self.admin_key:
            raise ValueError("Client and admin keys must differ")
        self.data_dir = self.data_dir.expanduser().resolve()
        if self.data_dir == ROOT or ROOT in self.data_dir.parents:
            raise ValueError("Data directory must be outside the checkout")
        if "*" in self.cors_origins:
            raise ValueError("Explicit CORS origins required")
        if self.engine == "sdcpp":
            if not self.gpu_test_approved:
                raise ValueError("Real GPU execution requires explicit test approval")
            if not self.gpu_lock_path or not self.gpu_lock_path.is_absolute():
                raise ValueError("Real execution requires a shared absolute GPU lock path")
            if not self.admission_url:
                raise ValueError("Real execution requires a verified external admission gate")
        return self


class GateSettings(BaseSettings):
    """Configuration for the LLM admission proxy, isolated from the Studio API."""

    model_config = SettingsConfigDict(env_prefix="GATE_", extra="forbid")
    api_key: str = ""
    upstream_url: str = "http://127.0.0.1:8080"
    proxy_timeout: float = Field(default=900, gt=0)

    @model_validator(mode="after")
    def validate_gate_settings(self):
        if len(self.api_key) < 24:
            raise ValueError("GATE_API_KEY must be at least 24 characters")
        if not self.upstream_url.startswith("http://127.0.0.1:"):
            raise ValueError("GATE_UPSTREAM_URL must be a loopback HTTP URL")
        return self
