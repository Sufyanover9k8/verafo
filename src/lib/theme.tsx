import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light' | 'system'

const THEME_KEY = 'verafo.theme'
const MOTION_KEY = 'verafo.reducedMotion'

function systemDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

function resolveTheme(theme: Theme): 'dark' | 'light' {
  return theme === 'system' ? (systemDark() ? 'dark' : 'light') : theme
}

export function applyPrefs(theme: Theme, reducedMotion: boolean) {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(theme)
  if (reducedMotion) root.dataset.motion = 'off'
  else delete root.dataset.motion
}

interface ThemeContextValue {
  theme: Theme
  reducedMotion: boolean
  setTheme: (t: Theme) => void
  setReducedMotion: (v: boolean) => void
  resolved: 'dark' | 'light'
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'system' ? v : 'dark'
  })
  const [reducedMotion, setReducedMotionState] = useState(() => localStorage.getItem(MOTION_KEY) === '1')
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => resolveTheme(theme))

  useEffect(() => {
    applyPrefs(theme, reducedMotion)
    setResolved(resolveTheme(theme))
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (theme === 'system') setResolved(systemDark() ? 'dark' : 'light')
    }
    mq?.addEventListener?.('change', onChange)
    return () => mq?.removeEventListener?.('change', onChange)
  }, [theme, reducedMotion])

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(THEME_KEY, t)
    setThemeState(t)
  }, [])

  const setReducedMotion = useCallback((v: boolean) => {
    localStorage.setItem(MOTION_KEY, v ? '1' : '0')
    setReducedMotionState(v)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, reducedMotion, resolved, setTheme, setReducedMotion }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
