import { redirect } from "react-router";
import { authenticate } from "../../shopify.server";

const EMBED_QUERY_KEYS = [
  "shop", "host", "embedded", "hmac", "id_token", "session", "timestamp", "locale"
];

function hasEmbedContext(url) {
  return EMBED_QUERY_KEYS.some((key) => url.searchParams.has(key));
}

function isLikelyShopifyAdminReferer(request) {
  const referer = request.headers.get("Referer") || "";
  return referer.includes("admin.shopify.com") || referer.includes(".myshopify.com/admin");
}

function appHomeUrl(request) {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  return qs ? `/app/overview?${qs}` : "/app/overview";
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  // Embedded admin or OAuth return — go straight to the app UI
  if (hasEmbedContext(url) || isLikelyShopifyAdminReferer(request)) {
    throw redirect(appHomeUrl(request));
  }

  // Existing session (e.g. reopen from Apps menu without query params)
  try {
    await authenticate.admin(request);
    throw redirect(appHomeUrl(request));
  } catch (error) {
    if (error instanceof Response) throw error;
    throw redirect("/auth/login");
  }
};

export default function Index() {
  return null;
}
