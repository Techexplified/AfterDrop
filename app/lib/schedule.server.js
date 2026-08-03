// lib/schedule.server.js
import db from "../db.server";

// ==========================================
// 1. DATE HELPERS
// ==========================================

export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function getDayOfWeekInTimezone(date, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "Asia/Kolkata",
      weekday: "short",
    });
    const dayName = formatter.format(date);
    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return days[dayName] ?? date.getDay();
  } catch (e) {
    return date.getDay();
  }
}

export function setHourInTimezone(date, targetHour, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    const year = parts.find((p) => p.type === "year")?.value;

    const pad = (n) => String(n).padStart(2, "0");
    const localIso = `${year}-${month}-${day}T${pad(targetHour)}:00:00`;
    return new Date(localIso);
  } catch (e) {
    const d = new Date(date);
    d.setHours(targetHour, 0, 0, 0);
    return d;
  }
}

// ==========================================
// 2. PURE SCHEDULING ENGINE
// ==========================================

export function schedule(order, shopSettings, suppressionSettings, lastCustomerSendAt) {
  // Already sent or manually skipped
  if (order.sentAt) {
    return { state: "SENT", reason: null, sendAt: order.sentAt };
  }
  if (order.skippedByYou) {
    return { state: "SUPPRESSED", reason: "Skipped by you", sendAt: null };
  }

  // --- SUPPRESSION CHECKS ---
  if (suppressionSettings?.refundedCancelled && (order.cancelledAt || order.refundedAt)) {
    return { state: "SUPPRESSED", reason: "Order refunded or cancelled", sendAt: null };
  }
  if (suppressionSettings?.deliveryFailed && order.deliveryFailed) {
    return { state: "SUPPRESSED", reason: "Delivery failed or returned", sendAt: null };
  }
  if (suppressionSettings?.unsubscribed && order.unsubscribed) {
    return { state: "SUPPRESSED", reason: "Customer unsubscribed", sendAt: null };
  }
  if (suppressionSettings?.cooldownEnabled && lastCustomerSendAt) {
    const cooldownEnd = addDays(lastCustomerSendAt, suppressionSettings.cooldownDays ?? 30);
    if (cooldownEnd > new Date()) {
      return { state: "SUPPRESSED", reason: "Asked recently (cooldown)", sendAt: null };
    }
  }

  // --- EXCLUSION CHECKS ---
  const hasExcludedTag = order.customerTags?.some((t) =>
    suppressionSettings?.excludedTags?.includes(t)
  );
  if (hasExcludedTag) {
    return { state: "SUPPRESSED", reason: "Excluded customer tag", sendAt: null };
  }

  const hasExcludedType = order.productTypes?.some((t) =>
    suppressionSettings?.excludedProductTypes?.includes(t)
  );
  if (hasExcludedType) {
    return { state: "SUPPRESSED", reason: "Excluded product type", sendAt: null };
  }

  // --- TIMING & DELIVERY FALLBACK ---
  let baseDate = order.deliveredAt;
  let estimated = false;

  if (!baseDate) {
    if (!order.fulfilledAt) {
      return { state: "WAITING", reason: "Not yet fulfilled", sendAt: null };
    }
    if (order.trackingNumber) {
      return { state: "WAITING", reason: "In transit", sendAt: null };
    }
    if (shopSettings?.noTracking === "skip") {
      return { state: "SUPPRESSED", reason: "No tracking — policy is skip", sendAt: null };
    }
    if (shopSettings?.noTracking === "fixed") {
      baseDate = addDays(order.fulfilledAt, shopSettings.noTrackDays ?? 7);
      estimated = true;
    } else {
      return { state: "WAITING", reason: "No tracking, no estimate available", sendAt: null };
    }
  }

  // --- SETTLE-IN & TIMEZONE CALCULATION ---
  const settleIn = shopSettings?.settleInDays ?? 3;
  let sendAt = addDays(baseDate, settleIn);

  const timezone =
    shopSettings?.clockSource === "customer"
      ? order.customerTimezone || shopSettings?.timezone || "Asia/Kolkata"
      : shopSettings?.timezone || "Asia/Kolkata";

  const sendHour = shopSettings?.sendHour ?? 10;
  sendAt = setHourInTimezone(sendAt, sendHour, timezone);

  // --- QUIET DAYS HOPPING ---
  const quietDays = shopSettings?.quietDays ?? [0];
  let hops = 0;
  while (quietDays.includes(getDayOfWeekInTimezone(sendAt, timezone)) && hops < 8) {
    sendAt = addDays(sendAt, 1);
    hops++;
  }

  const state = sendAt <= new Date() ? "DUE" : "SCHEDULED";
  return { state, reason: estimated ? "Estimated delivery date" : null, sendAt, estimated };
}

// ==========================================
// 3. BATCH QUERY (CALL THIS IN LOADER)
// ==========================================

export async function scheduleAllOrders(shop) {
  const [orders, shopSettings, suppressionSettings] = await Promise.all([
    db.order.findMany({ where: { shop } }),
    db.shopSettings.findUnique({ where: { shop } }),
    db.suppressionSettings.findUnique({ where: { shop } }),
  ]);

  // Single groupBy query to find the last send for all customers in this store
  const lastSends = await db.order.groupBy({
    by: ["customerId"],
    where: { shop, sentAt: { not: null }, customerId: { not: null } },
    _max: { sentAt: true },
  });

  const lastSendMap = new Map(lastSends.map((l) => [l.customerId, l._max.sentAt]));

  return orders.map((order) => ({
    order,
    ...schedule(
      order,
      shopSettings || {},
      suppressionSettings || {},
      order.customerId ? lastSendMap.get(order.customerId) : null
    ),
  }));
}