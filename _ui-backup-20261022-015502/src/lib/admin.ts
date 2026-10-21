import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Admin allowlist. Set VITE_ADMIN_EMAILS to a comma-separated list of the
 * Verafo team's emails — those users see every store's data (the network view).
 * Everyone else is a merchant and only ever sees their own store.
 *
 * Local dev only: set VITE_DEMO_ADMIN=1 to treat every signed-in user as an
 * admin without an allowlist. Never set that in production.
 */
const ADMIN_EMAILS = ((import.meta.env.VITE_ADMIN_EMAILS as string | undefined) ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

const DEMO_ADMIN = String(import.meta.env.VITE_DEMO_ADMIN ?? '') === '1'

export function isAdminEmail(email: string | null | undefined): boolean {
  if (DEMO_ADMIN) return true
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase())
}

export interface AdminState {
  admin: boolean
  checking: boolean
}

export function useIsAdmin(): AdminState {
  // Default: NOT admin. Only flips true once the signed-in email is confirmed
  // on the allowlist (or demo mode is explicitly on).
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
    const apply = (email: string | null | undefined) => {
      if (!alive) return
      setAdmin(isAdminEmail(email))
      setChecking(false)
    }
    void supabase.auth.getUser().then(({ data }) => apply(data.user?.email))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session?.user?.email)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return { admin, checking }
}
