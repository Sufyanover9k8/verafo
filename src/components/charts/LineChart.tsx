import { useEffect, useMemo, useState } from 'react'
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

const TICK = { fill: 'var(--ink-3)', fontSize: 11 }
const STROKE = 'var(--teal)'
const FILL = 'color-mix(in srgb, var(--teal) 8%, transparent)'

interface TipProps {
  active?: boolean
  payload?: { value?: number | string; name?: string; color?: string }[]
  label?: string | number
}

/** Recharts' default tooltip carries its own inline styling; this replaces it. */
function Tip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[10px] border border-border bg-popover px-3 py-2 text-xs shadow-2">
      {label != null && label !== '' && <div className="text-muted-foreground">{label}</div>}
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
            {payload.length > 1 && <span className="text-muted-foreground">{p.name}</span>}
            <span className="ms-auto font-mono font-semibold text-foreground tabular-nums">
              PKR {Number(p.value ?? 0).toLocaleString('en-PK')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Pre-themed line/area chart, max two series, teal for the first. Grid is
 * horizontal only, and the plot mounts after `begin` so the draw-in is visible
 * once the card entrance has finished.
 */
export function LineChart({ data, series, height = 280, begin = 0 }: LineChartProps) {
  const showSecond = series.length > 1
  const [ready, setReady] = useState(false)
  const { ref, key } = useAnimatedWidth<HTMLDivElement>()
  const tip = useMemo(() => (p: unknown) => <Tip {...(p as TipProps)} />, [])

  useEffect(() => {
    const id = setTimeout(() => setReady(true), begin + 40)
    return () => clearTimeout(id)
  }, [begin])

  if (!ready) return <div style={{ height }} />

  return (
    <div ref={ref} style={{ width: '100%' }} role="img" aria-label={series.map((s) => s.name).join(' and ')}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart key={key} data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="vfAreaA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={FILL} />
              <stop offset="100%" stopColor={FILL} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line-2)" strokeWidth={1} />
          <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} width={42} />
          <Tooltip content={tip} cursor={{ stroke: 'var(--line-2)' }} />
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
  )
}
