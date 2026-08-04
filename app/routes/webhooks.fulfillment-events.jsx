import { authenticate } from "../shopify.server";
import db from "../db.server";
import { upsertOrderFromShopify } from "../lib/order-sync.server";

export async function action({ request }) {
    console.log("WEBHOOK HIT");
    const { topic, shop, payload, admin } = await authenticate.webhook(request);

    // Normalize topic strings (Shopify passes uppercase SNAKE_CASE here)
    if (topic === "ORDERS_FULFILLED" || topic === "ORDERS_UPDATED") {
        const orderGid = payload?.admin_graphql_api_id || payload?.id;
        const formattedGid = orderGid?.toString().startsWith("gid://")
            ? orderGid
            : `gid://shopify/Order/${orderGid}`;

        if (formattedGid) {
            console.log(`[Webhook] Order updated/fulfilled: ${formattedGid}`);
            await upsertOrderFromShopify(admin, shop, formattedGid);
        }
        return new Response("OK", { status: 200 });
    }

    if (topic === "FULFILLMENT_EVENTS_CREATE") {
        const status = payload?.status?.toLowerCase();
        const orderGid = payload?.admin_graphql_api_order_id;

        if (!orderGid) {
            return new Response("Missing order GID in payload", { status: 200 });
        }

        // 1. Sync the core order data first
        const order = await upsertOrderFromShopify(admin, shop, orderGid);

        if (order) {
            // 2. Explicitly force deliveredAt timestamp if status is delivered
            if (status === "delivered") {
                const happenedAt = payload.happened_at ? new Date(payload.happened_at) : new Date();
                await db.order.update({
                    where: { id: order.id },
                    data: { deliveredAt: happenedAt },
                });
                console.log(`[Webhook Success] Order ${order.name} set to DELIVERED`);
            } else if (status === "failure") {
                await db.order.update({
                    where: { id: order.id },
                    data: { deliveryFailed: true },
                });
            }
        }

        return new Response("OK", { status: 200 });
    }

    return new Response("Unhandled webhook topic", { status: 400 });
}