import { Icon } from '@/components/Icon'

export type ViewMode = 'list' | 'cards'

/**
 * List/cards switch. Small enough to be shared, and the caller owns where the
 * choice is remembered so each page can keep its own preference.
 */
export function ViewToggle({
  view,
  onChange,
  label = 'Order view',
}: {
  view: ViewMode
  onChange: (next: ViewMode) => void
  label?: string
}) {
  return (
    <div
      className="inline-flex items-center rounded-[10px] border border-border bg-card p-0.5"
      role="group"
      aria-label={label}
    >
      {(['list', 'cards'] as ViewMode[]).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          onClick={() => onChange(option)}
          title={option === 'list' ? 'List view' : 'Card view'}
          aria-label={option === 'list' ? 'List view' : 'Card view'}
          className={`inline-flex h-8 w-9 items-center justify-center rounded-[8px] transition-colors ${
            view === option
              ? 'bg-muted text-foreground'
              : 'bg-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon name={option} size={15} />
        </button>
      ))}
    </div>
  )
}
