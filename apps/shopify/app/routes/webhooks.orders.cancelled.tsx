import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { setOutcomeForShopifyOrder } from "../lib/verafo";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const id = String(payload.id ?? "");
    if (id) {
      const reason =
        payload.cancel_reason ?? payload.cancelled_reason ?? null;
      const result = await setOutcomeForShopifyOrder(id, "refused", reason);
      if (result.skipped) {
        console.log(`orders/cancelled skipped for ${shop}: ${result.skipped}`);
      }
    }
  } catch (err) {
    console.error(`orders/cancelled failed for ${shop}:`, err);
    return new Response(null, { status: 500 });
  }

  return new Response();
};
