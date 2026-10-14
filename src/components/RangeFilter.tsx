import { cn } from '@/lib/utils'

export type RangeDays = 7 | 30

interface RangeFilterProps {
  range: RangeDays
  onChange: (range: RangeDays) => void
}

const OPTIONS: { value: RangeDays; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
]

/**
 * The 7 / 30 day switch. Kept as its own component because the range type is
 * exported from here and the store dashboard reads it.
 */
export function RangeFilter({ range, onChange }: RangeFilterProps) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="inline-flex items-center rounded-[10px] border border-border bg-muted/60 p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={range === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-11 rounded-[10px] px-3 text-[13px] font-medium transition-colors md:h-8',
            range === o.value
              ? 'bg-card text-foreground shadow-1 ring-1 ring-border'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
