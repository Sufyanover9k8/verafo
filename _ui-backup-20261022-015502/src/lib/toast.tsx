import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from './utils'

type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  detail?: string
}

interface ToastContextValue {
  push: (t: Omit<ToastItem, 'id'>) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

/** One accent per kind: the icon carries the meaning, the colour reinforces it. */
const KIND: Record<ToastKind, { Icon: typeof Info; box: string; icon: string }> = {
  success: { Icon: CheckCircle2, box: 'border-s-risk-safe', icon: 'text-risk-safe-strong' },
  error: { Icon: AlertCircle, box: 'border-s-risk-high', icon: 'text-risk-high-strong' },
  info: { Icon: Info, box: 'border-s-border', icon: 'text-primary-text' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = nextId.current++
    // Keep the stack short: the newest four, so a burst cannot cover the page.
    setToasts((prev) => [...prev.slice(-3), { ...t, id }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id))
    }, 4800)
  }, [])

  /*
   * The context value MUST be stable. `{ push }` inline created a new object on
   * every provider render — that is, every time a toast appeared or expired —
   * and anything that listed `toast` in a dependency array then re-ran for
   * reasons that had nothing to do with its own inputs. On Ask Verafo that
   * reloaded the thread and cleared the in-thread failure notice the moment it
   * pushed its own error toast, so a failed answer showed the toast and then
   * nothing at all. `push` is already stable, so the memo never changes.
   */
  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col-reverse gap-2 sm:inset-x-auto sm:end-4 sm:bottom-4 sm:w-[22rem]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const { Icon, box, icon } = KIND[t.kind]
          return (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-[16px] border border-s-[3px] border-border bg-popover p-4 shadow-3',
                box,
              )}
            >
              <Icon className={cn('mt-0.5 size-[18px] shrink-0', icon)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-foreground">{t.title}</p>
                {t.detail && <p className="mt-0.5 text-[12.5px] break-words text-muted-foreground">{t.detail}</p>}
              </div>
              <button
                type="button"
                className="-me-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Dismiss notification"
                onClick={() => dismiss(t.id)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
