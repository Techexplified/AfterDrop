import db from "../db.server";
import { scheduleAllOrders } from "./schedule.server";
import { sendReviewRequest } from "./resend.server";

export async function dispatchScheduledOrders() {
    const shops = await db.shopSettings.findMany({ select: { shop: true } });

    const results = {
        processed: 0,
        sent: 0,
        errors: [],
    }

    for (const { shop } of shops) {

        try {
            const scheduledRows = await scheduleAllOrders(shop);

            const dueOrders = scheduledRows.filter(
                (r) => r.state === "DUE" && !r.order.sendAt && !r.order.skippedByYou
            );

            for (const row of dueOrders) {
                results.processed++;
                const order = row.order;
                const cleanShopName = shop
                    .replace(".myshopify.com", "")
                    .replace(/-/g, " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase());
                const featuredProduct = {
                    name: `Items from Order ${order.name}`,
                    image: null,
                };

                const emailResult = await sendReviewRequest({
                    email: order.customerEmail,
                    customerName: order.customerName || "there",
                    orderName: order.name,
                    shopName: cleanShopName,
                    product: featuredProduct,
                });

                if(emailResult.success){
                    await db.order.update({
                        where: {id: order.id},
                        data: {sentAt: new Date()},
                    });
                    results.sent++;
                }else{
                    results.errors.push({orderId: order.id, error: emailResult.error});
                }
            }
        } catch (err){
            results.errors.push({shop, error: err.message});
        }
    }

}