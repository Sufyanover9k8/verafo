import { useCallback, useEffect, useRef, useState } from 'react'
import { useLayoutTick } from '../../lib/motion'

/**
 * Returns a callback ref and a remount key. The key bumps shortly after the
 * measured element's width settles after a resize of at least `threshold` px,
 * and again whenever the app shell layout changes (sidebar collapse). Pass the
 * key to a chart component so it remounts and replays its draw-in animation
 * whenever its container expands, shrinks, or the layout around it changes.
 */
export function useAnimatedWidth<T extends HTMLElement>(threshold = 12) {
  const ref = useRef<T | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [key, setKey] = useState(0)
  const layoutTick = useLayoutTick()

  const animateRef = useCallback(
    (el: T | null) => {
      roRef.current?.disconnect()
      roRef.current = null
      ref.current = el
      if (!el) return
      let last = el.clientWidth
      let timer: number | undefined
      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? last
        if (Math.abs(w - last) < threshold) return
        last = w
        if (timer) window.clearTimeout(timer)
        timer = window.setTimeout(() => setKey((k) => k + 1), 150)
      })
      ro.observe(el)
      roRef.current = ro
    },
    [threshold],
  )

  useEffect(() => () => roRef.current?.disconnect(), [])

  return { ref: animateRef, key: `${key}:${layoutTick}` }
}