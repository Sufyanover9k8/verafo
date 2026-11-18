import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PasswordField } from '../components/app/password-field'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useToast } from '../lib/toast'
import { safeNextPath } from '../lib/ui/auth-redirect'

/** Matches the project's Supabase password policy (password_min_length = 8). */
const MIN_PASSWORD_LENGTH = 8

/**
 * Shown instead of the normal app when the user arrives via a "reset your
 * password" email link. Supabase's recovery link already creates a real,
 * signed-in session (that's how supabase.auth.updateUser below is allowed to
 * work) — this page's only job is to collect the new password and then let
 * App.tsx's normal routing take over.
 */
export function ResetPassword() {
  const toast = useToast()
  const navigate = useNavigate()
  const { clearPasswordRecovery } = useSession()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  /** The recovery session is gone (link opened twice, or the tab sat too long). */
  const [expired, setExpired] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setBusy(true)
    setError(null)
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateErr) {
      if (/session|expired|invalid|token/i.test(updateErr.message)) {
        setExpired(true)
        setError('This reset link is no longer valid. Request a new one from the sign-in screen.')
      } else {
        setError(updateErr.message)
      }
      return
    }
    setDone(true)
    toast.push({ kind: 'success', title: 'Password updated', detail: "You're signed in with your new password." })
  }

  function leave() {
    clearPasswordRecovery()
    navigate(safeNextPath(), { replace: true })
  }

  return (
    <div className="auth-split">
      <aside className="auth-left">
        <div className="auth-wordmark">
          <img src="/verafo-logo.png" alt="Verafo" className="size-8 shrink-0 object-contain" />
          <span className="sidebar-brand-name">Verafo</span>
        </div>
        <h1 className="auth-left-title">
          Know who you're shipping to. <em>Before</em> you ship.
        </h1>
        <p className="auth-left-foot">
          Verafo — cash-on-delivery risk intelligence across your connected stores.
        </p>
      </aside>

      <main className="auth-right">
        <div className="auth-form-wrap">
          <h2>Set a new password</h2>
          <p>
            {done
              ? "All set — you're signed in."
              : expired
                ? 'This reset link is no longer valid. Head back to the sign-in screen and request a fresh one.'
                : "You're verified via your reset link. Choose a new password to finish."}
          </p>

          {done ? (
            <button
              type="button"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              onClick={leave}
            >
              <Icon name="arrow-forward" size={17} /> Continue to Verafo
            </button>
          ) : expired ? (
            <button
              type="button"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              onClick={leave}
            >
              <Icon name="arrow-back" size={17} /> Back to sign in
            </button>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <PasswordField
                label="New password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <PasswordField
                label="Confirm password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />

              {error && <span className="field-error">{error}</span>}

              <button type="submit" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50" disabled={busy}>
                {busy ? (
                  <>
                    <Icon name="refresh" size={17} className="spin" /> Working…
                  </>
                ) : (
                  <>
                    <Icon name="checkmark-done" size={17} /> Set new password
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
