import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import LevelBadge from '../components/LevelBadge'
import OccupancyBar from '../components/OccupancyBar'
import { levelColor, pct } from '../lib/format'
import { usePolling } from '../lib/usePolling'

const BY = [
  { v: 'route', l: '노선별' },
  { v: 'region', l: '지역별' },
  { v: 'section', l: '구간별' },
  { v: 'camera', l: '카메라별' },
]

export default function StatsPage() {
  const [by, setBy] = useState('route')
  const [minutes, setMinutes] = useState(15)
  const [open, setOpen] = useState<string | null>(null)
  const { data, error } = usePolling(() => api.metrics.summary(by, minutes), 5000, [by, minutes])
  const groups: any[] = data?.groups ?? []

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>점유율 통계</h1>
        <div className="row">
          <div className="group row" style={{ gap: 4 }}>
            {BY.map((b) => <button key={b.v} className={by === b.v ? 'active' : ''} onClick={() => setBy(b.v)}>{b.l}</button>)}
          </div>
          <select value={minutes} onChange={(e) => setMinutes(+e.target.value)}>
            {[5, 15, 30, 60, 180, 720, 1440].map((m) => <option key={m} value={m}>최근 {m >= 60 ? `${m / 60}시간` : `${m}분`} 평균</option>)}
          </select>
        </div>
      </div>
      <p className="muted">최근 {minutes}분 동안 기록된 샘플의 평균 점유율(차량 픽셀/도로 픽셀). 방향별 값은 각 방향 도로 영역 기준입니다.</p>
      {error && <div className="error">{error}</div>}
      {!groups.length && <div className="muted">해당 기간에 기록이 없습니다. 카메라를 모니터링 상태로 두면 5초마다 기록됩니다.</div>}

      {groups.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <ResponsiveContainer width="100%" height={Math.max(160, 28 * groups.length + 40)}>
            <BarChart data={groups} layout="vertical" margin={{ left: 10, right: 30 }}>
              <CartesianGrid stroke="#2a3242" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke="#98a2b8" fontSize={11} />
              <YAxis type="category" dataKey="key" width={140} stroke="#98a2b8" fontSize={12} />
              <Tooltip contentStyle={{ background: '#171c25', border: '1px solid #2a3242', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [`${(Number(v) * 100).toFixed(1)}%`, '평균 점유율']} />
              <Bar dataKey="occupancy" isAnimationActive={false} radius={[0, 4, 4, 0]}>
                {groups.map((g, i) => <Cell key={i} fill={levelColor(g.level)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <table>
        <thead>
          <tr><th>{BY.find((b) => b.v === by)?.l.replace('별', '')}</th><th>카메라</th><th>평균 점유율</th><th>최대</th><th>혼잡도</th><th>평균 차량 수</th></tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.key} g={g} open={open === g.key} onToggle={() => setOpen(open === g.key ? null : g.key)} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupRows({ g, open, onToggle }: { g: any; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td><b>{open ? '▾' : '▸'} {g.key}</b></td>
        <td>{g.n_cameras}</td>
        <td style={{ minWidth: 200 }}><OccupancyBar value={g.occupancy} level={g.level} /></td>
        <td>{pct(g.max)}</td>
        <td><LevelBadge level={g.level} /></td>
        <td>{g.n_vehicles?.toFixed(1)}</td>
      </tr>
      {open &&
        g.cameras.map((c: any) => (
          <tr key={c.id} style={{ background: 'var(--panel)' }}>
            <td style={{ paddingLeft: 24 }}>
              <Link to={`/cameras/${c.id}`}>{c.name}</Link>
              <div className="muted">{[c.route, c.region, c.section].filter(Boolean).join(' · ')}</div>
            </td>
            <td className="muted">{c.running ? '실시간 ' + pct(c.live_occupancy) : '정지'}</td>
            <td>
              <OccupancyBar value={c.overall?.occupancy} level={c.overall?.level} label="전체" />
              {c.directions.map((d: any) => (
                <OccupancyBar key={d.direction_index} value={d.occupancy} level={d.level} label={d.name} color={c.directions_meta?.[d.direction_index]} />
              ))}
            </td>
            <td>{pct(c.overall?.max)}</td>
            <td><LevelBadge level={c.overall?.level} /></td>
            <td>{c.overall?.n_vehicles?.toFixed(1)}</td>
          </tr>
        ))}
    </>
  )
}
