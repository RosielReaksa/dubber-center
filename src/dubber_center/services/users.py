"""User, API-key and session operations."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.config import settings
from dubber_center.core.errors import Conflict, NotFound, Unauthorized
from dubber_center.core.security import (
    generate_api_key,
    hash_api_key,
    key_prefix,
)
from dubber_center.db.tables import ApiKey, Session, User

SESSION_TOKEN_PREFIX = "dss_"


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(select(User).where(User.email == email.lower().strip()))


async def create_user(
    session: AsyncSession,
    *,
    email: str,
    name: str | None = None,
    role: str = "user",
    credits: float = 0.0,
    password: str | None = None,
    plan: str = "free",
) -> User:
    email = email.lower().strip()
    if await get_user_by_email(session, email):
        raise Conflict(f"A user with email '{email}' already exists.")
    user = User(
        email=email,
        name=name,
        role=role,
        credits=credits,
        plan=plan,
        is_canary=(role == "canary" or email == "canary@internal"),
    )
    if password:
        from dubber_center.core.security import hash_password

        user.password_hash = hash_password(password)
    session.add(user)
    await session.flush()
    return user


async def issue_api_key(
    session: AsyncSession, user: User, *, name: str = "default"
) -> str:
    """Create a key and return the plaintext once. Only the hash is stored."""
    raw = generate_api_key()
    session.add(
        ApiKey(
            user_id=user.id,
            key_hash=hash_api_key(raw),
            prefix=key_prefix(raw),
            name=name,
        )
    )
    await session.flush()
    return raw


async def create_user_with_key(
    session: AsyncSession,
    *,
    email: str,
    name: str | None = None,
    role: str = "user",
    credits: float = 0.0,
    password: str | None = None,
) -> tuple[User, str]:
    user = await create_user(
        session, email=email, name=name, role=role, credits=credits, password=password
    )
    raw = await issue_api_key(session, user)
    await session.commit()
    return user, raw


async def create_key_for_email(
    session: AsyncSession, email: str, *, name: str = "default"
) -> str:
    user = await get_user_by_email(session, email)
    if user is None:
        raise NotFound(f"No user with email '{email}'.")
    raw = await issue_api_key(session, user, name=name)
    await session.commit()
    return raw


async def authenticate_api_key(session: AsyncSession, raw_key: str) -> User:
    """Resolve a bearer key to its user, rejecting unknown or revoked keys."""
    key_hash = hash_api_key(raw_key)
    api_key = await session.scalar(select(ApiKey).where(ApiKey.key_hash == key_hash))
    if api_key is None:
        raise Unauthorized("Invalid API key.")
    if api_key.revoked_at is not None:
        raise Unauthorized("This API key has been revoked.")

    user = await session.get(User, api_key.user_id)
    if user is None:
        raise Unauthorized("Invalid API key.")
    if user.status != "active":
        raise Unauthorized("This account is suspended.")

    api_key.last_used_at = datetime.now(UTC)
    user.last_seen_at = datetime.now(UTC)
    await session.commit()
    return user


# --- browser sessions (frontend needs a login, section 11) ---------------


def _hash_session_token(token: str) -> str:
    return hash_api_key(token)


async def create_session(session: AsyncSession, user: User) -> str:
    token = SESSION_TOKEN_PREFIX + secrets.token_urlsafe(32)
    session.add(
        Session(
            user_id=user.id,
            token_hash=_hash_session_token(token),
            expires_at=datetime.now(UTC) + timedelta(hours=settings.session_ttl_hours),
        )
    )
    await session.commit()
    return token


async def user_from_session_token(session: AsyncSession, token: str) -> User | None:
    row = await session.scalar(
        select(Session).where(Session.token_hash == _hash_session_token(token))
    )
    if row is None or row.revoked_at is not None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires < datetime.now(UTC):
        return None
    user = await session.get(User, row.user_id)
    if user is None or user.status != "active":
        return None
    return user


async def revoke_session(session: AsyncSession, token: str) -> None:
    row = await session.scalar(
        select(Session).where(Session.token_hash == _hash_session_token(token))
    )
    if row is not None:
        row.revoked_at = datetime.now(UTC)
        await session.commit()


async def revoke_api_key(session: AsyncSession, user_id: str, key_id: str) -> None:
    key = await session.scalar(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user_id)
    )
    if key is None:
        raise NotFound("API key not found.")
    if key.revoked_at is None:
        key.revoked_at = datetime.now(UTC)
        await session.commit()