import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAnimatedWidth } from './useAnimatedWidth'

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
  background: 'var(--panel)',
  border: '1px solid var(--line-2)',
  borderRadius: 10,
  color: 'var(--ink)',
  fontSize: 12,
}
const tickStyle = { fill: 'var(--ink-3)', fontSize: 11 }
const STROKE = 'var(--teal)'
const FILL = 'color-mix(in srgb, var(--teal) 8%, transparent)'

/** Pre-themed line/area chart. Max two series. Grid is horizontal only. */
export function LineChart({ data, series, height = 280, begin = 0 }: LineChartProps) {
  const showSecond = series.length > 1
  const [ready, setReady] = useState(false)
  const { ref, key } = useAnimatedWidth<HTMLDivElement>()

  useEffect(() => {
    const id = setTimeout(() => setReady(true), begin + 40)
    return () => clearTimeout(id)
  }, [begin])

  return ready ? (
    <div ref={ref} style={{ width: '100%' }}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart key={key} data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="vfAreaA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={FILL} />
            <stop offset="100%" stopColor={FILL} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--line-2)" strokeWidth={1} />
        <XAxis dataKey="label" tick={tickStyle} axisLine={false} tickLine={false} />
        <YAxis tick={tickStyle} axisLine={false} tickLine={false} width={42} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'var(--ink-2)' }} />
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
            stroke="var(--teal-deep)"
            strokeWidth={2}
            fill="transparent"
            dot={false}
            animationDuration={1100}
            animationEasing="ease-out"
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
    </div>
  ) : (
    <div style={{ height }} />
  )
}
