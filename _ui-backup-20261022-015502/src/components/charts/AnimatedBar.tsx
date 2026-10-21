import { useCountUp } from '../../lib/countup'

interface AnimatedBarProps {
  /** Target width percentage (0–100). */
  pct: number
  className?: string
  /** Delay (ms) before the bar starts growing. */
  delay?: number
}

/** JS-driven width grower — animates even when OS prefers-reduced-motion kills CSS transitions. */
export function AnimatedBar({ pct, className, delay = 0 }: AnimatedBarProps) {
  const width = useCountUp(pct, 650, 1, delay)
  return <div className={className} style={{ width: `${width}%` }} />
}