import { useState } from "react";
import { useFetcher } from "react-router";
import { resolveTargetUrl } from "../../lib/template-defaults";

function fillTokens(text, first = "Priya", storeName = "Your Store") {
  if (!text) return "";
  return text
    .replace(/\{first\}/g, first)
    .replace(/\{product\}/g, "Heavy Cotton Crew Tee")
    .replace(/\{order\}/g, "#1092")
    .replace(/\{ago\}/g, "4 days ago");
}

export function CustomizeModal({ template, shopName, shopDomain, onClose }) {
  const fetcher = useFetcher();
  const [config, setConfig] = useState(template.config);

  const realStoreName = shopName || "Your Store";
  const realDomain = shopDomain || "myshopify.com";

  const handleChange = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    fetcher.submit(
      {
        intent: "save-config",
        templateId: template.id,
        config: JSON.stringify(config),
      },
      { method: "post" }
    );
    onClose();
  };

  const isSaving = fetcher.state !== "idle";
  const isPromoTemplate = template.id === "winback" || template.id === "referral";
  const isReviewTemplate = template.id === "review";

  // Resolves against the merchant's real shop domain
  const resolvedButtonUrl = resolveTargetUrl(config.targetUrl, realDomain);

  return (
    <div className="Backdrop">
      <div className="Modal Modal--large">
        <div className="Modal__h">
          <h3>Customize: {template.name}</h3>
          <button className="Modal__x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="Modal__split">
          {/* LEFT: FORM INPUTS */}
          <div className="Modal__form">
            <div className="field">
              <label>Subject line</label>
              <input
                className="txt"
                value={config.subject || ""}
                onChange={(e) => handleChange("subject", e.target.value)}
              />
              <p className="hint">
                Tokens available: <code>{"{first}"}</code>, <code>{"{product}"}</code>,{" "}
                <code>{"{order}"}</code>, <code>{"{ago}"}</code>
              </p>
            </div>

            <div className="field">
              <label>Wait Days</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="mono" style={{ color: "var(--text-sub)" }}>
                  {template.triggerPrefix}
                </span>
                <input
                  className="txt"
                  type="number"
                  min="0"
                  style={{ width: "80px" }}
                  value={config.waitDays ?? 1}
                  onChange={(e) => handleChange("waitDays", Number(e.target.value))}
                />
                <span style={{ color: "var(--text-sub)", fontSize: "13px" }}>days</span>
              </div>
            </div>

            <div className="field">
              <label>Email Headline</label>
              <input
                className="txt"
                value={config.headline || ""}
                onChange={(e) => handleChange("headline", e.target.value)}
              />
            </div>

            <div className="field">
              <label>Body Copy</label>
              <textarea
                className="txt"
                rows={4}
                value={config.body || ""}
                onChange={(e) => handleChange("body", e.target.value)}
              />
            </div>

            {/* CONDITIONAL PROMO CODE FIELDS */}
            {isPromoTemplate && (
              <>
                <div className="field">
                  <label>Promo / Discount Code</label>
                  <input
                    className="txt mono"
                    placeholder="e.g. COMEBACK10 or {first}-SHARES-10"
                    value={config.promoCode || ""}
                    onChange={(e) => handleChange("promoCode", e.target.value)}
                  />
                  <p className="hint">
                    Make sure this discount code is created in your Shopify Admin.
                  </p>
                </div>

                <div className="field">
                  <label>Promo Terms / Subtext</label>
                  <input
                    className="txt"
                    placeholder="e.g. 10% off · Valid 14 days"
                    value={config.promoNote || ""}
                    onChange={(e) => handleChange("promoNote", e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="field">
              <label>Button Text</label>
              <input
                className="txt"
                value={config.buttonText || ""}
                onChange={(e) => handleChange("buttonText", e.target.value)}
              />
            </div>

            {/* TARGET URL FOR STORE ROUTING */}
            {!isReviewTemplate && (
              <div className="field">
                <label>Button Link URL</label>
                <input
                  className="txt"
                  placeholder={`https://${realDomain}`}
                  value={config.targetUrl || ""}
                  onChange={(e) => handleChange("targetUrl", e.target.value)}
                />
                <p className="hint">
                  Currently routes to: <code>{resolvedButtonUrl}</code>
                </p>
              </div>
            )}
          </div>

          {/* RIGHT: LIVE PREVIEW */}
          <div className="Modal__preview">
            <div className="mail">
              <div className="mail-meta">
                <h4 className="mail-subject">{fillTokens(config.subject)}</h4>
                <div className="mail-from">
                  <span className="avatar">{realStoreName[0].toUpperCase()}</span>
                  <span className="mail-from-t">
                    <b>{realStoreName}</b>
                    <span>hello@{realDomain} → priya@example.in</span>
                  </span>
                </div>
              </div>

              <div className="email-inner">
                <div className="brandmark">{realStoreName}</div>
                <h2>{fillTokens(config.headline)}</h2>
                <p className="body">{fillTokens(config.body)}</p>

                {/* PROMO BOX IN PREVIEW */}
                {isPromoTemplate && config.promoCode && (
                  <div style={{ margin: "16px 0", textAlign: "center" }}>
                    <div className="codebox">{fillTokens(config.promoCode)}</div>
                    {config.promoNote && (
                      <p className="codenote">{fillTokens(config.promoNote)}</p>
                    )}
                  </div>
                )}

                <div className="prodcard">
                  <div className="prodimg"></div>
                  <div className="prodinfo">
                    <b>Heavy Cotton Crew Tee</b>
                    <span>Ash / M</span>
                  </div>
                </div>

                {isReviewTemplate && (
                  <div className="stars">
                    <span style={{ color: "#111", fontSize: "24px" }}>★ ★ ★ ★ ★</span>
                  </div>
                )}

                <a
                  href={resolvedButtonUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="emailcta"
                  title={`Click to test link: ${resolvedButtonUrl}`}
                >
                  {fillTokens(config.buttonText)}
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="Modal__f">
          <button className="Btn Btn--line" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button className="Btn" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}