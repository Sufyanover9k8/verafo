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

/**
 * POST to an edge function as the signed-in user.
 *
 * verafo-ai runs on the service role, so it authorises the CALLER from the
 * JWT (see authorizeCaller in supabase/functions/verafo-ai/index.ts) and
 * scopes every query to the stores that JWT owns. A bare fetch without the
 * Authorization header is treated as an anonymous caller: no stores, no
 * data, and the AI ends up telling the merchant it cannot see their orders.
 * Always go through this helper.
 */
export async function edgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = functionsBaseUrl()
  if (!base) throw new Error('Edge functions are not configured.')
  if (!supabase) throw new Error('Supabase is not configured.')

  let token = ''
  try {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token ?? ''
  } catch {
    /* fall through: the platform will answer 401 */
  }

  const headers = new Headers(init.headers)
  if (clientKey) headers.set('apikey', clientKey)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  return fetch(`${base}${path}`, { ...init, headers })
}
