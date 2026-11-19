import { buyerLabel, type NamedOrder } from '@/lib/buyer-name'

/**
 * A buyer's name with the phone number underneath, or the phone alone when no
 * name is known. Used in the Orders table, Outcomes, the dashboard attention
 * list and the order detail panel so every surface agrees.
 */
export function BuyerName({
  order,
  primaryClassName = 'text-[13px] font-medium text-foreground',
  secondaryClassName = 'font-mono text-[11px] text-muted-foreground',
  align = 'start',
}: {
  order: NamedOrder
  primaryClassName?: string
  secondaryClassName?: string
  align?: 'start' | 'end'
}) {
  const { primary, secondary } = buyerLabel(order)
  return (
    <span
      className={`flex min-w-0 flex-col leading-tight ${align === 'end' ? 'items-end text-right' : 'items-start'}`}
    >
      <span className={`truncate ${primaryClassName}`}>{primary}</span>
      {secondary ? <span className={`truncate ${secondaryClassName}`}>{secondary}</span> : null}
    </span>
  )
}
