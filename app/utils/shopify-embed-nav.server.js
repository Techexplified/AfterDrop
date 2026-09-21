import { redirect } from "react-router";
import { mergeShopifyEmbedParams } from "./shopify-embed-nav.js";

/** Server-side redirect that preserves Shopify embedded-app query params. */
export function embedRedirect(to, request) {
  const reqUrl = new URL(request.url);
  return redirect(mergeShopifyEmbedParams(to, reqUrl.search));
}
