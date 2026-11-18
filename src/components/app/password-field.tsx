import { useId, useState, type ChangeEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface PasswordFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  /** Forwarded to the input so password managers still work. */
  autoComplete?: string
  placeholder?: string
  required?: boolean
  minLength?: number
  name?: string
}

/**
 * Password input with a show/hide toggle.
 *
 * The label is associated by `htmlFor` rather than wrapping the whole field,
 * because a <button> nested inside a <label> makes the browser forward the
 * click to the input as well — the toggle would fight the focus ring.
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder = '••••••••',
  required,
  minLength,
  name,
}: PasswordFieldProps) {
  const id = useId()
  const [shown, setShown] = useState(false)

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-password">
        <input
          id={id}
          name={name}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button
          type="button"
          className="field-password-toggle"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          title={shown ? 'Hide password' : 'Show password'}
        >
          {shown ? <EyeOff size={17} strokeWidth={2} /> : <Eye size={17} strokeWidth={2} />}
        </button>
      </div>
    </div>
  )
}
