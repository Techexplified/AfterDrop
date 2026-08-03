export function Journey({ orderData, mini = false }) {
  // Safe date parsing
  const parseD = (d) => (d ? new Date(d) : null);
  const now = new Date();
  
  const ordered = parseD(orderData.order.createdAt); // Fallback to createdAt
  const fulfilled = parseD(orderData.order.fulfilledAt);
  const delivered = parseD(orderData.order.deliveredAt);
  const askT = parseD(orderData.sendAt);
  
  // Build nodes based on status
  const nodes = [];
  nodes.push({ t: ordered || new Date(), lb: "Ordered", on: 1 });
  if (fulfilled) nodes.push({ t: fulfilled, lb: "Shipped", on: fulfilled <= now ? 1 : 0 });
  
  let delT = delivered, delLb = "Delivered", fail = 0;
  if (!delivered) {
    if (orderData.state === "WAITING") {
      delT = parseD(orderData.eta) || new Date(now.getTime() + 86400000 * 3);
      delLb = "Due to land";
    } else if (orderData.state === "SUPPRESSED") {
      fail = 1;
      delLb = "Stopped";
    }
  }
  if (delT || fail) nodes.push({ t: delT || now, lb: delLb, on: delivered ? 1 : 0, fail });

  if (askT) nodes.push({ t: askT, lb: orderData.state === "SENT" ? "Asked" : "Ask", ask: 1, on: orderData.state === "SENT" ? 1 : 0 });

  // Calculate positions
  const t0 = nodes[0].t.getTime();
  const t1 = nodes[nodes.length - 1].t.getTime();
  const span = Math.max(t1 - t0, 1);
  const pos = (t) => 6 + ((t.getTime() - t0) / span) * 88;

  const nowP = Math.min(100, Math.max(0, pos(now)));
  const doneEnd = Math.min(nowP, pos(nodes[nodes.length - 1].t));

  const waitStart = delT ? pos(delT) : 0;
  const waitEnd = askT ? pos(askT) : 0;

  return (
    <div className={`Jn ${mini ? "Jn--mini" : ""}`}>
      <div className="Jn__rail"></div>
      <div className="Jn__done" style={{ width: `${doneEnd}%` }}></div>
      
      {delT && askT && orderData.state !== "SUPPRESSED" && (
        <div className="Jn__wait" style={{ left: `${waitStart}%`, width: `${Math.max(0, waitEnd - waitStart)}%` }}></div>
      )}
      
      {now >= nodes[0].t && now <= nodes[nodes.length - 1].t && (
        <>
          <div className="Jn__now" style={{ left: `${nowP}%` }}></div>
          {!mini && <div className="Jn__nowl" style={{ left: `${nowP}%` }}>now</div>}
        </>
      )}

      {nodes.map((n, i) => {
        const left = pos(n.t);
        return (
          <div key={i} className="Jn__n" style={{ left: `${left}%` }} data-on={n.on} data-ask={n.ask || 0} data-fail={n.fail || 0}>
            <div className="Jn__dot"></div>
            {!mini && (
              <>
                <div className="Jn__lb">{n.lb}</div>
                <div className="Jn__dt">{n.t.toLocaleDateString("en-GB", { day: 'numeric', month: 'short' })}</div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}