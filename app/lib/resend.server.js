import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendReviewRequest({ email, customerName, orderName, shopName, product }) {
  try {
    // Standard Sender Format: "Shop Name <email@domain.com>"
    const sender = `${shopName || "AfterDrop"} <onboarding@resend.dev>`;

    const data = await resend.emails.send({
      from: sender,
      to: email,
      subject: `How did we do on order ${orderName}?`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; text-align: center;">
          <h2>Hey ${customerName},</h2>
          <p>Your order <strong>${orderName}</strong> from <strong>${shopName}</strong> was recently delivered!</p>
          <p>We'd love to hear your thoughts. Could you take a moment to leave a review?</p>
          
          <div style="border: 1px solid #ddd; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: left; display: flex; align-items: center; gap: 15px;">
            ${
              product.image
                ? `<img src="${product.image}" alt="${product.name}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 6px;" />`
                : `<div style="width: 80px; height: 80px; background-color: #f0f0f0; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 11px; text-align: center;">No Image Available</div>`
            }
            <div>
              <h3 style="margin: 0 0 5px 0; font-size: 16px;">${product.name}</h3>
            </div>
          </div>

          <a href="#" style="background: black; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
            Write a Review
          </a>
        </div>
      `,
    });

    return { success: true, data };
  } catch (error) {
    console.error("[Resend Error]:", error);
    return { success: false, error: error.message };
  }
}