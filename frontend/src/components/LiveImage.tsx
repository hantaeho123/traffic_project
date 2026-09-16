import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

/** MJPEG 스트림 <img>. 워커가 없으면 서버가 정지 프레임을 준다. */
export default function LiveImage({
  cameraId,
  mode,
  hud = true,
  maxFps = 8,
  style,
  onClick,
}: {
  cameraId: number
  mode: string
  hud?: boolean
  maxFps?: number
  style?: React.CSSProperties
  onClick?: () => void
}) {
  const [src, setSrc] = useState('')
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    setSrc(api.stream.mjpegUrl(cameraId, mode, hud, maxFps))
    return () => {
      // 스트림 연결 정리
      if (ref.current) ref.current.src = ''
    }
  }, [cameraId, mode, hud, maxFps])
  return <img ref={ref} className="live-img" src={src} alt="" style={{ cursor: onClick ? 'pointer' : undefined, ...style }} onClick={onClick} />
}
