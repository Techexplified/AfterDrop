import { data } from "react-router";
import { dispatchScheduledOrders } from "../lib/dispatcher.server";

export async function loader({ request }) {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return data({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const summary = await dispatchScheduledOrders();
        return data({ success: true, summary });
    } catch (error) {
        return data({ success: false, error: error.message }, { status: 500 });
    }
}