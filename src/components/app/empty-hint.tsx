import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A quiet, consistent placeholder for a card that has nothing in it yet.
 * One plain sentence, and at most one action.
 */
interface EmptyHintProps {
  title: string
  detail?: string
  /** One action, usually a link wrapped by the caller. */
  action?: ReactNode
  /** Marks the block as a large centre-of-card state. */
  large?: boolean
  className?: string
}

export function EmptyHint({ title, detail, action, large = false, className }: EmptyHintProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        large ? 'py-12' : 'py-8',
        className,
      )}
    >
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      {detail && <p className="max-w-md text-[13.5px] text-muted-foreground">{detail}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
