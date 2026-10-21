import type { HTMLAttributes } from 'react'
import { useCountUp } from '../lib/countup'

interface CountUpNumberProps extends HTMLAttributes<HTMLSpanElement> {
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
}

/** Eased count-up number that animates on mount. Respects reduced motion. */
export function CountUpNumber({ value, prefix = '', suffix = '', decimals = 0, ...rest }: CountUpNumberProps) {
  const counted = useCountUp(value, 700, decimals)
  const formatted = counted.toLocaleString('en-PK', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return (
    <span {...rest}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}