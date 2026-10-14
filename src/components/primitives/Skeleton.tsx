import { cn } from '@/lib/utils'

interface SkeletonProps {
  width?: number | string
  height?: number | string
  className?: string
}

/**
 * The one loading placeholder. Token-driven, so it follows the theme, and
 * hidden from assistive tech — the surrounding region owns the busy state.
 */
export function Skeleton({ width, height = 14, className }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-[6px] bg-muted', className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}
