import { useId } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

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
}

const TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

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
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold text-foreground tabular-nums">{format(Number(payload[0].value ?? 0))}</div>
    </div>
  )
}

function Empty({ height, text }: { height: number; text: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground" style={{ height }}>
      {text}
    </div>
  )
}

/** One series as a soft area line. */
export function TrendArea({ data, height = 240, format = String, axisFormat = compact, emptyText = 'No data in this period yet.' }: ChartProps) {
  const gid = `fill-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  if (data.length === 0 || data.every((d) => d.value === 0)) return <Empty height={height} text={emptyText} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
        <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} tickMargin={8} minTickGap={16} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} width={44} tickFormatter={axisFormat} />
        <Tooltip cursor={{ stroke: 'var(--border)' }} content={(p) => <Tip {...(p as unknown as TipProps)} format={format} />} />
        <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} fill={`url(#${gid})`} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** One series as rounded bars. */
export function TrendBars({ data, height = 240, format = String, axisFormat = compact, emptyText = 'No data in this period yet.' }: ChartProps) {
  if (data.length === 0 || data.every((d) => d.value === 0)) return <Empty height={height} text={emptyText} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
        <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} tickMargin={8} minTickGap={16} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} width={32} allowDecimals={false} tickFormatter={axisFormat} />
        <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={(p) => <Tip {...(p as unknown as TipProps)} format={format} />} />
        <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  )
}
