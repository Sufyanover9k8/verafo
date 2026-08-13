import { useEffect, useState } from 'react'

export interface Distribution {
  safe: number
  watch: number
  high: number
  unknown: number
}

interface DistributionBarProps {
  distribution: Distribution
  showUnknown?: boolean
  /** Delay (ms) before the bars start growing, so the animation begins after the card is visible. */
  begin?: number
}

const ROWS = [
  { key: 'safe', label: 'Low risk', cls: 'safe' },
  { key: 'watch', label: 'Medium risk', cls: 'watch' },
  { key: 'high', label: 'High risk', cls: 'high' },
  { key: 'unknown', label: 'Insufficient data', cls: 'unknown' },
] as const

/** Risk-distribution breakdown. Semantic colour is permitted here because the subject IS risk. */
export function DistributionBar({ distribution, showUnknown = true, begin = 0 }: DistributionBarProps) {
  const [on, setOn] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => setOn(true), begin + 40)
    return () => clearTimeout(id)
  }, [begin])

  const total = ROWS.reduce((sum, r) => sum + distribution[r.key], 0) || 1
  const rows = ROWS.filter((r) => showUnknown || r.key !== 'unknown')
  return (
    <div className="dist-bar">
      {rows.map((r, i) => {
        const value = distribution[r.key]
        const pct = Math.round((value / total) * 100)
        return (
          <div className="dist-row" key={r.key}>
            <div className="dist-row-head">
              <span>{r.label}</span>
              <strong>
                {value}
                <span className="muted"> · {pct}%</span>
              </strong>
            </div>
            <div className="dist-track">
              <div
                className={`dist-fill ${r.cls}`}
                style={{ width: on ? `${pct}%` : '0%', transitionDelay: `${i * 70}ms` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
