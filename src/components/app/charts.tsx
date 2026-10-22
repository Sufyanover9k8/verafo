import { useId } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface ChartPoint {
  label: string
  value: number
}

interface ChartProps {
  data: ChartPoint[]
  height?: number
  /** How a value is written in the tooltip, for example "PKR 4,200". */
  format?: (n: number) => string
  /** How a value is written on the Y axis. Defaults to a compact number. */
  axisFormat?: (n: number) => string
  emptyText?: string
  /** What the chart shows, for screen readers. The SVG itself is decorative. */
  label?: string
}

const TICK = { fill: 'var(--ink-3)', fontSize: 11 }

const compact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n)

interface TipProps {
  active?: boolean
  payload?: { value?: number | string }[]
  label?: string | number
  format: (n: number) => string
}

function Tip({ active, payload, label, format }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[10px] border border-border bg-popover px-3 py-2 text-xs shadow-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold text-foreground tabular-nums">{format(Number(payload[0].value ?? 0))}</div>
    </div>
  )
}

function Empty({ height, text }: { height: number; text: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-[10px] border border-dashed border-border text-[13.5px] text-muted-foreground"
      style={{ height }}
    >
      {text}
    </div>
  )
}

/** One series as a soft area line. */
export function TrendArea({
  data,
  height = 240,
  format = String,
  axisFormat = compact,
  emptyText = 'No data in this period yet.',
  label,
}: ChartProps) {
  const gid = `fill-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  if (data.length === 0 || data.every((d) => d.value === 0)) return <Empty height={height} text={emptyText} />
  return (
    <div role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line-2)" strokeDasharray="3 4" />
          <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} tickMargin={8} minTickGap={16} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} width={44} tickFormatter={axisFormat} />
          <Tooltip cursor={{ stroke: 'var(--line-2)' }} content={(p) => <Tip {...(p as unknown as TipProps)} format={format} />} />
          <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} fill={`url(#${gid})`} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** One series as rounded bars. */
export function TrendBars({
  data,
  height = 240,
  format = String,
  axisFormat = compact,
  emptyText = 'No data in this period yet.',
  label,
}: ChartProps) {
  if (data.length === 0 || data.every((d) => d.value === 0)) return <Empty height={height} text={emptyText} />
  return (
    <div role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line-2)" strokeDasharray="3 4" />
          <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} tickMargin={8} minTickGap={16} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} width={32} allowDecimals={false} tickFormatter={axisFormat} />
          <Tooltip cursor={{ fill: 'var(--bg-2)', opacity: 0.6 }} content={(p) => <Tip {...(p as unknown as TipProps)} format={format} />} />
          <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── The multi-metric volume chart ────────────────────────── */

export interface MetricSeries {
  key: string
  name: string
  /** CSS colour. Series colours are passed in so the caller owns the mapping. */
  color: string
  /** How the value reads in the tooltip, e.g. "PKR 4,200". */
  format: (n: number) => string
  /** Right-hand axis this series is measured on. */
  axis: 'left' | 'right'
}

export interface MetricPoint {
  label: string
  [key: string]: string | number
}

/**
 * An optional dashed line for the same window one period ago, so a merchant can
 * see "more orders than last week" without doing the subtraction themselves.
 * Only offered when the previous window is a fair comparison — the caller
 * decides that and passes nothing otherwise.
 */
export interface MetricCompare {
  key: string
  name: string
  color: string
}

interface MetricChartProps {
  data: MetricPoint[]
  /** Which series are switched on. Keys match `series[].key`. */
  active: string[]
  series: MetricSeries[]
  height?: number
  label?: string
  emptyText?: string
  /** Drawn as a dashed line on the left axis. */
  compare?: MetricCompare
}

/**
 * Volume over time with a metric switcher: order count on the left axis, and
 * optionally revenue or the average risk score on a second right-hand axis.
 *
 * Two axes only (left and right), because a third scale would be unreadable and
 * would invite comparing numbers that are not comparable. The chart is
 * decorative for assistive tech; the caller renders the same figures as text.
 */
export function MetricTrend({
  data,
  active,
  series,
  height = 260,
  label,
  emptyText = 'No data in this period yet.',
  compare,
}: MetricChartProps) {
  const on = series.filter((s) => active.includes(s.key))
  const gid = `metric-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  if (data.length === 0 || on.length === 0) return <Empty height={height} text={emptyText} />

  const left = on.filter((s) => s.axis === 'left')
  const right = on.filter((s) => s.axis === 'right')
  const hasBars = left.length > 0
  const leftMetric = left[0]
  const rightMetric = right[0]

  return (
    <div role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: right.length > 0 ? 4 : 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line-2)" strokeDasharray="3 4" />
          <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} tickMargin={8} minTickGap={12} />
          <YAxis
            yAxisId="left"
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={left.length > 0 ? 40 : 0}
            allowDecimals={false}
            tickFormatter={leftMetric ? (v) => leftMetric.format(Number(v)) : compact}
          />
          {rightMetric && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={TICK}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={(v) => rightMetric.format(Number(v))}
            />
          )}
          <Tooltip
            cursor={{ fill: 'color-mix(in srgb, var(--teal) 8%, transparent)' }}
            content={(p) => {
              const props = p as unknown as { active?: boolean; payload?: { dataKey?: string; value?: number }[]; label?: string }
              if (!props.active || !props.payload?.length) return null
              return (
                <div className="rounded-[10px] border border-border bg-popover px-3 py-2 text-xs shadow-2">
                  <div className="text-muted-foreground">{props.label}</div>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {props.payload.map((row) => {
                      const s = series.find((x) => x.key === row.dataKey)
                      if (!s) return null
                      return (
                        <li key={s.key} className="flex items-center gap-2">
                          <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                          <span className="text-muted-foreground">{s.name}</span>
                          <span className="ms-auto font-mono font-semibold text-foreground tabular-nums">
                            {s.format(Number(row.value ?? 0))}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            }}
          />
          {hasBars && (
            <Bar yAxisId="left" dataKey={left[0].key} fill={`url(#${gid})`} stroke="var(--chart-1)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={34} />
          )}
          {compare && (
            <Line
              yAxisId="left"
              type="monotone"
              dataKey={compare.key}
              name={compare.name}
              stroke={compare.color}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
              legendType="none"
            />
          )}          {[...left.slice(1), ...right].map((s) => (
            <Line
              key={s.key}
              yAxisId={s.axis}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
