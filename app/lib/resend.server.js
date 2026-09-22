import { Resend } from "resend";
import { resolveTargetUrl, TEMPLATES } from "./template-defaults";

const resend = new Resend(process.env.RESEND_API_KEY);

const SENDER_DOMAIN = process.env.RESEND_DOMAIN || "shopify.explified.com";

/**
 * Returns a meaningful sender email address based on template type.
 * Can be overridden globally via RESEND_FROM_EMAIL env variable.
 * - review -> reviews@shopify.explified.com
 * - other templates -> notifications@shopify.explified.com
 */
export function getSenderEmail(templateId) {
  if (process.env.RESEND_FROM_EMAIL) {
    return process.env.RESEND_FROM_EMAIL;
  }
  if (templateId === "review") {
    return `reviews@${SENDER_DOMAIN}`;
  }
  return `notifications@${SENDER_DOMAIN}`;
}

function fillTokens(text, { customerName, orderName, productName, agoText }) {
  if (!text) return "";
  const first = customerName ? customerName.split(" ")[0] : "there";
  return text
    .replace(/\{first\}/g, first)
    .replace(/\{product\}/g, productName || "your purchase")
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
    const isCrossSell = templateId === "crossSell";

    if (isReview && reviewToken && appUrl) {
      targetUrl = `${appUrl}/review/${reviewToken}?rating=5`;
    }

    let finalShopName = shopName;
    if ((!finalShopName || finalShopName === "AfterDrop") && shop) {
      try {
        const { default: db } = await import("../db.server");
        const settings = await db.shopSettings.findUnique({
          where: { shop },
          select: { storeName: true },
        });
        if (settings?.storeName) {
          finalShopName = settings.storeName;
        }
      } catch (e) {}
    }

    const fromEmail = getSenderEmail(templateId);
    const sender = `${finalShopName || "AfterDrop"} <${fromEmail}>`;

    const html = `
      <div style="font-family: -apple-system, sans-serif; padding: 20px; max-width: 580px; margin: 0 auto; text-align: center; color: #303030;">
        <div style="font-size: 13px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 20px;">
          ${finalShopName || "AfterDrop"}
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

        ${!isCrossSell ? `
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%; border: 1px solid #E5E6E9; border-radius: 8px; margin: 20px 0; background: #FFFFFF; text-align: left;">
          <tr>
            <td style="width: 60px; padding: 12px 0 12px 12px; vertical-align: middle;">
              ${product?.image
                ? `<img src="${product.image}" alt="${product.name || 'Order Item'}" width="56" height="56" style="width: 56px; height: 56px; object-fit: cover; border-radius: 6px; display: block; border: 1px solid #ECEEF1;" />`
                : `<div style="width: 56px; height: 56px; background: #F0F1F3; border-radius: 6px; text-align: center; line-height: 56px; font-size: 20px;">📦</div>`
              }
            </td>
            <td style="padding: 12px 12px 12px 14px; vertical-align: middle;">
              <strong style="display: block; font-size: 14px; color: #0A0A0A; line-height: 1.3;">${product?.name || "Order Item"}</strong>
              <span style="display: block; font-size: 12px; color: #8C9098; margin-top: 3px;">Order ${orderName}${product?.extraItemCount ? ` · +${product.extraItemCount} other item${product.extraItemCount > 1 ? 's' : ''}` : ''}</span>
            </td>
          </tr>
        </table>` : ""}

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
          <p style="margin: 0 0 4px 0;">Sent by ${finalShopName || "your store"}</p>
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

export async function sendTestRequest({ email, shopName, shop }) {
  if (!email) return { success: false, error: "No test email provided" };

  try {
    let finalShopName = shopName;
    if ((!finalShopName || finalShopName === "AfterDrop") && shop) {
      try {
        const { default: db } = await import("../db.server");
        const settings = await db.shopSettings.findUnique({
          where: { shop },
          select: { storeName: true },
        });
        if (settings?.storeName) {
          finalShopName = settings.storeName;
        }
      } catch (e) {}
    }

    const testSenderEmail = process.env.RESEND_TEST_FROM_EMAIL || `test@${SENDER_DOMAIN}`;
    const data = await resend.emails.send({
      from: `${finalShopName || "AfterDrop"} (Test) <${testSenderEmail}>`,
      to: email,
      subject: "AfterDrop test email",
      html: `
        <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; text-align: center;">
          <h2>This is a test email 👋</h2>
          <p>Your AfterDrop review request emails will look like this — sent from <strong>${finalShopName || "your store"}</strong>.</p>
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