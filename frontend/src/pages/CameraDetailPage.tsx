import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { API_BASE, api, type Camera, type Direction, type HistoryPoint, type Job } from '../api/client'
import DirectionPanel from '../components/DirectionPanel'
import HlsPlayer from '../components/HlsPlayer'
import LevelBadge from '../components/LevelBadge'
import LiveImage from '../components/LiveImage'
import MaskEditor, { type MaskEditorHandle } from '../components/MaskEditor'
import TimeSeriesChart from '../components/TimeSeriesChart'
import { fmtTime, pct } from '../lib/format'
import { usePolling } from '../lib/usePolling'

const MODES = [
  { v: 'class', l: '차종별' },
  { v: 'vehicle', l: '차량(단일)' },
  { v: 'road', l: '도로만' },
  { v: 'none', l: '원본' },
]

export default function CameraDetailPage() {
  const { id } = useParams()
  const cid = Number(id)
  const nav = useNavigate()
  const { data: cam, error, setData } = usePolling(() => api.cameras.get(cid), 2000, [cid])
  const [mode, setMode] = useState('class')
  const [hud, setHud] = useState(true)
  const [showOriginal, setShowOriginal] = useState(false)
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [thresholds, setThresholds] = useState<number[]>([0.08, 0.15, 0.25])

  useEffect(() => {
    api.system().then((s) => setThresholds(s.thresholds)).catch(() => {})
  }, [])

  const refresh = async () => setData(await api.cameras.get(cid))
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null)
    try {
      await fn()
      await refresh()
      if (ok) setMsg(ok)
    } catch (e: any) {
      setMsg(e.message)
    }
  }

  if (error) return <div className="page error">{error}</div>
  if (!cam) return <div className="page muted">불러오는 중…</div>
  const overall = cam.live?.directions?.find((d) => d.direction_index === 0)

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>{cam.name} <LevelBadge level={overall?.level} /></h1>
          <div className="muted">{[cam.route, cam.region, cam.section].filter(Boolean).join(' · ')} · {cam.source_type === 'its' ? `ITS ${cam.its_cctv_name}` : cam.source_type === 'upload' ? `업로드 ${cam.video_path?.split('/').pop()}` : cam.stream_url}</div>
        </div>
        <div className="row">
          <button onClick={() => act(() => (cam.running ? api.cameras.stop(cid) : api.cameras.start(cid)))} disabled={!cam.mask_path}>{cam.running ? '모니터링 정지' : '모니터링 시작'}</button>
          <button onClick={() => act(() => api.cameras.refreshSnapshot(cid), '스냅샷을 갱신했습니다')}>스냅샷 갱신</button>
          <button className={editing ? 'active' : ''} onClick={() => setEditing(!editing)}>도로 마스크 편집</button>
          <button className="danger" onClick={() => { if (confirm('이 CCTV 와 기록을 삭제할까요?')) api.cameras.remove(cid).then(() => nav('/cameras')) }}>삭제</button>
        </div>
      </div>
      {msg && <div className="muted" style={{ marginTop: 6 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
        <div className="card">
          <div className="toolbar">
            <div className="group">
              {MODES.map((m) => <button key={m.v} className={mode === m.v ? 'active' : ''} onClick={() => setMode(m.v)}>{m.l}</button>)}
            </div>
            <label className="pill"><input type="checkbox" checked={hud} onChange={(e) => setHud(e.target.checked)} /> HUD</label>
            {cam.source_type === 'its' && cam.stream_url && <label className="pill"><input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} /> 원본 HLS</label>}
            <span className="muted">{cam.live ? `${cam.live.status} · ${cam.live.infer_ms}ms/frame · ${cam.live.fps} fps · ${fmtTime(cam.live.ts)}` : '정지'}</span>
            {cam.live?.error && <span className="error">{cam.live.error}</span>}
          </div>
          <LiveImage cameraId={cid} mode={mode} hud={hud} maxFps={10} />
          {showOriginal && cam.stream_url && <div style={{ marginTop: 8 }}><HlsPlayer url={cam.stream_url} /></div>}
        </div>
        <div className="card">
          <h3>방향별 점유율 (실시간)</h3>
          <DirectionPanel live={cam.live} directions={cam.directions} showClasses={mode === 'class'} />
          <div className="kv" style={{ marginTop: 12 }}>
            <dt>도로 픽셀</dt><dd>{cam.meta?.road_px ? Object.entries(cam.meta.road_px as Record<string, number>).map(([k, v]) => `${cam.directions.find((d) => d.index === +k)?.name ?? k}: ${Math.round(v / 1000)}k`).join(' / ') : '–'}</dd>
            <dt>프레임</dt><dd>{cam.frame_width}×{cam.frame_height}</dd>
            <dt>도로 비율</dt><dd>{pct(cam.meta?.road_coverage as number)}</dd>
            {cam.source_type === 'its' && <><dt>URL 발급</dt><dd>{cam.stream_url_fetched_at ? new Date(cam.stream_url_fetched_at).toLocaleString('ko-KR') : '–'} (24h 유효, 자동 갱신)</dd></>}
          </div>
          {cam.source_type === 'upload' && <AnalysisPanel cam={cam} />}
        </div>
      </div>

      {editing && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>도로 마스크 편집</h3>
          <MaskEditSection cam={cam} onSaved={() => { setEditing(false); refresh() }} />
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <HistorySection cam={cam} thresholds={thresholds} />
      </div>
      <div style={{ marginTop: 12 }}><Link to="/cameras">← 전체 보기</Link></div>
    </div>
  )
}

function MaskEditSection({ cam, onSaved }: { cam: Camera; onSaved: () => void }) {
  const [directions, setDirections] = useState<Direction[]>(cam.directions.map((d) => ({ index: d.index, name: d.name, color: d.color })))
  const ref = useRef<MaskEditorHandle | null>(null)
  const onReady = useCallback((h: MaskEditorHandle) => { ref.current = h }, [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    if (!ref.current) return
    setBusy(true)
    setErr(null)
    try {
      await api.cameras.putMask(cam.id, ref.current.exportPng(), directions)
      onSaved()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  if (!cam.frame_width || !cam.frame_height) return <div className="muted">스냅샷이 없습니다</div>
  return (
    <div>
      <MaskEditor imageUrl={`${API_BASE}/api/cameras/${cam.id}/snapshot.jpg?_=${cam.snapshot_path}`} width={cam.frame_width} height={cam.frame_height} cameraId={cam.id} directions={directions} onDirectionsChange={setDirections} initialMaskUrl={cam.mask_path ? `${API_BASE}/api/cameras/${cam.id}/mask.png` : undefined} onReady={onReady} />
      {err && <div className="error">{err}</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={save} disabled={busy}>마스크 저장 (워커 재시작)</button>
      </div>
    </div>
  )
}

function AnalysisPanel({ cam }: { cam: Camera }) {
  const [stride, setStride] = useState(5)
  const { data: jobs, setData } = usePolling(() => api.cameras.jobs(cam.id), 3000, [cam.id])
  const latest: Job | undefined = jobs?.[0]
  const run = async () => {
    await api.cameras.analyze(cam.id, stride)
    setData(await api.cameras.jobs(cam.id))
  }
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <h3>영상 전체 분석 (오프라인)</h3>
      <div className="row">
        <select value={stride} onChange={(e) => setStride(+e.target.value)}>
          {[1, 2, 5, 10, 15, 30].map((s) => <option key={s} value={s}>{s}프레임마다</option>)}
        </select>
        <button className="primary" onClick={run} disabled={latest?.status === 'running'}>분석 실행</button>
      </div>
      {latest && (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <div>상태: {latest.status} {latest.status === 'running' && `${Math.round(latest.progress * 100)}%`} {latest.error && <span className="error">{latest.error}</span>}</div>
          {latest.status === 'running' && <div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${latest.progress * 100}%`, background: 'var(--accent)' }} /></div>}
          {latest.summary && (
            <div className="kv" style={{ marginTop: 6 }}>
              <dt>길이</dt><dd>{latest.summary.duration_s}s · {latest.summary.processed}프레임 처리</dd>
              {Object.entries(latest.summary.directions as Record<string, any>).map(([d, s]) => (
                <span key={d} style={{ display: 'contents' }}>
                  <dt>{d === '0' ? '전체' : cam.directions.find((x) => x.index === +d)?.name ?? d}</dt>
                  <dd>평균 {pct(s.mean)} · 최대 {pct(s.max)} · p90 {pct(s.p90)}</dd>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HistorySection({ cam, thresholds }: { cam: Camera; thresholds: number[] }) {
  const [source, setSource] = useState<'live' | 'file'>('live')
  const [minutes, setMinutes] = useState(30)
  const [bucket, setBucket] = useState(30)
  const [rows, setRows] = useState<Record<string, any>[]>([])
  const dirs = useMemo(() => [{ index: 0, name: '전체', color: '#e8ecf3' }, ...cam.directions], [cam.directions])

  useEffect(() => {
    let alive = true
    const load = async () => {
      const res = await Promise.all(dirs.map((d) => api.metrics.history({ camera_id: cam.id, direction: d.index, minutes, bucket, source })))
      if (!alive) return
      const byT = new Map<string | number, Record<string, any>>()
      res.forEach((r, i) => {
        r.points.forEach((p: HistoryPoint) => {
          const row = byT.get(p.t) ?? { t: p.t }
          row[`d${dirs[i].index}`] = p.occupancy
          row[`n${dirs[i].index}`] = p.n_vehicles
          byT.set(p.t, row)
        })
      })
      setRows([...byT.values()].sort((a, b) => (a.t > b.t ? 1 : -1)))
    }
    load()
    const t = setInterval(load, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [cam.id, dirs, minutes, bucket, source])

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>점유율 추이</h3>
        <div className="row">
          {cam.source_type === 'upload' && (
            <div className="group row" style={{ gap: 4 }}>
              <button className={source === 'live' ? 'active' : ''} onClick={() => setSource('live')}>실시간(반복 재생)</button>
              <button className={source === 'file' ? 'active' : ''} onClick={() => setSource('file')}>영상 전체 분석</button>
            </div>
          )}
          {source === 'live' && (
            <select value={minutes} onChange={(e) => setMinutes(+e.target.value)}>
              {[10, 30, 60, 180, 720, 1440, 10080].map((m) => <option key={m} value={m}>최근 {m >= 1440 ? `${m / 1440}일` : m >= 60 ? `${m / 60}시간` : `${m}분`}</option>)}
            </select>
          )}
          <select value={bucket} onChange={(e) => setBucket(+e.target.value)}>
            {[5, 10, 30, 60, 300, 900, 3600].map((b) => <option key={b} value={b}>{b >= 60 ? `${b / 60}분` : `${b}초`} 평균</option>)}
          </select>
        </div>
      </div>
      <TimeSeriesChart data={rows} series={dirs.map((d) => ({ key: `d${d.index}`, name: d.name, color: d.color }))} thresholds={thresholds} xIsVideoTime={source === 'file'} />
    </div>
  )
}
