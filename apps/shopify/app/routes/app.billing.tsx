import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Banner,
  Badge,
  Divider,
  List,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSupabase } from "../lib/supabase.server";
import { ensureStoreLink } from "../lib/verafo";
import {
  activeSubscription,
  cancelSubscription,
  createSubscription,
  loadPlans,
  planOf,
  readStoredPlan,
  saveStorePlan,
  type PlanDef,
} from "../lib/billing.server";

function appOrigin() {
  return (process.env.SHOPIFY_APP_URL || "https://get-verafo.vercel.app").replace(/\/$/, "");
}

interface CreditStatus {
  plan_name: string;
  included_credits: number;
  allow_overage: boolean;
  usage_ceiling_pkr: number;
  used_credits: number;
  remaining_credits: number;
  overage_credits: number;
  overage_pkr_per_credit: number;
  included_calls: number;
  used_calls: number;
  remaining_calls: number;
  overage_calls: number;
  overage_pkr_per_call: number;
  calls_one_time: boolean;
  cycle_end: string;
}

async function readCredits(storeId: string): Promise<CreditStatus | null> {
  const { data, error } = await getSupabase().rpc("store_credit_status", { p_store: storeId });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as CreditStatus) : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const storeId = await ensureStoreLink(session.shop);
  // Every store has a plan row from the first visit, so metering and the
  // overage sweep never have to guess what plan a merchant is on.
  await getSupabase().rpc('verafo_ensure_store_plan', { p_store: storeId });
  const plans = await loadPlans();

  let subscription = null;
  try {
    subscription = await activeSubscription(admin);
  } catch {
    subscription = null;
  }

  // Shopify sends the merchant back here after they approve the charge.
  const chose = url.searchParams.get("plan");
  const chargeId = url.searchParams.get("charge_id");
  let saved = false;
  if (chargeId && chose) {
    const plan = planOf(chose);
    try {
      await saveStorePlan(storeId, session.shop, plan, subscription);
      saved = true;
    } catch {
      saved = false;
    }
  }

  const stored = await readStoredPlan(storeId);
  const credits = await readCredits(storeId);

  return {
    shop: session.shop,
    plans,
    current: String(stored?.plan_name ?? "free"),
    subscription,
    credits,
    saved,
    test: process.env.SHOPIFY_TEST_CHARGES === "true",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const storeId = await ensureStoreLink(session.shop);
  const form = await request.formData();
  const code = String(form.get("code") ?? "free");

  if (code === "free") {
    const current = await activeSubscription(admin).catch(() => null);
    if (current) {
      try {
        await cancelSubscription(admin, current.id);
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not cancel the plan" };
      }
    }
    await saveStorePlan(storeId, session.shop, planOf("free"), null);
    return redirect("/app/billing");
  }

  const plan: PlanDef = planOf(code);
  const returnUrl = `${appOrigin()}/app/billing?plan=${plan.code}&shop=${encodeURIComponent(session.shop)}`;
  try {
    const confirmationUrl = await createSubscription(
      admin,
      plan,
      returnUrl,
      process.env.SHOPIFY_TEST_CHARGES === "true",
    );
    return redirect(confirmationUrl);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Shopify refused the charge" };
  }
};

function money(pkr: number) {
  return `PKR ${pkr.toLocaleString("en-PK")}`;
}

export default function Billing() {
  const { plans, current, subscription, credits, saved, test } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: string }>();
  const [busy, setBusy] = useState<string | null>(null);

  const choose = useCallback(
    (code: string) => {
      setBusy(code);
      fetcher.submit({ code }, { method: "post" });
    },
    [fetcher],
  );

  const used = Number(credits?.used_credits ?? 0);
  const included = Number(credits?.included_credits ?? planOf(current).includedCredits);
  const overage = Number(credits?.overage_credits ?? 0);
  const rate = Number(credits?.overage_pkr_per_credit ?? planOf(current).overagePkrPerCredit);
  const callsUsed = Number(credits?.used_calls ?? 0);
  const callsIncluded = Number(credits?.included_calls ?? planOf(current).includedCalls);
  const overageCalls = Number(credits?.overage_calls ?? 0);
  const callRate = Number(credits?.overage_pkr_per_call ?? planOf(current).overagePkrPerCall);
  const callsOneTime = Boolean(credits?.calls_one_time ?? planOf(current).callsOneTime);

  return (
    <Page>
      <TitleBar title="Plans and credits" />
      <BlockStack gap="400">
        {saved && (
          <Banner tone="success" title="Plan updated">
            <p>Your new plan applies from this billing cycle.</p>
          </Banner>
        )}
        {fetcher.data?.error && (
          <Banner tone="critical" title="That did not go through">
            <p>{fetcher.data.error}</p>
          </Banner>
        )}
        {test && (
          <Banner tone="warning" title="Test charges are on">
            <p>Charges are approved without money moving while SHOPIFY_TEST_CHARGES is set.</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                This cycle
              </Text>
              <Badge tone={current === "free" ? undefined : "success"}>
                {planOf(current).name}
              </Badge>
            </InlineStack>
            <Text as="p" tone="subdued">
              {used.toLocaleString()} of {included.toLocaleString()} check credits used
              {credits?.cycle_end ? ` · resets ${new Date(credits.cycle_end).toDateString()}` : ""}
            </Text>
            <ProgressBar
              progress={included > 0 ? Math.min(100, (used / included) * 100) : 0}
              size="small"
            />
            <Text as="p" tone="subdued">
              {callsUsed.toLocaleString()} of {callsIncluded.toLocaleString()} calls used
              {callsOneTime
                ? " · the free calls never reset"
                : credits?.cycle_end
                  ? ` · resets ${new Date(credits.cycle_end).toDateString()}`
                  : ""}
            </Text>
            <ProgressBar
              progress={callsIncluded > 0 ? Math.min(100, (callsUsed / callsIncluded) * 100) : 0}
              size="small"
            />
            <Text as="p" tone="subdued">
              A buyer check costs one credit and a call costs two, whatever its length. Both
              packages are included in the plan. Past them a check credit costs {money(rate)} and a
              call costs {money(callRate)}; there is no cap, so the total keeps growing and lands on
              your next Shopify invoice.
              {overage > 0
                ? ` ${overage.toLocaleString()} check credits past the package = ${money(overage * rate)} so far.`
                : ""}
              {overageCalls > 0
                ? ` ${overageCalls.toLocaleString()} calls past the package = ${money(overageCalls * callRate)} so far.`
                : ""}
              {credits?.allow_overage === false ? " The free plan stops at zero." : ""}
            </Text>
            {subscription && (
              <Text as="p" tone="subdued">
                Shopify subscription {subscription.id} · {subscription.test ? "test" : "live"} ·
                {" "}
                {subscription.currentPeriodEnd
                  ? `renews ${new Date(subscription.currentPeriodEnd).toDateString()}`
                  : "renews monthly"}
              </Text>
            )}
          </BlockStack>
        </Card>

        <Layout>
          {plans.map((plan) => {
            const active = plan.code === current;
            return (
              <Layout.Section variant="oneThird" key={plan.code}>
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingMd">
                        {plan.name}
                      </Text>
                      {active && <Badge tone="success">Current</Badge>}
                    </InlineStack>
                    <Text as="p" variant="headingLg">
                      {plan.pricePkr === 0 ? "Free" : money(plan.pricePkr)}
                      {plan.pricePkr > 0 && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {" "}
                          / month
                        </Text>
                      )}
                    </Text>
                    <Text as="p" tone="subdued">
                      {plan.tagline}
                    </Text>
                    <Divider />
                    <List type="bullet">
                      <List.Item>
                        {plan.includedCredits.toLocaleString()} check credits a month
                      </List.Item>
                      <List.Item>
                        {plan.callsOneTime
                          ? `${plan.includedCalls} calls in total, never reset`
                          : `${plan.includedCalls} calls a month`}
                      </List.Item>
                      <List.Item>
                        {plan.overagePkrPerCredit === 0
                          ? "No overage: checks and calls stop when the allowance runs out"
                          : `${money(plan.overagePkrPerCredit)} per extra credit and ${money(plan.overagePkrPerCall)} per extra call. Never stops: it keeps billing at that rate.`}
                      </List.Item>
                      <List.Item>
                        {plan.trialDays > 0 ? `${plan.trialDays}-day trial` : "No trial needed"}
                      </List.Item>
                    </List>
                    <Button
                      variant={active ? "secondary" : "primary"}
                      disabled={active || fetcher.state !== "idle"}
                      loading={busy === plan.code && fetcher.state !== "idle"}
                      onClick={() => choose(plan.code)}
                    >
                      {active ? "Your plan" : plan.code === "free" ? "Downgrade to Free" : `Switch to ${plan.name}`}
                    </Button>
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>

        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              How the charge works
            </Text>
            <Text as="p" tone="subdued">
              Shopify charges the plan price every 30 days. Checks and calls above the packages are
              billed on the same invoice at the plan rates, with no cap. Downgrades take effect
              immediately; upgrades are prorated by Shopify.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
