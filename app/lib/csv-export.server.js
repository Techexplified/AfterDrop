import db from "../db.server";

// Helper to auto-generate a fallback review title based on rating
function generateReviewTitle(rating) {
  switch (Number(rating)) {
    case 5:
      return "Great product!";
    case 4:
      return "Good quality";
    case 3:
      return "Average experience";
    case 2:
      return "Needs improvement";
    case 1:
      return "Disappointed";
    default:
      return "Customer Review";
  }
}

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

  // Industry-Standard Importable Headers
  const headers = [
    "id",
    "shop",
    "productId",
    "productName",
    "rating",
    "title",
    "comment",
    "author",
    "email",
    "status",
    "reply",
    "replyDate",
    "createdAt"
  ];

  const escapeCsv = (str) => `"${String(str || "").replace(/"/g, '""')}"`;

  const csvRows = allReviews.map((r) => [
    escapeCsv(r.id),
    escapeCsv(r.shop),
    escapeCsv(r.productId || ""),
    escapeCsv(r.productName || ""),
    escapeCsv(r.rating),
    escapeCsv(generateReviewTitle(r.rating)), // Auto-generated headline
    escapeCsv(r.body),                        // Review comment
    escapeCsv(r.displayName || r.order?.customerName || "Guest"),
    escapeCsv(r.order?.customerEmail || ""),
    escapeCsv("published"),                   // Default status
    escapeCsv(""),                            // Blank reply
    escapeCsv(""),                            // Blank replyDate
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