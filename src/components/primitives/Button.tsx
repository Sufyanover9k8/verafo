import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ')} {...rest} />
}
