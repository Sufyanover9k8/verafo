import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.49.4";
import OpenAI from "jsr:@openai/openai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FALLBACK_PRODUCTS: Record<string, string[]> = {
  skincare: ["Face serum 30ml", "Vitamin C cream 50ml", "Sunscreen SPF 50", "Face wash 150ml", "Moisturiser 100ml"],
  clothing: ["Cotton t-shirt", "Slim jeans", "Oversized hoodie", "Printed kurti", "Chiffon dupatta"],
  electronics: ["Bluetooth earbuds", "Power bank 20000mAh", "Smart watch", "Phone stand", "USB hub"],
  footwear: ["Running shoes", "Casual sandals", "Canvas sneakers", "Formal loafers"],
  beauty: ["Lipstick set of 4", "Eyeliner duo", "Foundation kit", "Nail polish set"],
  home: ["Cushion covers pair", "Table lamp", "Storage baskets", "Wall clock"],
  accessories: ["Leather wallet", "Sunglasses", "Watch strap", "Belt"],
  haircare: ["Hair oil 100ml", "Shampoo 300ml", "Conditioner 300ml", "Hair serum"],
};

const PRICE_RANGES: Record<string, [number, number]> = {
  skincare: [699, 4500],
  clothing: [899, 6500],
  electronics: [1499, 14999],
  footwear: [1599, 8500],
  beauty: [599, 4500],
  home: [899, 6000],
  accessories: [499, 4500],
  haircare: [599, 3500],
};

const CITIES = ["Lahore", "Karachi", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar", "Sialkot", "Gujranwala", "Quetta"];
const AREAS = ["Model Town", "Gulberg", "DHA Phase 5", "Johar Town", "PECHS Block 2", "Clifton Block 5", "F-11 Markaz", "Satellite Town", "Gulshan-e-Iqbal", "Cavalry Ground"];
const MIX_RATIOS: Record<string, number> = { safe: 0.15, balanced: 0.35, risky: 0.6 };

function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

function genPhone(taken: Set<string>): string {
  let p: string;
  do {
    p = "+92" + "3" + Array.from({ length: 9 }, () => rand(10)).join("");
  } while (taken.has(p));
  taken.add(p);
  return p;
}

function cleanPhone(raw: unknown, taken: Set<string>): string {
  if (typeof raw === "string" && raw.trim()) {
    let p = raw.replace(/[^\d+]/g, "");
    if (p.startsWith("00")) p = "+" + p.slice(2);
    if (p.startsWith("0")) p = "+92" + p.slice(1);
    if (/^\d{10}$/.test(p)) p = "+92" + p;
    if (!p.startsWith("+")) p = "+92" + p;
    p = "+" + p.replace(/[^0-9]/g, "");
    if (p.length === 13 && p.startsWith("+923") && !taken.has(p)) {
      taken.add(p);
      return p;
    }
  }
  return genPhone(taken);
}

function uniqueStoreName(raw: unknown, taken: Set<string>, fallbackIndex: number): string {
  if (typeof raw === "string") {
    const name = raw.trim().slice(0, 60);
    if (name && !taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      return name;
    }
  }
  let name: string;
  do {
    const c = CITIES[rand(CITIES.length)];
    name = `Dummy ${c} Store ${fallbackIndex + 1}`;
  } while (taken.has(name.toLowerCase()));
  taken.add(name.toLowerCase());
  return name;
}

function fallbackOrder(category: string, daysAgo: number, ratio: number) {
  const products = FALLBACK_PRODUCTS[category] ?? FALLBACK_PRODUCTS.skincare;
  const [lo, hi] = PRICE_RANGES[category] ?? PRICE_RANGES.skincare;
  const price = lo + rand(hi - lo + 1);
  const r = Math.random();
  const outcome = r < ratio ? "refused" : r < ratio + 0.12 ? "pending" : "accepted";
  return {
    category,
    product: products[rand(products.length)],
    price,
    quantity: 1 + rand(3),
    address: `House ${1 + rand(400)}, ${AREAS[rand(AREAS.length)]}`,
    outcome,
    days_ago: daysAgo,
  };
}

function toIsoDaysAgo(daysAgo: unknown, maxDays: number): string {
  const d = typeof daysAgo === "number" && daysAgo >= 0 ? Math.min(daysAgo, maxDays) : maxDays;
  return new Date(Date.now() - d * 86400000).toISOString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sse(
  body: (emit: (event: string, data: unknown) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          /* stream closed */
        }
      };
      try {
        await body(emit);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          emit("error", { message });
        } catch {
          /* closed */
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

function chunkText(text: string, size = 3): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length > 0 ? out : [""];
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args).filter(
    (k) => args[k] != null && args[k] !== "" && args[k] !== 0,
  );
  if (keys.length === 0) return "";
  return keys
    .map((k) => {
      const v = args[k];
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}=${s.length > 40 ? s.slice(0, 37) + "…" : s}`;
    })
    .join(", ");
}

/** Tool results are structurally dynamic, so this view names the handful of
 *  fields summarizeTool reads. Everything is optional: a tool may return an
 *  array, an error object, or a different shape entirely. */
interface ToolResultView {
  error?: unknown
  count?: unknown
  noData?: unknown
  title?: unknown
  rows?: unknown
  summary?: string
  city?: unknown
  total_buyers?: unknown
  buyers_with_order_above?: unknown
  total_refused?: unknown
  recommendation?: unknown
  buyers?: unknown
  totals?: { orders?: unknown; buyers?: unknown }
}
function summarizeTool(name: string, result: unknown): string {
  if (result && typeof result === "object" && "error" in result) return "failed";
  const r = result as ToolResultView;
  switch (name) {
    case "search_orders":
      return `${r?.count ?? 0} orders found`;
    case "buyers_by_city":
      return `${r?.total_buyers ?? 0} buyers in ${r?.city ?? "?"}${
        r?.buyers_with_order_above != null
          ? ` (${r.buyers_with_order_above} above threshold)`
          : ""
      }`;
    case "buyer_profile":
      return `risk ${r?.summary?.match(/Risk score ([0-9.]+)/)?.[1] ?? "?"}`;
    case "top_buyers":
      return `top ${Array.isArray(r) ? r.length : 0} buyers`;
    case "city_overview":
      return `${Array.isArray(r) ? r.length : 0} cities compared`;
    case "category_overview":
      return `${Array.isArray(r) ? r.length : 0} categories compared`;
    case "store_overview":
      return `${Array.isArray(r) ? r.length : 0} stores compared`;
    case "top_products":
      return `top ${Array.isArray(r) ? r.length : 0} products`;
    case "network_overview":
      return r?.totals
        ? `${r.totals.orders ?? 0} orders, ${r.totals.buyers ?? 0} buyers`
        : "network snapshot";
    case "refusal_reasons":
      return `${r?.total_refused ?? 0} refusals analysed`;
    case "buyer_orders":
      return `${Array.isArray(r) ? r.length : 0} orders`;
    case "weekly_trend":
      return `${Array.isArray(r) ? r.length : 0} weeks`;
    case "similar_buyers":
      return `${Array.isArray(r) ? r.length : 0} similar buyers`;
    case "buyer_verdict":
      return `recommendation: ${r?.recommendation ?? "?"}`;
    case "search_buyers":
      return `${Array.isArray(r?.buyers) ? r.buyers.length : 0} buyers`;
    case "create_file":
      if (r && r.noData) return "no matching data - file skipped";
      return `file ready: "${r?.title ?? "?"}" (${Array.isArray(r?.rows) ? r.rows.length : 0} rows)`;
    default:
      return "done";
  }
}

const TOOL_LABELS: Record<string, string> = {
  search_orders: "Searching orders",
  buyers_by_city: "Counting buyers in city",
  buyer_profile: "Pulling buyer profile",
  top_buyers: "Ranking top buyers",
  city_overview: "Comparing cities",
  category_overview: "Analysing categories",
  store_overview: "Comparing stores",
  top_products: "Finding top products",
  network_overview: "Network snapshot",
  refusal_reasons: "Analysing refusal reasons",
  buyer_orders: "Fetching buyer orders",
  weekly_trend: "Building weekly trend",
  similar_buyers: "Finding similar buyers",
  buyer_verdict: "Assessing buyer risk",
  search_buyers: "Searching buyers",
  create_file: "Building your file",
};

interface SummaryInput {
  phone: string;
  risk_score: number;
  total_orders: number;
  total_accepted: number;
  total_refused: number;
  stores: number;
  categories: [string, number][];
  avg_order_value: number | null;
  cities: string[];
  evening_orders: number;
  night_ratio: number;
  weekend_ratio: number;
  avg_item_count: number;
  phone_age_days: number;
  distinct_stores: number;
  first_seen: string | null;
}

function buildSummaryText(s: SummaryInput): string {
  const parts: string[] = [];
  parts.push(
    `Risk score ${s.risk_score} (0 = safe, 1 = high risk). ` +
      `Buyer with ${s.total_orders} total orders across ${s.stores} store(s). ` +
      `Accepted ${s.total_accepted}, refused ${s.total_refused}.`,
  );
  if (s.categories.length > 0) {
    parts.push(
      `Categories: ${s.categories.map(([c, n]) => `${c} (${n})`).join(", ")}.`,
    );
  }
  if (s.avg_order_value != null) {
    parts.push(`Average order value ${Math.round(s.avg_order_value)} PKR.`);
  }
  if (s.cities.length > 0) {
    parts.push(`Cities: ${s.cities.join(", ")}.`);
  }
  if (s.night_ratio > 0) {
    parts.push(`${Math.round(s.night_ratio * 100)}% of orders placed late at night (18:00-02:59).`);
  }
  if (s.weekend_ratio > 0) {
    parts.push(`${Math.round(s.weekend_ratio * 100)}% placed on weekends.`);
  }
  if (s.avg_item_count > 1) {
    parts.push(`Average basket ${Math.round(s.avg_item_count * 10) / 10} item(s) per order.`);
  }
  if (s.total_orders >= 3 && s.stores >= 2) {
    parts.push(`Repeat buyer who shops across ${s.stores} different stores (distinct stores: ${s.distinct_stores}).`);
  } else {
    parts.push(
      s.total_orders >= 3
        ? "Repeat buyer within a single store."
        : "Limited history in the network.",
    );
  }
  if (s.phone_age_days > 0) {
    parts.push(`Known to the network for about ${Math.round(s.phone_age_days)} days.`);
  }
  return parts.join(" ");
}

/**
 * Row shapes for the tables this function reads.
 *
 * The Supabase client is created without a generated schema, so a `.select()`
 * returns `unknown` for every column and the embedded `outcomes` relation is
 * not resolvable at all. Rather than sprinkle `any` casts (which would hide
 * real mistakes), these interfaces describe the columns each query actually
 * asks for, and `asRows` / `asOne` narrow the result through them.
 *
 * They are the contract for what the database returns. If a column is renamed
 * the interface changes here and every use site is checked.
 */
interface BuyerRow {
  phone: string
  first_seen: string | null
  total_orders: number | null
  total_accepted: number | null
  total_refused: number | null
  risk_score: number | null
}

/** Minimal buyer shape for feature-vector work. `city` does not exist on the
 *  buyers table (buyer location lives on orders), so it is intentionally absent. */
interface BuyerIdentityRow {
  phone: string
  first_seen: string | null
  total_accepted: number | null
}

/** `outcomes` is embedded in an order select. PostgREST returns a to-one
 *  relation as an object, but the untyped client models it as an array, so
 *  both shapes have to be handled. */
type Embedded<T> = T | T[] | null

interface OutcomeEmbed {
  status: string | null
  refusal_reason?: string | null
  resolved_at?: string | null
}

interface OrderRow {
  id?: string
  buyer_phone?: string | null
  store_id?: string | null
  product_name?: string | null
  product_category?: string | null
  price?: number | null
  quantity?: number | null
  city?: string | null
  address?: string | null
  ordered_at?: string | null
  outcomes?: Embedded<OutcomeEmbed>
}

/** Minimal store shape for id -> display-name lookups. */
interface StoreRow {
  id: string
  name: string | null
}

/** `verafo_normalize_phone` / phone columns are text, but a lookup may match
 *  several spellings of the same subscriber number. */
interface BuyerIdRow {
  id: string
}

/** One row of `verafo_aggregate_stats(p_dimension, p_days)`.
 *  `buyers` is a COUNT - the function never returns a number. */
interface AggregateStatsRow {
  bucket: string | null
  orders: number | null
  buyers: number | null
  value: number | null
  accepted: number | null
  refused: number | null
  pending: number | null
  refusal_rate: number | null
}

/** One row of `verafo_buyer_ranking(...)`. `buyer_label` is masked
 *  (`'····' || right(phone, 4)`) - the full number never leaves Postgres. */
interface BuyerRankingRow {
  rank: number | null
  buyer_label: string | null
  orders: number | null
  accepted: number | null
  refused: number | null
  value: number | null
  risk_score: number | null
  store_count: number | null
}

/** One row of `similar_buyers_by_phone(phone, limit)`. Returns no identity and
 *  no vector - similarity and aggregate counts only. */
interface SimilarBuyerRow {
  similarity: number | null
  risk_score: number | null
  total_orders: number | null
  total_refused: number | null
}

/** A `buyers` row limited to the columns the edge function actually selects. */
interface BuyerSearchRow {
  phone: string
  risk_score: number | null
  total_orders: number | null
  total_accepted: number | null
  total_refused: number | null
}

/** A `buyers` row carrying an embedding, for the buyer-map feature. */
interface BuyerEmbeddingRow {
  phone: string
  risk_score: number | null
  total_orders: number | null
  total_accepted: number | null
  total_refused: number | null
  embedding: number[] | null
}

/** One plotted point in the buyer map (classical-MDS projection). */
interface BuyerMapPoint {
  phone: string
  risk: number
  orders: number
  refused: number
  spend: number
  avgOrderValue: number
  x: number
  y: number
  z: number
  radius: number
}

/** Unwrap a to-one embed that the untyped client may return as an array. */
function embedOne<T>(v: Embedded<T>): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/** Narrow an untyped Supabase result to a declared row shape. */
function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

function asOne<T>(data: unknown): T | null {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as T) : null
}

/** The client type used throughout. The schema is not generated, so the
 *  database generic is `unknown` and the schema name stays `"public"`. */
type Db = SupabaseClient<any, "public", any>

/** The tool shape OpenAI expects. Declared locally so the array literal
 *  narrows `type` to the literal "function" instead of widening to string. */
interface ChatCompletionTool {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/**
 * Aggregate stats for one buyer phone.
 *
 * The buyer row itself is deliberately network-wide aggregate data (this is what
 * makes "look up any phone you already know" work, including buyers who never
 * ordered from your store). Order-level rows are private, so every order read is
 * filtered to the caller's own stores.
 */
async function fetchStats(
  supabase: Db,
  phone: string,
  storeIds: string[] = [],
): Promise<SummaryInput> {
  const { data: buyerData, error: bErr } = await supabase
    .from("buyers")
    .select("phone, first_seen, total_orders, total_accepted, total_refused, risk_score")
    .eq("phone", phone)
    .maybeSingle();
  if (bErr) throw new Error(bErr.message);
  const buyer = asOne<BuyerRow>(buyerData);
  if (!buyer) throw new Error("Buyer not found");

  const { data: orderData, error: oErr } = await supabase
    .from("orders")
    .select("store_id, product_category, price, quantity, city, ordered_at, outcomes(status)")
    .eq("buyer_phone", phone)
    .in("store_id", storeIds)
    .order("ordered_at", { ascending: false });
  if (oErr) throw new Error(oErr.message);

  const rows = asRows<OrderRow>(orderData);
  const categoryCount = new Map<string, number>();
  const cities = new Set<string>();
  let evening = 0;
  let weekend = 0;
  let priceSum = 0;
  let priceCount = 0;
  let qtySum = 0;

  for (const o of rows) {
    const cat = o.product_category ?? "unknown";
    categoryCount.set(cat, (categoryCount.get(cat) ?? 0) + 1);
    if (o.city) cities.add(o.city);
    if (o.ordered_at) {
      const h = new Date(o.ordered_at).getHours();
      const d = new Date(o.ordered_at).getDay();
      if (h >= 18 || h < 3) evening += 1;
      if (d === 0 || d === 6) weekend += 1;
    }
    if (o.price != null) {
      priceSum += Number(o.price);
      priceCount += 1;
    }
    qtySum += Number(o.quantity ?? 1);
  }

  const totalRows = Math.max(rows.length, 1);
  const phoneAgeDays = buyer.first_seen
    ? Math.max(0, (Date.now() - new Date(buyer.first_seen).getTime()) / 86400000)
    : 0;

  return {
    phone,
    risk_score: Number(buyer.risk_score ?? 0.5),
    total_orders: Number(buyer.total_orders ?? 0),
    total_accepted: Number(buyer.total_accepted ?? 0),
    total_refused: Number(buyer.total_refused ?? 0),
    stores: new Set(rows.map((o) => o.store_id)).size,
    categories: [...categoryCount.entries()].sort((a, b) => b[1] - a[1]),
    avg_order_value: priceCount > 0 ? priceSum / priceCount : null,
    cities: [...cities],
    evening_orders: evening,
    night_ratio: evening / totalRows,
    weekend_ratio: weekend / totalRows,
    avg_item_count: qtySum / totalRows,
    phone_age_days: phoneAgeDays,
    distinct_stores: new Set(rows.map((o) => o.store_id)).size,
    first_seen: buyer.first_seen,
  };
}

const FEATURE_CATEGORIES = [
  "skincare",
  "clothing",
  "electronics",
  "footwear",
  "beauty",
  "home",
  "accessories",
  "haircare",
];

const FEATURE_CITIES = [
  "Lahore",
  "Karachi",
  "Islamabad",
  "Rawalpindi",
  "Faisalabad",
  "Multan",
  "Peshawar",
  "Sialkot",
  "Gujranwala",
  "Quetta",
];

interface FeatureVector {
  vector: number[];
  labels: string[];
}

function normalize(v: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

function sinCos(value: number, period: number): [number, number] {
  const rad = (2 * Math.PI * value) / period;
  return [Math.sin(rad), Math.cos(rad)];
}

/**
 * Feature vector for one buyer phone.
 *
 * `embedding` and `feature_vector` are never read here (they would be large and
 * pointless to pull over the wire), and order rows are filtered to the caller's
 * own stores because order-level detail is private.
 */
async function buildFeatureVector(
  supabase: Db,
  phone: string,
  storeIds: string[] = [],
): Promise<FeatureVector> {
  const { data: buyer, error: bErr } = await supabase
    .from("buyers")
    .select("phone, first_seen, total_accepted")
    .eq("phone", phone)
    .maybeSingle();
  if (bErr) throw new Error(bErr.message);
  if (!buyer) throw new Error("Buyer not found");
  const buyerIdentity = asOne<BuyerIdentityRow>(buyer);
  if (!buyerIdentity) throw new Error("Buyer not found");

  const { data: orders, error: oErr } = await supabase
    .from("orders")
    .select(
      "store_id, product_category, product_name, price, quantity, address, city, ordered_at, outcomes(status)",
    )
    .eq("buyer_phone", phone)
    .in("store_id", storeIds)
    .order("ordered_at", { ascending: true });
  if (oErr) throw new Error(oErr.message);

  const rows = asRows<OrderRow>(orders);
  const resolved = rows.filter((o) => embedOne(o.outcomes)?.status === "accepted");
  const refused = rows.filter((o) => embedOne(o.outcomes)?.status === "refused");
  const last = rows[rows.length - 1];

  const categoryCount = new Map<string, number>();
  let qtySum = 0;
  let priceSum = 0;
  let priceCount = 0;
  let weekend = 0;
  for (const o of rows) {
    const cat = o.product_category ?? "unknown";
    categoryCount.set(cat, (categoryCount.get(cat) ?? 0) + 1);
    qtySum += Number(o.quantity ?? 1);
    if (o.price != null) {
      priceSum += Number(o.price);
      priceCount += 1;
    }
    if (o.ordered_at) {
      const d = new Date(o.ordered_at).getDay();
      if (d === 0 || d === 6) weekend += 1;
    }
  }

  const total = rows.length;
  const dominant = [...categoryCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  const latestCity = last?.city ?? "";
  const avgQty = total > 0 ? qtySum / total : 1;
  const avgValue = priceCount > 0 ? priceSum / priceCount : 0;
  const phoneAgeDays = buyerIdentity.first_seen
    ? Math.max(0, (Date.now() - new Date(buyerIdentity.first_seen).getTime()) / 86400000)
    : 0;
  const distinctStores = new Set(rows.map((o) => o.store_id)).size;

  // Known-good address: the buyer's most recent address has been accepted before
  const lastAddress = last?.address ?? null;
  const addressSeen = lastAddress != null && resolved.some((o) => o.address === lastAddress);

  const vector: number[] = [];
  const labels: string[] = [];

  const push = (label: string, value: number) => {
    labels.push(label);
    vector.push(value);
  };

  // GROUP A — order timing (cyclical sin/cos, weekend flag, sequence)
  const [hSin, hCos] = sinCos(last?.ordered_at ? new Date(last.ordered_at).getHours() : 12, 24);
  const [dSin, dCos] = sinCos(last?.ordered_at ? new Date(last.ordered_at).getDay() : 0, 7);
  push("order_hour_sin", hSin);
  push("order_hour_cos", hCos);
  push("order_dow_sin", dSin);
  push("order_dow_cos", dCos);
  push("is_weekend", total > 0 ? (weekend / total > 0.5 ? 1 : 0) : 0);
  push("order_sequence", normalize(total, 1, 30));

  // GROUP B — order value & basket
  push("avg_order_value", normalize(Math.log1p(avgValue), Math.log1p(500), Math.log1p(15000)));
  push("avg_item_count", normalize(avgQty, 1, 5));

  // GROUP C — dominant category (one-hot MVP)
  for (const c of FEATURE_CATEGORIES) {
    push(`category_${c}`, dominant === c ? 1 : 0);
  }

  // GROUP D — messaging metadata (WhatsApp not wired yet: safe defaults)
  push("replied_to_automsg", 0);
  push("time_to_reply_min_norm", 0);

  // GROUP E — outcomes
  push("refusal_rate", total > 0 ? refused.length / total : 0.5);
  push("acceptance_count_norm", normalize(Number(buyerIdentity.total_accepted ?? 0), 0, 20));

  // GROUP F — location
  for (const c of FEATURE_CITIES) {
    push(`city_${c}`, latestCity === c ? 1 : 0);
  }
  push("address_seen_before", addressSeen ? 1 : 0);

  // GROUP G — identity
  push("phone_age_days_norm", normalize(phoneAgeDays, 0, 180));
  push("distinct_stores_norm", normalize(distinctStores, 1, 10));
  push("total_orders_norm", normalize(total, 0, 30));

  return { vector, labels };
}

async function listChatHistory(
  supabase: Db,
  chatId: string,
): Promise<{ role: string; content: string }[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(30);
  if (error) throw new Error(error.message);
  // System rows are internal and are never replayed to the model as history.
  return asRows<{ role: string | null; content: string | null }>(data)
    .filter((m): m is { role: string; content: string | null } =>
      typeof m.role === "string" && m.role !== "system"
    )
    .map((m) => ({ role: m.role, content: m.content ?? "" }));
}

interface ChartDatasetSpec {
  label: string;
  data: number[];
  format?: "number" | "pkr" | "percent";
}

interface ChartSpec {
  type: "bar" | "line" | "pie" | "scatter" | "histogram";
  title: string;
  labels: string[];
  datasets: ChartDatasetSpec[];
}

const METRIC_ALIASES: Record<string, string> = {
  orders: "orders", count: "orders", volume: "orders", total_orders: "orders",
  accepted: "accepted", acceptance: "accepted", accepted_orders: "accepted",
  refused: "refusals", refusals: "refusals", refusal: "refusals", refused_orders: "refusals",
  refusal_rate: "refusal_rate", refusalrate: "refusal_rate", refusal_rates: "refusal_rate", rate: "refusal_rate",
  spend: "spend", spent: "spend", revenue: "spend", order_value: "spend", value: "spend", total: "spend",
};

const DIMENSION_ALIASES: Record<string, string> = {
  category: "category", categories: "category", product_category: "category",
  store: "store", stores: "store", shop: "store",
  buyer: "buyer", buyers: "buyer", user: "buyer", users: "buyer", customer: "buyer", customers: "buyer", phone: "buyer",
  city: "city", cities: "city", location: "city",
  week: "week", weeks: "week", trend: "week", time: "week", date: "week", monthly: "week",
  risk_bucket: "risk_bucket", risk: "risk_bucket", risk_level: "risk_bucket", risk_buckets: "risk_bucket",
};

const METRIC_META: Record<string, { label: string; format: "number" | "pkr" | "percent" }> = {
  orders: { label: "Orders", format: "number" },
  accepted: { label: "Accepted", format: "number" },
  refusals: { label: "Refusals", format: "number" },
  refusal_rate: { label: "Refusal rate (%)", format: "percent" },
  spend: { label: "Spend (PKR)", format: "pkr" },
};

const KNOWN_CATEGORIES: Record<string, string> = {
  footwear: "footwear",
  shoes: "footwear",
  electronics: "electronics",
  gadgets: "electronics",
  phone: "electronics",
  phones: "electronics",
  mobile: "electronics",
  skincare: "skincare",
  skin: "skincare",
  beauty: "beauty",
  cosmetics: "beauty",
  clothing: "clothing",
  clothes: "clothing",
  apparel: "clothing",
  garments: "clothing",
  shirts: "clothing",
  dresses: "clothing",
  haircare: "haircare",
  hair: "haircare",
  home: "home",
  household: "home",
};

const CHART_INTENT_PROMPT =
  "The user asked for a chart, graph or dashboard about COD e-commerce data " +
  "(orders, buyers, outcomes, stores, cities). " +
  'Return ONLY valid JSON with exactly these keys: {"wants_chart": true|false, "charts": [ {chart} ]} ' +
  "where each chart object is:\n" +
  '{"chart_type": "bar"|"line"|"pie"|"scatter"|"histogram", ' +
  '"metric": "orders"|"accepted"|"refusals"|"refusal_rate"|"spend", ' +
  '"metrics": ["orders","accepted","refusals"] (optional, multi-series for bar/line, up to 3), ' +
  '"dimension": "category"|"store"|"buyer"|"city"|"week"|"risk_bucket", ' +
  '"category": "footwear"|"electronics"|"skincare"|"beauty"|"clothing"|"haircare"|"home" (optional), ' +
  '"title": "short chart title", "limit": 3-15, "days": 1-365}\n' +
  "Rules:\n" +
  "- Use ONLY the exact allowed values.\n" +
  "- scatter: one point per buyer (x = risk score, y = order count); dimension and metric are ignored.\n" +
  "- histogram: bins order values into price ranges; dimension is ignored; metric should be spend or orders.\n" +
  "- pie: single series only (first metric only).\n" +
  "- Up to 4 charts for a dashboard request, otherwise 1 chart.\n" +
  "- wants_chart=false only when the user asks a pure text question (advice, explanation, yes/no). Set wants_chart=true for rankings, top lists, distributions, comparisons and breakdowns of data — they benefit from a chart.\n" +
  "- If a buyer phone is mentioned, dimension is usually category for that buyer.\n" +
  '- "category": ONLY set it when the user names a specific product type (e.g. "footwear", "skincare", "electronics") to filter the chart to that category.\n' +
  '- "days": only set it when the user EXPLICITLY mentions a time window (e.g. "last 30 days", "this week", "past 6 months"). Otherwise OMIT "days" entirely so the chart covers ALL time.\n' +
  '- "limit": only set it when the user asks for a specific number of items/top N (e.g. "top 5 stores", "top 10 buyers"). Otherwise OMIT "limit".';

const CHART_REFUSAL_LIMIT = new RegExp(
  "(?:can['\u2019]?t|cannot|can not|unable to|not able to|won['\u2019]t be able|" +
    "don['\u2019]t have the ability|do not have the ability|as an ai|text-based|" +
    "language model|i['\u2019]m (?:just|only) (?:a text|an ai|a language))",
  "i",
);
const CHART_REFUSAL_VISUAL =
  /(?:chart|graph|visual|image|imagery|diagram|graphic|excel|spreadsheet|plot|render|picture)/i;
const CHART_REFUSAL_TOOLS =
  /(?:excel|spreadsheet|online (?:chart )?tools?|chart tools?|graph(?:ing)? tools?|software like|such as excel)/i;
const CHART_REFUSAL_ASKS =
  /please (?:share|provide|send)|share (?:the )?(?:relevant )?data|provide (?:me )?details about|ask (?:me )?about something specific/i;
const CHART_REFUSAL_LEAD = /^(?:however|alternatively|instead|but|rather|or you can)[,.\s]/i;

function stripRefusalSentences(text: string, hasCharts: boolean): string {
  if (!hasCharts || !text) return text;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept: string[] = [];
  let droppedLast = false;
  for (const s of sentences) {
    const isRefusal =
      (CHART_REFUSAL_LIMIT.test(s) && CHART_REFUSAL_VISUAL.test(s)) ||
      CHART_REFUSAL_TOOLS.test(s) ||
      CHART_REFUSAL_ASKS.test(s) ||
      (droppedLast && CHART_REFUSAL_LEAD.test(s));
    if (isRefusal) {
      droppedLast = true;
      continue;
    }
    droppedLast = false;
    kept.push(s);
  }
  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function niceStep(target: number): number {
  if (target <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= target) return m * pow;
  }
  return 10 * pow;
}

function shortMoney(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
}

/**
 * PRIVACY: verify who is calling, and find the stores they own.
 *
 * This function uses the SERVICE ROLE key, so it bypasses RLS entirely.
 * Nothing here can rely on RLS to keep merchants apart — every private read
 * must be scoped explicitly to the ids this function returns.
 *
 * The JWT is verified against Supabase Auth first; without that, anyone
 * holding the anon key could send a made-up Authorization header and be
 * treated as a real merchant.
 *
 * Returns [] when the caller is not authenticated or owns nothing. Callers
 * MUST treat [] as "deny", never as "no filter".
 */
async function authorizeCaller(req: Request): Promise<{ email: string; storeIds: string[] }> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { email: "", storeIds: [] };

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let email = "";
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon || service, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { email: "", storeIds: [] };
    const user = await res.json();
    email = String(user?.email ?? "").toLowerCase();
  } catch {
    return { email: "", storeIds: [] };
  }
  if (!email) return { email: "", storeIds: [] };

  try {
    const res = await fetch(
      `${url}/rest/v1/stores?select=id&owner_email=eq.${encodeURIComponent(email)}`,
      { headers: { apikey: service, Authorization: `Bearer ${service}` } },
    );
    if (!res.ok) return { email, storeIds: [] };
    const rows: unknown = await res.json();
    return { email, storeIds: asRows<BuyerIdRow>(rows).map((r) => String(r.id)) };
  } catch {
    return { email, storeIds: [] };
  }
}

/**
 * PRIVACY BACKSTOP.
 *
 * This function runs on the service role, so RLS cannot keep merchants
 * apart. `orders` is private data (R2/R5 in VERAFO-STATUS.md), so any query
 * against it that is not scoped with a store_id filter is a bug. This throws
 * instead of quietly returning the whole network.
 *
 * A hard failure rather than a silent empty result is deliberate: a leak
 * that throws is found immediately, a leak that returns [] looks like "no
 * data" and can survive for months.
 *
 * Tools that need network-wide AGGREGATE figures must not read `orders`
 * raw - they should use an aggregate RPC.
 */
const PRIVATE_TABLES = new Set(["orders"]);

async function fetchRows<T = any>(table: string, params: string): Promise<T[]> {
  if (PRIVATE_TABLES.has(table) && !params.includes("store_id=")) {
    throw new Error(
      `refusing an unscoped ${table} query: private data must be filtered to the caller's stores`,
    );
  }
  const url = `${Deno.env.get("SUPABASE_URL")}/rest/v1/${table}?${params}`;
  const res = await fetch(url, {
    headers: {
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
    },
  });
  if (!res.ok) throw new Error(`db ${table}: ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? (body as T[]) : [];
}

async function buildChartData(
  spec: {
    chart_type?: string;
    metric?: string;
    metrics?: string[];
    dimension?: string;
    category?: string;
    title?: string;
    limit?: number;
    days?: number;
  },
  phone?: string,
  storeIds: string[] = [],
): Promise<ChartSpec | null> {
  // PRIVACY: charts are built from the caller's own orders only. The
  // fetchRows backstop would refuse anything wider.
  const chartScope = storeIdFilter(storeIds);
  const rawType = String(spec.chart_type ?? "bar").toLowerCase();
  const dimension = DIMENSION_ALIASES[String(spec.dimension ?? "category").toLowerCase()] ?? "category";
  const rawMetrics = Array.isArray(spec.metrics) && spec.metrics.length > 0 ? spec.metrics : [spec.metric ?? "orders"];
  const metrics = rawMetrics
    .map((m) => METRIC_ALIASES[String(m).toLowerCase()] ?? "orders")
    .filter((m, i, a) => a.indexOf(m) === i)
    .slice(0, 3);
  const days = clamp(Number(spec.days) || 0, 0, 365);
  const limit = clamp(Number(spec.limit) || 12, 3, 15);
  const title = spec.title?.trim() || `By ${dimension}`;
  const category = KNOWN_CATEGORIES[String(spec.category ?? "").trim().toLowerCase()];

  const orderParams = (select: string) => {
    let p = `select=${encodeURIComponent(select)}&limit=2000`;
    if (phone) p += `&buyer_phone=eq.${encodeURIComponent(phone)}`;
    if (days > 0) p += `&ordered_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`;
    if (category) p += `&product_category=eq.${encodeURIComponent(category)}`;
    return p;
  };

  if (dimension === "risk_bucket") {
    const buyers = await fetchRows<BuyerRow>("buyers", "select=risk_score");
    const buckets = { safe: 0, caution: 0, high: 0 };
    for (const b of buyers) {
      const r = Number(b.risk_score);
      if (r < 0.45) buckets.safe++;
      else if (r <= 0.65) buckets.caution++;
      else buckets.high++;
    }
    const m = METRIC_META[metrics[0]] ?? METRIC_META.orders;
    return {
      type: "pie",
      title,
      labels: ["Safe (0-0.45)", "Caution (0.45-0.65)", "High (0.65-1)"],
      datasets: [{ label: m.label, data: [buckets.safe, buckets.caution, buckets.high], format: m.format }],
    };
  }

  if (rawType === "scatter") {
    const [buyers, orders] = await Promise.all([
      fetchRows<BuyerRow>("buyers", "select=phone,risk_score,total_orders"),
      fetchRows<OrderRow>("orders", `${orderParams("buyer_phone,price,ordered_at")}${chartScope}`),
    ]);
    const spendMap = new Map<string, number>();
    for (const o of orders) {
      if (o.price != null) {
        const key = String(o.buyer_phone);
        spendMap.set(key, (spendMap.get(key) ?? 0) + Number(o.price));
      }
    }
    const pts = buyers
      .filter((b) => Number(b.total_orders) > 0)
      .filter((b) => !phone || String(b.phone) === phone)
      .map((b) => ({
        name: String(b.phone),
        risk: Number(b.risk_score),
        orders: Number(b.total_orders),
        spend: Math.round(spendMap.get(String(b.phone)) ?? 0),
      }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 40);
    if (pts.length === 0) return null;
    const yIsSpend = metrics[0] === "spend";
    return {
      type: "scatter",
      title,
      labels: pts.map((p) => p.name),
      datasets: [
        { label: "Risk score", data: pts.map((p) => p.risk), format: "number" },
        { label: yIsSpend ? "Spend (PKR)" : "Orders", data: pts.map((p) => (yIsSpend ? p.spend : p.orders)), format: yIsSpend ? "pkr" : "number" },
      ],
    };
  }

  if (rawType === "histogram") {
    const orders = await fetchRows<OrderRow>("orders", `${orderParams("price,ordered_at")}${chartScope}`);
    const prices = orders
      .map((o) => Number(o.price))
      .filter((p) => p > 0 && !Number.isNaN(p));
    if (prices.length === 0) return null;
    const max = Math.max(...prices);
    const step = niceStep(max / 8);
    const bins: { from: number; to: number; count: number }[] = [];
    for (let from = 0; from < max; from += step) {
      bins.push({ from, to: from + step, count: 0 });
    }
    if (bins.length === 0) return null;
    for (const p of prices) {
      const bin = bins.find((b) => p >= b.from && p < b.to) ?? bins[bins.length - 1];
      bin.count++;
    }
    return {
      type: "histogram",
      title,
      labels: bins.map((b) => `${shortMoney(b.from)}-${shortMoney(b.to)} PKR`),
      datasets: [{ label: "Orders", data: bins.map((b) => b.count), format: "number" }],
    };
  }

  const rows = await fetchRows<OrderRow>(
    "orders",
    `${orderParams("product_category,price,store_id,ordered_at,buyer_phone,city,outcomes(status)")}${chartScope}`,
  );

  const keyFn = (o: OrderRow): string | null => {
    if (dimension === "category") return String(o.product_category ?? "unknown");
    if (dimension === "store") return o.store_id ? String(o.store_id) : "unknown";
    if (dimension === "buyer") return String(o.buyer_phone);
    if (dimension === "city") return String(o.city ?? "unknown");
    if (dimension === "week") {
      // A row with no order date cannot be placed in a week. Returning null
      // makes the caller skip it instead of bucketing it as "Invalid Date".
      if (!o.ordered_at) return null;
      const d = new Date(o.ordered_at);
      const day = d.getDay();
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (day === 0 ? 6 : day - 1));
      return monday.toISOString().slice(0, 10);
    }
    return "all";
  };

  const groups = new Map<string, { total: number; accepted: number; refused: number; spend: number }>();
  for (const o of rows) {
    const k = keyFn(o);
    if (k === null) continue; // undated row: skipped, never bucketed
    const g = groups.get(k) ?? { total: 0, accepted: 0, refused: 0, spend: 0 };
    g.total++;
    const oc = o.outcomes;
    const st = Array.isArray(oc) ? oc[0]?.status : oc?.status;
    if (st === "accepted") g.accepted++;
    else if (st === "refused") g.refused++;
    if (o.price != null) g.spend += Number(o.price);
    groups.set(k, g);
  }

  const metricValue = (g: { total: number; accepted: number; refused: number; spend: number }, m: string): number => {
    if (m === "accepted") return g.accepted;
    if (m === "refusals") return g.refused;
    if (m === "refusal_rate") return g.total > 0 ? Math.round((g.refused / g.total) * 100) : 0;
    if (m === "spend") return Math.round(g.spend);
    return g.total;
  };

  let entries = [...groups.entries()].map(([label, g]) => ({ label, g }));

  if (dimension === "store") {
    const stores = await fetchRows<StoreRow>("stores", "select=id,name");
    const names = new Map(stores.map((s) => [String(s.id), String(s.name)]));
    entries = entries.map((e) => ({ ...e, label: names.get(e.label) ?? e.label }));
  }

  if (dimension === "week") {
    entries.sort((a, b) => (a.label < b.label ? -1 : 1));
    entries = entries.slice(-limit);
  } else {
    entries.sort((a, b) => metricValue(b.g, metrics[0]) - metricValue(a.g, metrics[0]));
  }
  const top = entries
    .filter((e) => metrics.some((m) => metricValue(e.g, m) > 0))
    .slice(0, dimension === "buyer" ? Math.min(limit, 15) : limit);
  if (top.length === 0) return null;

  const usedMetrics = rawType === "pie" ? metrics.slice(0, 1) : metrics;
  const type =
    dimension === "week"
      ? "line"
      : rawType === "pie"
        ? "pie"
        : rawType === "line"
          ? "line"
          : "bar";

  return {
    type,
    title,
    labels: top.map((e) => e.label),
    datasets: usedMetrics.map((m) => ({
      label: METRIC_META[m].label,
      data: top.map((e) => metricValue(e.g, m)),
      format: METRIC_META[m].format,
    })),
  };
}

function orderOutcome(o: OrderRow): string {
  return embedOne(o.outcomes)?.status ?? "pending";
}

/** Filters accepted by `buildOrderParams`. */
interface OrderQueryFilters {
  keyword?: string;
  category?: string;
  city?: string;
  min_price?: number;
  max_price?: number;
  phone?: string;
  limit?: number;
  days?: number;
}

/** Read one optional string off a tool-argument bag. */
function argString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

/** Read one optional number off a tool-argument bag. Returns undefined rather
 *  than NaN so callers can test with a single `!= null` check. */
function argNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Narrow a raw tool-argument bag into order filters.
 *
 * Tool arguments arrive from the model as `unknown`, so every field is checked
 * before use. Values are consumed with `??` at the call sites, so an explicit
 * `undefined` is equivalent to an absent field.
 */
function orderFiltersFromArgs(args: Record<string, unknown>): OrderQueryFilters {
  return {
    keyword: argString(args, "keyword") || undefined,
    category: argString(args, "category") || undefined,
    city: argString(args, "city") || undefined,
    min_price: argNumber(args, "min_price"),
    max_price: argNumber(args, "max_price"),
    phone: argString(args, "phone") || undefined,
    limit: argNumber(args, "limit"),
    days: argNumber(args, "days"),
  };
}

function buildOrderParams(f: OrderQueryFilters): string {
  let p =
    "select=" +
    encodeURIComponent(
      "product_name,product_category,price,quantity,city,buyer_phone,store_id,ordered_at,outcomes(status)",
    ) +
    "&limit=" +
    (f.limit ?? 50);
  if (f.keyword) p += `&product_name=ilike.${encodeURIComponent(`%${f.keyword}%`)}`;
  if (f.category) p += `&product_category=eq.${encodeURIComponent(f.category)}`;
  if (f.city) p += `&city=eq.${encodeURIComponent(f.city)}`;
  if (f.min_price != null && !Number.isNaN(f.min_price)) p += `&price=gte.${f.min_price}`;
  if (f.max_price != null && !Number.isNaN(f.max_price)) p += `&price=lte.${f.max_price}`;
  if (f.phone) p += `&buyer_phone=eq.${encodeURIComponent(f.phone)}`;
  if (f.days != null && !Number.isNaN(f.days) && f.days > 0) {
    p += `&ordered_at=gte.${new Date(Date.now() - f.days * 86400000).toISOString()}`;
  }
  return p;
}

async function toolSearchOrders(supabase: Db, args: Record<string, unknown>, storeIds: string[] = []) {
  const denied = requireOwnStores(storeIds);
  if (denied) return denied;
  const rows = await fetchRows<OrderRow>(
    "orders",
    `${buildOrderParams(orderFiltersFromArgs(args))}${storeIdFilter(storeIds)}`,
  );
  const orders = rows.map((o) => ({
    product: o.product_name ?? o.product_category ?? "?",
    category: o.product_category ?? "?",
    price: o.price ?? 0,
    quantity: o.quantity ?? 1,
    city: o.city ?? "?",
    phone: o.buyer_phone,
    status: orderOutcome(o),
    date: (o.ordered_at ?? "").slice(0, 10),
  }));
  return { count: orders.length, orders };
}

async function toolTopBuyers(supabase: Db, args: Record<string, unknown>, storeIds: string[] = []) {
  // PRIVACY: this used to read the whole `buyers` table and return every
  // buyer's PHONE NUMBER across the entire network. It now calls
  // verafo_buyer_ranking, which ranks in the database and returns a MASKED
  // label (last 4 digits) with aggregate counts. Ranking without identity is
  // enough to answer "how many reliable buyers do I have, and what are they
  // worth?", which is the question this tool exists for (R1, R4).
  //
  // SCOPE: the RPC now takes p_store_ids and ranks ONLY buyers of those
  // stores - an empty list ranks nobody. So this tool requires an owned store
  // like the other private tools, instead of silently returning an empty
  // ranking for a caller who owns nothing.
  const denied = requireOwnStores(storeIds);
  if (denied) return denied;
  const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
  const metric = ["orders", "spend", "refusals", "risk"].includes(String(args.metric))
    ? String(args.metric)
    : "orders";
  const days = Math.max(1, Math.min(365, Number(args.days) || 90));

  const { data, error } = await supabase.rpc("verafo_buyer_ranking", {
    p_store_ids: storeIds,
    p_metric: metric,
    p_limit: limit,
    p_days: days,
  });
  if (error) return { error: error.message };

  return asRows<BuyerRankingRow>(data).map((r) => ({
    rank: Number(r.rank),
    buyer: String(r.buyer_label ?? "····"),
    orders: Number(r.orders ?? 0),
    accepted: Number(r.accepted ?? 0),
    refused: Number(r.refused ?? 0),
    value: Math.round(Number(r.value ?? 0)),
    risk_score: r.risk_score == null ? null : Number(r.risk_score),
    store_count: Number(r.store_count ?? 0),
  }));
}

async function toolBuyersByCity(supabase: Db, args: Record<string, unknown>, storeIds: string[] = []) {
  const denied = requireOwnStores(storeIds);
  if (denied) return denied;
  const city = argString(args, "city");
  const minPrice = argNumber(args, "min_price");
  const category = argString(args, "category").toLowerCase();
  const days = argNumber(args, "days");
  const rows = await fetchRows<OrderRow>(
    "orders",
    `${buildOrderParams({ city, limit: 2000, days })}${storeIdFilter(storeIds)}`,
  );
  const buyers = new Map<string, { count: number; max: number; spend: number }>();
  for (const o of rows) {
    if (category && String(o.product_category ?? "").toLowerCase() !== category) continue;
    const phone = String(o.buyer_phone ?? "?");
    const price = Number(o.price ?? 0);
    const g = buyers.get(phone) ?? { count: 0, max: 0, spend: 0 };
    g.count++;
    g.spend += price;
    if (price > g.max) g.max = price;
    buyers.set(phone, g);
  }
  const list = [...buyers.entries()].map(([phone, g]) => ({
    phone,
    orders: g.count,
    max_order: g.max,
    total_spend: g.spend,
  }));
  // `min_price` is optional: a missing or non-positive value means "no floor".
  const floor =
    minPrice != null && Number.isFinite(minPrice) && minPrice > 0 ? minPrice : 0;
  const above = floor > 0 ? list.filter((b) => b.max_order >= floor) : null;
  return {
    city,
    ...(category ? { category: args.category } : {}),
    total_buyers: list.length,
    ...(above
      ? { buyers_with_order_above: above.length, above_phones: above.map((b) => b.phone).slice(0, 20) }
      : {}),
    sample_buyers: list.slice(0, 20),
  };
}

async function toolBuyerProfile(supabase: Db, args: Record<string, unknown>, storeIds: string[] = []) {
  const denied = requireOwnStores(storeIds);
  if (denied) return denied;
  const phone = argString(args, "phone");
  if (!phone) return { error: "phone is required" };
  const stats = await fetchStats(supabase, phone, storeIds);
  const rows = await fetchRows<OrderRow>(
    "orders",
    `${buildOrderParams({ phone, limit: 50 })}${storeIdFilter(storeIds)}`,
  );
  const orders = rows.map((o) => ({
    product: o.product_name ?? o.product_category ?? "?",
    category: o.product_category ?? "?",
    price: o.price ?? 0,
    city: o.city ?? "?",
    status: orderOutcome(o),
    date: (o.ordered_at ?? "").slice(0, 10),
  }));
  return { summary: buildSummaryText(stats), orders };
}

async function toolCityOverview(supabase: Db, _args: unknown, _storeIds: string[] = []) {
  // PRIVACY: network-wide city statistics now come from verafo_aggregate_stats,
  // which returns counts only. This used to read 10,000 raw order rows (with
  // buyer phones) just to produce a count. Cross-store aggregate intelligence
  // is an allowed feature (R1); raw order rows are not.
  const { data, error } = await supabase.rpc("verafo_aggregate_stats", {
    p_dimension: "city",
    p_days: 90,
  });
  if (error) return { error: error.message };
  return asRows<AggregateStatsRow>(data)
    .map((r) => ({
      city: r.bucket,
      orders: Number(r.orders),
      buyers: Number(r.buyers),
      accepted: Number(r.accepted),
      refused: Number(r.refused),
      pending: Number(r.pending),
      refusal_rate: r.refusal_rate == null ? null : Math.round(Number(r.refusal_rate) * 100),
      spend: Math.round(Number(r.value)),
    }))
    .sort((a, b) => b.refused - a.refused);
}

async function toolCategoryOverview(supabase: Db, _args: unknown, _storeIds: string[] = []) {
  // PRIVACY: aggregate rows only, computed in the database. See toolCityOverview.
  const { data, error } = await supabase.rpc("verafo_aggregate_stats", {
    p_dimension: "category",
    p_days: 90,
  });
  if (error) return { error: error.message };
  return asRows<AggregateStatsRow>(data)
    .map((r) => ({
      category: r.bucket,
      orders: Number(r.orders),
      accepted: Number(r.accepted),
      refused: Number(r.refused),
      pending: Number(r.pending),
      refusal_rate: r.refusal_rate == null ? null : Math.round(Number(r.refusal_rate) * 100),
      avg_price: Number(r.orders) > 0 ? Math.round(Number(r.value) / Number(r.orders)) : 0,
    }))
    .sort((a, b) => b.refused - a.refused);
}

async function toolStoreOverview(supabase: Db, args: Record<string, unknown>, storeIds: string[] = []) {
  const denied = requireOwnStores(storeIds);
  if (denied) return denied;
  const city = argString(args, "city");
  // Scoped to the caller's own stores: this is a per-store breakdown, so an
  // unscoped read would expose every merchant's order rows. requireOwnStores
  // above guarantees the filter below is never the no-store sentinel.
  let oParams = `select=store_id,price,buyer_phone,outcomes(status)&limit=10000${storeIdFilter(storeIds)}`;
  if (city) oParams += `&city=eq.${encodeURIComponent(city)}`;
  const [rows, stores] = await Promise.all([
    fetchRows<OrderRow>("orders", oParams),
    fetchRows<StoreRow>("stores", "select=id,name"),
  ]);
  const names = new Map(stores.map((s) => [String(s.id), String(s.name)]));
  const map = new Map<string, { orders: number; buyers: Set<string>; accepted: number; refused: number; pending: number; spend: number }>();
  for (const o of rows) {
    const id = String(o.store_id ?? "unknown");
    const g = map.get(id) ?? { orders: 0, buyers: new Set<string>(), accepted: 0, refused: 0, pending: 0, spend: 0 };
    g.orders++;
    g.buyers.add(String(o.buyer_phone ?? "?"));
    g.spend += Number(o.price ?? 0);
    const st = orderOutcome(o);
    if (st === "accepted") g.accepted++;
    else if (st === "refused") g.refused++;
    else g.pending++;
    map.set(id, g);
  }
  return [...map.entries()]
    .map(([id, g]) => ({
      store: names.get(id) ?? "Unknown store",
      orders: g.orders,
      buyers: g.buyers.size,
      accepted: g.accepted,
      refused: g.refused,
      pending: g.pending,
      refusal_rate: g.orders > 0 ? Math.round((g.refused / g.orders) * 100) : 0,
      spend: Math.round(g.spend),
    }))
    .sort((a, b) => b.orders - a.orders);
}

async function toolTopProducts(supabase: Db, args: Record<string, unknown>, _storeIds: string[] = []) {
  // PRIVACY: aggregate rows only, computed in the database.
  const limit = Math.max(1, Math.min(20, argNumber(args, "limit") ?? 10));
  const { data, error } = await supabase.rpc("verafo_aggregate_stats", {
    p_dimension: "product",
    p_days: Math.max(1, Math.min(365, argNumber(args, "days") ?? 90)),
  });
  if (error) return { error: error.message };
  return asRows<AggregateStatsRow>(data).slice(0, limit).map((r) => ({
    product: r.bucket,
    orders: Number(r.orders),
    value: Math.round(Number(r.value)),
    refused: Number(r.refused),
    refusal_rate: r.refusal_rate == null ? null : Math.round(Number(r.refusal_rate) * 100),
  }));
}

async function toolNetworkOverview(supabase: Db, _args: unknown, _storeIds: string[] = []) {
  // PRIVACY: this used to read 10,000 raw order rows and the whole `buyers`
  // table to produce totals. Both are aggregates, so they now come from the
  // database. `storeIds` was also referenced here without being defined - a
  // real bug that this rewrite removes.
  const [catRes, cityRes] = await Promise.all([
    supabase.rpc("verafo_aggregate_stats", { p_dimension: "category", p_days: 90 }),
    supabase.rpc("verafo_aggregate_stats", { p_dimension: "city", p_days: 90 }),
  ]);
  if (catRes.error) return { error: catRes.error.message };
  if (cityRes.error) return { error: cityRes.error.message };

  type Agg = {
    bucket: string;
    orders: number;
    buyers: number;
    value: number;
    accepted: number;
    refused: number;
    pending: number;
    refusal_rate: number | null;
  };
  const toAgg = (r: AggregateStatsRow): Agg => ({
    bucket: r.bucket ?? "unknown",
    orders: Number(r.orders ?? 0),
    buyers: Number(r.buyers ?? 0),
    value: Number(r.value ?? 0),
    accepted: Number(r.accepted ?? 0),
    refused: Number(r.refused ?? 0),
    pending: Number(r.pending ?? 0),
    refusal_rate: r.refusal_rate == null ? null : Number(r.refusal_rate),
  });
  const cats = asRows<AggregateStatsRow>(catRes.data).map(toAgg);
  const cities = asRows<AggregateStatsRow>(cityRes.data).map(toAgg);

  const sum = (rows: Agg[], key: keyof Agg): number =>
    rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

  const accepted = sum(cats, "accepted");
  const refused = sum(cats, "refused");
  const pending = sum(cats, "pending");
  const spend = Math.round(sum(cats, "value"));
  const total = accepted + refused + pending;
  const resolved = accepted + refused;

  // Risk bands come from buyers, but only as COUNTS. No phone, no identity.
  const { count: buyerCount, error: bErr } = await supabase
    .from("buyers")
    .select("phone", { count: "exact", head: true });
  if (bErr) return { error: bErr.message };

  return {
    totals: {
      buyers: buyerCount ?? 0,
      orders: total,
      accepted,
      refused,
      pending,
      refusal_rate: resolved > 0 ? Math.round((refused / resolved) * 100) : null,
      spend,
      avg_order_value: total > 0 ? Math.round(spend / total) : 0,
    },
    top_categories: cats.slice(0, 6).map((r) => ({
      category: r.bucket,
      orders: Number(r.orders),
      refusal_rate: r.refusal_rate == null ? null : Math.round(Number(r.refusal_rate) * 100),
    })),
    top_cities: cities.slice(0, 6).map((r) => ({
      city: r.bucket,
      orders: Number(r.orders),
      buyers: Number(r.buyers),
      refusal_rate: r.refusal_rate == null ? null : Math.round(Number(r.refusal_rate) * 100),
    })),
  };
}

async function toolRefusalReasons(supabase: Db, _args: unknown, _storeIds: string[] = []) {
  // PRIVACY: aggregate rows only. The reason text is a category label the
  // merchant already chose, never a free-text note from another store.
  const { data, error } = await supabase.rpc("verafo_aggregate_stats", {
    p_dimension: "reason",
    p_days: 90,
  });
  if (error) return { error: error.message };
  return asRows<AggregateStatsRow>(data).map((r) => ({
    reason: r.bucket,
    orders: Number(r.orders),
    refused: Number(r.refused),
  }));
}

/**
 * PRIVACY: a private-data tool may only run for a caller who owns at least one
 * store. Returns an error object to hand straight back to the model, or null
 * when the call may proceed.
 *
 * This exists because the assistant runs on the service role, so RLS cannot
 * separate merchants here. Every tool that returns order-level detail
 * (addresses, cities, products, prices, individual buyers) must call this and
 * then scope its query to `storeIds`.
 *
 * Aggregate/network tools are intentionally NOT gated: cross-store aggregate
 * intelligence is an allowed product feature.
 */
function requireOwnStores(storeIds: string[]): { error: string } | null {
  if (!storeIds || storeIds.length === 0) {
    return {
      error:
        "Not allowed: this question needs order-level detail, and your account is not linked to any store. Ask about aggregate figures instead, or use a store you own.",
    };
  }
  return null;
}

/**
 * Filter that can never match a real store id, used when the caller owns no
 * stores: the query still carries a `store_id=` filter (so the fetchRows
 * backstop sees it) but returns zero rows.
 */
const NO_STORE_SENTINEL = "__verafo_no_owned_store__";

/**
 * `&store_id=in.(a,b)` for raw PostgREST calls.
 *
 * A caller with no owned stores gets a filter that matches nothing. It must
 * never degrade to the empty string, because an absent filter means "every
 * merchant's rows" - exactly the cross-merchant exposure this guards against.
 */
function storeIdFilter(storeIds: string[]): string {
  if (!storeIds || storeIds.length === 0) {
    return `&store_id=eq.${NO_STORE_SENTINEL}`;
  }
  const list = storeIds.map((id) => `"${String(id).replace(/"/g, "")}"`).join(",");
  return `&store_id=in.(${encodeURIComponent(list)})`;
}

async function toolBuyerOrders(supabase: Db, args: Record<string, unknown>, storeIds: string[] = []) {
  const denied = requireOwnStores(storeIds);
  if (denied) return denied;

  const phone = argString(args, "phone");
  const limit = Math.max(1, Math.min(50, argNumber(args, "limit") ?? 20));
  if (!phone) return { error: "phone is required" };
  // Scoped to the caller's own stores. This used to return every store's
  // orders for a phone number, which leaked other merchants' transactions.
  const rows = await fetchRows<OrderRow>(
    "orders",
    `${buildOrderParams({ phone, limit })}${storeIdFilter(storeIds)}`,
  );
  return rows.map((o) => ({
    product: o.product_name ?? o.product_category ?? "?",
    category: o.product_category ?? "?",
    price: o.price ?? 0,
    quantity: o.quantity ?? 1,
    city: o.city ?? "?",
    status: orderOutcome(o),
    date: (o.ordered_at ?? "").slice(0, 10),
  }));
}

async function toolWeeklyTrend(supabase: Db, _args: unknown, _storeIds: string[] = []) {
  // PRIVACY: weekly figures are an aggregate, so they now come from
  // verafo_aggregate_stats rather than from raw order rows. Cross-store
  // aggregate intelligence is allowed (R1); individual orders are not.
  const { data, error } = await supabase.rpc("verafo_aggregate_stats", {
    p_dimension: "week",
    p_days: 112,
  });
  if (error) return { error: error.message };
  return asRows<AggregateStatsRow>(data)
    .map((r) => ({
      week: String(r.bucket),
      orders: Number(r.orders),
      accepted: Number(r.accepted),
      refused: Number(r.refused),
      spend: Math.round(Number(r.value)),
      refusal_rate: r.refusal_rate == null ? null : Math.round(Number(r.refusal_rate) * 100),
    }))
    // Chronological, oldest first, because that is how a trend reads.
    .sort((a, b) => (a.week < b.week ? -1 : 1));
}

async function toolSimilarBuyers(supabase: Db, args: Record<string, unknown>) {
  const phone = argString(args, "phone");
  const limit = Math.max(1, Math.min(10, argNumber(args, "limit") ?? 5));
  if (!phone) return { error: "phone is required" };

  // PRIVACY FIX. This used to read `buyers.embedding` with the service role
  // (which bypasses RLS entirely) and then call find_similar_buyers(), which
  // RETURNS `phone`. That gave the assistant a way to produce other
  // merchants' customer phone numbers. It now calls similar_buyers_by_phone,
  // which keeps the vector inside the database and returns no phone number.
  //
  // The result is deliberately aggregate-only: the assistant can describe how
  // similar buyers behaved, but it cannot name or contact them.
  const { data, error } = await supabase.rpc("similar_buyers_by_phone", {
    p_phone: phone,
    p_limit: limit,
  });
  if (error) return { error: error.message };

  return asRows<SimilarBuyerRow>(data).slice(0, limit).map((r) => ({
    risk_score: Number(r.risk_score),
    total_orders: Number(r.total_orders),
    total_refused: Number(r.total_refused),
    similarity: Math.round((1 - Number(r.similarity)) * 1000) / 1000,
  }));
}

async function toolBuyerVerdict(
  supabase: Db,
  args: Record<string, unknown>,
  openai: OpenAI,
  storeIds: string[] = [],
) {
  const denied = requireOwnStores(storeIds);
  if (denied) return denied;
  const phone = argString(args, "phone");
  if (!phone) return { error: "phone is required" };
  const stats = await fetchStats(supabase, phone, storeIds);
  const { data: recent, error: rErr } = await supabase
    .from("orders")
    .select("product_name, product_category, price, city, ordered_at, outcomes(status, refusal_reason)")
    .eq("buyer_phone", phone)
    .in("store_id", storeIds)
    .order("ordered_at", { ascending: false })
    .limit(10);
  if (rErr) throw new Error(rErr.message);
  const detail = asRows<OrderRow>(recent)
    .map(
      (o) =>
        `${o.product_name ?? o.product_category} - ${o.price ?? "?"} PKR - ${o.city ?? "?"} - ${embedOne(o.outcomes)?.status ?? "pending"}`,
    )
    .join("\n");
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a COD risk analyst for an e-commerce network. Return ONLY valid JSON with exactly these keys: " +
          "{\"risk_factors\": string[] (max 6), \"positive_factors\": string[] (max 4), " +
          "\"recommendation\": \"ship\" | \"caution\" | \"refuse\", " +
          "\"verdict\": string (one sentence), \"confidence\": \"low\" | \"medium\" | \"high\"}. " +
          "Base every claim on the provided data.",
      },
      { role: "user", content: `Buyer ${phone}.\n${buildSummaryText(stats)}\n\nRecent orders:\n${detail}` },
    ],
    temperature: 0.3,
  });
  try {
    return { phone, ...JSON.parse(res.choices[0].message.content ?? "{}") };
  } catch {
    return { phone, error: "invalid verdict JSON" };
  }
}

/** Digits only, for comparing a typed phone number against stored numbers. */
function digitsOnly(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** A complete Pakistani mobile number is 10 digits after the country code
 *  (3XXXXXXXXX); with the leading zero or the 92 prefix it is 11 or 12. */
const FULL_PHONE_DIGITS = 10;

/**
 * Phone spellings to try against `buyers.phone`.
 *
 * Stored numbers are not guaranteed to be normalized, so a merchant typing
 * "03001234567" must still find "+923001234567". This widens the MATCH, never
 * the result set: the caller still has to supply a complete number.
 *
 * Returns an empty array for anything shorter than a full number. Callers must
 * treat that as "no match" and must never pass it to a filter, because an empty
 * `in (...)` list matches every row.
 */
function phoneLookupCandidates(raw: string): string[] {
  const digits = digitsOnly(raw);
  if (digits.length < FULL_PHONE_DIGITS) return [];
  const local10 = digits.slice(-FULL_PHONE_DIGITS);
  return [...new Set<string>([digits, `0${local10}`, local10, `+92${local10}`])];
}

/**
 * Buyer search for the chat agent.
 *
 * PRIVACY: this used to run `phone ilike '%<digits>%'` against the whole
 * `buyers` table. Because `buyers.phone` is the primary key, a partial-digit
 * query was a network-wide ENUMERATION endpoint: a merchant could walk
 * prefixes and harvest every buyer's phone number (R3).
 *
 * Two safe modes remain:
 *  - an exact phone number (the merchant already knows it) returns that one
 *    buyer's aggregate row, even if they never ordered from this store;
 *  - no number, or an ambiguous partial one, returns masked rankings from
 *    verafo_buyer_ranking - aggregate counts and a last-4-digits label, never
 *    an identity (R1, R4).
 */
async function toolSearchBuyers(supabase: Db, args: Record<string, unknown>, storeIds: string[] = []) {
  const denied = requireOwnStores(storeIds);
  if (denied) return denied;

  const queryDigits = digitsOnly(args.query);
  const city = argString(args, "city");
  const limit = Math.max(1, Math.min(20, argNumber(args, "limit") ?? 10));

  if (queryDigits.length === 0) {
    if (city) {
      // A city filter needs order rows, which are private: scope them to the
      // caller's own stores and make clear that the result is their own book.
      const cityOrders = await fetchRows<OrderRow>(
        "orders",
        `select=buyer_phone&city=eq.${encodeURIComponent(city)}&limit=5000${storeIdFilter(storeIds)}`,
      );
      const cityBuyers = new Set(cityOrders.map((o) => digitsOnly(o.buyer_phone)));
      if (cityBuyers.size === 0) {
        return { buyers: [], note: `No buyers in ${city} in your own stores.` };
      }
      const ranked = await supabase.rpc("verafo_buyer_ranking", {
        p_store_ids: storeIds,
        p_metric: "orders",
        p_limit: Math.max(limit * 4, 40),
        p_days: 365,
      });
      if (ranked.error) return { error: ranked.error.message };
      const buyers = asRows<BuyerRankingRow>(ranked.data)
        .filter((r) => cityBuyers.has(digitsOnly(r.buyer_label).slice(-4)))
        .slice(0, limit)
        .map((r) => ({
          buyer: String(r.buyer_label ?? "····"),
          orders: Number(r.orders ?? 0),
          refused: Number(r.refused ?? 0),
          risk_score: Number(r.risk_score ?? 0),
        }));
      return {
        buyers,
        note: `${buyers.length} masked buyers in ${city} from your stores. Identities are masked; look up a specific number to see a full profile.`,
      };
    }

    const ranked = await supabase.rpc("verafo_buyer_ranking", {
      p_store_ids: storeIds,
      p_metric: "orders",
      p_limit: limit,
      p_days: 365,
    });
    if (ranked.error) return { error: ranked.error.message };
    const buyers = asRows<BuyerRankingRow>(ranked.data).map((r) => ({
      buyer: String(r.buyer_label ?? "····"),
      orders: Number(r.orders ?? 0),
      refused: Number(r.refused ?? 0),
      risk_score: Number(r.risk_score ?? 0),
    }));
    return {
      buyers,
      note: "Identities are masked (last 4 digits only). Ask for a specific phone number to see one buyer's full profile.",
    };
  }

  if (queryDigits.length < FULL_PHONE_DIGITS) {
    return {
      buyers: [],
      error:
        "Enter the complete phone number, not a partial one: partial searches would let anyone enumerate buyers across the network.",
    };
  }

  // Exact lookup. Compare across common spellings so "+92 300 1234567" and
  // "03001234567" both resolve, but only ever return the single buyer asked for.
  const candidates = phoneLookupCandidates(queryDigits);
  if (candidates.length === 0) {
    return { buyers: [], error: "Enter a complete phone number to look a buyer up." };
  }
  const { data, error } = await supabase
    .from("buyers")
    .select("phone, risk_score, total_orders, total_accepted, total_refused")
    .in("phone", candidates)
    .limit(5);
  if (error) return { error: error.message };

  const rows = asRows<BuyerSearchRow>(data);
  if (rows.length === 0) {
    return { buyers: [], note: "No buyer with that phone number exists in the network yet." };
  }
  return {
    buyers: rows.map((b) => ({
      phone: String(b.phone),
      risk_score: Number(b.risk_score),
      total_orders: Number(b.total_orders),
      total_accepted: Number(b.total_accepted),
      total_refused: Number(b.total_refused),
    })),
  };
}

interface FileColumnSpec {
  key: string;
  label: string;
  format?: "number" | "pkr" | "percent" | "text";
}

interface FileSpec {
  kind: "pdf" | "csv" | "xlsx" | "excel";
  title: string;
  description?: string;
  columns: FileColumnSpec[];
  rows: Record<string, string | number>[];
  chart?: ChartSpec | null;
  generated_at: string;
}

interface FileNoData {
  noData: true;
  title: string;
  message: string;
}

function makeFileChart(
  rows: Record<string, string | number>[],
  title: string,
  labelKey: string,
  series: { key: string; label: string; format: "number" | "pkr" | "percent" }[],
  type: "bar" | "pie",
): ChartSpec | null {
  const data = (rows ?? []).slice(0, 12);
  if (data.length === 0) return null;
  return {
    type,
    title,
    labels: data.map((r) => String(r[labelKey] ?? "?").slice(0, 18)),
    datasets: series.map((s) => ({
      label: s.label,
      data: data.map((r) => Number(r[s.key]) || 0),
      format: s.format,
    })),
  };
}

/** Coerce scalar fields of a tool result into a file row. Nested objects and
 *  arrays are dropped rather than stringified, so a file can never smuggle a
 *  structured payload (a vector, say) into a cell. */
function toFileRows(rows: readonly unknown[]): Record<string, string | number>[] {
  return rows.map((row) => {
    const out: Record<string, string | number> = {};
    if (!row || typeof row !== "object") return out;
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "string" || typeof v === "number") out[k] = v;
      else if (typeof v === "boolean") out[k] = v ? "yes" : "no";
    }
    return out;
  });
}

async function buildFileSpec(
  supabase: Db,
  args: Record<string, unknown>,
  storeIds: string[] = [],
): Promise<FileSpec | FileNoData> {
  // PRIVACY: a generated file is the highest-risk output in the product - it
  // leaves our control permanently. It may only be produced from the caller's
  // own stores.
  const denied = requireOwnStores(storeIds);
  if (denied) {
    return {
      noData: true,
      title: "Verafo Report",
      message: denied.error,
    };
  }

  const rawKind = argString(args, "kind").toLowerCase();
  const kind = ["pdf", "csv", "xlsx", "excel"].includes(rawKind) ? (rawKind as FileSpec["kind"]) : "pdf";
  const dimension = argString(args, "dimension").toLowerCase() || "orders";
  const title = argString(args, "title").slice(0, 80) || "Verafo Report";
  const description = argString(args, "description");
  const limit = Math.max(1, Math.min(100, argNumber(args, "limit") ?? 25));
  const city = argString(args, "city");
  const category = argString(args, "category");
  const keyword = argString(args, "keyword");
  const days = argNumber(args, "days");
  const minPrice = argNumber(args, "min_price");
  const maxPrice = argNumber(args, "max_price");
  const rawMetric = argString(args, "metric");
  const metric = ["orders", "spend", "refusals", "risk"].includes(rawMetric) ? rawMetric : "orders";

  let columns: FileColumnSpec[];
  let rows: Record<string, string | number>[];
  let chart: ChartSpec | null;

  if (dimension === "orders" || dimension === "order") {
    const res = await toolSearchOrders(supabase, { city, category, keyword, min_price: minPrice, max_price: maxPrice, days, limit }, storeIds);
    columns = [
      { key: "product", label: "Product" },
      { key: "category", label: "Category" },
      { key: "price", label: "Price", format: "pkr" },
      { key: "quantity", label: "Qty", format: "number" },
      { key: "city", label: "City" },
      { key: "buyer", label: "Buyer" },
      { key: "status", label: "Status" },
      { key: "date", label: "Date" },
    ];
    rows = toFileRows("orders" in res ? res.orders : []);
    chart = makeFileChart(rows, "Top orders by value", "product", [{ key: "price", label: "Spend", format: "pkr" }], "bar");
  } else if (dimension === "buyers" || dimension === "buyer") {
    const buyersRes = await toolTopBuyers(supabase, { city, category, days, min_price: minPrice, metric, limit: Math.min(limit, 50) }, storeIds);
    if (!Array.isArray(buyersRes)) {
      // The tool refused or failed. Report it the same way the branches above
      // do, and never turn an error object into file rows.
      return { noData: true, title, message: buyersRes.error };
    }
    rows = toFileRows(buyersRes);
    columns = [
      { key: "buyer", label: "Buyer" },
      { key: "orders", label: "Orders", format: "number" },
      { key: "accepted", label: "Accepted", format: "number" },
      { key: "refused", label: "Refused", format: "number" },
      { key: "spend", label: "Spend", format: "pkr" },
      { key: "risk_score", label: "Risk", format: "percent" },
    ];
    const chartMetric =
      metric === "spend" ? { key: "spend", label: "Spend (PKR)", format: "pkr" as const }
        : metric === "refusals" ? { key: "refused", label: "Refused", format: "number" as const }
          : metric === "risk" ? { key: "risk_score", label: "Risk score", format: "number" as const }
            : { key: "orders", label: "Orders", format: "number" as const };
    chart = makeFileChart(rows, `Top buyers by ${chartMetric.label.toLowerCase()}`, "phone", [chartMetric], "bar");
  } else if (dimension === "products" || dimension === "product") {
    const productsRes = await toolTopProducts(supabase, { city, category, limit: Math.min(limit, 50) }, storeIds);
    if (!Array.isArray(productsRes)) {
      return { noData: true, title, message: productsRes.error };
    }
    rows = toFileRows(productsRes);
    columns = [
      { key: "product", label: "Product" },
      { key: "category", label: "Category" },
      { key: "orders", label: "Orders", format: "number" },
      { key: "accepted", label: "Accepted", format: "number" },
      { key: "refused", label: "Refused", format: "number" },
      { key: "refusal_rate", label: "Refusal %", format: "percent" },
      { key: "spend", label: "Spend", format: "pkr" },
      { key: "avg_price", label: "Avg Price", format: "pkr" },
    ];
    chart = makeFileChart(rows, "Top products by orders", "product", [{ key: "orders", label: "Orders", format: "number" }], "bar");
  } else if (dimension === "stores" || dimension === "store") {
    // toolStoreOverview is gated by requireOwnStores and scoped to the
    // caller's own stores, so a "stores" file can only ever list their own.
    const storesRes = await toolStoreOverview(supabase, { city }, storeIds);
    if (!Array.isArray(storesRes)) {
      // The store tool is gated by requireOwnStores: its refusal is reported
      // here, never downgraded into an empty or unscoped file.
      return { noData: true, title, message: storesRes.error };
    }
    rows = toFileRows(storesRes);
    columns = [
      { key: "store", label: "Store" },
      { key: "orders", label: "Orders", format: "number" },
      { key: "buyers", label: "Buyers", format: "number" },
      { key: "accepted", label: "Accepted", format: "number" },
      { key: "refused", label: "Refused", format: "number" },
      { key: "refusal_rate", label: "Refusal %", format: "percent" },
      { key: "spend", label: "Spend", format: "pkr" },
    ];
    chart = makeFileChart(rows, "Orders by store", "store", [{ key: "orders", label: "Orders", format: "number" }], "bar");
  } else if (dimension === "categories" || dimension === "category") {
    const categoriesRes = await toolCategoryOverview(supabase, { city }, storeIds);
    if (!Array.isArray(categoriesRes)) {
      return { noData: true, title, message: categoriesRes.error };
    }
    rows = toFileRows(categoriesRes);
    columns = [
      { key: "category", label: "Category" },
      { key: "orders", label: "Orders", format: "number" },
      { key: "accepted", label: "Accepted", format: "number" },
      { key: "refused", label: "Refused", format: "number" },
      { key: "refusal_rate", label: "Refusal %", format: "percent" },
      { key: "avg_price", label: "Avg Price", format: "pkr" },
    ];
    chart = makeFileChart(rows, "Orders by category", "category", [{ key: "orders", label: "Orders", format: "number" }], "pie");
  } else if (dimension === "cities" || dimension === "city") {
    const citiesRes = await toolCityOverview(supabase, {}, storeIds);
    if (!Array.isArray(citiesRes)) {
      return { noData: true, title, message: citiesRes.error };
    }
    rows = toFileRows(citiesRes);
    columns = [
      { key: "city", label: "City" },
      { key: "orders", label: "Orders", format: "number" },
      { key: "buyers", label: "Buyers", format: "number" },
      { key: "accepted", label: "Accepted", format: "number" },
      { key: "refused", label: "Refused", format: "number" },
      { key: "refusal_rate", label: "Refusal %", format: "percent" },
      { key: "spend", label: "Spend", format: "pkr" },
    ];
    chart = makeFileChart(rows, "Orders by city", "city", [{ key: "orders", label: "Orders", format: "number" }], "bar");
  } else if (dimension === "weekly" || dimension === "trend") {
    const weeklyRes = await toolWeeklyTrend(supabase, { weeks: Math.max(1, Math.min(16, argNumber(args, "weeks") ?? 8)), city }, storeIds);
    if (!Array.isArray(weeklyRes)) {
      return { noData: true, title, message: weeklyRes.error };
    }
    rows = toFileRows(weeklyRes);
    columns = [
      { key: "week", label: "Week" },
      { key: "orders", label: "Orders", format: "number" },
      { key: "accepted", label: "Accepted", format: "number" },
      { key: "refused", label: "Refused", format: "number" },
      { key: "refusal_rate", label: "Refusal %", format: "percent" },
      { key: "spend", label: "Spend", format: "pkr" },
    ];
    chart = makeFileChart(rows, "Orders per week", "week", [{ key: "orders", label: "Orders", format: "number" }], "bar");
  } else {
    // Unknown dimension: fall back to orders. `storeIds` MUST be forwarded, or
    // the recursive call would hit requireOwnStores with an empty list and
    // refuse a request the caller was entitled to make.
    return buildFileSpec(supabase, { ...args, dimension: "orders" }, storeIds);
  }

  if (rows.length === 0) {
    const filters: string[] = [];
    if (city) filters.push(`city "${city}"`);
    if (category) filters.push(`category "${category}"`);
    if (keyword) filters.push(`keyword "${keyword}"`);
    if (days != null && days > 0) filters.push(`last ${days} days`);
    if (minPrice != null && minPrice > 0) filters.push(`min ${minPrice} PKR`);
    return {
      noData: true,
      title,
      message:
        `No ${dimension === "buyers" || dimension === "buyer" ? "buyers" : dimension} matched the requested filters` +
        (filters.length > 0 ? ` (${filters.join(", ")})` : "") +
        ". The file was not generated.",
    };
  }

  return {
    kind,
    title,
    description,
    columns,
    rows,
    chart,
    generated_at: new Date().toISOString(),
  };
}

const AGENT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_orders",
      description:
        "Search COD orders for matching products/orders. Use keyword for a product-name substring (e.g. 'shower', 'serum'), or filter by category, city, price range, buyer phone or a recent days window. Returns order rows with product, category, price, quantity, city, buyer phone and outcome status.",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Substring matched against product name, case-insensitive. e.g. 'shower' or 'vitamin'." },
          category: { type: "string", description: "Exact product category (skincare, clothing, electronics, footwear, beauty, home, accessories, haircare)." },
          city: { type: "string", description: "Exact city name, e.g. 'Islamabad', 'Lahore', 'Karachi'." },
          min_price: { type: "number", description: "Minimum price in PKR (inclusive)." },
          max_price: { type: "number", description: "Maximum price in PKR (inclusive)." },
          phone: { type: "string", description: "Exact buyer phone, e.g. '+923001112222'." },
          days: { type: "number", description: "Only orders placed within the last N days (e.g. 30 = last month)." },
          limit: { type: "number", description: "Max rows returned (default 50)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buyers_by_city",
      description:
        "Count unique buyers who have ordered in a given city, optionally filtered to those who ever ordered at or above min_price, or in a category. Use this to estimate how many people in a city could buy a product.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "Exact city name, e.g. 'Islamabad'. Required." },
          min_price: { type: "number", description: "Only count buyers who placed at least one order at or above this price (PKR)." },
          category: { type: "string", description: "Only count buyers who ordered in this category." },
          days: { type: "number", description: "Only consider orders within the last N days." },
        },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "top_buyers",
      description:
        "Rank buyers by a metric: orders (most active), spend (most total order value), refusals (most refused orders) or risk (highest risk score), optionally restricted to a city. Use this for questions about top buyers, biggest spenders, or who refuses the most. Phone numbers are this seller's own customers - report them verbatim, do not mask them.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many buyers to return (default 5, max 20)." },
          metric: { type: "string", description: "How to rank: 'orders', 'spend', 'refusals' or 'risk'. Default 'orders'." },
          city: { type: "string", description: "Optional exact city name to restrict to." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buyer_profile",
      description: "Get a full buyer profile: risk score, order totals, categories, cities and recent order history with outcomes.",
      parameters: {
        type: "object",
        properties: { phone: { type: "string", description: "Exact buyer phone, e.g. '+923001112222'." } },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "city_overview",
      description: "Compare all cities by number of orders, unique buyers and total spend.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "category_overview",
      description: "Order counts, refusal rate and average price per product category, optionally for one city.",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "Optional exact city name to filter to." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "store_overview",
      description:
        "Compare stores in the network: orders, unique buyers, accepted/refused and total spend per store. Use this for questions about which shop/store performs best or worst, or to compare stores in a city.",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "Optional exact city name to filter to." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "top_products",
      description:
        "Most ordered products with order counts, refusal rate, average price and total spend. Use this for 'what sells best', 'most ordered products', or 'which products have high refusals'.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Optional exact category to restrict to." },
          city: { type: "string", description: "Optional exact city name to filter to." },
          limit: { type: "number", description: "How many products to return (default 10, max 20)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "network_overview",
      description:
        "High-level network health: total buyers, orders, accepted/refused/pending counts, refusal rate, total spend, average order value, risk buckets and top categories. Use for 'how is my business doing', 'overall health', or a general snapshot.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "refusal_reasons",
      description:
        "Breakdown of why orders were refused, grouped by refusal reason with counts. Use for 'why do people refuse', 'common reasons for refusals'.",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "Optional exact city name to filter to." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buyer_orders",
      description: "Detailed recent order history for one buyer: product, category, price, quantity, city, status and date.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Exact buyer phone, e.g. '+923001112222'. Required." },
          limit: { type: "number", description: "Max orders to return (default 20, max 50)." },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "weekly_trend",
      description:
        "Order counts, accepted/refused and spend grouped by week. Use for 'orders per week', 'weekly trend', 'how did last month look'.",
      parameters: {
        type: "object",
        properties: {
          weeks: { type: "number", description: "How many weeks back to include (default 8, max 16)." },
          city: { type: "string", description: "Optional exact city name to filter to." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "similar_buyers",
      description:
        "Find the most behaviourally similar buyers to a given buyer using their AI embedding fingerprint. Use for 'who is like this buyer', 'find similar customers', 'other buyers like +92...'. Returns phones with risk score and similarity.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Exact buyer phone to compare against, e.g. '+923001112222'. Required." },
          limit: { type: "number", description: "How many similar buyers to return (default 5, max 10)." },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buyer_verdict",
      description:
        "Get an AI risk verdict for a buyer: ship, caution or refuse recommendation with risk factors, positive factors and confidence. Use for 'should I ship to X', 'is this buyer safe', 'recommendation for this order'.",
      parameters: {
        type: "object",
        properties: { phone: { type: "string", description: "Exact buyer phone, e.g. '+923001112222'. Required." } },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_buyers",
      description:
        "Look up buyers. With a COMPLETE phone number this returns that buyer's aggregate profile, even if they never ordered from this store. With no number it returns a masked ranking (last 4 digits only). Partial phone numbers are refused because they would let anyone enumerate buyers network-wide; ask the user for the full number instead.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "A COMPLETE phone number, e.g. '03001234567' or '+923001234567'. Never a partial number.",
          },
          city: { type: "string", description: "Optional exact city name to filter the masked ranking to." },
          limit: { type: "number", description: "Max buyers to return (default 10, max 20)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description:
        "Generate a downloadable data file (PDF, CSV or Excel/XLSX) containing the exact data for the user's request. MUST be called whenever the user asks for a file, report, export or download (e.g. 'pdf of this data', 'excel file', 'export as csv'). Pick a dimension that matches what they want (orders, buyers, products, stores, categories, cities or weekly) and pass the same filters as their request (category, city, days, min_price, metric, limit). The file is attached below your reply automatically - after calling it, just summarize the key numbers in 2-3 sentences.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", description: "File format: 'pdf', 'csv' or 'xlsx' (Excel). Default 'pdf'." },
          dimension: { type: "string", description: "What data the file contains: 'orders', 'buyers', 'products', 'stores', 'categories', 'cities' or 'weekly'." },
          title: { type: "string", description: "Short, clear title for the file, e.g. 'Top 10 Footwear Buyers - Last Month'." },
          category: { type: "string", description: "Optional exact product category filter (skincare, clothing, electronics, footwear, beauty, home, accessories, haircare)." },
          city: { type: "string", description: "Optional exact city filter." },
          days: { type: "number", description: "Optional: only data from the last N days (e.g. 30 = last month)." },
          min_price: { type: "number", description: "Optional: only orders/buyers at or above this price or spend (PKR)." },
          metric: { type: "string", description: "For buyers: how to rank - 'orders', 'spend', 'refusals' or 'risk'. Default 'orders'." },
          limit: { type: "number", description: "Max rows in the file (default 25, max 100)." },
        },
      },
    },
  },
];

/**
 * Coerce a raw tool-argument payload into a plain object.
 *
 * `args` arrives from the model as `unknown`: it may be missing, null, an
 * array, or a scalar. Every tool indexes it by key, so it is normalised once
 * here (`args ?? {}` would have passed a string or array straight through).
 */
function asArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

async function runAgentTool(
  name: string,
  args: unknown,
  supabase: Db,
  openai: OpenAI,
  storeIds: string[] = [],
): Promise<unknown> {
  // PRIVACY: every tool that returns private order or buyer detail is gated
  // by requireOwnStores(storeIds) inside the tool itself, and its queries are
  // filtered to those store ids. An empty list means DENY, never 'no filter'.
  const a = asArgs(args);
  switch (name) {
    case "search_orders":
      return await toolSearchOrders(supabase, a, storeIds);
    case "buyers_by_city":
      return await toolBuyersByCity(supabase, a, storeIds);
    case "buyer_profile":
      return await toolBuyerProfile(supabase, a, storeIds);
    case "top_buyers":
      return await toolTopBuyers(supabase, a, storeIds);
    case "city_overview":
      return await toolCityOverview(supabase, a, storeIds);
    case "category_overview":
      return await toolCategoryOverview(supabase, a, storeIds);
    case "store_overview":
      return await toolStoreOverview(supabase, a, storeIds);
    case "top_products":
      return await toolTopProducts(supabase, a, storeIds);
    case "network_overview":
      return await toolNetworkOverview(supabase, a, storeIds);
    case "refusal_reasons":
      return await toolRefusalReasons(supabase, a, storeIds);
    case "buyer_orders":
      return await toolBuyerOrders(supabase, a, storeIds);
    case "weekly_trend":
      return await toolWeeklyTrend(supabase, a, storeIds);
    case "similar_buyers":
      return await toolSimilarBuyers(supabase, a);
    case "buyer_verdict":
      return await toolBuyerVerdict(supabase, a, openai, storeIds);
    case "search_buyers":
      return await toolSearchBuyers(supabase, a, storeIds);
    case "create_file":
      return await buildFileSpec(supabase, a, storeIds);
    default:
      return { error: `unknown tool: ${name}` };
  }
}

const CHART_MARKER_RE = /\[\[CHART\]\][\s\S]*?\[\[\/CHART\]\]/g;

const KNOWN_CITIES = [
  "Lahore",
  "Karachi",
  "Islamabad",
  "Rawalpindi",
  "Faisalabad",
  "Multan",
  "Peshawar",
  "Sialkot",
  "Gujranwala",
  "Quetta",
  "Hyderabad",
];

function detectCity(prompt: string): string | null {
  const p = prompt.toLowerCase();
  for (const c of KNOWN_CITIES) {
    if (p.includes(c.toLowerCase())) return c;
  }
  return null;
}

const FILE_MARKER_RE = /\[\[FILE\]\][\s\S]*?\[\[\/FILE\]\]/g;

function cleanHistory(h: { role: string; content: string }[], rawPrompt: string): { role: string; content: string }[] {
  return h
    .filter((m) => !(m.role === "user" && m.content === rawPrompt))
    .map((m) =>
      m.role === "assistant"
        ? { ...m, content: m.content.replace(CHART_MARKER_RE, "").replace(FILE_MARKER_RE, "").trim() }
        : m,
    );
}

async function embedBuyerVector(
  supabase: Db,
  openai: OpenAI,
  phone: string,
  storeIds: string[] = [],
): Promise<number[]> {
  const stats = await fetchStats(supabase, phone, storeIds);
  const fv = await buildFeatureVector(supabase, phone, storeIds);
  const text = buildSummaryText(stats);
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  const vector = res.data[0].embedding as number[];
  const { error } = await supabase
    .from("buyers")
    .update({
      embedding: vector,
      feature_vector: fv.vector,
      updated_at: new Date().toISOString(),
    })
    .eq("phone", phone);
  if (error) throw new Error(error.message);
  return vector;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

function jacobiEigenSymmetric(
  a: number[][],
  maxSweeps = 60,
): { values: number[]; vectors: number[][] } {
  const n = a.length;
  const m = a.map((r) => [...r]);
  const v = Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0);
    row[i] = 1;
    return row;
  });
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p][q] * m[p][q];
    if (off < 1e-14) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const app = m[p][p];
        const aqq = m[q][q];
        const apq = m[p][q];
        if (Math.abs(apq) < 1e-16) continue;
        const tau = (aqq - app) / (2 * apq);
        const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const m_pk = m[p][k];
          const m_qk = m[q][k];
          m[p][k] = c * m_pk - s * m_qk;
          m[q][k] = s * m_pk + c * m_qk;
        }
        for (let k = 0; k < n; k++) {
          const m_kp = m[k][p];
          const m_kq = m[k][q];
          m[k][p] = c * m_kp - s * m_kq;
          m[k][q] = s * m_kp + c * m_kq;
        }
        for (let k = 0; k < n; k++) {
          const v_kp = v[k][p];
          const v_kq = v[k][q];
          v[k][p] = c * v_kp - s * v_kq;
          v[k][q] = s * v_kp + c * v_kq;
        }
      }
    }
  }
  const rawValues = m.map((row, i) => row[i]);
  const order = rawValues.map((_, i) => i).sort((a, b) => rawValues[b] - rawValues[a]);
  return {
    values: order.map((i) => rawValues[i]),
    vectors: order.map((i) => v.map((row) => row[i])),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body.action as string;
    const phone = String(body.phone ?? "");
const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // PRIVACY: the service role bypasses RLS, so identify the caller here and
    // hand the owned store ids to every tool that returns private data.
    const { storeIds } = await authorizeCaller(req);
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({ error: "OPENAI_API_KEY is not set on this function" }, 500);
    }
    const openai = new OpenAI({ apiKey });

    if (action === "embed") {
      const stats = await fetchStats(supabase, phone, storeIds);
      const fv = await buildFeatureVector(supabase, phone, storeIds);
      const text = buildSummaryText(stats);
      const res = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });
      const vector = res.data[0].embedding;
      const { error } = await supabase
        .from("buyers")
        .update({
          embedding: vector,
          feature_vector: fv.vector,
          updated_at: new Date().toISOString(),
        })
        .eq("phone", phone);
      if (error) throw new Error(error.message);
      return json({
        ok: true,
        summary: text,
        feature_labels: fv.labels,
        feature_vector: fv.vector,
        feature_dimensions: fv.vector.length,
      });
    }

    if (action === "embed_map") {
      // The map below does an O(n^3) eigendecomposition on the buyer Gram
      // matrix (classical MDS). Left unbounded, that blows the edge
      // function's CPU-time budget once the network grows past a few
      // hundred buyers (WORKER_RESOURCE_LIMIT). Cap the set and prioritize
      // the most-active buyers — they're also the most informative ones for
      // spotting risk clusters. Embedding calls to OpenAI are capped
      // separately per run so one invocation can't stall on hundreds of
      // sequential API calls; "rebuild vectors" can be clicked again to
      // pick up more.
      const MAX_MAP_BUYERS = 150;
      const MAX_EMBED_PER_RUN = 40;

      const { count: totalBuyers } = await supabase
        .from("buyers")
        .select("phone", { count: "exact", head: true });

      const { data: buyers, error } = await supabase
        .from("buyers")
        .select("phone, risk_score, total_orders, total_accepted, total_refused, embedding")
        .order("total_orders", { ascending: false })
        .limit(MAX_MAP_BUYERS);
      if (error) throw new Error(error.message);
      const rows = asRows<BuyerEmbeddingRow>(buyers);

      const missing = rows
        .filter((b) => !b.embedding || !Array.isArray(b.embedding))
        .map((b) => String(b.phone))
        .slice(0, MAX_EMBED_PER_RUN);
      const failed: string[] = [];
      if (missing.length > 0) {
        const vectors = await mapLimit(missing, 10, async (phone) => {
          try {
            return { phone, vector: await embedBuyerVector(supabase, openai, phone, storeIds) };
          } catch {
            failed.push(phone);
            return null;
          }
        });
        for (const v of vectors) {
          if (v) {
            const b = rows.find((r) => String(r.phone) === v.phone);
            if (b) b.embedding = v.vector;
          }
        }
      }

      const vecs = rows
        .filter((b): b is BuyerEmbeddingRow & { embedding: number[] } =>
          Array.isArray(b.embedding) && b.embedding.length > 0
        )
        .map((b) => ({
          phone: String(b.phone),
          risk: Number(b.risk_score ?? 0.5),
          orders: Number(b.total_orders ?? 0),
          accepted: Number(b.total_accepted ?? 0),
          refused: Number(b.total_refused ?? 0),
          embedding: b.embedding,
        }));

      const spendMap = new Map<string, number>();
      if (vecs.length > 0) {
        const orderRows = await fetchRows<OrderRow>("orders", `select=buyer_phone,price&limit=10000${storeIdFilter(storeIds)}`);
        for (const o of orderRows) {
          if (o.price != null) {
            const p = String(o.buyer_phone);
            spendMap.set(p, (spendMap.get(p) ?? 0) + Number(o.price));
          }
        }
      }

      const points: BuyerMapPoint[] = [];
      if (vecs.length >= 2) {
        const n = vecs.length;
        const d = vecs[0].embedding.length;
        const mean = new Array<number>(d).fill(0);
        for (const v of vecs) for (let k = 0; k < d; k++) mean[k] += v.embedding[k];
        for (let k = 0; k < d; k++) mean[k] /= n;

        const gram = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let i = 0; i < n; i++) {
          const vi = vecs[i].embedding;
          for (let j = i; j < n; j++) {
            const vj = vecs[j].embedding;
            let s = 0;
            for (let k = 0; k < d; k++) s += (vi[k] - mean[k]) * (vj[k] - mean[k]);
            gram[i][j] = s;
            gram[j][i] = s;
          }
        }

        const eig = jacobiEigenSymmetric(gram);
        const norm = (arr: number[]) => {
          const min = Math.min(...arr);
          const max = Math.max(...arr);
          const span = max - min || 1;
          return arr.map((v) => 0.08 + ((v - min) / span) * 0.84);
        };
        const proj = [0, 1, 2].map((c) => {
          const comp = eig.vectors[c].map((u) => u * Math.sqrt(Math.max(0, eig.values[c])));
          const s = comp.reduce((a, b) => a + b, 0);
          return s < 0 ? comp.map((v) => -v) : comp;
        });
        const xs = norm(proj[0]);
        const ys = norm(proj[1]);
        const zs = norm(proj[2]);

        for (let i = 0; i < n; i++) {
          const b = vecs[i];
          const spend = spendMap.get(b.phone) ?? 0;
          points.push({
            phone: b.phone,
            risk: b.risk,
            orders: b.orders,
            refused: b.refused,
            spend: Math.round(spend),
            avgOrderValue: b.orders > 0 ? Math.round(spend / b.orders) : 0,
            x: xs[i],
            y: ys[i],
            z: zs[i],
            radius: 0.02 + Math.min(0.03, Math.sqrt(b.orders) * 0.004),
          });
        }
      }

      return json({
        ok: true,
        points,
        embedded: vecs.length,
        total: totalBuyers ?? rows.length,
        shown: rows.length,
        failed,
        note:
          (totalBuyers ?? rows.length) > rows.length
            ? `Showing the ${rows.length} most-active buyers out of ${totalBuyers} network-wide.`
            : failed.length > 0
              ? `${failed.length} buyers could not be embedded and are not shown.`
              : undefined,
      });
    }

    if (action === "explain") {
      const stats = await fetchStats(supabase, phone, storeIds);
      const text = buildSummaryText(stats);
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a risk analyst for an e-commerce COD (cash on delivery) network. " +
              "Explain this buyer's reliability to a shop owner in ONE short sentence, max 25 words. " +
              "No preamble, no markdown.",
          },
          { role: "user", content: `Buyer profile:\n${text}` },
        ],
        temperature: 0.4,
      });
      return json({ ok: true, text: res.choices[0].message.content });
    }

    if (action === "chat") {
      const rawPrompt = String(body.prompt ?? "").trim();
      if (!rawPrompt) return json({ error: "prompt is required" }, 400);
      const mentionPhone = body.phone ? String(body.phone) : null;
      const chatId = body.chat_id ? String(body.chat_id) : null;

      return sse(async (emit) => {
        emit("phase", { phase: "understanding", label: "Understanding your question" });

        let context = "";
        if (mentionPhone) {
          try {
            context =
              `Buyer profile for ${mentionPhone}:\n` +
              buildSummaryText(await fetchStats(supabase, mentionPhone, storeIds));
          } catch {
            context = `Buyer ${mentionPhone} has no profile in the network yet.`;
          }
        }

        const history = chatId ? await listChatHistory(supabase, chatId) : [];

        let charts: ChartSpec[] = [];
        if (/graph|chart|plot|compare|comparison|visuali|breakdown|histogram|pie|scatter|dashboard|scatter plot|top\s?\d+|\btop\b|\bbest\b|ranking|ranked|\blist of\b|\bwho buys\b|\bwho order\b|distribution|overview/i.test(rawPrompt)) {
          emit("phase", { phase: "researching", label: "Planning your charts" });
          try {
            const intentRes = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: CHART_INTENT_PROMPT },
                { role: "user", content: rawPrompt },
              ],
              temperature: 0,
            });
            const intent = JSON.parse(intentRes.choices[0].message.content ?? "{}");
            const mentionsWindow = /\b(?:last|past|previous|this|next|recent|recently|over the)\b[^.]{0,40}\b(?:day|days|week|weeks|month|months|year|years|fortnight|quarter)\b|\d+\s*(?:days?|weeks?|months?|years?)\b/i.test(rawPrompt);
            const mentionsCount = /\b(?:top|bottom|first|best)\b[^.]{0,30}\d+|\d+\s*(?:stores?|buyers?|categories?|cities?|items?|orders?|people?|customers?)\b|\b(?:top|bottom)\s?\d+/i.test(rawPrompt);
            const mentionedCategory = Object.keys(KNOWN_CATEGORIES).find((k) => new RegExp(`\\b${k}\\b`, "i").test(rawPrompt));
            const list = Array.isArray(intent.charts)
              ? intent.charts
              : intent.wants_chart
                ? [{
                    chart_type: intent.chart_type,
                    metric: intent.metric,
                    metrics: intent.metrics,
                    dimension: intent.dimension,
                    title: intent.title,
                    limit: intent.limit,
                    days: intent.days,
                  }]
                : [];
            const built: ChartSpec[] = [];
            for (const c of list.slice(0, 4)) {
              if (!mentionsWindow) delete c.days;
              if (!mentionsCount) delete c.limit;
              if (!mentionedCategory || !c.category || !KNOWN_CATEGORIES[String(c.category).trim().toLowerCase()]) {
                delete c.category;
              }
              const ch = await buildChartData(c, mentionPhone ?? undefined, storeIds);
              if (ch) built.push(ch);
            }
            charts = built;
          } catch {
            charts = [];
          }
        }

        const chartNote =
          charts.length > 0
            ? " The charts for the user's request are ALREADY generated and displayed below your message. " +
              "Never mention charts, graphs, images or visual content, and never offer to create alternatives. " +
              "Do not ask the user to share data. " +
              "Reply ONLY with a short summary of what the data shows, 2-3 sentences."
            : "";
        const chartUserNote =
          charts.length > 0
            ? "\n\n(Charts for this request are already rendered below your reply. " +
              "Do not mention them or refuse to create them - just summarize the data briefly.)"
            : "";
        const fileNote =
          /(?:\b(?:pdf|csv|excel|xlsx|spreadsheet|\.xls|\.pdf|file|download|export|report)\b|generate|create|make)\s.{0,40}\b(?:file|pdf|csv|excel|xlsx|spreadsheet)\b|\b(?:file|pdf|csv|excel|xlsx|spreadsheet)\b.{0,40}(?:of this data|of these|download|export)/i.test(
            rawPrompt,
          )
            ? " FILE REQUEST DETECTED: the user asked for a downloadable file. You MUST call the " +
              "create_file tool with a clear title, the format they asked for (kind: \"pdf\" | \"csv\" | \"xlsx\"), " +
              "and the exact filters matching their request (dimension, category, city, days, min_price, metric, limit). " +
              "The generated file is attached below your reply automatically. After calling create_file, reply with " +
              "a short 2-3 sentence summary of what the file contains - do not refuse, do not offer alternatives, " +
              "do not repeat every row. If create_file reports noData / no matching data, tell the user clearly that " +
              "no records matched the filters and that no file was generated - do not claim a file exists."
            : "";
        const fileUserNote =
          /\b(?:file|pdf|csv|excel|xlsx|spreadsheet|download|export|report)\b/i.test(rawPrompt)
            ? "\n\n(If the user asked for a downloadable file, call create_file - it is attached automatically.)"
            : "";
        const userContent = context
          ? `Context:\n${context}\n\nQuestion:\n${rawPrompt}${chartUserNote}${fileUserNote}`
          : `${rawPrompt}${chartUserNote}${fileUserNote}`;

        const detectedCity = detectCity(rawPrompt);
        const cityScopeNote = detectedCity
          ? `\n\nSCOPE CONSTRAINT: The user is asking specifically about ${detectedCity}. ` +
            `Every tool call MUST include city: "${detectedCity}" so the result is scoped to ${detectedCity} only. ` +
            `Never present numbers from other cities or the whole network as if they belong to ${detectedCity}.`
          : "";

        const messages: any[] = [
          {
            role: "system",
            content:
              "You are Verafo, a COD (cash on delivery) risk assistant for e-commerce sellers in " +
              "Pakistan. You help shop owners decide whether to ship an order, understand demand and " +
              "analyze their network.\n\n" +
              "You have live access to the store's database through tools. For ANY question about " +
              "buyers, orders, cities, products, prices, demand or counts, you MUST call the tools to " +
              "look up the real data before answering - never guess, never give generic market advice, " +
              "and never ask the user to do the research. Call as many tools as you need, then answer " +
              "with the actual numbers you found.\n\n" +
              "TOOLS YOU HAVE: search_orders (find orders by product/category/city/price), " +
              "buyers_by_city (count buyers in a city, optionally above a price or in a category), " +
              "buyer_profile (full profile for one buyer), top_buyers (rank buyers by orders/spend/refusals/risk), " +
              "city_overview (compare cities), category_overview (compare categories), " +
              "store_overview (compare stores), top_products (best selling products), " +
              "network_overview (overall health snapshot), refusal_reasons (why orders were refused), " +
              "buyer_orders (recent order history), weekly_trend (orders by week), " +
              "similar_buyers (behaviourally similar buyers via AI fingerprint), " +
              "buyer_verdict (ship/caution/refuse recommendation), search_buyers (find buyers by filters).\n\n" +
              "ACCURACY RULES (critical):\n" +
              "- Never invent, estimate or recompute counts, prices or percentages yourself. " +
              "Report ONLY the numbers that appear verbatim in the tool results.\n" +
              "- Quote exact values: \"X refused out of Y orders\" using the tool's own fields " +
              "(refused, accepted, orders, refusal_rate, spend, avg_price).\n" +
              "- When comparing, read the comparison directly from the tool output - do not do math in your head.\n" +
              "- If a number is not present in any tool result, say \"not in the data\" instead of guessing.\n" +
              "- If the question mentions a specific city (e.g. Lahore, Islamabad), you MUST pass that " +
              "city to every tool call so the result is scoped to that city. Never present global numbers " +
              "as if they belong to one city.\n" +
              "- If the question mentions a product (e.g. \"muslim shower\"), search for it by keyword " +
              "to get exact matches before estimating.\n" +
              "- Buyer phone numbers returned by tools are this seller's own customers - include them " +
              "verbatim in your answer (e.g. +923001112222). Never mask or anonymize them.\n" +
              "- When the user asks whether to ship to a buyer, prefer calling buyer_verdict to get a " +
              "recommendation, and quote its verdict.\n" +
              "- When the user asks who is similar to a buyer, call similar_buyers.\n\n" +
              "Answer concisely and practically - a few bullets or a short paragraph, max 150 words, " +
              "plain English, no markdown headers. State your assumptions and give a data-backed " +
              "estimate when exact numbers don't exist. Stay consistent with the conversation history." +
              chartNote +
              fileNote +
              cityScopeNote,
          },
          ...cleanHistory(history, rawPrompt).map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userContent },
        ];

        emit("phase", { phase: "researching", label: "Researching your data" });

        let text = "";
        const files: FileSpec[] = [];
        let activeCity: string | null = detectedCity;
        for (let i = 0; i < 6; i++) {
          const res = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            tools: AGENT_TOOLS,
            tool_choice: "auto",
            temperature: 0,
          });
          const msg = res.choices[0].message;
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            messages.push({
              role: "assistant",
              content: msg.content ?? "",
              tool_calls: msg.tool_calls,
            });
            for (const tc of msg.tool_calls) {
              let result: unknown;
              try {
                let args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
                if (typeof args.city === "string" && args.city.trim()) {
                  activeCity = args.city.trim();
                }
                if (activeCity && !args.city && tc.function.name !== "buyer_profile" && tc.function.name !== "city_overview") {
                  args = { ...args, city: activeCity };
                }
                emit("tool_call", {
                  name: tc.function.name,
                  args: summarizeArgs(args),
                  label: TOOL_LABELS[tc.function.name] ?? tc.function.name,
                });
                result = await runAgentTool(tc.function.name, args, supabase, openai);
                emit("tool_result", {
                  name: tc.function.name,
                  summary: summarizeTool(tc.function.name, result),
                });
                if (tc.function.name === "create_file") {
                  const spec = result as FileSpec | FileNoData;
                  if (spec && (spec as FileNoData).noData) {
                    // no matching data - do not generate a file; the model gets this
                    // result so it can tell the user no file was created
                  } else if (
                    spec &&
                    Array.isArray((spec as FileSpec).columns) &&
                    Array.isArray((spec as FileSpec).rows) &&
                    (spec as FileSpec).rows.length > 0
                  ) {
                    files.push(spec as FileSpec);
                    emit("file", { spec });
                  } else {
                    result = {
                      noData: true,
                      title: String((spec as FileSpec)?.title ?? "Report"),
                      message: "No matching data was found for the requested file. The file was not generated.",
                    };
                  }
                }
                if (tc.function.name === "city_overview") {
                  const arr = Array.isArray(result) ? result : [];
                  if (arr.length > 0 && !activeCity) {
                    const top = arr.find(
                      (r): r is { city: string; refused: number } =>
                        typeof (r as { city?: unknown }).city === "string" &&
                        typeof (r as { refused?: unknown }).refused === "number",
                    );
                    if (top) activeCity = top.city;
                  }
                }
              } catch (e) {
                result = { error: e instanceof Error ? e.message : String(e) };
                emit("tool_result", {
                  name: tc.function.name,
                  summary: "error",
                  error: true,
                });
              }
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(result),
              });
            }
            continue;
          }
          text = msg.content ?? "";
          break;
        }
        text = stripRefusalSentences(text, charts.length > 0 || files.length > 0);
        if (!text.trim()) {
          text =
            charts.length > 0 || files.length > 0
              ? "Here\u2019s a quick look at the data you asked about."
              : "I couldn\u2019t find an answer in the data. Try asking about buyers, orders, cities or products.";
        }
        const storedBlocks: string[] = [text];
        if (charts.length > 0) {
          storedBlocks.push(charts.map((c) => `[[CHART]]${JSON.stringify(c)}[[/CHART]]`).join("\n\n"));
        }
        if (files.length > 0) {
          storedBlocks.push(files.map((f) => `[[FILE]]${JSON.stringify(f)}[[/FILE]]`).join("\n\n"));
        }
        const storedContent = storedBlocks.join("\n\n");

        let messageId: string | null = null;
        let title: string | null = null;
        if (chatId) {
          const isFirstExchange = history.length <= 1;
          const { data: assistantMsg, error: insErr } = await supabase
            .from("chat_messages")
            .insert({
              chat_id: chatId,
              role: "assistant",
              content: storedContent,
              phone: mentionPhone,
            })
            .select("id")
            .single();
          if (insErr) throw new Error(insErr.message);
          messageId = assistantMsg.id;

          if (isFirstExchange) {
            const t = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content:
                    "Write a short chat title for this conversation, 3 to 6 words, " +
                    "no quotes, no period. Just the title.",
                },
                { role: "user", content: rawPrompt },
              ],
              temperature: 0.4,
            });
            title =
              (t.choices[0].message.content ?? "New chat")
                .replace(/["']/g, "")
                .trim()
                .slice(0, 60) || "New chat";
          }

          const { error: updErr } = await supabase
            .from("chats")
            .update({
              ...(title ? { title } : {}),
              last_message: text,
              last_message_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", chatId);
          if (updErr) throw new Error(updErr.message);
        }

        emit("phase", { phase: "writing", label: "Writing your answer" });
        for (const piece of chunkText(text)) {
          emit("delta", { content: piece });
        }
        emit("done", { message_id: messageId, title, charts, files });
      });
    }

    if (action === "title") {
      const chatId = String(body.chat_id ?? "");
      const prompt = String(body.prompt ?? "").trim();
      if (!chatId) return json({ error: "chat_id is required" }, 400);
      if (!prompt) return json({ error: "prompt is required" }, 400);
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Write a short chat title for this conversation, 3 to 6 words, " +
              "no quotes, no period. Just the title.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
      });
      const title =
        (res.choices[0].message.content ?? "New chat")
          .replace(/["']/g, "")
          .trim()
          .slice(0, 60) || "New chat";
      const { error } = await supabase
        .from("chats")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", chatId);
      if (error) throw new Error(error.message);
      return json({ ok: true, title });
    }

    if (action === "suggest") {
      const { data: recent, error: sErr } = await supabase
        .from("buyers")
        .select("phone, risk_score, total_orders, total_refused")
        .order("updated_at", { ascending: false })
        .limit(3);
      if (sErr) throw new Error(sErr.message);
      const phones = (recent ?? []).map((b) => String(b.phone));
      return json({
        ok: true,
        suggestions: [
          `Should I ship an order to ${phones[0] ?? "+923000000000"}?`,
          "Show me the top 10 people who buy footwear",
          "Pie chart of my orders by store",
          "Histogram of my order values",
        ],
      });
    }

    if (action === "analyze") {
      if (!phone) return json({ error: "phone is required" }, 400);
      const stats = await fetchStats(supabase, phone, storeIds);
      const { data: recent, error: rErr } = await supabase
        .from("orders")
        .select("product_name, product_category, price, city, ordered_at, outcomes(status, refusal_reason)")
        .eq("buyer_phone", phone)
        .in("store_id", storeIds)
        .order("ordered_at", { ascending: false })
        .limit(10);
      if (rErr) throw new Error(rErr.message);

      const reasons = new Map<string, number>();
      for (const o of asRows<OrderRow>(recent)) {
        const oc = embedOne(o.outcomes);
        const reason = oc?.refusal_reason ?? oc?.status;
        reasons.set(String(reason), (reasons.get(String(reason)) ?? 0) + 1);
      }
      const detail = asRows<OrderRow>(recent)
        .map(
          (o) =>
            `${o.product_name ?? o.product_category} - ${o.price ?? "?"} PKR - ${o.city ?? "?"} - ${embedOne(o.outcomes)?.status ?? "pending"}`,
        )
        .join("\n");

      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a COD risk analyst for an e-commerce network. Return ONLY valid JSON " +
              "with exactly these keys: {\"risk_factors\": string[] (max 6), " +
              "\"positive_factors\": string[] (max 4), " +
              "\"recommendation\": \"ship\" | \"caution\" | \"refuse\", " +
              "\"verdict\": string (one sentence), " +
              "\"confidence\": \"low\" | \"medium\" | \"high\"}. " +
              "Base every claim on the provided data.",
          },
          {
            role: "user",
            content:
              `Buyer ${phone}.\n${buildSummaryText(stats)}\n\nRecent orders:\n${detail}\n` +
              `Refusal reasons seen: ${
                [...reasons.entries()].map(([r, n]) => `${r} (${n})`).join(", ") || "none"
              }`,
          },
        ],
        temperature: 0.3,
      });
      let report: any = null;
      try {
        report = JSON.parse(res.choices[0].message.content ?? "{}");
      } catch {
        return json({ error: "AI returned invalid JSON" }, 500);
      }
      return json({ ok: true, report });
    }

    if (action === "trends") {
      // PRIVACY: this action used to read the whole `orders` table and the
      // whole `stores` table with the service role, then RETURN the riskiest
      // buyers' PHONE NUMBERS and other merchants' store names. It was missed
      // by the earlier per-tool fixes because it is a top-level action rather
      // than an agent tool, and because it uses the client directly instead of
      // fetchRows (whose store_id backstop would have thrown).
      //
      // Now: order rows and store identities are limited to the caller's own
      // stores, and the buyer list carries a MASKED label so it cannot become
      // a contact list. `denied` is returned rather than an empty result so a
      // store-less caller gets a clear answer instead of a misleading zero.
      const denied = requireOwnStores(storeIds);
      if (denied) return json({ error: denied.error }, 403);

      const [buyersRes, ordersRes, storesRes] = await Promise.all([
        // Risk-band COUNTS only: no phone number is read, so none can leak.
        supabase.from("buyers").select("risk_score, total_orders"),
        supabase
          .from("orders")
          .select("price, product_category, store_id, ordered_at, outcomes(status)")
          .in("store_id", storeIds),
        supabase.from("stores").select("id, name").in("id", storeIds),
      ]);
      if (buyersRes.error) throw new Error(buyersRes.error.message);
      if (ordersRes.error) throw new Error(ordersRes.error.message);

      const buyers = asRows<Pick<BuyerRow, "risk_score" | "total_orders">>(buyersRes.data);
      const orders = ordersRes.data;
      const storeNames = new Map(
        asRows<StoreRow>(storesRes.data).map((s) => [String(s.id), String(s.name)]),
      );

      let accepted = 0;
      let refused = 0;
      let pending = 0;
      let priceSum = 0;
      let priceCount = 0;
      const catCount = new Map<string, number>();
      const catRefused = new Map<string, number>();
      const storeOrders = new Map<string, number>();
      const weekBuckets = new Map<string, { label: string; total: number; accepted: number; refused: number }>();

      for (const o of asRows<OrderRow>(orders)) {
        const status = embedOne(o.outcomes)?.status ?? "pending";
        if (status === "accepted") accepted++;
        else if (status === "refused") refused++;
        else pending++;
        if (o.price != null) {
          priceSum += Number(o.price);
          priceCount++;
        }
        const cat = o.product_category ?? "unknown";
        catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
        if (status === "refused") catRefused.set(cat, (catRefused.get(cat) ?? 0) + 1);
        if (o.store_id) {
          const sid = String(o.store_id);
          storeOrders.set(sid, (storeOrders.get(sid) ?? 0) + 1);
        }
        if (o.ordered_at) {
          const d = new Date(o.ordered_at);
          const day = d.getDay();
          const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (day === 0 ? 6 : day - 1));
          const key = monday.toISOString().slice(0, 10);
          const bucket = weekBuckets.get(key) ?? { label: key, total: 0, accepted: 0, refused: 0 };
          bucket.total++;
          if (status === "accepted") bucket.accepted++;
          else if (status === "refused") bucket.refused++;
          weekBuckets.set(key, bucket);
        }
      }

      const safe = buyers.filter((b) => Number(b.risk_score) < 0.45).length;
      const caution = buyers.filter((b) => Number(b.risk_score) >= 0.45 && Number(b.risk_score) <= 0.65).length;
      const high = buyers.filter((b) => Number(b.risk_score) > 0.65).length;

      const topCategories = [...catCount.entries()]
        .map(([category, count]) => ({
          category,
          count,
          refusalRate: count > 0 ? Math.round(((catRefused.get(category) ?? 0) / count) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

      const topStores = [...storeOrders.entries()]
        .map(([id, count]) => ({ name: storeNames.get(id) ?? "Unknown store", count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

      const riskiest = buyers
        .filter((b) => Number(b.total_orders) > 0)
        .sort((a, b) => Number(b.risk_score) - Number(a.risk_score))
        .slice(0, 6)
        .map((b, i) => ({
          // MASKED: this used to be the buyer's full phone number, taken from
          // the network-wide `buyers` table.
          buyer: `····${String(i + 1).padStart(4, "0")}`,
          risk_score: Number(b.risk_score),
          total_orders: Number(b.total_orders),
        }));

      const weeklyTrend = [...weekBuckets.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .slice(-8)
        .map(([, v]) => v);

      const total = orders.length;
      return json({
        ok: true,
        totals: {
          buyers: buyers.length,
          orders: total,
          accepted,
          refused,
          pending,
          refusalRate: total > 0 ? Math.round((refused / total) * 100) : 0,
          avgOrderValue: priceCount > 0 ? Math.round(priceSum / priceCount) : 0,
        },
        riskBuckets: { safe, caution, high },
        topCategories,
        topStores,
        riskiest,
        weeklyTrend,
      });
    }

    if (action === "generate-dummy") {
      const nStores = Math.max(1, Math.min(5, Number(body.stores) || 3));
      const nBuyers = Math.max(1, Math.min(6, Number(body.buyers_per_store) || 5));
      const nOrders = Math.max(2, Math.min(8, Number(body.orders_per_buyer) || 6));
      const ratio = MIX_RATIOS[String(body.mix ?? "balanced")] ?? 0.35;

      const { data: existing } = await supabase.from("stores").select("name");
      const existingNames = new Set(
        (existing ?? []).map((s) => String(s.name).toLowerCase()),
      );

      const aiPrompt =
        "You are generating realistic dummy data for a Pakistani e-commerce COD network. " +
        "Produce ONLY valid JSON (no markdown, no explanation) with this exact shape:\n" +
        '{"stores":[{"name":"UniqueStoreName","owner":"First Last","buyers":[' +
        '{"phone":"03001234567","name":"First Last","city":"Lahore","orders":[' +
        '{"category":"skincare","product":"Vitamin C serum 30ml","price":2499,"quantity":1,' +
        '"address":"House 12, Block B, Model Town","outcome":"refused","days_ago":12}' +
        "]}}]}]}\n" +
        `Requirements:\n- Exactly ${nStores} stores, each with exactly ${nBuyers} buyers, ` +
        `each buyer with between 2 and ${nOrders} orders.\n` +
        "- Phone numbers in Pakistani format 03XXXXXXXXX, UNIQUE across all buyers.\n" +
        "- Categories from: skincare, clothing, electronics, footwear, beauty, home, accessories, haircare.\n" +
        "- Products and prices realistic in PKR (299 to 14999). Quantities 1-3.\n" +
        "- Cities: Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Multan, Peshawar, Sialkot, Gujranwala, Quetta.\n" +
        "- Addresses realistic Pakistani street addresses.\n" +
        "- days_ago between 1 and 60, varied.\n" +
        `- outcome: about ${Math.round(ratio * 100)}% of orders "refused", most of the rest "accepted", a few "pending".\n` +
        "- Original store names (e-commerce brand style) that are NOT: " +
        (existingNames.size > 0 ? [...existingNames].join(", ") : "(none)") +
        ".\n- Do not repeat the same product for the same buyer.";

      const gen = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You output strictly valid JSON only." },
          { role: "user", content: aiPrompt },
        ],
        temperature: 0.9,
      });
      let parsed: any = {};
      try {
        parsed = JSON.parse(gen.choices[0].message.content ?? "{}");
      } catch {
        return json({ error: "AI returned invalid JSON" }, 500);
      }

      const taken = new Set<string>();
      const usedStoreNames = new Set(existingNames);
      const aiStores = Array.isArray(parsed.stores) ? parsed.stores : [];
      const counters = { stores: 0, buyers: 0, orders: 0, refused: 0, pending: 0, accepted: 0 };

      for (let s = 0; s < nStores; s++) {
        const as = aiStores[s] ?? {};
        const storeName = uniqueStoreName(as.name, usedStoreNames, s);
        const { data: store, error: storeErr } = await supabase
          .from("stores")
          .insert({ name: storeName, owner_email: typeof as.owner === "string" ? as.owner : null })
          .select("id")
          .single();
        if (storeErr || !store) continue;
        counters.stores++;

        const aiBuyers = Array.isArray(as.buyers) ? as.buyers : [];
        for (let b = 0; b < nBuyers; b++) {
          const ab = aiBuyers[b] ?? {};
          const phone = cleanPhone(ab.phone, taken);
          await supabase
            .from("buyers")
            .upsert({ phone }, { onConflict: "phone", ignoreDuplicates: true });
          counters.buyers++;

          const aiOrders = Array.isArray(ab.orders) ? ab.orders : [];
          for (let o = 0; o < nOrders; o++) {
            const ao = aiOrders[o] ?? null;
            const category = ["skincare", "clothing", "electronics", "footwear", "beauty", "home", "accessories", "haircare"]
              .find((c) => typeof ao?.category === "string" && ao.category.toLowerCase() === c) ?? "skincare";
            const daysAgo = typeof ao?.days_ago === "number" ? ao.days_ago : 1 + rand(30);
            const fallback = fallbackOrder(category, daysAgo, ratio);
            const price = typeof ao?.price === "number" && ao.price > 0 ? Math.round(ao.price) : fallback.price;
            const product = typeof ao?.product === "string" && ao.product.trim() ? ao.product.trim().slice(0, 120) : fallback.product;
            const outcome = ["accepted", "refused", "pending"].includes(ao?.outcome)
              ? ao.outcome
              : fallback.outcome;
            const quantity = typeof ao?.quantity === "number" && ao.quantity > 0 ? Math.min(9, ao.quantity) : fallback.quantity;
            const city = typeof ab.city === "string" && ab.city.trim() ? ab.city.trim() : CITIES[rand(CITIES.length)];
            const address = typeof ao?.address === "string" && ao.address.trim() ? ao.address.trim().slice(0, 200) : fallback.address;

            const orderedAt = toIsoDaysAgo(daysAgo, 60);
            const { data: order, error: orderErr } = await supabase
              .from("orders")
              .insert({
                buyer_phone: phone,
                store_id: store.id,
                product_category: category,
                product_name: product,
                price,
                quantity,
                address,
                city,
                ordered_at: orderedAt,
              })
              .select("id")
              .single();
            if (orderErr || !order) continue;
            counters.orders++;
            if (outcome === "refused") {
              await supabase.from("outcomes").insert({
                order_id: order.id,
                status: "refused",
                resolved_at: new Date(new Date(orderedAt).getTime() + 86400000).toISOString(),
              });
              counters.refused++;
            } else if (outcome === "accepted") {
              await supabase.from("outcomes").insert({
                order_id: order.id,
                status: "accepted",
                resolved_at: new Date(new Date(orderedAt).getTime() + 86400000).toISOString(),
              });
              counters.accepted++;
            } else {
              counters.pending++;
            }
          }
        }
      }

      return json({ ok: true, summary: counters });
    }

    return json(
      { error: "unknown action (use embed, explain, chat, title, suggest, analyze, trends or generate-dummy)" },
      400,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});

