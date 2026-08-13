/* greeting.ts — time-of-day greeting, personalised with the first name. */

export type GreetingPart = 'morning' | 'afternoon' | 'evening'

export function partForHour(hour: number): GreetingPart {
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

export function greetingForName(
  name: string | null | undefined,
  hour = new Date().getHours(),
): string {
  const part = partForHour(hour)
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? `Good ${part}, ${first}.` : `Good ${part}.`
}