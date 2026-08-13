import { data, useLoaderData, useFetcher } from "react-router";
import db from "../db.server";

export async function loader({ params }) {
    const { token } = params;

    const order = db.order.findUnique({
        where: { reviewToken: token },
    });

    if (!order) {
        throw new Response("INvalid link or token", { status: 400 });
    }

    const shopSettings = await db.shopSettings.findUnique({
        where: { shop: order.shop },
    });

    const fallbackShopName = order.shop.replace(".myshopify.com", "");

    return data({
        shopName: shopSettings?.storeName || fallbackShopName,
        customEmail : order.customEmail,
        alreadyUnsubscribed: order.unsubscribed,
    })
}

export async function action({ params }) {
  const { token } = params;

  const order = await db.order.findUnique({
    where: { reviewToken: token },
  });

  if (!order) {
    return data({ error: "Order not found" }, { status: 404 });
  }

  // THE GLOBAL OPT-OUT:
  // Update ALL orders belonging to this customer Email in this shop
  await db.order.updateMany({
    where: {
      shop: order.shop,
      customerEmail: order.customerEmail,
    },
    data: { unsubscribed: true },
  });

  return data({ success: true });
}

export default function UnsubscribePage() {
  const { shopName, customerEmail, alreadyUnsubscribed } = useLoaderData();
  const fetcher = useFetcher();

  // Show the success state if they were already unsubscribed OR if the action just succeeded
  const isDone = alreadyUnsubscribed || fetcher.data?.success;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>{shopName}</h2>
        {isDone ? (
          <div>
            <p style={styles.text}>
              <strong>{customerEmail}</strong> has been unsubscribed from all post-purchase emails.
            </p>
            <p style={styles.subtext}>You won't receive any more review requests or marketing updates from this store.</p>
          </div>
        ) : (
          <div>
            <p style={styles.text}>Unsubscribe <strong>{customerEmail}</strong> from post-purchase emails?</p>
            <fetcher.Form method="post" style={{ marginTop: "24px" }}>
              <button type="submit" style={styles.button} disabled={fetcher.state !== "idle"}>
                {fetcher.state === "submitting" ? "Unsubscribing..." : "Confirm Unsubscribe"}
              </button>
            </fetcher.Form>
          </div>
        )}
      </div>
    </div>
  );
}

// Clean, standalone styles ensuring it looks good on mobile phones
const styles = {
  container: { 
    minHeight: "100vh", 
    backgroundColor: "#F7F7F7", 
    display: "grid", 
    placeItems: "center", 
    padding: "20px", 
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" 
  },
  card: { 
    backgroundColor: "#FFFFFF", 
    padding: "40px 32px", 
    borderRadius: "12px", 
    maxWidth: "420px", 
    width: "100%", 
    textAlign: "center", 
    boxShadow: "0 4px 24px rgba(0,0,0,0.06)" 
  },
  title: { 
    fontSize: "12px", 
    fontWeight: "700", 
    textTransform: "uppercase", 
    letterSpacing: "0.05em", 
    color: "#5A5D63", 
    marginBottom: "16px", 
    marginTop: "0" 
  },
  text: { 
    fontSize: "16px", 
    color: "#111", 
    lineHeight: "1.5", 
    margin: "0 0 8px" 
  },
  subtext: { 
    fontSize: "14px", 
    color: "#5A5D63", 
    margin: 0, 
    lineHeight: "1.5" 
  },
  button: { 
    backgroundColor: "#E51C00", 
    color: "#FFF", 
    border: "none", 
    padding: "14px 24px", 
    borderRadius: "8px", 
    fontWeight: "600", 
    fontSize: "15px", 
    cursor: "pointer", 
    width: "100%", 
    transition: "opacity 0.2s" 
  }
};