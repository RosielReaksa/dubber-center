"""Settings loaded from environment variables (.env supported)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- application -----------------------------------------------------
    app_env: Literal["dev", "staging", "prod"] = "dev"
    log_level: str = "INFO"
    public_base_url: str = "http://localhost:8000"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    debug: bool = False

    # --- database --------------------------------------------------------
    # Postgres in production; sqlite+aiosqlite for local dev / tests.
    database_url: str = "sqlite+aiosqlite:///./dubber.db"
    db_echo: bool = False
    db_pool_size: int = 10
    db_pool_max_overflow: int = 20

    # --- queue -----------------------------------------------------------
    # Empty string disables Redis and runs jobs in-process.
    redis_url: str = ""

    # --- object storage --------------------------------------------------
    storage_backend: Literal["s3", "local"] = "s3"
    s3_endpoint: str = "http://localhost:9000"
    s3_bucket: str = "dubber-files"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_region: str = "us-east-1"
    local_storage_dir: Path = PROJECT_ROOT / ".storage"

    # --- files -----------------------------------------------------------
    file_retention_days: int = 7
    max_upload_mb: int = 2000
    allowed_video_types: list[str] = Field(
        default_factory=lambda: ["mp4", "mov", "mkv", "webm"]
    )

    # --- auth / secrets --------------------------------------------------
    webhook_secret: str = "change-me"
    admin_bootstrap_email: str = "you@example.com"
    session_cookie_name: str = "dc_session"
    session_ttl_hours: int = 24 * 14

    # --- models ----------------------------------------------------------
    models_dir: Path = PROJECT_ROOT / "models"
    canary_dir: Path = PROJECT_ROOT / "canary"

    # --- jobs ------------------------------------------------------------
    job_poll_interval_sec: float = 2.0
    job_poll_interval_max_sec: float = 30.0
    job_max_attempts: int = 3

    @field_validator("cors_origins", "allowed_video_types", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("local_storage_dir", "models_dir", "canary_dir", mode="after")
    @classmethod
    def _absolute(cls, value: Path) -> Path:
        return value if value.is_absolute() else (Path.cwd() / value).resolve()

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def redis_enabled(self) -> bool:
        return bool(self.redis_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()