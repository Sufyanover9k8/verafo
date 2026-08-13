import type { ReactNode } from 'react'

interface TooltipProps {
  label: ReactNode
  children: ReactNode
  below?: boolean
}

export function Tooltip({ label, children, below }: TooltipProps) {
  return (
    <span className="tooltip-wrap" tabIndex={0}>
      {children}
      <span className={`tooltip-bubble${below ? ' below' : ''}`} role="tooltip">
        {label}
      </span>
    </span>
  )
}
