import L from 'leaflet'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Direction, type ItsCctv } from '../api/client'
import MaskEditor, { type MaskEditorHandle } from '../components/MaskEditor'
import { DIRECTION_PALETTE } from '../lib/format'

type SourceTab = 'its' | 'upload' | 'url'
interface Snapshot {
  snapshot_id: string
  width: number
  height: number
  url: string
}

function MapRef({ onMap }: { onMap: (m: L.Map) => void }) {
  const map = useMap()
  useEffect(() => {
    onMap(map)
  }, [map, onMap])
  return null
}

export default function RegisterPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [step, setStep] = useState(1)
  const [tab, setTab] = useState<SourceTab>('its')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // ---- 소스 ----
  const [itsConfigured, setItsConfigured] = useState<boolean | null>(null)
  const [roadType, setRoadType] = useState('all')
  const [cctvType, setCctvType] = useState('1')
  const [results, setResults] = useState<ItsCctv[]>([])
  const [selectedIts, setSelectedIts] = useState<ItsCctv | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [upload, setUpload] = useState<{ path: string; kind: string; filename: string; info: any } | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  // ---- 마스크 ----
  const [directions, setDirections] = useState<Direction[]>([
    { index: 1, name: '방향 1 (예: 서울 방면)', color: DIRECTION_PALETTE[0] },
    { index: 2, name: '방향 2 (예: 부산 방면)', color: DIRECTION_PALETTE[1] },
  ])
  const editorRef = useRef<MaskEditorHandle | null>(null)
  const onEditorReady = useCallback((h: MaskEditorHandle) => {
    editorRef.current = h
  }, [])

  // ---- 메타 ----
  const [meta, setMeta] = useState({ name: '', route: '', region: '', section: '', lon: '', lat: '' })

  const preLat = params.get('lat'), preLon = params.get('lon'), preLabel = params.get('label')
  const center: [number, number] = preLat && preLon ? [+preLat, +preLon] : [37.5, 127.0]

  useEffect(() => {
    api.its.status().then((s) => setItsConfigured(s.configured)).catch(() => setItsConfigured(false))
  }, [])
  useEffect(() => {
    if (preLabel) setMeta((m) => ({ ...m, section: preLabel, name: m.name || preLabel }))
  }, [preLabel])

  const searchIts = async () => {
    const m = mapRef.current
    if (!m) return
    const b = m.getBounds()
    setErr(null)
    setBusy('ITS 검색 중…')
    try {
      const r = await api.its.search({ road_type: roadType, cctv_type: cctvType, min_x: b.getWest(), max_x: b.getEast(), min_y: b.getSouth(), max_y: b.getNorth() })
      setResults(r.items)
      if (!r.items.length) setErr('이 영역에는 CCTV 가 없습니다. 지도를 이동/확대하세요.')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  const takeSnapshot = async (source: string) => {
    setErr(null)
    setBusy('스냅샷 가져오는 중… (HLS 는 10초 정도 걸릴 수 있습니다)')
    try {
      const s = await api.snapshots.fromSource(source)
      setSnapshot(s)
      setStep(2)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  const onFile = async (f: File | null) => {
    if (!f) return
    setErr(null)
    setBusy('업로드 중…')
    try {
      const r = await api.snapshots.upload(f)
      setUpload({ path: r.path, kind: r.kind, filename: r.filename, info: r.info })
      setSnapshot({ snapshot_id: r.snapshot_id, width: r.width, height: r.height, url: r.url })
      setMeta((m) => ({ ...m, name: m.name || f.name.replace(/\.[^.]+$/, '') }))
      setStep(2)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  const selectIts = (it: ItsCctv) => {
    setSelectedIts(it)
    setMeta((m) => ({ ...m, name: it.name, route: it.route ?? '', lon: String(it.lon), lat: String(it.lat) }))
  }

  const save = async () => {
    if (!snapshot || !editorRef.current) return
    if (!meta.name.trim()) return setErr('이름을 입력하세요')
    const label = editorRef.current.label
    let any = false
    for (let i = 0; i < label.length; i++) if (label[i]) { any = true; break }
    if (!any) return setErr('도로 영역이 비어 있습니다. 2단계로 돌아가 도로를 지정하세요.')
    setErr(null)
    setBusy('저장 중…')
    try {
      const body: Record<string, unknown> = {
        name: meta.name,
        source_type: tab,
        snapshot_id: snapshot.snapshot_id,
        route: meta.route || null,
        region: meta.region || null,
        section: meta.section || null,
        lon: meta.lon ? +meta.lon : null,
        lat: meta.lat ? +meta.lat : null,
      }
      if (tab === 'its' && selectedIts) Object.assign(body, { stream_url: selectedIts.url, its_cctv_name: selectedIts.name, its_road_type: selectedIts.road_type, its_cctv_type: cctvType })
      if (tab === 'url') Object.assign(body, { stream_url: urlInput })
      if (tab === 'upload' && upload) Object.assign(body, { video_path: upload.path, meta: { upload_kind: upload.kind, filename: upload.filename } })
      const cam = await api.cameras.create(body)
      await api.cameras.putMask(cam.id, editorRef.current.exportPng(), directions.map((d) => ({ index: d.index, name: d.name, color: d.color })))
      if (!(tab === 'upload' && upload?.kind === 'image')) await api.cameras.start(cam.id)
      nav(`/cameras/${cam.id}`)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <h1>CCTV 등록</h1>
      <div className="tabs">
        {[1, 2, 3].map((s) => (
          <button key={s} className={step === s ? 'active' : ''} disabled={s > 1 && !snapshot} onClick={() => setStep(s)}>
            {s}. {['영상 소스', '도로 영역 지정', '정보 입력 및 저장'][s - 1]}
          </button>
        ))}
      </div>
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {busy && <div className="muted" style={{ marginBottom: 8 }}>{busy}</div>}

      {step === 1 && (
        <div>
          <div className="row" style={{ marginBottom: 12 }}>
            <button className={tab === 'its' ? 'active' : ''} onClick={() => setTab('its')}>ITS 실시간 CCTV</button>
            <button className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>영상/이미지 업로드</button>
            <button className={tab === 'url' ? 'active' : ''} onClick={() => setTab('url')}>스트림 URL 직접 입력</button>
          </div>

          {tab === 'its' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 12, height: 560 }}>
              <div style={{ position: 'relative' }}>
                <MapContainer center={center} zoom={preLat ? 14 : 10} style={{ height: '100%', borderRadius: 10 }}>
                  <MapRef onMap={(m) => (mapRef.current = m)} />
                  <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {results.map((it, i) => (
                    <CircleMarker key={i} center={[it.lat, it.lon]} radius={selectedIts === it ? 10 : 6} pathOptions={{ color: it.road_type === 'ex' ? '#4f8cff' : '#f2c14e', fillOpacity: 0.9 }} eventHandlers={{ click: () => selectIts(it) }}>
                      <Tooltip>{it.name}</Tooltip>
                    </CircleMarker>
                  ))}
                </MapContainer>
                <div className="row" style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000, background: 'var(--panel)', padding: 8, borderRadius: 8 }}>
                  <select value={roadType} onChange={(e) => setRoadType(e.target.value)}>
                    <option value="all">고속도로+국도</option>
                    <option value="ex">고속도로</option>
                    <option value="its">국도</option>
                  </select>
                  <select value={cctvType} onChange={(e) => setCctvType(e.target.value)}>
                    <option value="1">HLS (http)</option>
                    <option value="4">HLS (https)</option>
                  </select>
                  <button className="primary" onClick={searchIts} disabled={!!busy || itsConfigured === false}>현재 지도 영역 검색</button>
                </div>
              </div>
              <div className="card" style={{ overflow: 'auto' }}>
                {itsConfigured === false && (
                  <div className="error" style={{ marginBottom: 8 }}>
                    ITS_API_KEY 가 설정되지 않았습니다. <code>.env</code> 에 키를 넣고 서버를 재시작하세요. (<a href="https://www.its.go.kr/opendata/opendataList?service=cctv" target="_blank" rel="noreferrer">키 발급</a>)
                  </div>
                )}
                <h3>검색 결과 {results.length}건</h3>
                <div style={{ display: 'grid', gap: 4 }}>
                  {results.map((it, i) => (
                    <div key={i} className="pill" style={{ cursor: 'pointer', justifyContent: 'space-between', outline: selectedIts === it ? '1px solid var(--accent)' : 'none' }} onClick={() => selectIts(it)}>
                      <span>{it.name}</span>
                      <span className="muted">{it.road_type === 'ex' ? '고속' : '국도'}</span>
                    </div>
                  ))}
                </div>
                {selectedIts && (
                  <div style={{ marginTop: 12 }}>
                    <div><b>{selectedIts.name}</b></div>
                    <div className="muted">{selectedIts.lat.toFixed(5)}, {selectedIts.lon.toFixed(5)} · {selectedIts.format}</div>
                    <button className="primary" style={{ marginTop: 8 }} onClick={() => takeSnapshot(selectedIts.url)} disabled={!!busy}>스냅샷 가져와서 다음 →</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="card" style={{ maxWidth: 640 }}>
              <p className="muted">mp4/mov/avi 영상 또는 jpg/png 이미지. 영상은 등록 후 실시간처럼 반복 재생되며, "전체 분석" 으로 영상 전체의 점유율 시계열도 얻을 수 있습니다.</p>
              <input type="file" accept="video/*,image/*" onChange={(e) => onFile(e.target.files?.[0] ?? null)} disabled={!!busy} />
            </div>
          )}

          {tab === 'url' && (
            <div className="card" style={{ maxWidth: 640 }}>
              <p className="muted">HLS(.m3u8) / RTSP / 로컬 파일 경로 등 OpenCV(FFmpeg) 가 열 수 있는 소스.</p>
              <div className="row">
                <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="http://.../stream.m3u8" style={{ flex: 1 }} />
                <button className="primary" onClick={() => takeSnapshot(urlInput)} disabled={!urlInput || !!busy}>스냅샷 가져와서 다음 →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && snapshot && (
        <div>
          <p className="muted">
            SAM 으로 도로를 찾은 뒤 방향별로 나누고, 브러시로 픽셀 단위 보정을 합니다. 분모(도로)는 차량이 덮을 수 있는 노면 전체를 포함해야 합니다 (갓길·중앙분리대 제외).
          </p>
          <MaskEditor imageUrl={snapshot.url} width={snapshot.width} height={snapshot.height} snapshotId={snapshot.snapshot_id} directions={directions} onDirectionsChange={setDirections} onReady={onEditorReady} />
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => setStep(1)}>← 소스 다시 선택</button>
            <button className="primary" onClick={() => setStep(3)}>다음: 정보 입력 →</button>
          </div>
        </div>
      )}

      {step === 3 && snapshot && (
        <div className="card" style={{ maxWidth: 760 }}>
          <div className="form">
            <label>이름 *</label>
            <input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
            <label>노선</label>
            <input value={meta.route} onChange={(e) => setMeta({ ...meta, route: e.target.value })} placeholder="예: 경부선" />
            <label>지역</label>
            <input value={meta.region} onChange={(e) => setMeta({ ...meta, region: e.target.value })} placeholder="예: 경기 수원" />
            <label>구간</label>
            <input value={meta.section} onChange={(e) => setMeta({ ...meta, section: e.target.value })} placeholder="예: 신갈JC~수원IC / 한남대교" />
            <label>경도 / 위도</label>
            <div className="row">
              <input value={meta.lon} onChange={(e) => setMeta({ ...meta, lon: e.target.value })} placeholder="127.0" style={{ width: 140 }} />
              <input value={meta.lat} onChange={(e) => setMeta({ ...meta, lat: e.target.value })} placeholder="37.5" style={{ width: 140 }} />
              <span className="muted">지도에 표시하려면 필요</span>
            </div>
            <label>방향</label>
            <div className="row">
              {directions.map((d) => (
                <span key={d.index} className="pill"><span className="dot" style={{ background: d.color }} />{d.name}</span>
              ))}
            </div>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button onClick={() => setStep(2)}>← 도로 영역 수정</button>
            <button className="primary" onClick={save} disabled={!!busy}>저장하고 모니터링 시작</button>
            <Link to="/" className="muted">취소</Link>
          </div>
        </div>
      )}
    </div>
  )
}
