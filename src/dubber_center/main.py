"""FastAPI application entry point."""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from dubber_center.config import settings
from dubber_center.core.errors import AppError, error_payload
from dubber_center.core.logging import bind_request, configure_logging, get_logger

log = get_logger("dubber_center.api")

# Endpoints that cost money or compute get a per-key budget.
_RATE_LIMITED_PATHS = {"/v1/dub", "/v1/files", "/v1/auth/login", "/v1/auth/signup"}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    log.info("starting", extra={"env": settings.app_env, "version": _version()})
    await _startup()
    yield
    log.info("shutdown")


async def _startup() -> None:
    """Create tables (dev only) and sync model manifests into the registry."""
    from dubber_center.db.base import SessionLocal, ensure_schema
    from dubber_center.registry.service import sync_manifests

    await ensure_schema()

    try:
        async with SessionLocal() as session:
            errors = await sync_manifests(session)
        if errors:
            log.warning("some manifests were skipped", extra={"count": len(errors)})
    except Exception:
        # A registry sync failure must not stop the API from serving.
        log.exception("registry sync failed at startup")


def _version() -> str:
    from dubber_center import __version__

    return __version__


def create_app() -> FastAPI:
    app = FastAPI(
        title="Dubber Center",
        version=_version(),
        description=(
            "Central registry and async API for many dubbing models. "
            "Each model takes a video in and returns a dubbed video out."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:16]}"
        bind_request(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.exception(
                "unhandled error",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
            raise
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers["X-Request-ID"] = request_id

        # Rate limit per bearer key on job creation (step 13). Redis when
        # configured, an in-process counter otherwise.
        if request.method == "POST" and request.url.path in _RATE_LIMITED_PATHS:
            from dubber_center.services.ratelimit import check_rate_limit

            token = request.headers.get("Authorization", "")[7:].strip()
            if token:
                allowed, remaining, retry_after = await check_rate_limit(f"key:{token[:24]}", 60)
                response.headers["X-RateLimit-Remaining"] = str(remaining)
                if not allowed:
                    return JSONResponse(
                        status_code=429,
                        content=error_payload(
                            "rate_limited", "Too many requests. Try again shortly."
                        ),
                        headers={"Retry-After": str(retry_after)},
                    )

        log.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": elapsed_ms,
            },
        )
        return response

    # --- error handlers: one envelope for everything ---------------------
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_dict())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {
                "field": ".".join(str(p) for p in err.get("loc", ()) if p not in ("body", "query")),
                "message": err.get("msg", "invalid value"),
            }
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=error_payload(
                "validation_failed",
                "The request has invalid or missing fields.",
                {"fields": errors},
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found"}.get(
            exc.status_code, "http_error"
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(code, str(exc.detail)),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled exception")
        if settings.debug:
            return JSONResponse(
                status_code=500,
                content=error_payload("internal_error", str(exc)),
            )
        return JSONResponse(
            status_code=500,
            content=error_payload("internal_error", "Something went wrong on our side."),
        )

    @app.get("/health", tags=["meta"], summary="Liveness check")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    from dubber_center.api import api_router

    app.include_router(api_router, prefix="/v1")
    return app


app = create_app()