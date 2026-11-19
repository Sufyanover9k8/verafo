/**
 * Backfill customer names for orders that were imported before the ingest
 * started asking Shopify for them.
 *
 * It reads the numeric ids we already store in orders.shopify_order_id, asks
 * the Shopify Admin API for just those orders, and fills names through the same
 * fill-only helper the webhook uses — so a call correction is never overwritten
 * and re-running is safe.
 *
 * Usage (one shop at a time):
 *   SHOP=bbl-bed-blanket.myshopify.com \
 *   SHOPIFY_TOKEN=shpat_... \
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/backfill-names.ts [--dry-run]
 *
 * The token needs read_orders (and read_all_orders for anything older than
 * 60 days). It is never logged or stored.
 */
import { createClient } from "@supabase/supabase-js";
import {
  customerNameOf,
  fillCustomerName,
  graphqlNodeToPayload,
  type ShopifyOrderLike,
} from "../app/lib/verafo";

const API_VERSION = "2026-10";
const BATCH = 100;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const dryRun = process.argv.includes("--dry-run");

type Node = Parameters<typeof graphqlNodeToPayload>[0];
/** Ask Shopify for these exact orders; returns numeric id -> payload. */
async function fetchOrders(shop: string, token: string, ids: string[]) {
  const found = new Map<string, ShopifyOrderLike>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const gids = chunk.map((id) => `gid://shopify/Order/${id}`);
    const query = `query ($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          name
          customer { firstName lastName }
          shippingAddress { name }
        }
      }
    }`;
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables: { ids: gids } }),
    });
    const body = (await res.json()) as {
      data?: { nodes?: (Node | null)[] };
      errors?: unknown;
    };
    if (!res.ok || body.errors) {
      throw new Error(
        `Shopify rejected the request (${res.status}): ${JSON.stringify(body.errors ?? body)}`,
      );
    }
    for (const node of body.data?.nodes ?? []) {
      if (!node?.id) continue;
      const payload = graphqlNodeToPayload(node);
      found.set(String(payload.id), payload);
    }
  }
  return found;
}

async function main() {
  const shop = env("SHOP");
  const token = env("SHOPIFY_TOKEN");
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const { data: store, error: storeErr } = await db
    .from("stores")
    .select("id, name")
    .eq("shopify_domain", shop)
    .maybeSingle();
  if (storeErr) throw storeErr;
  if (!store) throw new Error(`no store with shopify_domain=${shop}`);

  const { data: orders, error: ordersErr } = await db
    .from("orders")
    .select("id, buyer_phone, shopify_order_id")
    .eq("store_id", store.id)
    .not("shopify_order_id", "is", null)
    .is("deleted_at", null);
  if (ordersErr) throw ordersErr;

  const ids = [...new Set((orders ?? []).map((o) => String(o.shopify_order_id)))];
  console.log(`${shop}: ${orders?.length ?? 0} shopify orders, ${ids.length} distinct ids`);

  const found = await fetchOrders(shop, token, ids);
  console.log(`shopify returned ${found.size} of ${ids.length}`);

  let named = 0;
  let alreadyNamed = 0;
  let unknown = 0;
  for (const order of orders ?? []) {
    const payload = found.get(String(order.shopify_order_id));
    const name = payload ? customerNameOf(payload) : null;
    if (!payload) {
      unknown += 1;
      continue;
    }
    if (!name) {
      unknown += 1;
      continue;
    }
    if (dryRun) {
      console.log(`would name ${order.id} (${order.buyer_phone}) -> ${name}`);
      named += 1;
      continue;
    }
    const filled = await fillCustomerName(db, order.id, name, order.buyer_phone);
    if (filled) named += 1;
    else alreadyNamed += 1;
  }

  console.log(
    `${dryRun ? "dry run" : "done"}: ${named} named, ${alreadyNamed} already named, ${unknown} without a name`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
