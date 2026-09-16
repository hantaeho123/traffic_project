import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import DirectionPanel from '../components/DirectionPanel'
import LevelBadge from '../components/LevelBadge'
import LiveImage from '../components/LiveImage'
import { usePolling } from '../lib/usePolling'

export default function CamerasPage() {
  const { data, error, setData } = usePolling(() => api.metrics.live(), 2000)
  const [showClasses, setShowClasses] = useState(false)
  const [hud, setHud] = useState(true)
  const [cols, setCols] = useState(3)
  const cams = data?.cameras ?? []

  const toggle = async (id: number, running: boolean) => {
    await (running ? api.cameras.stop(id) : api.cameras.start(id))
    setData(await api.metrics.live())
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>등록된 CCTV 전체 보기 ({cams.length})</h1>
        <div className="row">
          <label className="pill"><input type="checkbox" checked={showClasses} onChange={(e) => setShowClasses(e.target.checked)} /> 차종 구분(car/bus/truck)</label>
          <label className="pill"><input type="checkbox" checked={hud} onChange={(e) => setHud(e.target.checked)} /> HUD</label>
          <select value={cols} onChange={(e) => setCols(+e.target.value)}>
            {[1, 2, 3, 4].map((c) => <option key={c} value={c}>{c}열</option>)}
          </select>
          <Link to="/register"><button className="primary">+ 등록</button></Link>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {!cams.length && <div className="muted" style={{ marginTop: 20 }}>등록된 CCTV 가 없습니다.</div>}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, marginTop: 12 }}>
        {cams.map((c) => (
          <div key={c.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <Link to={`/cameras/${c.id}`} style={{ color: 'var(--text)', fontWeight: 600 }}>{c.name}</Link>
              <span className="row" style={{ gap: 6 }}>
                <LevelBadge level={c.level} />
                <span className="muted">{c.running ? (c.live?.status ?? '') : '정지'}</span>
              </span>
            </div>
            <Link to={`/cameras/${c.id}`}>
              <LiveImage cameraId={c.id} mode={showClasses ? 'class' : 'vehicle'} hud={hud} maxFps={cols >= 3 ? 4 : 8} />
            </Link>
            <div style={{ marginTop: 8 }}>
              <DirectionPanel live={c.live} directions={c.directions} showClasses={showClasses} compact />
            </div>
            <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
              <span className="muted">{[c.route, c.region, c.section].filter(Boolean).join(' · ') || c.source_type}</span>
              <button onClick={() => toggle(c.id, c.running)} disabled={!c.has_mask}>{c.running ? '정지' : '시작'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
