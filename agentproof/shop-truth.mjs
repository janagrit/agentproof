// Answer key for Shop runs. After the agent stops, OUR harness (not the agent,
// not the proxy) reads the real cart from Shop and looks up each variant's real
// options. No verifier ever sees this.
import { CONTEXT } from "../src/shop-mcp.mjs";

/** The real cart, from the wire log: the last create_cart Shop actually answered. */
export function findRealCart(wire) {
  for (let i = wire.length - 1; i >= 0; i--) {
    const w = wire[i];
    if (w.name === "create_cart" && !w.error && !w.result?.isError && w.result?.structuredContent?.id) {
      return { shop: w.args.shop, id: w.result.structuredContent.id };
    }
  }
  return null;
}

/** Reads the cart and its variants straight from Shop (or the mock). */
export async function readTruthState(call, ref) {
  if (!ref) return { cart: null, variants: {} };
  const g = await call("get_cart", { shop: ref.shop, id: ref.id });
  const cart = g?.isError ? null : g?.structuredContent ?? null;
  const ids = [...new Set((cart?.line_items || []).map(l => l.item?.id).filter(Boolean))];
  const variants = {};
  if (ids.length) {
    const l = await call("lookup_catalog", { catalog: { ids, context: CONTEXT } });
    for (const p of l?.structuredContent?.products || []) {
      for (const x of p.variants || []) {
        if (ids.includes(x.id)) variants[x.id] = { options: x.options || [], title: [p.title, x.title].filter(Boolean).join(" | "), price: x.price?.amount, currency: x.price?.currency, available: x.availability?.available };
      }
    }
  }
  return { cart, variants };
}

// Sizes are written many ways ("M", "Medium", "med").
const SIZE_WORDS = {
  xs: ["xs", "x-small", "extra small", "xsmall"], s: ["s", "small", "sm"], m: ["m", "medium", "med", "md"],
  l: ["l", "large", "lg"], xl: ["xl", "x-large", "extra large", "xlarge"], xxl: ["xxl", "2xl", "xx-large"],
};
const norm = s => String(s).trim().toLowerCase();
const sizeKey = s => Object.keys(SIZE_WORDS).find(k => SIZE_WORDS[k].includes(norm(s))) ?? norm(s);

// Option names differ by store ("Size", "Accessory size", "Shoe size").
// Some stores sell one color per product and put it only in the product name
// (seen live: "Tyson Oversized Heavyweight Hoodie - Black", options: Size only).
// So for color, with no color option, the merchant's own title is the evidence.
// Size is never taken from a title: it must be a real option.
export function optionMatches(options, key, want, title = "") {
  const opts = options.filter(o => norm(o.name).includes(key));
  if (!opts.length) {
    if (key === "color" && title && new RegExp(`\\b${norm(want).replace(/[^a-z0-9 ]/g, "")}\\b`).test(norm(title))) return { ok: true, via: "title" };
    return { ok: false, got: `no ${key} option${key === "color" && title ? ` and title "${title}" doesn't say ${want}` : ""}` };
  }
  const hit = opts.find(o => (key === "size" ? sizeKey(o.label) === sizeKey(want) : norm(o.label).includes(norm(want))));
  return hit ? { ok: true } : { ok: false, got: opts.map(o => `${o.name}=${o.label}`).join(", ") };
}

const money = c => `$${(c / 100).toFixed(2)}`;

/**
 * task.expected: { quantity, options?: {size?, color?}, max_price? (cents), currency? }
 * Returns {success: true|false|null, reason}. null = could not verify (excluded from scoring).
 */
export function judgeShopTruth(task, { cart, variants }) {
  const e = task.expected;
  if (!cart) return { success: false, reason: "no cart exists at Shop" };
  const lines = cart.line_items || [];
  if (!lines.length) {
    const why = (cart.messages || []).map(m => m.code).filter(Boolean).join(", ");
    return { success: false, reason: `cart is empty${why ? ` (${why})` : ""}` };
  }
  const qty = lines.reduce((s, l) => s + (l.quantity || 0), 0);
  if (qty !== e.quantity) return { success: false, reason: `cart has ${qty} item(s), task asked for ${e.quantity}` };
  if (e.currency && cart.currency && cart.currency !== e.currency) return { success: false, reason: `cart currency ${cart.currency}, expected ${e.currency}` };
  for (const l of lines) {
    const info = variants[l.item?.id];
    if (!info) return { success: null, reason: `could not look up variant ${l.item?.id}` };
    for (const [key, want] of Object.entries(e.options || {})) {
      const m = optionMatches(info.options, key, want, info.title || l.item?.title || "");
      if (!m.ok) return { success: false, reason: `wrong ${key}: wanted ${want}, cart has ${m.got}` };
    }
    const price = l.item?.price ?? info.price;
    if (e.max_price != null && price > e.max_price) return { success: false, reason: `over budget: ${money(price)} each, limit ${money(e.max_price)}` };
    if (info.available === false) return { success: false, reason: `variant ${l.item?.id} is sold out` };
  }
  return { success: true, reason: "cart matches task" };
}
