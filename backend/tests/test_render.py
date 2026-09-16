import numpy as np

from app.ml.render import encode_jpeg, render_overlay


def test_render_modes():
    frame = np.zeros((60, 80, 3), np.uint8)
    road = np.zeros((60, 80), np.uint8)
    road[30:, :40] = 1
    road[30:, 40:] = 2
    veh = np.zeros((60, 80), np.uint8)
    veh[40:50, 10:20] = 1
    for mode in ("class", "vehicle", "road", "none"):
        out = render_overlay(frame, veh, road, mode=mode, hud=["ALL 10%"])
        assert out.shape == frame.shape
        assert len(encode_jpeg(out)) > 100
    # 'none' 은 HUD 만 그린다: 도로 영역 픽셀이 검정 그대로
    out = render_overlay(frame, veh, road, mode="none")
    assert out[45, 15].tolist() == [0, 0, 0]
    out = render_overlay(frame, veh, road, mode="vehicle")
    assert out[45, 15].tolist() != [0, 0, 0]
