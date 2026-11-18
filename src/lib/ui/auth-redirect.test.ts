import { describe, expect, it } from 'vitest'
import {
  authRedirect,
  clearAuthParams,
  getAuthLinkError,
  LOGIN_PATH,
  loginPathWithNext,
  readAuthLinkError,
  RESET_PASSWORD_PATH,
  safeNextPath,
} from './auth-redirect'

describe('authRedirect', () => {
  it('builds an absolute login URL on the current origin', () => {
    expect(authRedirect(LOGIN_PATH, 'http://localhost:5173')).toBe('http://localhost:5173/login')
  })

  it('builds the reset-password URL', () => {
    expect(authRedirect(RESET_PASSWORD_PATH, 'https://verafo.com')).toBe(
      'https://verafo.com/reset-password',
    )
  })

  it('adds a leading slash and trims a trailing slash from the origin', () => {
    expect(authRedirect('reset-password', 'https://verafo.com/')).toBe(
      'https://verafo.com/reset-password',
    )
  })

  it('defaults to the login path', () => {
    expect(authRedirect(undefined, 'https://verafo.vercel.app')).toBe(
      'https://verafo.vercel.app/login',
    )
  })

  it('falls back to the production origin off the browser', () => {
    expect(authRedirect(LOGIN_PATH)).toMatch(/^https?:\/\/.+\/login$/)
  })
})

describe('readAuthLinkError', () => {
  it('reads an expired-link error out of the hash', () => {
    const hash =
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    expect(readAuthLinkError(hash)).toEqual({
      code: 'otp_expired',
      description: 'Email link is invalid or has expired',
    })
  })

  it('reads the same params out of the query string', () => {
    expect(readAuthLinkError('', '?error=access_denied&error_code=otp_expired')).toEqual({
      code: 'otp_expired',
      description: 'That link is invalid or has expired.',
    })
  })

  it('returns null for a normal recovery link', () => {
    expect(readAuthLinkError('#access_token=abc&type=recovery&expires_in=3600')).toBeNull()
  })

  it('returns null for an empty url', () => {
    expect(readAuthLinkError('', '')).toBeNull()
  })
})

describe('getAuthLinkError', () => {
  it('is null when the page loaded without an auth error', () => {
    expect(getAuthLinkError()).toBeNull()
  })
})

describe('safeNextPath', () => {
  it('defaults to the dashboard', () => {
    expect(safeNextPath('')).toBe('/')
    expect(safeNextPath('?foo=bar')).toBe('/')
  })

  it('returns an in-app path', () => {
    expect(safeNextPath('?next=%2Forders')).toBe('/orders')
    expect(safeNextPath('?next=%2Forders%3Ftab%3Dpending')).toBe('/orders?tab=pending')
  })

  it('rejects external and protocol-relative URLs', () => {
    expect(safeNextPath('?next=https%3A%2F%2Fevil.example%2Fsteal')).toBe('/')
    expect(safeNextPath('?next=%2F%2Fevil.example')).toBe('/')
    expect(safeNextPath('?next=%2F%5Cevil.example')).toBe('/')
  })

  it('never loops back to the auth screens', () => {
    expect(safeNextPath('?next=%2Flogin')).toBe('/')
    expect(safeNextPath('?next=%2Freset-password')).toBe('/')
  })
})

describe('loginPathWithNext', () => {
  it('remembers the attempted page', () => {
    expect(loginPathWithNext('/orders')).toBe('/login?next=%2Forders')
    expect(loginPathWithNext('/orders/pending?filter=high')).toBe(
      '/login?next=%2Forders%2Fpending%3Ffilter%3Dhigh',
    )
  })

  it('stays on /login for the dashboard and the auth screens', () => {
    expect(loginPathWithNext('/')).toBe('/login')
    expect(loginPathWithNext('/login')).toBe('/login')
    expect(loginPathWithNext('/reset-password')).toBe('/login')
  })
})

describe('clearAuthParams', () => {
  it('does nothing without a window', () => {
    expect(() => clearAuthParams()).not.toThrow()
  })
})
