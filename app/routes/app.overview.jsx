import { useState } from "react";
import { data, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { scheduleAllOrders } from "../lib/schedule.server";
import db from "../db.server";
import { Journey } from "../components/queue/journey";
import { OrderModal } from "../components/queue/ordermodal";

const PAGE_SIZE = 5;

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  const [results, shopSettings, sentTotal, recentSent] = await Promise.all([
    scheduleAllOrders(shop),
    db.shopSettings.findUnique({ where: { shop } }),
    db.order.count({ where: { shop, sentAt: { not: null } } }),
    db.order.findMany({
      where: { shop, sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const counts = {
    queue: results.filter((r) => r.state === "SCHEDULED").length,
    waiting: results.filter((r) => r.state === "WAITING").length,
    suppressed: results.filter((r) => r.state === "SUPPRESSED").length,
  };

  const upcoming = results
    .filter((r) => (r.state === "SCHEDULED" || r.state === "DUE") && r.sendAt)
    .sort((a, b) => new Date(a.sendAt) - new Date(b.sendAt));

  return data({
    nextRequest: upcoming[0] || null,
    counts,
    waitDays: shopSettings?.settleInDays ?? null,
    recentSent,
    sentTotal,
    page,
    totalPages: Math.max(1, Math.ceil(sentTotal / PAGE_SIZE)),
  });
}

function getInitials(name) {
  if (!name || name === "Guest Customer") return "GC";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

export default function Overview() {
  const { nextRequest, counts, waitDays, recentSent, sentTotal, page, totalPages } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeModal, setActiveModal] = useState(null);

  const goToPage = (p) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(p));
    setSearchParams(params);
  };

  const due = nextRequest && new Date(nextRequest.sendAt) <= new Date();

  // Pagination calculations
  const startIndex = (page - 1) * PAGE_SIZE;
  const endIndex = Math.min(page * PAGE_SIZE, sentTotal);

  return (
    <>
      <div style={{ padding: "32px", maxWidth: "1200px", margin: "0 auto" }}>
        <header className="pagehead">
          <h1 className="t-xl">Overview</h1>
          <p className="pagehead__sub">
            Review requests go out a set number of days after the carrier says the parcel landed.
          </p>
        </header>

        <div className="Card">
          <div className="Card__head"><h3 className="t-sm">Next request</h3></div>
          {nextRequest ? (
            <>
              <div className="Next">
                <div className="Next__who">
                  <b>{nextRequest.order.customerName || "Guest Customer"} · {nextRequest.order.name}</b>
                  <span>
                    {due
                      ? "Due — goes out in the next batch"
                      : `Sends ${new Date(nextRequest.sendAt).toLocaleDateString()}`}
                  </span>
                </div>
                <button className="Btn" onClick={() => setActiveModal(nextRequest)}>View order</button>
              </div>
              <Journey orderData={nextRequest} />
            </>
          ) : (
            <div className="Empty">
              <b>Nothing waiting to send</b>
              <p>Every delivered order has either been asked or ruled out.</p>
            </div>
          )}
        </div>

        <div className="KpiGrid">
          <div className="Card" style={{ margin: 0 }}>
            <div className="Kpi__v">{counts.queue}</div>
            <div className="Kpi__l">In the queue</div>
            <div className="Kpi__d sub">Delivered, waiting out the {waitDays ?? "—"}-day pause</div>
          </div>
          <div className="Card" style={{ margin: 0 }}>
            <div className="Kpi__v">{counts.waiting}</div>
            <div className="Kpi__l">Still in transit</div>
            <div className="Kpi__d sub">No delivery confirmation yet, so no clock started</div>
          </div>
          <div className="Card" style={{ margin: 0 }}>
            <div className="Kpi__v">{counts.suppressed}</div>
            <div className="Kpi__l">Ruled out</div>
            <div className="Kpi__d sub">Refunds, failed deliveries, opt-outs and exclusions</div>
          </div>
        </div>

        <div className="Card Card--flush">
          <div className="Card__head" style={{ padding: "var(--s4) var(--s4) 0" }}>
            <h3 className="t-sm">Recently sent</h3>
          </div>
          <table className="Table">
            <thead><tr><th>Customer</th><th className="end">Sent</th></tr></thead>
            <tbody>
              {recentSent.length === 0 ? (
                <tr><td colSpan={2}><div className="Empty"><b>Nothing sent yet</b></div></td></tr>
              ) : (
                recentSent.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div className="Who">
                        <span className="Ava">{getInitials(o.customerName)}</span>
                        <div><b>{o.customerName || "Guest Customer"}</b><span>{o.name}</span></div>
                      </div>
                    </td>
                    <td className="sub mono end">{new Date(o.sentAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* PAGINATION BAR */}
          {sentTotal > 0 && (
            <div className="Pagination">
              <span className="Pagination__info">
                Showing {sentTotal === 0 ? 0 : startIndex + 1}–{endIndex} of {sentTotal} orders
              </span>
              <div className="Pagination__btns">
                <button
                  className="Btn Btn--sm"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  Previous
                </button>
                <span className="Pagination__count">
                  Page {page} of {totalPages}
                </span>
                <button
                  className="Btn Btn--sm"
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        <OrderModal data={activeModal} onClose={() => setActiveModal(null)} />
      </div>
      <style dangerouslySetInnerHTML={{
        __html: `
        :root{--bg:#F1F1F1;--surface:#FFFFFF;--surface-sub:#F7F7F7;--surface-hover:#F1F1F1;--border:#E3E3E3;--border-sub:#EBEBEB;--border-strong:#CDCDCD;--text:#303030;--text-sub:#616161;--text-dis:#8A8A8A;--icon:#4A4A4A;--focus:#005BD3;--crit:#E51C00;--succ-bg:#CDFEE1;--succ-text:#0C5132;--succ-line:#29845A;--warn-bg:#FFF1E3;--warn-text:#5E4200;--warn-line:#B98900;--info-line:#0094D5;--ink:#3B2E63;--ink-line:#5B49A0;--ink-tint:#F4F2FC;--ink-edge:#DCD6F5;--mono:'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,monospace;--r1:6px;--r2:8px;--r3:12px;--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:20px;--sh-card:0 1px 0 0 rgba(26,26,26,.07);--sh-pop:0 4px 16px rgba(0,0,0,.14), 0 0 0 1px rgba(0,0,0,.06);}
        
        body, button, input, select, textarea {
          font-family: -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        .t-xl{font-size:28px;line-height:24px;font-weight:700;letter-spacing:-.01em}
        .t-sm{font-size:16px;line-height:18px;font-weight:600}
        .t-cap{font-size:12px;line-height:16px}
        .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
        .sub{color:var(--text-sub)}
        .pagehead{margin-bottom:var(--s5)}
        .pagehead__sub{color:var(--text-sub);font-size:15px;margin-top:var(--s1)}
        .Card{background:var(--surface);border-radius:var(--r3);box-shadow:var(--sh-card);border:1px solid var(--border-sub);padding:var(--s4);margin-bottom:var(--s4)}
        .Card--flush{padding:0}
        .Card__head{display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--s3)}
        .Empty{padding:32px 16px;text-align:center}
        .Empty b{display:block;font-size:13px;font-weight:650;margin-bottom:4px}
        .Empty p{font-size:13px;color:var(--text-sub);margin:0 auto}
        .Next{display:flex;align-items:center;justify-content:space-between;gap:var(--s4);margin-bottom:var(--s3)}
        .Next__who b{display:block;font-size:14px;font-weight:650}
        .Next__who span{font-size:12px;color:var(--text-sub)}
        .KpiGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s4);margin-bottom:var(--s4)}
        .Kpi__v{font-size:24px;font-weight:700;line-height:1.1}
        .Kpi__l{font-size:13px;font-weight:600;margin-top:4px}
        .Kpi__d{font-size:12px;margin-top:2px}
        .Table{width:100%;border-collapse:collapse}
        .Table th{text-align:left;font-size:12px;font-weight:600;color:var(--text-sub);padding:var(--s2) var(--s4);border-bottom:1px solid var(--border-sub);background:var(--surface-sub);white-space:nowrap}
        .Table td{padding:var(--s3) var(--s4);border-bottom:1px solid var(--border-sub);vertical-align:middle;font-size:13px}
        .Table tr:hover td{background:#FCFCFC}
        .Table .end{text-align:right;white-space:nowrap}
        .Who{display:flex !important;align-items:center !important;gap:12px !important;min-width:0}
        .Who b{font-weight:600;display:block;line-height:17px;color:var(--text)}
        .Who span{font-size:12px;color:var(--text-sub);display:block;line-height:16px}
        .Ava{width:28px !important;height:28px !important;border-radius:50% !important;background:var(--ink-tint) !important;color:var(--ink) !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;font-size:11px !important;font-weight:700 !important;line-height:1 !important;text-align:center !important;padding:0 !important;margin:0 !important;flex:0 0 auto !important;border:1px solid var(--ink-edge) !important}
        .Btn{height:32px;padding:0 12px;border:0;border-radius:var(--r2);background:var(--surface);color:var(--text);box-shadow:0 0 0 1px rgba(0,0,0,.08) inset, 0 -1px 0 0 #B5B5B5 inset, 0 1px 0 0 rgba(255,255,255,.48) inset;font-size:13px;font-weight:600;line-height:32px;display:inline-flex;align-items:center;cursor:pointer}
        .Btn:hover{background:#F7F7F7}
        .Btn--sm{height:28px;padding:0 8px;font-size:12px;line-height:28px}
        .Btn[disabled]{opacity:.42;pointer-events:none}
        .Pagination{display:flex;align-items:center;justify-content:space-between;padding:var(--s3) var(--s4);background:var(--surface-sub);border-top:1px solid var(--border-sub);border-radius:0 0 var(--r3) var(--r3)}
        .Pagination__info{font-size:12px;color:var(--text-sub)}
        .Pagination__btns{display:flex;align-items:center;gap:var(--s3)}
        .Pagination__count{font-size:12px;color:var(--text-sub);font-weight:500}
        
        /* FULL JOURNEY TIMELINE STYLES */
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

        /* MODAL STYLES */
        .Backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:90;display:grid;place-items:center;padding:var(--s5);overflow-y:auto}
        .Modal{background:var(--surface);border-radius:var(--r3);width:100%;max-width:520px;box-shadow:var(--sh-pop);max-height:88vh;display:flex;flex-direction:column}
        .Modal__h{display:flex;align-items:center;gap:var(--s3);padding:var(--s4);border-bottom:1px solid var(--border-sub)}
        .Modal__h h3{flex:1;font-size:15px;font-weight:650;margin:0}
        .Modal__x{width:28px;height:28px;border:0;background:none;border-radius:var(--r1);color:var(--icon);display:grid;place-items:center;font-size:18px;line-height:1;cursor:pointer}
        .Modal__x:hover{background:var(--surface-hover)}
        .Modal__b{padding:var(--s4);overflow-y:auto}
        .Modal__f{padding:var(--s3) var(--s4);border-top:1px solid var(--border-sub);display:flex;gap:var(--s2);justify-content:flex-end;background:var(--surface-sub);border-radius:0 0 var(--r3) var(--r3)}
        .Inline{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}

        /* DECISION STEPS INSIDE MODAL */
        .Steps{display:grid;gap:2px;margin-top:var(--s2)}
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
      `}} />
    </>
  );
}