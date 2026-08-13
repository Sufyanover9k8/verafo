import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  hint?: string
  error?: string | null
  /** Use the monospace face (phone numbers, identifiers). */
  mono?: boolean
  icon?: ReactNode
}

export function Input({ label, hint, error, mono, icon, id, className, ...rest }: InputProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <label className="field" htmlFor={fieldId}>
      {label && (
        <span className="field-label">
          {icon && <span className="field-icon">{icon}</span>}
          {label}
        </span>
      )}
      <input id={fieldId} className={[mono ? 'mono' : '', className].filter(Boolean).join(' ')} {...rest} />
      {error ? (
        <span className="field-error">{error}</span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </label>
  )
}
