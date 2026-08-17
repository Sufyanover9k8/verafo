import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Comma-separated list of admin emails (e.g. VITE_ADMIN_EMAILS=you@example.com,boss@example.com).
// When unset the app runs in demo mode and every signed-in user is treated as an admin.
const ADMIN_EMAILS = ((import.meta.env.VITE_ADMIN_EMAILS as string | undefined) ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase())
}

export interface AdminState {
  admin: boolean
  checking: boolean
}

export function useIsAdmin(): AdminState {
  const [admin, setAdmin] = useState(ADMIN_EMAILS.length === 0)
  const [checking, setChecking] = useState(ADMIN_EMAILS.length > 0)

  useEffect(() => {
    if (!supabase || ADMIN_EMAILS.length === 0) {
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