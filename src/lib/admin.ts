import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * The admin role comes from the database: `verafo_is_admin()` checks
 * `verafo_admins` against the signed-in JWT. That means the UI role and the
 * row-level security policies can never disagree, there is no second list to
 * keep in sync, and no team email address is compiled into the public bundle.
 *
 * Add or remove admins in SQL (`verafo_admins`), never here.
 *
 * VITE_DEMO_ADMIN=1 treats every signed-in user as an admin — local dev only.
 */
const DEMO_ADMIN = String(import.meta.env.VITE_DEMO_ADMIN ?? '') === '1'

export interface AdminState {
  admin: boolean
  checking: boolean
}

export function useIsAdmin(): AdminState {
  // Default: NOT admin. Only flips true once the server confirms it.
  const [admin, setAdmin] = useState(DEMO_ADMIN)
  const [checking, setChecking] = useState(!DEMO_ADMIN)

  useEffect(() => {
    if (DEMO_ADMIN) {
      setChecking(false)
      return
    }
    if (!supabase) {
      setAdmin(false)
      setChecking(false)
      return
    }
    let alive = true

    const apply = async (email: string | null | undefined) => {
      if (!alive) return
      if (!email) {
        setAdmin(false)
        setChecking(false)
        return
      }
      const { data, error } = await supabase!.rpc('verafo_is_admin')
      if (!alive) return
      // Fail closed: if the function is missing or errors, this is a merchant.
      // RLS enforces the same answer, so the UI never shows permissions the
      // server would refuse.
      if (error) console.error('Could not resolve admin role:', error)
      setAdmin(!error && data === true)
      setChecking(false)
    }
    // Read the cached session instead of calling the auth server: this only
    // decides what the UI shows, RLS still enforces everything server-side,
    // and SessionProvider has already loaded the same session.
    void supabase.auth.getSession().then(({ data }) => apply(data.session?.user?.email))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void apply(session?.user?.email)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return { admin, checking }
}
