import { createClient } from "jsr:@supabase/supabase-js@2.49.4";
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

function summarizeTool(name: string, result: unknown): string {
  const r = result as any;
  if (r && typeof r === "object" && "error" in r) return "failed";
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
      return `${Array.isArray(r) ? r.length : 0} buyers`;
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

async function fetchStats(
  supabase: ReturnType<typeof createClient>,
  phone: string,
): Promise<SummaryInput> {
  const { data: buyer, error: bErr } = await supabase
    .from("buyers")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();
  if (bErr) throw new Error(bErr.message);
  if (!buyer) throw new Error("Buyer not found");

  const { data: orders, error: oErr } = await supabase
    .from("orders")
    .select("store_id, product_category, price, quantity, city, ordered_at, outcomes(status)")
    .eq("buyer_phone", phone)
    .order("ordered_at", { ascending: false });
  if (oErr) throw new Error(oErr.message);

  const rows = orders ?? [];
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
    total_orders: buyer.total_orders,
    total_accepted: buyer.total_accepted,
    total_refused: buyer.total_refused,
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

async function buildFeatureVector(
  supabase: ReturnType<typeof createClient>,
  phone: string,
): Promise<FeatureVector> {
  const { data: buyer, error: bErr } = await supabase
    .from("buyers")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();
  if (bErr) throw new Error(bErr.message);
  if (!buyer) throw new Error("Buyer not found");

  const { data: orders, error: oErr } = await supabase
    .from("orders")
    .select(
      "store_id, product_category, product_name, price, quantity, address, city, ordered_at, outcomes(status)",
    )
    .eq("buyer_phone", phone)
    .order("ordered_at", { ascending: true });
  if (oErr) throw new Error(oErr.message);

  const rows = orders ?? [];
  const resolved = rows.filter((o) => o.outcomes?.status === "accepted");
  const refused = rows.filter((o) => o.outcomes?.status === "refused");
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
  const latestCity = last?.city ?? buyer.city ?? "";
  const avgQty = total > 0 ? qtySum / total : 1;
  const avgValue = priceCount > 0 ? priceSum / priceCount : 0;
  const phoneAgeDays = buyer.first_seen
    ? Math.max(0, (Date.now() - new Date(buyer.first_seen).getTime()) / 86400000)
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
  push("acceptance_count_norm", normalize(Number(buyer.total_accepted ?? 0), 0, 20));

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
  supabase: ReturnType<typeof createClient>,
  chatId: string,
): Promise<{ role: string; content: string }[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((m) => m.role !== "system");
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

async function fetchRows<T = any>(table: string, params: string): Promise<T[]> {
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
): Promise<ChartSpec | null> {
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
    const buyers = await fetchRows("buyers", "select=risk_score");
    const buckets = { safe: 0, caution: 0, high: 0 };
    for (const b of buyers) {
      const r = Number((b as any).risk_score);
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
      fetchRows("buyers", "select=phone,risk_score,total_orders"),
      fetchRows("orders", orderParams("buyer_phone,price,ordered_at")),
    ]);
    const spendMap = new Map<string, number>();
    for (const o of orders) {
      if ((o as any).price != null) {
        spendMap.set(String((o as any).buyer_phone), (spendMap.get(String((o as any).buyer_phone)) ?? 0) + Number((o as any).price));
      }
    }
    const pts = buyers
      .filter((b) => Number((b as any).total_orders) > 0)
      .filter((b) => !phone || String((b as any).phone) === phone)
      .map((b) => ({
        name: String((b as any).phone),
        risk: Number((b as any).risk_score),
        orders: Number((b as any).total_orders),
        spend: Math.round(spendMap.get(String((b as any).phone)) ?? 0),
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
    const orders = await fetchRows("orders", orderParams("price,ordered_at"));
    const prices = orders
      .map((o) => Number((o as any).price))
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

  const rows = await fetchRows("orders", orderParams("product_category,price,store_id,ordered_at,buyer_phone,city,outcomes(status)"));

  const keyFn = (o: any): string => {
    if (dimension === "category") return String(o.product_category ?? "unknown");
    if (dimension === "store") return o.store_id ? String(o.store_id) : "unknown";
    if (dimension === "buyer") return String(o.buyer_phone);
    if (dimension === "city") return String(o.city ?? "unknown");
    if (dimension === "week") {
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
    const stores = await fetchRows("stores", "select=id,name");
    const names = new Map(stores.map((s) => [String((s as any).id), String((s as any).name)]));
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

function orderOutcome(o: any): string {
  const oc = o.outcomes;
  return Array.isArray(oc) ? oc[0]?.status ?? "pending" : oc?.status ?? "pending";
}

function buildOrderParams(f: {
  keyword?: string;
  category?: string;
  city?: string;
  min_price?: number;
  max_price?: number;
  phone?: string;
  limit?: number;
  days?: number;
}): string {
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

async function toolSearchOrders(supabase: any, args: any) {
  const rows = await fetchRows("orders", buildOrderParams(args));
  const orders = rows.map((o: any) => ({
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

async function toolTopBuyers(supabase: any, args: any) {
  const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
  const metric = ["orders", "spend", "refusals", "risk"].includes(String(args.metric))
    ? String(args.metric)
    : "orders";
  const city = String(args.city ?? "").trim();
  const category = String(args.category ?? "").trim().toLowerCase();
  const days = Number(args.days);
  const minSpend = Number(args.min_price);

  const needsOrderAgg =
    metric === "spend" || !!category || Number.isFinite(days) && days > 0 ||
    Number.isFinite(minSpend) && minSpend > 0;

  if (needsOrderAgg) {
    let oParams =
      "select=buyer_phone,price,product_category,ordered_at,outcomes(status)&limit=10000";
    if (city) oParams += `&city=eq.${encodeURIComponent(city)}`;
    if (category) oParams += `&product_category=eq.${encodeURIComponent(category)}`;
    if (Number.isFinite(days) && days > 0) {
      oParams += `&ordered_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`;
    }
    const rows = await fetchRows("orders", oParams);
    const agg = new Map<string, { spend: number; orders: number; accepted: number; refused: number }>();
    for (const o of rows) {
      const phone = String((o as any).buyer_phone ?? "?");
      const g = agg.get(phone) ?? { spend: 0, orders: 0, accepted: 0, refused: 0 };
      g.spend += Number((o as any).price ?? 0);
      g.orders++;
      const st = orderOutcome(o);
      if (st === "accepted") g.accepted++;
      else if (st === "refused") g.refused++;
      agg.set(phone, g);
    }
    const { data: buyers, error } = await supabase
      .from("buyers")
      .select("phone, risk_score, total_orders, total_accepted, total_refused");
    if (error) throw new Error(error.message);
    const risk = new Map((buyers ?? []).map((b) => [String(b.phone), b]));
    let list = [...agg.entries()].map(([phone, g]) => {
      const b = risk.get(phone) as any;
      return {
        phone,
        risk_score: Number(b?.risk_score ?? 0.5),
        orders: g.orders,
        accepted: g.accepted,
        refused: g.refused,
        spend: Math.round(g.spend),
      };
    });
    if (Number.isFinite(minSpend) && minSpend > 0) list = list.filter((b) => b.spend >= minSpend);
    list.sort((a, b) =>
      metric === "spend" ? b.spend - a.spend
        : metric === "refusals" ? b.refused - a.refused
          : metric === "risk" ? b.risk_score - a.risk_score
            : b.orders - a.orders,
    );
    return list.slice(0, limit);
  }

  const { data, error } = await supabase
    .from("buyers")
    .select("phone, risk_score, total_orders, total_accepted, total_refused");
  if (error) throw new Error(error.message);
  let buyers = data ?? [];

  if (city) {
    const cityOrders = await fetchRows(
      "orders",
      `select=buyer_phone&city=eq.${encodeURIComponent(city)}&limit=5000`,
    );
    const inCity = new Set(cityOrders.map((o: any) => String(o.buyer_phone)));
    buyers = buyers.filter((b) => inCity.has(String(b.phone)));
  }

  let spendMap = new Map<string, number>();
  if (metric === "spend") {
    let oParams = "select=buyer_phone,price&limit=10000";
    if (city) oParams += `&city=eq.${encodeURIComponent(city)}`;
    const rows = await fetchRows("orders", oParams);
    spendMap = new Map<string, number>();
    for (const o of rows) {
      const phone = String((o as any).buyer_phone);
      spendMap.set(phone, (spendMap.get(phone) ?? 0) + Number((o as any).price ?? 0));
    }
  }

  const mapped = buyers.map((b: any) => {
    const phone = String(b.phone);
    const risk = Number(b.risk_score ?? 0);
    return {
      phone,
      risk_score: risk,
      orders: Number(b.total_orders ?? 0),
      accepted: Number(b.total_accepted ?? 0),
      refused: Number(b.total_refused ?? 0),
      spend: Math.round(spendMap.get(phone) ?? 0),
    };
  });

  const sorted = mapped
    .filter((b: any) => (metric === "spend" ? b.spend > 0 : metric === "refusals" ? b.refused > 0 : true))
    .sort((a: any, b: any) =>
      metric === "spend" ? b.spend - a.spend
        : metric === "refusals" ? b.refused - a.refused
          : metric === "risk" ? b.risk_score - a.risk_score
            : b.orders - a.orders,
    )
    .slice(0, limit);

  return sorted;
}

async function toolBuyersByCity(supabase: any, args: any) {
  const city = String(args.city ?? "").trim();
  const minPrice = Number(args.min_price);
  const category = String(args.category ?? "").trim().toLowerCase();
  const days = Number(args.days);
  const rows = await fetchRows("orders", buildOrderParams({ city, limit: 2000, days }));
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
  const above =
    Number.isFinite(minPrice) && minPrice > 0
      ? list.filter((b) => b.max_order >= minPrice)
      : null;
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

async function toolBuyerProfile(supabase: any, args: any) {
  const phone = String(args.phone ?? "").trim();
  if (!phone) return { error: "phone is required" };
  const stats = await fetchStats(supabase, phone);
  const rows = await fetchRows("orders", buildOrderParams({ phone, limit: 50 }));
  const orders = rows.map((o: any) => ({
    product: o.product_name ?? o.product_category ?? "?",
    category: o.product_category ?? "?",
    price: o.price ?? 0,
    city: o.city ?? "?",
    status: orderOutcome(o),
    date: (o.ordered_at ?? "").slice(0, 10),
  }));
  return { summary: buildSummaryText(stats), orders };
}

async function toolCityOverview(_supabase: any, _args: any) {
  const rows = await fetchRows("orders", "select=city,price,buyer_phone,outcomes(status)&limit=10000");
  const map = new Map<string, { orders: number; buyers: Set<string>; spend: number; accepted: number; refused: number; pending: number }>();
  for (const o of rows) {
    const c = String(o.city ?? "unknown");
    const g = map.get(c) ?? { orders: 0, buyers: new Set<string>(), spend: 0, accepted: 0, refused: 0, pending: 0 };
    g.orders++;
    g.buyers.add(String(o.buyer_phone ?? "?"));
    g.spend += Number(o.price ?? 0);
    const st = orderOutcome(o);
    if (st === "accepted") g.accepted++;
    else if (st === "refused") g.refused++;
    else g.pending++;
    map.set(c, g);
  }
  return [...map.entries()]
    .map(([city, g]) => ({
      city,
      orders: g.orders,
      buyers: g.buyers.size,
      accepted: g.accepted,
      refused: g.refused,
      pending: g.pending,
      refusal_rate: g.orders > 0 ? Math.round((g.refused / g.orders) * 100) : 0,
      spend: Math.round(g.spend),
    }))
    .sort((a, b) => b.refused - a.refused);
}

async function toolCategoryOverview(supabase: any, args: any) {
  const city = String(args.city ?? "").trim();
  let params = "select=product_category,price,outcomes(status)&limit=10000";
  if (city) params += `&city=eq.${encodeURIComponent(city)}`;
  const rows = await fetchRows("orders", params);
  const map = new Map<string, { orders: number; accepted: number; refused: number; pending: number; spend: number }>();
  for (const o of rows) {
    const c = String(o.product_category ?? "unknown");
    const g = map.get(c) ?? { orders: 0, accepted: 0, refused: 0, pending: 0, spend: 0 };
    g.orders++;
    const st = orderOutcome(o);
    if (st === "accepted") g.accepted++;
    else if (st === "refused") g.refused++;
    else g.pending++;
    g.spend += Number(o.price ?? 0);
    map.set(c, g);
  }
  return [...map.entries()]
    .map(([category, g]) => ({
      category,
      orders: g.orders,
      accepted: g.accepted,
      refused: g.refused,
      pending: g.pending,
      refusal_rate: g.orders > 0 ? Math.round((g.refused / g.orders) * 100) : 0,
      avg_price: g.orders > 0 ? Math.round(g.spend / g.orders) : 0,
    }))
    .sort((a, b) => b.refused - a.refused);
}

async function toolStoreOverview(supabase: any, args: any) {
  const city = String(args.city ?? "").trim();
  let oParams = "select=store_id,price,buyer_phone,outcomes(status)&limit=10000";
  if (city) oParams += `&city=eq.${encodeURIComponent(city)}`;
  const [rows, stores] = await Promise.all([
    fetchRows("orders", oParams),
    fetchRows("stores", "select=id,name"),
  ]);
  const names = new Map(stores.map((s) => [String((s as any).id), String((s as any).name)]));
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

async function toolTopProducts(supabase: any, args: any) {
  const city = String(args.city ?? "").trim();
  const category = String(args.category ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(20, Number(args.limit) || 10));
  let params = "select=product_name,product_category,price,city,outcomes(status)&limit=10000";
  if (city) params += `&city=eq.${encodeURIComponent(city)}`;
  if (category) params += `&product_category=eq.${encodeURIComponent(category)}`;
  const rows = await fetchRows("orders", params);
  const map = new Map<string, { category: string; orders: number; accepted: number; refused: number; spend: number }>();
  for (const o of rows) {
    const name = String(o.product_name ?? o.product_category ?? "unknown");
    const g = map.get(name) ?? { category: String(o.product_category ?? "?"), orders: 0, accepted: 0, refused: 0, spend: 0 };
    g.orders++;
    g.spend += Number(o.price ?? 0);
    const st = orderOutcome(o);
    if (st === "accepted") g.accepted++;
    else if (st === "refused") g.refused++;
    map.set(name, g);
  }
  return [...map.entries()]
    .map(([product, g]) => ({
      product,
      category: g.category,
      orders: g.orders,
      accepted: g.accepted,
      refused: g.refused,
      refusal_rate: g.orders > 0 ? Math.round((g.refused / g.orders) * 100) : 0,
      spend: Math.round(g.spend),
      avg_price: g.orders > 0 ? Math.round(g.spend / g.orders) : 0,
    }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, limit);
}

async function toolNetworkOverview(supabase: any, args: any) {
  const city = String(args.city ?? "").trim();
  const [buyers, orders] = await Promise.all([
    fetchRows("buyers", "select=risk_score,total_orders"),
    fetchRows("orders", "select=price,product_category,outcomes(status)&limit=10000"),
  ]);
  let accepted = 0, refused = 0, pending = 0, spend = 0;
  const catCount = new Map<string, number>();
  const catRefused = new Map<string, number>();
  for (const o of orders) {
    if (city && String(o.city ?? "") !== city) continue;
    const st = orderOutcome(o);
    if (st === "accepted") accepted++;
    else if (st === "refused") refused++;
    else pending++;
    spend += Number(o.price ?? 0);
    const c = String(o.product_category ?? "unknown");
    catCount.set(c, (catCount.get(c) ?? 0) + 1);
    if (st === "refused") catRefused.set(c, (catRefused.get(c) ?? 0) + 1);
  }
  const total = accepted + refused + pending;
  const safe = buyers.filter((b) => Number((b as any).risk_score) < 0.45).length;
  const caution = buyers.filter((b) => Number((b as any).risk_score) >= 0.45 && Number((b as any).risk_score) <= 0.65).length;
  const high = buyers.filter((b) => Number((b as any).risk_score) > 0.65).length;
  const topCategories = [...catCount.entries()]
    .map(([category, count]) => ({
      category,
      orders: count,
      refusal_rate: count > 0 ? Math.round(((catRefused.get(category) ?? 0) / count) * 100) : 0,
    }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 6);
  return {
    totals: {
      buyers: buyers.length,
      orders: total,
      accepted,
      refused,
      pending,
      refusal_rate: total > 0 ? Math.round((refused / total) * 100) : 0,
      spend: Math.round(spend),
      avg_order_value: total > 0 ? Math.round(spend / total) : 0,
    },
    risk_buckets: { safe, caution, high },
    top_categories: topCategories,
  };
}

async function toolRefusalReasons(supabase: any, args: any) {
  const city = String(args.city ?? "").trim();
  let params = "select=product_category,city,outcomes(status,refusal_reason)&limit=10000";
  if (city) params += `&city=eq.${encodeURIComponent(city)}`;
  const rows = await fetchRows("orders", params);
  const map = new Map<string, { count: number; category: string }>();
  const total = { refused: 0 };
  for (const o of rows) {
    const oc = o.outcomes;
    const st = Array.isArray(oc) ? oc[0]?.status : oc?.status;
    const reason = (Array.isArray(oc) ? oc[0]?.refusal_reason : oc?.refusal_reason) || "not recorded";
    if (st !== "refused") continue;
    total.refused++;
    const g = map.get(String(reason)) ?? { count: 0, category: String(o.product_category ?? "?") };
    g.count++;
    map.set(String(reason), g);
  }
  return {
    total_refused: total.refused,
    reasons: [...map.entries()]
      .map(([reason, g]) => ({ reason, count: g.count, category: g.category }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
  };
}

async function toolBuyerOrders(supabase: any, args: any) {
  const phone = String(args.phone ?? "").trim();
  const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
  if (!phone) return { error: "phone is required" };
  const rows = await fetchRows("orders", buildOrderParams({ phone, limit }));
  return rows.map((o: any) => ({
    product: o.product_name ?? o.product_category ?? "?",
    category: o.product_category ?? "?",
    price: o.price ?? 0,
    quantity: o.quantity ?? 1,
    city: o.city ?? "?",
    status: orderOutcome(o),
    date: (o.ordered_at ?? "").slice(0, 10),
  }));
}

async function toolWeeklyTrend(supabase: any, args: any) {
  const city = String(args.city ?? "").trim();
  const weeks = Math.max(1, Math.min(16, Number(args.weeks) || 8));
  let params = "select=ordered_at,price,outcomes(status)&limit=10000";
  if (city) params += `&city=eq.${encodeURIComponent(city)}`;
  const rows = await fetchRows("orders", params);
  const buckets = new Map<string, { label: string; total: number; accepted: number; refused: number; spend: number }>();
  for (const o of rows) {
    if (!o.ordered_at) continue;
    const d = new Date(o.ordered_at);
    const day = d.getDay();
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (day === 0 ? 6 : day - 1));
    const key = monday.toISOString().slice(0, 10);
    const g = buckets.get(key) ?? { label: key, total: 0, accepted: 0, refused: 0, spend: 0 };
    g.total++;
    g.spend += Number(o.price ?? 0);
    const st = orderOutcome(o);
    if (st === "accepted") g.accepted++;
    else if (st === "refused") g.refused++;
    buckets.set(key, g);
  }
  const sorted = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-weeks);
  return sorted.map(([, g]) => ({
    week: g.label,
    orders: g.total,
    accepted: g.accepted,
    refused: g.refused,
    spend: Math.round(g.spend),
    refusal_rate: g.total > 0 ? Math.round((g.refused / g.total) * 100) : 0,
  }));
}

async function toolSimilarBuyers(supabase: any, args: any) {
  const phone = String(args.phone ?? "").trim();
  const limit = Math.max(1, Math.min(10, Number(args.limit) || 5));
  if (!phone) return { error: "phone is required" };
  const { data: buyer } = await supabase
    .from("buyers")
    .select("embedding")
    .eq("phone", phone)
    .maybeSingle();
  if (!buyer?.embedding) {
    return { error: `no embedding yet for ${phone} - visit the buyer lookup first so an AI fingerprint can be generated` };
  }
  const { data, error } = await supabase.rpc("find_similar_buyers", {
    p_embedding: buyer.embedding,
    p_limit: limit + 1,
  });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r: any) => String(r.phone) !== phone)
    .slice(0, limit)
    .map((r: any) => ({
      phone: String(r.phone),
      risk_score: Number(r.risk_score),
      total_orders: Number(r.total_orders),
      total_refused: Number(r.total_refused),
      similarity: Math.round((1 - Number(r.similarity)) * 1000) / 1000,
    }));
}

async function toolBuyerVerdict(supabase: any, args: any, openai: any) {
  const phone = String(args.phone ?? "").trim();
  if (!phone) return { error: "phone is required" };
  const stats = await fetchStats(supabase, phone);
  const { data: recent, error: rErr } = await supabase
    .from("orders")
    .select("product_name, product_category, price, city, ordered_at, outcomes(status, refusal_reason)")
    .eq("buyer_phone", phone)
    .order("ordered_at", { ascending: false })
    .limit(10);
  if (rErr) throw new Error(rErr.message);
  const detail = (recent ?? [])
    .map(
      (o) =>
        `${o.product_name ?? o.product_category} - ${o.price ?? "?"} PKR - ${o.city ?? "?"} - ${o.outcomes?.status ?? "pending"}`,
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

async function toolSearchBuyers(supabase: any, args: any) {
  const query = String(args.query ?? "").trim();
  const city = String(args.city ?? "").trim();
  const minOrders = Number(args.min_orders);
  const maxRisk = Number(args.max_risk);
  const limit = Math.max(1, Math.min(20, Number(args.limit) || 10));
  let params = "select=phone,risk_score,total_orders,total_accepted,total_refused";
  if (query) params += `&phone=ilike.${encodeURIComponent(`%${query.replace(/[^\d+]/g, "")}%`)}`;
  if (Number.isFinite(minOrders) && minOrders > 0) params += `&total_orders=gte.${minOrders}`;
  if (Number.isFinite(maxRisk) && maxRisk > 0) params += `&risk_score=lte.${maxRisk}`;
  params += `&limit=${limit}`;
  let rows = await fetchRows("buyers", params);
  if (city) {
    const cityOrders = await fetchRows(
      "orders",
      `select=buyer_phone&city=eq.${encodeURIComponent(city)}&limit=5000`,
    );
    const inCity = new Set(cityOrders.map((o: any) => String(o.buyer_phone)));
    rows = rows.filter((b) => inCity.has(String((b as any).phone)));
  }
  return rows.map((b) => ({
    phone: String((b as any).phone),
    risk_score: Number((b as any).risk_score),
    total_orders: Number((b as any).total_orders),
    total_accepted: Number((b as any).total_accepted),
    total_refused: Number((b as any).total_refused),
  }));
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

async function buildFileSpec(supabase: any, args: any): Promise<FileSpec | FileNoData> {
  const rawKind = String(args.kind ?? "").toLowerCase();
  const kind = ["pdf", "csv", "xlsx", "excel"].includes(rawKind) ? (rawKind as any) : "pdf";
  const dimension = String(args.dimension ?? "orders").toLowerCase();
  const title = String(args.title ?? "").trim().slice(0, 80) || "Verafo Report";
  const description = String(args.description ?? "").trim();
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 25));
  const city = String(args.city ?? "").trim();
  const category = String(args.category ?? "").trim();
  const keyword = String(args.keyword ?? "").trim();
  const days = Number(args.days);
  const minPrice = Number(args.min_price);
  const maxPrice = Number(args.max_price);
  const metric = ["orders", "spend", "refusals", "risk"].includes(String(args.metric))
    ? String(args.metric)
    : "orders";

  let columns: FileColumnSpec[];
  let rows: Record<string, string | number>[];
  let chart: ChartSpec | null;

  if (dimension === "orders" || dimension === "order") {
    const res = await toolSearchOrders(supabase, { city, category, keyword, min_price: minPrice, max_price: maxPrice, days, limit });
    columns = [
      { key: "product", label: "Product" },
      { key: "category", label: "Category" },
      { key: "price", label: "Price", format: "pkr" },
      { key: "quantity", label: "Qty", format: "number" },
      { key: "city", label: "City" },
      { key: "phone", label: "Buyer" },
      { key: "status", label: "Status" },
      { key: "date", label: "Date" },
    ];
    rows = res.orders ?? [];
    chart = makeFileChart(rows, "Top orders by value", "product", [{ key: "price", label: "Spend", format: "pkr" }], "bar");
  } else if (dimension === "buyers" || dimension === "buyer") {
    rows = (await toolTopBuyers(supabase, { city, category, days, min_price: minPrice, metric, limit: Math.min(limit, 50) })) as any;
    columns = [
      { key: "phone", label: "Phone" },
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
    rows = (await toolTopProducts(supabase, { city, category, limit: Math.min(limit, 50) })) as any;
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
    rows = (await toolStoreOverview(supabase, { city })) as any;
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
    rows = (await toolCategoryOverview(supabase, { city })) as any;
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
    rows = (await toolCityOverview(supabase, {})) as any;
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
    rows = (await toolWeeklyTrend(supabase, { weeks: Math.max(1, Math.min(16, Number(args.weeks) || 8)), city })) as any;
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
    return buildFileSpec(supabase, { ...args, dimension: "orders" });
  }

  if (rows.length === 0) {
    const filters: string[] = [];
    if (city) filters.push(`city "${city}"`);
    if (category) filters.push(`category "${category}"`);
    if (keyword) filters.push(`keyword "${keyword}"`);
    if (Number.isFinite(days) && days > 0) filters.push(`last ${days} days`);
    if (Number.isFinite(minPrice) && minPrice > 0) filters.push(`min ${minPrice} PKR`);
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

const AGENT_TOOLS = [
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
        "Search buyers by phone substring (digits), minimum order count or maximum risk score, optionally restricted to a city. Use for 'find buyers with 000 in their number', 'buyers with 5+ orders', 'low risk buyers in Lahore'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Partial phone number digits to match, e.g. '30011'." },
          city: { type: "string", description: "Optional exact city name to filter to." },
          min_orders: { type: "number", description: "Only buyers with at least this many orders." },
          max_risk: { type: "number", description: "Only buyers with risk score at or below this (0-1)." },
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

async function runAgentTool(name: string, args: any, supabase: any, openai: any): Promise<unknown> {
  switch (name) {
    case "search_orders":
      return await toolSearchOrders(supabase, args ?? {});
    case "buyers_by_city":
      return await toolBuyersByCity(supabase, args ?? {});
    case "buyer_profile":
      return await toolBuyerProfile(supabase, args ?? {});
    case "top_buyers":
      return await toolTopBuyers(supabase, args ?? {});
    case "city_overview":
      return await toolCityOverview(supabase, args ?? {});
    case "category_overview":
      return await toolCategoryOverview(supabase, args ?? {});
    case "store_overview":
      return await toolStoreOverview(supabase, args ?? {});
    case "top_products":
      return await toolTopProducts(supabase, args ?? {});
    case "network_overview":
      return await toolNetworkOverview(supabase, args ?? {});
    case "refusal_reasons":
      return await toolRefusalReasons(supabase, args ?? {});
    case "buyer_orders":
      return await toolBuyerOrders(supabase, args ?? {});
    case "weekly_trend":
      return await toolWeeklyTrend(supabase, args ?? {});
    case "similar_buyers":
      return await toolSimilarBuyers(supabase, args ?? {});
    case "buyer_verdict":
      return await toolBuyerVerdict(supabase, args ?? {}, openai);
    case "search_buyers":
      return await toolSearchBuyers(supabase, args ?? {});
    case "create_file":
      return await buildFileSpec(supabase, args ?? {});
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

async function embedOne(supabase: any, openai: any, phone: string): Promise<number[]> {
  const stats = await fetchStats(supabase, phone);
  const fv = await buildFeatureVector(supabase, phone);
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
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({ error: "OPENAI_API_KEY is not set on this function" }, 500);
    }
    const openai = new OpenAI({ apiKey });

    if (action === "embed") {
      const stats = await fetchStats(supabase, phone);
      const fv = await buildFeatureVector(supabase, phone);
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
      const { data: buyers, error } = await supabase
        .from("buyers")
        .select("phone, risk_score, total_orders, total_accepted, total_refused, embedding");
      if (error) throw new Error(error.message);
      const rows = buyers ?? [];

      const missing = rows
        .filter((b) => !b.embedding || !Array.isArray(b.embedding))
        .map((b) => String(b.phone));
      const failed: string[] = [];
      if (missing.length > 0) {
        const vectors = await mapLimit(missing, 10, async (phone) => {
          try {
            return { phone, vector: await embedOne(supabase, openai, phone) };
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
        .filter((b) => b.embedding && Array.isArray(b.embedding) && (b.embedding as number[]).length > 0)
        .map((b) => ({
          phone: String(b.phone),
          risk: Number(b.risk_score ?? 0.5),
          orders: Number(b.total_orders ?? 0),
          accepted: Number(b.total_accepted ?? 0),
          refused: Number(b.total_refused ?? 0),
          embedding: b.embedding as number[],
        }));

      const spendMap = new Map<string, number>();
      if (vecs.length > 0) {
        const orderRows = await fetchRows("orders", "select=buyer_phone,price&limit=10000");
        for (const o of orderRows) {
          if ((o as any).price != null) {
            const p = String((o as any).buyer_phone);
            spendMap.set(p, (spendMap.get(p) ?? 0) + Number((o as any).price));
          }
        }
      }

      const points: any[] = [];
      if (vecs.length >= 2) {
        const n = vecs.length;
        const d = vecs[0].embedding.length;
        const mean = new Array(d).fill(0);
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
        total: rows.length,
        failed,
        note:
          failed.length > 0
            ? `${failed.length} buyers could not be embedded and are not shown.`
            : undefined,
      });
    }

    if (action === "explain") {
      const stats = await fetchStats(supabase, phone);
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
              buildSummaryText(await fetchStats(supabase, mentionPhone));
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
              const ch = await buildChartData(c, mentionPhone ?? undefined);
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
                  const arr = Array.isArray(result) ? result : (result as any)?.data;
                  if (Array.isArray(arr) && arr.length > 0 && !activeCity) {
                    const top = arr.find((r: any) => r.city && typeof r.refused === "number");
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
      const stats = await fetchStats(supabase, phone);
      const { data: recent, error: rErr } = await supabase
        .from("orders")
        .select("product_name, product_category, price, city, ordered_at, outcomes(status, refusal_reason)")
        .eq("buyer_phone", phone)
        .order("ordered_at", { ascending: false })
        .limit(10);
      if (rErr) throw new Error(rErr.message);

      const reasons = new Map<string, number>();
      for (const o of recent ?? []) {
        const reason = o.outcomes?.refusal_reason ?? o.outcomes?.status;
        if (reason) {
          reasons.set(String(reason), (reasons.get(String(reason)) ?? 0) + 1);
        }
      }
      const detail = (recent ?? [])
        .map(
          (o) =>
            `${o.product_name ?? o.product_category} - ${o.price ?? "?"} PKR - ${o.city ?? "?"} - ${o.outcomes?.status ?? "pending"}`,
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
      const [buyersRes, ordersRes, storesRes] = await Promise.all([
        supabase.from("buyers").select("phone, risk_score, total_orders"),
        supabase.from("orders").select("price, product_category, store_id, ordered_at, outcomes(status)"),
        supabase.from("stores").select("id, name"),
      ]);
      if (buyersRes.error) throw new Error(buyersRes.error.message);
      if (ordersRes.error) throw new Error(ordersRes.error.message);

      const buyers = buyersRes.data ?? [];
      const orders = ordersRes.data ?? [];
      const storeNames = new Map((storesRes.data ?? []).map((s) => [String(s.id), String(s.name)]));

      let accepted = 0;
      let refused = 0;
      let pending = 0;
      let priceSum = 0;
      let priceCount = 0;
      const catCount = new Map<string, number>();
      const catRefused = new Map<string, number>();
      const storeOrders = new Map<string, number>();
      const weekBuckets = new Map<string, { label: string; total: number; accepted: number; refused: number }>();

      for (const o of orders) {
        const status = o.outcomes?.status ?? "pending";
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
        .map((b) => ({
          phone: String(b.phone),
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
