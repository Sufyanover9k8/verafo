import { useState, type FormEvent } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'

const CATEGORIES = ['Skincare', 'Fashion', 'Electronics', 'Home', 'Grocery', 'Other']

const inputClass =
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground placeholder:text-muted-foreground md:h-10 md:text-[15px]'

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
      // Raw detail stays in the console; the merchant gets a plain sentence.
      console.error('Could not create store:', res.error)
      setError('We could not save your store. Please try again.')
      return
    }
    toast.push({ kind: 'success', title: 'Store created', detail: clean })
    reload()
  }

  return (
    /* Same two-panel shape as the sign-in screen: the pitch on the left, the
       one task on the right. Stacked below lg. */
    <div className="grid min-h-screen lg:grid-cols-[48fr_52fr]">
      <aside className="flex flex-col gap-10 bg-muted bg-[radial-gradient(70%_50%_at_100%_0%,color-mix(in_srgb,var(--teal)_18%,transparent),transparent_62%),radial-gradient(50%_45%_at_0%_100%,color-mix(in_srgb,var(--teal)_10%,transparent),transparent_62%)] p-6 sm:p-10 lg:p-12">
        <div className="flex items-center gap-3">
          <img src="/verafo-logo.png" alt="Verafo" className="size-8 shrink-0 object-contain" />
          <span className="text-[15px] font-semibold text-foreground">Verafo</span>
        </div>
        <h1 className="max-w-[17ch] text-[28px] leading-[1.14] font-extrabold tracking-[-0.038em] text-foreground sm:text-[34px] lg:text-[40px]">
          One step and you&rsquo;re live. <em className="text-primary-text italic">Name</em> your store.
        </h1>
        <p className="text-[12.5px] text-muted-foreground">
          Verafo scores every buyer against the network the moment your first order lands.
        </p>
      </aside>

      <main className="flex items-center justify-center bg-background p-4 sm:p-8">
        <div className="w-full max-w-[400px] rounded-[16px] border border-border bg-card p-6 shadow-3 sm:p-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-[28px]">Set up your store</h2>
          <p className="mt-2 text-[13px] text-muted-foreground">
            This is the store Verafo will attach your orders and risk data to.
          </p>

          <form className="mt-8 flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="onboarding-name" className="text-[13px] font-medium text-muted-foreground">
                Store name
              </Label>
              <input
                id="onboarding-name"
                className={inputClass}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Luxe Skincare"
                autoFocus
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'onboarding-error' : undefined}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span id="onboarding-category-label" className="text-[13px] font-medium text-muted-foreground">
                Industry (optional)
              </span>
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby="onboarding-category-label">
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
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="onboarding-domain" className="text-[13px] font-medium text-muted-foreground">
                Shopify domain (optional)
              </Label>
              <input
                id="onboarding-domain"
                className={inputClass}
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="your-store.myshopify.com"
              />
            </div>

            {error && (
              <p
                id="onboarding-error"
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
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Creating…
                </>
              ) : (
                <>
                  <ArrowRight className="size-4" aria-hidden="true" /> Create store &amp; continue
                </>
              )}
            </Button>

            <p className="text-center text-[13px] text-muted-foreground">
              Signed in as {email ?? 'your account'}.{' '}
              <button
                className="font-semibold text-primary-text underline-offset-4 hover:underline"
                type="button"
                onClick={() => void supabase?.auth.signOut()}
              >
                Sign out
              </button>
            </p>
          </form>
        </div>
      </main>
    </div>
  )
}
