"""Shared pytest fixtures: isolated SQLite DB, local storage, in-process queue."""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="dc_tests_"))
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMP / 'test.db'}?timeout=30"
os.environ["STORAGE_BACKEND"] = "local"
os.environ["LOCAL_STORAGE_DIR"] = str(_TMP / "storage")
os.environ["REDIS_URL"] = ""
os.environ["APP_ENV"] = "dev"
os.environ["LOG_LEVEL"] = "WARNING"

from httpx import ASGITransport, AsyncClient  # noqa: E402

from dubber_center.db.base import Base, SessionLocal, engine, ensure_schema  # noqa: E402
from dubber_center.main import app  # noqa: E402
from dubber_center.services.storage import reset_storage  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema():
    asyncio.run(_init_db())
    yield
    asyncio.run(_drop_db())


async def _init_db() -> None:
    await ensure_schema()


async def _drop_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture(autouse=True)
async def _reset_state():
    """Clean tables between tests so ordering never matters.

    The in-process queue spawns background tasks; wait for them to drain before
    and after each test so a lingering task cannot write into the next test.
    """
    from dubber_center.services.queue import get_queue, reset_queue
    from dubber_center.services.ratelimit import reset_rate_limits

    await _drain(get_queue())
    reset_queue()
    reset_rate_limits()

    async with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())
    reset_storage()
    from dubber_center.registry.service import sync_manifests

    async with SessionLocal() as session:
        await sync_manifests(session)

    yield

    await _drain(get_queue())
    reset_queue()


async def _drain(queue, max_wait: float = 20.0) -> None:
    """Wait for in-process background work to finish."""
    tasks = getattr(queue, "_tasks", None)
    if not tasks:
        return
    pending = [task for task in list(tasks) if not task.done()]
    if not pending:
        return
    try:
        await asyncio.wait_for(asyncio.gather(*pending, return_exceptions=True), timeout=max_wait)
    except TimeoutError:
        for task in pending:
            task.cancel()


@pytest.fixture
async def session():
    async with SessionLocal() as s:
        yield s


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def user_and_key(session):
    from dubber_center.services.users import create_user_with_key

    user, key = await create_user_with_key(
        session, email="tester@example.com", credits=100.0
    )
    return user, key


@pytest.fixture
async def auth(user_and_key):
    _user, key = user_and_key
    return {"Authorization": f"Bearer {key}"}


@pytest.fixture
async def admin_and_key(session):
    from dubber_center.services.users import create_user_with_key

    user, key = await create_user_with_key(
        session, email="admin@example.com", role="admin", credits=0.0
    )
    return user, key


@pytest.fixture
async def admin_auth(admin_and_key):
    _user, key = admin_and_key
    return {"Authorization": f"Bearer {key}"}


@pytest.fixture
async def support_auth(session):
    from dubber_center.services.users import create_user_with_key

    _user, key = await create_user_with_key(
        session, email="support@example.com", role="support"
    )
    return {"Authorization": f"Bearer {key}"}


@pytest.fixture
async def owner_auth(session):
    from dubber_center.services.users import create_user_with_key

    _user, key = await create_user_with_key(
        session, email="owner@example.com", role="owner"
    )
    return {"Authorization": f"Bearer {key}"}