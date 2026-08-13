import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSupabase } from "../lib/supabase.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await authenticate.webhook(request);

  console.log(`Received app/uninstalled webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Drop the Shopify link so a future reinstall reconnects cleanly. Keep the
  // buyer history and scores — that's the whole point of the network.
  await db.connectedShop.deleteMany({ where: { shop } });
  try {
    const supabase = getSupabase();
    await supabase
      .from("stores")
      .update({ shopify_domain: null })
      .eq("shopify_domain", shop);
  } catch (err) {
    console.error(`Could not unlink store for ${shop}:`, err);
  }

  return new Response();
};