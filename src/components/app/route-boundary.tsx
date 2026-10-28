import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

/*
 * Nothing in this app caught a render error, so any crash inside a page — or a
 * lazy route chunk that the browser could not download because a deploy had
 * already replaced it — unmounted the whole tree and left a blank screen with no
 * way out. Every route is now wrapped, and a chunk failure heals itself.
 */

const RELOAD_KEY = 'verafo.route.reloadedAt'
/** One automatic reload per window; a second failure shows the card instead. */
const RELOAD_WINDOW_MS = 15_000

/** Browsers word this differently, and Vite wraps it per browser. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '')
  return /ChunkLoadError|dynamically imported module|Importing a module script failed|Loading chunk \d+ failed|Failed to fetch/i.test(
    message,
  )
}

interface Props {
  children: ReactNode
  /** Used in the card so the merchant knows which screen broke. */
  title?: string
}

interface State {
  error: unknown | null
}

export class RouteBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Keep the detail in the console for support; the merchant sees the card.
    console.error('Verafo: a screen failed to render', error, info.componentStack)
    if (isChunkLoadError(error) && this.canReloadOnce()) window.location.reload()
  }

  /** A stale chunk needs a reload — but never in a loop. */
  private canReloadOnce(): boolean {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
      if (last && Date.now() - last < RELOAD_WINDOW_MS) return false
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
      return true
    } catch {
      // Storage blocked (private mode): a single reload is still the right move.
      return true
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const stale = isChunkLoadError(error)
    const detail = error instanceof Error ? error.message : String(error)

    return (
      <section
        role="alert"
        aria-live="assertive"
        className="mx-auto flex max-w-[560px] flex-col items-start gap-4 rounded-[var(--r-card)] border border-border bg-card p-6"
      >
        <span className="grid size-10 place-items-center rounded-[12px] bg-risk-high-soft text-risk-high-strong">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-[17px] font-semibold text-foreground">
            {this.props.title ? `${this.props.title} didn’t load` : 'This screen didn’t load'}
          </h1>
          <p className="text-[13.5px] text-muted-foreground">
            {stale
              ? 'Verafo was updated while this tab was open, so part of the page could not be downloaded. Reloading picks up the new version — your data is untouched.'
              : 'Something in this screen failed. Your data is safe; the rest of Verafo still works.'}
          </p>
          <p className="font-mono text-[11.5px] break-words text-muted-foreground">{detail}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button className="h-11 gap-2 md:h-9" onClick={() => window.location.reload()}>
            <RotateCcw className="size-4" aria-hidden="true" /> Reload page
          </Button>
          <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
            <Link to="/dashboard" onClick={() => this.setState({ error: null })}>
              Back to dashboard <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
    )
  }
}
