import db from "../db.server";
import { TEMPLATES } from "./template-defaults";

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
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone || "Asia/Kolkata", weekday: "short" });
    const dayName = formatter.format(date);
    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return days[dayName] ?? date.getDay();
  } catch (e) {
    return date.getDay();
  }
}

export function setHourInTimezone(date, targetHour, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone || "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
    const parts = formatter.formatToParts(date);
    const localIso = `${parts.find(p=>p.type==="year").value}-${parts.find(p=>p.type==="month").value}-${parts.find(p=>p.type==="day").value}T${String(targetHour).padStart(2, "0")}:00:00`;
    return new Date(localIso);
  } catch (e) {
    const d = new Date(date); d.setHours(targetHour, 0, 0, 0); return d;
  }
}

// ==========================================
// 2. SUPPRESSION HELPER
// ==========================================
function runSuppressions(order, suppressionSettings, lastCustomerSendAt, templateId, templateName, sendAt, estimated) {
  if (order.skippedByYou) return { state: "SUPPRESSED", reason: "Skipped by you", sendAt: null, templateId, templateName };
  if (suppressionSettings?.refundedCancelled && (order.cancelledAt || order.refundedAt)) return { state: "SUPPRESSED", reason: "Order refunded or cancelled", sendAt: null, templateId, templateName };
  if (suppressionSettings?.deliveryFailed && order.deliveryFailed) return { state: "SUPPRESSED", reason: "Delivery failed or returned", sendAt: null, templateId, templateName };
  if (suppressionSettings?.unsubscribed && order.unsubscribed) return { state: "SUPPRESSED", reason: "Customer unsubscribed", sendAt: null, templateId, templateName };
  if (suppressionSettings?.cooldownEnabled && lastCustomerSendAt && templateId !== "careGuide") {
    const cooldownEnd = addDays(lastCustomerSendAt, suppressionSettings.cooldownDays ?? 30);
    if (cooldownEnd > new Date()) return { state: "SUPPRESSED", reason: "Asked recently (cooldown)", sendAt: null, templateId, templateName };
  }
  if (order.customerTags?.some(t => suppressionSettings?.excludedTags?.includes(t))) return { state: "SUPPRESSED", reason: "Excluded customer tag", sendAt: null, templateId, templateName };
  if (order.productTypes?.some(t => suppressionSettings?.excludedProductTypes?.includes(t))) return { state: "SUPPRESSED", reason: "Excluded product type", sendAt: null, templateId, templateName };

  const state = sendAt <= new Date() ? "DUE" : "SCHEDULED";
  const reasonStr = estimated ? `Estimated: ${templateName}` : templateName;
  return { state, reason: reasonStr, sendAt, estimated, templateId, templateName };
}

// ==========================================
// 3. PURE SCHEDULING ENGINE
// ==========================================
export function schedule(order, shopSettings, suppressionSettings, templateSettings, lastCustomerSendAt, targetTemplateId) {
  let sentEmails = {};
  try { sentEmails = typeof order.sentEmails === "string" ? JSON.parse(order.sentEmails) : (order.sentEmails || {}); } catch (e) {}

  let customConfigs = {};
  try { customConfigs = typeof templateSettings?.customConfigs === "string" ? JSON.parse(templateSettings.customConfigs) : (templateSettings?.customConfigs || {}); } catch (e) {}

  let baseDate = order.deliveredAt;
  let estimated = false;

  if (!baseDate) {
    if (!order.fulfilledAt) return { state: "WAITING", reason: "Not yet fulfilled", sendAt: null };
    if (order.trackingNumber) return { state: "WAITING", reason: "In transit", sendAt: null };
    if (shopSettings?.noTracking === "skip") return { state: "SUPPRESSED", reason: "No tracking — policy is skip", sendAt: null };
    if (shopSettings?.noTracking === "fixed") { baseDate = addDays(order.fulfilledAt, shopSettings.noTrackDays ?? 7); estimated = true; }
    else return { state: "WAITING", reason: "No tracking, no estimate available", sendAt: null };
  }

  const timezone = shopSettings?.clockSource === "customer" ? order.customerTimezone || shopSettings?.timezone || "Asia/Kolkata" : shopSettings?.timezone || "Asia/Kolkata";
  const sendHour = shopSettings?.sendHour ?? 10;
  const quietDays = shopSettings?.quietDays ?? [0];

  // --- PATH A: UI QUEUE FILTER (EVALUATE SPECIFIC TEMPLATE) ---
  if (targetTemplateId) {
    const baseTpl = TEMPLATES[targetTemplateId];
    if (!baseTpl) return { state: "SUPPRESSED", reason: "Invalid template", sendAt: null };
    
    // If it's already sent, tell the Queue UI exactly when!
    if (sentEmails[targetTemplateId]) {
      return { state: "SENT", reason: `Sent: ${baseTpl.name}`, sendAt: new Date(sentEmails[targetTemplateId]), templateId: targetTemplateId, templateName: baseTpl.name };
    }

    const waitDays = customConfigs[targetTemplateId]?.waitDays ?? baseTpl.config.waitDays;
    let tSendAt = addDays(baseDate, waitDays);
    tSendAt = setHourInTimezone(tSendAt, sendHour, timezone);
    let hops = 0; while (quietDays.includes(getDayOfWeekInTimezone(tSendAt, timezone)) && hops < 8) { tSendAt = addDays(tSendAt, 1); hops++; }

    return runSuppressions(order, suppressionSettings, lastCustomerSendAt, targetTemplateId, baseTpl.name, tSendAt, estimated);
  }

  // --- PATH B: CRON JOB (FIND EARLIEST DUE) ---
  const activeTplIds = templateSettings?.enabledTemplates || ["review"];
  let nextTemplate = null;

  for (const tId of activeTplIds) {
    if (sentEmails[tId]) continue;
    const baseTpl = TEMPLATES[tId];
    if (!baseTpl) continue;

    const waitDays = customConfigs[tId]?.waitDays ?? baseTpl.config.waitDays;
    let tSendAt = addDays(baseDate, waitDays);
    tSendAt = setHourInTimezone(tSendAt, sendHour, timezone);
    let hops = 0; while (quietDays.includes(getDayOfWeekInTimezone(tSendAt, timezone)) && hops < 8) { tSendAt = addDays(tSendAt, 1); hops++; }

    if (!nextTemplate || tSendAt < nextTemplate.sendAt) nextTemplate = { id: tId, name: baseTpl.name, sendAt: tSendAt };
  }

  if (!nextTemplate) return { state: "SENT", reason: "All active emails sent", sendAt: null };
  return runSuppressions(order, suppressionSettings, lastCustomerSendAt, nextTemplate.id, nextTemplate.name, nextTemplate.sendAt, estimated);
}

// ==========================================
// 4. BATCH QUERY
// ==========================================
export async function scheduleAllOrders(shop, targetTemplateId = null) {
  const [orders, shopSettings, suppressionSettings, templateSettings] = await Promise.all([
    db.order.findMany({ where: { shop } }),
    db.shopSettings.findUnique({ where: { shop } }),
    db.suppressionSettings.findUnique({ where: { shop } }),
    db.templateSettings.findUnique({ where: { shop } }),
  ]);

  const lastSendMap = new Map();
  for (const o of orders) {
    if (!o.customerId) continue;
    let latest = o.sentAt ? new Date(o.sentAt) : null;
    let sEmails = {};
    try { sEmails = typeof o.sentEmails === "string" ? JSON.parse(o.sentEmails) : (o.sentEmails || {}); } catch(e){}
    for (const key in sEmails) { const d = new Date(sEmails[key]); if (!latest || d > latest) latest = d; }
    if (latest) {
      const current = lastSendMap.get(o.customerId);
      if (!current || latest > current) lastSendMap.set(o.customerId, latest);
    }
  }

  return orders.map((order) => ({
    order,
    ...schedule(order, shopSettings || {}, suppressionSettings || {}, templateSettings || {}, order.customerId ? lastSendMap.get(order.customerId) : null, targetTemplateId),
  }));
}