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

  const value = useMemo<SessionValue>(
    () => ({
      session,
      user: session?.user ?? null,
      email: session?.user?.email ?? null,
      loading,
    }),
    [session, loading],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession must be used within SessionProvider')
  return v
}
