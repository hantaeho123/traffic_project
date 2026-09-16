"""점유율 계산.

occupancy(d) = |vehicle ∩ road_d| / |road_d|
  - road_d : 도로 라벨맵에서 값이 d 인 픽셀 (d=1..N 방향), d=0 은 모든 방향 합집합
  - vehicle: YOLO 라벨맵 > 0
차량 대수는 인스턴스 무게중심이 속한 방향으로 센다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.ml.vehicle_seg import VEHICLE_CLASSES, VehicleResult


@dataclass
class DirectionMetrics:
    direction_index: int
    occupancy: float
    vehicle_px: int
    road_px: int
    counts: dict[str, int] = field(default_factory=lambda: {c: 0 for c in VEHICLE_CLASSES})
    class_px: dict[str, int] = field(default_factory=lambda: {c: 0 for c in VEHICLE_CLASSES})

    def to_dict(self) -> dict:
        return {
            "direction_index": self.direction_index,
            "occupancy": round(self.occupancy, 5),
            "vehicle_px": self.vehicle_px,
            "road_px": self.road_px,
            "n_vehicles": int(sum(self.counts.values())),
            "counts": self.counts,
            "class_px": self.class_px,
        }


def compute_occupancy(vehicle: VehicleResult, road_label: np.ndarray, n_directions: int) -> dict[int, DirectionMetrics]:
    """모든 방향(0=전체, 1..N)에 대한 지표."""
    out: dict[int, DirectionMetrics] = {}
    vlabel = vehicle.label_map
    veh_mask = vlabel > 0
    indices = [0] + list(range(1, n_directions + 1))
    for d in indices:
        road_mask = (road_label > 0) if d == 0 else (road_label == d)
        road_px = int(road_mask.sum())
        inter = veh_mask & road_mask
        vehicle_px = int(inter.sum())
        m = DirectionMetrics(
            direction_index=d,
            occupancy=(vehicle_px / road_px) if road_px > 0 else 0.0,
            vehicle_px=vehicle_px,
            road_px=road_px,
        )
        for i, c in enumerate(VEHICLE_CLASSES):
            m.class_px[c] = int((inter & (vlabel == i + 1)).sum())
        out[d] = m

    # 대수: 무게중심이 속한 방향
    h, w = road_label.shape
    for inst in vehicle.instances:
        x, y = int(min(max(inst.cx, 0), w - 1)), int(min(max(inst.cy, 0), h - 1))
        d = int(road_label[y, x])
        if d == 0:
            # 도로 마스크 바깥의 무게중심: 마스크와 겹치는지 대략 확인 (박스 중심 대신 박스 내부 도로 라벨 최빈값)
            x1, y1, x2, y2 = (int(v) for v in inst.box)
            patch = road_label[max(y1, 0) : max(y2, y1 + 1), max(x1, 0) : max(x2, x1 + 1)]
            if patch.size and patch.max() > 0:
                vals, cnts = np.unique(patch[patch > 0], return_counts=True)
                d = int(vals[np.argmax(cnts)])
        if d > 0 and d in out:
            out[d].counts[inst.cls] = out[d].counts.get(inst.cls, 0) + 1
        if d > 0 or (road_label[y, x] > 0):
            out[0].counts[inst.cls] = out[0].counts.get(inst.cls, 0) + 1
    return out
