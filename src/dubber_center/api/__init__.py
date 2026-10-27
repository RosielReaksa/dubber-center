"""API routers."""

from fastapi import APIRouter

from dubber_center.api import account, auth, files, jobs, models, status
from dubber_center.api.admin.router import admin_router

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(account.router)
api_router.include_router(models.router)
api_router.include_router(files.router)
api_router.include_router(jobs.router)
api_router.include_router(status.router)
api_router.include_router(admin_router)
api_router.include_router(files.dev_router)