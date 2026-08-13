import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Text, Card, BlockStack, DataTable } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { listStoreOrders } from "../lib/verafo";
import { RiskBadge, StatusPill, formatPhone } from "../components/risk-badge";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const orders = await listStoreOrders(session.shop, 200);
  return { orders };
};

export default function Orders() {
  const { orders } = useLoaderData<typeof loader>();

  const rows = orders.map((o) => [
    o.ordered_at
      ? new Date(o.ordered_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })
      : "—",
    formatPhone(o.buyer_phone),
    o.product_name ?? o.product_category ?? "Untitled product",
    `${o.quantity ?? 1} × PKR ${(o.price ?? 0).toLocaleString("en-PK")}`,
    o.city ?? "—",
    <RiskBadge key={o.id} riskScore={o.buyers?.risk_score} totalOrders={o.buyers?.total_orders} />,
    <StatusPill key={o.id} status={o.outcomes?.status} />,
  ]);

  return (
    <Page>
      <TitleBar title="Orders" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                All ingested orders
              </Text>
              {rows.length === 0 ? (
                <Text as="p" tone="subdued">
                  No orders ingested yet. Orders flow in automatically once the
                  webhooks are registered, or use Sync on the home page.
                </Text>
              ) : (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                  ]}
                  headings={["Date", "Phone", "Product", "Line", "City", "Risk", "Status"]}
                  rows={rows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
