"""Audit log helper (section 14.4): every admin write records before/after."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.db.tables import AuditLog, User


def snapshot(obj: Any, fields: list[str]) -> dict[str, Any]:
    return {field: getattr(obj, field, None) for field in fields}


def diff(before: dict[str, Any], after: dict[str, Any]) -> tuple[dict, dict]:
    """Keep only the keys that actually changed."""
    changed_before = {}
    changed_after = {}
    for key in after:
        if before.get(key) != after.get(key):
            changed_before[key] = before.get(key)
            changed_after[key] = after.get(key)
    return changed_before, changed_after


def audit(
    session: AsyncSession,
    *,
    actor: User | None,
    action: str,
    target_type: str,
    target_id: str | None,
    before: dict | None = None,
    after: dict | None = None,
    ip: str | None = None,
) -> AuditLog:
    """Queue an audit row in the current transaction (committed with the change)."""
    if before is not None and after is not None:
        before, after = diff(before, after)
    row = AuditLog(
        actor_user_id=actor.id if actor else None,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before=before,
        after=after,
        ip=ip,
    )
    session.add(row)
    return row