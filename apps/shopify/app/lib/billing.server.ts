import { getSupabase } from "./supabase.server";

/**
 * Shopify Billing for Verafo.
 *
 * One rail: every account signs in with a Shopify store, so the subscription
 * lives on the shop. Credits are our own bookkeeping — the recurring charge
 * pays for the plan's included credits and a capped usage line item pays for
 * anything above them.
 *
 *   1 check      = 1 credit
 *   1 call minute = 1 credit (rounded up)
 */

export interface AdminGraphql {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export type PlanCode = "free" | "standard" | "founder";

export interface PlanDef {
  code: PlanCode;
  name: string;
  pricePkr: number;
  includedCredits: number;
  overagePkrPerCredit: number;
  overageCapCredits: number;
  trialDays: number;
  tagline: string;
}

/** Mirrors the `plans` table; the database is the source of truth at runtime. */
export const PLANS: PlanDef[] = [
  {
    code: "free",
    name: "Free",
    pricePkr: 0,
    includedCredits: 100,
    overagePkrPerCredit: 0,
    overageCapCredits: 0,
    trialDays: 0,
    tagline: "100 checks a month. No card, no trial clock.",
  },
  {
    code: "standard",
    name: "Standard",
    pricePkr: 6999,
    includedCredits: 333,
    overagePkrPerCredit: 21,
    overageCapCredits: 333,
    trialDays: 7,
    tagline: "333 credits a month, then PKR 21 a credit.",
  },
  {
    code: "founder",
    name: "Founder One",
    pricePkr: 12499,
    includedCredits: 781,
    overagePkrPerCredit: 16,
    overageCapCredits: 781,
    trialDays: 45,
    tagline: "781 credits a month, then PKR 16 a credit. Price locked.",
  },
];

export function planOf(code: string | null | undefined): PlanDef {
  return PLANS.find((p) => p.code === code) ?? PLANS[0];
}

/** Read the plan prices from the database so the two never drift. */
export async function loadPlans(): Promise<PlanDef[]> {
  const { data } = await getSupabase()
    .from("plans")
    .select("code, name, price_pkr, included_credits, overage_pkr_per_credit, overage_cap_credits, trial_days, sort_order")
    .order("sort_order", { ascending: true });
  if (!data?.length) return PLANS;
  return data.map((row) => {
    const fallback = planOf(String(row.code));
    return {
      code: String(row.code) as PlanCode,
      name: String(row.name ?? fallback.name),
      pricePkr: Number(row.price_pkr ?? fallback.pricePkr),
      includedCredits: Number(row.included_credits ?? fallback.includedCredits),
      overagePkrPerCredit: Number(row.overage_pkr_per_credit ?? fallback.overagePkrPerCredit),
      overageCapCredits: Number(row.overage_cap_credits ?? fallback.overageCapCredits),
      trialDays: Number(row.trial_days ?? fallback.trialDays),
      tagline: fallback.tagline,
    };
  });
}

async function gql<T>(
  admin: AdminGraphql,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const body = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  if (!body.data) throw new Error("Shopify returned no data");
  return body.data;
}

export interface ShopifySubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  recurringPkr: number | null;
  usageLineItemId: string | null;
  usageCappedPkr: number | null;
  usageBalancePkr: number | null;
}

const SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                price { amount currencyCode }
                interval
              }
              ... on AppUsagePricing {
                cappedAmount { amount currencyCode }
                balanceUsed { amount currencyCode }
                terms
              }
            }
          }
        }
      }
    }
  }
`;

interface SubscriptionNode {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  lineItems: {
    id: string;
    plan: {
      pricingDetails:
        | { __typename: "AppRecurringPricing"; price: { amount: string }; interval: string }
        | {
            __typename: "AppUsagePricing";
            cappedAmount: { amount: string };
            balanceUsed: { amount: string };
            terms: string;
          }
        | { __typename: string };
    };
  }[];
}

/** The shop's live subscription, if it has one. */
export async function activeSubscription(
  admin: AdminGraphql,
): Promise<ShopifySubscription | null> {
  const data = await gql<{
    currentAppInstallation: { activeSubscriptions: SubscriptionNode[] };
  }>(admin, SUBSCRIPTIONS_QUERY);
  const node = data.currentAppInstallation.activeSubscriptions?.[0];
  if (!node) return null;

  let recurringPkr: number | null = null;
  let usageLineItemId: string | null = null;
  let usageCappedPkr: number | null = null;
  let usageBalancePkr: number | null = null;

  for (const line of node.lineItems ?? []) {
    const details = line.plan?.pricingDetails;
    if (!details) continue;
    if (details.__typename === "AppRecurringPricing") {
      recurringPkr = Number((details as { price: { amount: string } }).price.amount);
    }
    if (details.__typename === "AppUsagePricing") {
      const usage = details as {
        cappedAmount: { amount: string };
        balanceUsed: { amount: string };
      };
      usageLineItemId = line.id;
      usageCappedPkr = Number(usage.cappedAmount.amount);
      usageBalancePkr = Number(usage.balanceUsed.amount);
    }
  }

  return {
    id: node.id,
    name: node.name,
    status: node.status,
    test: Boolean(node.test),
    trialDays: Number(node.trialDays ?? 0),
    currentPeriodEnd: node.currentPeriodEnd ?? null,
    recurringPkr,
    usageLineItemId,
    usageCappedPkr,
    usageBalancePkr,
  };
}

const CREATE_SUBSCRIPTION = `#graphql
  mutation CreateSubscription($name: String!, $returnUrl: URL!, $test: Boolean, $trialDays: Int, $recurring: MoneyInput!, $capped: MoneyInput!, $terms: String!) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
      lineItems: [
        { plan: { appRecurringPricingDetails: { price: $recurring, interval: EVERY_30_DAYS } } }
        { plan: { appUsagePricingDetails: { cappedAmount: $capped, terms: $terms } } }
      ]
    ) {
      confirmationUrl
      appSubscription { id }
      userErrors { field message }
    }
  }
`;

/**
 * Start a subscription and return the URL the merchant must approve. The
 * usage line item is always capped: Shopify refuses uncapped usage pricing,
 * and a cap is what stops a runaway call bill.
 */
export async function createSubscription(
  admin: AdminGraphql,
  plan: PlanDef,
  returnUrl: string,
  test: boolean,
): Promise<string> {
  const capPkr = Math.max(1, plan.overageCapCredits * plan.overagePkrPerCredit);
  const data = await gql<{
    appSubscriptionCreate: {
      confirmationUrl: string | null;
      userErrors: { message: string }[];
    };
  }>(admin, CREATE_SUBSCRIPTION, {
    name: `Verafo ${plan.name}`,
    returnUrl,
    test,
    trialDays: plan.trialDays,
    recurring: { amount: plan.pricePkr.toFixed(2), currencyCode: "PKR" },
    capped: { amount: capPkr.toFixed(2), currencyCode: "PKR" },
    terms: `${plan.overagePkrPerCredit} PKR per credit above ${plan.includedCredits}`,
  });

  const errors = data.appSubscriptionCreate.userErrors ?? [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  const url = data.appSubscriptionCreate.confirmationUrl;
  if (!url) throw new Error("Shopify did not return a confirmation URL");
  return url;
}

const CANCEL_SUBSCRIPTION = `#graphql
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

export async function cancelSubscription(admin: AdminGraphql, id: string) {
  const data = await gql<{
    appSubscriptionCancel: { userErrors: { message: string }[] };
  }>(admin, CANCEL_SUBSCRIPTION, { id });
  const errors = data.appSubscriptionCancel.userErrors ?? [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

const USAGE_RECORD = `#graphql
  mutation RecordUsage($lineItemId: ID!, $price: MoneyInput!, $description: String!, $key: String) {
    appUsageRecordCreate(
      subscriptionLineItemId: $lineItemId
      price: $price
      description: $description
      idempotencyKey: $key
    ) {
      appUsageRecord { id }
      userErrors { field message }
    }
  }
`;

export async function recordUsage(
  admin: AdminGraphql,
  lineItemId: string,
  pkr: number,
  description: string,
  idempotencyKey: string,
) {
  const data = await gql<{
    appUsageRecordCreate: { userErrors: { message: string }[] };
  }>(admin, USAGE_RECORD, {
    lineItemId,
    price: { amount: pkr.toFixed(2), currencyCode: "PKR" },
    description,
    key: idempotencyKey,
  });
  const errors = data.appUsageRecordCreate.userErrors ?? [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

export interface StoredPlan {
  storeId: string;
  planCode: string;
  status: string;
  subscriptionId: string | null;
  usageLineItemId: string | null;
  includedCredits: number | null;
  overagePkrPerCredit: number | null;
  overageCapCredits: number | null;
  currentPeriodEnd: string | null;
}

/** Write the subscription back to the store so the dashboard can meter it. */
export async function saveStorePlan(
  storeId: string,
  shop: string,
  plan: PlanDef,
  subscription: ShopifySubscription | null,
) {
  const supabase = getSupabase();
  const now = new Date();
  const cycleEnd = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const row = {
    store_id: storeId,
    plan_name: plan.code,
    status: subscription ? "active" : plan.code === "free" ? "active" : "pending",
    subscription_id: subscription?.id ?? null,
    usage_line_item_id: subscription?.usageLineItemId ?? null,
    included_credits: plan.includedCredits,
    overage_pkr_per_credit: plan.overagePkrPerCredit,
    overage_cap_credits: plan.overageCapCredits,
    current_period_end: cycleEnd.toISOString(),
    cycle_start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
    cycle_end: cycleEnd.toISOString().slice(0, 10),
    shop,
    suspended: false,
    updated_at: now.toISOString(),
  };

  const { error } = await supabase.from("store_plans").upsert(row, { onConflict: "store_id" });
  if (error) throw new Error(`Could not save the plan: ${error.message}`);
}

export async function readStoredPlan(storeId: string) {
  const { data } = await getSupabase()
    .from("store_plans")
    .select("*")
    .eq("store_id", storeId)
    .maybeSingle();
  return data ?? null;
}
