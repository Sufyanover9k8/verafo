import type { ActionFunctionArgs } from "@remix-run/node";
import { getSupabase } from "../lib/supabase.server";
import { planOf, recordUsage } from "../lib/billing.server";

/**
 * Bill the credits a store used above its plan.
 *
 * Shopify bills usage in arrears: we add one usage record per cycle with the
 * overage credits converted at the plan's rate, capped at the plan's limit.
 * Runs from a cron with the shared secret; safe to call repeatedly because
 * the record carries an idempotency key and the store row remembers how many
 * credits were already billed.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const supabase = getSupabase();
  const secret = request.headers.get("x-verafo-secret");
  const { data: config } = await supabase
    .from("verafo_config")
    .select("key, value")
    .in("key", ["queue_secret", "cron_secret"]);
  const allowed = (config ?? []).map((row) => String(row.value));
  if (!secret || !allowed.includes(secret)) {
    return Response.json({ error: "not allowed" }, { status: 401 });
  }

  const { data: plans } = await supabase
    .from("store_plans")
    .select("store_id, plan_name, subscription_id, usage_line_item_id, included_credits, overage_pkr_per_credit, overage_cap_credits, overage_billed_credits, cycle_start, cycle_end, shop, stores(id, shopify_domain, name)");

  const report: { store: string; billed: number; credits: number; skipped?: string }[] = [];
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  for (const row of plans ?? []) {
    const store = row.stores as { shopify_domain?: string | null; name?: string | null } | null;
    const shop = String(row.shop ?? store?.shopify_domain ?? "");
    const plan = planOf(String(row.plan_name ?? "free"));
    const rate = Number(row.overage_pkr_per_credit ?? plan.overagePkrPerCredit);
    const cap = Number(row.overage_cap_credits ?? plan.overageCapCredits);
    const included = Number(row.included_credits ?? plan.includedCredits);

    if (!row.subscription_id || !row.usage_line_item_id || rate <= 0 || cap <= 0) {
      report.push({ store: shop, billed: 0, credits: 0, skipped: "no usage line item" });
      continue;
    }

    const { data: events } = await supabase
      .from("credit_events")
      .select("credits")
      .eq("store_id", row.store_id)
      .gte("occurred_at", monthStart.toISOString());
    const used = (events ?? []).reduce((sum, e) => sum + Number(e.credits ?? 0), 0);
    const overage = Math.max(0, Math.min(cap, used - included));
    const already = Number(row.overage_billed_credits ?? 0);
    const credits = Math.max(0, Math.floor(overage - already));
    if (credits <= 0) {
      report.push({ store: shop, billed: 0, credits: 0, skipped: "nothing over the plan" });
      continue;
    }

    const { data: session } = await supabase
      .from("Session")
      .select('shop, "accessToken"')
      .eq("shop", shop)
      .eq("isOnline", false)
      .order("expires", { ascending: false })
      .limit(1)
      .maybeSingle();
    const token = (session as { accessToken?: string } | null)?.accessToken;
    if (!token) {
      report.push({ store: shop, billed: 0, credits, skipped: "no offline token" });
      continue;
    }

    const amount = Math.round(credits * rate * 100) / 100;
    const admin = {
      // Same shape as the session client, so both paths share one writer.
      graphql: (query: string, options?: { variables?: Record<string, unknown> }) =>
        fetch(`https://${shop}/admin/api/2026-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ query, variables: options?.variables ?? {} }),
        }),
    };

    try {
      const cycle = String(row.cycle_start ?? monthStart.toISOString().slice(0, 10));
      await recordUsage(
        admin,
        String(row.usage_line_item_id),
        amount,
        `Verafo credits: ${credits} over the ${plan.name} plan (${cycle})`,
        `${row.store_id}:${cycle}:${already + credits}`,
      );
      await supabase
        .from("store_plans")
        .update({ overage_billed_credits: already + credits, updated_at: new Date().toISOString() })
        .eq("store_id", row.store_id);
      report.push({ store: shop, billed: amount, credits });
    } catch (error) {
      report.push({
        store: shop,
        billed: 0,
        credits,
        skipped: error instanceof Error ? error.message : "usage record failed",
      });
    }
  }

  return Response.json({ billed: report.filter((r) => r.billed > 0).length, report });
};

export const loader = async () =>
  Response.json({ error: "POST with x-verafo-secret to bill overage" }, { status: 405 });
