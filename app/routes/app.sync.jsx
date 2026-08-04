import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { formatAndUpsertOrder } from "../lib/order-sync.server";

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  let hasNextPage = true;
  let cursor = null;
  let totalCount = 0;

  while (hasNextPage) {
    const response = await admin.graphql(`
      query getOrders($cursor: String) {
        orders(first: 50, after: $cursor, query: "fulfillment_status:fulfilled") {
          edges {
            cursor
            node {
              id
              name
              totalPriceSet { shopMoney { amount } }
              cancelledAt
              customer {
                id
                displayName
                firstName
                lastName
                email
                tags
              }
              fulfillments(first: 1) {
                trackingInfo(first: 1) { number }
                status
                events(first: 10) {
                  edges { node { status happenedAt } }
                }
              }
              lineItems(first: 10) {
                edges { node { product { productType } } }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `, { variables: { cursor } });

    const { data } = await response.json();
    const edges = data?.orders?.edges || [];

    for (const { node } of edges) {
      await formatAndUpsertOrder(db, session.shop, node);
      totalCount++;
    }

    hasNextPage = data?.orders?.pageInfo?.hasNextPage || false;
    if (edges.length > 0) {
      cursor = edges[edges.length - 1].cursor;
    }
  }

  return { ok: true, count: totalCount };
}

export default function Sync() {
  const fetcher = useFetcher();
  const running = fetcher.state === "submitting";

  return (
    <div style={{ padding: 40 }}>
      <h1>Order sync</h1>
      <p>Manually pull existing orders (with delivery history) until webhooks are wired up.</p>
      <fetcher.Form method="post">
        <button type="submit" disabled={running}>
          {running ? "Syncing..." : "Sync orders now"}
        </button>
      </fetcher.Form>
      {fetcher.data && (
        <p>Synced {fetcher.data.count} orders from Shopify.</p>
      )}
    </div>
  );
}