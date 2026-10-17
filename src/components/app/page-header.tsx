import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

/**
 * Title block used at the top of every page: one heading, one quiet line,
 * actions on the right.
 *
 * The heading and its line are deliberately separated by a real gap rather
 * than a hairline. At `mt-1.5` the two read as a single cramped block,
 * especially when the title is a greeting sitting next to page controls;
 * `mt-2.5` keeps them one unit while letting the heading breathe. A heading
 * that wraps also needs its line to sit closer to the *last* line of the
 * heading than to the block above, which the leading and margin together give.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-bold tracking-tight text-foreground sm:text-[26px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
