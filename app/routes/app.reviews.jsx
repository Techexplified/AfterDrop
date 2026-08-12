import { data, useLoaderData, useSearchParams, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const PAGE_SIZE = 10;

export async function loader({ request }) {
    const { session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const shop = session.shop;

    // --- 1. CSV EXPORT HANDLER ---
    if (url.searchParams.get("export") === "true") {
        const allReviews = await db.review.findMany({
            where: { shop },
            orderBy: { createdAt: "desc" },
            include: {
                order: {
                    select: { name: true, customerEmail: true, customerName: true }
                }
            }
        });

        const headers = ["Review ID", "Order Name", "Customer Name", "Customer Email", "Rating", "Review Body", "Date"];
        const escapeCsv = (str) => `"${String(str || "").replace(/"/g, '""')}"`;

        const csvRows = allReviews.map((r) => [
            escapeCsv(r.id),
            escapeCsv(r.order?.name || "—"),
            escapeCsv(r.displayName || r.order?.customerName || "Guest"),
            escapeCsv(r.order?.customerEmail || "—"),
            escapeCsv(r.rating),
            escapeCsv(r.body),
            escapeCsv(new Date(r.createdAt).toISOString()),
        ].join(","));

        const csvContent = [headers.join(","), ...csvRows].join("\n");

        return new Response(csvContent, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="afterdrop-reviews-${new Date().toISOString().slice(0, 10)}.csv"`,
            },
        });
    }

    // --- 2. PAGINATED DASHBOARD LOADER ---
    const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
    const requestedPage = Math.max(1, isNaN(rawPage) ? 1 : rawPage);

    const totalReviews = await db.review.count({ where: { shop } });
    const totalPages = Math.max(1, Math.ceil(totalReviews / PAGE_SIZE));
    const currentPage = Math.min(requestedPage, totalPages);

    const reviews = await db.review.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        skip: (currentPage - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
            order: {
                select: { name: true, customerEmail: true, customerName: true }
            }
        }
    });

    return data({ reviews, totalReviews, currentPage, totalPages });
}

function getInitials(name) {
    if (!name || name === "Guest Customer") return "GC";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

export default function ReviewsDashboard() {
    const { reviews, totalReviews, currentPage, totalPages } = useLoaderData();
    const [searchParams, setSearchParams] = useSearchParams();
    const revalidator = useRevalidator();

    const startIndex = (currentPage - 1) * PAGE_SIZE;

    const goToPage = (page) => {
        const newParams = new URLSearchParams(searchParams);
        newParams.set("page", page.toString());
        setSearchParams(newParams);
    };

    return (
        <>
            <div style={{ padding: "32px", maxWidth: "1200px", margin: "0 auto" }}>

                {/* HEADER WITH EXPORT BUTTON */}
                <header className="pagehead" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
                    <div>
                        <h1 className="t-xl">Collected Reviews</h1>
                        <p className="pagehead__sub">Feedback submitted by your customers.</p>
                    </div>

                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <button
                            type="button"
                            className="Btn"
                            onClick={() => revalidator.revalidate()}
                            disabled={revalidator.state !== "idle"}
                        >
                            {revalidator.state === "loading" ? "Refreshing..." : "Refresh"}
                        </button>
                        {/* Point directly to this route with export=true */}
                        <a href="/app/reviews?export=true" download className="Btn">
                            Export CSV
                        </a>
                    </div>
                </header>

                {/* TABLE */}
                <div className="Card Card--flush">
                    <table className="Table">
                        <thead>
                            <tr>
                                <th>Customer</th>
                                <th>Order</th>
                                <th>Rating</th>
                                <th>Review</th>
                                <th className="end">Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reviews.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="Empty">
                                        <b>No reviews yet</b>
                                        <p>Once customers submit feedback, it will appear here.</p>
                                    </td>
                                </tr>
                            ) : (
                                reviews.map((review) => {
                                    const customerName = review.displayName || review.order?.customerName || "Guest";
                                    const customerEmail = review.order?.customerEmail || "—";

                                    return (
                                        <tr key={review.id}>
                                            <td>
                                                <div className="Who">
                                                    <span className="Ava">{getInitials(customerName)}</span>
                                                    <div>
                                                        <b>{customerName}</b>
                                                        <span>{customerEmail}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>{review.order?.name || "—"}</td>
                                            <td>
                                                <span style={{ color: "#FFB800", fontSize: "16px", letterSpacing: "2px" }}>
                                                    {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
                                                </span>
                                            </td>
                                            <td style={{ maxWidth: "340px", whiteSpace: "normal" }}>
                                                <p style={{ margin: 0, fontSize: "13px", color: "var(--text)", lineHeight: "1.4" }}>
                                                    {review.body || <i style={{ color: "var(--text-dis)" }}>No text provided</i>}
                                                </p>
                                            </td>
                                            <td className="end rowsub mono" style={{ verticalAlign: "middle" }}>
                                                {new Date(review.createdAt).toLocaleDateString()}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>

                    {/* PAGINATION CONTROLS */}
                    {totalReviews > 0 && (
                        <div className="Pagination">
                            <span className="Pagination__info">
                                Showing {startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, totalReviews)} of {totalReviews} reviews
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
            </div>

            {/* INJECTED STYLES */}
            <style dangerouslySetInnerHTML={{
                __html: `
        /* CORE VARIABLES & FONT BASE */
        :root{--bg:#F1F1F1;--surface:#FFFFFF;--surface-sub:#F7F7F7;--surface-hover:#F1F1F1;--border:#E3E3E3;--border-sub:#EBEBEB;--border-strong:#CDCDCD;--text:#303030;--text-sub:#616161;--text-dis:#8A8A8A;--ink:#3B2E63;--ink-tint:#F4F2FC;--ink-edge:#DCD6F5;--mono:'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,monospace;--r1:6px;--r2:8px;--r3:12px;--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:20px;--sh-card:0 1px 0 0 rgba(26,26,26,.07);}

        body, button, input, select, textarea {
          font-family: -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        /* TYPOGRAPHY */
        .t-xl{font-size:28px;line-height:24px;font-weight:700;letter-spacing:-.01em;margin:0;}
        .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}

        /* LAYOUT & CHROME */
        .pagehead__sub{color:var(--text-sub);font-size:15px;margin-top:var(--s1);max-width:66ch}
        .Card{background:var(--surface);border-radius:var(--r3);box-shadow:var(--sh-card);border:1px solid var(--border-sub);padding:var(--s4);margin-bottom:var(--s4)}
        .Card--flush{padding:0}
        .Empty{padding:48px 16px;text-align:center}
        .Empty b{display:block;font-size:13px;font-weight:650;margin-bottom:4px}
        .Empty p{font-size:13px;color:var(--text-sub);margin:0 auto}

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

        /* BUTTONS */
        .Btn{height:32px;padding:0 12px;border:0;border-radius:var(--r2);background:var(--surface);color:var(--text);box-shadow:0 0 0 1px rgba(0,0,0,.08) inset, 0 -1px 0 0 #B5B5B5 inset, 0 1px 0 0 rgba(255,255,255,.48) inset;font-size:13px;font-weight:600;line-height:32px;display:inline-flex;align-items:center;cursor:pointer;text-decoration:none;}
        .Btn:hover{background:#F7F7F7}
        .Btn--sm{height:28px;padding:0 8px;font-size:12px;line-height:28px}
        .Btn[disabled]{opacity:.42;pointer-events:none}
      ` }} />
        </>
    );
}