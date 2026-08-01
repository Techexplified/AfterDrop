import { useLoaderData, useFetcher } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];

export async function loader({ request }) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const settings = await db.shopSettings.upsert({
        where: { shop: shop },
        update: {},
        create: { shop: shop },
    });

    return { settings };
}

export async function action({ request }) {
    const { session } = await authenticate.admin(request);
    const form = await request.formData();

    const settleInDays = Number(form.get("settleInDays"));
    const sendHour = Number(form.get("sendHour"));
    const clockSource = String(form.get("clockSource"));
    const quietDays = form.getAll("quietDays").map(Number);
    const noTracking = String(form.get("noTracking"));
    const noTrackDays = Number(form.get("noTrackDays"));

    const payload = { settleInDays, sendHour, clockSource, quietDays, noTracking, noTrackDays };

    await db.shopSettings.upsert({
        where: { shop: session.shop },
        update: payload,
        create: { shop: session.shop, ...payload },
    });

    return { ok: true };
}

export default function SendWindow() {
    const { settings } = useLoaderData();
    const fetcher = useFetcher();
    const saving = fetcher.state === "submitting";

    const [waitDays, setWaitDays] = useState(settings.settleInDays ?? 3);
    const [sendHour, setSendHour] = useState(settings.sendHour ?? 10);
    const [clockSource, setClockSource] = useState(settings.clockSource ?? "customer");
    const [quietDays, setQuietDays] = useState(settings.quietDays ?? [0]);
    const [quietOn, setQuietOn] = useState((settings.quietDays ?? [0]).length > 0);

    // New state for Missing Tracking UI
    const [noTracking, setNoTracking] = useState(settings.noTracking ?? "fixed");
    const [noTrackDays, setNoTrackDays] = useState(settings.noTrackDays ?? 7);

    const toggleDay = (dayIndex) => {
        setQuietDays(prev =>
            prev.includes(dayIndex)
                ? prev.filter(d => d !== dayIndex)
                : [...prev, dayIndex].sort()
        );
    };

    const handleQuietToggle = () => {
        const nextState = !quietOn;
        setQuietOn(nextState);
        if (!nextState) {
            setQuietDays([]);
        }
    };

    return (
        <div className="afterdrop-ui" style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 24px" }}>
            <div style={{ marginBottom: 24 }}>
                <h1 className="t-xl">Timing</h1>
                <p className="sub">Configure when review requests are triggered, quiet day rules, and how untracked parcels are handled.</p>
            </div>
            <fetcher.Form method="post">
                <div className="Split">

                    {/* Controls Column */}
                    <div>
                        <div className="Card">

                            {/* Delivery Timing */}
                            <div style={{ marginBottom: 24 }}>
                                <label className="Field__label">Wait after delivery</label>
                                <div className="Inline">
                                    <div className="Stepper">
                                        <button type="button" onClick={() => setWaitDays(w => Math.max(0, w - 1))}>−</button>
                                        <input type="number" name="settleInDays" value={waitDays} readOnly />
                                        <button type="button" onClick={() => setWaitDays(w => Math.min(30, w + 1))}>+</button>
                                    </div>
                                    <span className="sub">days after the carrier marks it delivered</span>
                                </div>
                                <p className="Field__help">Long enough that they've used the thing, short enough that they still remember opening it.</p>
                            </div>

                            <div className="Divider"></div>

                            {/* Clock Settings */}
                            <div className="Grid2">
                                <div>
                                    <label className="Field__label">Send at</label>
                                    <select className="Input" name="sendHour" value={sendHour} onChange={(e) => setSendHour(Number(e.target.value))}>
                                        {Array.from({ length: 24 }, (_, h) => (
                                            <option key={h} value={h}>{h.toString().padStart(2, "0")}:00</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="Field__label">On whose clock</label>
                                    <div className="Seg Seg--fill">
                                        <button type="button" aria-pressed={clockSource === "customer"} onClick={() => setClockSource("customer")}>Customer's</button>
                                        <button type="button" aria-pressed={clockSource === "store"} onClick={() => setClockSource("store")}>Yours</button>
                                    </div>
                                    <input type="hidden" name="clockSource" value={clockSource} />
                                </div>
                            </div>
                            <p className="Field__help" style={{ marginTop: 8 }}>
                                {clockSource === "customer"
                                    ? `Everyone gets it at ${sendHour.toString().padStart(2, "0")}:00 their own time, so nobody is woken up.`
                                    : `Everyone gets it at ${sendHour.toString().padStart(2, "0")}:00 your time, whatever time that is where they live.`}
                            </p>

                            <div className="Divider"></div>

                            {/* Quiet Days */}
                            <div className="SettingRow">
                                <div className="SettingRow__t">
                                    <h4>Skip quiet days</h4>
                                    <p>Pushes a send to the next allowed day rather than dropping it.</p>
                                    <div
                                        className="Days"
                                        style={{
                                            opacity: quietOn ? 1 : 0.4,
                                            pointerEvents: quietOn ? "auto" : "none",
                                            transition: "opacity 0.2s"
                                        }}
                                    >
                                        {DISPLAY_DAYS.map((d) => (
                                            <button
                                                key={d}
                                                type="button"
                                                aria-pressed={quietDays.includes(d)}
                                                onClick={() => toggleDay(d)}
                                            >
                                                {DOW_LABELS[d]}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="Field__help">Highlighted days are the ones you <b>don't</b> send on.</p>

                                    {quietDays.map(d => (
                                        <input key={d} type="hidden" name="quietDays" value={d} />
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    className="Switch"
                                    role="switch"
                                    aria-pressed={quietOn}
                                    onClick={handleQuietToggle}
                                />
                            </div>

                            <div className="Divider"></div>

                            {/* Missing Tracking */}
                            <div>
                                <h4 className="t-sm" style={{ marginBottom: 4 }}>Missing tracking</h4>
                                <p className="Field__help" style={{ marginTop: 0, marginBottom: 16 }}>
                                    Untracked shipping, local courier, or a carrier that never scanned the parcel.
                                </p>

                                <label className="Conn" data-on={noTracking === "fixed" ? "1" : "0"}>
                                    <input
                                        type="radio"
                                        name="noTracking"
                                        value="fixed"
                                        checked={noTracking === "fixed"}
                                        onChange={() => setNoTracking("fixed")}
                                        style={{ marginTop: 3, accentColor: "var(--ink)" }}
                                    />
                                    <div className="Conn__b">
                                        <h4>Wait a fixed number of days</h4>
                                        <p>A blunt fallback that works with any setup.</p>

                                        {/* Inline input only shows when this option is selected */}
                                        {noTracking === "fixed" && (
                                            <div className="Inline" style={{ marginTop: 12 }}>
                                                <span className="sub">Assume it landed</span>
                                                <input
                                                    type="number"
                                                    name="noTrackDays"
                                                    className="Input"
                                                    style={{ width: 64, textAlign: 'center', padding: '0 8px' }}
                                                    value={noTrackDays}
                                                    onChange={(e) => setNoTrackDays(Math.max(1, Number(e.target.value)))}
                                                />
                                                <span className="sub">days after you marked it fulfilled</span>
                                            </div>
                                        )}
                                    </div>
                                </label>

                                <label className="Conn" data-on={noTracking === "skip" ? "1" : "0"} style={{ marginBottom: 0 }}>
                                    <input
                                        type="radio"
                                        name="noTracking"
                                        value="skip"
                                        checked={noTracking === "skip"}
                                        onChange={() => setNoTracking("skip")}
                                        style={{ marginTop: 3, accentColor: "var(--ink)" }}
                                    />
                                    <div className="Conn__b">
                                        <h4>Don't ask at all</h4>
                                        <p>Safest. You'll collect fewer reviews, but you'll never ask someone who's still waiting.</p>
                                    </div>
                                </label>
                            </div>

                        </div>

                        <div className="BtnRow">
                            <button type="submit" className="Btn-Pri" disabled={saving}>
                                {saving ? "Saving..." : "Save"}
                            </button>
                        </div>
                    </div>

                    {/* Static Placeholder Column */}
                    <aside className="Sticky">
                        <div className="Card">
                            <div className="Card__head"><h3 className="t-sm">On this setting, a real order would...</h3></div>
                            <div className="PlaceholderBox">
                                <p className="sub" style={{ margin: 0 }}>
                                    Once orders start flowing in, this will show a live timeline preview computed from your current settings — e.g. "Delivered Jul 28 → asked Jul 31 at 10:00".
                                </p>
                            </div>
                        </div>
                    </aside>

                </div>
            </fetcher.Form>

            <style>{`
        .afterdrop-ui {
          --surface: #FFFFFF; --surface-sub: #F7F7F7; --surface-hover: #F1F1F1;
          --border: #E3E3E3; --border-sub: #EBEBEB; --border-strong: #CDCDCD;
          --text: #303030; --text-sub: #616161; --text-dis: #8A8A8A;
          --focus: #005BD3; --ink: #3B2E63; --ink-line: #5B49A0; --ink-tint: #F4F2FC;
          --ink-edge: #DCD6F5; --mono: 'IBM Plex Mono', ui-monospace, monospace;
          --r1: 6px; --r2: 8px; --r3: 12px;
          --sh-card: 0 1px 0 0 rgba(26,26,26,.07);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          color: var(--text); font-size: 13px; line-height: 20px;
        }
        
        .t-xl { font-size: 28px; font-weight: 700; margin-bottom: 4px; line-height: 24px; }
        .t-sm { font-size: 13px; font-weight: 600; }
        .sub { color: var(--text-sub); }

        .Split { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 24px; align-items: start; }
        .Grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
        .Sticky { position: sticky; top: 24px; }
        
        .Card { background: var(--surface); border-radius: var(--r3); box-shadow: var(--sh-card); border: 1px solid var(--border-sub); padding: 16px; margin-bottom: 16px; }
        .Card__head { margin-bottom: 12px; }
        .Divider { height: 1px; background: var(--border-sub); margin: 16px -16px; }
        
        .Field__label { display: block; font-size: 13px; font-weight: 450; margin-bottom: 4px; }
        .Field__help { font-size: 12px; color: var(--text-sub); margin-top: 4px; line-height: 16px; }
        .Inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        
        .Input { width: 100%; height: 32px; border: 1px solid var(--border-strong); border-radius: var(--r2); padding: 0 12px; font-size: 13px; }
        select.Input { appearance: none; padding-right: 28px; cursor: pointer; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%234A4A4A' stroke-width='1.6'><path d='M1 1l4 4 4-4'/></svg>"); background-repeat: no-repeat; background-position: right 10px center; }
        
        .Stepper { display: inline-flex; align-items: center; border: 1px solid var(--border-strong); border-radius: var(--r2); overflow: hidden; background: var(--surface); }
        .Stepper button { width: 32px; height: 32px; border: 0; background: var(--surface); font-size: 15px; cursor: pointer; color: var(--text-sub); display: grid; place-items: center; }
        .Stepper button:hover { background: var(--surface-hover); }
        .Stepper input { width: 40px; height: 32px; border: 0; border-left: 1px solid var(--border-sub); border-right: 1px solid var(--border-sub); text-align: center; font-family: var(--mono); font-size: 13px; font-weight: 600; outline: none; pointer-events: none; }
        
        .Seg { display: flex; background: var(--surface-sub); border-radius: var(--r2); padding: 2px; gap: 2px; border: 1px solid var(--border-sub); }
        .Seg button { flex: 1; height: 28px; border: 0; background: none; border-radius: 4px; font-size: 12px; font-weight: 500; color: var(--text-sub); cursor: pointer; }
        .Seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--sh-card); }
        
        .SettingRow { display: flex; gap: 16px; align-items: flex-start; }
        .SettingRow__t { flex: 1; min-width: 0; }
        .SettingRow__t h4 { font-size: 13px; font-weight: 600; line-height: 18px; margin: 0; }
        .SettingRow__t p { font-size: 12px; color: var(--text-sub); line-height: 16px; margin: 2px 0 0 0; }
        
        .Days { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .Days button { width: 46px; height: 46px; border-radius: var(--r2); border: 1px solid var(--border-strong); background: var(--surface); font-size: 12px; font-weight: 600; color: var(--text-sub); cursor: pointer; }
        .Days button[aria-pressed="true"] { background: #303030; border-color: #303030; color: #fff; }
        
        .Switch { flex: 0 0 auto; width: 38px; height: 22px; border-radius: 11px; background: #B5B5B5; border: 0; padding: 0; position: relative; cursor: pointer; transition: background .14s; }
        .Switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .14s; box-shadow: 0 1px 2px rgba(0,0,0,.24); }
        .Switch[aria-pressed="true"] { background: #303030; }
        .Switch[aria-pressed="true"]::after { transform: translateX(16px); }

        /* Missing Tracking Radio Cards */
        .Conn { border: 1px solid var(--border); border-radius: var(--r2); padding: 16px; display: flex; gap: 12px; align-items: flex-start; background: var(--surface); text-align: left; width: 100%; margin-bottom: 12px; cursor: pointer; transition: all 0.2s; box-sizing: border-box; }
        .Conn[data-on="1"] { border-color: var(--ink); background: var(--ink-tint); box-shadow: 0 0 0 1px var(--ink) inset; }
        .Conn__b { flex: 1; min-width: 0; }
        .Conn__b h4 { font-size: 13px; font-weight: 650; line-height: 18px; margin: 0; }
        .Conn__b p { font-size: 12px; color: var(--text-sub); line-height: 16px; margin: 2px 0 0 0; }

        .BtnRow { display: flex; margin-top: 24px; }
        .Btn-Pri { height: 32px; padding: 0 16px; border: 0; border-radius: var(--r2); background: #303030; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
        .Btn-Pri:hover { background: #1A1A1A; }
        
        .PlaceholderBox { background: var(--surface-sub); border: 1px dashed var(--border-strong); border-radius: var(--r2); padding: 24px 16px; text-align: center; }
      `}</style>
        </div>
    );
}