import { CountUpNumber } from '../CountUpNumber'
import { AnimatedBar } from './AnimatedBar'
import type { CityStat } from '../../lib/storeStats'

interface CityStatsListProps {
  cities: CityStat[]
}

/** City revenue list — bars grow in with a stagger, amounts count up. */
export function CityStatsList({ cities }: CityStatsListProps) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {cities.slice(0, 5).map((c, i) => (
        <li key={c.city} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="truncate font-medium text-foreground">
              {c.city}
              <span className="ms-2 text-[12px] font-normal text-muted-foreground">
                <CountUpNumber value={c.orders} /> order{c.orders === 1 ? '' : 's'}
              </span>
            </span>
            <CountUpNumber className="shrink-0 font-mono tabular-nums text-muted-foreground" prefix="PKR " value={c.revenue} />
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <AnimatedBar
              pct={Math.max(3, c.share)}
              delay={120 + i * 70}
              className="h-full rounded-full bg-primary"
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
