import L from 'leaflet'
import { Compass, Globe2, Layers } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { Link, useNavigate } from 'react-router-dom'
import { API_BASE, api, type Camera, type Direction, type LiveCamera, type RouteSegment } from '../api/client'
import { ZoomWatcher } from '../components/DirectionArrows'
import DirectionMapEditor from '../components/DirectionMapEditor'
import LevelBadge from '../components/LevelBadge'
import { Banner, EmptyState, Loading, Modal, Segmented, useAction, useToast } from '../components/ui'
import { dirShort, LEVELS, levelColor, levelOf, pct } from '../lib/format'
import { compass, metersPerPixel, offsetLine } from '../lib/geo'
import { usePolling } from '../lib/usePolling'

/**
 * 전국 현황.
 * - 노선 선(회색) 위에 방면마다 한 줄씩, 진행 방향 오른쪽(우측통행)에 그 방면의 점유율 색으로 칠한다.
 *   한 CCTV 의 측정값은 다음 측정 CCTV 와의 중간까지(최대 8km) 칠한다.
 * - 지점 배지: 큰 숫자 = 측정한 방면 전체, 아래 칩 = "서울 12" 처럼 방면 이름 + 값. 칠하지 않은 방면은 "미측정".
 */
type Period = 0 | 15 | 60 | 1440
type Group = 'camera' | 'route' | 'region'
type Metric = 'occupancy' | 'vehicles'
type Rank = 'direction' | 'point'

interface DirVal { index: number; label: string; value: number | null; level: string | null; vehicles?: number | null; measured: boolean; route?: string | null }
interface Point { key: string; name: string; lat: number; lon: number; value: number | null; vehicles: number | null; level: string | null; n: number; ids: number[]; dirs: DirVal[] }

function badgeIcon(p: Point, metric: Metric, big: boolean, split: boolean) {
  const color = levelColor(p.level)
  const fmt = (v: number | null | undefined, veh: number | null | undefined) => (metric === 'occupancy' ? (v == null ? '–' : `${Math.round(v * 100)}`) : veh == null ? '–' : `${Math.round(veh)}`)
  const unit = metric === 'occupancy' ? '%' : '대'
  const chips = split && p.dirs.length
    ? `<div style="display:flex;gap:3px;margin-top:3px;justify-content:center;flex-wrap:nowrap">${p.dirs.slice(0, 4).map((d) => {
        if (!d.measured) return `<span style="background:rgba(11,14,20,.85);border:1px dashed #666;border-radius:6px;padding:0 5px;color:#9aa3b5;font:600 10px/15px 'Noto Sans KR',sans-serif;white-space:nowrap">${d.label} 미측정</span>`
        const c = levelColor(d.level)
        return `<span style="background:rgba(11,14,20,.9);border:1px solid ${c};border-radius:6px;padding:0 5px;color:#fff;font:700 10px/15px 'Noto Sans KR',sans-serif;white-space:nowrap;font-variant-numeric:tabular-nums"><span style="color:${c}">●</span> ${d.label} ${fmt(d.value, d.vehicles)}${unit}</span>`
      }).join('')}</div>`
    : ''
  const html = `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%)">
    <div style="background:${color};color:${p.level === '정체' ? '#fff' : '#0b0b0b'};border:2px solid #fff;border-radius:999px;padding:${big ? '4px 10px' : '2px 7px'};font-weight:800;font-size:${big ? 14 : 12}px;line-height:1.2;box-shadow:0 2px 8px rgba(0,0,0,.6);white-space:nowrap;font-variant-numeric:tabular-nums">${fmt(p.value, p.vehicles)}<span style="font-size:9px;font-weight:600">${unit}</span>${p.n > 1 ? `<span style="font-size:9px;opacity:.8"> ×${p.n}</span>` : ''}</div>${chips}</div>`
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

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const mode = (xs: string[]) => { const m = new Map<string, number>(); xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] }

export default function OverviewPage() {
  const nav = useNavigate()
  const [period, setPeriod] = useState<Period>(0)
  const [group, setGroup] = useState<Group>('camera')
  const [metric, setMetric] = useState<Metric>('occupancy')
  const [split, setSplit] = useState(true)
  const [rank, setRank] = useState<Rank>('direction')
  const [levelFilter, setLevelFilter] = useState<string | null>(null)
  const [zoom, setZoom] = useState(7)
  const [setupOpen, setSetupOpen] = useState(false)
  const { data: live, error, setData: setLive } = usePolling(() => api.metrics.live(), period === 0 ? 5000 : 30000)
  const { data: summ } = usePolling(() => (period ? api.metrics.summary('camera', period) : Promise.resolve(null)), 30000, [period])
  const { data: view, error: viewErr, setData: setView } = usePolling(() => api.routes.view(), 120000)
  const thresholds = live?.thresholds ?? [0.08, 0.15, 0.25]

  /** (카메라, 방향) → 값 */
  const dirValue = useMemo(() => {
    const m = new Map<string, { value: number | null; level: string | null; vehicles: number | null }>()
    ;(live?.cameras ?? []).forEach((c) => {
      if (period === 0) (c.live?.directions ?? []).forEach((d) => m.set(`${c.id}:${d.direction_index}`, { value: d.occupancy, level: d.level, vehicles: d.n_vehicles }))
      else {
        const pc = summ?.groups?.flatMap((g: any) => g.cameras).find((x: any) => x.id === c.id)
        if (pc?.overall) m.set(`${c.id}:0`, { value: pc.overall.occupancy, level: pc.overall.level, vehicles: pc.overall.n_vehicles })
        pc?.directions?.forEach((d: any) => m.set(`${c.id}:${d.direction_index}`, { value: d.occupancy, level: d.level, vehicles: d.n_vehicles }))
      }
    })
    return m
  }, [live, summ, period])

  const camDirs = (c: LiveCamera): DirVal[] =>
    c.directions.map((d) => {
      const v = dirValue.get(`${c.id}:${d.index}`)
      return { index: d.index, label: dirShort(d), value: v?.value ?? null, level: v?.level ?? null, vehicles: v?.vehicles ?? null, measured: d.measured !== false, route: d.road || c.route }
    })

  const points: Point[] = useMemo(() => {
    const cams = (live?.cameras ?? []).filter((c) => c.lat != null && c.lon != null)
    if (group === 'camera')
      return cams.map((c) => {
        const o = dirValue.get(`${c.id}:0`)
        return { key: String(c.id), name: c.name, lat: c.lat!, lon: c.lon!, value: o?.value ?? null, vehicles: o?.vehicles ?? null, level: levelOf(o?.value, thresholds), n: 1, ids: [c.id], dirs: camDirs(c) }
      })
    const m = new Map<string, LiveCamera[]>()
    cams.forEach((c) => { const k = (group === 'route' ? c.route : c.region) || '(미지정)'; m.set(k, [...(m.get(k) ?? []), c]) })
    return [...m.entries()].map(([k, cs]) => {
      const v = avg(cs.map((c) => dirValue.get(`${c.id}:0`)?.value).filter((x): x is number => x != null))
      const vehs = cs.map((c) => dirValue.get(`${c.id}:0`)?.vehicles).filter((x): x is number => x != null)
      // 방면 칩: 노선 묶음은 노선 선 위의 진행 부호로, 지역 묶음은 방면 이름으로 모은다
      const bucket = new Map<string, { labels: string[]; vals: number[] }>()
      cs.forEach((c) => c.directions.forEach((d) => {
        const val = dirValue.get(`${c.id}:${d.index}`)?.value
        if (d.measured === false || val == null) return
        const seg = view?.segments.find((s) => s.camera_id === c.id && s.direction_index === d.index)
        const key = group === 'route' && seg ? `${seg.route}:${seg.sign}` : dirShort(d)
        const b = bucket.get(key) ?? { labels: [], vals: [] }
        b.labels.push(dirShort(d)); b.vals.push(val); bucket.set(key, b)
      }))
      const dirs: DirVal[] = [...bucket.values()].map((b, i) => { const a = avg(b.vals); return { index: i + 1, label: mode(b.labels) ?? '?', value: a, level: levelOf(a, thresholds), measured: true } })
      return { key: k, name: k, lat: avg(cs.map((c) => c.lat!))!, lon: avg(cs.map((c) => c.lon!))!, value: v, vehicles: vehs.length ? vehs.reduce((a, b) => a + b, 0) : null, level: levelOf(v, thresholds), n: cs.length, ids: cs.map((c) => c.id), dirs }
    })
  }, [live, dirValue, group, thresholds, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = points.filter((p) => !levelFilter || p.level === levelFilter || p.dirs.some((d) => d.level === levelFilter))
  const fitPts = useMemo(() => points.map((p) => [p.lat, p.lon] as [number, number]), [points.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = LEVELS.map((l) => points.filter((p) => p.level === l).length)
  // 지도에 그리려면 칠한 방향마다 진행 방향이 있어야 한다. 방면 이름은 없어도 그릴 수 있다(표시 이름만 '방향 N')
  const needSetup = (live?.cameras ?? []).filter((c) => c.directions.some((d) => d.measured !== false && d.heading_deg == null))
  const noName = (live?.cameras ?? []).filter((c) => !needSetup.includes(c) && c.directions.some((d) => d.measured !== false && !d.destination))
  const unmeasured = (live?.cameras ?? []).filter((c) => c.directions.some((d) => d.measured === false))

  const ranked = useMemo(() => {
    if (rank === 'point' || group !== 'camera')
      return [...points].filter((p) => p.value != null).sort((a, b) => b.value! - a.value!).map((p) => ({ key: p.key, title: p.name, sub: p.dirs.map((d) => (d.measured ? `${d.label} ${pct(d.value, 0)}` : `${d.label} 미측정`)).join(' · '), value: p.value, level: p.level, camId: p.ids.length === 1 ? p.ids[0] : null }))
    return (live?.cameras ?? []).flatMap((c) => camDirs(c).filter((d) => d.measured && d.value != null).map((d) => ({ key: `${c.id}-${d.index}`, title: `${d.route ?? ''} ${d.label} 방면`.trim(), sub: c.name, value: d.value, level: d.level, camId: c.id }))).sort((a, b) => b.value! - a.value!)
  }, [points, rank, group, live, dirValue]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !live) return <div className="page"><Banner kind="error">{error}</Banner></div>
  if (!live) return <div className="page"><Loading lg /></div>
  if (!live.cameras.length) return <div className="page"><EmptyState icon={<Globe2 />} title="등록된 CCTV 가 없습니다" description="CCTV 를 등록하고 좌표를 넣으면 전국 지도에 방면별 점유율이 표시됩니다." action={<Link to="/register"><button className="primary">CCTV 등록</button></Link>} /></div>

  const mpp = metersPerPixel(zoom, 36.5)
  const segWeight = zoom >= 12 ? 7 : zoom >= 10 ? 6 : 5
  const segOffset = (segWeight / 2 + 2) * mpp

  return (
    <div className="page full" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="row between" style={{ padding: '12px 16px 0' }}>
        <div>
          <h1 className="row" style={{ gap: 8 }}><Globe2 size={20} />전국 현황</h1>
          <div className="muted">노선마다 방면별로 한 줄씩(진행 방향 오른쪽) 점유율 색으로 칠합니다. 배지 = 지점 값, 칩 = "서울 12%" 처럼 방면별 값.</div>
        </div>
        <div className="row">
          <Segmented options={[{ v: 0, l: '실시간' }, { v: 15, l: '15분 평균' }, { v: 60, l: '1시간 평균' }, { v: 1440, l: '24시간 평균' }]} value={period} onChange={(v) => setPeriod(v as Period)} />
          <Segmented options={[{ v: 'camera', l: '지점별' }, { v: 'route', l: '노선 묶음' }, { v: 'region', l: '지역 묶음' }]} value={group} onChange={(v) => setGroup(v as Group)} />
          <Segmented options={[{ v: 'occupancy', l: '점유율 %' }, { v: 'vehicles', l: '차량 수' }]} value={metric} onChange={(v) => setMetric(v as Metric)} />
          <label className="check small"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />방면 칩</label>
        </div>
      </div>
      {(needSetup.length > 0 || unmeasured.length > 0 || noName.length > 0) && (
        <div className="stack" style={{ padding: '10px 16px 0', gap: 6 }}>
          {needSetup.length > 0 && (
            <Banner kind="warn">
              <span>카메라 {needSetup.length}대는 진행 방향이 정해지지 않아 노선 위에 방면별 선을 그릴 수 없습니다: {needSetup.map((c) => c.name).join(', ')}. 화면 표지판의 목적지(예: 서울)만 적으면 방향은 자동으로 정해집니다.</span>
              <button className="sm primary" style={{ marginLeft: 8 }} onClick={() => setSetupOpen(true)}><Compass />방면 입력하기</button>
            </Banner>
          )}
          {noName.length > 0 && (
            <Banner kind="info">
              <span>카메라 {noName.length}대는 방향은 저장됐지만 방면 이름이 없어 "방향 1" 처럼 표시됩니다: {noName.map((c) => c.name).join(', ')}.</span>
              <button className="sm" style={{ marginLeft: 8 }} onClick={() => setSetupOpen(true)}><Compass />방면 이름 넣기</button>
            </Banner>
          )}
          {unmeasured.length > 0 && <Banner kind="info">카메라 {unmeasured.length}대는 한쪽 방면만 칠해져 있어 나머지 방면은 "미측정" 으로 표시됩니다: {unmeasured.map((c) => c.name).join(', ')}. 상세 페이지 &gt; 도로 마스크 편집에서 빠진 차로를 칠하세요.</Banner>}
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, padding: 14, gap: 12 }}>
        <div className="card pad-0" style={{ flex: 1, minWidth: 0, position: 'relative', minHeight: 480 }}>
          <MapContainer center={[36.3, 127.8]} zoom={7} style={{ height: '100%' }}>
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FitOnce points={fitPts} />
            <ZoomWatcher onZoom={setZoom} />
            {/* 노선 바탕 (회색) */}
            {view && Object.entries(view.lines).map(([route, chains]) => chains.map((ch, i) => (
              <span key={`${route}-${i}`}>
                <Polyline positions={ch as [number, number][]} pathOptions={{ color: '#0b0e14', weight: segWeight * 2 + 6, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }} interactive={false} />
                <Polyline positions={ch as [number, number][]} pathOptions={{ color: '#c3cad8', weight: segWeight * 2 + 2, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}>
                  <Tooltip sticky>{route} · 밝은 회색 = 측정하지 않은 구간</Tooltip>
                </Polyline>
              </span>
            )))}
            {/* 방면별 측정 구간: 진행 방향 오른쪽으로 평행 이동 */}
            {view?.segments.map((s: RouteSegment) => {
              const v = dirValue.get(`${s.camera_id}:${s.direction_index}`)
              const lvl = v?.level ?? null
              if (levelFilter && lvl !== levelFilter) return null
              return (
                <Polyline key={`${s.camera_id}-${s.direction_index}`} positions={offsetLine(s.coords, segOffset)} pathOptions={{ color: v?.value == null ? '#8b96ad' : levelColor(lvl), weight: segWeight, opacity: 0.95, lineCap: 'butt' }} eventHandlers={{ click: () => nav(`/cameras/${s.camera_id}`) }}>
                  <Tooltip sticky>
                    <b>{s.route} {s.destination ? `${s.destination} 방면` : s.name}</b><br />
                    점유율 {pct(v?.value)} · {lvl ?? '측정값 없음'}{v?.vehicles != null ? ` · 차량 ${Math.round(v.vehicles)}대` : ''}<br />
                    <span className="muted">{s.camera_name} 측정 · 앞뒤 {(s.extent_m[0] / 1000).toFixed(1)}/{(s.extent_m[1] / 1000).toFixed(1)}km 표시</span>
                  </Tooltip>
                </Polyline>
              )
            })}
            {shown.map((p) => (
              <Marker key={p.key} position={[p.lat, p.lon]} icon={badgeIcon(p, metric, group !== 'camera', split)} zIndexOffset={Math.round((p.value ?? 0) * 1000)} eventHandlers={{ click: () => (p.ids.length === 1 ? nav(`/cameras/${p.ids[0]}`) : undefined) }}>
                <Tooltip direction="top" offset={[0, -14]}>
                  <b>{p.name}</b>{p.n > 1 ? ` (${p.n}대 평균)` : ''}<br />측정 방면 전체 {pct(p.value)} · {p.level ?? '–'}
                  {p.dirs.map((d) => <div key={d.index}>{d.label} 방면: {d.measured ? `${pct(d.value)} ${d.level ?? ''}` : '미측정 (마스크에 칠하지 않음)'}</div>)}
                </Tooltip>
              </Marker>
            ))}
          </MapContainer>
          <div className="map-overlay" style={{ top: 10, left: 10, maxWidth: 300 }}>
            <div className="legend" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              {LEVELS.map((l, i) => (
                <span key={l} className={`pill clickable ${levelFilter === l ? 'on' : ''}`} onClick={() => setLevelFilter(levelFilter === l ? null : l)}>
                  <span className="dot" style={{ background: levelColor(l) }} />
                  {l} {i < thresholds.length ? `< ${Math.round(thresholds[i] * 100)}%` : `≥ ${Math.round(thresholds[i - 1] * 100)}%`} <span className="muted">{counts[i]}</span>
                </span>
              ))}
              <span className="muted">밝은 회색 띠 = 노선 (측정 안 한 구간), 그 위 색 줄 = 방면별 측정 구간</span>
              <span className="muted">한국은 우측통행이라 각 방면 줄은 진행 방향 오른쪽에 그려집니다</span>
              {viewErr && <span className="error">노선 선을 불러오지 못했습니다: {viewErr}</span>}
            </div>
          </div>
        </div>
        <aside style={{ width: 320, flex: 'none', overflow: 'auto', display: 'grid', gap: 6, alignContent: 'start' }}>
          <div className="row between">
            <h2 className="row" style={{ gap: 6 }}><Layers size={16} />순위 <span className="muted">{ranked.length}</span></h2>
            {group === 'camera' && <Segmented options={[{ v: 'direction', l: '방면별' }, { v: 'point', l: '지점별' }]} value={rank} onChange={(v) => setRank(v as Rank)} />}
          </div>
          {ranked.map((r, i) => (
            <div key={r.key} className="card" style={{ padding: '8px 10px', cursor: r.camId ? 'pointer' : 'default' }} onClick={() => r.camId && nav(`/cameras/${r.camId}`)}>
              <div className="row between" style={{ gap: 6 }}>
                <span className="row" style={{ gap: 6, minWidth: 0 }}>
                  <span className="muted num" style={{ width: 20 }}>{i + 1}</span>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                </span>
                <span className="row" style={{ gap: 6, flex: 'none' }}><b className="num" style={{ color: levelColor(r.level) }}>{pct(r.value, 0)}</b><LevelBadge level={r.level} size="sm" /></span>
              </div>
              {r.sub && <div className="muted" style={{ marginTop: 2, marginLeft: 26 }}>{r.sub}</div>}
            </div>
          ))}
          {!ranked.length && <div className="muted">{period ? '해당 기간에 기록이 없습니다.' : '측정값이 아직 없습니다.'}</div>}
        </aside>
      </div>
      <SetupModal open={setupOpen} onClose={() => setSetupOpen(false)} cams={needSetup.length ? needSetup : noName} allCams={live.cameras} onSaved={async () => { setLive(await api.metrics.live()); setView(await api.routes.view()) }} />
    </div>
  )
}

/** 전국 현황에서 바로 방면 입력: 카메라별로 방면을 적으면 방향 자동 계산 → 저장 */
function SetupModal({ open, onClose, cams, allCams, onSaved }: { open: boolean; onClose: () => void; cams: LiveCamera[]; allCams: LiveCamera[]; onSaved: () => Promise<void> }) {
  const [sel, setSel] = useState<number | null>(null)
  const [cam, setCam] = useState<Camera | null>(null)
  const [dirs, setDirs] = useState<Direction[]>([])
  const { run, busy } = useAction()
  const toast = useToast()
  useEffect(() => { if (open && sel == null && cams.length) setSel(cams[0].id) }, [open, cams, sel])
  useEffect(() => {
    if (sel == null) return
    setCam(null)
    api.cameras.get(sel).then((c) => { setCam(c); setDirs(c.directions.map((d) => ({ ...d }))) }).catch(() => {})
  }, [sel])
  const done = (c: LiveCamera) => !c.directions.some((d) => d.measured !== false && d.heading_deg == null)
  const named = (c: LiveCamera) => !c.directions.some((d) => d.measured !== false && !d.destination)
  const list = [...cams, ...allCams.filter((c) => !cams.some((x) => x.id === c.id))]
  return (
    <Modal open={open} title="방면 입력" onClose={onClose} width={1300}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 12 }}>
        <div className="stack" style={{ gap: 4, alignContent: 'start', maxHeight: '72vh', overflow: 'auto' }}>
          {list.map((c) => (
            <div key={c.id} className={`pill clickable ${sel === c.id ? 'on' : ''}`} style={{ justifyContent: 'space-between', borderRadius: 8, padding: '6px 8px', whiteSpace: 'normal' }} onClick={() => setSel(c.id)}>
              <span>{c.name}</span>
              {!done(c) ? <span className="muted">방향 미정</span> : named(c) ? <span className="ok">✓</span> : <span className="muted" title="방향은 저장됨, 방면 이름 없음">✓ 이름 없음</span>}
            </div>
          ))}
        </div>
        <div>
          {!cam ? <Loading /> : (
            <div className="stack">
              <div className="row between">
                <div><b>{cam.name}</b> <span className="muted">{cam.route ?? ''}</span></div>
                <div className="row">
                  <Link to={`/cameras/${cam.id}`} className="small">상세 페이지</Link>
                  <button className="primary" disabled={!!busy} onClick={() => run('방면 저장', async () => {
                    const saved = await api.cameras.putDirections(cam.id, dirs)
                    await onSaved()
                    const px = (saved.meta?.road_px ?? {}) as Record<string, number>
                    const unnamed = saved.directions.filter((d) => (px[String(d.index)] ?? 0) > 0 && !d.destination).length
                    toast('ok', `"${cam.name}" 저장${unnamed ? ` (방면 이름 없는 방향 ${unnamed}개)` : ''}`)
                    // 목록 순서대로, 아직 방향이 없거나 방면 이름이 없는 다음 카메라로
                    const i = list.findIndex((c) => c.id === cam.id)
                    const next = [...list.slice(i + 1), ...list.slice(0, i)].find((c) => !done(c) || !named(c))
                    if (next) setSel(next.id)
                    else { toast('ok', '모든 카메라의 방향·방면을 입력했습니다'); onClose() }
                  })}>저장 후 다음</button>
                </div>
              </div>
              <DirectionMapEditor key={cam.id} directions={dirs} onChange={setDirs} cameraLat={cam.lat} cameraLon={cam.lon} previewUrl={`${API_BASE}/api/cameras/${cam.id}/preview.jpg`} route={cam.route} roadType={cam.its_road_type ?? 'ex'} roadPx={cam.meta?.road_px as Record<string, number> | undefined} height={380} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

void compass
