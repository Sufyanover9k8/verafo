/* profile.ts — lightweight local personal info (no account system yet). */

export interface Profile {
  name: string
}

const KEY = 'verafo.profile'

export function getProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Profile>
      return { name: typeof parsed.name === 'string' ? parsed.name : '' }
    }
  } catch {
    /* not readable — fall through to empty */
  }
  return { name: '' }
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile))
  } catch {
    /* storage unavailable — ignore */
  }
}