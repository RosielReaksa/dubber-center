"""Admin API — shared helpers, RBAC, dry-run/confirm rule (section 14.4)."""

from __future__ import annotations

from typing import Any

from fastapi import Query
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.api.deps import (
    ROLE_RANK,
    CurrentUser,
    RequireAdmin,
    RequireOwner,
    RequireSupport,
)
from dubber_center.core.errors import ValidationFailed


class Page:
    """Every admin list endpoint: page/size (max 100) and a total count."""

    def __init__(
        self,
        page: int = Query(default=1, ge=1),
        size: int = Query(default=25, ge=1, le=100),
    ) -> None:
        self.page = page
        self.size = size

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size

    def envelope(self, rows: list[Any], total: int) -> dict:
        return {"data": rows, "total": total, "page": self.page, "size": self.size}


class Dangerous:
    """`?dry_run=true` reports impact; the real call needs `confirm=true`."""

    def __init__(
        self,
        dry_run: bool = Query(default=False),
        confirm: bool = Query(default=False),
    ) -> None:
        self.dry_run = dry_run
        self.confirm = confirm

    def require_confirm(self) -> None:
        if not self.dry_run and not self.confirm:
            raise ValidationFailed(
                "This action needs confirmation. Repeat it with ?confirm=true, "
                "or call it with ?dry_run=true first to see the impact."
            )


async def write_audit(session: AsyncSession, actor, action, target_type, target_id,
                      before=None, after=None, ip: str | None = None) -> None:
    from dubber_center.services.audit import audit

    audit(
        session,
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before=before,
        after=after,
        ip=ip,
    )


def can(actor, role: str) -> bool:
    return ROLE_RANK.get(actor.role, -1) >= ROLE_RANK[role]


__all__ = [
    "CurrentUser",
    "Dangerous",
    "Page",
    "RequireAdmin",
    "RequireOwner",
    "RequireSupport",
    "can",
    "write_audit",
]