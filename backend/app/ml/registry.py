"""모델 싱글턴. 첫 사용 시 로드하며 워커/요청 스레드가 공유한다."""

from __future__ import annotations

import logging
import threading

from app.config import get_settings
from app.ml.road_seg import RoadSegmenter
from app.ml.vehicle_seg import VehicleSegmenter

log = logging.getLogger(__name__)
_lock = threading.Lock()
_vehicle: VehicleSegmenter | None = None
_road: RoadSegmenter | None = None


def get_vehicle_segmenter() -> VehicleSegmenter:
    global _vehicle
    if _vehicle is None:
        with _lock:
            if _vehicle is None:
                s = get_settings()
                _vehicle = VehicleSegmenter(s.yolo_weights, device=s.device, imgsz=s.yolo_imgsz, conf=s.yolo_conf)
    return _vehicle


def get_road_segmenter() -> RoadSegmenter:
    global _road
    if _road is None:
        with _lock:
            if _road is None:
                s = get_settings()
                _road = RoadSegmenter(s.sam3_weights, str(s.sam_fallback_weights), device=s.device, conf=s.sam_conf)
    return _road


def model_status() -> dict:
    s = get_settings()
    return {
        "yolo_weights": str(s.yolo_weights),
        "yolo_loaded": _vehicle is not None,
        "yolo_device": _vehicle.device if _vehicle else None,
        "yolo_classes": list(_vehicle.names.values()) if _vehicle else None,
        "road": get_road_segmenter().status(),
    }
