"""SQLAlchemy tables: users, models, jobs, usage, health, admin."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from dubber_center.db.base import Base, new_id, utcnow


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


# --------------------------------------------------------------------------
# Users and API keys
# --------------------------------------------------------------------------


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("usr"))
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(200))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    plan: Mapped[str] = mapped_column(String(32), default="free", nullable=False)
    credits: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    role: Mapped[str] = mapped_column(String(16), default="user", nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False, index=True)
    is_canary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    api_keys: Mapped[list[ApiKey]] = relationship(back_populates="user", lazy="selectin")
    jobs: Mapped[list[Job]] = relationship(back_populates="user", lazy="noload")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("key"))
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    prefix: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), default="default", nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    user: Mapped[User] = relationship(back_populates="api_keys", lazy="joined")


class Session(TimestampMixin, Base):
    """Browser login session for the website (frontend plan section 11)."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("sess"))
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --------------------------------------------------------------------------
# Models and files
# --------------------------------------------------------------------------


class Model(TimestampMixin, Base):
    __tablename__ = "models"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(16), default="api", nullable=False)  # api|local|hybrid
    status: Mapped[str] = mapped_column(
        String(16), default="active", nullable=False, index=True
    )  # active|beta|disabled
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    price_per_minute: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    max_video_minutes: Mapped[float] = mapped_column(Float, default=60.0, nullable=False)
    max_concurrent: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    queue_paused: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Health (section 15)
    health_state: Mapped[str] = mapped_column(
        String(16), default="unknown", nullable=False, index=True
    )
    health_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    health_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    health_recovery_passes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class File(TimestampMixin, Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("file"))
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    filename: Mapped[str | None] = mapped_column(String(255))
    size: Mapped[int | None] = mapped_column(Integer)
    content_type: Mapped[str | None] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16), default="input", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


# --------------------------------------------------------------------------
# Jobs
# --------------------------------------------------------------------------


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("job"))
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model_id: Mapped[str] = mapped_column(
        ForeignKey("models.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(16), default="queued", nullable=False, index=True
    )  # queued|running|done|failed|canceled

    progress: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    stage: Mapped[str | None] = mapped_column(String(120))

    input_file_id: Mapped[str | None] = mapped_column(
        ForeignKey("files.id", ondelete="SET NULL"), index=True
    )
    input_url: Mapped[str | None] = mapped_column(Text)
    source_lang: Mapped[str] = mapped_column(String(16), nullable=False)
    target_lang: Mapped[str] = mapped_column(String(16), nullable=False)
    options: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    external_id: Mapped[str | None] = mapped_column(String(255), index=True)
    output: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(64), index=True)
    error_kind: Mapped[str | None] = mapped_column(String(16))  # user|system

    minutes: Mapped[float | None] = mapped_column(Float)
    estimate_cost: Mapped[float | None] = mapped_column(Float)
    cost: Mapped[float | None] = mapped_column(Float)

    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_canary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    webhook_url: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(String(255))
    admin_notes: Mapped[str | None] = mapped_column(Text)
    retried_from_job_id: Mapped[str | None] = mapped_column(String(64), index=True)
    worker_id: Mapped[str | None] = mapped_column(String(64))

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="jobs", lazy="joined")
    events: Mapped[list[JobEvent]] = relationship(
        back_populates="job", lazy="noload", order_by="JobEvent.created_at"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_jobs_user_idempotency"),
        Index("ix_jobs_status_model_created", "status", "model_id", "created_at"),
        Index("ix_jobs_model_created_at", "model_id", "created_at"),
        Index("ix_jobs_user_created_at", "user_id", "created_at"),
    )


class JobEvent(Base):
    __tablename__ = "job_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    message: Mapped[str | None] = mapped_column(String(500))
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    job: Mapped[Job] = relationship(back_populates="events")


# --------------------------------------------------------------------------
# Usage, billing, webhooks
# --------------------------------------------------------------------------


class UsageLedger(Base):
    __tablename__ = "usage_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_id: Mapped[str | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL"), index=True
    )
    model_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    minutes: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="user", nullable=False)  # user|internal
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: new_id("ctx")
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[float] = mapped_column(Float, nullable=False)  # + top-up, - spend
    balance_after: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    job_id: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    status_code: Mapped[int | None] = mapped_column(Integer)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    ok: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


# --------------------------------------------------------------------------
# Health (section 15)
# --------------------------------------------------------------------------


class ModelHealth(Base):
    __tablename__ = "model_health"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    check_type: Mapped[str] = mapped_column(String(16), nullable=False)  # ping|canary
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, index=True)
    latency_ms: Mapped[float | None] = mapped_column(Float)
    error_code: Mapped[str | None] = mapped_column(String(64))
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )

    __table_args__ = (
        Index("ix_model_health_model_type_time", "model_id", "check_type", "checked_at"),
    )


class ModelStatusEvent(Base):
    __tablename__ = "model_status_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    old_state: Mapped[str] = mapped_column(String(16), nullable=False)
    new_state: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )


class ModelDailyUptime(Base):
    __tablename__ = "model_daily_uptime"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    model_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    up_minutes: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    degraded_minutes: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    down_minutes: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    jobs: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    success_rate: Mapped[float | None] = mapped_column(Float)


# --------------------------------------------------------------------------
# Admin: audit, settings, stats, alerts
# --------------------------------------------------------------------------


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    target_id: Mapped[str | None] = mapped_column(String(64), index=True)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class DailyStat(Base):
    __tablename__ = "daily_stats"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    model_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    jobs_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    jobs_done: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    jobs_failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    minutes: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    revenue: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    avg_duration_sec: Mapped[float | None] = mapped_column(Float)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), default="warning", nullable=False)
    subject_type: Mapped[str] = mapped_column(String(40), default="model", nullable=False)
    subject_id: Mapped[str | None] = mapped_column(String(64), index=True)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="open", nullable=False, index=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(160), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))