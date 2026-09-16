import type { Direction, LiveState } from '../api/client'
import { CLASS_COLORS, CLASS_LABELS, DIRECTION_PALETTE, pct } from '../lib/format'
import LevelBadge from './LevelBadge'
import OccupancyBar from './OccupancyBar'

/** 방향별 점유율/대수 패널. showClasses=true 면 차종별 구분 표시. */
export default function DirectionPanel({
  live,
  directions,
  showClasses,
  compact = false,
}: {
  live: LiveState | null | undefined
  directions: Direction[]
  showClasses: boolean
  compact?: boolean
}) {
  if (!live || !live.directions?.length) return <div className="muted">아직 측정값이 없습니다 ({live?.status ?? '정지'}{live?.error ? `: ${live.error}` : ''})</div>
  const colorOf = (idx: number) => directions.find((d) => d.index === idx)?.color ?? DIRECTION_PALETTE[(idx - 1) % DIRECTION_PALETTE.length]
  return (
    <div style={{ display: 'grid', gap: compact ? 6 : 10 }}>
      {live.directions.map((d) => (
        <div key={d.direction_index}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            {d.direction_index !== 0 && <span className="dot" style={{ background: colorOf(d.direction_index) }} />}
            <strong style={{ fontSize: 13 }}>{d.name}</strong>
            <LevelBadge level={d.level} />
            <span className="muted">{d.n_vehicles}대</span>
            {!compact && <span className="muted">도로 {Math.round(d.road_px / 1000)}k px</span>}
          </div>
          <OccupancyBar value={d.occupancy} level={d.level} />
          {showClasses && (
            <div className="row" style={{ gap: 10, marginTop: 4 }}>
              {Object.keys(CLASS_LABELS).map((c) => (
                <span key={c} className="pill">
                  <span className="dot" style={{ background: CLASS_COLORS[c] }} />
                  {CLASS_LABELS[c]} {d.counts?.[c] ?? 0}대
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
