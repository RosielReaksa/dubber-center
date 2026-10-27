"""Shared FastAPI dependencies: authentication and role checks."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.config import settings
from dubber_center.core.errors import Forbidden, Unauthorized
from dubber_center.db.base import get_session
from dubber_center.db.tables import User
from dubber_center.services.users import authenticate_api_key, user_from_session_token

SessionDep = Annotated[AsyncSession, Depends(get_session)]

ROLE_RANK = {"user": 0, "support": 1, "admin": 2, "owner": 3}


async def _bearer_user(request: Request, session: AsyncSession) -> User | None:
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        raw_key = header[7:].strip()
        if raw_key:
            return await authenticate_api_key(session, raw_key)
    return None


async def _session_user(request: Request, session: AsyncSession) -> User | None:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return None
    return await user_from_session_token(session, token)


async def get_current_user(request: Request, session: SessionDep) -> User:
    """Bearer API key first, then the browser session cookie."""
    user = await _bearer_user(request, session)
    if user is None:
        user = await _session_user(request, session)
    if user is None:
        raise Unauthorized("Authentication required. Send 'Authorization: Bearer <key>'.")
    if user.status != "active":
        raise Unauthorized("This account is suspended.")
    return user


async def get_optional_user(request: Request, session: SessionDep) -> User | None:
    try:
        return await get_current_user(request, session)
    except Unauthorized:
        return None


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def require_role(minimum: str) -> Callable[[User], User]:
    """Role gate used in `dependencies=[...]`, not inside handlers (section 14.4)."""
    needed = ROLE_RANK[minimum]

    async def _checker(user: CurrentUser) -> User:
        if ROLE_RANK.get(user.role, -1) < needed:
            raise Forbidden(f"This action needs the '{minimum}' role or higher.")
        return user

    return _checker


RequireSupport = Annotated[User, Depends(require_role("support"))]
RequireAdmin = Annotated[User, Depends(require_role("admin"))]
RequireOwner = Annotated[User, Depends(require_role("owner"))]