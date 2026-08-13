import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface ActiveStore {
  id: string
  name: string
}

interface StoreScopeValue {
  /** The store the operational pages are scoped to, or null for all stores. */
  store: ActiveStore | null
  setStore: (s: ActiveStore | null) => void
}

const KEY = 'verafo.activeStore'
const Ctx = createContext<StoreScopeValue | null>(null)

function readStored(): ActiveStore | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ActiveStore>
    return parsed.id && parsed.name ? { id: parsed.id, name: parsed.name } : null
  } catch {
    return null
  }
}

export function StoreScopeProvider({ children }: { children: ReactNode }) {
  const [store, setStoreState] = useState<ActiveStore | null>(readStored)

  useEffect(() => {
    try {
      if (store) localStorage.setItem(KEY, JSON.stringify(store))
      else localStorage.removeItem(KEY)
    } catch {
      /* storage unavailable — ignore */
    }
  }, [store])

  const value = useMemo(() => ({ store, setStore: setStoreState }), [store])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStoreScope(): StoreScopeValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStoreScope must be used within StoreScopeProvider')
  return v
}