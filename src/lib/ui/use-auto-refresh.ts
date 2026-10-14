import { useEffect, useRef, useState } from 'react'

/**
 * Re-run a loader on a timer, but only while the tab is actually visible.
 *
 * - stops while the tab is hidden, and runs once on the way back
 * - never starts a second run while one is still going
 * - the loader is read from a ref, so a new function identity does not
 *   restart the timer
 * - `enabled` lets the caller pause it
 */
export function useAutoRefresh(
  load: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
): void {
  const loadRef = useRef(load)
  const running = useRef(false)

  // Written in an effect rather than during render, so React never sees a ref
  // change while rendering. It lands before the timer effect below can fire.
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return

    let timer: number | null = null

    async function run() {
      if (running.current) return
      running.current = true
      try {
        await loadRef.current()
      } finally {
        running.current = false
      }
    }

    function start() {
      if (timer == null) timer = window.setInterval(() => void run(), intervalMs)
    }

    function stop() {
      if (timer != null) {
        window.clearInterval(timer)
        timer = null
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void run()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, enabled])
}

/**
 * A ticking clock for "Updated 2 minutes ago" labels. Pass `active = false`
 * to stop the timer when nothing is showing the label.
 */
export function useNowTicker(active = true, everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [active, everyMs])
  return now
}
