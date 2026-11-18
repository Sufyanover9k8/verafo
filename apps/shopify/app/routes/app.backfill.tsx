import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
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
  Select,
  Spinner,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureStoreLink } from "../lib/verafo";
import { advanceRun, abandonRun, getLatestRun, grantedScopes, startOrResumeRun } from "../lib/backfill.server";

type Range = "1m" | "3m" | "12m" | "all";

function sinceFor(range: Range): string {
  if (range === "all") return "2000-01-01T00:00:00.000Z";
  const days = range === "1m" ? 30 : range === "3m" ? 90 : 365;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const scopes = await grantedScopes(admin);
  const run = await getLatestRun(session.shop);

  return {
    shop: session.shop,
    scopes,
    run,
    // read_orders only reaches back 60 days; older history needs read_all_orders.
    canReadAll: scopes.includes("read_all_orders"),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "step");

  if (intent === "start" || intent === "reset") {
    const range = String(form.get("range") ?? "12m") as Range;
    if (range === "all") {
      // Asking for "everything" without the scope would silently look like a
      // full import while Shopify only returned 60 days.
      const scopes = await grantedScopes(admin);
      if (!scopes.includes("read_all_orders")) {
        return {
          intent,
          ok: false as const,
          error:
            "This store has not granted read_all_orders yet, so Shopify only returns the last 60 days. Pick a shorter range, or finish the access request and release a new app version.",
          run: null,
        };
      }
    }
    if (intent === "reset") {
      const stuck = await getLatestRun(session.shop);
      if (stuck && stuck.status !== "done") await abandonRun(stuck.id);
    }
    const storeId = await ensureStoreLink(session.shop, session.shop);
    const run = await startOrResumeRun(session.shop, storeId, sinceFor(range));
    return {
      intent,
      ok: true as const,
      run,
      pageOrders: 0,
      pageSkipped: 0,
      pageMissingPhone: 0,
      outcomesSkipped: 0,
    };
  }

  const existing = await getLatestRun(session.shop);
  if (!existing) {
    return { intent, ok: false as const, error: "Start an import first.", run: null };
  }
  if (existing.status !== "running") {
    return {
      intent,
      ok: true as const,
      run: existing,
      pageOrders: 0,
      pageSkipped: 0,
      pageMissingPhone: 0,
      outcomesSkipped: 0,
    };
  }

  try {
    const { run, pageOrders, pageSkipped, pageMissingPhone, outcomesSkipped } = await advanceRun(
      existing,
      admin,
    );
    return { intent, ok: true as const, run, pageOrders, pageSkipped, pageMissingPhone, outcomesSkipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { intent, ok: false as const, error: message, run: { ...existing, status: "failed" as const } };
  }
};

export default function Backfill() {
  const { scopes, run: initialRun, canReadAll } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [range, setRange] = useState<Range>("12m");

  const busy = fetcher.state !== "idle";
  const latest = fetcher.data?.run ?? initialRun;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const pageMissingPhone =
    fetcher.data && "pageMissingPhone" in fetcher.data ? fetcher.data.pageMissingPhone : 0;
  const outcomesSkipped =
    fetcher.data && "outcomesSkipped" in fetcher.data ? fetcher.data.outcomesSkipped : 0;

  const running = busy || latest?.status === "running";

  // Serverless hosts give us ~30s per request, so the browser drives the loop:
  // each response advances one page, then asks for the next until done.
  const { state, data, submit } = fetcher;
  useEffect(() => {
    if (state !== "idle" || !data || !data.ok || !data.run) return;
    if (data.run.status === "running") {
      submit({ intent: "step" }, { method: "post" });
    }
  }, [state, data, submit]);

  const summary = useMemo(() => {
    if (!latest) return null;
    return {
      fetched: latest.fetched,
      imported: latest.imported,
      skipped: latest.skipped,
      done: latest.status === "done",
      failed: latest.status === "failed",
    };
  }, [latest]);

  return (
    <Page>
      <TitleBar title="Import history" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Pull past orders from Shopify
            </Text>
            <Text as="p" tone="subdued">
              Reads your Shopify orders through the Admin API and scores them in Verafo —
              no CSV needed. Safe to run again: an order is matched on its Shopify id,
              so nothing is duplicated.
            </Text>

            {!canReadAll && (
              <Banner tone="warning" title="Only the last 60 days are available">
                <BlockStack gap="200">
                  <Text as="p">
                    Shopify limits <code>read_orders</code> to orders created in the last
                    60 days. Older history needs the <code>read_all_orders</code> scope,
                    which Shopify grants per app.
                  </Text>
                  <Text as="p">
                    Once it is approved, add it next to <code>read_orders</code> in
                    <code> shopify.app.toml</code>, release a new app version, and this page
                    will reach your full history automatically.
                  </Text>
                </BlockStack>
              </Banner>
            )}

            <InlineStack gap="300" blockAlign="end">
              <Select
                label="How far back"
                options={[
                  { label: "Last 30 days", value: "1m" },
                  { label: "Last 90 days", value: "3m" },
                  { label: "Last 12 months", value: "12m" },
                  {
                    label: canReadAll
                      ? "Everything"
                      : "Everything (needs read_all_orders)",
                    value: "all",
                  },
                ]}
                value={range}
                onChange={(v) => setRange(v as Range)}
                disabled={running}
              />
              <Button
                variant="primary"
                loading={running}
                onClick={() => fetcher.submit({ intent: "start", range }, { method: "post" })}
              >
                {latest ? "Import again" : "Import orders"}
              </Button>
              {latest?.status === "failed" && !running && (
                <Button
                  onClick={() => fetcher.submit({ intent: "reset", range }, { method: "post" })}
                >
                  Start over
                </Button>
              )}
            </InlineStack>

            {running && (
              <InlineStack gap="200" blockAlign="center">
                <Spinner size="small" accessibilityLabel="Importing orders" />
                <Text as="p" tone="subdued">
                  Working… {latest?.fetched ?? 0} orders read, {latest?.imported ?? 0} written
                  {latest?.skipped ? `, ${latest.skipped} without a phone` : ""}. Keep this tab
                  open; progress is saved after every page.
                </Text>
              </InlineStack>
            )}

            {pageMissingPhone > 0 && (
              <Banner tone="warning" title="Some orders have no customer phone">
                <Text as="p">
                  {pageMissingPhone} order(s) on the last page had no phone number, so they
                  cannot be matched to a buyer. That usually means protected customer data is
                  not approved for this store type, or the customer checked out without a phone.
                </Text>
              </Banner>
            )}

            {error && (
              <Banner tone="critical" title="Import failed">
                <Text as="p">{error}</Text>
              </Banner>
            )}

            {summary && !running && (
              <Banner
                tone={summary.failed ? "critical" : summary.done ? "success" : "info"}
                title={
                  summary.failed
                    ? "Import stopped"
                    : summary.done
                      ? "History imported"
                      : "Import in progress"
                }
              >
                <Text as="p">
                  {summary.fetched} orders read from Shopify · {summary.imported} written to Verafo
                  {summary.skipped > 0 ? ` · ${summary.skipped} skipped (no customer phone)` : ""}
                  {outcomesSkipped > 0
                    ? ` · ${outcomesSkipped} outcome(s) already decided were left untouched`
                    : ""}
                  .
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Card>

        <Layout>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Granted scopes
                </Text>
                <List>
                  {scopes.map((s) => (
                    <List.Item key={s}>{s}</List.Item>
                  ))}
                </List>
                <Text as="p" tone="subdued">
                  These are the scopes the store actually granted, not the ones requested.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  How history is scored
                </Text>
                <Text as="p">
                  A cancelled order counts as refused, a fulfilled one as accepted, and
                  everything else starts pending — the same rules the live webhooks use.
                  Buyers are matched on their canonical phone number, so history from
                  Shopify and from a CSV lands on the same person.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
