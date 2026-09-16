import type { Direction, LiveState } from '../api/client'
import { CLASS_COLORS, CLASS_LABELS, DIRECTION_PALETTE, pct } from '../lib/format'
import LevelBadge from './LevelBadge'
import OccupancyBar from './OccupancyBar'

/** 방향별 점유율/대수 패널. showClasses=true 면 차종별 구분 표시. */
export default function DirectionPanel({ live, directions, showClasses, compact = false }: { live: LiveState | null | undefined; directions: Direction[]; showClasses: boolean; compact?: boolean }) {
  if (!live || !live.directions?.length)
    return (
      <div className="muted">
        {live?.status === 'starting' ? '워커 시작 중…' : live?.status === 'reconnecting' ? '스트림 재연결 중…' : '아직 측정값이 없습니다 (정지 상태)'}
        {live?.error ? <div className="error" style={{ marginTop: 4 }}>{live.error}</div> : null}
      </div>
    )
  const colorOf = (idx: number) => directions.find((d) => d.index === idx)?.color ?? DIRECTION_PALETTE[(idx - 1) % DIRECTION_PALETTE.length]
  return (
    <div className="stack" style={{ gap: compact ? 6 : 10 }}>
      {live.directions.map((d) => (
        <div key={d.direction_index}>
          <div className="row" style={{ gap: 8, marginBottom: 2 }}>
            {d.direction_index !== 0 && <span className="dot" style={{ background: colorOf(d.direction_index) }} />}
            <strong style={{ fontSize: 13 }}>{d.name}</strong>
            <LevelBadge level={d.level} size="sm" />
            <span className="muted">{d.n_vehicles}대</span>
            {!compact && <span className="muted">도로 {Math.round(d.road_px / 1000)}k px</span>}
          </div>
          <OccupancyBar value={d.occupancy} level={d.level} compact={compact} />
          {showClasses && (
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {Object.keys(CLASS_LABELS).map((c) => (
                <span key={c} className="pill" style={{ padding: '1px 7px' }}>
                  <span className="dot" style={{ background: CLASS_COLORS[c], width: 8, height: 8 }} />
                  {CLASS_LABELS[c]} {d.counts?.[c] ?? 0}
                  {!compact && d.road_px > 0 && <span className="muted">({pct((d.class_px?.[c] ?? 0) / d.road_px)})</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
