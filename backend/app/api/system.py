from __future__ import annotations

from fastapi import APIRouter

from app.config import CONGESTION_LEVELS, get_settings
from app.ml.registry import model_status
from app.ml.vehicle_seg import VEHICLE_CLASSES
from app.services.worker_manager import manager

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/status")
def status():
    s = get_settings()
    return {
        "app": s.app_name,
        "its_configured": bool(s.its_api_key),
        "thresholds": s.congestion_thresholds,
        "levels": CONGESTION_LEVELS,
        "vehicle_classes": VEHICLE_CLASSES,
        "infer_fps": s.infer_fps,
        "models": model_status(),
        "workers": {cid: w.state.status for cid, w in manager._workers.items() if w.is_alive()},
    }
