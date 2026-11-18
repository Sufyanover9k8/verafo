import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { ensureStoreLink } from "../lib/verafo";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Provision the Verafo store row at install time.
  //
  // It used to be created lazily: on the first order webhook, or when someone
  // opened the app's UI. A merchant who installed and did nothing else stayed
  // invisible in Verafo entirely, which is exactly what happened to two real
  // installs. Doing it here means an install always shows up, with zero orders.
  try {
    await ensureStoreLink(session.shop, session.shop);
  } catch (error) {
    // Never block the OAuth handshake: a merchant must still be able to open
    // the app, and the order webhook will retry the link anyway.
    console.error(`Could not provision a Verafo store for ${session.shop}`, error);
  }

  return null;
};
