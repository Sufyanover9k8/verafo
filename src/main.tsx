import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './index.css'
import { ThemeProvider } from './lib/theme'
import { ToastProvider } from './lib/toast'
import { SessionProvider } from './lib/session'
import { StoreScopeProvider } from './lib/store'
import { CommandPaletteProvider } from './components/layout/CommandPalette'

/*
 * A deploy replaces every hashed chunk. A tab that is still open then asks for a
 * file that no longer exists, and the route it was navigating to dies mid-load —
 * the merchant sees a blank screen with no way forward. Reload once to pick up
 * the new build; a second failure inside the same window falls through to the
 * route boundary's card instead of looping.
 */
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const key = 'verafo.preload.reloadedAt'
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0)
    if (last && Date.now() - last < 15_000) return
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    /* private mode: reload anyway */
  }
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <ToastProvider>
          <SessionProvider>
            <StoreScopeProvider>
              <CommandPaletteProvider>
                <App />
              </CommandPaletteProvider>
            </StoreScopeProvider>
          </SessionProvider>
        </ToastProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
