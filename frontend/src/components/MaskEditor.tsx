import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, api, type Direction } from '../api/client'
import { DIRECTION_PALETTE } from '../lib/format'

/**
 * 픽셀 단위 도로 마스크 편집기.
 *
 * 내부 상태는 프레임 크기의 Uint8Array 라벨맵 (0=도로 아님, 1..N=방향).
 * 도구: SAM 점 / SAM 박스 / SAM3 텍스트 / 브러시 / 지우개 / 다각형 채우기.
 * SAM 결과는 "현재 방향" 에 더하거나(추가) 도로에서 빼는(제외) 식으로 합친다.
 */

export type Tool = 'sam-point' | 'sam-box' | 'brush' | 'eraser' | 'polygon'

export interface MaskEditorHandle {
  exportPng: () => string // base64 PNG (data 없이)
  label: Uint8Array
}

interface Props {
  imageUrl: string
  width: number
  height: number
  snapshotId?: string
  cameraId?: number
  directions: Direction[]
  onDirectionsChange: (d: Direction[]) => void
  initialMaskUrl?: string // 기존 마스크 PNG (편집 시)
  onReady?: (h: MaskEditorHandle) => void
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

async function decodeMaskPng(b64OrUrl: string, w: number, h: number): Promise<Uint8Array> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = b64OrUrl.startsWith('data:') || b64OrUrl.startsWith('http') ? b64OrUrl : b64OrUrl.startsWith('/') ? API_BASE + b64OrUrl : `data:image/png;base64,${b64OrUrl}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = d[i * 4]
  return out
}

function pointInPoly(x: number, y: number, poly: number[][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export default function MaskEditor({ imageUrl, width, height, snapshotId, cameraId, directions, onDirectionsChange, initialMaskUrl, onReady }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<HTMLCanvasElement>(null)
  const labelRef = useRef<Uint8Array>(new Uint8Array(width * height))
  const undoRef = useRef<Uint8Array[]>([])
  const [, force] = useState(0)
  const rerender = () => force((v) => v + 1)

  const [tool, setTool] = useState<Tool>('sam-point')
  const [current, setCurrent] = useState(1)
  const [brush, setBrush] = useState(30)
  const [mergeMode, setMergeMode] = useState<'add' | 'remove'>('add')
  const [points, setPoints] = useState<{ x: number; y: number; label: number }[]>([])
  const [box, setBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [poly, setPoly] = useState<number[][]>([])
  const [text, setText] = useState('road')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [samStatus, setSamStatus] = useState<{ backend: string; text_prompt: boolean } | null>(null)
  const [opacity, setOpacity] = useState(0.45)
  const [pending, setPending] = useState<Uint8Array | null>(null) // SAM 결과 미리보기 (bool 0/1)
  const dragging = useRef<{ x: number; y: number } | null>(null)

  // 초기화
  useEffect(() => {
    labelRef.current = new Uint8Array(width * height)
    undoRef.current = []
    if (initialMaskUrl) {
      decodeMaskPng(initialMaskUrl, width, height).then((m) => {
        labelRef.current = m
        rerender()
      })
    } else rerender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, initialMaskUrl])

  useEffect(() => {
    api.segment.status().then(setSamStatus).catch(() => setSamStatus(null))
  }, [])

  // 크기 맞춤
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setScale(Math.min(1, w / width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])

  const exportPng = useCallback(() => {
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(width, height)
    const lab = labelRef.current
    for (let i = 0; i < lab.length; i++) {
      img.data[i * 4] = lab[i]
      img.data[i * 4 + 1] = lab[i]
      img.data[i * 4 + 2] = lab[i]
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return c.toDataURL('image/png').split(',')[1]
  }, [width, height])

  useEffect(() => {
    onReady?.({ exportPng, get label() { return labelRef.current } })
  }, [exportPng, onReady])

  // 오버레이 렌더
  const colors = useMemo(() => {
    const m: Record<number, [number, number, number]> = {}
    directions.forEach((d) => (m[d.index] = hexToRgb(d.color || DIRECTION_PALETTE[(d.index - 1) % DIRECTION_PALETTE.length])))
    return m
  }, [directions])

  useEffect(() => {
    const cv = overlayRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(width, height)
    const lab = labelRef.current
    const a = Math.round(opacity * 255)
    for (let i = 0; i < lab.length; i++) {
      const v = lab[i]
      if (v > 0) {
        const c = colors[v] ?? [255, 255, 255]
        img.data[i * 4] = c[0]
        img.data[i * 4 + 1] = c[1]
        img.data[i * 4 + 2] = c[2]
        img.data[i * 4 + 3] = a
      }
      if (pending && pending[i]) {
        // 미리보기: 노란색 하이라이트
        img.data[i * 4] = 255
        img.data[i * 4 + 1] = 230
        img.data[i * 4 + 2] = 0
        img.data[i * 4 + 3] = 160
      }
    }
    ctx.putImageData(img, 0, 0)
  })

  // 드로잉 가이드 (점/박스/다각형)
  useEffect(() => {
    const cv = drawRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, width, height)
    ctx.lineWidth = 3 / scale
    points.forEach((p) => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 9 / scale, 0, Math.PI * 2)
      ctx.fillStyle = p.label ? '#2fbf71' : '#e5484d'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    })
    if (box) {
      ctx.strokeStyle = '#4f8cff'
      ctx.setLineDash([8 / scale, 6 / scale])
      ctx.strokeRect(Math.min(box.x1, box.x2), Math.min(box.y1, box.y2), Math.abs(box.x2 - box.x1), Math.abs(box.y2 - box.y1))
      ctx.setLineDash([])
    }
    if (poly.length) {
      ctx.strokeStyle = '#ffe600'
      ctx.beginPath()
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
      poly.forEach(([x, y]) => {
        ctx.beginPath()
        ctx.arc(x, y, 6 / scale, 0, Math.PI * 2)
        ctx.fillStyle = '#ffe600'
        ctx.fill()
      })
    }
  }, [points, box, poly, scale, width, height])

  const pushUndo = () => {
    undoRef.current.push(labelRef.current.slice())
    if (undoRef.current.length > 25) undoRef.current.shift()
  }
  const undo = () => {
    const prev = undoRef.current.pop()
    if (prev) {
      labelRef.current = prev
      rerender()
    }
  }

  const toImg = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: Math.max(0, Math.min(width - 1, (e.clientX - r.left) / scale)), y: Math.max(0, Math.min(height - 1, (e.clientY - r.top) / scale)) }
  }

  const paint = (x: number, y: number, value: number) => {
    const lab = labelRef.current
    const r = brush / 2
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(width - 1, Math.ceil(x + r))
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(height - 1, Math.ceil(y + r))
    for (let yy = y0; yy <= y1; yy++)
      for (let xx = x0; xx <= x1; xx++) if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) lab[yy * width + xx] = value
  }

  const onMouseDown = (e: React.MouseEvent) => {
    const p = toImg(e)
    if (tool === 'sam-point') {
      setPoints((ps) => [...ps, { x: p.x, y: p.y, label: e.shiftKey || e.button === 2 ? 0 : 1 }])
    } else if (tool === 'sam-box') {
      dragging.current = p
      setBox({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
    } else if (tool === 'brush' || tool === 'eraser') {
      pushUndo()
      dragging.current = p
      paint(p.x, p.y, tool === 'brush' ? current : 0)
      rerender()
    } else if (tool === 'polygon') {
      setPoly((ps) => [...ps, [p.x, p.y]])
    }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    const p = toImg(e)
    if (tool === 'sam-box') setBox((b) => (b ? { ...b, x2: p.x, y2: p.y } : b))
    else if (tool === 'brush' || tool === 'eraser') {
      // 선형 보간으로 끊김 방지
      const { x, y } = dragging.current
      const n = Math.max(1, Math.ceil(Math.hypot(p.x - x, p.y - y) / (brush / 4)))
      for (let i = 1; i <= n; i++) paint(x + ((p.x - x) * i) / n, y + ((p.y - y) * i) / n, tool === 'brush' ? current : 0)
      dragging.current = p
      rerender()
    }
  }
  const onMouseUp = () => {
    dragging.current = null
  }

  // ---- SAM ----
  const runSam = async (kind: 'point' | 'box' | 'text') => {
    setErr(null)
    setBusy(kind === 'text' ? 'SAM3 텍스트 추론 중…' : 'SAM 추론 중…')
    try {
      const ref = snapshotId ? { snapshot_id: snapshotId } : { camera_id: cameraId }
      let res
      if (kind === 'text') res = await api.segment.text({ ...ref, text })
      else if (kind === 'point') res = await api.segment.prompt({ ...ref, points: points.map((p) => [p.x, p.y]), labels: points.map((p) => p.label) })
      else if (kind === 'box' && box) res = await api.segment.prompt({ ...ref, boxes: [[Math.min(box.x1, box.x2), Math.min(box.y1, box.y2), Math.max(box.x1, box.x2), Math.max(box.y1, box.y2)]] })
      if (!res) return
      const m = await decodeMaskPng(res.mask_png_base64, width, height)
      for (let i = 0; i < m.length; i++) m[i] = m[i] > 127 ? 1 : 0
      setPending(m)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }
  const applyPending = () => {
    if (!pending) return
    pushUndo()
    const lab = labelRef.current
    if (mergeMode === 'add') for (let i = 0; i < lab.length; i++) if (pending[i]) lab[i] = current
    if (mergeMode === 'remove') for (let i = 0; i < lab.length; i++) if (pending[i]) lab[i] = 0
    setPending(null)
    setPoints([])
    setBox(null)
    rerender()
  }
  const applyPolygon = (onlyRoad: boolean) => {
    if (poly.length < 3) return
    pushUndo()
    const lab = labelRef.current
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)))
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)))
    const v = mergeMode === 'add' ? current : 0
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x
        if (onlyRoad && lab[i] === 0) continue
        if (pointInPoly(x + 0.5, y + 0.5, poly)) lab[i] = v
      }
    setPoly([])
    rerender()
  }
  const clearAll = () => {
    pushUndo()
    labelRef.current.fill(0)
    rerender()
  }
  const fillHoles = () => {
    // 간단한 모폴로지 닫힘: 각 방향 라벨에 대해 3회 팽창 후 침식
    pushUndo()
    const lab = labelRef.current
    const n = Math.max(0, ...Array.from(lab))
    const rad = 4
    const dilate = (src: Uint8Array, val: number) => {
      const out = src.slice()
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          if (src[y * width + x] !== val) continue
          for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
            const xx = x + dx, yy = y + dy
            if (xx >= 0 && yy >= 0 && xx < width && yy < height && src[yy * width + xx] === 0) out[yy * width + xx] = val
          }
        }
      return out
    }
    const erode = (src: Uint8Array, val: number) => {
      const out = src.slice()
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          if (src[y * width + x] !== val) continue
          let keep = true
          for (let dy = -rad; dy <= rad && keep; dy++) for (let dx = -rad; dx <= rad; dx++) {
            const xx = x + dx, yy = y + dy
            if (xx < 0 || yy < 0 || xx >= width || yy >= height || src[yy * width + xx] !== val) { keep = false; break }
          }
          if (!keep) out[y * width + x] = 0
        }
      return out
    }
    let cur = lab
    for (let v = 1; v <= n; v++) cur = erode(dilate(cur, v), v)
    labelRef.current = cur
    rerender()
  }

  // 방향 편집
  const addDirection = () => {
    const idx = directions.length + 1
    if (idx > 6) return
    onDirectionsChange([...directions, { index: idx, name: `방향 ${idx}`, color: DIRECTION_PALETTE[(idx - 1) % DIRECTION_PALETTE.length] }])
    setCurrent(idx)
  }
  const removeDirection = () => {
    if (directions.length <= 1) return
    const idx = directions.length
    pushUndo()
    const lab = labelRef.current
    for (let i = 0; i < lab.length; i++) if (lab[i] === idx) lab[i] = 0
    onDirectionsChange(directions.slice(0, -1))
    setCurrent(Math.min(current, idx - 1))
    rerender()
  }

  // 방향별 픽셀 수 (렌더마다 계산; 1080p 기준 수 ms)
  const stats: Record<number, number> = {}
  {
    const lab = labelRef.current
    for (let i = 0; i < lab.length; i++) if (lab[i]) stats[lab[i]] = (stats[lab[i]] || 0) + 1
  }

  const cursor = tool === 'brush' || tool === 'eraser' ? 'crosshair' : tool === 'sam-box' ? 'cell' : 'pointer'

  return (
    <div>
      <div className="toolbar">
        <div className="group">
          <span className="muted">도구</span>
          <button className={tool === 'sam-point' ? 'active' : ''} onClick={() => setTool('sam-point')} title="클릭=포함, Shift+클릭=제외">SAM 점</button>
          <button className={tool === 'sam-box' ? 'active' : ''} onClick={() => setTool('sam-box')}>SAM 박스</button>
          <button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}>브러시</button>
          <button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')}>지우개</button>
          <button className={tool === 'polygon' ? 'active' : ''} onClick={() => setTool('polygon')}>다각형</button>
        </div>
        <div className="group">
          <span className="muted">브러시</span>
          <input type="range" min={4} max={150} value={brush} onChange={(e) => setBrush(+e.target.value)} />
          <span className="muted">{brush}px</span>
        </div>
        <div className="group">
          <span className="muted">합치기</span>
          <button className={mergeMode === 'add' ? 'active' : ''} onClick={() => setMergeMode('add')}>현재 방향에 추가</button>
          <button className={mergeMode === 'remove' ? 'active' : ''} onClick={() => setMergeMode('remove')}>도로에서 제외</button>
        </div>
        <div className="group">
          <span className="muted">투명도</span>
          <input type="range" min={0.1} max={0.9} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} />
        </div>
        <button onClick={undo} disabled={!undoRef.current.length}>실행취소</button>
        <button onClick={fillHoles} title="작은 구멍/틈을 메웁니다">구멍 메우기</button>
        <button className="danger" onClick={clearAll}>전체 지우기</button>
      </div>

      <div className="toolbar">
        <div className="group">
          <span className="muted">SAM3 텍스트</span>
          <input value={text} onChange={(e) => setText(e.target.value)} style={{ width: 120 }} disabled={!samStatus?.text_prompt} />
          <button onClick={() => runSam('text')} disabled={!!busy || !samStatus?.text_prompt} title={samStatus?.text_prompt ? '' : 'sam3.pt 가 없어 텍스트 프롬프트를 쓸 수 없습니다'}>
            텍스트로 찾기
          </button>
        </div>
        <div className="group">
          <span className="muted">점 {points.length}개</span>
          <button onClick={() => runSam('point')} disabled={!!busy || !points.length}>점으로 추론</button>
          <button onClick={() => setPoints([])} disabled={!points.length}>점 지우기</button>
        </div>
        <div className="group">
          <button onClick={() => runSam('box')} disabled={!!busy || !box}>박스로 추론</button>
          <button onClick={() => setBox(null)} disabled={!box}>박스 지우기</button>
        </div>
        <div className="group">
          <span className="muted">다각형 {poly.length}점</span>
          <button onClick={() => applyPolygon(false)} disabled={poly.length < 3}>영역 채우기</button>
          <button onClick={() => applyPolygon(true)} disabled={poly.length < 3} title="이미 도로인 픽셀만 현재 방향으로 재할당 (방향 나누기)">도로만 재할당</button>
          <button onClick={() => setPoly([])} disabled={!poly.length}>취소</button>
        </div>
        {pending && (
          <div className="group" style={{ background: '#3a3510' }}>
            <span>노란 영역을</span>
            <button className="primary" onClick={applyPending}>{mergeMode === 'add' ? `${directions.find((d) => d.index === current)?.name ?? current} 에 추가` : '도로에서 제외'}</button>
            <button onClick={() => setPending(null)}>버리기</button>
          </div>
        )}
        {busy && <span className="muted">{busy}</span>}
        {err && <span className="error">{err}</span>}
        {samStatus && <span className="muted">SAM 백엔드: {samStatus.backend}</span>}
      </div>

      <div className="toolbar">
        <span className="muted">방향(현재 칠할 라벨)</span>
        {directions.map((d) => (
          <div key={d.index} className="group" style={{ outline: current === d.index ? '2px solid var(--accent)' : 'none', cursor: 'pointer' }} onClick={() => setCurrent(d.index)}>
            <input type="color" value={d.color} onChange={(e) => onDirectionsChange(directions.map((x) => (x.index === d.index ? { ...x, color: e.target.value } : x)))} onClick={(e) => e.stopPropagation()} />
            <input value={d.name} onChange={(e) => onDirectionsChange(directions.map((x) => (x.index === d.index ? { ...x, name: e.target.value } : x)))} onClick={(e) => e.stopPropagation()} style={{ width: 130 }} />
            <span className="muted">{((stats[d.index] || 0) / (width * height) * 100).toFixed(1)}%</span>
          </div>
        ))}
        <button onClick={addDirection} disabled={directions.length >= 6}>+ 방향</button>
        <button onClick={removeDirection} disabled={directions.length <= 1}>− 방향</button>
      </div>

      <div ref={wrapRef} className="editor-wrap" style={{ width: '100%', height: height * scale, cursor }} onContextMenu={(e) => e.preventDefault()}>
        <img src={imageUrl.startsWith('/') ? API_BASE + imageUrl : imageUrl} alt="" style={{ position: 'absolute', left: 0, top: 0, width: width * scale, height: height * scale, pointerEvents: 'none' }} draggable={false} />
        <canvas ref={overlayRef} width={width} height={height} style={{ width: width * scale, height: height * scale, pointerEvents: 'none' }} />
        <canvas
          ref={drawRef}
          width={width}
          height={height}
          style={{ width: width * scale, height: height * scale }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        사용법: ① SAM 점(클릭=포함, Shift+클릭=제외)/박스/텍스트로 도로를 찾고 → 노란 미리보기를 현재 방향에 추가 ② 방향이 여러 개면 다각형 도구로 한쪽을 감싸 "도로만 재할당" ③ 브러시/지우개로 픽셀 단위 보정
      </div>
    </div>
  )
}
