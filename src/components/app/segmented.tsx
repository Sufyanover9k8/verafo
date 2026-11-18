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
      className={cn('inline-flex items-center rounded-full border border-border bg-muted/70 p-1', className)}
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
              'h-11 rounded-full border-0 px-3.5 text-[13px] font-medium transition-colors md:h-8',
              active
                ? 'bg-[var(--cta-bg)] text-[var(--cta-fg)]'
                : 'bg-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
