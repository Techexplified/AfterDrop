import { useState } from "react";
import { useLoaderData, useFetcher, data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { TEMPLATES } from "../lib/template-defaults";
import { CustomizeModal } from "../components/template/customize";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let [templateSettings, shopSettings] = await Promise.all([
    db.templateSettings.findUnique({ where: { shop } }),
    db.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!templateSettings) {
    templateSettings = await db.templateSettings.create({ data: { shop } });
  }

  const cleanShopName = shopSettings?.storeName || shop
    .replace(".myshopify.com", "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());

  const customConfigs = templateSettings.customConfigs ? 
    (typeof templateSettings.customConfigs === 'string' ? JSON.parse(templateSettings.customConfigs) : templateSettings.customConfigs) 
    : {};

  const activeTemplateList = Object.keys(TEMPLATES).map((key) => {
    const base = TEMPLATES[key];
    const isEnabled = templateSettings.enabledTemplates.includes(key) || base.core;
    const customConfig = customConfigs[key] || {};

    return {
      ...base,
      enabled: isEnabled,
      config: { ...base.config, ...customConfig },
    };
  });

  return data({ templates: activeTemplateList, shop, shopName: cleanShopName });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  const templateSettings = await db.templateSettings.findUnique({ where: { shop } });
  if (!templateSettings) return data({ error: "Not found" }, { status: 404 });

  // --- 1. TOGGLE ENABLE / DISABLE ---
  if (intent === "toggle-status") {
    const templateId = formData.get("templateId");
    const enable = formData.get("enable") === "true";
    
    // Safety check: don't let them disable the core review template
    if (templateId === "review" && !enable) return data({ ok: true });

    let updatedEnabled = [...templateSettings.enabledTemplates];
    if (enable && !updatedEnabled.includes(templateId)) {
      updatedEnabled.push(templateId);
    } else if (!enable) {
      updatedEnabled = updatedEnabled.filter(id => id !== templateId);
    }

    await db.templateSettings.update({
      where: { shop },
      data: { enabledTemplates: updatedEnabled }
    });
    return data({ ok: true });
  }

  // --- 2. SAVE CONFIG CUSTOMIZATIONS ---
  if (intent === "save-config") {
    const templateId = formData.get("templateId");
    const newConfig = JSON.parse(formData.get("config"));

    const currentConfigs = templateSettings.customConfigs ? 
      (typeof templateSettings.customConfigs === 'string' ? JSON.parse(templateSettings.customConfigs) : templateSettings.customConfigs) 
      : {};

    const updatedConfigs = {
      ...currentConfigs,
      [templateId]: newConfig
    };

    await db.templateSettings.update({
      where: { shop },
      data: { customConfigs: updatedConfigs }
    });
    return data({ ok: true });
  }

  return data({ error: "Invalid intent" }, { status: 400 });
}

export default function TemplatesPage() {
  const { templates, shop , shopName } = useLoaderData();
  const fetcher = useFetcher();
  const [editingTemplate, setEditingTemplate] = useState(null);

  const handleToggle = (templateId, currentStatus) => {
    fetcher.submit(
      { intent: "toggle-status", templateId, enable: !currentStatus },
      { method: "post" }
    );
  };

  const activeCount = templates.filter(t => t.enabled).length;

  return (
    <>
      <div style={{ padding: "32px", maxWidth: "1000px", margin: "0 auto" }}>
        <header className="pagehead">
          <h1 className="t-xl">Email Templates</h1>
          <p className="pagehead__sub">
            {activeCount} of {templates.length} active. Turn templates on or off, and customize exactly what they say.
          </p>
        </header>

        <div className="TplGrid">
          {templates.map((tpl) => (
            <div key={tpl.id} className={`TplCard ${tpl.enabled ? "is-active" : ""}`}>
              <div className="TplCard__head">
                <div>
                  <h3 className="TplCard__title">
                    {tpl.name}
                    {tpl.core && <span className="TplCard__core">Core</span>}
                  </h3>
                  <span className="TplCard__trigger mono">
                    {tpl.triggerPrefix}{tpl.config.waitDays}d
                  </span>
                </div>
                
                {/* Custom Toggle Switch */}
                <button
                  className={`sw ${tpl.enabled ? "on" : ""} ${tpl.core ? "disabled" : ""}`}
                  role="switch"
                  aria-checked={tpl.enabled}
                  disabled={tpl.core || fetcher.state !== "idle"}
                  onClick={() => handleToggle(tpl.id, tpl.enabled)}
                />
              </div>

              <div className="TplCard__foot">
                <button className="Btn Btn--sm" onClick={() => setEditingTemplate(tpl)}>
                  Customize email
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

{editingTemplate && (
  <CustomizeModal 
    template={editingTemplate} 
    shopName={shopName}
    shopDomain={shop}
    onClose={() => setEditingTemplate(null)} 
  />
)}

      {/* STYLES */}
      <style dangerouslySetInnerHTML={{ __html: `
        :root{
          --surface:#FFFFFF;--surface-sub:#F7F7F7;--border:#E3E3E3;
          --text:#303030;--text-sub:#616161;--icon:#4A4A4A;
          --ink:#3B2E63;--ink-tint:#F4F2FC;
          --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
          --r1:6px;--r2:8px;--r3:12px;
          --sh-card:0 1px 0 0 rgba(26,26,26,.07);
          --sh-pop:0 8px 24px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.06);
        }
        body, button, input, textarea { font-family: -apple-system, sans-serif; }
        
        .pagehead{margin-bottom:24px}
        .t-xl{font-size:28px;line-height:24px;font-weight:700;margin:0 0 8px 0;letter-spacing:-.01em}
        .pagehead__sub{color:var(--text-sub);font-size:15px;margin:0;max-width:66ch}
        .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}

        /* GRID & CARDS */
        .TplGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
        .TplCard { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r3); display: flex; flex-direction: column; transition: border-color 0.15s; }
        .TplCard:hover { border-color: #A0A0A0; }
        .TplCard:not(.is-active) { opacity: 0.65; background: #FAFAFA; }
        .TplCard__head { padding: 20px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex: 1; }
        .TplCard__title { margin: 0 0 6px 0; font-size: 15px; font-weight: 650; display:flex; align-items:center; gap:8px;}
        .TplCard__core { font-size: 11px; background: var(--surface-sub); border: 1px solid var(--border); padding: 2px 6px; border-radius: 4px; font-weight: 500; color: var(--text-sub); letter-spacing: 0.04em; text-transform: uppercase; }
        .TplCard__trigger { font-size: 12px; color: var(--text-sub); background: #F0F0F0; padding: 3px 6px; border-radius: 4px; }
        .TplCard__foot { padding: 12px 20px; border-top: 1px solid var(--border); background: var(--surface-sub); border-radius: 0 0 var(--r3) var(--r3); }

        /* TOGGLE SWITCH */
        .sw{position:relative;width:36px;height:20px;border-radius:99px;background:#B9BCC2;border:0;flex:0 0 auto;transition:background .12s;cursor:pointer;}
        .sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .12s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
        .sw.on{background:var(--text)}
        .sw.on::after{left:18px}
        .sw.disabled{opacity: 0.5; cursor: not-allowed;}

        /* BUTTONS */
        .Btn{height:32px;padding:0 14px;border:0;border-radius:var(--r2);background:var(--text);color:#fff;font-size:13px;font-weight:600;display:inline-flex;align-items:center;cursor:pointer;white-space:nowrap;}
        .Btn:hover{opacity:0.9}
        .Btn--line{background:var(--surface);color:var(--text);box-shadow:0 0 0 1px var(--border) inset;}
        .Btn--line:hover{background:var(--surface-sub)}
        .Btn--sm{height:28px;padding:0 12px;font-size:12px;}

        /* MODAL (Left Form, Right Preview) */
        .Backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:90;display:grid;place-items:center;padding:24px;}
        .Modal{background:var(--surface);border-radius:var(--r3);width:100%;box-shadow:var(--sh-pop);display:flex;flex-direction:column;max-height: 90vh;}
        .Modal--large{max-width: 900px;}
        .Modal__h{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--border)}
        .Modal__h h3{margin:0;font-size:16px;font-weight:650}
        .Modal__x{background:none;border:0;font-size:24px;cursor:pointer;color:var(--text-sub)}
        .Modal__split{display:flex;flex:1;overflow:hidden;min-height:400px;}
        .Modal__form{flex:1;padding:24px;overflow-y:auto;border-right:1px solid var(--border)}
        .Modal__preview{flex:1;padding:24px;background:#F4F4F5;overflow-y:auto;display:flex;justify-content:center;}
        .Modal__f{padding:16px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:12px;background:var(--surface-sub);border-radius:0 0 var(--r3) var(--r3)}

        /* FORM INPUTS */
        .field{margin-bottom:20px}
        .field label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
        .hint{font-size:12px;color:var(--text-sub);margin:6px 0 0 0;}
        .txt{width:100%;border:1px solid var(--border);border-radius:var(--r1);padding:8px 12px;font-size:13px;font-family:inherit;box-sizing:border-box;}
        .txt:focus{outline:none;border-color:var(--text)}
        
        /* INBOX MOCK (Right Side) */
        .mail{width:100%;max-width:400px;background:#fff;border-radius:var(--r2);box-shadow:0 1px 3px rgba(0,0,0,.09);height:fit-content;overflow:hidden}
        .mail-meta{padding:16px;border-bottom:1px solid var(--border)}
        .mail-subject{font-size:15px;font-weight:650;margin:0 0 12px;letter-spacing:-.01em}
        .mail-from{display:flex;align-items:center;gap:10px}
        .avatar{width:32px;height:32px;border-radius:50%;background:var(--text);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:600;flex:0 0 auto}
        .mail-from-t{flex:1;min-width:0;font-size:13px;line-height:1.4;}
        .mail-from-t b{font-weight:600;display:block}
        .mail-from-t span{color:var(--text-sub);display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        
        /* EMAIL CONTENT */
        .email-inner{padding:24px 20px;text-align:center}
        .brandmark{font-size:13px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;margin-bottom:20px}
        .email-inner h2{font-size:18px;font-weight:650;letter-spacing:-.02em;margin:0 0 8px}
        .body{margin:0 0 20px;color:#5A5D63;font-size:14px;line-height:1.6}
        .prodcard{display:flex;gap:12px;align-items:center;text-align:left;border:1px solid var(--border);border-radius:var(--r1);padding:10px;margin-bottom:20px}
        .prodimg{width:48px;height:48px;border-radius:4px;flex:0 0 auto;background:#F0F0F0}
        .prodinfo b{display:block;font-size:13px;font-weight:600}
        .prodinfo span{font-size:12px;color:var(--text-sub)}
        .stars{margin-bottom: 20px;}
        .emailcta{display:inline-block;background:#000;color:#fff;border:0;border-radius:4px;padding:12px 24px;font-size:13px;font-weight:600;}
      
        /* PROMO CODE BOX IN EMAIL PREVIEW */
.codebox {
  margin: 4px auto 8px;
  display: inline-block;
  border: 1.5px dashed var(--text);
  border-radius: var(--r1);
  padding: 8px 20px;
  font-family: var(--mono);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: .12em;
  background: #FAFAFA;
}
.codenote {
  font-size: 11.5px;
  color: var(--text-sub);
  margin: 0 0 12px;
}

/* MODAL SPLIT & LAYOUT */
.Backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 90; display: grid; place-items: center; padding: 24px; }
.Modal { background: var(--surface); border-radius: var(--r3); width: 100%; box-shadow: var(--sh-pop); display: flex; flex-direction: column; max-height: 90vh; }
.Modal--large { max-width: 920px; }
.Modal__h { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-bottom: 1px solid var(--border); }
.Modal__h h3 { margin: 0; font-size: 16px; font-weight: 650; }
.Modal__x { background: none; border: 0; font-size: 24px; cursor: pointer; color: var(--text-sub); }
.Modal__split { display: flex; flex: 1; overflow: hidden; min-height: 440px; }
.Modal__form { flex: 1.1; padding: 24px; overflow-y: auto; border-right: 1px solid var(--border); }
.Modal__preview { flex: 0.9; padding: 24px; background: #F4F4F5; overflow-y: auto; display: flex; justify-content: center; }
.Modal__f { padding: 16px 24px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 12px; background: var(--surface-sub); border-radius: 0 0 var(--r3) var(--r3); }

/* FORM FIELD HINTS & CODE */
.field code { font-family: var(--mono); background: #F0F0F0; padding: 2px 4px; border-radius: 3px; font-size: 11px; }
      `}} />
    </>
  );
}