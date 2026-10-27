"""Model manifest schema and YAML loader (project plan section 7).

Adding a model = adding one YAML file under `models/`. Nothing else changes.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

ModelType = Literal["api", "local", "hybrid"]
ModelStatus = Literal["active", "beta", "disabled"]
RunnerKind = Literal["http", "cli", "python"]


class LanguagePair(BaseModel):
    source: list[str] = Field(default_factory=list)
    target: list[str] = Field(default_factory=list)

    @field_validator("source", "target", mode="before")
    @classmethod
    def _lower(cls, value: object) -> object:
        if isinstance(value, list):
            return [str(v).strip().lower() for v in value if str(v).strip()]
        return value

    def supports(self, source: str, target: str) -> bool:
        return source.lower() in self.source and target.lower() in self.target


class HttpRunner(BaseModel):
    submit_url: str
    status_url: str
    result_url: str
    cancel_url: str | None = None
    health_url: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    timeout_sec: float = 30.0


class CliRunner(BaseModel):
    command: str
    progress_file: str | None = None
    output_file: str = "{outdir}/dubbed.mp4"
    audio_file: str | None = None
    subtitles_file: str | None = None
    timing_json_file: str | None = None
    health_command: str | None = None
    env: dict[str, str] = Field(default_factory=dict)
    shell: bool = True


class PythonRunner(BaseModel):
    """A class inside this codebase, resolved by dotted path."""

    class_path: str  # e.g. "dubber_center.adapters.paidv1:PaidV1Adapter"


class RunnerConfig(BaseModel):
    kind: RunnerKind
    http: HttpRunner | None = None
    cli: CliRunner | None = None
    python: PythonRunner | None = None

    @model_validator(mode="after")
    def _matching_block(self) -> RunnerConfig:
        block = {"http": self.http, "cli": self.cli, "python": self.python}[self.kind]
        if block is None:
            raise ValueError(f"runner.kind is '{self.kind}' but runner.{self.kind} is missing")
        return self


class CanaryConfig(BaseModel):
    enabled: bool = False
    interval_minutes: int = 60
    sample: str = "canary/sample_en_10s.mp4"
    source_lang: str = "en"
    target_lang: str = "km"
    max_minutes: float = 5.0
    low_priority: bool = True


class HealthConfig(BaseModel):
    ping_interval_sec: int = 60
    ping_timeout_sec: float | None = None
    canary: CanaryConfig = Field(default_factory=CanaryConfig)
    # Per-model threshold overrides (section 15.6). None = use the global setting.
    down_ping_failures: int | None = None
    down_canary_failures: int | None = None
    window_minutes: int | None = None
    down_success_rate: float | None = None
    down_min_jobs: int | None = None
    degraded_success_rate: float | None = None
    degraded_min_jobs: int | None = None
    p95_multiplier: float | None = None
    max_queue_wait_minutes: float | None = None
    recover_passes: int | None = None
    baseline_p95_sec: float | None = None


class ModelManifest(BaseModel):
    id: str
    name: str
    description: str = ""
    type: ModelType = "api"
    status: ModelStatus = "active"
    version: int = 1
    languages: LanguagePair = Field(default_factory=LanguagePair)
    price_per_minute: float = 0.0
    max_video_minutes: float = 60.0
    max_concurrent: int = 1
    timeout_minutes: float = 45.0
    features: list[str] = Field(default_factory=list)
    fallback: str | None = None
    is_fake: bool = False
    runner: RunnerConfig
    health: HealthConfig = Field(default_factory=HealthConfig)

    @field_validator("id")
    @classmethod
    def _valid_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("id must not be empty")
        if not all(ch.isalnum() or ch in "-_" for ch in cleaned):
            raise ValueError("id may contain only letters, digits, '-' and '_'")
        return cleaned.lower()

    @field_validator("timeout_minutes")
    @classmethod
    def _positive_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("timeout_minutes must be positive")
        return value

    def supports(self, source: str, target: str) -> bool:
        return self.languages.supports(source, target)

    def estimate_cost(self, minutes: float) -> float:
        return round(max(minutes, 0.0) * self.price_per_minute, 4)

    def public_dict(self) -> dict[str, Any]:
        """Manifest fields safe to return to users. Never includes runner URLs."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "type": self.type,
            "status": self.status,
            "version": self.version,
            "languages": {
                "source": self.languages.source,
                "target": self.languages.target,
            },
            "price_per_minute": self.price_per_minute,
            "max_video_minutes": self.max_video_minutes,
            "max_concurrent": self.max_concurrent,
            "timeout_minutes": self.timeout_minutes,
            "features": self.features,
        }


class ManifestError(ValueError):
    """Raised when a manifest file cannot be loaded or validated."""


def load_manifest_file(path: Path) -> ModelManifest:
    if not path.exists():
        raise ManifestError(f"manifest not found: {path}")
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ManifestError(f"{path.name}: invalid YAML ({exc})") from exc
    if not isinstance(raw, dict):
        raise ManifestError(f"{path.name}: manifest must be a YAML mapping")
    return parse_manifest(raw, source=path.name)


def parse_manifest(raw: dict[str, Any], source: str = "<inline>") -> ModelManifest:
    try:
        return ModelManifest.model_validate(raw)
    except Exception as exc:
        raise ManifestError(f"{source}: {exc}") from exc


def load_manifests(models_dir: Path) -> tuple[list[ModelManifest], list[str]]:
    """Load every *.yaml / *.yml. Returns (manifests, errors)."""
    manifests: list[ModelManifest] = []
    errors: list[str] = []
    seen: set[str] = set()

    if not models_dir.exists():
        return manifests, [f"models directory not found: {models_dir}"]

    for path in sorted(models_dir.iterdir()):
        if path.suffix.lower() not in {".yaml", ".yml"} or not path.is_file():
            continue
        try:
            manifest = load_manifest_file(path)
        except ManifestError as exc:
            errors.append(str(exc))
            continue
        if manifest.id in seen:
            errors.append(f"{path.name}: duplicate model id '{manifest.id}'")
            continue
        seen.add(manifest.id)
        manifests.append(manifest)

    return manifests, errors