import { useLoaderData, useFetcher } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await db.suppressionSettings.upsert({
    where: { shop: shop },
    update: {},
    create: { shop: shop },
  });

  return { settings };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const payload = {
    refundedCancelled: form.get("refundedCancelled") === "on",
    deliveryFailed: form.get("deliveryFailed") === "on",
    openSupportTicket: form.get("openSupportTicket") === "on",
    unsubscribed: form.get("unsubscribed") === "on",
    alreadyReviewed: form.get("alreadyReviewed") === "on",
    cooldownEnabled: form.get("cooldownEnabled") === "on",
    cooldownDays: Number(form.get("cooldownDays")),
    excludedTags: form.get("excludedTags").split(",").map(t => t.trim()).filter(Boolean),
    excludedProductTypes: form.get("excludedProductTypes").split(",").map(t => t.trim()).filter(Boolean),
  };

  await db.suppressionSettings.update({
    where: { shop: session.shop },
    data: payload,
  });

  return { ok: true };
}

export default function RulesSettings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const saving = fetcher.state === "submitting";

  // Suppression States
  const [refundedCancelled, setRefundedCancelled] = useState(settings.refundedCancelled ?? true);
  const [deliveryFailed, setDeliveryFailed] = useState(settings.deliveryFailed ?? true);
  const [openSupportTicket, setOpenSupportTicket] = useState(settings.openSupportTicket ?? false);
  const [unsubscribed, setUnsubscribed] = useState(settings.unsubscribed ?? true);
  const [alreadyReviewed, setAlreadyReviewed] = useState(settings.alreadyReviewed ?? false);
  const [cooldownEnabled, setCooldownEnabled] = useState(settings.cooldownEnabled ?? true);
  const [cooldownDays, setCooldownDays] = useState(settings.cooldownDays ?? 30);

  // Exclusion States
  const [tags, setTags] = useState(settings.excludedTags ?? []);
  const [tagInput, setTagInput] = useState("");

  const [types, setTypes] = useState(settings.excludedProductTypes ?? []);
  const [typeInput, setTypeInput] = useState("");

  // Helpers for tags/types
  const handleAdd = (e, input, setInput, list, setList) => {
    e.preventDefault();
    const val = input.trim();
    if (val && !list.includes(val)) {
      setList([...list, val]);
    }
    setInput("");
  };

  const handleRemove = (itemToRemove, list, setList) => {
    setList(list.filter(item => item !== itemToRemove));
  };

  return (
    <div className="afterdrop-ui" style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 className="t-xl">Rules</h1>
        <p className="sub">Set conditions to automatically skip review requests for specific orders, customers, or items.</p>
      </div>

      <fetcher.Form method="post">
        
        {/* --- SUPPRESSIONS CARD --- */}
        <div className="Card" style={{ padding: 0 }}>
          
          <div className="ListRow">
            <div className="ListRow__text">
              <h4>Order was refunded or cancelled</h4>
              <p>Asking someone to review a purchase you just refunded reads as a taunt.</p>
            </div>
            <button type="button" className="Switch" aria-pressed={refundedCancelled} onClick={() => setRefundedCancelled(!refundedCancelled)} />
            <input type="hidden" name="refundedCancelled" value={refundedCancelled ? "on" : ""} />
          </div>

          <div className="ListRow">
            <div className="ListRow__text">
              <h4>Delivery failed or came back</h4>
              <p>The carrier couldn't deliver, or the parcel returned to sender. There is nothing to review.</p>
            </div>
            <button type="button" className="Switch" aria-pressed={deliveryFailed} onClick={() => setDeliveryFailed(!deliveryFailed)} />
            <input type="hidden" name="deliveryFailed" value={deliveryFailed ? "on" : ""} />
          </div>

          {/* <div className="ListRow">
            <div className="ListRow__text">
              <h4>There's an open support ticket</h4>
              <p>If they're already talking to you about a problem, a review request lands badly.</p>
            </div>
            <button type="button" className="Switch" aria-pressed={openSupportTicket} onClick={() => setOpenSupportTicket(!openSupportTicket)} />
            <input type="hidden" name="openSupportTicket" value={openSupportTicket ? "on" : ""} />
          </div> */}

          <div className="ListRow">
            <div className="ListRow__text">
              <h4>Customer unsubscribed</h4>
              <p>Marketing consent is withdrawn. Never overridden, whatever else is switched on.</p>
            </div>
            <button type="button" className="Switch" aria-pressed={unsubscribed} onClick={() => setUnsubscribed(!unsubscribed)} />
            <input type="hidden" name="unsubscribed" value={unsubscribed ? "on" : ""} />
          </div>

          {/* <div className="ListRow">
            <div className="ListRow__text">
              <h4>They already reviewed this product</h4>
              <p>Checked against your review app before every send.</p>
            </div>
            <button type="button" className="Switch" aria-pressed={alreadyReviewed} onClick={() => setAlreadyReviewed(!alreadyReviewed)} />
            <input type="hidden" name="alreadyReviewed" value={alreadyReviewed ? "on" : ""} />
          </div> */}

          <div className="ListRow" style={{ borderBottom: "none" }}>
            <div className="ListRow__text">
              <h4>They were asked recently</h4>
              <p>A quiet period between requests to the same customer, however many orders they place.</p>
              
              <div className="Inline" style={{ marginTop: 12, opacity: cooldownEnabled ? 1 : 0.4, pointerEvents: cooldownEnabled ? "auto" : "none" }}>
                <span className="sub">Quiet for</span>
                <input 
                  type="number" 
                  name="cooldownDays" 
                  className="Input" 
                  style={{ width: 60, textAlign: 'center' }} 
                  value={cooldownDays}
                  onChange={(e) => setCooldownDays(Math.max(1, Number(e.target.value)))}
                />
                <span className="sub">days after any request</span>
              </div>
            </div>
            <button type="button" className="Switch" aria-pressed={cooldownEnabled} onClick={() => setCooldownEnabled(!cooldownEnabled)} />
            <input type="hidden" name="cooldownEnabled" value={cooldownEnabled ? "on" : ""} />
          </div>
        </div>

        <h3 className="t-xl" style={{ marginTop: 32, marginBottom: 8, fontSize: 18 }}>Exclusions</h3>
        <p className="sub" style={{ marginBottom: 16 }}>Products and customers that should never be asked, whatever the timing says.</p>

        {/* --- EXCLUSIONS GRID --- */}
        <div className="Grid2">
          
          {/* Customer Tags */}
          <div className="Card">
            <div className="Card__head"><h4 className="t-sm">Customer tags</h4></div>
            
            <div className="Chips">
              {tags.map(tag => (
                <span key={tag} className="Chip">
                  {tag} <button type="button" onClick={() => handleRemove(tag, tags, setTags)}>×</button>
                </span>
              ))}
            </div>

            <div className="Inline" style={{ marginTop: 12 }}>
              <input 
                className="Input" 
                placeholder="wholesale" 
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd(e, tagInput, setTagInput, tags, setTags)}
              />
              <button type="button" className="Btn-Sec" onClick={(e) => handleAdd(e, tagInput, setTagInput, tags, setTags)}>Add</button>
            </div>
            <p className="Field__help">Trade and wholesale buyers rarely leave product reviews, and asking them looks careless.</p>
            <input type="hidden" name="excludedTags" value={tags.join(",")} />
          </div>

          {/* Product Types */}
          <div className="Card">
            <div className="Card__head"><h4 className="t-sm">Product types</h4></div>
            
            <div className="Chips">
              {types.map(type => (
                <span key={type} className="Chip">
                  {type} <button type="button" onClick={() => handleRemove(type, types, setTypes)}>×</button>
                </span>
              ))}
            </div>

            <div className="Inline" style={{ marginTop: 12 }}>
              <input 
                className="Input" 
                placeholder="Digital" 
                value={typeInput}
                onChange={(e) => setTypeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd(e, typeInput, setTypeInput, types, setTypes)}
              />
              <button type="button" className="Btn-Sec" onClick={(e) => handleAdd(e, typeInput, setTypeInput, types, setTypes)}>Add</button>
            </div>
            <p className="Field__help">Gift cards and downloads have no delivery to wait for.</p>
            <input type="hidden" name="excludedProductTypes" value={types.join(",")} />
          </div>

        </div>

        <div className="BtnRow">
          <button type="submit" className="Btn-Pri" disabled={saving}>
            {saving ? "Saving..." : "Save Rules"}
          </button>
        </div>

      </fetcher.Form>

      {/* Styles */}
      <style>{`
        .afterdrop-ui {
          --surface: #FFFFFF; --surface-sub: #F7F7F7; --surface-hover: #F1F1F1;
          --border: #E3E3E3; --border-sub: #EBEBEB; --border-strong: #CDCDCD;
          --text: #303030; --text-sub: #616161; 
          --r2: 8px; --r3: 12px;
          --sh-card: 0 1px 0 0 rgba(26,26,26,.07);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          color: var(--text); font-size: 13px; line-height: 20px;
        }
        
        .t-xl { font-size: 20px; font-weight: 700; line-height: 24px; margin: 0; }
        .t-sm { font-size: 13px; font-weight: 600; margin: 0; }
        .sub { color: var(--text-sub); margin: 4px 0 0 0; }

        .Grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
        .Card { background: var(--surface); border-radius: var(--r3); box-shadow: var(--sh-card); border: 1px solid var(--border-sub); padding: 16px; }
        .Card__head { margin-bottom: 12px; }
        
        .ListRow { display: flex; gap: 16px; align-items: flex-start; padding: 16px; border-bottom: 1px solid var(--border-sub); }
        .ListRow__text { flex: 1; }
        .ListRow__text h4 { font-size: 13px; font-weight: 600; margin: 0; }
        .ListRow__text p { font-size: 12px; color: var(--text-sub); margin: 2px 0 0 0; }
        
        .Switch { flex: 0 0 auto; width: 38px; height: 22px; border-radius: 11px; background: #B5B5B5; border: 0; padding: 0; position: relative; cursor: pointer; transition: background .14s; }
        .Switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .14s; box-shadow: 0 1px 2px rgba(0,0,0,.24); }
        .Switch[aria-pressed="true"] { background: #303030; }
        .Switch[aria-pressed="true"]::after { transform: translateX(16px); }

        .Inline { display: flex; align-items: center; gap: 8px; }
        .Input { flex: 1; height: 32px; border: 1px solid var(--border-strong); border-radius: var(--r2); padding: 0 12px; font-size: 13px; }
        .Field__help { font-size: 12px; color: var(--text-sub); margin-top: 8px; line-height: 16px; }

        .Chips { display: flex; flex-wrap: wrap; gap: 6px; min-height: 32px; padding: 4px; border: 1px solid var(--border-strong); border-radius: var(--r2); background: var(--surface); }
        .Chip { display: inline-flex; align-items: center; gap: 4px; background: var(--surface-sub); border: 1px solid var(--border-sub); border-radius: 4px; padding: 2px 6px 2px 8px; font-size: 12px; font-weight: 500; }
        .Chip button { background: none; border: 0; padding: 0 4px; font-size: 14px; cursor: pointer; color: var(--text-sub); }
        .Chip button:hover { color: var(--text); }

        .BtnRow { display: flex; margin-top: 24px; }
        .Btn-Pri { height: 32px; padding: 0 16px; border: 0; border-radius: var(--r2); background: #303030; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
        .Btn-Pri:hover { background: #1A1A1A; }
        .Btn-Sec { height: 32px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: var(--r2); background: var(--surface); color: var(--text); font-size: 13px; font-weight: 600; cursor: pointer; }
        .Btn-Sec:hover { background: var(--surface-hover); }
      `}</style>
    </div>
  );
}