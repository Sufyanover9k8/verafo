import { Icon } from './Icon'

export function NeedsSetup() {
  return (
    <div className="setup-card">
      <div className="setup-icon">
        <Icon name="cloud-offline-outline" size={34} />
      </div>
      <h2>Supabase not configured</h2>
      <p>
        Copy <code>.env.example</code> to <code>.env</code> and set{' '}
        <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> from your
        Supabase project, then run <code>npm run dev</code> again.
      </p>
      <p className="setup-muted">
        Also make sure you have run <code>supabase/schema.sql</code> (and optionally{' '}
        <code>supabase/seed.sql</code>) in the Supabase SQL editor.
      </p>
    </div>
  )
}

export function EmptyState({ icon, title, detail }: { icon: string; title: string; detail?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={30} />
      </div>
      <div className="empty-title">{title}</div>
      {detail && <div className="empty-detail">{detail}</div>}
    </div>
  )
}
