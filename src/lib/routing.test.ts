import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_SECTIONS, SETTINGS_ITEM } from '@/components/layout/nav'

/*
 * The public site lives at `/` and the app lives under `/dashboard`. Two things
 * keep that true and neither is visible from a component test:
 *
 *   1. vercel.json must hand `/` to the marketing page BEFORE the filesystem
 *      pass, otherwise the static index resolution serves the SPA shell at `/`
 *      and the rewrite never runs.
 *   2. Every in-app link must point at /dashboard, and every link inside the
 *      copied marketing pages must point at a file that actually ships — a
 *      leftover `href="login.html"` would be a 404 once the app owns /login.
 */

const root = join(__dirname, '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('deployment routing', () => {
  const vercel = JSON.parse(read('vercel.json')) as {
    routes: { src?: string; dest?: string; handle?: string }[]
  }

  it('serves the marketing home at / before touching the filesystem', () => {
    expect(vercel.routes[0]).toEqual({ src: '^/$', dest: '/home.html' })
    // The filesystem pass has to come after that rule, or /index.html wins /.
    const filesystemAt = vercel.routes.findIndex((r) => r.handle === 'filesystem')
    expect(filesystemAt).toBeGreaterThan(0)
    expect(vercel.routes[filesystemAt + 1]).toEqual({ src: '^/(.*)$', dest: '/index.html' })
  })

  it('ships the marketing pages the site links to', () => {
    const home = read('public/home.html')
    const linked = [...home.matchAll(/href="([a-z0-9-]+\.html)"/g)].map((m) => m[1])
    expect(linked.length).toBeGreaterThan(0)
    for (const page of new Set(linked)) {
      expect(existsSync(join(root, 'public', page)), `${page} is linked but not shipped`).toBe(true)
    }
    expect(home).toContain('Verafo')
  })

  it('points every marketing sign-in at the app, not a file that no longer exists', () => {
    for (const page of ['home.html', 'pricing.html', 'about.html', 'features.html', 'how-it-works.html']) {
      const html = read(join('public', page))
      expect(html, `${page} still links the old login.html`).not.toContain('href="login.html')
      expect(html, `${page} still links the old index.html`).not.toContain('href="index.html')
    }
  })
})

describe('auth links land in the app, not on the marketing page', () => {
  /*
   * `/` is static marketing HTML: a Supabase session that arrives there in the
   * URL hash is never read, so the merchant was left sitting on the website
   * after signing in. Every auth link must therefore point at a route the app
   * owns, and the marketing page must forward anything that still arrives.
   */
  it('sends OAuth, confirmation and reset links to /dashboard', () => {
    const auth = read('src/pages/Auth.tsx')
    const redirects = [...auth.matchAll(/(?:emailRedirectTo|redirectTo):\s*`\$\{window\.location\.origin\}(\/[a-z]*)`/g)].map((m) => m[1])
    expect(redirects.length).toBeGreaterThanOrEqual(3) // password confirm, Google, reset
    for (const target of redirects) expect(target).toBe('/dashboard')
    expect(auth).not.toContain('origin}/`')
  })

  it('makes the marketing home hand auth URLs to the app', () => {
    const home = read('public/home.html')
    expect(home).toContain("window.location.replace('/dashboard'")
    // The markers that matter: implicit-flow session, PKCE code, recovery links.
    for (const marker of ['access_token=', 'type=recovery', 'code=']) {
      expect(home).toContain(marker)
    }
  })
})

describe('in-app routing', () => {
  const links = NAV_SECTIONS.flatMap((section) => section.items).map((item) => item.to)

  it('puts the dashboard at /dashboard and never at /', () => {
    expect(links).toContain('/dashboard')
    expect(links).not.toContain('/')
    expect(SETTINGS_ITEM.to).toBe('/settings')
  })

  it('keeps the routes a merchant types out of the marketing site', () => {
    const app = read('src/App.tsx')
    expect(app).toContain('path="/dashboard"')
    // `/` inside the router is only ever a redirect to the dashboard.
    expect(app).toMatch(/<Route path="\/" element=\{<Navigate to="\/dashboard" replace \/>\}/)
    expect(app).toMatch(/<Route path="\*" element=\{<Navigate to="\/dashboard" replace \/>\}/)
    expect(app).not.toContain('<Route path="/" element={<Dashboard />} />')
  })
})
