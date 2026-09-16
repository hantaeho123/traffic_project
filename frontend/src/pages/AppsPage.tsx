import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type Camera, type Group } from '../api/client'
import LevelBadge from '../components/LevelBadge'
import OccupancyBar from '../components/OccupancyBar'
import TimeSeriesChart from '../components/TimeSeriesChart'
import { DIRECTION_PALETTE, levelColor, pct } from '../lib/format'
import { usePolling } from '../lib/usePolling'

interface Bridge { name: string; lat: number; lon: number }

/**
 * 응용 분석: 등록된 CCTV 를 목적별로 묶어(그룹) 비교·정책용 리포트를 만든다.
 * 기본 프리셋 "한강 대교" 는 교량별로 카메라를 대응시켜 교량 간 교통량(점유율)을 비교한다.
 */
export default function AppsPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [cams, setCams] = useState<Camera[]>([])
  const [bridges, setBridges] = useState<Bridge[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    const [g, c, b] = await Promise.all([api.apps.groups(), api.cameras.list(), api.apps.hanRiver()])
    setGroups(g)
    setCams(c)
    setBridges(b.bridges)
    if (sel == null && g.length) setSel(g[0].id)
  }
  useEffect(() => { load().catch((e) => setErr(e.message)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const createHanRiver = async () => {
    const g = await api.apps.createGroup({ name: '한강 대교 교통량', kind: 'han_river', description: '한강 교량별 CCTV 점유율 비교 — 교량 간 교통 분산, 시간대별 혼잡 패턴, 정책(가변차로·신호·통행 유도) 검토용', members: [] })
    await load()
    setSel(g.id)
  }
  const createCustom = async () => {
    const name = prompt('그룹 이름 (예: 수도권 순환선, 부산항 진입로)')
    if (!name) return
    const g = await api.apps.createGroup({ name, kind: 'custom', description: '', members: [] })
    await load()
    setSel(g.id)
  }
  const group = groups.find((g) => g.id === sel) ?? null

  return (
    <div className="page" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12 }}>
      <aside>
        <h1>응용 분석</h1>
        <p className="muted">시스템 결과를 정책·운영에 쓰기 위한 그룹 리포트. 예: 한강 대교별 교통량 비교로 교량 간 통행 분산 정책 근거 마련.</p>
        {err && <div className="error">{err}</div>}
        <div style={{ display: 'grid', gap: 6 }}>
          {groups.map((g) => (
            <div key={g.id} className="card" style={{ padding: 8, cursor: 'pointer', outline: sel === g.id ? '1px solid var(--accent)' : 'none' }} onClick={() => setSel(g.id)}>
              <b>{g.name}</b>
              <div className="muted">{g.kind === 'han_river' ? '한강 대교 프리셋' : '사용자 정의'} · {g.members.length}개 카메라</div>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {!groups.some((g) => g.kind === 'han_river') && <button className="primary" onClick={createHanRiver}>+ 한강 대교 프리셋</button>}
          <button onClick={createCustom}>+ 새 그룹</button>
        </div>
      </aside>
      <section>
        {group ? <GroupView key={group.id} group={group} cams={cams} bridges={bridges} onChange={load} /> : <div className="muted">그룹을 만들거나 선택하세요.</div>}
      </section>
    </div>
  )
}

function GroupView({ group, cams, bridges, onChange }: { group: Group; cams: Camera[]; bridges: Bridge[]; onChange: () => Promise<void> }) {
  const [minutes, setMinutes] = useState(60)
  const [editing, setEditing] = useState(group.members.length === 0)
  const [members, setMembers] = useState(group.members.map((m) => ({ camera_id: m.camera_id, label: m.label ?? '', order: m.order })))
  const { data: report, error } = usePolling(() => api.apps.report(group.id, minutes, minutes >= 720 ? 1800 : minutes >= 180 ? 600 : 120), 5000, [group.id, minutes])
  const isHan = group.kind === 'han_river'

  const saveMembers = async () => {
    await api.apps.updateGroup(group.id, { members: members.filter((m) => m.camera_id).map((m, i) => ({ ...m, order: i, label: m.label || null })) })
    await onChange()
    setEditing(false)
  }
  const remove = async () => {
    if (!confirm('그룹을 삭제할까요? (카메라는 유지됩니다)')) return
    await api.apps.deleteGroup(group.id)
    await onChange()
  }

  const chartData = useMemo(() => (report?.members ?? []).map((m: any) => {
    const row: Record<string, any> = { label: m.label, 전체: m.mean ?? 0, level: m.level }
    m.directions.forEach((d: any) => (row[d.name] = d.mean ?? 0))
    return row
  }), [report])
  const dirNames = useMemo(() => {
    const s = new Set<string>()
    ;(report?.members ?? []).forEach((m: any) => m.directions.forEach((d: any) => s.add(d.name)))
    return [...s]
  }, [report])
  const hourly = useMemo(() => Array.from({ length: 24 }, (_, h) => {
    const row: Record<string, any> = { hour: `${h}시` }
    ;(report?.members ?? []).forEach((m: any) => (row[m.label] = m.hourly[h]))
    return row
  }), [report])
  const series = useMemo(() => {
    const byT = new Map<string, Record<string, any>>()
    ;(report?.members ?? []).forEach((m: any) => m.series.forEach((p: any) => {
      const r = byT.get(p.t) ?? { t: p.t }
      r[m.label] = p.occupancy
      byT.set(p.t, r)
    }))
    return [...byT.values()].sort((a, b) => (a.t > b.t ? 1 : -1))
  }, [report])
  const insights = useMemo(() => buildInsights(report, minutes, isHan), [report, minutes, isHan])

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>{group.name}</h2>
          <div className="muted">{group.description}</div>
        </div>
        <div className="row">
          <select value={minutes} onChange={(e) => setMinutes(+e.target.value)}>
            {[15, 60, 180, 720, 1440, 10080].map((m) => <option key={m} value={m}>최근 {m >= 1440 ? `${m / 1440}일` : m >= 60 ? `${m / 60}시간` : `${m}분`}</option>)}
          </select>
          <button className={editing ? 'active' : ''} onClick={() => setEditing(!editing)}>구성 편집</button>
          <button className="danger" onClick={remove}>그룹 삭제</button>
        </div>
      </div>

      {editing && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>구성원 (카메라 ↔ {isHan ? '교량' : '라벨'})</h3>
          {isHan && (
            <p className="muted">
              교량별로 이미 등록된 CCTV 를 고르세요. 아직 없다면 "근처 CCTV 등록" 으로 ITS 검색 지도가 해당 교량 위치에서 열립니다.
            </p>
          )}
          <table>
            <thead><tr><th>{isHan ? '교량' : '라벨'}</th><th>카메라</th><th></th></tr></thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={i}>
                  <td>
                    {isHan ? (
                      <select value={m.label} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}>
                        <option value="">(선택)</option>
                        {bridges.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                      </select>
                    ) : (
                      <input value={m.label} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="표시 이름" />
                    )}
                  </td>
                  <td>
                    <select value={m.camera_id} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, camera_id: +e.target.value } : x)))}>
                      <option value={0}>(카메라 선택)</option>
                      {cams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td><button onClick={() => setMembers(members.filter((_, j) => j !== i))}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => setMembers([...members, { camera_id: 0, label: '', order: members.length }])}>+ 행 추가</button>
            <button className="primary" onClick={saveMembers}>저장</button>
          </div>
          {isHan && (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ marginBottom: 4 }}>교량 근처 CCTV 등록 바로가기</div>
              <div className="row" style={{ gap: 6 }}>
                {bridges.map((b) => (
                  <Link key={b.name} to={`/register?lat=${b.lat}&lon=${b.lon}&label=${encodeURIComponent(b.name)}`} className="pill">{b.name}</Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {report && report.members.length > 0 && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 12 }}>
            <div className="card"><div className="muted">그룹 평균 점유율</div><div className="stat">{pct(report.overall.mean)} <LevelBadge level={report.overall.level} /></div></div>
            <div className="card"><div className="muted">가장 혼잡</div><div className="stat" style={{ fontSize: 20 }}>{report.overall.most_congested ?? '–'}</div></div>
            <div className="card"><div className="muted">가장 원활</div><div className="stat" style={{ fontSize: 20 }}>{report.overall.least_congested ?? '–'}</div></div>
            <div className="card"><div className="muted">모니터링 중</div><div className="stat">{report.overall.n_running}<small>/ {report.overall.n_members}</small></div></div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>{isHan ? '교량별' : '구성원별'} 평균 점유율 (최근 {minutes}분) — 방향 비교</h3>
            <ResponsiveContainer width="100%" height={Math.max(220, 40 * chartData.length)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30 }}>
                <CartesianGrid stroke="#2a3242" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke="#98a2b8" fontSize={11} />
                <YAxis type="category" dataKey="label" width={110} stroke="#98a2b8" fontSize={12} />
                <Tooltip contentStyle={{ background: '#171c25', border: '1px solid #2a3242', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => `${(Number(v) * 100).toFixed(1)}%`} />
                <Legend />
                <Bar dataKey="전체" fill="#e8ecf3" isAnimationActive={false} />
                {dirNames.map((n, i) => <Bar key={n} dataKey={n} fill={DIRECTION_PALETTE[i % DIRECTION_PALETTE.length]} isAnimationActive={false} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
            <div className="card">
              <h3>시간대별 프로필 (누적 전체 기간, KST)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={hourly}>
                  <CartesianGrid stroke="#2a3242" strokeDasharray="3 3" />
                  <XAxis dataKey="hour" stroke="#98a2b8" fontSize={11} interval={2} />
                  <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke="#98a2b8" fontSize={11} width={44} />
                  <Tooltip contentStyle={{ background: '#171c25', border: '1px solid #2a3242', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => `${(Number(v) * 100).toFixed(1)}%`} />
                  <Legend />
                  {report.members.map((m: any, i: number) => <Line key={m.camera_id} dataKey={m.label} stroke={DIRECTION_PALETTE[i % DIRECTION_PALETTE.length]} dot={false} connectNulls isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <h3>최근 {minutes}분 추이</h3>
              <TimeSeriesChart data={series} series={report.members.map((m: any, i: number) => ({ key: m.label, name: m.label, color: DIRECTION_PALETTE[i % DIRECTION_PALETTE.length] }))} thresholds={report.thresholds} />
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>정책 인사이트 (자동 생성)</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {insights.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>

          <table style={{ marginTop: 12 }}>
            <thead><tr><th>{isHan ? '교량' : '구성원'}</th><th>카메라</th><th>실시간</th><th>평균</th><th>최대</th><th>방향별</th><th>샘플</th></tr></thead>
            <tbody>
              {report.members.map((m: any) => (
                <tr key={m.camera_id}>
                  <td><b>{m.label}</b></td>
                  <td><Link to={`/cameras/${m.camera_id}`}>{m.name}</Link> {!m.running && <span className="muted">(정지)</span>}</td>
                  <td>{pct(m.live)} <LevelBadge level={m.live_level} /></td>
                  <td style={{ minWidth: 160 }}><OccupancyBar value={m.mean} level={m.level} /></td>
                  <td>{pct(m.max)}</td>
                  <td>{m.directions.map((d: any) => <div key={d.index} style={{ fontSize: 12 }}><span className="dot" style={{ background: d.color, marginRight: 4 }} />{d.name}: {pct(d.mean)} <span style={{ color: levelColor(d.level) }}>{d.level ?? ''}</span></div>)}</td>
                  <td className="muted">{m.samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {report && report.members.length === 0 && <div className="muted" style={{ marginTop: 12 }}>구성원이 없습니다. "구성 편집" 에서 카메라를 추가하세요.</div>}
    </div>
  )
}

function buildInsights(report: any, minutes: number, isHan: boolean): string[] {
  if (!report?.members?.length) return []
  const ms = report.members.filter((m: any) => m.mean != null)
  if (!ms.length) return ['아직 집계된 샘플이 없습니다. 카메라를 모니터링 상태로 두면 5초마다 기록됩니다.']
  const out: string[] = []
  const sorted = [...ms].sort((a, b) => b.mean - a.mean)
  const top = sorted[0], bottom = sorted[sorted.length - 1]
  const unit = isHan ? '교량' : '지점'
  out.push(`최근 ${minutes}분 기준 가장 혼잡한 ${unit}은 ${top.label}(평균 ${pct(top.mean)}, ${top.level})이고, 가장 원활한 ${unit}은 ${bottom.label}(${pct(bottom.mean)})입니다.`)
  if (top.mean > 0 && bottom.mean >= 0 && top.mean / Math.max(bottom.mean, 0.005) >= 2)
    out.push(`${top.label} 의 점유율이 ${bottom.label} 의 ${(top.mean / Math.max(bottom.mean, 0.005)).toFixed(1)}배입니다. ${isHan ? '인접 교량으로의 우회 유도(가변 안내표지·내비 연계)를 검토할 여지가 있습니다.' : '통행 분산 정책의 우선 검토 대상입니다.'}`)
  const jam = ms.filter((m: any) => m.level === '정체' || m.level === '지체')
  if (jam.length) out.push(`지체 이상 ${unit}: ${jam.map((m: any) => m.label).join(', ')} (${jam.length}/${ms.length}).`)
  // 방향 불균형
  ms.forEach((m: any) => {
    const ds = m.directions.filter((d: any) => d.mean != null)
    if (ds.length >= 2) {
      const s = [...ds].sort((a, b) => b.mean - a.mean)
      if (s[0].mean >= 0.08 && s[0].mean / Math.max(s[1].mean, 0.005) >= 1.8)
        out.push(`${m.label}: ${s[0].name} 방향(${pct(s[0].mean)})이 ${s[1].name} 방향(${pct(s[1].mean)})보다 뚜렷이 혼잡합니다 — 방향별 가변차로/신호 배분 검토 대상.`)
    }
  })
  // 시간대 피크
  ms.forEach((m: any) => {
    const hs = (m.hourly as (number | null)[]).map((v, h) => ({ v, h })).filter((x) => x.v != null) as { v: number; h: number }[]
    if (hs.length >= 6) {
      const peak = hs.reduce((a, b) => (b.v > a.v ? b : a))
      out.push(`${m.label} 의 일중 피크는 ${peak.h}시(평균 ${pct(peak.v)})입니다.`)
    }
  })
  out.push('점유율은 카메라 화각·원근에 영향을 받으므로 지점 간 절대 비교보다 같은 지점의 시간대·방향 간 상대 비교가 더 신뢰할 수 있습니다.')
  return out
}
