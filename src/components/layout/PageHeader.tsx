import { Icon } from '../Icon'

interface PageHeaderProps {
  title: string
  subtitle?: string
  icon: string
  actions?: React.ReactNode
}

export function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <header className="page-head">
      <div className="page-title-row">
        {icon && (
          <div className="page-icon">
            <Icon name={icon} size={20} />
          </div>
        )}
        <div className="grow">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="cluster">{actions}</div>}
      </div>
    </header>
  )
}
