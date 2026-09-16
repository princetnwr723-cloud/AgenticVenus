// lib/gumroad.ts
// Gumroad Ping webhooks aren't signed, so we never trust the POST body
// directly — we take its sale_id and re-verify with Gumroad's own Sales
// API using our access token before granting anything.

export type GumroadSale = {
  id: string;
  email: string;
  product_id: string;
  product_permalink: string;
  refunded: boolean;
  disputed: boolean;
  chargebacked: boolean;
  url_params?: Record<string, string>;
  custom_fields?: Record<string, string>;
};

export async function verifyGumroadSale(saleId: string): Promise<GumroadSale | null> {
  const accessToken = process.env.GUMROAD_ACCESS_TOKEN;
  if (!accessToken) throw new Error("GUMROAD_ACCESS_TOKEN isn't set.");
  const res = await fetch(`https://api.gumroad.com/v2/sales/${saleId}?access_token=${accessToken}`);
  const data = await res.json();
  if (!data.success || !data.sale) return null;
  return data.sale as GumroadSale;
}

/** Maps a Gumroad product to one of our plan ids, via env vars so this
 * doesn't need a code change if you swap products later. */
export function planIdForGumroadProduct(productId: string, permalink: string): "pro" | "elite" | null {
  if (productId === process.env.GUMROAD_ELITE_PRODUCT_ID || permalink === process.env.GUMROAD_ELITE_PERMALINK) return "elite";
  if (productId === process.env.GUMROAD_PRO_PRODUCT_ID || permalink === process.env.GUMROAD_PRO_PERMALINK) return "pro";
  return null;
}

/** Builds the checkout link with the buyer's uid attached as a Gumroad
 * url_param, so the webhook knows whose account to upgrade — Gumroad
 * echoes url_params back in the sale payload automatically. */
export function buildGumroadCheckoutUrl(productUrl: string, uid: string): string {
  const url = new URL(productUrl);
  url.searchParams.set("wanted", "true");
  url.searchParams.set("url_params[uid]", uid);
  return url.toString();
}