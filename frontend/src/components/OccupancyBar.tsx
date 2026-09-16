import { levelColor, pct } from '../lib/format'

export default function OccupancyBar({
  value,
  level,
  color,
  label,
  max = 0.5,
}: {
  value: number | null | undefined
  level?: string | null
  color?: string
  label?: string
  max?: number
}) {
  const w = value == null ? 0 : Math.min(100, (value / max) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      {label && (
        <span style={{ minWidth: 80, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {color && <span className="dot" style={{ background: color }} />}
          {label}
        </span>
      )}
      <div className="bar" style={{ flex: 1 }}>
        <div style={{ width: `${w}%`, background: levelColor(level) }} />
      </div>
      <span style={{ minWidth: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(value)}</span>
    </div>
  )
}
