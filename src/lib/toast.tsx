import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
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
  success: { icon: 'checkmark-circle', color: 'var(--green)', border: 'var(--green-soft)' },
  error: { icon: 'alert-circle', color: 'var(--red)', border: 'var(--red-soft)' },
  info: { icon: 'information-circle', color: 'var(--accent)', border: 'var(--accent-soft)' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = nextId.current++
    setToasts((prev) => [...prev.slice(-3), { ...t, id }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id))
    }, 4800)
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
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
