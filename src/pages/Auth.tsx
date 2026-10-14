import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCheck, Loader2, MessageCircleMore, ShieldCheck, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'

const inputClass =
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground placeholder:text-muted-foreground md:h-10 md:text-[15px]'

export function Auth() {
  const navigate = useNavigate()
  const toast = useToast()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res =
        mode === 'in'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password })
      if (res.error) {
        setError(res.error.message)
        return
      }
      if (mode === 'up' && !res.data.session) {
        toast.push({ kind: 'success', title: 'Account created', detail: 'We emailed you a link. Click it, then sign in.' })
        setNotice('Check your email to confirm your account')
        setMode('in')
        return
      }
      navigate('/')
    } finally {
      setBusy(false)
    }
  }

  async function sendReset() {
    if (!supabase) return
    if (!email.trim()) {
      setError('Enter your email above first, then click "Forgot password?".')
      return
    }
    setBusy(true)
    setError(null)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim())
    setBusy(false)
    if (resetErr) {
      setError(resetErr.message)
      return
    }
    setResetSent(true)
    toast.push({
      kind: 'success',
      title: 'Reset link sent',
      detail: `Check ${email.trim()} for a password reset link.`,
    })
  }

  return (
    /* Two panels: the pitch and the form. Side by side from lg up, stacked
       below it so the form is the first thing a phone shows. */
    <div className="grid min-h-screen lg:grid-cols-[48fr_52fr]">
      <aside className="flex flex-col gap-10 bg-muted bg-[radial-gradient(70%_50%_at_100%_0%,color-mix(in_srgb,var(--teal)_18%,transparent),transparent_62%),radial-gradient(50%_45%_at_0%_100%,color-mix(in_srgb,var(--teal)_10%,transparent),transparent_62%)] p-6 sm:p-10 lg:p-12">
        <div className="flex items-center gap-3">
          <img src="/verafo-logo.png" alt="Verafo" className="size-8 shrink-0 object-contain" />
          <span className="text-[15px] font-semibold text-foreground">Verafo</span>
        </div>

        <div>
          <h1 className="max-w-[17ch] text-[28px] leading-[1.14] font-extrabold tracking-[-0.038em] text-foreground sm:text-[34px] lg:text-[40px]">
            Know who you&rsquo;re shipping to. <em className="text-primary-text italic">Before</em> you ship.
          </h1>
          <p className="mt-3 max-w-[40ch] text-[15px] text-muted-foreground">
            Every Cash-on-Delivery order gets a risk verdict before it leaves your
            warehouse — so you stop guessing which orders will bounce back.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-[16px] border border-border bg-card px-4 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground">
              <ShieldCheck size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-foreground">Buyer risk verdict</div>
              <div className="mt-px text-[12.5px] text-muted-foreground">Scored the moment an order comes in</div>
            </div>
            <span className="shrink-0 rounded-full bg-risk-safe-soft px-2.5 py-0.5 text-[11.5px] font-bold text-risk-safe-strong">
              LOW RISK
            </span>
          </div>

          <div className="flex items-center gap-3 rounded-[16px] border border-border bg-card px-4 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-warning text-foreground">
              <ShoppingBag size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-foreground">COD hidden automatically</div>
              <div className="mt-px text-[12.5px] text-muted-foreground">For your highest-risk buyers only</div>
            </div>
            <span className="shrink-0 rounded-full bg-risk-high-soft px-2.5 py-0.5 text-[11.5px] font-bold text-risk-high-strong line-through">
              Cash on Delivery
            </span>
          </div>

          <div className="flex items-center gap-3 rounded-[16px] border border-border bg-card px-4 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-success text-primary-foreground">
              <MessageCircleMore size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-foreground">Post-checkout confirmation</div>
              <div className="mt-px text-[12.5px] text-muted-foreground">Hold borderline orders until the buyer confirms</div>
            </div>
          </div>
        </div>

        <span className="mt-auto inline-flex items-center gap-2 self-start rounded-full border border-border bg-card px-4 py-2 text-[12.5px] text-muted-foreground">
          <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" /> Built for Pakistan&rsquo;s Cash-on-Delivery sellers
        </span>
      </aside>

      <main className="flex items-center justify-center bg-background p-4 sm:p-8">
        <div className="w-full max-w-[400px] rounded-[16px] border border-border bg-card p-6 shadow-3 sm:p-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-[28px]">
            {mode === 'in' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {mode === 'in'
              ? 'Sign in to see your buyer risk profiles and the verdict for today.'
              : 'Create an account to start scoring buyers before you ship.'}
          </p>

          <form className="mt-8 flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-email" className="text-[13px] font-medium text-muted-foreground">
                Email
              </Label>
              <input
                id="auth-email"
                className={inputClass}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@store.com"
                autoComplete="email"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-password" className="text-[13px] font-medium text-muted-foreground">
                Password
              </Label>
              <input
                id="auth-password"
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                required
              />
            </div>

            {mode === 'in' && (
              <Button
                type="button"
                variant="ghost"
                className="h-11 self-end px-2 text-[13px] font-semibold text-primary-text hover:bg-transparent hover:underline md:h-9"
                onClick={() => void sendReset()}
                disabled={busy || resetSent}
              >
                {resetSent ? 'Reset link sent — check your email' : 'Forgot password?'}
              </Button>
            )}

            {notice && (
              <p className="rounded-[10px] border border-risk-safe/40 bg-risk-safe-soft px-3 py-2 text-[13px] text-risk-safe-strong">
                {notice}
              </p>
            )}

            {error && (
              <p
                id="auth-error"
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
              aria-describedby={error ? 'auth-error' : undefined}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Working…
                </>
              ) : mode === 'in' ? (
                <>
                  <ArrowRight className="size-4" aria-hidden="true" /> Sign in
                </>
              ) : (
                <>
                  <CheckCheck className="size-4" aria-hidden="true" /> Create account
                </>
              )}
            </Button>

            <p className="text-center text-[13px] text-muted-foreground">
              {mode === 'in' ? (
                <>
                  New to Verafo?{' '}
                  <button
                    className="font-semibold text-primary-text underline-offset-4 hover:underline"
                    type="button"
                    onClick={() => setMode('up')}
                  >
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    className="font-semibold text-primary-text underline-offset-4 hover:underline"
                    type="button"
                    onClick={() => setMode('in')}
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </form>
        </div>
      </main>
    </div>
  )
}
