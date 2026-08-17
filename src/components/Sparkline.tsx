import { useId } from 'react'

interface SparklineProps {
  data: number[]
  height?: number
  className?: string
}

export function Sparkline({ data, height = 30, className }: SparklineProps) {
  const gid = `spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pad = 2
  const w = Math.max(12, data.length * 2)
  const step = (w - pad * 2) / (data.length - 1)
  const pts = data.map((v, i) => {
    const x = pad + i * step
    const y = pad + (height - pad * 2) * (1 - (v - min) / span)
    return [x, y] as const
  })
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `M${pts[0][0].toFixed(2)},${height} L${line.replace(/ /g, ' L')} L${pts[pts.length - 1][0].toFixed(2)},${height} Z`
  return (
    <svg
      className={`sparkline${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cyan-bright)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--cyan-bright)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke="var(--cyan-bright)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}