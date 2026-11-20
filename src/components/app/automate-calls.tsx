import { useCallback, useEffect, useState } from 'react'
import { Loader2, PhoneCall } from 'lucide-react'
import { readCallSettings, saveCallSettings, thresholdLabel, type CallSettings } from '@/lib/calls'
import { setAutomation } from '@/lib/workflow'
import { useStoreScope } from '@/lib/store'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/**
 * The one control that turns the call queue on for a store.
 *
 * It is deliberately the same switch the mobile app has: `auto_call` on
 * `store_call_settings`. The work is done by the `call-queue` cron, which pulls
 * every pending order at or above the store's risk threshold into the queue and
 * dials them one at a time, so this button never calls anything itself — it
 * only flips the setting and reports what got queued.
 */
export function AutomateCalls({ onChange }: { onChange?: () => void }) {
  const toast = useToast()
  const { store } = useStoreScope()
  const [settings, setSettings] = useState<CallSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const { settings: rows, stores } = await readCallSettings()
      const mine = store
        ? rows?.find((row) => row.store_id === store.id)
        : rows?.find((row) => row.store_id === stores?.[0]?.id)
      setSettings(mine ?? null)
    } catch {
      // A store that never opened the app has no row yet; the save below
      // creates nothing, it only updates, so keep the switch disabled.
      setSettings(null)
    } finally {
      setLoading(false)
    }
  }, [store])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle() {
    if (!store || !settings || saving) return
    setSaving(true)
    const next = !settings.auto_call
    try {
      const res = await saveCallSettings(store.id, { auto_call: next })
      setSettings(res.settings ?? { ...settings, auto_call: next })
      // The same switch lives on the workflow board's Orders → Call queue wire;
      // keep the two in step so the wire does not contradict this button.
      void setAutomation(store.id, 'call_dial', next)
      const threshold = thresholdLabel(Number(res.settings?.risk_threshold ?? settings.risk_threshold))
      const added = res.added ?? 0
      toast.push({
        kind: 'success',
        title: next ? 'Automate calls is on' : 'Automate calls is off',
        detail: next
          ? added > 0
            ? `${added} order${added === 1 ? '' : 's'} at ${threshold} risk or higher queued. Verafo dials them one at a time.`
            : `Verafo will call every order at ${threshold} risk or higher, one at a time.`
          : 'Calls now only happen when you press Call.',
      })
      onChange?.()
    } catch (error) {
      toast.push({
        kind: 'error',
        title: 'Could not change automation',
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <span className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-[13px] text-muted-foreground md:h-9">
        <Loader2 className="size-4 animate-spin" /> Calls…
      </span>
    )
  }

  if (!settings) {
    return (
      <span
        className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-dashed border-border bg-card px-3 text-[13px] text-muted-foreground md:h-9"
        title="Open the app once for this store, or pick a store, to enable automated calls."
      >
        <PhoneCall className="size-4" /> Automate calls
      </span>
    )
  }

  const on = settings.auto_call
  const threshold = thresholdLabel(Number(settings.risk_threshold))

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={saving || !store}
      onClick={() => void toggle()}
      title={
        on
          ? `On — Verafo calls every order at ${threshold} risk or higher, one at a time. Change the threshold in Settings.`
          : `Turn on to call every order at ${threshold} risk or higher automatically.`
      }
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-[10px] border px-3 text-[13px] font-semibold transition-colors disabled:opacity-60 md:h-9',
        on
          ? 'border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90'
          : 'border-border bg-card text-foreground hover:bg-muted',
      )}
    >
      {saving ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
      Automate calls
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[11.5px] font-medium tabular-nums',
          on ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {on ? `on · ${threshold}+` : 'off'}
      </span>
    </button>
  )
}
