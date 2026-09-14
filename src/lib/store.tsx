import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from './supabase'
import { useIsAdmin } from './admin'
import { useSession } from './session'

export interface ActiveStore {
  id: string
  name: string
}

export type Role = 'admin' | 'merchant'

interface StoreScopeValue {
  /** Role of the signed-in user. Admins see the whole network; merchants see
   *  only their own store(s). */
  role: Role
  /** Still resolving role + the user's stores. */
  loading: boolean
  /** Merchant is signed in but owns no store yet — App shows onboarding. */
  needsStore: boolean

  /** Stores this user is allowed to see. Admin: every store. Merchant: their own. */
  stores: ActiveStore[]

  /** The store the operational pages are scoped to.
   *  Admin: null = whole network, or a chosen store.
   *  Merchant: ALWAYS one of their own stores (never null → never the network). */
  store: ActiveStore | null
  setStore: (s: ActiveStore | null) => void

  /** Store-id filter for network-safe queries.
   *  null  = no filter (admin, network view)
   *  [...] = restrict to these store ids (a merchant's own stores) */
  scopeStoreIds: string[] | null

  reload: () => void
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
  const { email, loading: sessionLoading } = useSession()
  const { admin, checking: adminChecking } = useIsAdmin()
  const role: Role = admin ? 'admin' : 'merchant'

  const [stores, setStores] = useState<ActiveStore[]>([])
  const [storesLoading, setStoresLoading] = useState(true)
  const [store, setStoreState] = useState<ActiveStore | null>(readStored)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const setStore = useCallback((s: ActiveStore | null) => {
    setStoreState(s)
    try {
      if (s) localStorage.setItem(KEY, JSON.stringify(s))
      else localStorage.removeItem(KEY)
    } catch {
      /* storage unavailable */
    }
  }, [])

  // Load the stores this user may see, then constrain the active store.
  useEffect(() => {
    if (sessionLoading || adminChecking) return
    if (!supabase) {
      setStores([])
      setStoresLoading(false)
      return
    }
    let alive = true
    setStoresLoading(true)

    const q = supabase.from('stores').select('id, name').order('name')
    const scoped = admin ? q : q.eq('owner_email', email ?? '__none__')

    scoped.then(({ data, error }) => {
      if (!alive) return
      const list = (error ? [] : ((data ?? []) as ActiveStore[]))
      setStores(list)
      setStoresLoading(false)

      setStoreState((current) => {
        if (admin) {
          // Admin: keep their chosen store if it still exists, else the network.
          return current && list.some((s) => s.id === current.id) ? current : null
        }
        // Merchant: always locked to one of their own stores, never the network.
        if (list.length === 0) return null
        const keep =
          current && list.some((s) => s.id === current.id) ? current : list[0]
        try {
          localStorage.setItem(KEY, JSON.stringify(keep))
        } catch {
          /* ignore */
        }
        return keep
      })
    })

    return () => {
      alive = false
    }
  }, [admin, adminChecking, email, sessionLoading, nonce])

  const loading = sessionLoading || adminChecking || storesLoading
  const needsStore = !loading && role === 'merchant' && stores.length === 0

  const scopeStoreIds = useMemo<string[] | null>(() => {
    if (role === 'admin') return null
    return stores.map((s) => s.id)
  }, [role, stores])

  const value = useMemo<StoreScopeValue>(
    () => ({ role, loading, needsStore, stores, store, setStore, scopeStoreIds, reload }),
    [role, loading, needsStore, stores, store, setStore, scopeStoreIds, reload],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStoreScope(): StoreScopeValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStoreScope must be used within StoreScopeProvider')
  return v
}
