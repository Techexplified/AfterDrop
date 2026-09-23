import { Outlet, useLoaderData, useRouteError, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { embedRedirect } from "../utils/shopify-embed-nav.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const shopSettings = await db.shopSettings.findUnique({
    where: { shop },
    select: { isOnboarded: true },
  });

  const isOnboarded = !!shopSettings?.isOnboarded;
  const pathname = url.pathname.replace(/\/$/, "");
  const isOnboardingRoute = pathname === "/app/onboarding";

  if (!isOnboarded && !isOnboardingRoute) {
    throw embedRedirect("/app/onboarding", request);
  }

  if (isOnboarded && isOnboardingRoute) {
    throw embedRedirect("/app/overview", request);
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    isOnboarded,
  };
};

export function shouldRevalidate({ formMethod, currentUrl, nextUrl }) {
  if (formMethod) return true;
  if (currentUrl?.pathname?.includes("/onboarding") || nextUrl?.pathname?.includes("/onboarding")) {
    return true;
  }
  return false;
}

export default function App() {
  const { apiKey, isOnboarded } = useLoaderData();

  const location = useLocation();
  const showNav = isOnboarded && !location.pathname.includes("/app/onboarding");

  return (
    <AppProvider embedded apiKey={apiKey}>
      {showNav && (
        <s-app-nav>
          <s-link href="/app/overview">Overview</s-link>
          <s-link href="/app/timing">Timing</s-link>
          <s-link href="/app/suppression">Rules</s-link>
          <s-link href="/app/queue">Queue</s-link>
          <s-link href="/app/template">Templates</s-link>
          <s-link href="/app/reviews">Collected Reviews</s-link>
          <s-link href="/app/settings">Settings</s-link>
        </s-app-nav>
      )}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
