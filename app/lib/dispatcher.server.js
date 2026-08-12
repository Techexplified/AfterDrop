import db from "../db.server";
import { scheduleAllOrders } from "./schedule.server";
import { sendTemplateEmail } from "./resend.server";

export async function dispatchScheduledOrders() {
  const shops = await db.shopSettings.findMany({ select: { shop: true } });

  const results = { processed: 0, sent: 0, errors: [] };

  for (const { shop } of shops) {
    try {
      const scheduledRows = await scheduleAllOrders(shop);
      const templateSettings = await db.templateSettings.findUnique({ where: { shop } });

      let customConfigs = {};
      try {
        customConfigs = typeof templateSettings?.customConfigs === "string"
          ? JSON.parse(templateSettings.customConfigs)
          : (templateSettings?.customConfigs || {});
      } catch (e) {}

      // Find DUE orders that have a valid pending templateId
      const dueOrders = scheduledRows.filter(
        (r) => r.state === "DUE" && r.templateId && !r.order.skippedByYou
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

        const emailResult = await sendTemplateEmail({
          to: order.customerEmail,
          shop,
          shopName: cleanShopName,
          orderName: order.name,
          customerName: order.customerName || "there",
          product: featuredProduct,
          templateId: row.templateId,
          customConfig: customConfigs[row.templateId] || {},
          reviewToken: order.reviewToken,
        });

        if (emailResult.success) {
          // Parse current sentEmails JSON and write back the new sent entry
          let currentSent = {};
          try {
            currentSent = typeof order.sentEmails === "string"
              ? JSON.parse(order.sentEmails)
              : (order.sentEmails || {});
          } catch (e) {}

          const updatedSent = {
            ...currentSent,
            [row.templateId]: new Date().toISOString(),
          };

          await db.order.update({
            where: { id: order.id },
            data: {
              sentEmails: updatedSent,
              sentAt: new Date(), // Keep legacy timestamp updated
            },
          });
          results.sent++;
        } else {
          results.errors.push({ orderId: order.id, error: emailResult.error });
        }
      }
    } catch (err) {
      results.errors.push({ shop, error: err.message });
    }
  }

  return results;
}