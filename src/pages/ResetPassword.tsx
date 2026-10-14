import { useState, type FormEvent } from 'react'
import { ArrowRight, CheckCheck, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useToast } from '../lib/toast'

const inputClass =
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground placeholder:text-muted-foreground md:h-10 md:text-[15px]'

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
    /* Same two-panel shape as the sign-in screen: pitch on the left, the one
       task that matters on the right. Stacked below lg. */
    <div className="grid min-h-screen lg:grid-cols-[48fr_52fr]">
      <aside className="flex flex-col gap-10 bg-muted bg-[radial-gradient(70%_50%_at_100%_0%,color-mix(in_srgb,var(--teal)_18%,transparent),transparent_62%),radial-gradient(50%_45%_at_0%_100%,color-mix(in_srgb,var(--teal)_10%,transparent),transparent_62%)] p-6 sm:p-10 lg:p-12">
        <div className="flex items-center gap-3">
          <img src="/verafo-logo.png" alt="Verafo" className="size-8 shrink-0 object-contain" />
          <span className="text-[15px] font-semibold text-foreground">Verafo</span>
        </div>
        <h1 className="max-w-[17ch] text-[28px] leading-[1.14] font-extrabold tracking-[-0.038em] text-foreground sm:text-[34px] lg:text-[40px]">
          Know who you&rsquo;re shipping to. <em className="text-primary-text italic">Before</em> you ship.
        </h1>
        <p className="text-[12.5px] text-muted-foreground">
          Verafo — cash-on-delivery risk intelligence across your connected stores.
        </p>
      </aside>

      <main className="flex items-center justify-center bg-background p-4 sm:p-8">
        <div className="w-full max-w-[400px] rounded-[16px] border border-border bg-card p-6 shadow-3 sm:p-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-[28px]">Set a new password</h2>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {done
              ? "All set — you're signed in."
              : "You're verified via your reset link. Choose a new password to finish."}
          </p>

          {done ? (
            <Button
              type="button"
              size="lg"
              className="mt-8 h-12 w-full gap-2 rounded-full text-[15px] font-semibold"
              onClick={clearPasswordRecovery}
            >
              <ArrowRight className="size-4" aria-hidden="true" /> Continue to Verafo
            </Button>
          ) : (
            <form className="mt-8 flex flex-col gap-4" onSubmit={submit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reset-password" className="text-[13px] font-medium text-muted-foreground">
                  New password
                </Label>
                <input
                  id="reset-password"
                  className={inputClass}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reset-confirm" className="text-[13px] font-medium text-muted-foreground">
                  Confirm password
                </Label>
                <input
                  id="reset-confirm"
                  className={inputClass}
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
              </div>

              {error && (
                <p
                  id="reset-error"
                  role="alert"
                  className="rounded-[10px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive-strong"
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                className="h-12 w-full gap-2 rounded-full text-[15px] font-semibold"
                disabled={busy}
                aria-describedby={error ? 'reset-error' : undefined}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Working…
                  </>
                ) : (
                  <>
                    <CheckCheck className="size-4" aria-hidden="true" /> Set new password
                  </>
                )}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
