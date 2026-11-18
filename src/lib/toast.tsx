import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon'

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

const KIND_META: Record<ToastKind, { icon: string; color: string; border: string }> = {
  success: { icon: 'checkmark-circle', color: 'var(--v-safe-strong)', border: 'var(--v-safe-bg)' },
  error: { icon: 'alert-circle', color: 'var(--v-risk-strong)', border: 'var(--v-risk-bg)' },
  info: { icon: 'information-circle', color: 'var(--teal-deep)', border: 'var(--tint)' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((id) => window.clearTimeout(id))
      pending.length = 0
    }
  }, [])

  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = nextId.current++
    setToasts((prev) => [...prev.slice(-3), { ...t, id }])
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id))
    }, 4800)
    timers.current.push(timer)
  }, [])

  // The context value must be stable: pages put `toast` in their loader's
  // dependency list, so a fresh object here re-ran every page's load callback —
  // i.e. any toast caused a full data reload, and an erroring load could toast
  // itself into a reload loop.
  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => {
          const meta = KIND_META[t.kind]
          return (
            <div key={t.id} className="toast" style={{ borderLeftColor: meta.color, background: meta.border }}>
              <Icon name={meta.icon} size={18} style={{ color: meta.color, flexShrink: 0 }} />
              <div className="toast-body">
                <div className="toast-title">{t.title}</div>
                {t.detail && <div className="toast-detail">{t.detail}</div>}
              </div>
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
