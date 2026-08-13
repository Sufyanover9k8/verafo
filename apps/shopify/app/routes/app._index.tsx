import { useEffect } from "react";
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
  DataTable,
  Banner,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  ensureStoreLink,
  graphqlNodeToPayload,
  listStoreOrders,
  recordShopifyOrder,
  type VerafoOrderRow,
} from "../lib/verafo";
import { computeVerdict } from "../lib/risk";
import { RiskBadge, StatusPill, formatPhone } from "../components/risk-badge";

const ORDERS_QUERY = `#graphql
  query shopifyOrders($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          phone
          cancelledAt
          cancelReason
          displayFulfillmentStatus
          customer {
            phone
          }
          shippingAddress {
            address1
            city
          }
          lineItems(first: 10) {
            edges {
              node {
                title
                quantity
                product {
                  productType
                }
              }
            }
          }
          currentTotalPriceSet {
            shopMoney {
              amount
            }
          }
        }
      }
    }
  }`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const link = await db.connectedShop.findUnique({ where: { shop } });
  let orders: VerafoOrderRow[] = [];
  let linked = false;

  if (link) {
    linked = true;
    orders = await listStoreOrders(shop, 100);
  }

  const stats = { total: orders.length, pending: 0, accepted: 0, refused: 0 };
  const distribution = { safe: 0, watch: 0, high: 0, unknown: 0 };
  for (const o of orders) {
    const status = o.outcomes?.status ?? "pending";
    if (status === "pending") stats.pending++;
    if (status === "accepted") stats.accepted++;
    if (status === "refused") stats.refused++;
    const verdict = computeVerdict(o.buyers?.risk_score, o.buyers?.total_orders);
    distribution[verdict.tone]++;
  }

  return { shop, linked, stats, distribution, recent: orders.slice(0, 10) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const storeId = await ensureStoreLink(shop, shop);
  const response = await admin.graphql(ORDERS_QUERY, { variables: { first: 50 } });
  const json = (await response.json()) as {
    data?: { orders?: { edges?: { node: Record<string, unknown> }[] } };
    errors?: unknown;
  };
  if (json.errors) {
    throw new Error(`GraphQL sync failed: ${JSON.stringify(json.errors)}`);
  }

  const edges = json.data?.orders?.edges ?? [];
  let created = 0;
  let skipped = 0;
  for (const { node } of edges) {
    const result = await recordShopifyOrder(graphqlNodeToPayload(node), storeId);
    if (result.created) created++;
    else skipped++;
  }

  return { created, skipped, total: edges.length };
};

export default function Index() {
  const { linked, stats, distribution, recent } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const appBridge = useAppBridge();

  const syncing =
    fetcher.state === "submitting" || fetcher.state === "loading";
  const syncResult = fetcher.data as
    | { created?: number; skipped?: number }
    | undefined;

  useEffect(() => {
    if (syncResult && !fetcher.state) {
      appBridge.toast.show(
        `Synced ${syncResult.created ?? 0} order${(syncResult.created ?? 0) === 1 ? "" : "s"} from Shopify.`,
      );
    }
  }, [syncResult, fetcher.state, appBridge]);

  const rows = recent.map((o) => [
    o.ordered_at ? new Date(o.ordered_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
    formatPhone(o.buyer_phone),
    o.product_name ?? o.product_category ?? "Untitled product",
    o.price != null ? `PKR ${Number(o.price).toLocaleString("en-PK")}` : "—",
    <RiskBadge key={o.id} riskScore={o.buyers?.risk_score} totalOrders={o.buyers?.total_orders} />,
    <StatusPill key={o.id} status={o.outcomes?.status} />,
  ]);

  const kpis = [
    { label: "Orders ingested", value: stats.total },
    { label: "Pending", value: stats.pending },
    { label: "Accepted", value: stats.accepted },
    { label: "Refused", value: stats.refused },
  ];

  return (
    <Page>
      <TitleBar title="Verafo risk">
        <button
          variant="primary"
          loading={syncing}
          onClick={() => fetcher.submit({}, { method: "POST" })}
        >
          {syncing ? "Syncing…" : "Sync recent orders"}
        </button>
      </TitleBar>
      <BlockStack gap="500">
        {!linked && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p">
                Connect this store to Verafo. Orders are ingested automatically
                from webhooks, but you can also sync the last 50 orders now.
              </Text>
              <Button onClick={() => fetcher.submit({}, { method: "POST" })}>
                Sync orders from Shopify
              </Button>
            </BlockStack>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Risk distribution
                </Text>
                <InlineStack gap="300" wrap>
                  {(["safe", "watch", "high", "unknown"] as const).map((tone) => (
                    <BlockStack key={tone} gap="100">
                      <Text as="p" variant="headingLg">
                        {distribution[tone]}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {tone === "safe" ? "Low risk" : tone === "watch" ? "Medium" : tone === "high" ? "High risk" : "Insufficient data"}
                      </Text>
                    </BlockStack>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                {kpis.map((k) => (
                  <InlineStack key={k.label} align="space-between">
                    <Text as="span">{k.label}</Text>
                    <Text as="span" variant="headingMd" fontWeight="bold">
                      {k.value}
                    </Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Recent orders
            </Text>
            {rows.length === 0 ? (
              <Text as="p" tone="subdued">
                No orders yet. {linked ? "New Shopify orders will appear here automatically." : "Sync from Shopify to start."}
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                headings={["Date", "Phone", "Product", "Value", "Risk", "Status"]}
                rows={rows}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
