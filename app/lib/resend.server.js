import { Resend } from "resend";
import { resolveTargetUrl, TEMPLATES } from "./template-defaults";

const resend = new Resend(process.env.RESEND_API_KEY);

function fillTokens(text, { customerName, orderName, productName, agoText }) {
  if (!text) return "";
  const first = customerName ? customerName.split(" ")[0] : "there";
  return text
    .replace(/\{first\}/g, first)
    .replace(/\{product\}/g, productName || "item")
    .replace(/\{order\}/g, orderName || "")
    .replace(/\{ago\}/g, agoText || "recently");
}

export async function sendTemplateEmail({
  to,
  shop,
  shopName,
  orderName,
  customerName,
  product,
  templateId,
  customConfig = {},
  reviewToken,
}) {
  try {
    const baseTpl = TEMPLATES[templateId] || TEMPLATES.review;
    const config = { ...baseTpl.config, ...customConfig };

    const subject = fillTokens(config.subject, { customerName, orderName, productName: product?.name });
    const headline = fillTokens(config.headline, { customerName, orderName, productName: product?.name });
    const body = fillTokens(config.body, { customerName, orderName, productName: product?.name });
    const buttonText = fillTokens(config.buttonText, { customerName, orderName, productName: product?.name });

    // Setup Base URL & Default Target
    const appUrl = process.env.SHOPIFY_APP_URL || "";
    let targetUrl = resolveTargetUrl(config.targetUrl, shop);

    const isReview = templateId === "review";
    const isPromo = templateId === "winback" || templateId === "referral";

    if (isReview && reviewToken && appUrl) {
      targetUrl = `${appUrl}/review/${reviewToken}?rating=5`;
    }

    const sender = `${shopName || "AfterDrop"} <onboarding@resend.dev>`;

    const html = `
      <div style="font-family: -apple-system, sans-serif; padding: 20px; max-width: 580px; margin: 0 auto; text-align: center; color: #303030;">
        <div style="font-size: 13px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 20px;">
          ${shopName}
        </div>
        <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 10px;">${headline}</h2>
        <p style="font-size: 14px; line-height: 1.6; color: #5A5D63; margin: 0 0 20px;">${body}</p>

        ${isPromo && config.promoCode
        ? `<div style="margin: 16px 0;">
                <div style="display: inline-block; border: 1.5px dashed #303030; border-radius: 6px; padding: 8px 20px; font-family: monospace; font-size: 16px; font-weight: 700; background: #FAFAFA;">
                  ${fillTokens(config.promoCode, { customerName })}
                </div>
                ${config.promoNote ? `<p style="font-size: 12px; color: #8C9098; margin: 6px 0 16px;">${fillTokens(config.promoNote, { customerName })}</p>` : ""}
              </div>`
        : ""
      }

        <div style="border: 1px solid #E5E6E9; padding: 12px; border-radius: 8px; margin: 20px 0; text-align: left; display: flex; align-items: center; gap: 12px;">
          ${product?.image
        ? `<img src="${product.image}" alt="${product.name}" style="width: 56px; height: 56px; object-fit: cover; border-radius: 6px;" />`
        : `<div style="width: 56px; height: 56px; background: #F0F1F3; border-radius: 6px;"></div>`
      }
          <div>
            <strong style="display: block; font-size: 14px; color: #0A0A0A;">${product?.name || "Order Item"}</strong>
            <span style="font-size: 12px; color: #8C9098;">Order ${orderName}</span>
          </div>
        </div>

        ${isReview
        ? `<div style="margin-bottom: 20px;">
                 ${[1, 2, 3, 4, 5]
          .map(
            (star) =>
              `<a href="${appUrl && reviewToken ? `${appUrl}/review/${reviewToken}?rating=${star}` : "#"
              }" style="font-size: 28px; color: #111; text-decoration: none; padding: 0 4px;">★</a>`
          )
          .join("")}
               </div>`
        : ""
      }

        <a href="${targetUrl}" style="background: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 13px;">
          ${buttonText}
        </a>

        <!-- UNSUBSCRIBE FOOTER -->
        <div style="margin-top: 32px; font-size: 11px; color: #8C9098; text-align: center;">
          <p style="margin: 0 0 4px 0;">Sent by ${shopName}</p>
          ${reviewToken && appUrl
        ? `<a href="${appUrl}/unsubscribe/${reviewToken}" style="color: #8C9098; text-decoration: underline;">Unsubscribe from emails</a>`
        : ""
      }
        </div>
      </div>
    `;

    const data = await resend.emails.send({
      from: sender,
      to,
      subject,
      html,
    });

    return { success: true, data };
  } catch (error) {
    console.error("[Resend Error]:", error);
    return { success: false, error: error.message };
  }
}

export async function sendTestRequest({ email, shopName }) {
  if (!email) return { success: false, error: "No test email provided" };

  try {
    const data = await resend.emails.send({
      from: `${shopName || "AfterDrop"} (Test) <test@resend.dev>`,
      to: email,
      subject: "AfterDrop test email",
      html: `
        <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; text-align: center;">
          <h2>This is a test email 👋</h2>
          <p>Your AfterDrop review request emails will look like this — sent from <strong>${shopName || "your store"}</strong>.</p>
          <p style="color:#888; font-size:13px;">No order data was used — this is a static preview, not tied to any customer or order.</p>
          <div style="border: 1px solid #ddd; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin:0 0 5px;font-size:16px;">Sample Product</h3>
          </div>
          <a href="#" style="background: black; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
            Write a Review
          </a>
        </div>
      `,
    });
    return { success: true, data };
  } catch (error) {
    console.error("[Resend Test Error]:", error);
    return { success: false, error: error.message };
  }
}