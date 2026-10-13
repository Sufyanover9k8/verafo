import type { ReactNode } from 'react'

/**
 * The page frame every screen uses: one column, one gap scale.
 * The Dashboard established this spacing; this keeps the other pages in step
 * without every page repeating the classes.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>
}
