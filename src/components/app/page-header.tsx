import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

/** Title block used at the top of every page: one heading, one quiet line, actions on the right. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
