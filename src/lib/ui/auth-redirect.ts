/**
 * Where Supabase auth emails (confirm sign-up, reset password) send the user
 * back to. The project's allow-list lives in Supabase → Authentication → URL
 * Configuration (`uri_allow_list`), so anything built here must be covered
 * there. Building it from `window.location.origin` means localhost, Vercel
 * previews and production all work without a rebuild.
 */

export const LOGIN_PATH = '/login'
export const RESET_PASSWORD_PATH = '/reset-password'

const FALLBACK_ORIGIN = 'https://www.verafo.com'

/** Pages that must never be used as a post-login destination. */
const RESERVED_PATHS = new Set([LOGIN_PATH, RESET_PASSWORD_PATH])

/** Absolute URL for an auth email to redirect back to. */
export function authRedirect(path: string = LOGIN_PATH, origin?: string): string {
  const base = (origin ?? currentOrigin()).replace(/\/+$/, '') || FALLBACK_ORIGIN
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${base}${clean}`
}

function currentOrigin(): string {
  if (typeof window !== 'undefined' && window.location.origin) return window.location.origin
  return FALLBACK_ORIGIN
}

export interface AuthLinkError {
  code: string
  description: string
}

/**
 * Supabase reports a bad or expired email link by redirecting back with
 * `#error=access_denied&error_code=otp_expired&error_description=...` (or the
 * same params in the query string). Without reading these the app just looks
 * like an unexplained sign-out, so the login screen surfaces them instead.
 */
export function readAuthLinkError(hash: string, search = ''): AuthLinkError | null {
  for (const raw of [hash, search]) {
    const query = raw.replace(/^[#?]/, '')
    if (!query) continue
    const params = new URLSearchParams(query)
    const code = params.get('error_code') || params.get('error')
    if (!code) continue
    return {
      code,
      description: params.get('error_description') || 'That link is invalid or has expired.',
    }
  }
  return null
}

/**
 * Read once, at module load — i.e. before the router runs. A recovery link
 * lands on `/reset-password#error=…`; with no session the router immediately
 * redirects to `/login`, and `navigate()` drops the hash, so by the time the
 * login screen mounts the reason is gone. Capturing it here keeps it readable.
 */
const capturedLinkError: AuthLinkError | null = (() => {
  if (typeof window === 'undefined') return null
  return readAuthLinkError(window.location.hash, window.location.search)
})()

export function getAuthLinkError(): AuthLinkError | null {
  return capturedLinkError
}

/** Clearing the auth params stops a reload from re-showing a stale error. */
export function clearAuthParams(): void {
  if (typeof window === 'undefined') return
  const { pathname, search, hash } = window.location
  if (!/error|code=|token|type=recovery/.test(`${search}${hash}`)) return
  window.history.replaceState(null, '', pathname)
}

/**
 * The page to return to after signing in. `?next=<path>` is only honoured for
 * in-app absolute paths, so it can never become an open redirect.
 */
export function safeNextPath(search?: string): string {
  const raw = new URLSearchParams((search ?? currentSearch()).replace(/^\?/, '')).get('next')
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  const [path] = raw.split(/[?#]/)
  if (!path || RESERVED_PATHS.has(path)) return '/'
  return raw
}

/** Login URL that remembers where the user was headed. */
export function loginPathWithNext(current: string): string {
  const [path] = current.split(/[?#]/)
  if (!path || path === '/' || RESERVED_PATHS.has(path)) return LOGIN_PATH
  return `${LOGIN_PATH}?next=${encodeURIComponent(current)}`
}

function currentSearch(): string {
  if (typeof window !== 'undefined') return window.location.search
  return ''
}
