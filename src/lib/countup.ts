/* countup.ts — eased count-up for numeric displays. Respects reduced motion. */

import { useEffect, useState } from 'react'
import { useTheme } from './theme'

export function useCountUp(target: number, duration = 700, decimals = 0): number {
  const { reducedMotion } = useTheme()
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (reducedMotion) {
      setValue(target)
      return
    }
    const scale = 10 ** decimals
    const start = performance.now()
    let id = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(target * eased * scale) / scale)
      if (p < 1) id = requestAnimationFrame(step)
      else setValue(target)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [target, duration, reducedMotion, decimals])

  return value
}