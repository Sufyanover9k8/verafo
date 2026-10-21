import { usePlan } from '@/hooks/use-plan'

/**
 * The shop's current plan, as a static teal pill.
 *
 * The website's other plan name, Founder One, is not used here: Shopify
 * App Pricing carries Free, Standard and Advanced. Whatever name Shopify
 * reports is shown verbatim — it is never renamed, normalised or guessed.
 * Renders nothing at all when the plan is unknown, when Supabase is
 * unreachable, or before `store_plans` exists.
 *
 * No price, no dropdown, no upgrade button, no allowance or count.
 */
export function PlanBadge() {
  const plan = usePlan()
  if (!plan) return null

  return (
    <span
      className="inline-flex h-7 items-center rounded-full border border-[color-mix(in_srgb,var(--teal)_35%,transparent)] bg-accent px-3 font-mono text-[11.5px] font-medium tracking-[0.14em] text-accent-foreground uppercase whitespace-nowrap"
      title={`Current plan: ${plan}`}
    >
      {plan}
    </span>
  )
}
