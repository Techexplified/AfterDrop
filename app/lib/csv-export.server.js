import db from "../db.server";

export async function generateReviewsCsvResponse(shop) {
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