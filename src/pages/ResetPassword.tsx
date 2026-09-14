import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Icon } from '../components/Icon'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useToast } from '../lib/toast'

/**
 * Shown instead of the normal app when the user arrives via a "reset your
 * password" email link. Supabase's recovery link already creates a real,
 * signed-in session (that's how supabase.auth.updateUser below is allowed to
 * work) — this page's only job is to collect the new password and then let
 * App.tsx's normal routing take over.
 */
export function ResetPassword() {
  const toast = useToast()
  const { clearPasswordRecovery } = useSession()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
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
      setError(updateErr.message)
      return
    }
    setDone(true)
    toast.push({ kind: 'success', title: 'Password updated', detail: "You're signed in with your new password." })
  }

  return (
    <div className="auth-split">
      <aside className="auth-left">
        <div className="auth-wordmark">
          <span className="sidebar-brand-mark">
            <ShieldCheck size={18} strokeWidth={2} />
          </span>
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
              : "You're verified via your reset link. Choose a new password to finish."}
          </p>

          {done ? (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={clearPasswordRecovery}
            >
              <Icon name="arrow-forward" size={17} /> Continue to Verafo
            </button>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <label className="field">
                <span className="field-label">New password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Confirm password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
              </label>

              {error && <span className="field-error">{error}</span>}

              <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
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
