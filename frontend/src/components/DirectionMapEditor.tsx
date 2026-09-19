import L from 'leaflet'
import { Crosshair, FlipVertical2, MapPin, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { imageSrc, type Direction } from '../api/client'
import { anchorOf, arrowIcon, bearing, compass, destination, groupByRoad } from '../lib/geo'

/**
 * 방향 ↔ 지도 연결 편집기.
 * 방향마다 "지도에서 지정" 을 누르고 ① 그 차로가 지나는 지점 ② 차가 가는 쪽 을 차례로 클릭하면
 * 화살표 위치(lat/lon)와 진행 각도(heading_deg)가 정해진다. 한 CCTV 에 도로가 여러 개면 도로 이름으로 묶는다.
 */
interface Props {
  directions: Direction[]
  onChange: (d: Direction[]) => void
  cameraLat: number | null
  cameraLon: number | null
  previewUrl?: string // 방향 색이 칠해진 스냅샷 (어느 라벨이 어느 차로인지 보면서 지정)
  height?: number
}

function Recenter({ center, zoom }: { center: [number, number] | null; zoom: number }) {
  const map = useMap()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (done || !center) return
    map.setView(center, zoom)
    setDone(true)
  }, [center, zoom, map, done])
  return null
}

function ClickCatcher({ onClick }: { onClick: (p: [number, number]) => void }) {
  useMapEvents({ click: (e) => onClick([e.latlng.lat, e.latlng.lng]) })
  return null
}

export default function DirectionMapEditor({ directions, onChange, cameraLat, cameraLon, previewUrl, height = 420 }: Props) {
  const [active, setActive] = useState<number | null>(null) // 지정 중인 방향 index
  const [first, setFirst] = useState<[number, number] | null>(null) // 첫 클릭(위치)
  const [preview, setPreview] = useState('')
  const cam = { lat: cameraLat, lon: cameraLon }
  const center: [number, number] | null = useMemo(() => {
    const pts = directions.map((d) => anchorOf(d, cam)).filter(Boolean) as [number, number][]
    if (pts.length) return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
    return cameraLat != null && cameraLon != null ? [cameraLat, cameraLon] : null
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!previewUrl) return
    let u = ''
    imageSrc(previewUrl).then((s) => { u = s; setPreview(s) }).catch(() => setPreview(''))
    return () => { if (u.startsWith('blob:')) URL.revokeObjectURL(u) }
  }, [previewUrl])

  const patch = (idx: number, p: Partial<Direction>) => onChange(directions.map((d) => (d.index === idx ? { ...d, ...p } : d)))
  const onMapClick = (p: [number, number]) => {
    if (active == null) return
    if (!first) { setFirst(p); return }
    const h = bearing(first, p)
    patch(active, { lat: first[0], lon: first[1], heading_deg: Math.round(h * 10) / 10 })
    setFirst(null)
    // 다음 미지정 방향으로 자동 이동
    const next = directions.find((d) => d.index !== active && d.heading_deg == null)
    setActive(next ? next.index : null)
  }
  const roads = [...new Set(directions.map((d) => d.road?.trim()).filter(Boolean))] as string[]
  const groups = groupByRoad(directions)
  const activeDir = directions.find((d) => d.index === active)

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(300px, 1fr)', alignItems: 'start' }}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="card pad-0" style={{ position: 'relative', height }}>
          <MapContainer center={center ?? [36.4, 127.8]} zoom={center ? 17 : 7} style={{ height: '100%', cursor: active != null ? 'crosshair' : undefined }}>
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
            <Recenter center={center} zoom={17} />
            <ClickCatcher onClick={onMapClick} />
            {cameraLat != null && cameraLon != null && (
              <CircleMarker center={[cameraLat, cameraLon]} radius={6} pathOptions={{ color: '#fff', fillColor: '#8b96ad', fillOpacity: 1, weight: 2 }}>
                <Tooltip>CCTV 위치</Tooltip>
              </CircleMarker>
            )}
            {directions.map((d) => {
              const a = anchorOf(d, cam)
              if (!a || d.heading_deg == null) return null
              const tip = destination(a, d.heading_deg, 40)
              return (
                <span key={d.index}>
                  <Polyline positions={[a, tip]} pathOptions={{ color: d.color, weight: 3, dashArray: '4 4', opacity: 0.8 }} />
                  <Marker position={a} icon={arrowIcon({ heading: d.heading_deg, color: d.color, label: d.name, offsetPx: 14, selected: d.index === active, textColor: '#fff' })} eventHandlers={{ click: () => setActive(d.index) }} />
                </span>
              )
            })}
            {first && <CircleMarker center={first} radius={7} pathOptions={{ color: '#fff', fillColor: activeDir?.color ?? '#4f8cff', fillOpacity: 1, weight: 2 }} />}
          </MapContainer>
          <div className="map-overlay small" style={{ bottom: 22, left: 10, right: 10 }}>
            {active == null
              ? '오른쪽 목록에서 방향의 "지도에서 지정" 을 누르세요.'
              : !first
                ? <><b style={{ color: activeDir?.color }}>{activeDir?.name}</b>: ① 이 방향 차로가 지나는 지점을 클릭</>
                : <><b style={{ color: activeDir?.color }}>{activeDir?.name}</b>: ② 차가 <b>가는 쪽</b>(예: 서울 쪽 도로 위)을 클릭 <button className="sm ghost" onClick={(e) => { e.stopPropagation(); setFirst(null) }}>다시</button></>}
          </div>
        </div>
        {preview && (
          <div className="card pad-0">
            <img src={preview} alt="" style={{ width: '100%', display: 'block' }} />
            <div className="muted" style={{ padding: '6px 10px' }}>CCTV 화면의 방향 색. 화면 속 표지판(예: "⬆ 서울")을 보고 지도에서 같은 쪽을 고르세요.</div>
          </div>
        )}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <datalist id="road-names">{roads.map((r) => <option key={r} value={r} />)}</datalist>
        {groups.map(([road, dirs]) => (
          <div key={road} className="card" style={{ padding: 10 }}>
            <div className="row" style={{ gap: 6, marginBottom: 6 }}><MapPin size={14} color="var(--muted)" /><b>{road}</b><span className="muted">{dirs.length}개 방향</span></div>
            <div className="stack" style={{ gap: 8 }}>
              {dirs.map((d) => (
                <div key={d.index} style={{ borderLeft: `3px solid ${d.color}`, paddingLeft: 8, outline: active === d.index ? '1px solid var(--accent)' : 'none', borderRadius: 4 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="kbd">{d.index}</span>
                    <input value={d.name} onChange={(e) => patch(d.index, { name: e.target.value })} placeholder="예: 서울 방면" style={{ width: 120, padding: '4px 8px' }} />
                    <input value={d.road ?? ''} onChange={(e) => patch(d.index, { road: e.target.value })} list="road-names" placeholder="도로 (예: 경부선 본선)" style={{ flex: 1, minWidth: 110, padding: '4px 8px' }} />
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <span className="pill" title="진행 방향">{d.heading_deg == null ? '방향 미지정' : `→ ${compass(d.heading_deg)}`}</span>
                    <button className={`sm ${active === d.index ? 'active' : ''}`} onClick={() => { setActive(active === d.index ? null : d.index); setFirst(null) }}><Crosshair />지도에서 지정</button>
                    <button className="sm icon" title="반대 방향으로 (180° 회전)" disabled={d.heading_deg == null} onClick={() => patch(d.index, { heading_deg: ((d.heading_deg ?? 0) + 180) % 360 })}><FlipVertical2 /></button>
                    <button className="sm icon" title="지도 지정 지우기" disabled={d.heading_deg == null && d.lat == null} onClick={() => patch(d.index, { heading_deg: null, lat: null, lon: null })}><RotateCcw /></button>
                  </div>
                  {d.heading_deg == null && directions.some((o) => o.index !== d.index && o.heading_deg != null && (o.road ?? '') === (d.road ?? '')) && (
                    <button className="sm ghost" style={{ marginTop: 4 }} onClick={() => {
                      const o = directions.find((x) => x.index !== d.index && x.heading_deg != null && (x.road ?? '') === (d.road ?? ''))!
                      patch(d.index, { heading_deg: ((o.heading_deg ?? 0) + 180) % 360, lat: o.lat, lon: o.lon })
                    }}>같은 도로 "{directions.find((x) => x.index !== d.index && x.heading_deg != null && (x.road ?? '') === (d.road ?? ''))?.name}" 의 반대 방향으로</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="muted">
          한 화면에 도로가 여러 개면(본선 + 램프, 교차 도로) 방향마다 <b>도로</b> 이름을 다르게 적으세요. 같은 도로의 상·하행은 같은 이름으로 묶입니다.
          지도에는 방향마다 진행 방향 화살표가 그려지고, 우측통행이라 상·하행이 도로 양옆에 나란히 표시됩니다.
        </div>
      </div>
    </div>
  )
}

// L 은 react-leaflet 이 내부에서 쓰는 전역과 같은 인스턴스
void L
