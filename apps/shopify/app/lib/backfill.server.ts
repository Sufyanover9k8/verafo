import { getSupabase } from "./supabase.server";
import {
  graphqlNodeToPayload,
  normalizePhone,
  recordShopifyOrdersBatch,
  type ShopifyOrderLike,
} from "./verafo";

/** Orders per Admin API page. 100 keeps each request well inside a timeout. */
export const PAGE_SIZE = 100;

export type RunStatus = "running" | "done" | "failed";

export interface SyncRun {
  id: string;
  shop: string;
  store_id: string;
  status: RunStatus;
  cursor: string | null;
  since: string;
  fetched: number;
  imported: number;
  skipped: number;
  error: string | null;
}

/**
 * One page of orders. The fields must cover everything
 * `graphqlNodeToPayload()` reads, or the ingest silently loses data.
 */
export const BACKFILL_QUERY = `#graphql
  query backfillOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, query: $query) {
      edges {
        cursor
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;

export const SCOPES_QUERY = `#graphql
  query grantedScopes {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
  }`;

/** Minimal structural type for the authenticated Admin API client. */
interface AdminGraphql {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

/** Which scopes this installation actually granted (not what we asked for). */
export async function grantedScopes(admin: AdminGraphql): Promise<string[]> {
  const res = await admin.graphql(SCOPES_QUERY);
  const json = (await res.json()) as {
    data?: { currentAppInstallation?: { accessScopes?: { handle: string }[] } };
  };
  return (json.data?.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle);
}

function rowToRun(row: Record<string, unknown>): SyncRun {
  return {
    id: String(row.id),
    shop: String(row.shop),
    store_id: String(row.store_id),
    status: row.status as RunStatus,
    cursor: (row.cursor as string | null) ?? null,
    since: String(row.since),
    fetched: Number(row.fetched ?? 0),
    imported: Number(row.imported ?? 0),
    skipped: Number(row.skipped ?? 0),
    error: (row.error as string | null) ?? null,
  };
}

export async function getLatestRun(shop: string): Promise<SyncRun | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("shopify_sync_runs")
    .select("*")
    .eq("shop", shop)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`could not read sync state: ${error.message}`);
  return data ? rowToRun(data) : null;
}

/**
 * Start a fresh run, or resume an unfinished one. Resuming is the whole point:
 * a serverless function can only process a page or two per invocation, and the
 * merchant must not lose progress when the tab closes.
 */
export async function startOrResumeRun(
  shop: string,
  storeId: string,
  since: string,
): Promise<SyncRun> {
  const supabase = getSupabase();
  const existing = await getLatestRun(shop);
  if (existing && existing.status === "running" && existing.since === since) {
    return existing;
  }

  const { data, error } = await supabase
    .from("shopify_sync_runs")
    .insert({ shop, store_id: storeId, since, status: "running" })
    .select("*")
    .single();
  if (error) throw new Error(`could not start sync: ${error.message}`);
  return rowToRun(data);
}

export async function abandonRun(id: string): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("shopify_sync_runs")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", id);
}

export interface AdvanceResult {
  run: SyncRun;
  pageOrders: number;
  pageSkipped: number;
  /** Orders on this page with no customer phone (PII not approved / missing). */
  pageMissingPhone: number;
  /** Outcomes left alone because they were already decided. */
  outcomesSkipped: number;
}

const THROTTLE_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shopify throttles by cost, not by request count, so a long backfill will hit
 * THROTTLED even at 100 orders per page. Retrying with backoff is the
 * difference between "the import stopped at 3,000 orders" and it finishing.
 */
async function graphqlWithRetry(
  admin: AdminGraphql,
  variables: Record<string, unknown>,
): Promise<{
  data?: {
    orders?: {
      edges?: { cursor: string; node: Record<string, unknown> }[];
      pageInfo?: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  errors?: unknown;
}> {
  let lastErrors: unknown = null;

  for (let attempt = 0; attempt < THROTTLE_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));

    const res = await admin.graphql(BACKFILL_QUERY, { variables });
    const json = (await res.json()) as {
      data?: {
        orders?: {
          edges?: { cursor: string; node: Record<string, unknown> }[];
          pageInfo?: { hasNextPage: boolean; endCursor: string | null };
        };
      };
      errors?: unknown;
    };

    if (!json.errors) return json;

    lastErrors = json.errors;
    const text = JSON.stringify(json.errors);
    const throttled = /THROTTLED|throttl/i.test(text) || res.status === 429;
    if (!throttled) return json;
  }

  return { errors: lastErrors };
}

/** Fetch and ingest exactly one page, then persist the new cursor. */
export async function advanceRun(run: SyncRun, admin: AdminGraphql): Promise<AdvanceResult> {
  const supabase = getSupabase();
  const sinceDate = run.since.slice(0, 10);
  // Shopify caps order access at 60 days without read_all_orders; the query
  // filter still applies, it just returns nothing older than the window.
  const query = `created_at:>=${sinceDate}`;

  const json = await graphqlWithRetry(admin, {
    first: PAGE_SIZE,
    after: run.cursor,
    query,
  });

  if (json.errors) {
    const message = JSON.stringify(json.errors).slice(0, 500);
    await supabase
      .from("shopify_sync_runs")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", run.id);
    throw new Error(`Shopify rejected the order query: ${message}`);
  }

  const edges = json.data?.orders?.edges ?? [];
  const pageInfo = json.data?.orders?.pageInfo;
  const payloads: ShopifyOrderLike[] = edges.map(({ node }) => graphqlNodeToPayload(node));
  const pageMissingPhone = payloads.filter(
    (p) => !normalizePhone(p.customer?.phone ?? p.phone ?? ""),
  ).length;

  const summary = await recordShopifyOrdersBatch(payloads, run.store_id);

  const done = !pageInfo?.hasNextPage || edges.length === 0;
  const next: SyncRun = {
    ...run,
    status: done ? "done" : "running",
    cursor: pageInfo?.endCursor ?? run.cursor,
    fetched: run.fetched + edges.length,
    imported: run.imported + summary.processed,
    skipped: run.skipped + summary.skipped,
  };

  const { error } = await supabase
    .from("shopify_sync_runs")
    .update({
      status: next.status,
      cursor: next.cursor,
      fetched: next.fetched,
      imported: next.imported,
      skipped: next.skipped,
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  if (error) throw new Error(`could not save sync progress: ${error.message}`);

  return {
    run: next,
    pageOrders: edges.length,
    pageSkipped: summary.skipped,
    pageMissingPhone,
    outcomesSkipped: summary.outcomesSkipped,
  };
}
