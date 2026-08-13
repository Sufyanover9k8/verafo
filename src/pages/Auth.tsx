import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
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
      </main>
    </div>
  )
}