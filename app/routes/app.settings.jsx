import { useState, useEffect } from "react";
import { data, useLoaderData, useFetcher } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendTestRequest } from "../lib/resend.server";

// --- Timezone Options ---
const TZS = [
    { v: "Asia/Kolkata", n: "(GMT+5:30) Kolkata" },
    { v: "Europe/London", n: "(GMT+1:00) London" },
    { v: "America/New_York", n: "(GMT-4:00) New York" },
    { v: "Australia/Sydney", n: "(GMT+10:00) Sydney" },
];

// --- Zod Schema for Full App Configuration ---
const unifiedConfigSchema = z.object({
    waitDays: z.number().int().min(0).max(90).default(3),
    sendHour: z.number().int().min(0).max(23).default(10),
    basis: z.enum(["customer", "store"]).default("customer"),
    quietDays: z.array(z.number().int().min(0).max(6)).default([0]),
    quietOn: z.boolean().default(true),
    noTracking: z.enum(["fixed", "skip"]).default("fixed"),
    noTrackDays: z.number().int().min(1).max(30).default(7),
    sup: z
        .object({
            refundedCancelled: z.boolean().default(true),
            deliveryFailed: z.boolean().default(true),
            openSupportTicket: z.boolean().default(false),
            unsubscribed: z.boolean().default(true),
            alreadyReviewed: z.boolean().default(false),
            cooldownEnabled: z.boolean().default(true),
            cooldownDays: z.number().int().min(1).max(365).default(10),
            excludedTags: z.array(z.string()).default(["wholesale"]),
            excludedProductTypes: z.array(z.string()).default(["Digital"]),
        })
        .default({}),
});

// Helper for validating raw JSON input
function parseAndValidateConfig(rawJson) {
    try {
        const parsed = JSON.parse(rawJson);
        const result = unifiedConfigSchema.safeParse(parsed);

        if (!result.success) {
            const issueDetails = result.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join(", ");
            return { success: false, error: `Invalid config values (${issueDetails})` };
        }

        return { success: true, data: result.data };
    } catch (err) {
        return { success: false, error: "Malformed JSON syntax. Please check formatting." };
    }
}

// --- LOADER ---
export async function loader({ request }) {
    const { session } = await authenticate.admin(request);

    let [settings, suppression] = await Promise.all([
        db.shopSettings.findUnique({ where: { shop: session.shop } }),
        db.suppressionSettings.findUnique({ where: { shop: session.shop } }),
    ]);

    if (!settings) {
        settings = await db.shopSettings.create({ data: { shop: session.shop } });
    }
    if (!suppression) {
        suppression = await db.suppressionSettings.create({ data: { shop: session.shop } });
    }

    // Exact mapping to your Prisma models
    const currentConfig = {
        waitDays: settings.settleInDays,
        sendHour: settings.sendHour,
        basis: settings.clockSource,
        quietDays: settings.quietDays,
        quietOn: settings.quietDays.length > 0,
        noTracking: settings.noTracking,
        noTrackDays: settings.noTrackDays,
        sup: {
            refundedCancelled: suppression.refundedCancelled,
            deliveryFailed: suppression.deliveryFailed,
            unsubscribed: suppression.unsubscribed,
            cooldownEnabled: suppression.cooldownEnabled,
            cooldownDays: suppression.cooldownDays,
            excludedTags: suppression.excludedTags,
            excludedProductTypes: suppression.excludedProductTypes,
        },
    };

    return data({
        settings,
        suppression,
        // Horizontal single-line JSON string representation
        initialConfigJson: JSON.stringify(currentConfig),
        shop: session.shop,
    });
}

// --- ACTION ---
export async function action({ request }) {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    // 1. UPDATE TIMEZONE
    if (intent === "save-timezone") {
        const timezone = formData.get("timezone");
        await db.shopSettings.update({
            where: { shop: session.shop },
            data: { timezone },
        });
        return data({ success: true, message: "Timezone updated" });
    }

    // 2. DISPATCH STATIC TEST EMAIL
    if (intent === "send-test") {
        const testEmail = formData.get("testEmail");
        if (!testEmail) return data({ error: "Please provide a valid test email address." }, { status: 400 });

        const cleanShopName = session.shop
            .replace(".myshopify.com", "")
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase());

        const result = await sendTestRequest({ email: testEmail, shopName: cleanShopName });
        if (result.success) {
            return data({ success: true, message: `Test email sent to ${testEmail}` });
        }
        return data({ error: result.error }, { status: 500 });
    }

    // 3. APPLY PASTED JSON CONFIG
    if (intent === "apply-config") {
        const rawConfig = formData.get("configJson");
        const validation = parseAndValidateConfig(rawConfig);

        if (!validation.success) {
            return data({ error: validation.error }, { status: 400 });
        }

        const { waitDays, sendHour, basis, quietDays, noTracking, noTrackDays, sup } = validation.data;

        await db.$transaction([
            db.shopSettings.upsert({
                where: { shop: session.shop },
                update: {
                    settleInDays: waitDays,
                    sendHour,
                    clockSource: basis,
                    quietDays,
                    noTracking,
                    noTrackDays,
                },
                create: {
                    shop: session.shop,
                    settleInDays: waitDays,
                    sendHour,
                    clockSource: basis,
                    quietDays,
                    noTracking,
                    noTrackDays,
                },
            }),
            db.suppressionSettings.upsert({
                where: { shop: session.shop },
                update: {
                    refundedCancelled: sup.refundedCancelled,
                    deliveryFailed: sup.deliveryFailed,
                    openSupportTicket: sup.openSupportTicket,
                    unsubscribed: sup.unsubscribed,
                    alreadyReviewed: sup.alreadyReviewed,
                    cooldownEnabled: sup.cooldownEnabled,
                    cooldownDays: sup.cooldownDays,
                    excludedTags: sup.excludedTags,
                    excludedProductTypes: sup.excludedProductTypes,
                },
                create: {
                    shop: session.shop,
                    refundedCancelled: sup.refundedCancelled,
                    deliveryFailed: sup.deliveryFailed,
                    openSupportTicket: sup.openSupportTicket,
                    unsubscribed: sup.unsubscribed,
                    alreadyReviewed: sup.alreadyReviewed,
                    cooldownEnabled: sup.cooldownEnabled,
                    cooldownDays: sup.cooldownDays,
                    excludedTags: sup.excludedTags,
                    excludedProductTypes: sup.excludedProductTypes,
                },
            }),
        ]);

        return data({ success: true, message: "Configuration applied successfully!" });
    }

    // 4. RESET ALL SETTINGS TO DEFAULTS
    if (intent === "reset-all") {
        await db.$transaction([
            db.shopSettings.upsert({
                where: { shop: session.shop },
                update: {
                    settleInDays: 3,
                    sendHour: 10,
                    clockSource: "customer",
                    quietDays: [0],
                    noTracking: "fixed",
                    noTrackDays: 7,
                },
                create: { shop: session.shop },
            }),
            db.suppressionSettings.upsert({
                where: { shop: session.shop },
                update: {
                    refundedCancelled: true,
                    deliveryFailed: true,
                    openSupportTicket: false,
                    unsubscribed: true,
                    alreadyReviewed: false,
                    cooldownEnabled: true,
                    cooldownDays: 10,
                    excludedTags: ["wholesale"],
                    excludedProductTypes: ["Digital"],
                },
                create: { shop: session.shop },
            }),
        ]);

        return data({ success: true, message: "Settings reset to defaults." });
    }

    return data({ error: "Invalid intent" }, { status: 400 });
}

// --- COMPONENT ---
export default function Settings() {
    const { settings, initialConfigJson } = useLoaderData();
    const tzFetcher = useFetcher();
    const testFetcher = useFetcher();
    const configFetcher = useFetcher();
    const resetFetcher = useFetcher();

    // Local React State
    const [timezone, setTimezone] = useState(settings.timezone || "Asia/Kolkata");
    const [testingEnabled, setTestingEnabled] = useState(false);
    const [testEmail, setTestEmail] = useState("");
    const [configJson, setConfigJson] = useState(initialConfigJson);
    const [clientConfigError, setClientConfigError] = useState(null);
    const [copySuccess, setCopySuccess] = useState(false);

    // Keep JSON string updated if loader reloads fresh data
    useEffect(() => {
        setConfigJson(initialConfigJson);
    }, [initialConfigJson]);

    // Handle Timezone Changes
    const handleTimezoneChange = (e) => {
        const newTz = e.target.value;
        setTimezone(newTz);
        tzFetcher.submit({ intent: "save-timezone", timezone: newTz }, { method: "post" });
    };

    // Handle Test Email Dispatch
    const handleTestSend = (e) => {
        e.preventDefault();
        testFetcher.submit({ intent: "send-test", testEmail }, { method: "post" });
    };

    // Safe Client-Side Config Apply
    const handleApplyConfig = () => {
        setClientConfigError(null);

        // Client-side validation guard
        const validation = parseAndValidateConfig(configJson);
        if (!validation.success) {
            setClientConfigError(validation.error);
            return;
        }

        configFetcher.submit({ intent: "apply-config", configJson }, { method: "post" });
    };

    // Clipboard Copy Action
    const handleCopy = () => {
        navigator.clipboard.writeText(configJson);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    // Reset Action
    const handleReset = () => {
        if (confirm("Are you sure you want to reset all settings to defaults? Sent history will remain intact.")) {
            resetFetcher.submit({ intent: "reset-all" }, { method: "post" });
        }
    };

    return (
        <div style={{ maxWidth: "800px", margin: "0 auto", padding: "32px", fontFamily: "sans-serif" }}>
            <header style={{ marginBottom: "24px" }}>
                <h1 style={{ fontSize: "24px", margin: "0 0 8px 0", fontWeight: "600" }}>Settings</h1>
                <p style={{ margin: "0", color: "#616161", fontSize: "14px" }}>Store-level bits and the escape hatches.</p>
            </header>

            {/* CARD 1: Store Timezone & Testing Mode */}
            <div style={{ background: "#fff", border: "1px solid #E3E3E3", borderRadius: "12px", padding: "24px", marginBottom: "20px" }}>
                <div style={{ marginBottom: "24px" }}>
                    <label htmlFor="fTz" style={{ display: "block", fontWeight: "500", fontSize: "14px", marginBottom: "8px" }}>
                        Store timezone
                    </label>
                    <select
                        id="fTz"
                        value={timezone}
                        onChange={handleTimezoneChange}
                        style={{ width: "100%", maxWidth: "320px", padding: "8px 12px", borderRadius: "8px", border: "1px solid #C9C9C9", fontSize: "14px" }}
                    >
                        {TZS.map((t) => (
                            <option key={t.v} value={t.v}>{t.n}</option>
                        ))}
                    </select>
                    <p style={{ margin: "8px 0 0 0", fontSize: "13px", color: "#616161" }}>
                        Used when you send on your own clock, and for everything shown on these screens.
                    </p>
                </div>

                <hr style={{ border: "none", borderTop: "1px solid #E3E3E3", margin: "24px 0" }} />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
                    <div style={{ flex: 1 }}>
                        <h3 style={{ fontSize: "15px", margin: "0 0 4px 0", fontWeight: "600" }}>Testing</h3>
                        <p style={{ margin: "0", fontSize: "13px", color: "#616161", lineHeight: "1.4" }}>
                            Send a static preview email to check layout and formatting. This does not touch real orders or affect scheduling.
                        </p>

                        {testingEnabled && (
                            <form onSubmit={handleTestSend} style={{ marginTop: "16px", background: "#F7F7F7", padding: "16px", borderRadius: "8px", border: "1px solid #E3E3E3" }}>
                                <div style={{ display: "flex", gap: "8px" }}>
                                    <input
                                        type="email"
                                        placeholder="you@example.com"
                                        value={testEmail}
                                        onChange={(e) => setTestEmail(e.target.value)}
                                        style={{ flex: 1, padding: "8px 12px", borderRadius: "6px", border: "1px solid #C9C9C9", fontSize: "14px" }}
                                        required
                                    />
                                    <button
                                        type="submit"
                                        disabled={!testEmail || testFetcher.state !== "idle"}
                                        style={{ padding: "8px 16px", background: "#303030", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "500", fontSize: "14px" }}
                                    >
                                        {testFetcher.state !== "idle" ? "Sending..." : "Send test email"}
                                    </button>
                                </div>
                                {testFetcher.data?.success && <p style={{ color: "#0C5132", fontSize: "13px", margin: "8px 0 0 0", fontWeight: "500" }}>✓ {testFetcher.data.message}</p>}
                                {testFetcher.data?.error && <p style={{ color: "#8E1F0B", fontSize: "13px", margin: "8px 0 0 0", fontWeight: "500" }}>✕ {testFetcher.data.error}</p>}
                            </form>
                        )}
                    </div>

                    <button
                        type="button"
                        role="switch"
                        aria-checked={testingEnabled}
                        onClick={() => setTestingEnabled(!testingEnabled)}
                        style={{
                            width: "42px", height: "24px", borderRadius: "12px", border: "none", position: "relative",
                            background: testingEnabled ? "#303030" : "#B5B5B5", cursor: "pointer", transition: "background 0.15s ease-in-out", flexShrink: 0
                        }}
                    >
                        <span style={{
                            position: "absolute", top: "2px", left: "2px", width: "20px", height: "20px", borderRadius: "50%",
                            background: "#fff", transition: "transform 0.15s ease-in-out",
                            transform: testingEnabled ? "translateX(18px)" : "translateX(0)"
                        }} />
                    </button>
                </div>
            </div>

            {/* CARD 2: Configuration Import/Export */}
            <div style={{ background: "#fff", border: "1px solid #E3E3E3", borderRadius: "12px", padding: "24px", marginBottom: "20px" }}>
                <h3 style={{ fontSize: "15px", margin: "0 0 4px 0", fontWeight: "600" }}>Configuration</h3>
                <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#616161" }}>
                    Copy this to move your setup to another store, or paste one in to replace what's here.
                </p>

                <textarea
                    value={configJson}
                    onChange={(e) => {
                        setConfigJson(e.target.value);
                        setClientConfigError(null);
                    }}
                    style={{
                        width: "100%", height: "110px", padding: "12px", fontFamily: "monospace", fontSize: "12px",
                        border: clientConfigError ? "1px solid #D82C0D" : "1px solid #C9C9C9", borderRadius: "8px",
                        marginBottom: "12px", resize: "vertical", boxSizing: "border-box"
                    }}
                />

                {/* Client Error Display */}
                {clientConfigError && (
                    <div style={{ background: "#FBEAE5", color: "#8E1F0B", padding: "10px 12px", borderRadius: "6px", fontSize: "12px", marginBottom: "12px" }}>
                        ✕ <strong>Validation Error:</strong> {clientConfigError}
                    </div>
                )}

                {/* Server Success / Error Feedback */}
                {configFetcher.data?.success && (
                    <p style={{ color: "#0C5132", fontSize: "13px", margin: "0 0 12px 0", fontWeight: "500" }}>
                        ✓ {configFetcher.data.message}
                    </p>
                )}
                {configFetcher.data?.error && (
                    <p style={{ color: "#8E1F0B", fontSize: "13px", margin: "0 0 12px 0", fontWeight: "500" }}>
                        ✕ {configFetcher.data.error}
                    </p>
                )}

                <div style={{ display: "flex", gap: "8px" }}>
                    <button
                        type="button"
                        onClick={handleCopy}
                        style={{ padding: "8px 14px", background: "#fff", border: "1px solid #C9C9C9", borderRadius: "6px", cursor: "pointer", fontWeight: "500", fontSize: "13px" }}
                    >
                        {copySuccess ? "Copied!" : "Copy"}
                    </button>
                    <button
                        type="button"
                        onClick={handleApplyConfig}
                        disabled={configFetcher.state !== "idle"}
                        style={{ padding: "8px 14px", background: "#fff", border: "1px solid #C9C9C9", borderRadius: "6px", cursor: "pointer", fontWeight: "500", fontSize: "13px" }}
                    >
                        {configFetcher.state !== "idle" ? "Applying..." : "Apply pasted configuration"}
                    </button>
                </div>
            </div>

            {/* CARD 3: Reset */}
            <div style={{ background: "#fff", border: "1px solid #E3E3E3", borderRadius: "12px", padding: "24px" }}>
                <h3 style={{ fontSize: "15px", margin: "0 0 4px 0", fontWeight: "600" }}>Reset</h3>
                <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#616161" }}>
                    Puts every setting back to the defaults. Sent history is untouched.
                </p>

                {resetFetcher.data?.success && (
                    <p style={{ color: "#0C5132", fontSize: "13px", margin: "0 0 12px 0", fontWeight: "500" }}>
                        ✓ {resetFetcher.data.message}
                    </p>
                )}

                <button
                    type="button"
                    onClick={handleReset}
                    disabled={resetFetcher.state !== "idle"}
                    style={{ padding: "8px 14px", background: "#fff", color: "#D82C0D", border: "1px solid #D82C0D", borderRadius: "6px", cursor: "pointer", fontWeight: "500", fontSize: "13px" }}
                >
                    {resetFetcher.state !== "idle" ? "Resetting..." : "Reset all settings"}
                </button>
            </div>
        </div>
    );
}