import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { ensureStoreLink } from "../lib/verafo";
import { getSupabase } from "../lib/supabase.server";

/**
 * Records the shop's active App Pricing plan so the dashboard can show it.
 *
 * READ-ONLY with respect to billing: this handler never creates, changes or
 * cancels a subscription. It only reads the plan Shopify already applied and
 * copies the name into Supabase.
 *
 * The webhook payload is used only as a trigger. The plan name is re-read from
 * the Admin API so the stored value always matches the live subscription.
 */

const ACTIVE_PLAN_QUERY = `#graphql
  query VerafoActivePlan {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                planHandle
              }
            }
          }
        }
      }
    }
  }`;

interface ActiveSubscription {
  id?: string | null;
  name?: string | null;
  status?: string | null;
  currentPeriodEnd?: string | null;
  lineItems?: {
    plan?: { pricingDetails?: { planHandle?: string | null } | null } | null;
  }[] | null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // The webhook session is offline, so fetch an offline admin client.
    const { admin } = await unauthenticated.admin(shop);

    const response = await admin.graphql(ACTIVE_PLAN_QUERY);
    const json = (await response.json()) as {
      data?: { currentAppInstallation?: { activeSubscriptions?: ActiveSubscription[] | null } | null };
      errors?: unknown;
    };
    if (json.errors) {
      throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
    }

    const subs = json.data?.currentAppInstallation?.activeSubscriptions ?? [];
    if (subs.length === 0) {
      console.log(`No active subscription for ${shop}; nothing written.`);
      return new Response();
    }

    // Shopify can return more than one subscription. Prefer the one ACTIVE
    // now; otherwise the most recent by period end. Status is compared
    // case-insensitively so this does not depend on the exact casing Shopify
    // uses in this API version.
    const isActive = (s: ActiveSubscription) => (s.status ?? "").toUpperCase() === "ACTIVE";
    const plan =
      subs.find(isActive) ??
      [...subs].sort((a, b) =>
        String(b.currentPeriodEnd ?? "").localeCompare(String(a.currentPeriodEnd ?? "")),
      )[0];

    // Never invent a plan. If Shopify reports no name, write nothing.
    const planName = plan?.name?.trim();
    if (!planName) {
      console.log(`Subscription for ${shop} has no plan name; nothing written.`);
      return new Response();
    }

    const storeId = await ensureStoreLink(shop);
    const supabase = getSupabase();
    const { error } = await supabase.from("store_plans").upsert(
      {
        store_id: storeId,
        plan_name: planName,
        status: plan?.status ?? null,
        subscription_id: plan?.id ?? null,
        current_period_end: plan?.currentPeriodEnd ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" },
    );
    if (error) {
      throw new Error(`store_plans upsert failed: ${error.message}`);
    }

    console.log(`Stored plan "${planName}" for ${shop}.`);
  } catch (err) {
    console.error(`${topic} handling failed for ${shop}:`, err);
    // Non-2xx tells Shopify to retry the webhook later.
    return new Response(null, { status: 500 });
  }

  return new Response();
};
