import { Journey } from "./journey";

export function OrderModal({ data, onClose }) {
  if (!data) return null;

  const { order, state, reason, sendAt, estimated } = data;
  const initials = (order.customerName || "CU").substring(0, 2).toUpperCase();

  // Dynamic currency formatting (Defaults to USD if currency is not on order)
  const currencyCode = order.currency || "USD";
  const price = (order.totalPrice / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currencyCode,
  });

  return (
    <div className="Backdrop" onClick={onClose}>
      <div className="Modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "600px" }}>
        
        <div className="Modal__h">
          <h3>{order.name} · {order.customerName || "Customer"}</h3>
          <button className="Modal__x" onClick={onClose}>×</button>
        </div>

        <div className="Modal__b">
          <div className="Who" style={{ marginBottom: "12px" }}>
            <span className="Ava">{initials}</span>
            <div>
              <b>{order.customerName || "Customer"}</b>
            </div>
          </div>

          <div className="Inline" style={{ gap: "16px", marginBottom: "8px" }}>
            <span className="t-cap sub">Value <b className="t-sm mono" style={{ color: "var(--text)" }}>{price}</b></span>
            <span className="t-cap sub">Status <span className={`St St--${state.toLowerCase().substring(0,4)}`}>{state}</span></span>
          </div>

          <Journey orderData={data} />

          <h4 className="t-sm" style={{ margin: "20px 0 8px" }}>How this was decided</h4>
          <div className="Steps">
            {/* Step 1: Delivery */}
            <div className="Step">
              <span className="Step__n">1</span>
              <div className="Step__b">
                <p className="Step__t">Parcel landed</p>
                <p className="Step__d">{order.deliveredAt ? "Confirmed by carrier." : estimated ? "Assumed landing date." : "Not landed yet."}</p>
              </div>
              <div className="Step__v">
                {order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString() : "—"}
              </div>
            </div>

            {/* Step 2: Reason / Status */}
            <div className={`Step ${state === "SUPPRESSED" ? "Step--stop" : state === "SENT" ? "Step--final" : ""}`}>
              <span className="Step__n">{state === "SUPPRESSED" ? "✕" : state === "SENT" ? "✓" : "→"}</span>
              <div className="Step__b">
                <p className="Step__t">{state === "SUPPRESSED" ? "Not asked" : state === "WAITING" ? "Waiting on carrier" : "The Ask"}</p>
                <p className="Step__d">{reason || (sendAt ? "Ready to send" : "Pending")}</p>
              </div>
              <div className="Step__v">
                {sendAt ? new Date(sendAt).toLocaleDateString() : "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="Modal__f">
          <button className="Btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}