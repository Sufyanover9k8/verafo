import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartSpec } from '../lib/types'
import { useAnimatedWidth } from './charts/useAnimatedWidth'

// The brand's chart family: teal first, then the accent ramp, with the deeper
// teal closing the set. All tokens, so both themes stay in step.
const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--teal-deep)']

const TICK_STYLE = { fill: 'var(--ink-3)', fontSize: 11 }
const GRID_STROKE = 'var(--line-2)'
const LEGEND_STYLE = { fontSize: 11, color: 'var(--ink-3)' }
const CURSOR_FILL = 'color-mix(in srgb, var(--teal) 8%, transparent)'
const CURSOR_STROKE = 'color-mix(in srgb, var(--teal) 40%, transparent)'

const fmtValue = (v: number, format?: string) =>
  format === 'pkr' ? `${Math.round(v).toLocaleString('en-PK')} PKR` : format === 'percent' ? `${Math.round(v)}%` : String(v)

interface TipProps {
  active?: boolean
  payload?: { value?: number | string; name?: string; color?: string }[]
  label?: string | number
  format: (label: string) => string
}

/** The one tooltip style every chart here uses. */
function Tip({ active, payload, label, format }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[10px] border border-border bg-popover px-3 py-2 text-xs shadow-2">
      {label != null && label !== '' && <div className="text-muted-foreground">{label}</div>}
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
            {payload.length > 1 && <span className="text-muted-foreground">{p.name}</span>}
            <span className="ms-auto font-semibold text-foreground tabular-nums">
              {fmtValue(Number(p.value ?? 0), format(String(p.name ?? '')))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A chart the assistant attached to an answer. Renders only the chart types the
 * edge function actually emits, and says so plainly when there is nothing to
 * plot rather than drawing an empty frame.
 */
export function ChartCard({ spec }: { spec: ChartSpec }) {
  const { ref, key } = useAnimatedWidth<HTMLDivElement>()
  const rows = spec.labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label }
    for (const d of spec.datasets) row[d.label] = d.data[i] ?? 0
    return row
  })
  const series = spec.datasets.map((d) => d.label)
  const longLabels = rows.length > 6
  const formatOf = (label: string) => spec.datasets.find((d) => d.label === label)?.format ?? 'number'
  const tip = (p: unknown) => <Tip {...(p as TipProps)} format={formatOf} />

  const axes = (angle: boolean) => (
    <XAxis
      dataKey="name"
      tick={TICK_STYLE}
      axisLine={false}
      tickLine={false}
      interval={0}
      angle={angle ? -32 : 0}
      textAnchor={angle ? 'end' : 'middle'}
      height={angle ? 64 : 30}
    />
  )

  return (
    <div ref={ref} className="rounded-[10px] border border-border bg-muted/40 p-4">
      <p className="text-[13.5px] font-semibold text-foreground">{spec.title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">No data to chart yet.</p>
      ) : spec.type === 'pie' ? (
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={230}>
            <PieChart key={key}>
              <Pie data={rows} dataKey={series[0] ?? 'value'} nameKey="name" cx="50%" cy="50%" outerRadius={82} label>
                {rows.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip content={tip} />
              <Legend wrapperStyle={LEGEND_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : spec.type === 'line' ? (
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart key={key} data={rows} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 4" />
              <XAxis dataKey="name" tick={TICK_STYLE} axisLine={false} tickLine={false} />
              <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={tip} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              {series.map((s, i) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: PALETTE[i % PALETTE.length] }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : spec.type === 'scatter' ? (
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={250}>
            <ScatterChart key={key} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 4" />
              <XAxis type="number" dataKey="x" name={spec.datasets[0]?.label ?? 'x'} tick={TICK_STYLE} domain={[0, 1]} />
              <YAxis type="number" dataKey="y" name={spec.datasets[1]?.label ?? 'y'} tick={TICK_STYLE} width={44} />
              <Tooltip content={tip} cursor={{ fill: CURSOR_FILL, stroke: CURSOR_STROKE }} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Scatter
                data={rows.map((r) => ({
                  x: Number(r[spec.datasets[0]?.label ?? 'x'] ?? 0),
                  y: Number(r[spec.datasets[1]?.label ?? 'y'] ?? 0),
                  name: r.name,
                }))}
                fill={PALETTE[0]}
                fillOpacity={0.75}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : spec.type === 'histogram' ? (
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart key={key} data={rows} margin={{ top: 8, right: 14, left: 0, bottom: 0 }} barCategoryGap={0}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 4" />
              {axes(longLabels)}
              <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={tip} cursor={{ fill: CURSOR_FILL, stroke: CURSOR_STROKE }} />
              {series.map((s, i) => (
                <Bar key={s} dataKey={s} fill={PALETTE[i % PALETTE.length]} maxBarSize={64} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart key={key} data={rows} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 4" />
              {axes(longLabels)}
              <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={tip} cursor={{ fill: CURSOR_FILL, stroke: CURSOR_STROKE }} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              {series.map((s, i) => (
                <Bar key={s} dataKey={s} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} maxBarSize={44} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
