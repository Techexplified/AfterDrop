import { useState } from "react";
import { data, useLoaderData, useSearchParams, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { scheduleAllOrders } from "../lib/schedule.server";
import db from "../db.server";
import { Journey } from "../components/queue/journey";
import { OrderModal } from "../components/queue/ordermodal";
import { TEMPLATES } from "../lib/template-defaults";

const TABS = [
  { id: "SCHEDULED", label: "In the queue" },
  { id: "DUE", label: "Sending today" },
  { id: "WAITING", label: "In transit" },
  { id: "SUPPRESSED", label: "Not asked" },
  { id: "ALL", label: "Everything" },
];

const STATE_ICONS = {
  SCHEDULED: "sched", DUE: "due", WAITING: "wait", SUPPRESSED: "skip", SENT: "sent"
};

const PAGE_SIZE = 5;

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const stateFilter = url.searchParams.get("state") || "SCHEDULED";
  const templateFilter = url.searchParams.get("template") || "review"; // Default to Review Request

  // Get merchant's enabled templates for the dropdown
  const templateSettings = await db.templateSettings.findUnique({ where: { shop: session.shop } });
  const activeTpls = templateSettings?.enabledTemplates || ["review"];
  
  const enabledTemplates = activeTpls.map(id => ({
    id,
    name: TEMPLATES[id]?.name || id
  }));

  // ✅ Pass templateFilter to the scheduler so it evaluates EXACTLY this template
  const results = await scheduleAllOrders(session.shop, templateFilter);

  results.sort((a, b) => {
    if (!a.sendAt) return 1;
    if (!b.sendAt) return -1;
    return new Date(a.sendAt) - new Date(b.sendAt);
  });

  // Filter by the status tab (In Queue, Sending Today, etc.)
  let filtered = results;
  if (stateFilter !== "ALL") {
    filtered = filtered.filter(r => r.state === stateFilter);
  }

  // Fetch in-transit orders for simulate delivery picker
  const inTransitOrders = await db.order.findMany({
    where: { shop: session.shop, deliveredAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, customerName: true, trackingNumber: true },
    take: 20,
  });

  return data({ rows: filtered, inTransitOrders, stateFilter, templateFilter, enabledTemplates });
}
export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");
  const orderId = formData.get("orderId");

  // --- 1. TOGGLE SKIP ---
  if (intent === "toggle-skip") {
    const order = await db.order.findFirst({ where: { id: orderId, shop } });
    if (!order) return data({ error: "Order not found" }, { status: 404 });

    const newSkip = formData.has("skip")
      ? formData.get("skip") === "true"
      : !order.skippedByYou;

    await db.order.update({
      where: { id: orderId },
      data: { skippedByYou: newSkip },
    });
    return data({ 
      success: true, 
      skipped: newSkip, 
      message: newSkip ? `Order ${order.name} skipped.` : `Order ${order.name} restored to queue.` 
    });
  }

  // --- 2. SEND NOW ---
  if (intent === "send-now") {
    if (!orderId) {
      return data({ error: "Missing orderId" }, { status: 400 });
    }

    const templateId = formData.get("templateId") || "review";

    const order = await db.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return data({ error: "Order not found" }, { status: 404 });
    }

    const [shopSettings, templateSettings] = await Promise.all([
      db.shopSettings.findUnique({ where: { shop: session.shop }, select: { storeName: true } }),
      db.templateSettings.findUnique({ where: { shop } }),
    ]);

    let customConfigs = {};
    try {
      customConfigs = typeof templateSettings?.customConfigs === "string"
        ? JSON.parse(templateSettings.customConfigs)
        : (templateSettings?.customConfigs || {});
    } catch (e) {}

    const fallbackShopName = session.shop
      .replace(".myshopify.com", "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
    const cleanShopName = shopSettings?.storeName?.trim() || fallbackShopName;

    let primaryName = order.primaryProductName;
    let primaryImage = order.primaryProductImage;
    let extraCount = 0;

    // Auto-backfill if order was synced before image support was added
    if ((!primaryImage || !primaryName) && admin) {
      try {
        const { upsertOrderFromShopify } = await import("../lib/order-sync.server");
        const refreshed = await upsertOrderFromShopify(admin, shop, order.id);
        if (refreshed) {
          primaryName = refreshed.primaryProductName;
          primaryImage = refreshed.primaryProductImage;
          let refreshedItems = [];
          try {
            refreshedItems = typeof refreshed.lineItems === "string" ? JSON.parse(refreshed.lineItems) : (refreshed.lineItems || []);
          } catch (e) {}
          if (Array.isArray(refreshedItems) && refreshedItems.length > 1) {
            extraCount = refreshedItems.length - 1;
          }
        }
      } catch (err) {
        console.warn("[queue] Auto-backfill product image failed:", err.message);
      }
    }

    if (!extraCount) {
      let parsedItems = [];
      try {
        parsedItems = typeof order.lineItems === "string" ? JSON.parse(order.lineItems) : (order.lineItems || []);
      } catch (e) {}
      if (Array.isArray(parsedItems) && parsedItems.length > 1) {
        extraCount = parsedItems.length - 1;
      }
    }

    const featuredProduct = {
      name: primaryName || `Items from Order ${order.name}`,
      image: primaryImage || null,
      extraItemCount: extraCount,
    };

    // ✅ Dynamic import fixes the Vite plugin issue
    const { sendTemplateEmail } = await import("../lib/resend.server");

    const emailResult = await sendTemplateEmail({
      to: order.customerEmail,
      shop,
      shopName: cleanShopName,
      orderName: order.name,
      customerName: order.customerName || "there",
      product: featuredProduct,
      templateId,
      customConfig: customConfigs[templateId] || {},
      reviewToken: order.reviewToken,
    });

    if (emailResult.success) {
      let currentSent = {};
      try {
        currentSent = typeof order.sentEmails === "string" ? JSON.parse(order.sentEmails) : (order.sentEmails || {});
      } catch (e) {}

      await db.order.update({
        where: { id: orderId },
        data: {
          sentEmails: { ...currentSent, [templateId]: new Date().toISOString() },
          sentAt: new Date(),
          skippedByYou: false,
        },
      });

      return data({ success: true, message: `Email sent for order ${order.name}` });
    } else {
      return data({ error: emailResult.error }, { status: 500 });
    }
  }

  // --- 3. SIMULATE DELIVERY ---
  if (intent === "simulate-delivery") {
    const rawInput = formData.get("orderId")?.trim();
    if (!rawInput) {
      return data({ error: "Please provide a valid Order ID or Number (e.g. #1001)." }, { status: 400 });
    }

    const formattedName = rawInput.startsWith("#") ? rawInput : `#${rawInput}`;

    // Robust multi-tenant query: matches ID, #1001, or 1001 scoped strictly to this merchant's shop
    const order = await db.order.findFirst({
      where: {
        shop,
        OR: [
          { id: rawInput },
          { name: rawInput },
          { name: formattedName },
        ],
      },
    });

    if (!order) {
      return data({ 
        error: `Order "${rawInput}" was not found for this store. Please ensure this order exists and was fulfilled.` 
      }, { status: 404 });
    }

    if (order.deliveredAt) {
      return data({ 
        success: true, 
        message: `Order ${order.name} was already marked as delivered on ${new Date(order.deliveredAt).toLocaleDateString()}.` 
      });
    }

    await db.order.update({
      where: { id: order.id },
      data: { deliveredAt: new Date() },
    });

    return data({ 
      success: true, 
      message: `Order ${order.name} marked as delivered! It is now scheduled in your queue.` 
    });
  }

  return data({ error: "Invalid action" }, { status: 400 });
}

function getInitials(name) {
  if (!name || name === "Guest Customer") return "GC";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

export default function Queue() {
  const { rows, inTransitOrders = [], stateFilter, templateFilter, enabledTemplates } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeModal, setActiveModal] = useState(null);

  // --- SIMULATE DELIVERY STATE ---
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [manualOrderInput, setManualOrderInput] = useState("");
  const [confirmDeliveryOrder, setConfirmDeliveryOrder] = useState(null);
  const simulateFetcher = useFetcher();

  // --- PAGINATION CALCULATIONS ---
  const rawPage = parseInt(searchParams.get("page") || "1", 10);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, isNaN(rawPage) ? 1 : rawPage), totalPages);

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedRows = rows.slice(startIndex, startIndex + PAGE_SIZE);

  const setFilter = (state) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("state", state);
    newParams.set("page", "1"); // Reset page on tab switch
    setSearchParams(newParams);
  };

  const setTemplateFilter = (e) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("template", e.target.value);
    newParams.set("page", "1"); // Reset page on template switch
    setSearchParams(newParams);
  };

  const goToPage = (page) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", page.toString());
    setSearchParams(newParams);
  };

  return (
    <>
      <div style={{ padding: "32px", maxWidth: "1200px", margin: "0 auto" }}>
        <header className="pagehead" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 className="t-xl">Queue</h1>
            <p className="pagehead__sub">Every open order and what AfterDrop intends to do with it.</p>
          </div>
          <div>
            <button
              className="Btn Btn--pri"
              onClick={() => setShowSimulateModal(true)}
            >
              Mark as delivered
            </button>
          </div>
        </header>

        {/* FEEDBACK BANNERS */}
        {simulateFetcher.data?.message && (
          <div style={{ background: "#CDFEE1", border: "1px solid #29845A", color: "#0C5132", padding: "10px 16px", borderRadius: "8px", marginBottom: "16px", fontSize: "13px", fontWeight: "500", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>✓ {simulateFetcher.data.message}</span>
            <button onClick={() => { simulateFetcher.data = null; }} style={{ background: "none", border: "none", cursor: "pointer", color: "#0C5132", fontWeight: "bold" }}>×</button>
          </div>
        )}
        {simulateFetcher.data?.error && (
          <div style={{ background: "#FFF0F0", border: "1px solid #FFD2CC", color: "#8E1F0B", padding: "10px 16px", borderRadius: "8px", marginBottom: "16px", fontSize: "13px", fontWeight: "500", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>✕ {simulateFetcher.data.error}</span>
            <button onClick={() => { simulateFetcher.data = null; }} style={{ background: "none", border: "none", cursor: "pointer", color: "#8E1F0B", fontWeight: "bold" }}>×</button>
          </div>
        )}

        {/* TABS & TEMPLATE DROPDOWN */}
        <div className="Filters" style={{ justifyContent: "space-between" }}>
          <div className="Seg">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                aria-pressed={stateFilter === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-sub)", fontWeight: "500" }}>Showing:</span>
            <select 
              className="Select" 
              value={templateFilter} 
              onChange={setTemplateFilter}
            >
              {enabledTemplates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* TABLE */}
        <div className="Card Card--flush">
          <table className="Table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Journey</th>
                <th>Status</th>
                <th className="end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="4" className="Empty"><b>Nothing here</b><p>No orders match this filter.</p></td></tr>
              ) : (
                paginatedRows.map((row) => (
                  <tr key={row.order.id}>
                    <td>
                      <div className="Who">
                        <span className="Ava">{getInitials(row.order.customerName)}</span>
                        <div>
                          <b>{row.order.customerName || "Guest Customer"}</b>
                          <span>{row.order.name}</span>
                        </div>
                      </div>
                    </td>

                    <td style={{ minWidth: "200px" }}>
                      <Journey orderData={row} mini={true} />
                    </td>

                    <td>
                      <span className={`St St--${STATE_ICONS[row.state]}`}>{row.state}</span>
                      <span className="rowsub mono">
                        {row.reason ? row.reason : row.sendAt ? new Date(row.sendAt).toLocaleString() : "—"}
                      </span>
                    </td>

                    <td className="end">
                      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", alignItems: "center" }}>
                        <button className="Btn Btn--sm" onClick={() => setActiveModal(row)}>Why?</button>
                        {!row.order.deliveredAt && (
                          <button
                            type="button"
                            className="Btn Btn--sm"
                            onClick={() => setConfirmDeliveryOrder(row.order)}
                          >
                            Mark delivered
                          </button>
                        )}
                        {(row.state === "SCHEDULED" || row.state === "DUE") && (
                          <ActionForm 
                            intent="send-now" 
                            orderId={row.order.id} 
                            templateId={row.templateId} 
                            label="Send now" 
                          />
                        )}
                        {row.state !== "SENT" && (
                          <ActionForm 
                            intent="toggle-skip" 
                            orderId={row.order.id} 
                            templateId={row.templateId}
                            label={row.order.skippedByYou ? "Unskip" : "Skip"}
                            extraInputs={[
                              { name: "skip", value: row.order.skippedByYou ? "false" : "true" }
                            ]}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* PAGINATION CONTROLS */}
          {rows.length > 0 && (
            <div className="Pagination">
              <span className="Pagination__info">
                Showing {startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, rows.length)} of {rows.length} orders
              </span>
              <div className="Pagination__btns">
                <button
                  className="Btn Btn--sm"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  Previous
                </button>
                <span className="Pagination__count">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="Btn Btn--sm"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* LEGEND */}
        <div className="Legend">
          <span><i style={{ background: "#303030" }}></i>Happened</span>
          <span><i style={{ background: "var(--ink-edge)" }}></i>Waiting period</span>
          <span><i style={{ background: "var(--ink)" }}></i>The ask</span>
          <span><i style={{ background: "var(--crit)" }}></i>Stopped</span>
        </div>

        {/* MODAL MOUNT */}
        <OrderModal 
          data={activeModal} 
          onClose={() => setActiveModal(null)} 
          onSimulateDelivery={(orderId) => {
            const target = activeModal?.order;
            setActiveModal(null);
            if (target) {
              setConfirmDeliveryOrder(target);
            } else {
              simulateFetcher.submit({ intent: "simulate-delivery", orderId }, { method: "post" });
            }
          }}
        />
      </div>

      {/* CONFIRM MANUAL DELIVERY MODAL */}
      {confirmDeliveryOrder && (
        <div className="Backdrop" onClick={() => setConfirmDeliveryOrder(null)}>
          <div className="Modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "460px" }}>
            <div className="Modal__h">
              <h3>Mark {confirmDeliveryOrder.name} as delivered?</h3>
              <button className="Modal__x" onClick={() => setConfirmDeliveryOrder(null)}>×</button>
            </div>
            <div className="Modal__b">
              <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "var(--text)", lineHeight: "1.5" }}>
                AfterDrop automatically tracks deliveries through your shipping carrier. You only need to mark an order manually for local pickups, couriers without live tracking, or test orders.
              </p>
              <p style={{ margin: 0, fontSize: "12.5px", color: "var(--text-sub)", lineHeight: "1.4" }}>
                Confirming will start the post-delivery review timeline for <b>{confirmDeliveryOrder.customerName || "this customer"}</b>.
              </p>
            </div>
            <div className="Modal__f">
              <button className="Btn" onClick={() => setConfirmDeliveryOrder(null)}>Cancel</button>
              <button 
                className="Btn Btn--pri" 
                disabled={simulateFetcher.state !== "idle"}
                onClick={() => {
                  simulateFetcher.submit({ intent: "simulate-delivery", orderId: confirmDeliveryOrder.id }, { method: "post" });
                  setConfirmDeliveryOrder(null);
                }}
              >
                {simulateFetcher.state !== "idle" ? "Marking..." : "Confirm delivery"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MARK AS DELIVERED MODAL */}
      {showSimulateModal && (
        <div className="Backdrop" onClick={() => setShowSimulateModal(false)}>
          <div className="Modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <div className="Modal__h">
              <h3>Mark order as delivered</h3>
              <button className="Modal__x" onClick={() => setShowSimulateModal(false)}>×</button>
            </div>
            <div className="Modal__b">
              <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "var(--text-sub)", lineHeight: "1.4" }}>
                Record delivery for local drop-offs, couriers without live tracking updates, or test orders. This begins the post-delivery review timeline.
              </p>

              {inTransitOrders.length > 0 ? (
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "6px" }}>
                    Select an in-transit order:
                  </label>
                  <select 
                    className="Select" 
                    style={{ width: "100%" }}
                    value={selectedOrderId}
                    onChange={(e) => { setSelectedOrderId(e.target.value); setManualOrderInput(""); }}
                  >
                    <option value="">-- Choose an order --</option>
                    {inTransitOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} — {o.customerName || "Customer"} {o.trackingNumber ? `(${o.trackingNumber})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p style={{ background: "var(--surface-sub)", padding: "10px 12px", borderRadius: "6px", fontSize: "12.5px", color: "var(--text-sub)", margin: "0 0 16px" }}>
                  No orders currently waiting in transit. You can enter an order number below.
                </p>
              )}

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "6px" }}>
                  {inTransitOrders.length > 0 ? "Or enter order number directly:" : "Enter order number:"}
                </label>
                <input
                  type="text"
                  placeholder="e.g. 1001 or #1001"
                  value={manualOrderInput}
                  onChange={(e) => { setManualOrderInput(e.target.value); setSelectedOrderId(""); }}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-strong)", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <div className="Modal__f">
              <button className="Btn" onClick={() => setShowSimulateModal(false)}>Cancel</button>
              <button 
                className="Btn Btn--pri" 
                disabled={(!selectedOrderId && !manualOrderInput.trim()) || simulateFetcher.state !== "idle"}
                onClick={() => {
                  const targetId = manualOrderInput.trim() || selectedOrderId;
                  simulateFetcher.submit({ intent: "simulate-delivery", orderId: targetId }, { method: "post" });
                  setShowSimulateModal(false);
                  setManualOrderInput("");
                  setSelectedOrderId("");
                }}
              >
                {simulateFetcher.state !== "idle" ? "Updating..." : "Mark as delivered"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INJECTED STYLES */}
      <style dangerouslySetInnerHTML={{
        __html: `
        /* CORE VARIABLES & FONT BASE */
        :root{--bg:#F1F1F1;--surface:#FFFFFF;--surface-sub:#F7F7F7;--surface-hover:#F1F1F1;--border:#E3E3E3;--border-sub:#EBEBEB;--border-strong:#CDCDCD;--text:#303030;--text-sub:#616161;--text-dis:#8A8A8A;--icon:#4A4A4A;--focus:#005BD3;--crit:#E51C00;--crit-bg:#FFF0F0;--crit-text:#8E1F0B;--crit-border:#FFD2CC;--succ-bg:#CDFEE1;--succ-text:#0C5132;--succ-line:#29845A;--warn-bg:#FFF1E3;--warn-text:#5E4200;--warn-line:#B98900;--info-bg:#EBF9FC;--info-text:#00527C;--info-line:#0094D5;--ink:#3B2E63;--ink-line:#5B49A0;--ink-tint:#F4F2FC;--ink-edge:#DCD6F5;--mono:'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,monospace;--r1:6px;--r2:8px;--r3:12px;--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:20px;--sh-card:0 1px 0 0 rgba(26,26,26,.07);--sh-pop:0 4px 16px rgba(0,0,0,.14), 0 0 0 1px rgba(0,0,0,.06);}

        body, button, input, select, textarea {
          font-family: -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        /* TYPOGRAPHY */
        .t-xl{font-size:28px;line-height:24px;font-weight:700;letter-spacing:-.01em}
        .t-sm{font-size:16px;line-height:18px;font-weight:600}
        .t-cap{font-size:12px;line-height:16px}
        .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
        .sub{color:var(--text-sub)}

        /* LAYOUT & CHROME */
        .pagehead{margin-bottom:var(--s5)}
        .pagehead__sub{color:var(--text-sub);font-size:15px;margin-top:var(--s1);max-width:66ch}
        .Card{background:var(--surface);border-radius:var(--r3);box-shadow:var(--sh-card);border:1px solid var(--border-sub);padding:var(--s4);margin-bottom:var(--s4)}
        .Card--flush{padding:0}
        .Empty{padding:32px 16px;text-align:center}
        .Empty b{display:block;font-size:13px;font-weight:650;margin-bottom:4px}
        .Empty p{font-size:13px;color:var(--text-sub);margin:0 auto}

        /* TABS / SEGMENTED CONTROL */
        .Filters{display:flex;gap:var(--s2);flex-wrap:wrap;align-items:center;margin-bottom:var(--s3)}
        .Seg{display:inline-flex;background:var(--surface-sub);border-radius:var(--r2);padding:2px;gap:2px;border:1px solid var(--border-sub)}
        .Seg button{flex:1;height:28px;padding:0 var(--s3);border:0;background:none;border-radius:var(--r1);font-size:12px;font-weight:500;color:var(--text-sub);white-space:nowrap;cursor:pointer}
        .Seg button[aria-pressed="true"]{background:var(--surface);color:var(--text);font-weight:600;box-shadow:var(--sh-card)}

        /* DROPDOWN SELECT */
        .Select { height: 32px; padding: 0 32px 0 12px; border: 1px solid var(--border-strong); border-radius: var(--r2); background: var(--surface) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%23303030' stroke-width='1.5'><path d='M1 1l4 4 4-4'/></svg>") no-repeat right 12px center; appearance: none; font-size: 13px; font-weight: 500; color: var(--text); cursor: pointer; box-shadow: var(--sh-card); }
        .Select:focus { outline: 2px solid var(--focus); outline-offset: 1px; }

        /* TABLES */
        .Table{width:100%;border-collapse:collapse}
        .Table th{text-align:left;font-size:12px;font-weight:600;color:var(--text-sub);padding:var(--s2) var(--s4);border-bottom:1px solid var(--border-sub);background:var(--surface-sub);white-space:nowrap}
        .Table td{padding:var(--s3) var(--s4);border-bottom:1px solid var(--border-sub);vertical-align:middle;font-size:13px}
        .Table tr:hover td{background:#FCFCFC}
        .Table .end{text-align:right;white-space:nowrap}
        .rowsub{font-size:12px;color:var(--text-sub);line-height:16px;display:block;margin-top:1px}

        /* PAGINATION */
        .Pagination{display:flex;align-items:center;justify-content:space-between;padding:var(--s3) var(--s4);background:var(--surface-sub);border-top:1px solid var(--border-sub);border-radius:0 0 var(--r3) var(--r3)}
        .Pagination__info{font-size:12px;color:var(--text-sub)}
        .Pagination__btns{display:flex;align-items:center;gap:var(--s3)}
        .Pagination__count{font-size:12px;color:var(--text-sub);font-weight:500}

        /* PEOPLE & AVATARS */
        .Who{display:flex !important;align-items:center !important;gap:12px !important;min-width:0}
        .Who b{font-weight:600;display:block;line-height:17px;color:var(--text)}
        .Who span{font-size:12px;color:var(--text-sub);display:block;line-height:16px}
        .Ava{width:28px !important;height:28px !important;border-radius:50% !important;background:var(--ink-tint) !important;color:var(--ink) !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;font-size:11px !important;font-weight:700 !important;line-height:1 !important;text-align:center !important;padding:0 !important;margin:0 !important;flex:0 0 auto !important;border:1px solid var(--ink-edge) !important}

        /* STATE PILLS */
        .St{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;white-space:nowrap}
        .St::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--text-dis);flex:0 0 auto}
        .St--sched::before{background:var(--ink-line)}
        .St--due::before{background:var(--warn-line)}
        .St--wait::before{background:var(--info-line)}
        .St--sent::before{background:var(--succ-line)}
        .St--skip::before{background:var(--text-dis)}

        /* BUTTONS */
        .Btn{height:32px;padding:0 12px;border:0;border-radius:var(--r2);background:var(--surface);color:var(--text);box-shadow:0 0 0 1px rgba(0,0,0,.08) inset, 0 -1px 0 0 #B5B5B5 inset, 0 1px 0 0 rgba(255,255,255,.48) inset;font-size:13px;font-weight:600;line-height:32px;display:inline-flex;align-items:center;cursor:pointer}
        .Btn:hover{background:#F7F7F7}
        .Btn--sm{height:28px;padding:0 8px;font-size:12px;line-height:28px}
        .Btn--pri{background:#303030 !important;color:#fff !important;border:none !important;box-shadow:none !important}
        .Btn--pri:hover{background:#111 !important}
        .Btn[disabled]{opacity:.42;pointer-events:none}

        /* LEGEND */
        .Legend{display:flex;gap:var(--s4);flex-wrap:wrap;font-size:11.5px;color:var(--text-sub);margin-top:var(--s2)}
        .Legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px}

        /* MODAL */
        .Backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:90;display:grid;place-items:center;padding:var(--s5);overflow-y:auto}
        .Modal{background:var(--surface);border-radius:var(--r3);width:100%;max-width:520px;box-shadow:var(--sh-pop);max-height:88vh;display:flex;flex-direction:column}
        .Modal__h{display:flex;align-items:center;gap:var(--s3);padding:var(--s4);border-bottom:1px solid var(--border-sub)}
        .Modal__h h3{flex:1;font-size:15px;font-weight:650;margin:0}
        .Modal__x{width:28px;height:28px;border:0;background:none;border-radius:var(--r1);color:var(--icon);display:grid;place-items:center;font-size:18px;line-height:1;cursor:pointer}
        .Modal__x:hover{background:var(--surface-hover)}
        .Modal__b{padding:var(--s4);overflow-y:auto}
        .Modal__f{padding:var(--s3) var(--s4);border-top:1px solid var(--border-sub);display:flex;gap:var(--s2);justify-content:flex-end;background:var(--surface-sub);border-radius:0 0 var(--r3) var(--r3)}
        .Inline{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}

        /* STEPS */
        .Steps{display:grid;gap:2px}
        .Step{display:flex;gap:var(--s3);align-items:flex-start;padding:var(--s3);border-radius:var(--r2);background:var(--surface-sub);position:relative}
        .Step__n{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:var(--surface);color:var(--text);border:1px solid var(--border-strong);display:grid;place-items:center;font-size:11px;font-weight:700}
        .Step__b{flex:1;min-width:0}
        .Step__t{font-size:13px;font-weight:600;line-height:18px;margin:0}
        .Step__d{font-size:12px;color:var(--text-sub);line-height:16px;margin-top:1px}
        .Step__v{flex:0 0 auto;font-size:12px;font-weight:600;text-align:right;padding-left:var(--s2)}
        .Step--final{background:var(--succ-bg)}
        .Step--final .Step__n{background:var(--succ-text);color:#fff;border-color:var(--succ-text)}
        .Step--final .Step__d{color:#0C5132;opacity:.75}
        .Step--stop{background:var(--warn-bg)}
        .Step--stop .Step__n{background:var(--warn-text);color:#fff;border-color:var(--warn-text)}
        .Step--stop .Step__d{color:var(--warn-text);opacity:.8}

        /* JOURNEY TIMELINE */
        .Jn{position:relative;height:72px;margin:var(--s5) 0 var(--s3)}
        .Jn__rail{position:absolute;left:0;right:0;top:23px;height:3px;border-radius:2px;background:var(--border)}
        .Jn__done{position:absolute;top:23px;left:0;height:3px;border-radius:2px;background:#303030}
        .Jn__wait{position:absolute;top:20px;height:9px;border-radius:5px;background:repeating-linear-gradient(115deg,var(--ink-tint),var(--ink-tint) 5px,var(--ink-edge) 5px,var(--ink-edge) 10px);border:1px solid var(--ink-edge)}
        .Jn__n{position:absolute;top:16px;transform:translateX(-50%);text-align:center}
        .Jn__dot{width:17px;height:17px;border-radius:50%;background:var(--surface);border:3px solid var(--border-strong);margin:0 auto}
        .Jn__n[data-on="1"] .Jn__dot{border-color:#303030;background:#303030}
        .Jn__n[data-ask="1"] .Jn__dot{border-color:var(--ink);background:var(--ink);box-shadow:0 0 0 5px var(--ink-tint)}
        .Jn__n[data-fail="1"] .Jn__dot{border-color:var(--crit);background:var(--crit)}
        .Jn__lb{font-size:11px;font-weight:650;line-height:14px;margin-top:7px;white-space:nowrap}
        .Jn__dt{font-size:10.5px;color:var(--text-sub);line-height:14px;white-space:nowrap;font-family:var(--mono)}
        .Jn__now{position:absolute;top:8px;height:38px;width:1px;background:var(--text);opacity:.75}
        .Jn__nowl{position:absolute;top:-4px;transform:translateX(-50%);font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text);white-space:nowrap}

        .Jn--mini{height:26px;margin:0;min-width:186px}
        .Jn--mini .Jn__rail,.Jn--mini .Jn__done{top:11px;height:3px}
        .Jn--mini .Jn__wait{top:8px;height:9px}
        .Jn--mini .Jn__n{top:5px}
        .Jn--mini .Jn__dot{width:13px;height:13px;border-width:2px}
        .Jn--mini .Jn__lb,.Jn--mini .Jn__dt{display:none}
        .Jn--mini .Jn__now{top:2px;height:20px}
      ` }} />
    </>
  );
}

// Small helper for standardizing the action buttons
function ActionForm({ intent, orderId, templateId, label, variant, extraInputs }) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="orderId" value={orderId} />
      {templateId && <input type="hidden" name="templateId" value={templateId} />}
      {extraInputs?.map((inp) => (
        <input key={inp.name} type="hidden" name={inp.name} value={inp.value} />
      ))}
      <button className={`Btn Btn--sm ${variant || ""}`} type="submit" disabled={isSubmitting}>
        {isSubmitting ? "..." : label}
      </button>
    </fetcher.Form>
  );
}