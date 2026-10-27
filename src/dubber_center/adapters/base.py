"""The adapter contract (project plan section 8).

Every model, whatever it does inside, is driven through this interface.
"""

from __future__ import annotations

import abc
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

# Error codes shared by checks and job failures (section 15.5).
ERROR_CODES = {
    "provider_auth",
    "provider_unavailable",
    "provider_rate_limited",
    "gpu_unavailable",
    "disk_full",
    "service_unreachable",
    "timeout",
    "output_invalid",
    "output_silent",
    "output_missing",
    "unknown",
}

USER_ERROR_CODES = {"invalid_input", "canceled", "insufficient_credits", "video_too_long"}


class JobInput(BaseModel):
    job_id: str
    input_path_or_url: str
    source_lang: str
    target_lang: str
    options: dict[str, Any] = Field(default_factory=dict)
    workdir: str
    timeout_seconds: float = 600.0
    minutes: float | None = None
    is_canary: bool = False


class AdapterStatus(BaseModel):
    state: str  # running | done | failed | canceled
    progress: float = 0.0  # 0.0 .. 1.0
    message: str = ""
    stage: str | None = None
    error_code: str | None = None


class JobOutput(BaseModel):
    video_path: str
    audio_path: str | None = None
    subtitles_path: str | None = None
    timing_json_path: str | None = None
    minutes: float = 0.0


class AdapterError(Exception):
    """A model failure that should mark the job failed with a known code."""

    def __init__(self, message: str, *, error_code: str = "unknown") -> None:
        super().__init__(message)
        self.message = message
        self.error_code = error_code if error_code in ERROR_CODES else "unknown"


class DubberAdapter(abc.ABC):
    """One adapter per model (or one runner reused by many manifests)."""

    #: manifest id, set by the factory
    model_id: str = ""
    #: the parsed manifest, set by the factory
    manifest: Any = None
    #: a scratch folder the adapter may use
    workdir: Path

    def __init__(self, workdir: str | Path = ".") -> None:
        self.workdir = Path(workdir)

    @abc.abstractmethod
    async def submit(self, job: JobInput) -> str:
        """Start the work and return an external id used by `status`/`result`."""

    @abc.abstractmethod
    async def status(self, external_id: str) -> AdapterStatus:
        """Current state of the submitted work."""

    @abc.abstractmethod
    async def result(self, external_id: str) -> JobOutput:
        """Final output paths. Called once `status` reports done."""

    @abc.abstractmethod
    async def cancel(self, external_id: str) -> None:
        """Best-effort cancel."""

    async def health(self) -> bool:
        """Cheap liveness check for the ping task (section 15.2)."""
        return True

    def classify(self, exc: BaseException) -> AdapterError:
        """Turn an arbitrary exception into an AdapterError with a stable code."""
        if isinstance(exc, AdapterError):
            return exc
        import asyncio

        if isinstance(exc, TimeoutError | asyncio.TimeoutError):
            return AdapterError("The model did not respond in time.", error_code="timeout")
        return AdapterError(str(exc) or exc.__class__.__name__, error_code="unknown")