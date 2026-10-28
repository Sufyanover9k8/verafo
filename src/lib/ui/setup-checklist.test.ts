import { describe, expect, it } from 'vitest'
import { REMIND_AFTER_MS, parseCollapsedAt, setupCardMode } from './setup-checklist'

const now = Date.UTC(2026, 9, 28, 12, 0, 0)
const day = 24 * 60 * 60 * 1000

describe('setup checklist mode', () => {
  it('shows the full card while nothing is collapsed', () => {
    expect(setupCardMode({ allDone: false, collapsedAt: null, now })).toBe('full')
  })

  it('never nags a merchant who finished', () => {
    expect(setupCardMode({ allDone: true, collapsedAt: null, now })).toBe('hidden')
    expect(setupCardMode({ allDone: true, collapsedAt: now - day, now })).toBe('hidden')
  })

  it('keeps a reminder on screen right after the merchant hides the card', () => {
    expect(setupCardMode({ allDone: false, collapsedAt: now, now })).toBe('compact')
    expect(setupCardMode({ allDone: false, collapsedAt: now - 6 * day, now })).toBe('compact')
  })

  it('re-expands the full card once the reminder has expired', () => {
    expect(setupCardMode({ allDone: false, collapsedAt: now - REMIND_AFTER_MS, now })).toBe('full')
    expect(setupCardMode({ allDone: false, collapsedAt: now - 30 * day, now })).toBe('full')
  })

  it('reads the stored value defensively', () => {
    expect(parseCollapsedAt(String(now), now)).toBe(now)
    // The legacy permanent flag must not keep the card hidden forever.
    expect(parseCollapsedAt('1', now)).toBeNull()
    expect(parseCollapsedAt('', now)).toBeNull()
    expect(parseCollapsedAt(null, now)).toBeNull()
    expect(parseCollapsedAt('not-a-number', now)).toBeNull()
    // Clock moved backwards: ignore rather than hide until that date.
    expect(parseCollapsedAt(String(now + day), now)).toBeNull()
  })
})
