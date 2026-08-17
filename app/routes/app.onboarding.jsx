import { useState, useEffect } from "react";
import { data, redirect, useLoaderData, useSubmit, useNavigate, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendTestRequest } from "../lib/resend.server";

// --- CONSTANTS & DATA ---
const TZS = [
    ["Asia/Kolkata", "(GMT+5:30) Kolkata"],
    ["Europe/London", "(GMT+1:00) London"],
    ["America/New_York", "(GMT−4:00) New York"],
    ["Australia/Sydney", "(GMT+10:00) Sydney"],
];

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const RULES = [
    { id: "refund", title: "Refunded or cancelled", desc: "Asking someone to review a purchase you just refunded reads as a taunt." },
    { id: "failed", title: "Delivery failed / returned", desc: "The carrier couldn't deliver, or the parcel went back. Nothing to review." },
    { id: "optout", title: "Unsubscribed", desc: "Marketing consent withdrawn. Never overridden, whatever else is on." },
    { id: "cooldown", title: "Asked recently", desc: "One ask per customer per 30 days, however many orders they place." },
];

const TEMPLATES = [
    { id: "review", name: "Review request", code: "DEL + Xd", core: true },
    { id: "careGuide", name: "Getting started guide", code: "DEL + 1d" },
    { id: "referral", name: "Referral invite", code: "DEL + 5d" },
    { id: "crossSell", name: "You might also like", code: "DEL + 10d" },
    { id: "replenish", name: "Replenishment reminder", code: "DEL + 45d" },
    { id: "winback", name: "Win-back", code: "IDLE 90d" },
];

const STEPS = [
    { id: "welcome", label: "Welcome", isNumbered: false },
    { id: "store", label: "Your store", isNumbered: true },
    { id: "timing", label: "Timing", isNumbered: true },
    { id: "guardrails", label: "Guardrails", isNumbered: true },
    { id: "templates", label: "Templates", isNumbered: true },
    { id: "test", label: "Test send", isNumbered: true },
    { id: "done", label: "Done", isNumbered: false },
];

// --- HELPERS ---
const pad = (n) => String(n).padStart(2, "0");
const dayLabel = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + d.getDate();
};
const dowOf = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.getDay();
};

export async function loader({ request }) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const settings = await db.shopSettings.findUnique({ where: { shop } });
    if (settings?.isOnboarded) {
        return redirect(`/app/overview?${url.searchParams.toString()}`);
    }

    const shopName = shop
        .replace(".myshopify.com", "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());

    return { shopName };
}

export async function action({ request }) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "send-test") {
        const testEmail = formData.get("testEmail");
        const shopName = formData.get("shopName") || shop;

        if (!testEmail) return data({ error: "Please provide a valid test email address." }, { status: 400 });

        const result = await sendTestRequest({ email: testEmail, shopName });
        if (result.success) {
            return data({ success: true, message: `Test email sent to ${testEmail}` });
        }
        return data({ error: result.error }, { status: 500 });
    }

    const config = JSON.parse(formData.get("config"));

    const activeTemplates = Object.keys(config.templates).filter((id) => config.templates[id]);

    await db.$transaction([
        db.shopSettings.upsert({
            where: { shop },
            create: {
                shop,
                storeName: config.storeName,
                settleInDays: config.waitDays,
                sendHour: config.sendHour,
                clockSource: config.basis,
                quietDays: config.quietDays,
                timezone: config.tz,
                isOnboarded: true,
            },
            update: {
                storeName: config.storeName,
                settleInDays: config.waitDays,
                sendHour: config.sendHour,
                clockSource: config.basis,
                quietDays: config.quietDays,
                timezone: config.tz,
                isOnboarded: true,
            },
        }),
        db.suppressionSettings.upsert({
            where: { shop },
            create: {
                shop,
                refundedCancelled: config.sup.refund,
                deliveryFailed: config.sup.failed,
                unsubscribed: config.sup.optout,
                cooldownEnabled: config.sup.cooldown,
            },
            update: {
                refundedCancelled: config.sup.refund,
                deliveryFailed: config.sup.failed,
                unsubscribed: config.sup.optout,
                cooldownEnabled: config.sup.cooldown,
            },
        }),
        db.templateSettings.upsert({
            where: { shop },
            create: {
                shop,
                enabledTemplates: activeTemplates,
            },
            update: {
                enabledTemplates: activeTemplates,
            },
        }),
    ]);

    return redirect("/app/overview");
}

export default function Onboarding() {
    const navigate = useNavigate();
    const submit = useSubmit();
    const testFetcher = useFetcher();
    const { shopName } = useLoaderData();

    const [stepIdx, setStepIdx] = useState(0);
    const currentStep = STEPS[stepIdx];

    const totalNumberedSteps = STEPS.filter((s) => s.isNumbered).length;
    const currentNumberedStep = STEPS.slice(0, stepIdx + 1).filter((s) => s.isNumbered).length;

    const [formData, setFormData] = useState({
        storeName: shopName,
        tz: "Asia/Kolkata",
        waitDays: 3,
        sendHour: 10,
        basis: "customer",
        quietDays: [0],
        sup: {
            refund: true,
            failed: true,
            optout: true,
            cooldown: true,
        },
        templates: {
            review: true,
            careGuide: true,
            referral: false,
            crossSell: true,
            replenish: false,
            winback: false,
        },
        testEmail: "",
        testSent: false,
    });

    const updateForm = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));
    const toggleSup = (ruleId) =>
        setFormData((prev) => ({ ...prev, sup: { ...prev.sup, [ruleId]: !prev.sup[ruleId] } }));
    const toggleTpl = (tplId) =>
        setFormData((prev) => ({ ...prev, templates: { ...prev.templates, [tplId]: !prev.templates[tplId] } }));

    const toggleQuietDay = (dayIdx) => {
        setFormData((prev) => {
            const q = [...prev.quietDays];
            const idx = q.indexOf(dayIdx);
            if (idx >= 0) q.splice(idx, 1);
            else {
                if (q.length >= 6) return prev;
                q.push(dayIdx);
            }
            return { ...prev, quietDays: q.sort() };
        });
    };

    useEffect(() => {
        if (testFetcher.data?.success) {
            updateForm("testSent", true);
        }
    }, [testFetcher.data]);

    const quietText = () => {
        if (!formData.quietDays.length) return "no quiet days";
        return "never on " + formData.quietDays.map((d) => DOW[d]).join(" or ");
    };

    const timingSentence = () => {
        let target = formData.waitDays;
        let hops = 0;
        while (formData.quietDays.includes(dowOf(target)) && hops < 8) {
            target++;
            hops++;
        }
        const slid = hops > 0;

        return (
            <>
                A parcel delivered <b>today</b> starts a <b>{formData.waitDays}-day settle-in</b>, aiming for{" "}
                <b>
                    {dayLabel(formData.waitDays)} at {pad(formData.sendHour)}:00
                </b>{" "}
                on the <b>{formData.basis === "customer" ? "customer's" : "store's"} clock</b>
                {slid ? (
                    <>
                        {" "}— that lands on a quiet day, so it slides to <b>{dayLabel(target)}</b>.
                    </>
                ) : (
                    <>
                        . Quiet days: <b>{quietText()}</b>.
                    </>
                )}
            </>
        );
    };

    const guardSentence = () => {
        const on = RULES.filter((r) => formData.sup[r.id]).map((r) => r.title.toLowerCase());
        if (!on.length) return <>Every guardrail is off — AfterDrop will ask <b>everyone</b>. That is rarely what you want.</>;
        return (
            <>
                <b>Never ask when:</b> {on.join(" · ")}.
            </>
        );
    };

    const SentenceBlock = ({ tag, children }) => (
        <div className="sentence">
            <span className="sentence-tag">{tag}</span>
            {children}
        </div>
    );

    const handleSendTest = () => {
        const email = formData.testEmail.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) {
            alert("Please enter a valid email address.");
            return;
        }
        testFetcher.submit(
            { intent: "send-test", testEmail: email, shopName: formData.storeName },
            { method: "post" }
        );
    };

    const submitOnboarding = () => {
        submit({ config: JSON.stringify(formData) }, { method: "post" });
    };

    const renderStep = () => {
        switch (currentStep.id) {
            case "welcome":
                return (
                    <>
                        <p className="kicker">AfterDrop for Shopify · first-run setup</p>
                        <h1>Count from the doorstep,<br />not the checkout.</h1>
                        <p className="lede">
                            Every other post-purchase app starts its timers when the order is placed. AfterDrop starts them when the carrier scans the parcel as <b>delivered</b> — and knows when not to send at all. Three minutes of setup, and nothing goes out until you switch it on.
                        </p>
                        <ul className="vals">
                            <li>
                                <span className="vi">DEL + 3d</span>
                                <span><b>Timing that matches reality.</b> Reviews asked three days after the parcel lands — not while it is still in a van.</span>
                            </li>
                            <li>
                                <span className="vi">4 rules</span>
                                <span><b>A bouncer at the door.</b> Refunds, failed deliveries, unsubscribes, cooldowns — clear reasons never to ask, checked before any timer starts.</span>
                            </li>
                            <li>
                                <span className="vi">6 tpl</span>
                                <span><b>Every email, one brain.</b> Confirmations, delivery notices, review asks and marketing all share the same scheduler and the same guardrails.</span>
                            </li>
                        </ul>
                    </>
                );

            case "store":
                return (
                    <>
                        <p className="kicker">Step {currentNumberedStep} of {totalNumberedSteps} · your store</p>
                        <h2>Confirm the basics</h2>
                        <p className="lede">
                            Correct anything that looks off. The timezone matters: it is the clock quiet days are judged against.
                        </p>
                        <div className="field">
                            <label htmlFor="fStore">Store name — appears in every email</label>
                            <input
                                className="txt"
                                id="fStore"
                                value={formData.storeName}
                                onChange={(e) => updateForm("storeName", e.target.value)}
                            />
                        </div>
                        <div className="field">
                            <label htmlFor="fTz">Store timezone</label>
                            <select
                                className="sel"
                                id="fTz"
                                value={formData.tz}
                                onChange={(e) => updateForm("tz", e.target.value)}
                            >
                                {TZS.map((t) => (
                                    <option key={t[0]} value={t[0]}>{t[1]}</option>
                                ))}
                            </select>
                        </div>
                        <SentenceBlock tag="How it reads">
                            Emails come from <b>{formData.storeName || "your store"}</b>. The store clock is{" "}
                            <b>{(TZS.find((t) => t[0] === formData.tz) || TZS[0])[1]}</b>.
                        </SentenceBlock>
                    </>
                );

            case "timing":
                return (
                    <>
                        <p className="kicker">Step {currentNumberedStep} of {totalNumberedSteps} · timing</p>
                        <h2>When exactly do we ask?</h2>
                        <p className="lede">
                            The settle-in is the pause between the delivery scan and the ask — long enough that they've used it, short enough that they remember opening it.
                        </p>
                        <div className="field">
                            <label htmlFor="fWait">Settle-in wait after delivery</label>
                            <div className="slider-row">
                                <input
                                    type="range"
                                    id="fWait"
                                    min="0"
                                    max="14"
                                    step="1"
                                    value={formData.waitDays}
                                    onChange={(e) => updateForm("waitDays", Number(e.target.value))}
                                />
                                <span className="slider-val">
                                    {formData.waitDays} day{formData.waitDays === 1 ? "" : "s"}
                                </span>
                            </div>
                            {formData.waitDays === 3 ? (
                                <p className="bestnote">✓ 3 days is the best performer in stores like yours — a 36% response rate.</p>
                            ) : (
                                <p className="hint">Stores like yours see the best response at 3 days (36%).</p>
                            )}
                        </div>
                        <div className="grid2">
                            <div className="field">
                                <label htmlFor="fHour">Send at</label>
                                <select
                                    className="sel"
                                    id="fHour"
                                    value={formData.sendHour}
                                    onChange={(e) => updateForm("sendHour", Number(e.target.value))}
                                >
                                    {Array.from({ length: 13 }, (_, i) => i + 7).map((h) => (
                                        <option key={h} value={h}>{pad(h)}:00</option>
                                    ))}
                                </select>
                            </div>
                            <div className="field">
                                <label>On whose clock?</label>
                                <div className="radio-row">
                                    <button
                                        className={`radio-card ${formData.basis === "customer" ? "on" : ""}`}
                                        onClick={() => updateForm("basis", "customer")}
                                    >
                                        <b>Customer's</b>
                                        <span>10:00 in Sydney is 10:00 in Sydney.</span>
                                    </button>
                                    <button
                                        className={`radio-card ${formData.basis === "store" ? "on" : ""}`}
                                        onClick={() => updateForm("basis", "store")}
                                    >
                                        <b>Store's</b>
                                        <span>Everything sends on Kolkata time.</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="field">
                            <label>Quiet days — sends slide forward, never drop</label>
                            <div className="chiprow">
                                {DOW.map((d, i) => (
                                    <button
                                        key={d}
                                        className={`chip ${formData.quietDays.includes(i) ? "on" : ""}`}
                                        onClick={() => toggleQuietDay(i)}
                                    >
                                        {d.slice(0, 3)}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <SentenceBlock tag="The decision trace, in advance">
                            {timingSentence()}
                        </SentenceBlock>
                    </>
                );

            case "guardrails":
                return (
                    <>
                        <p className="kicker">Step {currentNumberedStep} of {totalNumberedSteps} · guardrails</p>
                        <h2>Who should we never bother?</h2>
                        <p className="lede">
                            Half of AfterDrop's value is the emails that are never sent. These are checked in order before any timer starts.
                        </p>
                        <div className="rules">
                            {RULES.map((r, i) => (
                                <div className="rule" key={r.id}>
                                    <span className="rule-num">{i + 1}</span>
                                    <div className="rule-t">
                                        <b>{r.title}</b>
                                        <span>{r.desc}</span>
                                    </div>
                                    <button
                                        className={`sw ${formData.sup[r.id] ? "on" : ""}`}
                                        role="switch"
                                        onClick={() => toggleSup(r.id)}
                                    ></button>
                                </div>
                            ))}
                        </div>
                        <SentenceBlock tag="How it reads">
                            {guardSentence()}
                        </SentenceBlock>
                    </>
                );

            case "templates":
                const activeCount = Object.values(formData.templates).filter(Boolean).length;
                return (
                    <>
                        <p className="kicker">Step {currentNumberedStep} of {totalNumberedSteps} · templates</p>
                        <h2>Pick your starting library</h2>
                        <p className="lede">
                            All {TEMPLATES.length} share the same scheduler and guardrails. Drafts can be customized and switched on at any time later.
                        </p>
                        <div className="tcat">
                            <p className="tcat-h">Marketing & Retention</p>
                            <div className="tgrid">
                                {TEMPLATES.map((t) => (
                                    <button
                                        key={t.id}
                                        className={`tpl ${formData.templates[t.id] ? "on" : ""} ${t.core ? "lock" : ""}`}
                                        onClick={() => !t.core && toggleTpl(t.id)}
                                        disabled={t.core}
                                    >
                                        <span className="box">{formData.templates[t.id] ? "✓" : ""}</span>
                                        <span className="dot"></span>
                                        <span className="tn">
                                            {t.name}
                                            {t.core && <span style={{ color: "var(--ink3)", fontWeight: 400 }}> · core</span>}
                                        </span>
                                        <span className="tc">{t.code.replace("Xd", `${formData.waitDays}d`)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <SentenceBlock tag="How it reads">
                            <b>{activeCount} of {TEMPLATES.length}</b> templates will be live on day one. The review request is the core of the product and stays on.
                        </SentenceBlock>
                    </>
                );

            case "test":
                return (
                    <>
                        <p className="kicker">Step {currentNumberedStep} of {totalNumberedSteps} · test send</p>
                        <h2>Send a preview to yourself</h2>
                        <p className="lede">
                            Want to see how your emails look before finishing? Enter your email address below to dispatch an instant sample email to your inbox. This step is completely optional — you can skip it and continue anytime.
                        </p>
                        <div className="field">
                            <label htmlFor="fMail">Your email address (Optional)</label>
                            <div className="testrow">
                                <input
                                    className="txt"
                                    id="fMail"
                                    type="email"
                                    placeholder="you@store.com"
                                    value={formData.testEmail}
                                    onChange={(e) => updateForm("testEmail", e.target.value)}
                                />
                                <button
                                    className="btn"
                                    onClick={handleSendTest}
                                    disabled={testFetcher.state !== "idle" || !formData.testEmail}
                                >
                                    {testFetcher.state !== "idle" ? "Sending..." : "Send sample email"}
                                </button>
                            </div>
                            {/* <p className="hint">Sends an instant sample email filled with real order data from your store to check layout and formatting[cite: 6].</p> */}

                            {testFetcher.data?.error && (
                                <p style={{ color: "var(--stop)", fontSize: "12px", marginTop: "8px" }}>
                                    ✕ {testFetcher.data.error}
                                </p>
                            )}
                        </div>

                        {formData.testSent && (
                            <div className="testok">
                                <span>✓</span>
                                <span>
                                    <b>Sample email sent to {formData.testEmail}.</b> Check your inbox to verify layout and formatting[cite: 6]. You can send more sample emails anytime from Settings[cite: 6].
                                </span>
                            </div>
                        )}
                    </>
                );

            case "done":
                const finalActive = Object.values(formData.templates).filter(Boolean).length;
                const finalGuards = Object.values(formData.sup).filter(Boolean).length;
                return (
                    <>
                        <p className="kicker">Setup complete</p>
                        <h2>You're ready to go.</h2>
                        <p className="lede">
                            Here is everything you chose, restated. Click below to open your dashboard and start monitoring your post-purchase order queue.
                        </p>
                        <div className="sum">
                            <div className="sum-row">
                                <span>Store</span>
                                <span>{formData.storeName} · <span className="m">{formData.tz}</span></span>
                            </div>
                            <div className="sum-row">
                                <span>Timing</span>
                                <span>
                                    <span className="m">DEL + {formData.waitDays}d</span> · {pad(formData.sendHour)}:00{" "}
                                    {formData.basis === "customer" ? "customer" : "store"} clock · {quietText()}
                                </span>
                            </div>
                            <div className="sum-row">
                                <span>Guardrails</span>
                                <span>{finalGuards} of {RULES.length} on</span>
                            </div>
                            <div className="sum-row">
                                <span>Templates</span>
                                <span>{finalActive} of {TEMPLATES.length} active</span>
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "24px" }}>
                            <button className="btn btn--big" onClick={submitOnboarding}>
                                Open the dashboard
                            </button>
                        </div>
                    </>
                );

            default:
                return null;
        }
    };

    return (
        <>
            <div className="shell">
                <div className="main">
                    <div className="main-top">
                        <button className="skip" onClick={() => navigate("/app")}>
                            Skip — use the defaults
                        </button>
                    </div>

                    <main className="stage">
                        <div className="step">{renderStep()}</div>
                    </main>

                    {currentStep.id !== "done" && (
                        <footer className="foot">
                            <button
                                className="btn btn--line"
                                style={{ visibility: stepIdx === 0 ? "hidden" : "visible" }}
                                onClick={() => setStepIdx((p) => Math.max(0, p - 1))}
                            >
                                Back
                            </button>

                            <span className="grow"></span>

                            {currentStep.isNumbered && (
                                <span className="stepcount">
                                    Step {currentNumberedStep} of {totalNumberedSteps}
                                </span>
                            )}

                            <button
                                className="btn"
                                onClick={() => setStepIdx((p) => Math.min(STEPS.length - 1, p + 1))}
                            >
                                {stepIdx === 0 ? "Set up AfterDrop" : stepIdx === STEPS.length - 2 ? "Finish Setup" : "Continue"}
                            </button>
                        </footer>
                    )}
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
        :root{
          --paper:#FFFFFF;--ink:#0A0A0A;--ink2:#5A5D63;--ink3:#8C9098;--ink4:#B9BCC2;
          --line:#E5E6E9;--soft:#F0F1F3;--surface:#FAFAFB;
          --ok:#0E6B3E;--okbg:#EDF5F0;--warn:#8A5000;--warnbg:#FBF4E9;--stop:#9B1C1C;--stopbg:#FCEEEE;
          --display:'Inter Tight',system-ui,sans-serif;
          --sans:'Inter',system-ui,-apple-system,sans-serif;
          --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
          --r:8px;--rs:5px;
        }
        *{box-sizing:border-box}
        body{margin:0;background:var(--surface);color:var(--ink);font-family:var(--sans);
          font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
        button{font-family:inherit;font-size:inherit;color:inherit;cursor:pointer}
        select,input{font-family:inherit;color:var(--ink)}
        :focus-visible{outline:2px solid #000;outline-offset:2px;border-radius:3px}

        .shell{display:flex;min-height:100vh;justify-content:center;background:#fff}
        .main{display:flex;flex-direction:column;width:100%;max-width:800px;background:#fff;box-shadow:none;min-height:100vh}
        .main-top{display:flex;justify-content:flex-end;padding:18px 34px 0}
        .skip{background:none;border:0;font-size:12.5px;color:var(--ink3);text-decoration:underline;text-underline-offset:3px}
        .skip:hover{color:var(--ink)}
        .stage{flex:1;display:flex;justify-content:center;padding:26px 34px 60px}
        .step{width:100%;max-width:600px}

        .kicker{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin:0 0 12px}
        h1{font-family:var(--display);font-weight:600;letter-spacing:-.035em;line-height:1.12;margin:0 0 14px;font-size:34px}
        h2{font-family:var(--display);font-size:24px;font-weight:600;letter-spacing:-.03em;line-height:1.2;margin:0 0 10px}
        .lede{margin:0 0 26px;color:var(--ink2);font-size:14.5px;line-height:1.65;max-width:58ch}
        .lede b{color:var(--ink);font-weight:600}

        .sentence{border:1px solid var(--line);border-left:3px solid var(--ink);border-radius:var(--rs);
          background:var(--surface);padding:13px 16px;font-size:13.3px;line-height:1.65;color:var(--ink2);margin-top:26px}
        .sentence b{color:var(--ink);font-weight:600}
        .sentence-tag{display:block;font-family:var(--mono);font-size:9px;letter-spacing:.16em;text-transform:uppercase;
          color:var(--ink3);margin-bottom:6px}

        .field{margin-bottom:20px}
        .field>label{display:block;font-size:12.8px;font-weight:600;margin-bottom:7px}
        .field .hint{font-size:12px;color:var(--ink3);margin-top:6px;line-height:1.55}
        input.txt,select.sel{width:100%;border:1px solid var(--line);border-radius:var(--rs);padding:10px 12px;
          font-size:13.5px;background:#fff}
        select.sel{appearance:none;padding-right:30px;
          background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%230A0A0A' stroke-width='1.5'><path d='M1 1l4 4 4-4'/></svg>");
          background-repeat:no-repeat;background-position:right 11px center}
        input.txt:focus,select.sel:focus{border-color:var(--ink);outline:none}
        
        .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .chiprow{display:flex;gap:8px;flex-wrap:wrap}
        .chip{border:1px solid var(--line);background:#fff;border-radius:99px;padding:7px 14px;font-size:12.8px;font-weight:500}
        .chip:hover{border-color:var(--ink)}
        .chip.on{background:var(--ink);border-color:var(--ink);color:#fff}
        
        .radio-row{display:flex;gap:10px}
        .radio-card{flex:1;border:1px solid var(--line);border-radius:var(--rs);padding:11px 13px;text-align:left;background:#fff;font-size:12.8px}
        .radio-card b{display:block;font-weight:600;margin-bottom:2px}
        .radio-card span{color:var(--ink3);font-size:11.8px;line-height:1.45;display:block}
        .radio-card:hover{border-color:var(--ink)}
        .radio-card.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}

        .vals{list-style:none;margin:0 0 8px;padding:0}
        .vals li{display:flex;gap:14px;padding:13px 0;border-top:1px solid var(--line);font-size:13.8px;line-height:1.6;color:var(--ink2)}
        .vals li:last-child{border-bottom:1px solid var(--line)}
        .vals .vi{font-family:var(--mono);font-size:11px;color:var(--ink);border:1px solid var(--line);border-radius:4px;
          padding:2px 7px;height:fit-content;white-space:nowrap;margin-top:2px}
        .vals b{color:var(--ink);font-weight:600}

        .slider-row{display:flex;align-items:center;gap:16px}
        input[type=range]{flex:1;accent-color:#000}
        .slider-val{font-family:var(--mono);font-size:13px;min-width:64px;text-align:right}
        .bestnote{margin-top:8px;font-size:12px;color:var(--ok)}

        .rules{border:1px solid var(--line);border-radius:var(--r);overflow:hidden;margin-bottom:14px}
        .rule{display:flex;align-items:flex-start;gap:13px;padding:13px 16px;border-bottom:1px solid var(--line);background:#fff}
        .rule:last-child{border-bottom:0}
        .rule-t{flex:1;min-width:0}
        .rule-t b{display:block;font-size:13.2px;font-weight:600;margin-bottom:1px}
        .rule-t span{font-size:12.2px;color:var(--ink3);line-height:1.5;display:block}
        .rule-num{font-family:var(--mono);font-size:10.5px;color:var(--ink3);margin-top:3px;width:14px}
        .sw{position:relative;width:36px;height:20px;border-radius:99px;background:var(--ink4);border:0;flex:0 0 auto;
          transition:background .12s;margin-top:2px}
        .sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;
          transition:left .12s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
        .sw.on{background:var(--ink)}
        .sw.on::after{left:18px}

        /* Templates CSS */
        .tcat{margin-bottom:18px}
        .tcat-h{display:flex;align-items:baseline;gap:8px;font-family:var(--mono);font-size:10px;letter-spacing:.13em;
          text-transform:uppercase;color:var(--ink3);margin:0 0 8px}
        .tgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .tpl{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:var(--rs);
          padding:10px 12px;background:#fff;text-align:left;font-size:12.8px;transition:border-color .15s}
        .tpl:hover{border-color:var(--ink)}
        .tpl.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
        
        .tpl.lock{background:var(--surface);cursor:not-allowed;opacity:0.8}
        .tpl.lock:hover{border-color:var(--ink)}
        
        .tpl .box{width:15px;height:15px;border:1.5px solid var(--ink4);border-radius:3px;flex:0 0 auto;display:grid;place-items:center;
          font-size:10px;color:#fff;line-height:1}
        .tpl.on .box{background:var(--ink);border-color:var(--ink)}
        .tpl .tn{flex:1;min-width:0;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .tpl .tc{font-family:var(--mono);font-size:9px;color:var(--ink3);white-space:nowrap}
        .tpl .dot{width:7px;height:7px;border-radius:2px;border:1.5px solid var(--ink);flex:0 0 auto}

        /* Test Mode CSS */
        .testrow{display:flex;gap:10px}
        .testrow input{flex:1}
        .testok{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);border-left:3px solid var(--ok);
          border-radius:var(--rs);background:var(--okbg);padding:13px 16px;font-size:13px;line-height:1.6;color:var(--ink2);margin-top:16px}
        .testok b{color:var(--ok);font-weight:600}

        /* Done Summary CSS */
        .sum{border:1px solid var(--line);border-radius:var(--r);overflow:hidden;margin:0 0 22px}
        .sum-row{display:flex;justify-content:space-between;gap:18px;padding:11px 16px;border-bottom:1px solid var(--line);font-size:13px}
        .sum-row:last-child{border-bottom:0}
        .sum-row span:first-child{color:var(--ink3)}
        .sum-row span:last-child{font-weight:500;text-align:right}
        .sum-row .m{font-family:var(--mono);font-size:12px}

        .foot{border-top:0;padding:16px 34px;display:flex;align-items:center;gap:12px;
          position:sticky;bottom:0;background:rgba(255,255,255,.95);backdrop-filter:blur(6px)}
        .foot .grow{flex:1}
        .stepcount{font-family:var(--mono);font-size:11px;color:var(--ink3)}
        .btn{display:inline-flex;align-items:center;gap:8px;background:#000;color:#fff;border:1px solid #000;
          border-radius:var(--rs);padding:10px 22px;font-size:13.5px;font-weight:600;letter-spacing:.01em;
          transition:transform .08s,opacity .12s}
        .btn:hover{opacity:.86}.btn:active{transform:translateY(1px)}
        .btn--line{background:#fff;color:var(--ink);border-color:var(--line)}
        .btn--line:hover{opacity:1;border-color:var(--ink)}
        .btn--big{padding:12px 28px;font-size:14px}
        .btn[disabled]{opacity:0.42;pointer-events:none}

        @media(max-width:880px){
          .grid2{grid-template-columns:1fr}
          .tgrid{grid-template-columns:1fr}
          h1{font-size:28px}
        }
      `}} />
        </>
    );
}