import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'

export type Trend = 'up' | 'down' | 'flat'

interface StatProps {
  label: string
  value: ReactNode
  /** Short line under the number, for example "vs yesterday (13)". */
  hint?: ReactNode
  trend?: Trend
  /** Whether "up" is good news. Refusals going up is bad news, for example. */
  upIsGood?: boolean
}

function Stat({ label, value, hint, trend, upIsGood = true }: StatProps) {
  const good = trend === 'flat' || trend == null ? null : (trend === 'up') === upIsGood
  const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-5 py-4">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      {(hint != null || trend) && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {trend && (
            <Icon
              className={cn('size-3.5', good === true && 'text-success', good === false && 'text-destructive')}
              aria-hidden="true"
            />
          )}
          <span className="truncate">{hint}</span>
        </span>
      )}
    </div>
  )
}

/** Four (or so) headline numbers in one card, divided by hairlines. Calmer than a row of separate tiles. */
export function StatStrip({ items }: { items: StatProps[] }) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="grid grid-cols-2 divide-x divide-y divide-border lg:grid-cols-4 lg:divide-y-0">
        {items.map((s) => (
          <Stat key={s.label} {...s} />
        ))}
      </div>
    </Card>
  )
}
