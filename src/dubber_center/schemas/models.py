"""Pydantic request/response schemas for the public API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator

# --- models --------------------------------------------------------------


class LanguageSet(BaseModel):
    source: list[str]
    target: list[str]


class ModelOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    type: str
    status: str
    version: int = 1
    languages: LanguageSet
    price_per_minute: float
    max_video_minutes: float
    max_concurrent: int
    features: list[str] = Field(default_factory=list)

    # Health (section 15.7)
    health_state: str = "unknown"
    health_since: datetime | None = None
    health_checked_at: datetime | None = None
    success_rate_24h: float | None = None
    avg_duration_sec: float | None = None
    uptime_30d: float | None = None


class ModelListOut(BaseModel):
    data: list[ModelOut]
    total: int
    languages: LanguageSet


# --- files ---------------------------------------------------------------


class FileCreateIn(BaseModel):
    filename: str | None = None
    content_type: str | None = None
    size: int | None = Field(default=None, ge=0)

    @field_validator("filename")
    @classmethod
    def _extension_ok(cls, value: str | None) -> str | None:
        if value is None:
            return value
        ext = value.rsplit(".", 1)[-1].lower() if "." in value else ""
        allowed = {"mp4", "mov", "mkv", "webm"}
        if ext and ext not in allowed:
            from dubber_center.core.errors import InvalidFileType

            raise InvalidFileType(
                f"'{ext}' files are not supported. Use one of: mp4, mov, mkv, webm."
            )
        return value


class FileOut(BaseModel):
    file_id: str
    storage_key: str
    upload_url: str
    upload_method: str = "PUT"
    expires_in: int = 3600
    content_type: str | None = None


# --- jobs ----------------------------------------------------------------


class DubOptions(BaseModel):
    subtitles: bool = True
    keep_background_audio: bool = False
    multi_speaker: bool = False
    extra: dict[str, Any] = Field(default_factory=dict)

    def merged(self) -> dict[str, Any]:
        data = self.model_dump(exclude={"extra"})
        data.update(self.extra)
        return data


class DubCreateIn(BaseModel):
    model: str = Field(min_length=1, max_length=64)
    video_url: HttpUrl | None = None
    file_id: str | None = None
    source_lang: str = Field(min_length=2, max_length=16)
    target_lang: str = Field(min_length=2, max_length=16)
    webhook_url: HttpUrl | None = None
    options: DubOptions | None = None
    minutes: float | None = Field(default=None, gt=0)
    priority: Literal["normal", "low"] = "normal"

    @field_validator("source_lang", "target_lang", mode="before")
    @classmethod
    def _lower(cls, value: object) -> object:
        return value.lower() if isinstance(value, str) else value

    def validate_source(self) -> None:
        from dubber_center.core.errors import ValidationFailed

        if not self.video_url and not self.file_id:
            raise ValidationFailed("Provide either 'video_url' or 'file_id'.")
        if self.video_url and self.file_id:
            raise ValidationFailed("Provide only one of 'video_url' or 'file_id'.")


class DubCreateOut(BaseModel):
    job_id: str
    status: str
    model: str
    estimated_cost: float
    minutes: float | None = None


class JobOutputOut(BaseModel):
    video_url: str | None = None
    audio_url: str | None = None
    subtitles_url: str | None = None
    timing_json_url: str | None = None


class JobEventOut(BaseModel):
    status: str
    message: str | None = None
    created_at: datetime


class JobOut(BaseModel):
    job_id: str
    status: str
    progress: float = 0.0
    stage: str | None = None
    model: str
    model_name: str | None = None
    source_lang: str
    target_lang: str
    minutes: float | None = None
    estimate_cost: float | None = None
    cost: float | None = None
    output: JobOutputOut | None = None
    error: str | None = None
    error_code: str | None = None
    cancel_requested: bool = False
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class JobDetailOut(JobOut):
    events: list[JobEventOut] = Field(default_factory=list)
    options: dict[str, Any] = Field(default_factory=dict)
    attempts: int = 0


class PageOut(BaseModel):
    data: list[Any]
    total: int
    page: int
    size: int


# --- usage ---------------------------------------------------------------


class UsageBucket(BaseModel):
    key: str
    minutes: float
    cost: float
    jobs: int


class UsageOut(BaseModel):
    from_date: str
    to_date: str
    total_minutes: float
    total_cost: float
    total_jobs: int
    by_day: list[UsageBucket] = Field(default_factory=list)
    by_model: list[UsageBucket] = Field(default_factory=list)


# --- misc ----------------------------------------------------------------


class MessageOut(BaseModel):
    message: str
    details: dict[str, Any] = Field(default_factory=dict)