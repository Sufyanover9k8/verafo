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

const PALETTE = ['#06b6d4', '#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#94a3b8', '#22d3ee']

const TOOLTIP_STYLE = {
  background: 'var(--bg-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 12,
}

const TICK_STYLE = { fill: 'var(--muted)', fontSize: 11 }
const GRID_STROKE = 'var(--border)'
const LEGEND_STYLE = { fontSize: 11, color: 'var(--muted)' }
const CURSOR_FILL = 'color-mix(in srgb, var(--accent) 8%, transparent)'
const CURSOR_STROKE = 'color-mix(in srgb, var(--accent) 40%, transparent)'

const fmtValue = (v: number, format?: string) =>
  format === 'pkr' ? `${Math.round(v).toLocaleString('en-PK')} PKR` : format === 'percent' ? `${Math.round(v)}%` : String(v)

export function ChartCard({ spec }: { spec: ChartSpec }) {
  const rows = spec.labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label }
    for (const d of spec.datasets) row[d.label] = d.data[i] ?? 0
    return row
  })
  const series = spec.datasets.map((d) => d.label)
  const longLabels = rows.length > 6
  const formatOf = (label: string) => spec.datasets.find((d) => d.label === label)?.format ?? 'number'
  const tooltipFormatter = (value: unknown, name: unknown) => [
    fmtValue(Number(value), formatOf(String(name))),
    String(name),
  ]

  return (
    <div className="chart-card">
      <div className="chart-title">{spec.title}</div>
      {rows.length === 0 ? (
        <div className="chart-empty">No data to chart yet.</div>
      ) : spec.type === 'pie' ? (
        <div className="chart-holder">
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie
                data={rows}
                dataKey={series[0] ?? 'value'}
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={82}
                label
              >
                {rows.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} />
              <Legend wrapperStyle={LEGEND_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : spec.type === 'line' ? (
        <div className="chart-holder">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={rows} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} />
              <XAxis dataKey="name" tick={TICK_STYLE} />
              <YAxis tick={TICK_STYLE} width={44} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} />
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
        <div className="chart-holder">
          <ResponsiveContainer width="100%" height={250}>
            <ScatterChart margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} />
              <XAxis type="number" dataKey="x" name={spec.datasets[0]?.label ?? 'x'} tick={TICK_STYLE} domain={[0, 1]} />
              <YAxis type="number" dataKey="y" name={spec.datasets[1]?.label ?? 'y'} tick={TICK_STYLE} width={44} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CURSOR_FILL, stroke: CURSOR_STROKE }} />
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
        <div className="chart-holder">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={rows} margin={{ top: 8, right: 14, left: 0, bottom: 0 }} barCategoryGap={0}>
              <CartesianGrid stroke={GRID_STROKE} />
              <XAxis
                dataKey="name"
                tick={TICK_STYLE}
                interval={0}
                angle={longLabels ? -32 : 0}
                textAnchor={longLabels ? 'end' : 'middle'}
                height={longLabels ? 64 : 30}
              />
              <YAxis tick={TICK_STYLE} width={44} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CURSOR_FILL, stroke: CURSOR_STROKE }} formatter={tooltipFormatter} />
              {series.map((s, i) => (
                <Bar key={s} dataKey={s} fill={PALETTE[i % PALETTE.length]} maxBarSize={64} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="chart-holder">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={rows} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} />
              <XAxis
                dataKey="name"
                tick={TICK_STYLE}
                interval={0}
                angle={longLabels ? -32 : 0}
                textAnchor={longLabels ? 'end' : 'middle'}
                height={longLabels ? 64 : 30}
              />
              <YAxis tick={TICK_STYLE} width={44} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CURSOR_FILL, stroke: CURSOR_STROKE }} formatter={tooltipFormatter} />
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
