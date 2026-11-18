import db from "../db.server";
import { getSupabase } from "./supabase.server";

/**
 * Phones are the anchor key: one canonical form per human, or the same buyer
 * gets split across rows and the network score is computed on fragments.
 * Mirrors `canonicalPhone()` in the dashboard and `canonical_phone()` in
 * Postgres (supabase/import-hardening.sql) — keep all three in step.
 */
export function normalizePhone(p: string | null | undefined): string {
  if (!p) return "";
  let d = String(p).replace(/[^\d+]/g, "");
  if (!d) return "";
  const hadPlus = d.startsWith("+");
  d = d.replace(/\+/g, "");

  if (d.startsWith("0092")) d = d.slice(2);
  if (d.startsWith("92") && d.length >= 11) d = "0" + d.slice(2);
  else if (!hadPlus && d.length === 10 && d.startsWith("3")) d = "0" + d;

  if (d.length === 11 && /^03\d{9}$/.test(d)) return "+92" + d.slice(1);
  if (hadPlus && d.length >= 8) return "+" + d;
  return d;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const CATEGORIES = [
  "skincare",
  "clothing",
  "electronics",
  "footwear",
  "beauty",
  "home",
  "accessories",
  "other",
];

export interface ShopifyOrderLike {
  id: string | number;
  name?: string;
  created_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  financial_status?: string;
  /** "fulfilled" / "partial" / "null" (REST) or "FULFILLED" (GraphQL, mapped). */
  fulfillment_status?: string | null;
  customer?: { phone?: string | null } | null;
  phone?: string | null;
  shipping_address?: {
    address1?: string | null;
    city?: string | null;
    province?: string | null;
    country_code?: string | null;
  } | null;
  total_price?: string | number | null;
  line_items?: {
    title?: string;
    product_type?: string | null;
    quantity?: number;
  }[];
}

export interface VerafoOrderInput {
  shopifyOrderId: string;
  buyerPhone: string;
  productCategory: string;
  productName: string;
  price: number | null;
  quantity: number;
  address: string | null;
  city: string | null;
  orderedAt: string | null;
}

export function mapOrder(
  payload: ShopifyOrderLike,
): VerafoOrderInput | { error: string } {
  const shopifyOrderId = String(payload.id ?? "");
  if (!shopifyOrderId) return { error: "order has no id" };

  const buyerPhone = normalizePhone(payload.customer?.phone ?? payload.phone ?? "");
  if (!buyerPhone) return { error: "order has no customer phone" };

  const items = payload.line_items ?? [];
  const productName =
    firstString(items[0]?.title) ??
    (payload.name ? `Order ${payload.name}` : "Untitled product");

  const titleLower = productName.toLowerCase();
  const category =
    items
      .map((it) => firstString(it.product_type)?.toLowerCase())
      .find((t) => t && CATEGORIES.includes(t)) ??
    CATEGORIES.find((c) => titleLower.includes(c)) ??
    "other";

  const quantity = Math.max(
    1,
    items.reduce((sum, it) => sum + (toNumber(it.quantity) ?? 1), 0),
  );

  const addressParts = [
    payload.shipping_address?.address1,
    payload.shipping_address?.province,
  ].filter(Boolean);

  // `orders.price` is a UNIT price: the dashboard computes order value as
  // price × quantity. Shopify gives us the order total, so spread it across the
  // units — storing the total here would have reported 3× the money at risk.
  const total = toNumber(payload.total_price);
  const price = total == null ? null : Math.round((total / quantity) * 100) / 100;

  return {
    shopifyOrderId,
    buyerPhone,
    productCategory: category,
    productName,
    price,
    quantity,
    address: firstString(addressParts.join(", ")),
    city: firstString(payload.shipping_address?.city),
    orderedAt: payload.created_at ?? null,
  };
}

/**
 * Upsert the Verafo store row for a Shopify shop and remember the mapping in
 * the app's database (the same place the OAuth access token lives).
 */
export async function ensureStoreLink(
  shop: string,
  shopName?: string,
): Promise<string> {
  const cached = await db.connectedShop.findUnique({ where: { shop } });
  if (cached) return cached.storeId;

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("upsert_store_for_shop", {
    p_domain: shop,
  });
  if (error) {
    throw new Error(
      `Could not link store "${shop}": ${error.message} (did you run supabase/shopify-migration.sql?)`,
    );
  }
  const storeId = String(data);

  await db.connectedShop.upsert({
    where: { shop },
    create: { shop, storeId, shopName: shopName ?? shop },
    update: { shopName: shopName ?? shop },
  });

  return storeId;
}

/**
 * Ingest a Shopify order webhook (or synced order) into Verafo. Idempotent —
 * Shopify retries webhooks, so upserts are keyed on the Shopify order id.
 */
export async function recordShopifyOrder(
  payload: ShopifyOrderLike,
  storeId: string,
): Promise<{ created: boolean; skipped?: string }> {
  const mapped = mapOrder(payload);
  if ("error" in mapped) return { created: false, skipped: mapped.error };

  const supabase = getSupabase();

  const { error: buyerErr } = await supabase
    .from("buyers")
    .upsert({ phone: mapped.buyerPhone }, { onConflict: "phone" });
  if (buyerErr) throw new Error(`buyer upsert failed: ${buyerErr.message}`);

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .upsert(
      {
        buyer_phone: mapped.buyerPhone,
        store_id: storeId,
        product_category: mapped.productCategory,
        product_name: mapped.productName,
        price: mapped.price,
        quantity: mapped.quantity,
        address: mapped.address,
        city: mapped.city,
        ordered_at: mapped.orderedAt,
        shopify_order_id: mapped.shopifyOrderId,
      },
      { onConflict: "shopify_order_id" },
    )
    .select("id")
    .single();
  if (orderErr) throw new Error(`order upsert failed: ${orderErr.message}`);

  // A new order is "pending"; a backfilled cancelled order is already "refused"
  // and a backfilled fulfilled order is already "accepted".
  const status: "pending" | "refused" | "accepted" = payload.cancelled_at
    ? "refused"
    : payload.fulfillment_status === "fulfilled"
      ? "accepted"
      : "pending";

  const outcomeRow = {
    order_id: order.id,
    status,
    refusal_reason: status === "refused" ? payload.cancel_reason ?? null : null,
    resolved_at:
      status === "pending" ? null : payload.cancelled_at ?? new Date().toISOString(),
  };

  const { error: outcomeErr } =
    status === "pending"
      ? // A retried orders/create webhook must never clobber a resolved outcome
        // that a cancelled/fulfilled webhook already recorded.
        await supabase.from("outcomes").upsert(outcomeRow, {
          onConflict: "order_id",
          ignoreDuplicates: true,
        })
      : await supabase.from("outcomes").upsert(outcomeRow, {
          onConflict: "order_id",
        });
  if (outcomeErr) throw new Error(`outcome upsert failed: ${outcomeErr.message}`);

  return { created: true };
}

/** Mark an ingested Shopify order as refused (cancelled) or accepted (fulfilled). */
export async function setOutcomeForShopifyOrder(
  shopifyOrderId: string,
  status: "accepted" | "refused",
  reason?: string | null,
): Promise<{ updated: boolean; skipped?: string }> {
  const supabase = getSupabase();
  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("shopify_order_id", shopifyOrderId)
    .maybeSingle();
  if (!order) return { updated: false, skipped: "order not found" };

  const { error } = await supabase
    .from("outcomes")
    .upsert(
      {
        order_id: order.id,
        status,
        refusal_reason: status === "refused" ? reason ?? null : null,
        resolved_at: new Date().toISOString(),
      },
      { onConflict: "order_id" },
    );
  if (error) throw new Error(`outcome update failed: ${error.message}`);

  return { updated: true };
}

/**
 * The outcome a Shopify order implies: a cancelled order was refused, a
 * fulfilled one was accepted, everything else is still pending. Shared by the
 * webhooks and the historical backfill so both agree.
 */
export function outcomeFor(payload: ShopifyOrderLike): {
  status: "pending" | "accepted" | "refused";
  resolvedAt: string | null;
  reason: string | null;
} {
  const status: "pending" | "accepted" | "refused" = payload.cancelled_at
    ? "refused"
    : payload.fulfillment_status === "fulfilled"
      ? "accepted"
      : "pending";

  return {
    status,
    reason: status === "refused" ? payload.cancel_reason ?? null : null,
    resolvedAt:
      status === "pending"
        ? null
        : payload.cancelled_at ?? new Date().toISOString(),
  };
}

/**
 * Decide whether a batch sync may touch an existing outcome.
 *
 * A historical import is a snapshot of Shopify, not a fresh decision: if a
 * merchant has since marked the order accepted/refused in Verafo, replaying
 * history must not overwrite that. Only an outcome that is still missing, or
 * still `pending`, may be written.
 */
export function planOutcomeWrite(
  current: string | null | undefined,
  desired: "pending" | "accepted" | "refused",
): "insert" | "update" | "skip" {
  if (!current) return "insert";
  if (current === desired) return "skip";
  if (current === "pending" && desired !== "pending") return "update";
  return "skip";
}

export interface BatchIngestSummary {
  /** Orders written (new + already known, i.e. "processed"). */
  processed: number;
  /** Orders that could not be anchored: no id, or no customer phone. */
  skipped: number;
  failures: { shopifyOrderId: string; reason: string }[];
  /** Outcomes left untouched because they were already decided or resolved. */
  outcomesSkipped: number;
}

/**
 * Ingest a page of orders from the Admin API. Same rules as the webhook path,
 * but batched: 3 statements per page instead of 3 per order, which is what
 * makes a historical backfill of thousands of orders practical.
 */
export async function recordShopifyOrdersBatch(
  payloads: ShopifyOrderLike[],
  storeId: string,
): Promise<BatchIngestSummary> {
  const supabase = getSupabase();
  const failures: { shopifyOrderId: string; reason: string }[] = [];
  const usable: { mapped: VerafoOrderInput; payload: ShopifyOrderLike }[] = [];

  for (const payload of payloads) {
    const mapped = mapOrder(payload);
    if ("error" in mapped) {
      failures.push({ shopifyOrderId: String(payload.id ?? "?"), reason: mapped.error });
      continue;
    }
    usable.push({ mapped, payload });
  }

  if (usable.length === 0) {
    return { processed: 0, skipped: failures.length, failures, outcomesSkipped: 0 };
  }

  const phones = [...new Set(usable.map((u) => u.mapped.buyerPhone))];
  const { error: buyerErr } = await supabase
    .from("buyers")
    .upsert(
      phones.map((phone) => ({ phone })),
      { onConflict: "phone", ignoreDuplicates: true },
    );
  if (buyerErr) throw new Error(`buyer upsert failed: ${buyerErr.message}`);

  const { data: upserted, error: orderErr } = await supabase
    .from("orders")
    .upsert(
      usable.map(({ mapped }) => ({
        buyer_phone: mapped.buyerPhone,
        store_id: storeId,
        product_category: mapped.productCategory,
        product_name: mapped.productName,
        price: mapped.price,
        quantity: mapped.quantity,
        address: mapped.address,
        city: mapped.city,
        ordered_at: mapped.orderedAt,
        shopify_order_id: mapped.shopifyOrderId,
      })),
      { onConflict: "shopify_order_id" },
    )
    .select("id, shopify_order_id");
  if (orderErr) throw new Error(`order upsert failed: ${orderErr.message}`);

  const payloadByShopifyId = new Map(
    usable.map(({ mapped, payload }) => [mapped.shopifyOrderId, payload]),
  );

  const rows = (upserted ?? []) as { id: string; shopify_order_id: string }[];

  // One extra query per page, so a replayed history never overwrites an outcome
  // a merchant has already corrected by hand.
  const currentStatus = new Map<string, string | null>();
  if (rows.length > 0) {
    const { data: existing, error: existingErr } = await supabase
      .from("outcomes")
      .select("order_id, status")
      .in(
        "order_id",
        rows.map((r) => r.id),
      );
    if (existingErr) throw new Error(`could not read outcomes: ${existingErr.message}`);
    for (const row of existing ?? []) currentStatus.set(row.order_id, row.status);
  }

  const pendingRows: Record<string, unknown>[] = [];
  const resolvedRows: Record<string, unknown>[] = [];
  let outcomesSkipped = 0;

  for (const row of rows) {
    const payload = payloadByShopifyId.get(String(row.shopify_order_id));
    if (!payload) continue;
    const outcome = outcomeFor(payload);
    if (planOutcomeWrite(currentStatus.get(row.id), outcome.status) === "skip") {
      outcomesSkipped++;
      continue;
    }
    const record = {
      order_id: row.id,
      status: outcome.status,
      refusal_reason: outcome.reason,
      resolved_at: outcome.resolvedAt,
    };
    if (outcome.status === "pending") pendingRows.push(record);
    else resolvedRows.push(record);
  }

  // A pending outcome must never clobber one a webhook already recorded.
  if (pendingRows.length > 0) {
    const { error } = await supabase
      .from("outcomes")
      .upsert(pendingRows, { onConflict: "order_id", ignoreDuplicates: true });
    if (error) throw new Error(`outcome upsert failed: ${error.message}`);
  }
  if (resolvedRows.length > 0) {
    const { error } = await supabase
      .from("outcomes")
      .upsert(resolvedRows, { onConflict: "order_id" });
    if (error) throw new Error(`outcome upsert failed: ${error.message}`);
  }

  return { processed: usable.length, skipped: failures.length, failures, outcomesSkipped };
}

export interface VerafoOrderRow {
  id: string;
  product_name: string | null;
  product_category: string | null;
  price: number | null;
  quantity: number | null;
  address: string | null;
  city: string | null;
  ordered_at: string | null;
  buyer_phone: string;
  buyers: {
    phone: string;
    risk_score: number | null;
    total_orders: number | null;
    total_accepted: number | null;
    total_refused: number | null;
  } | null;
  outcomes: {
    status: string | null;
    resolved_at: string | null;
    refusal_reason: string | null;
  } | null;
}

export async function listStoreOrders(
  shop: string,
  limit = 50,
): Promise<VerafoOrderRow[]> {
  const link = await db.connectedShop.findUnique({ where: { shop } });
  if (!link) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, product_name, product_category, price, quantity, address, city, ordered_at, buyer_phone, buyers(phone, risk_score, total_orders, total_accepted, total_refused), outcomes(status, resolved_at, refusal_reason)",
    )
    .eq("store_id", link.storeId)
    .order("ordered_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`could not list orders: ${error.message}`);

  // PostgREST embeds to-one relations as objects, but the untyped client
  // types them as arrays — normalise so the admin UI gets plain objects.
  return ((data ?? []) as unknown as Array<
    VerafoOrderRow & {
      buyers: VerafoOrderRow["buyers"] | VerafoOrderRow["buyers"][];
      outcomes: VerafoOrderRow["outcomes"] | VerafoOrderRow["outcomes"][];
    }
  >).map((row) => ({
    ...row,
    buyers: Array.isArray(row.buyers) ? row.buyers[0] ?? null : row.buyers,
    outcomes: Array.isArray(row.outcomes) ? row.outcomes[0] ?? null : row.outcomes,
  }));
}

/**
 * Convert a Shopify Admin GraphQL order node into the REST-like shape the
 * webhook handler understands, so manual "sync" reuses the same ingest path.
 */
export function graphqlNodeToPayload(
  node: Record<string, unknown>,
): ShopifyOrderLike {
  const gid = String(node.id ?? "");
  const numericId = gid.split("/").pop() ?? gid;

  const items =
    (node.lineItems as
      | { edges?: { node?: Record<string, unknown> }[] }
      | undefined)?.edges ?? [];
  const lineItems = items.map(({ node: it }) => {
    const productType =
      it && typeof it.product === "object" && it.product !== null
        ? (it.product as { productType?: unknown }).productType
        : undefined;
    return {
      title: typeof it?.title === "string" ? it.title : undefined,
      product_type: typeof productType === "string" ? productType : null,
      quantity: typeof it?.quantity === "number" ? it.quantity : undefined,
    };
  });

  const shipping = node.shippingAddress as
    | { address1?: unknown; city?: unknown }
    | null
    | undefined;
  const totalSet = node.currentTotalPriceSet as
    | { shopMoney?: { amount?: unknown } }
    | undefined;
  const customer = node.customer as { phone?: unknown } | null | undefined;
  const fulfillment =
    typeof node.displayFulfillmentStatus === "string"
      ? node.displayFulfillmentStatus
      : "";

  return {
    id: numericId,
    name: typeof node.name === "string" ? node.name : undefined,
    created_at: typeof node.createdAt === "string" ? node.createdAt : null,
    cancelled_at: typeof node.cancelledAt === "string" ? node.cancelledAt : null,
    cancel_reason: typeof node.cancelReason === "string" ? node.cancelReason : null,
    fulfillment_status:
      fulfillment.includes("FULFILLED") ? "fulfilled" : "unfulfilled",
    customer: {
      phone:
        typeof customer?.phone === "string" ? customer.phone : null,
    },
    phone: typeof node.phone === "string" ? node.phone : null,
    shipping_address: shipping
      ? {
          address1: typeof shipping.address1 === "string" ? shipping.address1 : null,
          city: typeof shipping.city === "string" ? shipping.city : null,
        }
      : null,
    total_price:
      typeof totalSet?.shopMoney?.amount === "number" ||
      typeof totalSet?.shopMoney?.amount === "string"
        ? (totalSet.shopMoney.amount as string | number)
        : null,
    line_items: lineItems,
  };
}
