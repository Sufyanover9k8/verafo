import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Phone, Plus, User } from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { EmptyState, NeedsSetup } from '../components/States'
import { Reveal } from '../components/Reveal'
import { cn } from '@/lib/utils'
import { useIsAdmin } from '../lib/admin'
import { normalizePhone, phone } from '../lib/format'
import { isConfigured, supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'

const CATEGORIES = ['Skincare', 'Fashion', 'Electronics', 'Home', 'Grocery', 'Other']

const inputClass =
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground placeholder:text-muted-foreground md:h-10 md:text-[15px]'

const hintClass = 'text-[12.5px] text-muted-foreground'

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
    <PageShell>
      <PageHeader
        title="Add e-brand"
        description="Register a new store in the network."
        actions={
          <Button asChild variant="outline" size="sm" className="h-11 gap-2 rounded-[10px] px-3 md:h-9">
            <Link to="/stores">
              <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to stores
            </Link>
          </Button>
        }
      />

      {checking ? (
        <Card className="gap-0 p-6">
          <EmptyState icon="shield-checkmark" title="Checking access…" />
        </Card>
      ) : !admin ? (
        <Card className="gap-0 p-6">
          <EmptyState icon="storefront"
            title="Restricted to admins"
            detail="Only administrators can add stores."
          />
          <div className="flex justify-center pb-6">
            <Button asChild className="h-11 gap-2 rounded-full px-5 text-[13px] font-semibold">
              <Link to="/">
                <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to dashboard
              </Link>
            </Button>
          </div>
        </Card>
      ) : (
        <Reveal stagger className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Card className="gap-0 p-6">
            <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="add-store-name" className="text-[13px] font-medium text-muted-foreground">
                  Brand name
                </Label>
                <input
                  id="add-store-name"
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Luxe Skincare"
                  required
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <span id="add-store-category-label" className="text-[13px] font-medium text-muted-foreground">
                  Industry
                </span>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="add-store-category-label">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={category === c}
                      className={cn(
                        'h-11 rounded-full border px-3.5 text-[13px] font-medium transition-colors md:h-9',
                        category === c
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-foreground hover:bg-muted',
                      )}
                      onClick={() => setCategory(category === c ? '' : c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <span className={hintClass}>Optional — helps sort stores by what they sell.</span>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="add-store-domain" className="text-[13px] font-medium text-muted-foreground">
                  Shopify domain
                </Label>
                <input
                  id="add-store-domain"
                  className={inputClass}
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="your-store.myshopify.com"
                />
                <span className={hintClass}>Optional — links this brand to its Shopify shop.</span>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="add-store-email" className="text-[13px] font-medium text-muted-foreground">
                  Owner email
                </Label>
                <input
                  id="add-store-email"
                  className={inputClass}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@example.com"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="add-store-phone" className="text-[13px] font-medium text-muted-foreground">
                  Owner phone
                </Label>
                <input
                  id="add-store-phone"
                  className={inputClass}
                  type="tel"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="03XX XXXXXXX"
                />
                <span className={hintClass}>Optional — direct contact for order queries.</span>
              </div>

              <div className="flex justify-end">
                <Button type="submit" size="lg" className="h-12 gap-2 rounded-full px-6 text-[15px] font-semibold" disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Adding…
                    </>
                  ) : (
                    <>
                      <Plus className="size-4" aria-hidden="true" /> Add store
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Card>

          <aside className="lg:border-s lg:border-border lg:ps-8" aria-label="Store preview">
            <span className="mb-3 block text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              live preview
            </span>
            <div className="rounded-[16px] border border-border bg-card p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-muted text-[15px] font-semibold text-foreground">
                  {initial}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">{name.trim() || 'Brand name'}</div>
                  <div className="truncate text-[12.5px] text-muted-foreground">{previewDomain}</div>
                  {category && (
                    <div className="mt-1.5">
                      <span className="inline-flex rounded-full bg-risk-safe-soft px-2.5 py-0.5 text-[11.5px] font-semibold text-risk-safe-strong">
                        {category}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <User className="size-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">{previewEmail}</span>
                </span>
                <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Phone className="size-3.5 shrink-0" aria-hidden="true" /> {previewPhone}
                </span>
              </div>
              <p className="mt-4 text-[12.5px] text-muted-foreground">
                The store appears instantly in the Stores list, where you can open its dashboard or
                remove it at any time.
              </p>
            </div>
          </aside>
        </Reveal>
      )}
    </PageShell>
  )
}
