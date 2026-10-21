import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A score ring that fills to the buyer's risk score.
 *
 * Pure SVG and CSS — no animation library. The fill animates once on
 * mount (and again if the score changes). When the visitor prefers
 * reduced motion, or has switched motion off in Settings, the ring is
 * simply drawn at its final value with no transition.
 *
 * Colours come from the caller as a token class so the ring always
 * matches the risk band shown next to it.
 */
interface RiskRingProps {
  /** 0–1. Anything outside is clamped. */
  score: number
  /** Pixel diameter. */
  size?: number
  /** Token class for the filled arc, for example "text-risk-high". */
  toneClass: string
  /** Big text in the middle. Defaults to the score to two decimals. */
  label?: string
  /** Small text under the number. */
  caption?: string
  className?: string
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  if (document.documentElement.dataset.motion === 'off') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function RiskRing({
  score,
  size = 132,
  toneClass,
  label,
  caption,
  className,
}: RiskRingProps) {
  const safe = Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0))
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? safe : 0))

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(safe)
      return
    }
    // One frame at 0, then the real value, so the transition runs.
    setShown(0)
    const id = window.setTimeout(() => setShown(safe), 40)
    return () => window.clearTimeout(id)
  }, [safe])

  const stroke = 12
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - shown)

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Risk score ${safe.toFixed(2)} of 1`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="currentColor"
          className={toneClass}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            transition: 'stroke-dashoffset 900ms cubic-bezier(.16,1,.3,1)',
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="font-mono text-[26px] leading-none font-semibold tabular-nums text-foreground">
          {label ?? safe.toFixed(2)}
        </span>
        {caption && <span className="text-[11px] text-muted-foreground">{caption}</span>}
      </div>
    </div>
  )
}
