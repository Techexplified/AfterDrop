import db from "../db.server";

// 1. Updated GraphQL Query: Fetching product id, title & images for line items
const ORDER_QUERY = `#graphql
  query getOrderForSync($id: ID!) {
    order(id: $id) {
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
        edges {
          node {
            title
            variantTitle
            image {
              url
            }
            product {
              id
              title
              productType
              featuredImage {
                url
              }
            }
          }
        }
      }
    }
  }
`;

export async function upsertOrderFromShopify(admin, shop, orderGid) {
    const response = await admin.graphql(ORDER_QUERY, {
        variables: { id: orderGid },
    });

    const { data } = await response.json();
    const node = data?.order;

    if (!node) {
        console.warn(`[order-sync] Order ${orderGid} not found on shopify`);
        return null;
    }

    return await formatAndUpsertOrder(db, shop, node);
}

export async function formatAndUpsertOrder(dbClient, shop, node) {
    const fulfillment = node.fulfillments?.[0];
    const deliveryEvent = fulfillment?.events?.edges
        ?.map((e) => e.node)
        .find((ev) => ev.status === "DELIVERED");

    const productTypes = Array.from(
        new Set(
            node.lineItems?.edges
                ?.map((e) => e.node.product?.productType)
                .filter(Boolean) || []
        )
    );

    // 2. Extract Line Items Summary & Primary Product Info
    const lineItemNodes = node.lineItems?.edges?.map((e) => e.node).filter(Boolean) || [];

    const lineItemsData = lineItemNodes.map((item) => ({
        id: item.product?.id || null,
        title: item.product?.title || item.title || "Item",
        variantTitle: item.variantTitle || null,
        productType: item.product?.productType || null,
        image: item.image?.url || item.product?.featuredImage?.url || null,
    }));

    const firstLineItem = lineItemNodes[0];
    const primaryProductId = firstLineItem?.product?.id ?? null;
    const primaryProductName =
        firstLineItem?.product?.title ||
        firstLineItem?.title ||
        null;
    const primaryProductImage =
        firstLineItem?.image?.url ||
        firstLineItem?.product?.featuredImage?.url ||
        null;

    const cust = node.customer;

    const fullName = cust
        ? `${cust.firstName || ""} ${cust.lastName || ""}`.trim()
        : null;

    const customerName =
        cust?.displayName?.trim() ||
        fullName ||
        cust?.email ||
        "Guest Customer";

    const customerEmail = cust?.email ?? null;
    const customerId = cust?.id ?? null;

    let isUnsubscribed = false;
    if (customerEmail) {
        const previousOptOut = await dbClient.order.findFirst({
            where: {
                shop: shop,
                customerEmail: customerEmail,
                unsubscribed: true
            },
        });
        if (previousOptOut) {
            isUnsubscribed = true;
        }
    }

    const sharedData = {
        customerName,
        customerEmail,
        customerId,
        customerTags: cust?.tags ?? [],
        productTypes,
        primaryProductId,
        primaryProductName,
        primaryProductImage,
        lineItems: lineItemsData,
        totalPrice: Math.round(Number(node.totalPriceSet?.shopMoney?.amount || 0) * 100),
        trackingNumber: fulfillment?.trackingInfo?.[0]?.number ?? null,
        deliveredAt: deliveryEvent?.happenedAt ? new Date(deliveryEvent.happenedAt) : null,
        cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
        unsubscribed: isUnsubscribed,
    };

    return await dbClient.order.upsert({
        where: { id: node.id },
        update: sharedData,
        create: {
            id: node.id,
            shop,
            name: node.name,
            ...sharedData,
        },
    });
}