"""Usage, credits and the ledger (project plan step 11, section 14.4).

Rule: a user's balance is only ever changed by inserting a `credit_transactions`
row and updating `users.credits` in the same transaction.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.core.errors import AppError
from dubber_center.db.tables import CreditTransaction, Job, UsageLedger, User


class CreditsDisabled(AppError):
    code = "credits_disabled"


# --- credits -------------------------------------------------------------


async def add_credits(
    session: AsyncSession,
    user: User,
    amount: float,
    *,
    reason: str,
    actor_user_id: str | None = None,
    job_id: str | None = None,
    allow_negative: bool = False,
    commit: bool = True,
) -> float:
    """Move the balance through the ledger. Returns the new balance."""
    if amount == 0:
        return user.credits

    new_balance = round(user.credits + amount, 6)
    if new_balance < 0 and not allow_negative:
        raise AppError(
            "Not enough credits for this action.",
            code="insufficient_credits",
            status_code=402,
            details={"balance": user.credits, "required": -amount},
        )

    user.credits = new_balance
    session.add(
        CreditTransaction(
            user_id=user.id,
            amount=amount,
            balance_after=new_balance,
            reason=reason,
            actor_user_id=actor_user_id,
            job_id=job_id,
        )
    )
    if commit:
        await session.commit()
    return new_balance


async def spend_for_job(session: AsyncSession, user: User, job: Job, cost: float) -> None:
    """Deduct the final cost of a finished job (credits enabled)."""
    if cost <= 0:
        return
    await add_credits(
        session,
        user,
        -cost,
        reason=f"Job {job.id} ({job.model_id})",
        job_id=job.id,
        allow_negative=True,  # the job already ran; never leave a dangling charge
        commit=False,
    )


async def has_credits(user: User) -> bool:
    return user.credits > 0


# --- ledger --------------------------------------------------------------


async def record_usage(
    session: AsyncSession,
    *,
    user_id: str,
    job: Job,
    model_id: str,
    minutes: float,
    cost: float,
    internal: bool,
    commit: bool = False,
) -> UsageLedger:
    row = UsageLedger(
        user_id=user_id,
        job_id=job.id,
        model_id=model_id,
        minutes=round(minutes, 4),
        cost=round(cost, 4),
        kind="internal" if internal else "user",
    )
    session.add(row)
    if commit:
        await session.commit()
    return row


# --- reporting -----------------------------------------------------------


def _parse_date(value: str | date | None, default: date) -> date:
    if value is None:
        return default
    if isinstance(value, date):
        return value
    return date.fromisoformat(value)


async def usage_summary(
    session: AsyncSession,
    *,
    user_id: str | None = None,
    from_date: str | date | None = None,
    to_date: str | date | None = None,
    include_internal: bool = False,
) -> dict:
    today = datetime.now(UTC).date()
    start = _parse_date(from_date, today - timedelta(days=29))
    end = _parse_date(to_date, today)

    start_dt = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)

    stmt = select(
        UsageLedger.kind,
        UsageLedger.created_at,
        UsageLedger.model_id,
        UsageLedger.minutes,
        UsageLedger.cost,
    ).where(UsageLedger.created_at >= start_dt, UsageLedger.created_at < end_dt)
    if user_id:
        stmt = stmt.where(UsageLedger.user_id == user_id)
    if not include_internal:
        stmt = stmt.where(UsageLedger.kind == "user")

    rows = (await session.execute(stmt)).all()

    by_day: dict[str, dict] = {}
    by_model: dict[str, dict] = {}
    total_minutes = total_cost = 0.0
    total_jobs = 0

    for _kind, created_at, model_id, minutes, cost in rows:
        day = created_at.date().isoformat()
        total_minutes += minutes
        total_cost += cost
        total_jobs += 1

        day_bucket = by_day.setdefault(day, {"key": day, "minutes": 0.0, "cost": 0.0, "jobs": 0})
        day_bucket["minutes"] += minutes
        day_bucket["cost"] += cost
        day_bucket["jobs"] += 1

        model_bucket = by_model.setdefault(
            model_id, {"key": model_id, "minutes": 0.0, "cost": 0.0, "jobs": 0}
        )
        model_bucket["minutes"] += minutes
        model_bucket["cost"] += cost
        model_bucket["jobs"] += 1

    def _round(buckets: dict[str, dict]) -> list[dict]:
        return [
            {
                "key": bucket["key"],
                "minutes": round(bucket["minutes"], 3),
                "cost": round(bucket["cost"], 4),
                "jobs": bucket["jobs"],
            }
            for bucket in sorted(buckets.values(), key=lambda b: b["key"])
        ]

    return {
        "from_date": start.isoformat(),
        "to_date": end.isoformat(),
        "total_minutes": round(total_minutes, 3),
        "total_cost": round(total_cost, 4),
        "total_jobs": total_jobs,
        "by_day": _round(by_day),
        "by_model": _round(by_model),
    }


async def credits_history(session: AsyncSession, user_id: str, limit: int = 50) -> list[dict]:
    rows = (
        await session.scalars(
            select(CreditTransaction)
            .where(CreditTransaction.user_id == user_id)
            .order_by(CreditTransaction.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [
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


async def revenue_totals(session: AsyncSession, start: datetime, end: datetime) -> dict:
    """Revenue (what users paid) and cost (internal) for a window, both real jobs only."""
    stmt = select(
        func.sum(UsageLedger.cost).filter(UsageLedger.kind == "user"),
        func.sum(UsageLedger.cost).filter(UsageLedger.kind == "internal"),
        func.sum(UsageLedger.minutes).filter(UsageLedger.kind == "user"),
        func.count().filter(UsageLedger.kind == "user"),
    ).where(UsageLedger.created_at >= start, UsageLedger.created_at < end)
    revenue, internal_cost, minutes, jobs = (await session.execute(stmt)).one()
    return {
        "revenue": round(revenue or 0.0, 4),
        "cost": round(internal_cost or 0.0, 4),
        "minutes": round(minutes or 0.0, 3),
        "jobs": int(jobs or 0),
    }