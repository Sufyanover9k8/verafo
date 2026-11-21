import { phone } from './format'

/**
 * The buyer fields the display helpers need. Phone numbers stay the identity
 * everywhere in the backend; this is presentation only.
 */
export interface NamedOrder {
  buyer_phone: string
  /** Per-order name: what Shopify or a call correction recorded for this parcel. */
  order_fulfillment?: { customer_name?: string | null } | null
  /** Last name seen for the phone, a fallback for orders with no per-order name. */
  buyers?: { name?: string | null } | null
}

/**
 * Name for an order, in precedence order:
 *   per-order name (Shopify label / call correction) -> buyer name -> null.
 * The buyer name is deliberately second: one phone can belong to several
 * people, and the parcel is addressed to the per-order name.
 */
export function customerNameOfOrder(order: NamedOrder): string | null {
  const perOrder = order.order_fulfillment?.customer_name?.trim()
  if (perOrder) return perOrder
  const perBuyer = order.buyers?.name?.trim()
  return perBuyer ? perBuyer : null
}

/**
 * What to print for a buyer: the name with the number underneath, or exactly
 * today's phone-only rendering when no name is known. Never blank, never
 * "Unknown".
 */
export function buyerLabel(order: NamedOrder): { primary: string; secondary: string | null } {
  const name = customerNameOfOrder(order)
  const number = phone(order.buyer_phone)
  return name ? { primary: name, secondary: number } : { primary: number, secondary: null }
}
