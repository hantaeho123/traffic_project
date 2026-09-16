import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { Spinner } from './ui'

/** MJPEG 스트림 <img>. 워커가 없으면 서버가 정지 프레임을 준다. 첫 프레임 전까지 스피너 표시. */
export default function LiveImage({ cameraId, mode, hud = true, maxFps = 8, style, onClick, running, label }: { cameraId: number; mode: string; hud?: boolean; maxFps?: number; style?: React.CSSProperties; onClick?: () => void; running?: boolean; label?: string }) {
  const [src, setSrc] = useState('')
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    setReady(false)
    setFailed(false)
    setSrc(api.stream.mjpegUrl(cameraId, mode, hud, maxFps))
    return () => {
      if (ref.current) ref.current.src = ''
    }
  }, [cameraId, mode, hud, maxFps])
  return (
    <div className="live-frame" style={style}>
      <img ref={ref} className="live-img" src={src} alt="" style={{ cursor: onClick ? 'pointer' : undefined }} onClick={onClick} onLoad={() => setReady(true)} onError={() => setFailed(true)} />
      {!ready && !failed && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 12 }}>
          <div className="row"><Spinner /> 영상 연결 중…</div>
        </div>
      )}
      {failed && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--jam)', fontSize: 12 }}>스트림을 불러오지 못했습니다</div>}
      {(running != null || label) && (
        <div className="overlay-tl">
          {running != null && <span className="live-badge">{running ? <><span className="rec" />LIVE</> : '정지'}</span>}
          {label && <span className="live-badge">{label}</span>}
        </div>
      )}
    </div>
  )
}
