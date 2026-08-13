interface SkeletonProps {
  width?: number | string
  height?: number | string
  className?: string
}

export function Skeleton({ width, height = 14, className }: SkeletonProps) {
  return <div className={`skeleton ${className ?? ''}`} style={{ width, height }} aria-hidden="true" />
}
