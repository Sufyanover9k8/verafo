import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircleMore, ShieldCheck, ShoppingBag } from 'lucide-react'
import { Icon } from '../components/Icon'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'

export function Auth() {
  const navigate = useNavigate()
  const toast = useToast()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)

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
        toast.push({ kind: 'success', title: 'Account created', detail: 'Check your email to confirm, then sign in.' })
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
    <div className="auth-split">
      <aside className="auth-left">
        <div className="auth-wordmark">
          <span className="sidebar-brand-mark">
            <ShieldCheck size={18} strokeWidth={2} />
          </span>
          <span className="sidebar-brand-name">Verafo</span>
        </div>

        <div>
          <h1 className="auth-left-title">
            Know who you're shipping to. <em>Before</em> you ship.
          </h1>
          <p className="auth-left-sub">
            Every Cash-on-Delivery order gets a risk verdict before it leaves your
            warehouse — so you stop guessing which orders will bounce back.
          </p>
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
            <span className="auth-feature-pill safe">Low risk</span>
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
          <p>
            {mode === 'in'
              ? 'Sign in to see your network-wide buyer risk profiles.'
              : 'Join the network and start scoring buyers before delivery.'}
          </p>

          <form className="auth-form" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@store.com"
                autoComplete="email"
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                required
              />
            </label>

            {mode === 'in' && (
              <button
                type="button"
                className="link auth-forgot"
                onClick={() => void sendReset()}
                disabled={busy || resetSent}
              >
                {resetSent ? 'Reset link sent — check your email' : 'Forgot password?'}
              </button>
            )}

            {error && <span className="field-error">{error}</span>}

            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
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
                  <button className="link" type="button" onClick={() => setMode('up')}>
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button className="link" type="button" onClick={() => setMode('in')}>
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