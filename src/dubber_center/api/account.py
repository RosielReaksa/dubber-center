"""User-facing account endpoints: keys, credits, default settings.

The frontend needs these; the admin API is too powerful to expose to customers.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.api.deps import CurrentUser
from dubber_center.core.errors import Conflict, NotFound
from dubber_center.core.security import key_prefix
from dubber_center.db.base import get_session, utcnow
from dubber_center.db.tables import ApiKey, CreditTransaction
from dubber_center.services.usage import credits_history
from dubber_center.services.users import issue_api_key

router = APIRouter(tags=["account"])


# --- keys ----------------------------------------------------------------


class KeyCreateIn(BaseModel):
    name: str = Field(default="default", min_length=1, max_length=120)


@router.get("/keys", summary="List my API keys")
async def my_keys(
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> dict:
    rows = (
        await session.scalars(
            select(ApiKey)
            .where(ApiKey.user_id == user.id)
            .order_by(ApiKey.created_at.desc())
        )
    ).all()
    return {
        "data": [
            {
                "id": key.id,
                "prefix": key.prefix,
                "name": key.name,
                "created_at": key.created_at,
                "last_used_at": key.last_used_at,
                "revoked_at": key.revoked_at,
            }
            for key in rows
        ]
    }


@router.post("/keys", status_code=201, summary="Create a key (shown once)")
async def create_my_key(
    payload: KeyCreateIn,
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> dict:
    raw = await issue_api_key(session, user, name=payload.name)
    await session.commit()
    return {"key": raw, "prefix": key_prefix(raw), "name": payload.name}


@router.delete("/keys/{key_id}", summary="Revoke my key")
async def revoke_my_key(
    key_id: str,
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> dict:
    key = await session.scalar(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user.id)
    )
    if key is None:
        raise NotFound("Key not found.")
    if key.revoked_at is not None:
        raise Conflict("This key is already revoked.")
    key.revoked_at = utcnow()
    await session.commit()
    return {"id": key.id, "revoked_at": key.revoked_at}


# --- credits -------------------------------------------------------------


@router.get("/credits", summary="My balance and recent transactions")
async def my_credits(
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
    limit: int = 50,
) -> dict:
    return {
        "balance": user.credits,
        "currency": "USD",
        "transactions": await credits_history(session, user.id, limit=min(limit, 200)),
    }


@router.get("/credits/transactions", summary="My credit transactions")
async def my_transactions(
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
    limit: int = 50,
) -> dict:
    rows = (
        await session.scalars(
            select(CreditTransaction)
            .where(CreditTransaction.user_id == user.id)
            .order_by(CreditTransaction.created_at.desc())
            .limit(min(limit, 200))
        )
    ).all()
    return {
        "data": [
            {
                "id": row.id,
                "amount": row.amount,
                "balance_after": row.balance_after,
                "reason": row.reason,
                "job_id": row.job_id,
                "created_at": row.created_at,
            }
            for row in rows
        ]
    }


class CheckoutIn(BaseModel):
    amount: float = Field(gt=0, le=10_000)


@router.post("/credits/checkout", summary="Start a top-up")
async def start_checkout(payload: CheckoutIn, user: CurrentUser) -> dict:
    """Payments are not wired yet. Say so plainly instead of faking one."""
    from dubber_center.core.errors import AppError

    raise AppError(
        "Card payments are not enabled yet. Ask an admin to add credits to your account.",
        code="payments_not_enabled",
        status_code=501,
        details={"user_id": user.id, "requested_amount": payload.amount},
    )