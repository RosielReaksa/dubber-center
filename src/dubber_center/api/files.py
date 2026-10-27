"""File upload endpoints: presign, plus a local-disk dev upload target."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.api.deps import CurrentUser
from dubber_center.config import settings
from dubber_center.core.errors import FileTooLarge, NotFound
from dubber_center.db.base import get_session
from dubber_center.db.tables import File
from dubber_center.schemas.models import FileCreateIn, FileOut
from dubber_center.services.storage import ensure_allowed_type, get_storage, guess_extension

router = APIRouter(prefix="/files", tags=["files"])

_MAX_BYTES = settings.max_upload_mb * 1024 * 1024


@router.post("", response_model=FileOut, status_code=201, summary="Get an upload URL")
async def create_file(
    payload: FileCreateIn,
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> FileOut:
    ensure_allowed_type(payload.filename, payload.content_type)
    if payload.size and payload.size > _MAX_BYTES:
        raise FileTooLarge(f"The file is larger than the {settings.max_upload_mb} MB limit.")

    ext = guess_extension(payload.content_type, payload.filename)
    storage_key = f"in/{user.id}/{uuid.uuid4().hex}{ext}"

    row = File(
        user_id=user.id,
        storage_key=storage_key,
        filename=payload.filename,
        size=payload.size,
        content_type=payload.content_type,
        kind="input",
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)

    storage = get_storage()
    return FileOut(
        file_id=row.id,
        storage_key=storage_key,
        upload_url=storage.presign_upload(storage_key, payload.content_type),
        content_type=payload.content_type,
    )


@router.get("/{file_id}", summary="File metadata and a download URL")
async def get_file(
    file_id: str,
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = await session.get(File, file_id)
    if row is None or (row.user_id != user.id and user.role == "user"):
        raise NotFound("File not found.")
    return {
        "file_id": row.id,
        "filename": row.filename,
        "size": row.size,
        "content_type": row.content_type,
        "created_at": row.created_at,
        "download_url": get_storage().presign_download(row.storage_key),
    }


# --- dev-only storage endpoints (STORAGE_BACKEND=local) --------------------
# The presigned URLs returned by LocalStorage point here so the whole upload
# flow can be exercised without MinIO. Registered only when enabled.

dev_router = APIRouter(prefix="/dev/storage", tags=["dev"], include_in_schema=False)


def _require_local() -> None:
    if settings.storage_backend != "local":
        raise NotFound("Not found.")


@dev_router.put("/{key:path}")
async def dev_put(key: str, request: Request) -> Response:
    _require_local()
    storage = get_storage()
    body = await request.body()
    if len(body) > _MAX_BYTES:
        raise FileTooLarge(f"The file is larger than the {settings.max_upload_mb} MB limit.")
    await storage.put_bytes(key, body, request.headers.get("content-type"))
    return Response(status_code=200)


@dev_router.get("/{key:path}")
async def dev_get(key: str) -> Response:
    _require_local()
    storage = get_storage()
    if not await storage.exists(key):
        raise NotFound("File not found.")
    data = await storage.get_bytes(key)
    return Response(content=data, media_type="application/octet-stream")