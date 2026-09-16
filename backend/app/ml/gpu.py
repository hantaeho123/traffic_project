"""GPU(MPS/CUDA) 추론 직렬화.

macOS MPS 는 여러 스레드가 동시에 커맨드 버퍼를 제출하면 Metal 단언 실패로 프로세스가 죽는다
(`failed assertion _status < MTLCommandBufferStatusCommitted`). YOLO 워커 스레드와 SAM 요청 스레드가
동시에 돌 수 있으므로 모든 모델 추론·로딩을 하나의 락으로 감싸고, 끝날 때 동기화한다.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager

import torch

INFER_LOCK = threading.RLock()


def synchronize(device: str) -> None:
    if device == "mps" and hasattr(torch, "mps"):
        torch.mps.synchronize()
    elif device == "cuda" and torch.cuda.is_available():
        torch.cuda.synchronize()


@contextmanager
def inference(device: str):
    with INFER_LOCK:
        try:
            yield
        finally:
            try:
                synchronize(device)
            except Exception:
                pass
