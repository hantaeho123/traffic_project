"""ITS CCTV Open API 프록시 (프론트가 키를 직접 다루지 않도록)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.config import get_settings
from app.services import its_client

router = APIRouter(prefix="/its", tags=["its"])


@router.get("/status")
def its_status():
    s = get_settings()
    return {"configured": bool(s.its_api_key), "base_url": s.its_base_url}


@router.get("/search")
def its_search(
    road_type: str = Query("all", pattern="^(ex|its|all)$"),
    cctv_type: str = Query("1", pattern="^[1-5]$"),
    min_x: float = Query(...),
    max_x: float = Query(...),
    min_y: float = Query(...),
    max_y: float = Query(...),
):
    try:
        bbox = dict(min_x=min_x, max_x=max_x, min_y=min_y, max_y=max_y)
        if road_type == "all":
            items = its_client.search_both(cctv_type, **bbox)
        else:
            items = its_client.search(road_type, cctv_type, **bbox)
    except its_client.ItsError as e:
        raise HTTPException(502, str(e))
    except Exception as e:  # 네트워크 등
        raise HTTPException(502, f"ITS 호출 실패: {e}")
    return {"count": len(items), "items": [dict(it.to_dict(), route=its_client.parse_route(it.name)) for it in items]}
