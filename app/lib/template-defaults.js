export const TEMPLATES = {
  review: {
    id: "review",
    name: "Review request",
    core: true,
    triggerPrefix: "DEL + ",
    config: {
      waitDays: 3,
      subject: "How's the {product}, {first}?",
      headline: "How's it working out?",
      body: "It landed {ago}, so you've had a moment to try it. One tap below if you have thirty seconds — it genuinely helps the next person deciding.",
      buttonText: "Write a review",
      targetUrl: "", // Interactive review form / app route
    },
  },
  careGuide: {
    id: "careGuide",
    name: "Getting started guide",
    core: false,
    triggerPrefix: "DEL + ",
    config: {
      waitDays: 1,
      subject: "Three things to know about your {product}",
      headline: "Make it last",
      body: "Your {product} arrived {ago}. Three things worth ninety seconds before first use — the small stuff that keeps it looking new.",
      buttonText: "Read the full care guide",
      targetUrl: "", // Defaults to merchant's main store URL
    },
  },
  referral: {
    id: "referral",
    name: "Referral invite",
    core: false,
    triggerPrefix: "DEL + ",
    config: {
      waitDays: 5,
      subject: "Know someone who'd love the {product}?",
      headline: "Share the good ones",
      body: "You gave the {product} five stars last week. If someone you know would love it too, use your link to give them 10% off — and put 10% back on your next order.",
      buttonText: "Send your code",
      promoCode: "{first}-SHARES-10",
      promoNote: "They get 10% · You get 10% back",
      targetUrl: "", // Defaults to merchant's main store URL
    },
  },
  crossSell: {
    id: "crossSell",
    name: "You might also like",
    core: false,
    triggerPrefix: "DEL + ",
    config: {
      waitDays: 10,
      subject: "Goes well with the {product}, {first}",
      headline: "It pairs well",
      body: "People who kept the {product} usually add this next. Hand-picked to match perfectly.",
      buttonText: "See the pairing",
      targetUrl: "", // Defaults to merchant's main store URL
    },
  },
  replenish: {
    id: "replenish",
    name: "Replenishment reminder",
    core: false,
    triggerPrefix: "DEL + ",
    config: {
      waitDays: 45,
      subject: "About a week of {product} left, {first}",
      headline: "Running low, by our maths",
      body: "You started your {product} about 40 days ago. Reorder now and the next one arrives before this one runs out.",
      buttonText: "Reorder in one tap",
      targetUrl: "", // Defaults to merchant's main store URL
    },
  },
  winback: {
    id: "winback",
    name: "Win-back",
    core: false,
    triggerPrefix: "IDLE ",
    config: {
      waitDays: 90,
      subject: "Been a while, {first}",
      headline: "Been a while",
      body: "Your last order was the {product} — we hope it's still earning its keep. No guilt trip: here's 10% off if anything has caught your eye since.",
      buttonText: "See what's new",
      promoCode: "COMEBACK10",
      promoNote: "10% off · Valid 14 days",
      targetUrl: "", // Defaults to merchant's main store URL
    },
  },
};

/**
 * Helper to resolve the final target URL when building emails.
 * If the merchant entered a custom URL, use it; otherwise fallback to the shop's main domain.
 */
export function resolveTargetUrl(customUrl, shop) {
  if (customUrl && customUrl.trim() !== "") {
    return customUrl.trim();
  }
  if (!shop) return "#";
  const cleanShop = shop.replace(/^https?:\/\//, "");
  return `https://${cleanShop}`;
}