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
  /** True from the moment Supabase fires a PASSWORD_RECOVERY auth event
   *  (i.e. the user landed here via a "reset your password" email link)
   *  until they actually set a new password. App.tsx uses this to force the
   *  reset-password screen instead of the normal dashboard/login routing —
   *  a recovery link creates a real session, so without this check the app
   *  would just silently drop them onto the dashboard. */
  isPasswordRecovery: boolean
  clearPasswordRecovery: () => void
}

const Ctx = createContext<SessionValue | null>(null)

/** True if the current URL is a Supabase recovery-link landing (implicit-flow
 *  hash `#...&type=recovery...`, or PKCE-style `?...&type=recovery`). Checked
 *  synchronously so it's already correct on the very first render — waiting
 *  for the async PASSWORD_RECOVERY auth event instead lets App.tsx's
 *  session-based routing decide (and redirect) before the event arrives,
 *  which is exactly the race that sent recovery links to the login screen. */
function isRecoveryUrl(): boolean {
  if (typeof window === 'undefined') return false
  return /type=recovery/.test(window.location.hash) || /type=recovery/.test(window.location.search)
}

/**
 * Single source of truth for the signed-in Supabase user. Everything that
 * needs "who is this" (role, store scoping, greeting) reads from here instead
 * of calling supabase.auth.getSession() ad-hoc.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(isRecoveryUrl)

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
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (!alive) return
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true)
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
    return {
      session,
      user,
      email,
      displayName,
      loading,
      isPasswordRecovery,
      clearPasswordRecovery: () => setIsPasswordRecovery(false),
    }
  }, [session, loading, isPasswordRecovery])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession must be used within SessionProvider')
  return v
}
