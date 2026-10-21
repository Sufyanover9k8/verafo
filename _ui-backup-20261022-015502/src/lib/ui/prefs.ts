/* ============================================================
   ui/prefs.ts — the merchant's own display preferences, kept on
   their device only. Nothing here is ever sent to the server.

   Every read and write is wrapped in try/catch: private browsing
   and full storage both throw, and a preference is never worth
   breaking a page for.
   ============================================================ */

const NAMESPACE = 'verafo.ui.'

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(NAMESPACE + key)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(NAMESPACE + key)
    else localStorage.setItem(NAMESPACE + key, value)
  } catch {
    /* storage unavailable — the page still works, the choice is just not kept */
  }
}

export function readJsonPref<T>(key: string, fallback: T): T {
  const raw = readPref(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJsonPref(key: string, value: unknown): void {
  try {
    writePref(key, JSON.stringify(value))
  } catch {
    /* nothing to do */
  }
}
