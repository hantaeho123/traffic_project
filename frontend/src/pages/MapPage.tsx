import L from 'leaflet'
import { useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip } from 'react-leaflet'
import { Link } from 'react-router-dom'
import { api, type LiveCamera } from '../api/client'
import DirectionPanel from '../components/DirectionPanel'
import LevelBadge from '../components/LevelBadge'
import LiveImage from '../components/LiveImage'
import OccupancyBar from '../components/OccupancyBar'
import { levelColor, pct } from '../lib/format'
import { usePolling } from '../lib/usePolling'

const DEFAULT_CENTER: [number, number] = [37.45, 127.05]

export default function MapPage() {
  const { data, error } = usePolling(() => api.metrics.live(), 2000)
  const [selected, setSelected] = useState<number | null>(null)
  const [showClasses, setShowClasses] = useState(false)
  const cams = data?.cameras ?? []
  const withPos = cams.filter((c) => c.lat != null && c.lon != null)
  const sorted = useMemo(() => [...cams].sort((a, b) => (b.occupancy ?? -1) - (a.occupancy ?? -1)), [cams])
  const sel = cams.find((c) => c.id === selected) ?? null
  const bounds = withPos.length ? L.latLngBounds(withPos.map((c) => [c.lat!, c.lon!] as [number, number])).pad(0.3) : null

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <MapContainer center={DEFAULT_CENTER} zoom={9} bounds={bounds ?? undefined} style={{ height: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {withPos.map((c) => (
            <CircleMarker
              key={c.id}
              center={[c.lat!, c.lon!]}
              radius={c.id === selected ? 14 : 10}
              pathOptions={{ color: '#fff', weight: c.id === selected ? 3 : 1, fillColor: levelColor(c.level), fillOpacity: c.running ? 0.9 : 0.35 }}
              eventHandlers={{ click: () => setSelected(c.id) }}
            >
              <Tooltip direction="top" offset={[0, -8]}>
                <b>{c.name}</b> {pct(c.occupancy)} {c.level ?? ''}
              </Tooltip>
              <Popup minWidth={320}>
                <MarkerPopup c={c} showClasses={showClasses} />
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <aside style={{ width: 380, borderLeft: '1px solid var(--border)', background: 'var(--panel)', overflow: 'auto', padding: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>실시간 점유율</h2>
          <label className="muted" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={showClasses} onChange={(e) => setShowClasses(e.target.checked)} /> 차종 구분
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        {data && (
          <div className="legend" style={{ margin: '8px 0' }}>
            {data.levels.map((l, i) => (
              <span key={l} className="pill">
                <span className="dot" style={{ background: levelColor(l) }} />
                {l} {i < data.thresholds.length ? `< ${Math.round(data.thresholds[i] * 100)}%` : `≥ ${Math.round(data.thresholds[i - 1] * 100)}%`}
              </span>
            ))}
          </div>
        )}
        {!cams.length && (
          <div className="muted" style={{ marginTop: 20 }}>
            등록된 CCTV 가 없습니다. <Link to="/register">CCTV 등록</Link>에서 추가하세요.
          </div>
        )}
        {sel && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{sel.name}</h3>
              <Link to={`/cameras/${sel.id}`}>상세 →</Link>
            </div>
            <div className="muted">{[sel.route, sel.region, sel.section].filter(Boolean).join(' · ')}</div>
            <LiveImage cameraId={sel.id} mode={showClasses ? 'class' : 'vehicle'} maxFps={5} style={{ margin: '8px 0' }} />
            <DirectionPanel live={sel.live} directions={sel.directions} showClasses={showClasses} compact />
          </div>
        )}
        <div style={{ display: 'grid', gap: 6 }}>
          {sorted.map((c) => (
            <div key={c.id} className="card" style={{ padding: 8, cursor: 'pointer', outline: c.id === selected ? '1px solid var(--accent)' : 'none' }} onClick={() => setSelected(c.id)}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.name}</span>
                <LevelBadge level={c.level} />
                {!c.running && <span className="muted">정지</span>}
              </div>
              <OccupancyBar value={c.occupancy} level={c.level} />
              {c.live?.directions
                ?.filter((d) => d.direction_index !== 0)
                .map((d) => (
                  <OccupancyBar key={d.direction_index} value={d.occupancy} level={d.level} label={d.name} color={c.directions.find((x) => x.index === d.direction_index)?.color} />
                ))}
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}

function MarkerPopup({ c, showClasses }: { c: LiveCamera; showClasses: boolean }) {
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{c.name}</b>
        <LevelBadge level={c.level} />
      </div>
      <img src={api.stream.frameUrl(c.id, showClasses ? 'class' : 'vehicle')} alt="" style={{ width: '100%', borderRadius: 6, margin: '6px 0' }} />
      <DirectionPanel live={c.live} directions={c.directions} showClasses={showClasses} compact />
      <div style={{ marginTop: 6 }}>
        <Link to={`/cameras/${c.id}`}>상세 보기 →</Link>
      </div>
    </div>
  )
}
