import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircleMore, ShieldCheck, ShoppingBag } from 'lucide-react'
import { Icon } from '../components/Icon'
import { PasswordField } from '../components/app/password-field'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import {
  authRedirect,
  clearAuthParams,
  getAuthLinkError,
  LOGIN_PATH,
  readAuthLinkError,
  RESET_PASSWORD_PATH,
  safeNextPath,
} from '../lib/ui/auth-redirect'

/** Matches the project's Supabase password policy (password_min_length = 8). */
const MIN_PASSWORD_LENGTH = 8

/** Supabase sends at most one mail per address per minute. */
const RESET_COOLDOWN_SECONDS = 60

function isAlreadyRegistered(message: string): boolean {
  return /already registered|already been registered|user already exists/i.test(message)
}

/** Turn raw Supabase wording into something a merchant can act on. */
function friendlyAuthError(message: string): string {
  if (/rate limit|only request this after|too many requests|for security purposes/i.test(message)) {
    return 'Too many emails requested for this address. Wait a minute, then try again.'
  }
  if (/fetch|network|failed to fetch/i.test(message)) {
    return "We couldn't reach Verafo. Check your connection and try again."
  }
  return message
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
  /** Set when Supabase says the address has an account but no confirmed email. */
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  /** Seconds until the reset email may be requested again (Supabase's limit). */
  const [cooldown, setCooldown] = useState(0)

  // A confirmation or reset link that is expired/used comes back as
  // #error=...&error_code=otp_expired. Say so, instead of looking like a
  // mystery sign-out on a page that otherwise appears fine. getAuthLinkError()
  // was captured at page load, before the router could strip the hash.
  useEffect(() => {
    const linkError = getAuthLinkError() ?? readAuthLinkError(window.location.hash, window.location.search)
    if (linkError) {
      setError(
        linkError.code === 'otp_expired'
          ? 'That email link has expired or was already used. Request a new one below.'
          : linkError.description,
      )
      clearAuthParams()
    }
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  function changeEmail(next: string) {
    setEmail(next)
    setError(null)
    setNotice(null)
    setNeedsConfirm(false)
    // A new address deserves its own attempt: clear the "already sent" state
    // and the rate-limit cooldown instead of leaving the button dead.
    setResetSent(false)
    setCooldown(0)
  }

  function switchMode(next: 'in' | 'up') {
    setMode(next)
    setError(null)
    setNotice(null)
    setNeedsConfirm(false)
    setResetSent(false)
    setCooldown(0)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.')
      return
    }
    const address = email.trim()
    if (mode === 'up' && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    setBusy(true)
    setError(null)
    setNeedsConfirm(false)
    try {
      if (mode === 'in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: address,
          password,
        })
        if (signInError) {
          if (
            signInError.code === 'email_not_confirmed' ||
            /email not confirmed/i.test(signInError.message)
          ) {
            setNeedsConfirm(true)
            setError('This account still needs email confirmation. Send yourself a fresh link below.')
          } else {
            setError(friendlyAuthError(signInError.message))
          }
          return
        }
        navigate(safeNextPath())
        return
      }

      // Sign-up: Supabase emails a confirmation link when confirmations are on,
      // and returns no session until that link is clicked. Only a session (i.e.
      // confirmations disabled project-side) may go straight into the app.
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: address,
        password,
        options: { emailRedirectTo: authRedirect(LOGIN_PATH) },
      })
      if (signUpError) {
        setError(
          isAlreadyRegistered(signUpError.message)
            ? 'That email already has an account. Sign in, or use "Forgot password?" to reset it.'
            : friendlyAuthError(signUpError.message),
        )
        return
      }

      // Supabase deliberately hides "this email is taken": an existing account
      // comes back as a fake user with no identities and NO email is sent. Say
      // so plainly instead of promising a confirmation link that never arrives.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        setError(
          'That email already has an account. Sign in, or use "Forgot password?" to reset it.',
        )
        return
      }

      if (data.session) {
        navigate(safeNextPath())
        return
      }
      setPassword('')
      setMode('in')
      setNotice(`Check ${address} for the confirmation link, then sign in.`)
      toast.push({
        kind: 'success',
        title: 'Account created',
        detail: 'Confirm your email address to finish signing up.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function resendConfirmation() {
    if (!supabase) return
    const address = email.trim()
    if (!address) {
      setError('Enter your email address first.')
      return
    }
    setConfirmBusy(true)
    setError(null)
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: address,
      options: { emailRedirectTo: authRedirect(LOGIN_PATH) },
    })
    setConfirmBusy(false)
    if (resendError) {
      setError(friendlyAuthError(resendError.message))
      return
    }
    setNotice(`New confirmation link sent to ${address}.`)
    toast.push({ kind: 'success', title: 'Confirmation email sent', detail: address })
  }

  async function sendReset() {
    if (!supabase) return
    const address = email.trim()
    if (!address) {
      setError('Enter your email above first, then click "Forgot password?".')
      return
    }
    setBusy(true)
    setError(null)
    // redirectTo must be on the Supabase allow-list; it is built from the
    // current origin so localhost and production both work.
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: authRedirect(RESET_PASSWORD_PATH),
    })
    setBusy(false)
    if (resetErr) {
      setError(friendlyAuthError(resetErr.message))
      return
    }
    setResetSent(true)
    setCooldown(RESET_COOLDOWN_SECONDS)
    setNotice(`Reset link sent to ${address}. Open it on this device to choose a new password.`)
    toast.push({
      kind: 'success',
      title: 'Reset link sent',
      detail: `Check ${address} for a password reset link.`,
    })
  }

  return (
    <div className="auth-split">
      <aside className="auth-left">
        <div className="auth-wordmark">
          <img src="/verafo-logo.png" alt="Verafo" className="size-8 shrink-0 object-contain" />
          <span className="sidebar-brand-name">Verafo</span>
        </div>

        <div>
          <h1 className="auth-left-title">
            Know who you're shipping to. <em>Before</em> you ship.
          </h1>
        </div>

        <div className="auth-features">
          <div className="auth-feature-card">
            <span className="auth-feature-icon blue">
              <ShieldCheck size={18} strokeWidth={2} />
            </span>
            <div>
              <div className="auth-feature-title">Buyer risk verdict</div>
              <div className="auth-feature-sub">Scored the moment an order comes in</div>
            </div>
            <span className="auth-feature-pill safe">LOW RISK</span>
          </div>

          <div className="auth-feature-card">
            <span className="auth-feature-icon amber">
              <ShoppingBag size={18} strokeWidth={2} />
            </span>
            <div>
              <div className="auth-feature-title">COD hidden automatically</div>
              <div className="auth-feature-sub">For your highest-risk buyers only</div>
            </div>
            <span className="auth-feature-pill risk">Cash on Delivery</span>
          </div>

          <div className="auth-feature-card">
            <span className="auth-feature-icon safe">
              <MessageCircleMore size={18} strokeWidth={2} />
            </span>
            <div>
              <div className="auth-feature-title">Post-checkout confirmation</div>
              <div className="auth-feature-sub">Hold borderline orders until the buyer confirms</div>
            </div>
          </div>
        </div>

        <span className="auth-trust-badge">
          <ShieldCheck size={14} strokeWidth={2} /> Built for Pakistan's Cash-on-Delivery sellers
        </span>
      </aside>

      <main className="auth-right">
        <div className="auth-form-card">
        <div className="auth-form-wrap">
          <h2>{mode === 'in' ? 'Welcome back' : 'Create your account'}</h2>

          <form className="auth-form" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => changeEmail(e.target.value)}
                placeholder="you@store.com"
                autoComplete="email"
                required
              />
            </label>
            <PasswordField
              label="Password"
              value={password}
              onChange={(v) => {
                setPassword(v)
                setError(null)
              }}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              required
            />

            {mode === 'in' && (
              <button
                type="button"
                // No background utility on purpose: without an explicit reset the
                // browser paints <button> with its default grey chrome.
                className="inline-flex h-9 items-center justify-end self-end rounded-[10px] border-0 bg-transparent px-0 text-[13px] font-semibold text-primary-text underline-offset-4 shadow-none hover:underline disabled:opacity-60"
                onClick={() => void sendReset()}
                disabled={busy || cooldown > 0}
              >
                {cooldown > 0
                  ? `Try again in ${cooldown}s`
                  : resetSent
                    ? 'Resend reset link'
                    : 'Forgot password?'}
              </button>
            )}

            {notice && (
              <p className="rounded-[10px] border border-risk-safe/40 bg-risk-safe-soft px-3 py-2 text-[13px] text-risk-safe-strong">
                {notice}
              </p>
            )}

            {error && <span className="field-error">{error}</span>}

            {needsConfirm && (
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-[10px] border border-border bg-background px-3 text-[13px] font-semibold text-primary-text disabled:opacity-60"
                onClick={() => void resendConfirmation()}
                disabled={confirmBusy || busy}
              >
                {confirmBusy ? (
                  <>
                    <Icon name="refresh" size={15} className="spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Icon name="mail" size={15} /> Resend confirmation email
                  </>
                )}
              </button>
            )}

            {mode === 'up' && (
              <p className="text-[12px] text-muted-foreground">
                At least {MIN_PASSWORD_LENGTH} characters. We&rsquo;ll email you a link to confirm
                your address before your first sign-in.
              </p>
            )}

            <button type="submit" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50" disabled={busy}>
              {busy ? (
                <>
                  <Icon name="refresh" size={17} className="spin" /> Working…
                </>
              ) : mode === 'in' ? (
                <>
                  <Icon name="arrow-forward" size={17} /> Sign in
                </>
              ) : (
                <>
                  <Icon name="checkmark-done" size={17} /> Create account
                </>
              )}
            </button>

            <p className="auth-left-foot">
              {mode === 'in' ? (
                <>
                  New to Verafo?{' '}
                  <button className="link" type="button" onClick={() => switchMode('up')}>
                    Create an account
                  </button>
                  , or{' '}
                  <a
                    className="link"
                    href="https://apps.shopify.com/verafo"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    install it on Shopify
                  </a>{' '}
                  and your store signs in here.
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button className="link" type="button" onClick={() => switchMode('in')}>
                    Sign in
                  </button>
                </>
              )}
            </p>
          </form>
        </div>
        </div>
      </main>
    </div>
  )
}