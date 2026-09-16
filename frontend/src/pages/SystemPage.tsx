import { api } from '../api/client'
import { usePolling } from '../lib/usePolling'

export default function SystemPage() {
  const { data, error } = usePolling(() => api.system(), 5000)
  if (error) return <div className="page error">{error}</div>
  if (!data) return <div className="page muted">불러오는 중…</div>
  const road = data.models.road
  return (
    <div className="page">
      <h1>시스템 상태</h1>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        <div className="card">
          <h3>차량 세그멘테이션 (YOLO-seg, 파인튜닝)</h3>
          <dl className="kv">
            <dt>가중치</dt><dd style={{ wordBreak: 'break-all' }}>{data.models.yolo_weights}</dd>
            <dt>로드</dt><dd>{data.models.yolo_loaded ? <span className="ok">로드됨 ({data.models.yolo_device})</span> : <span className="muted">첫 추론 시 로드</span>}</dd>
            <dt>클래스</dt><dd>{(data.models.yolo_classes ?? data.vehicle_classes).join(', ')}</dd>
            <dt>추론 주기</dt><dd>{data.infer_fps} fps / 카메라</dd>
          </dl>
        </div>
        <div className="card">
          <h3>도로 세그멘테이션 (등록 시 1회)</h3>
          <dl className="kv">
            <dt>백엔드</dt><dd>{road.backend === 'sam3' ? <span className="ok">SAM3</span> : <span style={{ color: 'var(--slow)' }}>SAM2.1 (대체)</span>}</dd>
            <dt>텍스트 프롬프트</dt><dd>{road.text_prompt ? '사용 가능' : '불가 — sam3.pt 필요'}</dd>
            <dt>점/박스</dt><dd>사용 가능</dd>
            <dt>디바이스</dt><dd>{road.device}</dd>
            <dt>SAM3 경로</dt><dd style={{ wordBreak: 'break-all' }}>{road.sam3_weights}</dd>
          </dl>
          {!road.text_prompt && <p className="muted">SAM3 를 쓰려면 <code>python scripts/download_sam3.py --token hf_xxx</code> 로 가중치를 받은 뒤 서버를 재시작하세요.</p>}
        </div>
        <div className="card">
          <h3>ITS Open API</h3>
          <dl className="kv">
            <dt>인증키</dt><dd>{data.its_configured ? <span className="ok">설정됨</span> : <span className="error">미설정 (.env ITS_API_KEY)</span>}</dd>
          </dl>
        </div>
        <div className="card">
          <h3>혼잡 단계 임계값</h3>
          <dl className="kv">
            {data.levels.map((l: string, i: number) => (
              <span key={l} style={{ display: 'contents' }}>
                <dt>{l}</dt>
                <dd>{i < data.thresholds.length ? `< ${(data.thresholds[i] * 100).toFixed(0)}%` : `≥ ${(data.thresholds[i - 1] * 100).toFixed(0)}%`}</dd>
              </span>
            ))}
          </dl>
          <p className="muted">.env 의 CONGESTION_THRESHOLDS 로 변경</p>
        </div>
        <div className="card">
          <h3>워커</h3>
          {Object.keys(data.workers).length ? (
            <dl className="kv">{Object.entries(data.workers).map(([k, v]) => <span key={k} style={{ display: 'contents' }}><dt>camera {k}</dt><dd>{String(v)}</dd></span>)}</dl>
          ) : <div className="muted">실행 중인 워커 없음</div>}
        </div>
      </div>
    </div>
  )
}
