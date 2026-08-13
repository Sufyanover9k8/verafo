import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isConfigured, supabase } from '../../lib/supabase'
import { useStoreScope } from '../../lib/store'

interface StoreRow {
  id: string
  name: string
}

/** Store scoping control — "all stores" = network-wide, one store = brand view. */
export function StoreSwitcher() {
  const navigate = useNavigate()
  const { store, setStore } = useStoreScope()
  const [stores, setStores] = useState<StoreRow[]>([])

  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase
      .from('stores')
      .select('id, name')
      .order('name')
      .then(({ data, error }) => {
        if (!error && alive) setStores((data ?? []) as StoreRow[])
      })
    return () => {
      alive = false
    }
  }, [])

  if (!isConfigured) return null

  function onChange(e: ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    if (!id) {
      setStore(null)
      return
    }
    const s = stores.find((x) => x.id === id)
    if (s) {
      setStore({ id: s.id, name: s.name })
      navigate(`/stores/${s.id}`)
    }
  }

  return (
    <label className="store-switcher" title="Scope the app to one store">
      <span className="store-switcher-label">Store</span>
      <select value={store?.id ?? ''} onChange={onChange} aria-label="Active store">
        <option value="">All stores (network)</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}