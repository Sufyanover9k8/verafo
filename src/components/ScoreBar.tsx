import { RISK, riskLevel } from '../lib/score'

export function ScoreBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(1, score))
  const level = riskLevel(clamped)
  const style = RISK[level]
  return (
    <div className="scorebar">
      <div className="scorebar-track">
        <div className="scorebar-marker" style={{ left: `${clamped * 100}%`, borderColor: style.color, boxShadow: `0 0 10px ${style.glow}` }} />
      </div>
      <div className="scorebar-scale">
        <span>0 · safe</span>
        <span>0.25</span>
        <span>0.5</span>
        <span>0.75</span>
        <span>1 · risky</span>
      </div>
    </div>
  )
}
