import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface SeriesPoint {
  label: string
  a?: number
  b?: number
}

interface LineChartProps {
  data: SeriesPoint[]
  series: { key: 'a' | 'b'; name: string }[]
  height?: number
  /** Delay (ms) before the chart mounts and draws in, so the animation is visible after the card entrance. */
  begin?: number
}

const tooltipStyle = {
  background: 'var(--v-ink-850)',
  border: '1px solid var(--v-ink-600)',
  borderRadius: 8,
  color: 'var(--v-ink-100)',
  fontSize: 12,
}
const tickStyle = { fill: 'var(--v-ink-400)', fontSize: 11 }
const STROKE = 'var(--v-purple-400)'
const FILL = 'rgba(106, 76, 187, 0.10)'

/** Pre-themed line/area chart. Max two series. Grid is horizontal only. */
export function LineChart({ data, series, height = 280, begin = 0 }: LineChartProps) {
  const showSecond = series.length > 1
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => setReady(true), begin + 40)
    return () => clearTimeout(id)
  }, [begin])

  return ready ? (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="vfAreaA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={FILL} />
            <stop offset="100%" stopColor={FILL} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--v-ink-600)" strokeWidth={1} />
        <XAxis dataKey="label" tick={tickStyle} axisLine={false} tickLine={false} />
        <YAxis tick={tickStyle} axisLine={false} tickLine={false} width={42} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'var(--v-ink-300)' }} />
        <Area
          type="monotone"
          dataKey="a"
          name={series[0]?.name ?? ''}
          stroke={STROKE}
          strokeWidth={2}
          fill="url(#vfAreaA)"
          dot={false}
          animationDuration={1100}
          animationEasing="ease-out"
        />
        {showSecond && (
          <Area
            type="monotone"
            dataKey="b"
            name={series[1]?.name ?? ''}
            stroke="var(--v-ink-300)"
            strokeWidth={2}
            fill="transparent"
            dot={false}
            animationDuration={1100}
            animationEasing="ease-out"
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  ) : (
    <div style={{ height }} />
  )
}
