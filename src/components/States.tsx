import { createElement, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  CloudOff,
  ClipboardList,
  Fingerprint,
  Hourglass,
  Info,
  Package,
  ShieldCheck,
  Store,
  Timer,
} from 'lucide-react'

/**
 * The handful of legacy Ionicons names the app still passes to EmptyState.
 * Pages that already use lucide pass nothing and get the default. Kept as a
 * tiny lookup rather than a general icon shim, so it cannot grow into a second
 * icon system.
 */
const LEGACY_ICONS: Record<string, LucideIcon> = {
  'information-circle': Info,
  'alert-circle': AlertTriangle,
  'checkmark-done': ClipboardList,
  clipboard: ClipboardList,
  fingerprint: Fingerprint,
  package: Package,
  storefront: Store,
  'shield-checkmark': ShieldCheck,
  time: Timer,
  'hourglass-outline': Hourglass,
  'cloud-offline-outline': CloudOff,
}

/**
 * The glyph for a legacy icon name. Built with createElement rather than
 * `const Icon = lookup(name)` so no component is bound to a local inside a
 * render body, which the React compiler rules reject.
 */
function emptyGlyph(name: string | undefined, className: string): ReactNode {
  const Glyph = (name && LEGACY_ICONS[name]) || Info
  return createElement(Glyph, { className, 'aria-hidden': true })
}

/** The quiet block a page shows when Supabase has not been configured yet. */
export function NeedsSetup() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="flex max-w-lg flex-col items-center gap-3 rounded-[16px] border border-border bg-card p-8 text-center">
        <span className="grid size-12 place-items-center rounded-[16px] bg-muted text-muted-foreground">
          <CloudOff className="size-6" aria-hidden="true" />
        </span>
        <h2 className="text-[18px] font-semibold text-foreground">Supabase not configured</h2>
        <p className="text-[13.5px] text-muted-foreground">
          Copy <code className="font-mono text-[12.5px]">.env.example</code> to{' '}
          <code className="font-mono text-[12.5px]">.env</code> and set{' '}
          <code className="font-mono text-[12.5px]">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono text-[12.5px]">VITE_SUPABASE_ANON_KEY</code> from your Supabase project, then run{' '}
          <code className="font-mono text-[12.5px]">npm run dev</code> again.
        </p>
        <p className="text-[12.5px] text-muted-foreground">
          Also make sure you have run <code className="font-mono">supabase/schema.sql</code> (and optionally{' '}
          <code className="font-mono">supabase/seed.sql</code>) in the Supabase SQL editor.
        </p>
      </div>
    </div>
  )
}

interface EmptyStateProps {
  icon?: string
  title: string
  detail?: string
  /** One action, usually a link or button the caller renders. */
  action?: React.ReactNode
}

/** A card-sized "nothing here" block: an icon, one title, one plain line. */
export function EmptyState({ icon, title, detail, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
        {emptyGlyph(icon, 'size-5')}
      </span>
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      {detail && <p className="max-w-md text-[13.5px] text-muted-foreground">{detail}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
