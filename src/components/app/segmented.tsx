import { cn } from '@/lib/utils'

interface SegmentedProps<T extends string | number> {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  ariaLabel: string
  className?: string
}

/** A compact either/or switch (for example 7 days / 30 days). */
export function Segmented<T extends string | number>({ value, onChange, options, ariaLabel, className }: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center rounded-lg border bg-muted/60 p-0.5', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-7 rounded-md border-0 bg-transparent px-3 text-xs font-medium transition-colors',
              active ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
