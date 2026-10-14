import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface RevealProps {
  children: ReactNode
  className?: string
  delay?: number
  /** Stagger the direct children instead of animating the block as one. */
  stagger?: boolean
  threshold?: number
  rootMargin?: string
}

/**
 * A quiet entrance for content that scrolls into view.
 *
 * Progressive enhancement: the element ships visible and only gains the
 * animation when an IntersectionObserver actually fires. That way content can
 * never be left stuck at `opacity: 0` if the observer never runs, and under
 * `prefers-reduced-motion` the global rule in base.css collapses the animation
 * so it simply appears.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  stagger = false,
  threshold = 0.12,
  rootMargin = '0px 0px -10% 0px',
}: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // The class carries the keyframe; base.css collapses it when the
            // visitor has asked for reduced motion.
            el.classList.add('animate-rise')
            io.disconnect()
          }
        }
      },
      { threshold, rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold, rootMargin])

  return (
    <div
      ref={ref}
      className={cn(
        // A staggered group offsets each direct child; a plain reveal animates
        // the block itself.
        stagger &&
          '[&.animate-rise>*]:animate-rise [&.animate-rise>*:nth-child(2)]:[animation-delay:60ms] [&.animate-rise>*:nth-child(3)]:[animation-delay:120ms] [&.animate-rise>*:nth-child(4)]:[animation-delay:180ms] [&.animate-rise>*:nth-child(n+5)]:[animation-delay:240ms]',
        className,
      )}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}
