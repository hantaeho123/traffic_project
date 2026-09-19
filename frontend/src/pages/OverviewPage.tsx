import L from 'leaflet'
import { Globe2, Layers } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { Link, useNavigate } from 'react-router-dom'
import { api, type LiveCamera } from '../api/client'
import DirectionArrows, { allHeading, hasHeading, ZoomWatcher, type DirValue } from '../components/DirectionArrows'
import LevelBadge from '../components/LevelBadge'
import { Banner, EmptyState, Loading, Segmented } from '../components/ui'
import { LEVELS, levelColor, levelOf, pct } from '../lib/format'
import { usePolling } from '../lib/usePolling'

/**
 * 전국 현황: 지점마다 점유율 숫자를 혼잡 단계 색으로 찍어 전국 교통 그림을 한눈에 본다.
 * - 값: 실시간 / 최근 15분 / 1시간 / 24시간 평균 (summary API)
 * - 표시: 지점별 / 노선별 / 지역별 묶음(평균, 묶음 중심 좌표)
 */
type Period = 0 | 15 | 60 | 1440
type Group = 'camera' | 'route' | 'region'
type Metric = 'occupancy' | 'vehicles'

interface Point { key: string; name: string; lat: number; lon: number; value: number | null; vehicles: number | null; level: string | null; n: number; ids: number[]; dirs?: { index: number; name: string; value: number | null; level: string | null; vehicles?: number | null }[] }

function badgeIcon(p: Point, metric: Metric, big: boolean, split: boolean) {
  const color = levelColor(p.level)
  const txt = metric === 'occupancy' ? (p.value == null ? '–' : `${Math.round(p.value * 100)}`) : (p.vehicles == null ? '–' : `${Math.round(p.vehicles)}`)
  const dirs = split && p.dirs && p.dirs.length >= 2 && metric === 'occupancy'
    ? `<div style="display:flex;gap:2px;margin-top:2px">${p.dirs.slice(0, 3).map((d) => `<span style="background:${levelColor(d.level)};color:#0b0b0b;border-radius:4px;padding:0 4px;font-size:10px;font-weight:700">${d.value == null ? '–' : Math.round(d.value * 100)}</span>`).join('')}</div>`
    : ''
  const html = `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%)">
    <div style="background:${color};color:${p.level === '정체' ? '#fff' : '#0b0b0b'};border:2px solid #fff;border-radius:999px;padding:${big ? '4px 10px' : '2px 7px'};font-weight:800;font-size:${big ? 14 : 12}px;line-height:1.2;box-shadow:0 2px 8px rgba(0,0,0,.6);white-space:nowrap;font-variant-numeric:tabular-nums">${txt}${metric === 'occupancy' ? '<span style="font-size:9px;font-weight:600">%</span>' : '<span style="font-size:9px;font-weight:600">대</span>'}${p.n > 1 ? `<span style="font-size:9px;opacity:.8"> ×${p.n}</span>` : ''}</div>${dirs}</div>`
  return L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] })
}

function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (done || !points.length) return
    setDone(true)
    map.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 10 })
  }, [points, map, done])
  return null
}

export default function OverviewPage() {
  const nav = useNavigate()
  const [period, setPeriod] = useState<Period>(0)
  const [group, setGroup] = useState<Group>('camera')
  const [metric, setMetric] = useState<Metric>('occupancy')
  const [split, setSplit] = useState(true)
  const [levelFilter, setLevelFilter] = useState<string | null>(null)
  const [zoom, setZoom] = useState(7)
  const ARROW_ZOOM = 11
  const { data: live, error } = usePolling(() => api.metrics.live(), period === 0 ? 5000 : 30000)
  const { data: summ } = usePolling(() => (period ? api.metrics.summary('camera', period) : Promise.resolve(null)), 30000, [period])
  const thresholds = live?.thresholds ?? [0.08, 0.15, 0.25]

  const points: Point[] = useMemo(() => {
    const cams = (live?.cameras ?? []).filter((c) => c.lat != null && c.lon != null)
    const valOf = (c: LiveCamera): { v: number | null; veh: number | null; dirs: Point['dirs'] } => {
      if (period === 0) {
        const dirs = c.live?.directions?.filter((d) => d.direction_index !== 0).map((d) => ({ index: d.direction_index, name: d.name, value: d.occupancy, level: d.level, vehicles: d.n_vehicles })) ?? []
        return { v: c.occupancy, veh: c.n_vehicles, dirs }
      }
      const pc = summ?.groups?.flatMap((g: any) => g.cameras).find((x: any) => x.id === c.id)
      if (!pc?.overall) return { v: null, veh: null, dirs: [] }
      return { v: pc.overall.occupancy, veh: pc.overall.n_vehicles, dirs: pc.directions.map((d: any) => ({ index: d.direction_index, name: d.name, value: d.occupancy, level: d.level, vehicles: d.n_vehicles })) }
    }
    if (group === 'camera')
      return cams.map((c) => { const { v, veh, dirs } = valOf(c); return { key: String(c.id), name: c.name, lat: c.lat!, lon: c.lon!, value: v, vehicles: veh, level: levelOf(v, thresholds), n: 1, ids: [c.id], dirs } })
    const m = new Map<string, Point & { vs: number[]; vehs: number[] }>()
    cams.forEach((c) => {
      const k = (group === 'route' ? c.route : c.region) || '(미지정)'
      const { v, veh } = valOf(c)
      const e = m.get(k) ?? { key: k, name: k, lat: 0, lon: 0, value: null, vehicles: null, level: null, n: 0, ids: [], vs: [], vehs: [] }
      e.lat += c.lat!; e.lon += c.lon!; e.n += 1; e.ids.push(c.id)
      if (v != null) e.vs.push(v)
      if (veh != null) e.vehs.push(veh)
      m.set(k, e)
    })
    return [...m.values()].map((e) => { const v = e.vs.length ? e.vs.reduce((a, b) => a + b, 0) / e.vs.length : null; return { ...e, lat: e.lat / e.n, lon: e.lon / e.n, value: v, vehicles: e.vehs.length ? e.vehs.reduce((a, b) => a + b, 0) : null, level: levelOf(v, thresholds) } })
  }, [live, summ, period, group, thresholds])
  const shown = points.filter((p) => !levelFilter || p.level === levelFilter)
  const fitPts = useMemo(() => points.map((p) => [p.lat, p.lon] as [number, number]), [points.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = LEVELS.map((l) => points.filter((p) => p.level === l).length)
  const ranked = [...points].filter((p) => p.value != null).sort((a, b) => b.value! - a.value!)

  if (error && !live) return <div className="page"><Banner kind="error">{error}</Banner></div>
  if (!live) return <div className="page"><Loading lg /></div>
  if (!live.cameras.length) return <div className="page"><EmptyState icon={<Globe2 />} title="등록된 CCTV 가 없습니다" description="CCTV 를 등록하고 좌표를 넣으면 전국 지도에 지점별 점유율이 숫자로 표시됩니다." action={<Link to="/register"><button className="primary">CCTV 등록</button></Link>} /></div>

  return (
    <div className="page full" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="row between" style={{ padding: '12px 16px 0' }}>
        <div>
          <h1 className="row" style={{ gap: 8 }}><Globe2 size={20} />전국 현황</h1>
          <div className="muted">지점별 점유율을 숫자와 색으로. 값을 클릭하면 상세로 이동합니다. 좌표가 없는 카메라는 표시되지 않습니다.</div>
        </div>
        <div className="row">
          <Segmented options={[{ v: 0, l: '실시간' }, { v: 15, l: '15분 평균' }, { v: 60, l: '1시간 평균' }, { v: 1440, l: '24시간 평균' }]} value={period} onChange={(v) => setPeriod(v as Period)} />
          <Segmented options={[{ v: 'camera', l: '지점별' }, { v: 'route', l: '노선 묶음' }, { v: 'region', l: '지역 묶음' }]} value={group} onChange={(v) => setGroup(v as Group)} />
          <Segmented options={[{ v: 'occupancy', l: '점유율 %' }, { v: 'vehicles', l: '차량 수' }]} value={metric} onChange={(v) => setMetric(v as Metric)} />
          <label className="check small"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />방향별</label>
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, padding: 14, gap: 12 }}>
        <div className="card pad-0" style={{ flex: 1, minWidth: 0, position: 'relative', minHeight: 480 }}>
          <MapContainer center={[36.3, 127.8]} zoom={7} style={{ height: '100%' }}>
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FitOnce points={fitPts} />
            <ZoomWatcher onZoom={setZoom} />
            {shown.map((p) => {
              const cam = group === 'camera' ? live.cameras.find((c) => c.id === p.ids[0]) : undefined
              if (cam && zoom >= ARROW_ZOOM && hasHeading(cam)) {
                const dv: Record<number, DirValue> = {}
                cam.directions.forEach((d) => {
                  const x = p.dirs?.find((y) => y.index === d.index)
                  dv[d.index] = x ? { value: x.value, level: x.level, vehicles: x.vehicles } : { value: p.value, level: p.level, vehicles: null }
                })
                return (
                  <span key={p.key}>
                    <DirectionArrows cam={cam} values={dv} metric={metric} onClick={() => nav(`/cameras/${cam.id}`)} />
                    {!allHeading(cam) && <Marker position={[p.lat, p.lon]} icon={badgeIcon(p, metric, false, false)} eventHandlers={{ click: () => nav(`/cameras/${cam.id}`) }} />}
                  </span>
                )
              }
              return (
              <Marker key={p.key} position={[p.lat, p.lon]} icon={badgeIcon(p, metric, group !== 'camera', split)} zIndexOffset={Math.round((p.value ?? 0) * 1000)} eventHandlers={{ click: () => (p.ids.length === 1 ? nav(`/cameras/${p.ids[0]}`) : undefined) }}>
                <Tooltip direction="top" offset={[0, -14]}>
                  <b>{p.name}</b>{p.n > 1 ? ` (${p.n}대 평균)` : ''}<br />점유율 {pct(p.value)} · {p.level ?? '–'} · 차량 {p.vehicles == null ? '–' : Math.round(p.vehicles)}대
                  {p.dirs?.length ? <><br />{p.dirs.map((d) => `${d.name} ${pct(d.value)}`).join(' / ')}</> : null}
                </Tooltip>
              </Marker>
              )
            })}
          </MapContainer>
          <div className="map-overlay" style={{ top: 10, left: 10 }}>
            <div className="legend" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              {LEVELS.map((l, i) => (
                <span key={l} className={`pill clickable ${levelFilter === l ? 'on' : ''}`} onClick={() => setLevelFilter(levelFilter === l ? null : l)}>
                  <span className="dot" style={{ background: levelColor(l) }} />
                  {l} {i < thresholds.length ? `< ${Math.round(thresholds[i] * 100)}%` : `≥ ${Math.round(thresholds[i - 1] * 100)}%`} <span className="muted">{counts[i]}</span>
                </span>
              ))}
              <span className="muted">숫자 = {metric === 'occupancy' ? '점유율(%)' : '차량 수'}{split ? ', 아래 작은 숫자 = 방향별' : ''}</span>
              <span className="muted">{zoom >= ARROW_ZOOM ? '확대: 방향별 화살표 (우측통행)' : `줌 ${ARROW_ZOOM} 이상이면 방향별 화살표`}</span>
            </div>
          </div>
        </div>
        <aside style={{ width: 300, flex: 'none', overflow: 'auto', display: 'grid', gap: 6, alignContent: 'start' }}>
          <h2 className="row" style={{ gap: 6 }}><Layers size={16} />{group === 'camera' ? '지점' : group === 'route' ? '노선' : '지역'} 순위 <span className="muted">{ranked.length}</span></h2>
          {ranked.map((p, i) => (
            <div key={p.key} className="card" style={{ padding: '8px 10px', cursor: p.ids.length === 1 ? 'pointer' : 'default' }} onClick={() => p.ids.length === 1 && nav(`/cameras/${p.ids[0]}`)}>
              <div className="row between" style={{ gap: 6 }}>
                <span className="row" style={{ gap: 6, minWidth: 0 }}><span className="muted num" style={{ width: 20 }}>{i + 1}</span><span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span></span>
                <span className="row" style={{ gap: 6, flex: 'none' }}><b className="num" style={{ color: levelColor(p.level) }}>{pct(p.value, 0)}</b><LevelBadge level={p.level} size="sm" /></span>
              </div>
              {p.dirs && p.dirs.length > 0 && <div className="muted" style={{ marginTop: 2 }}>{p.dirs.map((d) => `${d.name} ${pct(d.value, 0)}`).join(' · ')}</div>}
            </div>
          ))}
          {!ranked.length && <div className="muted">{period ? '해당 기간에 기록이 없습니다.' : '측정값이 아직 없습니다.'}</div>}
        </aside>
      </div>
    </div>
  )
}
