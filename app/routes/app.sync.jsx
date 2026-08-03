// app/routes/app.sync.jsx
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);

  let cursor = null;
  let hasNextPage = true;
  let totalSynced = 0;

  while (hasNextPage) {
    const response = await admin.graphql(
      `query getOrders($cursor: String) {
        orders(first: 50, after: $cursor, query: "fulfillment_status:fulfilled") {
          edges {
            cursor
            node {
              id
              name
              totalPriceSet { shopMoney { amount } }
              customer {
                firstName
                lastName
                displayName
                email
                tags
              }
              cancelledAt
              fulfillments(first: 1) {
                trackingInfo(first: 1) { number }
                status
                events(first: 10) {
                  edges { node { status happenedAt } }
                }
              }
              lineItems(first: 5) {
                edges { node { product { productType } } }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }`,
      { variables: { cursor } }
    );

    const { data } = await response.json();
    const orders = data.orders.edges;

    for (const { node } of orders) {
      const fulfillment = node.fulfillments?.[0];
      const deliveryEvent = fulfillment?.events?.edges
        ?.map(e => e.node)
        .find(ev => ev.status === "DELIVERED");

      const productTypes = node.lineItems.edges
        .map(e => e.node.product?.productType)
        .filter(Boolean);

      const cust = node.customer;
      const custName =
        cust?.displayName?.trim() ||
        `${cust?.firstName || ''} ${cust?.lastName || ''}`.trim() ||
        cust?.email ||
        "Guest Customer";

      await db.order.upsert({
        where: { id: node.id },
        update: { customerName: custName },
        create: {
          id: node.id,
          shop: session.shop,
          name: node.name,
          customerName: custName,
          customerTags: node.customer?.tags ?? [],
          productTypes,
          totalPrice: Math.round(Number(node.totalPriceSet.shopMoney.amount) * 100),
          trackingNumber: fulfillment?.trackingInfo?.[0]?.number ?? null,
          deliveredAt: deliveryEvent?.happenedAt ? new Date(deliveryEvent.happenedAt) : null,
          cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
        },
      });
    }

    totalSynced += orders.length;
    hasNextPage = data.orders.pageInfo.hasNextPage;
    cursor = orders.length ? orders[orders.length - 1].cursor : null;
  }

  return { ok: true, count: totalSynced, hasNextPage: false };
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
        <p>Synced {fetcher.data.count} orders. More pages: {String(fetcher.data.hasNextPage)}</p>
      )}
    </div>
  );
}