"""File storage: S3/MinIO for real use, local disk for development.

Storage keys are opaque paths like `in/<user>/<file_id>.mp4`.
"""

from __future__ import annotations

import asyncio
import mimetypes
import shutil
from pathlib import Path
from typing import Protocol

import httpx

from dubber_center.config import settings
from dubber_center.core.errors import AppError, InvalidFileType
from dubber_center.core.logging import get_logger

log = get_logger("dubber_center.storage")

PRESIGN_EXPIRES_SEC = 3600
_MAX_DOWNLOAD_BYTES = settings.max_upload_mb * 1024 * 1024


class Storage(Protocol):
    def presign_upload(self, key: str, content_type: str | None = None) -> str: ...
    def presign_download(self, key: str, expires_in: int = PRESIGN_EXPIRES_SEC) -> str: ...
    async def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None: ...
    async def get_bytes(self, key: str) -> bytes: ...
    async def delete(self, key: str) -> None: ...
    async def exists(self, key: str) -> bool: ...
    async def copy_from_url(self, url: str, key: str) -> int: ...
    async def copy(self, from_key: str, to_key: str) -> None: ...


def guess_extension(content_type: str | None, filename: str | None) -> str:
    if filename and "." in filename:
        return "." + filename.rsplit(".", 1)[-1].lower()
    if content_type:
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if ext:
            return ext
    return ".mp4"


def ensure_allowed_type(filename: str | None, content_type: str | None) -> None:
    allowed = set(settings.allowed_video_types)
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
        if ext not in allowed:
            raise InvalidFileType(
                f"'.{ext}' is not a supported video type. Use one of: "
                + ", ".join(sorted(allowed))
                + "."
            )


# --------------------------------------------------------------------------
# Local disk (development and tests)
# --------------------------------------------------------------------------


class LocalStorage:
    """Writes under LOCAL_STORAGE_DIR. Presigned URLs point at a dev endpoint."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root or settings.local_storage_dir)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        target = (self.root / key).resolve()
        if not str(target).startswith(str(self.root.resolve())):
            raise AppError("Invalid storage key.", code="invalid_storage_key")
        return target

    def presign_upload(self, key: str, content_type: str | None = None) -> str:
        return f"{settings.public_base_url}/v1/dev/storage/{key}"

    def presign_download(self, key: str, expires_in: int = PRESIGN_EXPIRES_SEC) -> str:
        return f"{settings.public_base_url}/v1/dev/storage/{key}"

    async def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, data)

    async def get_bytes(self, key: str) -> bytes:
        path = self._path(key)
        if not path.exists():
            raise AppError(f"File not found: {key}", code="file_not_found", status_code=404)
        return await asyncio.to_thread(path.read_bytes)

    async def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            await asyncio.to_thread(path.unlink)

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._path(key).exists)

    async def copy_from_url(self, url: str, key: str) -> int:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                path = self._path(key)
                path.parent.mkdir(parents=True, exist_ok=True)
                size = 0
                with path.open("wb") as handle:
                    async for chunk in response.aiter_bytes(1 << 20):
                        size += len(chunk)
                        if size > _MAX_DOWNLOAD_BYTES:
                            handle.close()
                            path.unlink(missing_ok=True)
                            raise AppError(
                                "The video is larger than the upload limit.",
                                code="file_too_large",
                                status_code=413,
                            )
                        handle.write(chunk)
        return size

    async def copy(self, from_key: str, to_key: str) -> None:
        source, target = self._path(from_key), self._path(to_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.copyfile, source, target)


# --------------------------------------------------------------------------
# S3 / MinIO
# --------------------------------------------------------------------------


def _boto_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


class S3Storage:
    def __init__(self, bucket: str | None = None) -> None:
        self.bucket = bucket or settings.s3_bucket
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = _boto_client()
        return self._client

    def presign_upload(self, key: str, content_type: str | None = None) -> str:
        params = {"Bucket": self.bucket, "Key": key}
        if content_type:
            params["ContentType"] = content_type
        return self.client.generate_presigned_url(
            "put_object", Params=params, ExpiresIn=PRESIGN_EXPIRES_SEC
        )

    def presign_download(self, key: str, expires_in: int = PRESIGN_EXPIRES_SEC) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    async def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        extra = {"ContentType": content_type} if content_type else {}
        await asyncio.to_thread(
            self.client.put_object, Bucket=self.bucket, Key=key, Body=data, **extra
        )

    async def get_bytes(self, key: str) -> bytes:
        def _get() -> bytes:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            return response["Body"].read()

        return await asyncio.to_thread(_get)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self.client.delete_object, Bucket=self.bucket, Key=key)

    async def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        def _head() -> bool:
            try:
                self.client.head_object(Bucket=self.bucket, Key=key)
                return True
            except ClientError:
                return False

        return await asyncio.to_thread(_head)

    async def copy_from_url(self, url: str, key: str) -> int:
        async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type")
                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_bytes(1 << 20):
                    size += len(chunk)
                    if size > _MAX_DOWNLOAD_BYTES:
                        raise AppError(
                            "The video is larger than the upload limit.",
                            code="file_too_large",
                            status_code=413,
                        )
                    chunks.append(chunk)
        await self.put_bytes(key, b"".join(chunks), content_type)
        return size

    async def copy(self, from_key: str, to_key: str) -> None:

        await asyncio.to_thread(
            self.client.copy_object,
            Bucket=self.bucket,
            Key=to_key,
            CopySource={"Bucket": self.bucket, "Key": from_key},
        )


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = LocalStorage() if settings.storage_backend == "local" else S3Storage()
        log.info("storage ready", extra={"backend": settings.storage_backend})
    return _storage


def reset_storage() -> None:
    """Tests swap the backend between cases."""
    global _storage
    _storage = None


async def download_to_temp(storage: Storage, key: str, workdir: Path, name: str) -> Path:
    target = workdir / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(await storage.get_bytes(key))
    return target