import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The three states every card has to handle, in one place.
 *
 * - `loading`  → a skeleton shaped like the real content
 * - `error`    → a plain line plus a Retry button that re-runs the existing load
 * - `empty`    → one plain line plus one action
 *
 * Nothing here invents data; it only decides what to show.
 */
interface CardStateProps {
  loading?: boolean
  /** `true` for a plain default message, or a string for a specific one. */
  error?: string | boolean | null
  onRetry?: () => void
  empty?: boolean
  /** The one line shown when the list is empty. */
  emptyText?: string
  /** The one action shown when the list is empty. */
  emptyAction?: { label: string; to: string } | null
  /** Skeleton height used while loading. */
  skeletonHeight?: number
  children: ReactNode
}

function EmptyLine({ text, action }: { text: string; action?: { label: string; to: string } | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {action && (
        <Button asChild variant="outline" size="sm" className="h-11 px-4 md:h-9">
          <a href={action.to}>{action.label}</a>
        </Button>
      )}
    </div>
  )
}

export function CardState({
  loading,
  error,
  onRetry,
  empty,
  emptyText = 'Nothing here yet.',
  emptyAction = null,
  skeletonHeight = 160,
  children,
}: CardStateProps) {
  if (loading) return <Skeleton className="w-full" style={{ height: skeletonHeight }} />

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-3 rounded-[10px] border border-risk-high/30 bg-risk-high-soft px-4 py-6 text-center"
      >
        <p className="text-sm text-foreground">
          {typeof error === 'string' ? error : 'Could not load this.'}
        </p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="h-11 px-4 md:h-9">
            Retry
          </Button>
        )}
      </div>
    )
  }

  if (empty) return <EmptyLine text={emptyText} action={emptyAction} />

  return <>{children}</>
}
