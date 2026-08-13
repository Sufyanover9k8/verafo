import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  ensureStoreLink,
  recordShopifyOrder,
  type ShopifyOrderLike,
} from "../lib/verafo";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const storeId = await ensureStoreLink(shop);
    const result = await recordShopifyOrder(payload as ShopifyOrderLike, storeId);
    if (result.skipped) {
      console.log(`orders/create skipped for ${shop}: ${result.skipped}`);
    }
  } catch (err) {
    console.error(`orders/create ingest failed for ${shop}:`, err);
    // Non-2xx tells Shopify to retry the webhook later.
    return new Response(null, { status: 500 });
  }

  return new Response();
};
