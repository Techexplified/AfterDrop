import { useState } from "react";
import { data, useLoaderData, useFetcher } from "react-router";
import db from "../db.server";

export async function loader({ params, request }) {
    const { token } = params;
    const url = new URL(request.url);
    const initalRating = url.searchParams.get("rating") || "5";

    const order = await db.order.findUnique({
        where: { reviewToken: token },
    });

    if (!order) {
        throw new Response("Review link expired or invalid", { status: 400 });
    }

    const shopSettings = await db.shopSettings.findUnique({
        where: { shop: order.shop },
    });

    const fallbackShopName = order.shop.replace(".myshopify.com", "");

    return data({
        shopName: shopSettings?.storeName || fallbackShopName,
        orderName: order.id,
        customerName: order.customerName || "",
        initalRating: parseInt(initalRating, 10),
    });
}

export async function action({ request, params }) {
    const { token } = params;
    const formData = await request.formData();

    const rating = parseInt(formData.get("rating"), 10);
    const body = formData.get("body");
    const displayName = formData.get("displayName");

    const order = await db.order.findUnique({
        where: { reviewToken: token },
    });

    if (!order) return data({ error: "Invalid token" }, { status: 404 });

    await db.review.create({
        data: {
            shop: order.shop,
            orderId: order.id,
            displayName: displayName || order.customerName,
            rating,
            body,
        },
    });

    return data({ succes: true });
}

export default function PublicReviewPage() {
    const { shopName, orderName, customerName, initialRating } = useLoaderData();
    const fetcher = useFetcher();
    const [rating, setRating] = useState(initialRating);

    // If the submission was successful, show a thank you message
    if (fetcher.data?.success) {
        return (
            <div style={styles.container}>
                <div style={styles.card}>
                    <div style={styles.successIcon}>✓</div>
                    <h2 style={styles.title}>Thank you!</h2>
                    <p style={styles.text}>Your feedback for order {orderName} has been submitted successfully.</p>
                </div>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <div style={styles.header}>
                    <span style={styles.shopBadge}>{shopName}</span>
                    <h2 style={styles.title}>How did we do?</h2>
                    <p style={styles.text}>Leave a review for your recent order ({orderName}).</p>
                </div>

                <fetcher.Form method="post" style={styles.form}>
                    {/* Hidden input to pass the rating to the action */}
                    <input type="hidden" name="rating" value={rating} />

                    <div style={styles.starsContainer}>
                        {[1, 2, 3, 4, 5].map((star) => (
                            <button
                                key={star}
                                type="button"
                                onClick={() => setRating(star)}
                                style={{
                                    ...styles.star,
                                    color: star <= rating ? "#FFB800" : "#E5E5E5",
                                }}
                            >
                                ★
                            </button>
                        ))}
                    </div>

                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Display Name (Optional)</label>
                        <input
                            type="text"
                            name="displayName"
                            defaultValue={customerName}
                            placeholder="How should your name appear?"
                            style={styles.input}
                        />
                    </div>

                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Your Review</label>
                        <textarea
                            name="body"
                            rows="4"
                            placeholder="What did you think about your purchase?"
                            style={styles.textarea}
                            required
                        ></textarea>
                    </div>

                    <button
                        type="submit"
                        style={styles.submitBtn}
                        disabled={fetcher.state !== "idle"}
                    >
                        {fetcher.state === "submitting" ? "Submitting..." : "Submit Review"}
                    </button>
                </fetcher.Form>
            </div>
        </div>
    );
}

// Minimal, clean styles for the public page
const styles = {
    container: {
        minHeight: "100vh",
        backgroundColor: "#F7F7F7",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "40px 20px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    },
    card: {
        backgroundColor: "#FFFFFF",
        borderRadius: "12px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        padding: "32px",
        width: "100%",
        maxWidth: "460px",
        textAlign: "center",
    },
    shopBadge: {
        display: "inline-block",
        fontSize: "12px",
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "#5A5D63",
        marginBottom: "12px",
    },
    title: {
        margin: "0 0 8px 0",
        fontSize: "24px",
        fontWeight: "700",
        color: "#111",
    },
    text: {
        margin: "0 0 24px 0",
        fontSize: "15px",
        color: "#5A5D63",
        lineHeight: "1.5",
    },
    starsContainer: {
        display: "flex",
        justifyContent: "center",
        gap: "8px",
        marginBottom: "24px",
    },
    star: {
        background: "none",
        border: "none",
        fontSize: "42px",
        cursor: "pointer",
        padding: "0",
        lineHeight: "1",
        transition: "color 0.2s ease",
    },
    form: {
        textAlign: "left",
    },
    inputGroup: {
        marginBottom: "20px",
    },
    label: {
        display: "block",
        fontSize: "13px",
        fontWeight: "600",
        color: "#303030",
        marginBottom: "8px",
    },
    input: {
        width: "100%",
        padding: "12px",
        border: "1px solid #E5E6E9",
        borderRadius: "8px",
        fontSize: "15px",
        boxSizing: "border-box",
    },
    textarea: {
        width: "100%",
        padding: "12px",
        border: "1px solid #E5E6E9",
        borderRadius: "8px",
        fontSize: "15px",
        boxSizing: "border-box",
        resize: "vertical",
    },
    submitBtn: {
        width: "100%",
        backgroundColor: "#111",
        color: "#fff",
        border: "none",
        padding: "14px",
        borderRadius: "8px",
        fontSize: "15px",
        fontWeight: "600",
        cursor: "pointer",
        transition: "background 0.2s ease",
    },
    successIcon: {
        fontSize: "48px",
        color: "#0C5132",
        backgroundColor: "#CDFEE1",
        width: "80px",
        height: "80px",
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 20px auto",
    }
};