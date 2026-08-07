export function Journey({ orderData, mini = false }) {
  const parseD = (d) => (d ? new Date(d) : null);
  const now = new Date();

  // Extract dates directly from payload
  const ordered = parseD(orderData.order?.createdAt) || parseD(orderData.createdAt) || now;
  const fulfilled = parseD(orderData.order?.fulfilledAt) || parseD(orderData.fulfilledAt);
  const delivered = parseD(orderData.order?.deliveredAt) || parseD(orderData.deliveredAt);
  const askT = parseD(orderData.sendAt);

  // Build timeline nodes in logical sequence
  const nodes = [];
  nodes.push({ t: ordered, lb: "Ordered", on: 1 });

  if (fulfilled) {
    nodes.push({ t: fulfilled, lb: "Shipped", on: fulfilled <= now ? 1 : 0 });
  }

  let delT = delivered;
  let delLb = "Delivered";
  let fail = 0;

  if (!delivered) {
    if (orderData.state === "WAITING") {
      delT = parseD(orderData.eta) || new Date(ordered.getTime() + 86400000 * 2);
      delLb = "Due to land";
    } else if (orderData.state === "SUPPRESSED") {
      fail = 1;
      delLb = "Stopped";
    }
  }

  if (delT || fail) {
    nodes.push({ t: delT || now, lb: delLb, on: delivered ? 1 : 0, fail });
  }

  if (askT) {
    nodes.push({
      t: askT,
      lb: orderData.state === "SENT" ? "Asked" : "Ask",
      ask: 1,
      on: orderData.state === "SENT" ? 1 : 0,
    });
  }

  // Equal step-based placement (prevents visual overflow)
  const maxIdx = Math.max(nodes.length - 1, 1);
  nodes.forEach((n, i) => {
    n.pos = 8 + (i / maxIdx) * 84;
  });

  // Calculate progress bar widths
  const lastOnNode = [...nodes].reverse().find((n) => n.on);
  const doneEnd = lastOnNode ? lastOnNode.pos : 8;

  let waitStart = 0;
  let waitEnd = 0;
  // AFTER (Fix: striped track only shows while actively waiting)
  if (delT && askT && orderData.state !== "SUPPRESSED" && orderData.state !== "SENT") {
    const dNode = nodes.find((n) => n.lb === "Delivered" || n.lb === "Due to land");
    const aNode = nodes.find((n) => n.ask);
    if (dNode && aNode) {
      waitStart = dNode.pos;
      waitEnd = aNode.pos;
    }
  }

  const showNow = now >= nodes[0].t && now <= nodes[nodes.length - 1].t;

  return (
    <div
      className={`Jn ${mini ? "Jn--mini" : ""}`}
      style={{
        position: "relative",
        width: "100%",
        overflow: "hidden",
        boxSizing: "border-box",
        padding: mini ? "12px 0" : "24px 0",
      }}
    >
      <div className="Jn__rail"></div>

      {/* Solid Progress Line */}
      <div
        className="Jn__done"
        style={{ width: `${doneEnd}%`, transition: "width 0.3s ease-in-out" }}
      ></div>

      {/* Striped Delay/Wait Track */}
      {waitStart > 0 && (
        <div
          className="Jn__wait"
          style={{
            left: `${waitStart}%`,
            width: `${waitEnd - waitStart}%`,
          }}
        />
      )}

      {/* Current Time Dot */}
      {showNow && (
        <>
          <div className="Jn__now" style={{ left: `${doneEnd}%` }}></div>
          {!mini && <div className="Jn__nowl" style={{ left: `${doneEnd}%` }}>now</div>}
        </>
      )}

      {/* Timeline Steps */}
      {nodes.map((n, i) => (
        <div
          key={i}
          className="Jn__n"
          style={{ left: `${n.pos}%` }}
          data-on={n.on}
          data-ask={n.ask || 0}
          data-fail={n.fail || 0}
        >
          <div className="Jn__dot"></div>
          {!mini && (
            <>
              <div className="Jn__lb">{n.lb}</div>
              <div className="Jn__dt">
                {n.t.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}