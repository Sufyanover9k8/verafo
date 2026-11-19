/**
 * Proves the "Refresh customer names" action end to end without Shopify:
 * a stubbed Admin client returns the name fields, and the real Supabase write
 * path runs against throwaway rows that are deleted afterwards.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/verify-names-refresh.ts
 */
import { createClient } from "@supabase/supabase-js";
import { refreshCustomerNames } from "../app/lib/backfill.server";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

/** Pretends to be the Admin GraphQL API, echoing a name for every id asked about. */
const stubAdmin = {
  graphql: async (_query: string, options?: { variables?: Record<string, unknown> }) => {
    const ids = (options?.variables?.ids as string[] | undefined) ?? [];
    const nodes = ids.map((gid) => ({
      id: gid,
      name: "#stub",
      customer: { firstName: "Stub", lastName: "Shopper" },
      shippingAddress: { name: "Stub Shopper" },
    }));
    return new Response(JSON.stringify({ data: { nodes } }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};

async function main() {
  const suffix = String(Date.now()).slice(-7);
  const phones = [`+9230${suffix}1`, `+9230${suffix}2`];

  const { data: store, error: storeErr } = await db
    .from("stores")
    .insert({ name: `qa-names-${suffix}`, owner_email: `qa-names-${suffix}@example.com` })
    .select("id")
    .single();
  if (storeErr) throw storeErr;

  try {
    // Orders reference buyers by phone, so the buyer rows come first.
    const { error: buyerErr } = await db
      .from("buyers")
      .insert(phones.map((phone) => ({ phone })));
    if (buyerErr) throw buyerErr;
    for (const [i, phone] of phones.entries()) {
      const { error } = await db.from("orders").insert({
        store_id: store.id,
        buyer_phone: phone,
        product_name: `Test product ${i}`,
        price: 1000,
        quantity: 1,
        shopify_order_id: `qa-${suffix}-${i}`,
        ordered_at: new Date().toISOString(),
      });
      if (error) throw error;
    }

    const first = await refreshCustomerNames(stubAdmin, store.id);
    console.log("run 1:", JSON.stringify(first));

    const second = await refreshCustomerNames(stubAdmin, store.id);
    console.log("run 2:", JSON.stringify(second));

    const { data: rows } = await db
      .from("app_order_cards")
      .select("order_id, customer_name, buyer_phone")
      .eq("store_id", store.id);
    console.log("stored:", JSON.stringify(rows));

    const { data: buyers } = await db.from("buyers").select("phone, name").in("phone", phones);
    console.log("buyers:", JSON.stringify(buyers));

    const allNamed =
      (rows ?? []).length === 2 && (rows ?? []).every((r) => r.customer_name === "Stub Shopper");
    const idempotent = second.named === 0 && second.alreadyNamed === 2;
    console.log(
      `${allNamed && idempotent && first.named === 2 ? "PASS" : "FAIL"}: named=${first.named} idempotent=${idempotent} allNamed=${allNamed}`,
    );
  } finally {
    await db.from("orders").delete().eq("store_id", store.id);
    await db.from("buyers").delete().in("phone", phones);
    await db.from("stores").delete().eq("id", store.id);
    console.log("cleaned up");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
