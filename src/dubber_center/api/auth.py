"""Browser auth: signup, login, logout, me (frontend needs, section 11).

API clients keep using bearer keys; the website uses an HttpOnly session cookie.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.api.deps import CurrentUser
from dubber_center.config import settings
from dubber_center.core.errors import Unauthorized
from dubber_center.core.security import verify_password
from dubber_center.db.base import get_session
from dubber_center.db.tables import User
from dubber_center.services.users import (
    create_session,
    create_user_with_key,
    get_user_by_email,
    revoke_session,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str | None = Field(default=None, max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str | None = None
    role: str
    plan: str
    credits: float
    status: str


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        plan=user.plan,
        credits=user.credits,
        status=user.status,
    )


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.app_env != "dev",
        path="/",
    )


@router.post("/signup", response_model=UserOut, status_code=201, summary="Create an account")
async def signup(
    payload: SignupIn,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> UserOut:
    user, _api_key = await create_user_with_key(
        session, email=str(payload.email), name=payload.name, password=payload.password
    )
    _set_session_cookie(response, await create_session(session, user))
    return user_out(user)


@router.post("/login", response_model=UserOut, summary="Log in")
async def login(
    payload: LoginIn,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> UserOut:
    user = await get_user_by_email(session, str(payload.email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise Unauthorized("Email or password is incorrect.")
    if user.status != "active":
        raise Unauthorized("This account is suspended.")

    user.credits = user.credits  # no-op, keeps the object loaded
    _set_session_cookie(response, await create_session(session, user))
    return user_out(user)


@router.post("/logout", summary="Log out")
async def logout(response: Response) -> dict:
    response.delete_cookie(settings.session_cookie_name, path="/")
    return {"message": "Logged out."}


@router.get("/me", response_model=UserOut, summary="The signed-in user")
async def me(user: CurrentUser) -> UserOut:
    return user_out(user)


# Cookie-based logout needs the raw token to revoke server-side.


@router.post("/logout-all", summary="Revoke the session cookie everywhere")
async def logout_all(
    response: Response,
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import update

    from dubber_center.db.base import utcnow
    from dubber_center.db.tables import Session as SessionRow

    await session.execute(
        update(SessionRow).where(SessionRow.user_id == user.id).values(revoked_at=utcnow())
    )
    await session.commit()
    response.delete_cookie(settings.session_cookie_name, path="/")
    return {"message": "All sessions revoked."}


__all__ = ["router", "revoke_session"]