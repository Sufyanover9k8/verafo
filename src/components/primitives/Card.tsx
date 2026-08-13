import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'raised' | 'flush'
  children: ReactNode
}

export function Card({ variant = 'default', className, children, ...rest }: CardProps) {
  const cls = ['card', variant !== 'default' ? `card--${variant}` : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  )
}
