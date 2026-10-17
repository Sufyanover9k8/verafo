import type { ReactNode } from 'react'

/**
 * The page frame every screen uses: one column, one gap scale.
 * The Dashboard established this spacing; this keeps the other pages in step
 * without every page repeating the classes.
 *
 * gap-5 (20px) rather than 24px: with the type scale settled at 14px, 24px
 * between every block read as loose rather than generous.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>
}
