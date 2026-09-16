from fastapi import APIRouter

from app.api import apps, cameras, its, metrics, segment, snapshots, stream, system

api_router = APIRouter(prefix="/api")
for r in (system.router, its.router, snapshots.router, segment.router, cameras.router, stream.router, metrics.router, apps.router):
    api_router.include_router(r)
