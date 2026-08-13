import { Icon } from './Icon'
import { useCountUp } from '../lib/countup'

export function StatCard({ icon, label, value, tint }: { icon: string; label: string; value: string | number; tint?: string }) {
  const numeric = typeof value === 'number' ? value : null
  const counted = useCountUp(numeric ?? 0)
  const display = numeric == null ? value : counted

  const custom = tint ? { color: tint, background: `${tint}1f` } : undefined
  return (
    <div className="stat-card spotlight">
      <div className={`stat-icon${tint ? '' : ' default'}`} style={custom}>
        <Icon name={icon} size={20} />
      </div>
      <div>
        <div className="stat-value">{display}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}