import { RISK, formatScore, riskLevel } from '../lib/score'

interface RiskBadgeProps {
  score: number
  showScore?: boolean
}

export function RiskBadge({ score, showScore = true }: RiskBadgeProps) {
  const level = riskLevel(score)
  const s = RISK[level]
  return (
    <span
      className={`badge badge-${level}`}
      style={{ color: s.color, background: s.bg, borderColor: s.border }}
    >
      <span className="badge-dot" style={{ background: s.color }} />
      {s.label}
      {showScore && <span className="badge-score">{formatScore(score)}</span>}
    </span>
  )
}
