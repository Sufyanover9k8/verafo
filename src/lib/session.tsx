import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface SessionValue {
  session: Session | null
  user: User | null
  email: string | null
  /** Preferred display name — user_metadata.name/full_name, else the email's
   *  local part, else empty. Kept on the Supabase user (Settings updates it via
   *  supabase.auth.updateUser), so it follows the account across devices. */
  displayName: string
  loading: boolean
}

const Ctx = createContext<SessionValue | null>(null)

/**
 * Single source of truth for the signed-in Supabase user. Everything that
 * needs "who is this" (role, store scoping, greeting) reads from here instead
 * of calling supabase.auth.getSession() ad-hoc.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_e, next) => {
      if (alive) setSession(next)
    })
    return () => {
      alive = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<SessionValue>(() => {
    const user = session?.user ?? null
    const email = user?.email ?? null
    const meta = (user?.user_metadata ?? {}) as { name?: string; full_name?: string }
    const displayName = (meta.name || meta.full_name || email?.split('@')[0] || '').trim()
    return { session, user, email, displayName, loading }
  }, [session, loading])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession must be used within SessionProvider')
  return v
}
