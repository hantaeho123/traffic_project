"""세그멘테이션 오버레이 렌더링 (스트림/스냅샷 표시용)."""

from __future__ import annotations

import cv2
import numpy as np

from app.ml.vehicle_seg import VEHICLE_CLASSES

# BGR
CLASS_COLORS = {"car": (80, 200, 80), "bus": (60, 160, 255), "truck": (220, 120, 40)}
VEHICLE_COLOR = (60, 220, 60)
DIRECTION_COLORS = [
    (214, 120, 42),  # #2a78d6 (BGR)
    (52, 104, 235),  # #eb6834
    (122, 175, 27),  # #1baf7a
    (200, 80, 200),
    (40, 200, 220),
    (120, 120, 250),
]


def hex_to_bgr(hex_color: str | None, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    if not hex_color or not hex_color.startswith("#") or len(hex_color) != 7:
        return fallback
    r, g, b = int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16)
    return (b, g, r)


def render_overlay(
    frame: np.ndarray,
    vehicle_label: np.ndarray | None,
    road_label: np.ndarray | None,
    mode: str = "class",
    direction_colors: list[tuple[int, int, int]] | None = None,
    road_alpha: float = 0.22,
    vehicle_alpha: float = 0.55,
    hud: list[str] | None = None,
) -> np.ndarray:
    """mode: 'class'(차종별 색) | 'vehicle'(단일 색) | 'road'(도로만) | 'none'."""
    out = frame.copy()
    if road_label is not None and mode != "none":
        colors = direction_colors or DIRECTION_COLORS
        overlay = out.copy()
        n = int(road_label.max()) if road_label.size else 0
        for d in range(1, n + 1):
            m = road_label == d
            if m.any():
                overlay[m] = colors[(d - 1) % len(colors)]
        cv2.addWeighted(overlay, road_alpha, out, 1 - road_alpha, 0, out)
        # 방향 경계선
        for d in range(1, n + 1):
            m = (road_label == d).astype(np.uint8)
            cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(out, cnts, -1, colors[(d - 1) % len(colors)], 2)

    if vehicle_label is not None and mode in ("class", "vehicle"):
        overlay = out.copy()
        if mode == "class":
            for i, c in enumerate(VEHICLE_CLASSES):
                m = vehicle_label == i + 1
                if m.any():
                    overlay[m] = CLASS_COLORS[c]
        else:
            overlay[vehicle_label > 0] = VEHICLE_COLOR
        cv2.addWeighted(overlay, vehicle_alpha, out, 1 - vehicle_alpha, 0, out)

    if hud:
        y = 28
        for line in hud:
            (tw, th), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
            cv2.rectangle(out, (8, y - th - 8), (16 + tw, y + 6), (0, 0, 0), -1)
            cv2.putText(out, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
            y += th + 16
    return out


def encode_jpeg(frame: np.ndarray, quality: int = 80) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("JPEG 인코딩 실패")
    return buf.tobytes()


def encode_png(arr: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", arr)
    if not ok:
        raise RuntimeError("PNG 인코딩 실패")
    return buf.tobytes()
