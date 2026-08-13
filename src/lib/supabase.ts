import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const clientKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && clientKey)

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, clientKey!)
  : null

export function functionsBaseUrl(): string | null {
  if (!url) return null
  try {
    return `${new URL(url).origin}/functions/v1`
  } catch {
    return null
  }
}
