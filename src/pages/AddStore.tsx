import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/primitives/Card'
import { EmptyState, NeedsSetup } from '../components/States'
import { useIsAdmin } from '../lib/admin'
import { normalizePhone, phone } from '../lib/format'
import { isConfigured, supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'

const CATEGORIES = ['Skincare', 'Fashion', 'Electronics', 'Home', 'Grocery', 'Other']

export function AddStore() {
  const toast = useToast()
  const navigate = useNavigate()
  const { admin, checking } = useIsAdmin()

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [domain, setDomain] = useState('')
  const [email, setEmail] = useState('')
  const [contact, setContact] = useState('')
  const [saving, setSaving] = useState(false)

  const initial = (name.trim() || '?').charAt(0).toUpperCase()
  const previewDomain = domain.trim() || 'your-store.myshopify.com'
  const previewEmail = email.trim() || 'owner@example.com'
  const previewPhone = useMemo(() => {
    const digits = normalizePhone(contact)
    return digits ? phone(digits) : '+92 3XX XXXXXXX'
  }, [contact])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const cleanName = name.trim()
    if (!cleanName) {
      toast.push({ kind: 'error', title: 'Brand name is required' })
      return
    }
    setSaving(true)
    const payload: Record<string, string> = { name: cleanName }
    if (category) payload.category = category
    if (domain.trim()) payload.shopify_domain = domain.trim()
    if (email.trim()) payload.owner_email = email.trim()
    const phoneDigits = normalizePhone(contact)
    if (phoneDigits) payload.contact_phone = phoneDigits
    const hasExtras = 'category' in payload || 'contact_phone' in payload
    let res = await supabase.from('stores').insert(payload)
    let extrasSkipped = false
    if (res.error && (res.error.code === '42703' || res.error.message.includes('does not exist'))) {
      // Schema not migrated — save the core fields and skip the extras gracefully.
      extrasSkipped = true
      const base: Record<string, string> = { name: cleanName }
      if (domain.trim()) base.shopify_domain = domain.trim()
      if (email.trim()) base.owner_email = email.trim()
      res = await supabase.from('stores').insert(base)
    }
    setSaving(false)
    if (res.error) {
      toast.push({ kind: 'error', title: 'Could not add store', detail: res.error.message })
      return
    }
    toast.push({
      kind: 'success',
      title: 'Store added',
      detail:
        extrasSkipped && hasExtras
          ? 'Industry & phone will be saved once supabase/stores-migration.sql is applied.'
          : cleanName,
    })
    navigate('/stores')
  }

  if (!isConfigured) return <NeedsSetup />

  return (
    <div className="stack">
      <PageHeader
        icon="storefront"
        title="Add e-brand"
        subtitle="Register a new store in the network."
        actions={
          <Link className="btn btn-secondary btn-sm" to="/stores">
            <Icon name="arrow-forward" size={14} /> Back to stores
          </Link>
        }
      />

      {checking ? (
        <Card>
          <EmptyState icon="shield-checkmark" title="Checking access…" />
        </Card>
      ) : !admin ? (
        <Card>
          <EmptyState
            icon="shield-checkmark"
            title="Restricted to admins"
            detail="Only administrators can add stores."
          />
          <div className="store-restricted-cta">
            <Link className="btn btn-primary" to="/">
              <Icon name="arrow-forward" size={14} /> Back to dashboard
            </Link>
          </div>
        </Card>
      ) : (
        <div className="add-store-layout">
          <Card className="add-store-card">
            <form className="add-store-form" onSubmit={handleSubmit}>
              <label className="add-store-field">
                <span>Brand name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Luxe Skincare"
                  required
                  autoFocus
                />
              </label>

              <div className="add-store-field">
                <span>Industry</span>
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
                <span className="add-store-hint">Optional — helps sort stores by what they sell.</span>
              </div>

              <label className="add-store-field">
                <span>Shopify domain</span>
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="your-store.myshopify.com"
                />
                <span className="add-store-hint">Optional — links this brand to its Shopify shop.</span>
              </label>

              <label className="add-store-field">
                <span>Owner email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@example.com"
                />
              </label>

              <label className="add-store-field">
                <span>Owner phone</span>
                <input
                  type="tel"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="03XX XXXXXXX"
                />
                <span className="add-store-hint">Optional — direct contact for order queries.</span>
              </label>

              <div className="add-store-submit">
                <button className="btn btn-primary btn-lg" type="submit" disabled={saving}>
                  {saving ? (
                    <>
                      <Icon name="refresh" size={16} className="spin" /> Adding…
                    </>
                  ) : (
                    <>
                      <Icon name="add" size={16} /> Add store
                    </>
                  )}
                </button>
              </div>
            </form>
          </Card>

          <div className="add-store-preview">
            <span className="verdict-conf">live preview</span>
            <div className="store-preview">
              <div className="store-preview-head">
                <span className="store-preview-avatar">{initial}</span>
                <div>
                  <div className="store-preview-name">{name.trim() || 'Brand name'}</div>
                  <div className="store-preview-domain">{previewDomain}</div>
                  {category && (
                    <div className="store-preview-category">
                      <span className="chip chip-cyan">{category}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="store-preview-details">
                <span className="store-preview-row">
                  <Icon name="person" size={14} /> {previewEmail}
                </span>
                <span className="store-preview-row">
                  <Icon name="phone-portrait" size={14} /> {previewPhone}
                </span>
              </div>
              <p className="store-preview-note">
                The store appears instantly in the Stores list, where you can open its dashboard or
                remove it at any time.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}