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
