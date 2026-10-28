import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCheck, Loader2, MessageCircleMore, ShieldCheck, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'

const inputClass =
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground placeholder:text-muted-foreground md:h-10 md:text-[15px]'

/**
 * Google's mark, inlined.
 *
 * It is drawn rather than fetched: a 4-colour logo from a CDN would be a
 * network request on the first screen of the app, and would flash empty on a
 * slow connection. These are the official four fills.
 */
function GoogleMark({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.14.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

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
  /** Show "send the confirmation link again" next to the notice. */
  const [canResend, setCanResend] = useState(false)
  const [resending, setResending] = useState(false)

  /**
   * Send the confirmation mail again.
   *
   * Supabase rate-limits this endpoint and reports the limit in the error, so the
   * copy has to explain the wait rather than looking like another silent failure.
   */
  async function resendConfirmation() {
    if (!supabase || resending) return
    const address = email.trim()
    if (!address) return
    setResending(true)
    setError(null)
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email: address,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      })
      if (resendErr) {
        const limited = /rate limit|too many|security purposes|after \d+ seconds/i.test(resendErr.message)
        setError(
          limited
            ? 'Verafo can only send a few emails per hour. Wait a few minutes, then try once more.'
            : resendErr.message,
        )
        return
      }
      setNotice(`Confirmation email sent again to ${address}. The link expires in 24 hours.`)
    } finally {
      setResending(false)
    }
  }

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
          : await supabase.auth.signUp({
              email,
              password,
              // The confirmation link must come back to the app, not to the
              // marketing page that now owns `/` — otherwise the session in the
              // link's hash is read by a static HTML page and never reaches the
              // app.
              options: { emailRedirectTo: `${window.location.origin}/dashboard` },
            })
      if (res.error) {
        // A merchant who signed up once and lost the mail lands here on the next
        // attempt. "Email not confirmed" is not a wrong password — say so, and
        // offer to send the link again instead of leaving them stuck.
        if (/email not confirmed|not confirmed/i.test(res.error.message)) {
          setNotice('That account exists but is not confirmed yet. Send yourself a fresh confirmation link below.')
          setCanResend(true)
          return
        }
        setError(res.error.message)
        return
      }
      if (mode === 'up' && !res.data.session) {
        /*
         * Supabase hides whether an address is already registered: an existing
         * email comes back with an empty `identities` array and no session. It
         * used to read as success — "check your email" — which is a dead end for
         * a merchant who already has the account (and the mail never arrives).
         */
        const alreadyRegistered = Array.isArray(res.data.user?.identities) && res.data.user!.identities!.length === 0
        if (alreadyRegistered) {
          setNotice('That email already has a Verafo account. Sign in below — or use “Forgot password?” if you never set one.')
          setMode('in')
          return
        }
        toast.push({ kind: 'success', title: 'Account created', detail: 'We emailed you a link. Click it, then sign in.' })
        setNotice('Check your email to confirm your account — the link expires in 24 hours. If it does not arrive in a minute, send it again below and check spam.')
        setCanResend(true)
        setMode('in')
        return
      }
      navigate('/dashboard')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Google sign-in, for both modes.
   *
   * OAuth has no sign-in/sign-up distinction: Google returns an identity and
   * Supabase creates the account on the first visit. `redirectTo` must be a path
   * the app owns — `/dashboard`, never the bare origin, because `/` is served as
   * static marketing HTML since the site/app split, and that page cannot read the
   * `#access_token` Google comes back with. The browser leaves this page
   * entirely on success, so the spinner stays until it does rather than
   * flickering back to idle.
   */
  async function signInWithGoogle() {
    if (!supabase) {
      setError('Supabase is not configured, so Google sign-in is unavailable.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (oauthErr) {
      setBusy(false)
      const notEnabled = /not enabled|unsupported provider|provider is not enabled/i.test(oauthErr.message)
      setError(
        notEnabled
          ? 'Google sign-in is not switched on yet. Enable the Google provider in Supabase → Authentication → Providers.'
          : oauthErr.message,
      )
    }
  }

  async function sendReset() {    if (!supabase) return
    if (!email.trim()) {
      setError('Enter your email above first, then click "Forgot password?".')
      return
    }
    setBusy(true)
    setError(null)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      // Same reason as the confirmation and OAuth links: the recovery hash has
      // to land inside the app so ResetPassword can read it.
      redirectTo: `${window.location.origin}/dashboard`,
    })
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
          <div className="flex items-center gap-3 rounded-[var(--r-card)] border border-border bg-card px-4 py-3">
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

          <div className="flex items-center gap-3 rounded-[var(--r-card)] border border-border bg-card px-4 py-3">
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

          <div className="flex items-center gap-3 rounded-[var(--r-card)] border border-border bg-card px-4 py-3">
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

          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            disabled={busy}
            className="mt-7 flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-border bg-card text-[14px] font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <GoogleMark />}
            Continue with Google
          </button>

          <div className="relative my-6" aria-hidden="true">
            <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-border" />
            <span className="relative mx-auto block w-fit bg-card px-3 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">
              or
            </span>
          </div>

          <form className="flex flex-col gap-4" onSubmit={submit}>
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
              <div className="space-y-2 rounded-[10px] border border-risk-safe/40 bg-risk-safe-soft px-3 py-2 text-[13px] text-risk-safe-strong">
                <p>{notice}</p>
                {canResend && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <button
                      type="button"
                      className="inline-flex h-11 items-center rounded-[8px] border border-risk-safe/40 bg-card px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60 md:h-8"
                      disabled={resending || !email.trim()}
                      onClick={() => void resendConfirmation()}
                    >
                      {resending ? 'Sending…' : 'Send confirmation email again'}
                    </button>
                    <span className="text-[12px] text-foreground/70">
                      Nothing arriving? Check spam, or mail us at verafo.support@gmail.com.
                    </span>
                  </div>
                )}
              </div>
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
