export type Outcome = 'accepted' | 'refused' | 'pending'

const META: Record<Outcome, { label: string; cls: string }> = {
  accepted: { label: 'Accepted', cls: 'pill-ok' },
  refused: { label: 'Refused', cls: 'pill-bad' },
  pending: { label: 'Pending', cls: 'pill-pending' },
}

/** Outcome badge — semantic colours only, reserved for outcomes. */
export function Badge({ status }: { status: Outcome | null | undefined }) {
  const meta = META[status ?? 'pending'] ?? META.pending
  return (
    <span className={`pill ${meta.cls}`}>
      <span className="badge-dot" aria-hidden="true" />
      {meta.label}
    </span>
  )
}
