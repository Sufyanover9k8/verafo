import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A number that counts up to its value once, then stays put.
 *
 * No animation library: a short requestAnimationFrame loop with an
 * ease-out curve. When the visitor prefers reduced motion, or has turned
 * motion off in Settings, the final value is shown immediately.
 */
interface CountUpProps {
  value: number
  /** Decimal places to show. */
  decimals?: number
  /** Written before the number, for example "PKR ". */
  prefix?: string
  /** Written after the number. */
  suffix?: string
  /** Milliseconds. Keep it short — this is a glance, not a show. */
  duration?: number
  className?: string
}

function motionOff(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  if (document.documentElement.dataset.motion === 'off') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export function CountUp({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 700,
  className,
}: CountUpProps) {
  const target = Number.isFinite(value) ? value : 0
  const [shown, setShown] = useState(() => (motionOff() ? target : 0))
  const frame = useRef<number | null>(null)
  const from = useRef(0)

  useEffect(() => {
    if (motionOff()) {
      setShown(target)
      return
    }
    const start = performance.now()
    const origin = from.current
    const delta = target - origin

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setShown(origin + delta * easeOut(t))
      if (t < 1) frame.current = requestAnimationFrame(tick)
      else from.current = target
    }
    frame.current = requestAnimationFrame(tick)

    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current)
      from.current = target
    }
  }, [target, duration])

  const text = shown.toLocaleString('en-PK', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {text}
      {suffix}
    </span>
  )
}
