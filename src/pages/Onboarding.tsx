import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Icon } from '../components/Icon'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'

const CATEGORIES = ['Skincare', 'Fashion', 'Electronics', 'Home', 'Grocery', 'Other']

/**
 * Shown to a signed-in merchant who owns no store yet. One step: name the
 * store, then Verafo has somewhere to scope their data. `reload()` re-runs the
 * store-scope query so the app drops straight into the dashboard.
 */
export function Onboarding() {
  const { email } = useSession()
  const { reload } = useStoreScope()
  const toast = useToast()

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [domain, setDomain] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const clean = name.trim()
    if (!clean) {
      setError('Give your store a name to continue.')
      return
    }
    setSaving(true)
    setError(null)

    const payload: Record<string, string> = { name: clean }
    if (email) payload.owner_email = email
    if (category) payload.category = category
    if (domain.trim()) payload.shopify_domain = domain.trim()

    let res = await supabase.from('stores').insert(payload)
    // If the schema hasn't had the profile columns added yet, retry with core fields.
    if (res.error && (res.error.code === '42703' || res.error.message.includes('does not exist'))) {
      const base: Record<string, string> = { name: clean }
      if (email) base.owner_email = email
      if (domain.trim()) base.shopify_domain = domain.trim()
      res = await supabase.from('stores').insert(base)
    }
    setSaving(false)

    if (res.error) {
      setError(res.error.message)
      return
    }
    toast.push({ kind: 'success', title: 'Store created', detail: clean })
    reload()
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
          One step and you&rsquo;re live. <em>Name</em> your store.
        </h1>
        <p className="auth-left-foot">
          Verafo scores every buyer against the network the moment your first order lands.
        </p>
      </aside>

      <main className="auth-right">
        <div className="auth-form-wrap">
          <h2>Set up your store</h2>
          <p>This is the store Verafo will attach your orders and risk data to.</p>

          <form className="auth-form" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Store name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Luxe Skincare"
                autoFocus
                required
              />
            </label>

            <div className="field">
              <span className="field-label">Industry (optional)</span>
              <div className="chip-picker" role="group" aria-label="Industry">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={category === c ? 'active' : ''}
                    onClick={() => setCategory(category === c ? '' : c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span className="field-label">Shopify domain (optional)</span>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="your-store.myshopify.com"
              />
            </label>

            {error && <span className="field-error">{error}</span>}

            <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
              {saving ? (
                <>
                  <Icon name="refresh" size={17} className="spin" /> Creating…
                </>
              ) : (
                <>
                  <Icon name="arrow-forward" size={17} /> Create store &amp; continue
                </>
              )}
            </button>

            <p className="auth-left-foot">
              Signed in as {email ?? 'your account'}.{' '}
              <button className="link" type="button" onClick={() => void supabase?.auth.signOut()}>
                Sign out
              </button>
            </p>
          </form>
        </div>
      </main>
    </div>
  )
}
