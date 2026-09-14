import { type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isConfigured } from '../../lib/supabase'
import { useStoreScope } from '../../lib/store'

/**
 * Store scoping control.
 *   Admin   — "All stores (network)" + any store.
 *   Merchant with >1 store — switch between their own stores (no network option).
 *   Merchant with ≤1 store — hidden (nothing to switch).
 */
export function StoreSwitcher() {
  const navigate = useNavigate()
  const { role, stores, store, setStore } = useStoreScope()
  const isAdmin = role === 'admin'

  if (!isConfigured) return null
  if (!isAdmin && stores.length <= 1) return null

  function onChange(e: ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    if (!id) {
      // Only admins can clear to the network view.
      if (isAdmin) setStore(null)
      return
    }
    const s = stores.find((x) => x.id === id)
    if (s) {
      setStore({ id: s.id, name: s.name })
      if (isAdmin) navigate(`/stores/${s.id}`)
    }
  }

  return (
    <label className="store-switcher" title="Scope the app to one store">
      <span className="store-switcher-label">Store</span>
      <select value={store?.id ?? ''} onChange={onChange} aria-label="Active store">
        {isAdmin && <option value="">All stores (network)</option>}
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}
