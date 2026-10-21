/* countup.ts — eased count-up for numeric displays. Respects reduced motion. */

import { useEffect, useState } from 'react'
import { useTheme } from './theme'

export function useCountUp(target: number, duration = 700, decimals = 0, delay = 0): number {
  const { reducedMotion } = useTheme()
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (reducedMotion) {
      setValue(target)
      return
    }
    const scale = 10 ** decimals
    let raf = 0
    let timer = 0
    const startAfter = () => {
      const start = performance.now()
      const step = (t: number) => {
        const p = Math.min(1, (t - start) / duration)
        const eased = 1 - Math.pow(1 - p, 3)
        setValue(Math.round(target * eased * scale) / scale)
        if (p < 1) raf = requestAnimationFrame(step)
        else setValue(target)
      }
      raf = requestAnimationFrame(step)
    }
    if (delay > 0) timer = window.setTimeout(startAfter, delay)
    else startAfter()
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [target, duration, reducedMotion, decimals, delay])

  return value
}