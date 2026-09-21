import { authenticate } from "../shopify.server";
import db from "../db.server";
import { embedRedirect } from "../utils/shopify-embed-nav.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await db.shopSettings.findUnique({
    where: { shop: session.shop },
    select: { isOnboarded: true },
  });

  const target = settings?.isOnboarded ? "/app/overview" : "/app/onboarding";
  throw embedRedirect(target, request);
};

export default function AppIndexRedirect() {
  return null;
}