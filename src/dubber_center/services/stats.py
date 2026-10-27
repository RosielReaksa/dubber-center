"""Daily stats rollup (section 14.4) and uptime rollup for the status page."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.db.base import SessionLocal, utcnow
from dubber_center.db.tables import DailyStat, Job, ModelDailyUptime, ModelStatusEvent, UsageLedger


async def rollup_day(session: AsyncSession, day) -> int:
    """Recompute `daily_stats` for one UTC day. Idempotent."""
    start = datetime.combine(day, datetime.min.time(), tzinfo=UTC)
    end = start + timedelta(days=1)

    rows = (
        await session.execute(
            select(
                Job.model_id,
                func.count(),
                func.count().filter(Job.status == "done"),
                func.count().filter(Job.status == "failed"),
                func.sum(Job.minutes),
            )
            .where(
                Job.created_at >= start,
                Job.created_at < end,
                Job.is_canary.is_(False),
            )
            .group_by(Job.model_id)
        )
    ).all()

    durations = (
        await session.execute(
            select(
                Job.model_id,
                func.avg(
                    func.julianday(Job.finished_at) - func.julianday(Job.started_at)
                ),
            )
            .where(
                Job.created_at >= start,
                Job.created_at < end,
                Job.is_canary.is_(False),
                Job.started_at.is_not(None),
                Job.finished_at.is_not(None),
            )
            .group_by(Job.model_id)
        )
    ).all()
    avg_by_model = {model_id: (avg or 0) * 86400 for model_id, avg in durations}

    revenue = (
        await session.execute(
            select(UsageLedger.model_id, func.sum(UsageLedger.cost))
            .where(
                UsageLedger.created_at >= start,
                UsageLedger.created_at < end,
                UsageLedger.kind == "user",
            )
            .group_by(UsageLedger.model_id)
        )
    ).all()
    revenue_by_model = {model_id: cost or 0 for model_id, cost in revenue}

    written = 0
    for model_id, total, done, failed, minutes in rows:
        stat = await session.get(DailyStat, (day, model_id))
        if stat is None:
            stat = DailyStat(date=day, model_id=model_id)
            session.add(stat)
        stat.jobs_total = int(total or 0)
        stat.jobs_done = int(done or 0)
        stat.jobs_failed = int(failed or 0)
        stat.minutes = round(minutes or 0, 3)
        stat.revenue = round(revenue_by_model.get(model_id, 0), 4)
        stat.cost = round(stat.minutes * 0.0, 4)  # internal cost is tracked in the ledger
        stat.avg_duration_sec = round(avg_by_model.get(model_id, 0), 1)
        written += 1

    await session.commit()
    return written


async def rollup_today() -> int:
    today = utcnow().date()
    async with SessionLocal() as session:
        return await rollup_day(session, today)


async def rollup_uptime(session: AsyncSession, day) -> int:
    """Fill model_daily_uptime from model_status_events for one day."""
    start = datetime.combine(day, datetime.min.time(), tzinfo=UTC)
    end = start + timedelta(days=1)
    day_minutes = 24 * 60

    events = (
        await session.scalars(
            select(ModelStatusEvent)
            .where(ModelStatusEvent.created_at < end)
            .order_by(ModelStatusEvent.created_at)
        )
    ).all()

    # replay state transitions per model to get minutes in each state
    per_model: dict[str, list[tuple[datetime, str]]] = {}
    for event in events:
        per_model.setdefault(event.model_id, []).append((event.created_at, event.new_state))

    written = 0
    for model_id, timeline in per_model.items():
        # minutes spent in each state during this day
        buckets = {"healthy": 0.0, "degraded": 0.0, "down": 0.0}
        state = "unknown"
        cursor = start
        for at, new_state in timeline:
            if at.tzinfo is None:
                at = at.replace(tzinfo=UTC)
            if at <= start:
                state = new_state
                continue
            if at >= end:
                break
            minutes = (at - cursor).total_seconds() / 60
            if state in buckets:
                buckets[state] += minutes
            cursor = at
            state = new_state
        remaining = (end - cursor).total_seconds() / 60
        if state in buckets and remaining > 0:
            buckets[state] += remaining

        if not any(buckets.values()):
            continue

        row = await session.get(ModelDailyUptime, (day, model_id))
        if row is None:
            row = ModelDailyUptime(date=day, model_id=model_id)
            session.add(row)
        row.up_minutes = round(buckets["healthy"], 1)
        row.degraded_minutes = round(buckets["degraded"], 1)
        row.down_minutes = round(buckets["down"], 1)
        if day_minutes:
            row.success_rate = round(
                (buckets["healthy"] + buckets["degraded"] * 0.5) / day_minutes, 4
            )
        written += 1

    await session.commit()
    return written


async def uptime_30d(session: AsyncSession, model_id: str) -> tuple[float | None, list[dict]]:
    """(uptime fraction, daily list) for the status endpoint."""
    since = utcnow().date() - timedelta(days=29)
    rows = (
        await session.scalars(
            select(ModelDailyUptime)
            .where(ModelDailyUptime.model_id == model_id, ModelDailyUptime.date >= since)
            .order_by(ModelDailyUptime.date)
        )
    ).all()
    if not rows:
        return None, []

    total = 0.0
    down = 0.0
    daily = []
    for row in rows:
        minutes = row.up_minutes + row.degraded_minutes + row.down_minutes
        total += minutes
        down += row.down_minutes
        state = (
            "down" if row.down_minutes > 0
            else "degraded" if row.degraded_minutes > 0
            else "healthy"
        )
        daily.append(
            {
                "date": row.date.isoformat(),
                "state": state,
                "uptime": round(row.up_minutes / minutes, 4) if minutes else None,
            }
        )
    return (round(1 - down / total, 4) if total else None), daily