import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save, Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { useToast } from '@/lib/toast'
import type { Store } from '@/lib/types'

/** The couriers Pakistani COD sellers actually ship with. */
const COURIERS = [
  'TCS',
  'Leopards',
  'PostEx',
  'M&P',
  'CallCourier',
  'Trax',
  'Rider',
  'Other',
] as const

interface Props {
  stores: Store[]
  storeId: string
}

/**
 * Which courier and which of its APIs the merchant uses.
 *
 * This is deliberately a NON-SECRET record: a provider name and an API label.
 * Credentials never live here — when the direct API integration ships, keys go
 * into Supabase secrets, not into a row the browser can read.
 */
export function CourierSettings({ stores, storeId }: Props) {
  const toast = useToast()
  const { email } = useSession()
  const [courier, setCourier] = useState('TCS')
  const [apiName, setApiName] = useState('')
  const [docsUrl, setDocsUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase || !storeId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('store_courier_settings')
      .select('courier_name, api_name, api_docs_url, updated_at')
      .eq('store_id', storeId)
      .maybeSingle()
    setLoading(false)
    if (error) {
      // A missing table is a deployment gap, not a user error.
      if (!/does not exist|schema cache/i.test(error.message)) {
        toast.push({ kind: 'error', title: 'Could not load courier settings', detail: error.message })
      }
      return
    }
    if (data) {
      setCourier(data.courier_name ?? 'Other')
      setApiName(data.api_name ?? '')
      setDocsUrl(data.api_docs_url ?? '')
      setSaved(data.updated_at ?? null)
    } else {
      setApiName('')
      setDocsUrl('')
      setSaved(null)
    }
  }, [storeId, toast])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!supabase || !storeId) return
    setSaving(true)
    const { error } = await supabase.from('store_courier_settings').upsert(
      {
        store_id: storeId,
        courier_name: courier,
        api_name: apiName.trim() || null,
        api_docs_url: docsUrl.trim() || null,
        updated_by: email ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_id' },
    )
    setSaving(false)
    if (error) {
      toast.push({ kind: 'error', title: 'Could not save', detail: error.message })
      return
    }
    setSaved(new Date().toISOString())
    toast.push({
      kind: 'success',
      title: 'Courier saved',
      detail: 'No credentials are stored — only which courier and API you use.',
    })
  }

  return (
    <div className="card import-card">
      <div className="import-head">
        <h3 className="card-title">
          <Truck size={16} /> Courier integration
        </h3>
        <span className="prompt-hint">coming soon</span>
      </div>
      <p className="import-note">
        Tell us which courier you use and which of its APIs we should call. We are building direct
        courier pulls — once they ship, Verafo will fetch delivery status on its own instead of you
        uploading reports. You can record the choice now; <strong>no API key or secret is stored here</strong>.
      </p>

      <div className="gen-grid">
        <label className="field">
          <span className="field-label">Courier</span>
          <select
            value={courier}
            onChange={(e) => setCourier(e.target.value)}
            disabled={!storeId || loading}
          >
            {COURIERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">API (optional, coming soon)</span>
          <input
            type="text"
            value={apiName}
            onChange={(e) => setApiName(e.target.value)}
            placeholder="e.g. CodShipmentAPI v2"
            disabled={!storeId || loading}
            maxLength={80}
          />
        </label>
        <label className="field">
          <span className="field-label">API docs link (optional)</span>
          <input
            type="url"
            value={docsUrl}
            onChange={(e) => setDocsUrl(e.target.value)}
            placeholder="https://…"
            disabled={!storeId || loading}
            maxLength={200}
          />
        </label>
      </div>

      <div className="import-actions">
        <button
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--cta-accent-bg)] px-4 text-[13px] font-semibold text-[var(--cta-accent-fg)] hover:bg-[var(--cta-accent-hover)] disabled:opacity-50"
          onClick={() => void save()}
          disabled={!storeId || saving || loading}
        >
          {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Save courier
        </button>
        {stores.length === 0 && <span className="import-note">Add a store first.</span>}
        {saved && (
          <span className="import-note">
            Saved {new Date(saved).toLocaleDateString('en-GB')} · {courier}
            {apiName ? ` · ${apiName}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
