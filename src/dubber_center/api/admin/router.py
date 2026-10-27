"""Admin routers. All live under /v1/admin and are role-checked in dependencies."""

from __future__ import annotations

from fastapi import APIRouter

from dubber_center.api.admin import entities, models, overview
from dubber_center.api.admin.common import RequireAdmin, RequireSupport

admin_router = APIRouter(prefix="/admin")
admin_router.include_router(overview.router)
admin_router.include_router(models.router)
admin_router.include_router(entities.jobs_router)
admin_router.include_router(entities.users_router)
admin_router.include_router(entities.usage_router)
admin_router.include_router(entities.queue_router)
admin_router.include_router(entities.settings_router)
admin_router.include_router(entities.audit_router)

__all__ = ["RequireAdmin", "RequireSupport", "admin_router"]
