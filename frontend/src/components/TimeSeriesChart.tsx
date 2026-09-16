import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtTime, LEVEL_COLOR } from '../lib/format'

export interface SeriesDef {
  key: string
  name: string
  color: string
}

/** 점유율 시계열 (여러 시리즈). data[i][key] = 0~1 */
export default function TimeSeriesChart({
  data,
  series,
  thresholds,
  height = 240,
  xIsVideoTime = false,
}: {
  data: Record<string, any>[]
  series: SeriesDef[]
  thresholds?: number[]
  height?: number
  xIsVideoTime?: boolean
}) {
  if (!data.length) return <div className="muted" style={{ padding: 20, textAlign: 'center' }}>데이터가 없습니다</div>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#2a3242" strokeDasharray="3 3" />
        <XAxis dataKey="t" tickFormatter={(v) => fmtTime(v)} stroke="#98a2b8" fontSize={11} minTickGap={30} />
        <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke="#98a2b8" fontSize={11} width={44} domain={[0, (max: number) => Math.max(0.3, Math.ceil(max * 10) / 10)]} />
        <Tooltip
          contentStyle={{ background: '#171c25', border: '1px solid #2a3242', borderRadius: 8, fontSize: 12 }}
          labelFormatter={(v) => (xIsVideoTime ? `영상 ${fmtTime(v as number)}` : fmtTime(v as string))}
          formatter={(v: any, name: any) => [`${(Number(v) * 100).toFixed(1)}%`, name]}
        />
        {thresholds?.map((t, i) => (
          <ReferenceLine key={i} y={t} stroke={Object.values(LEVEL_COLOR)[i + 1]} strokeDasharray="4 4" strokeOpacity={0.6} />
        ))}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} dot={false} strokeWidth={2} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
