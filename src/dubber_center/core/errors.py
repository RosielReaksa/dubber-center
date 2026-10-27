"""Application errors with the stable API error envelope.

Every error response is:

    {"error": {"code": "model_unavailable", "message": "...", "details": {...}}}
"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base error. `code` is machine-readable and stable; `message` is for humans."""

    status_code: int = 400
    code: str = "bad_request"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return error_payload(self.code, self.message, self.details)


def error_payload(
    code: str, message: str, details: dict[str, Any] | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    return body


# --- specific errors -----------------------------------------------------


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class ValidationFailed(AppError):
    status_code = 422
    code = "validation_failed"


class RateLimited(AppError):
    status_code = 429
    code = "rate_limited"


class ModelNotFound(NotFound):
    code = "model_not_found"


class ModelDisabled(AppError):
    status_code = 409
    code = "model_disabled"


class ModelUnavailable(AppError):
    status_code = 409
    code = "model_unavailable"


class LanguageNotSupported(AppError):
    status_code = 422
    code = "language_not_supported"


class VideoTooLong(AppError):
    status_code = 422
    code = "video_too_long"


class InsufficientCredits(AppError):
    status_code = 402
    code = "insufficient_credits"


class InvalidFileType(AppError):
    status_code = 422
    code = "invalid_file_type"


class FileTooLarge(AppError):
    status_code = 413
    code = "file_too_large"