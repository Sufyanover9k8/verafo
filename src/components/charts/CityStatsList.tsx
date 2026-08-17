import { CountUpNumber } from '../CountUpNumber'
import { AnimatedBar } from './AnimatedBar'
import type { CityStat } from '../../lib/storeStats'

interface CityStatsListProps {
  cities: CityStat[]
}

/** City revenue list — bars grow in with a stagger, amounts count up. */
export function CityStatsList({ cities }: CityStatsListProps) {
  return (
    <div className="loc-list">
      {cities.slice(0, 5).map((c, i) => (
        <div className={`loc-row${i === 0 ? ' top' : ''}`} key={c.city}>
          <div className="loc-row-head">
            <span className="loc-name">
              {c.city}
              <span className="loc-orders">
                <CountUpNumber value={c.orders} /> order{c.orders === 1 ? '' : 's'}
              </span>
            </span>
            <CountUpNumber className="loc-value" prefix="PKR " value={c.revenue} />
          </div>
          <div className="loc-track">
            <AnimatedBar pct={Math.max(3, c.share)} delay={120 + i * 70} className={`loc-fill${i === 0 ? ' top' : ''}`} />
          </div>
        </div>
      ))}
    </div>
  )
}