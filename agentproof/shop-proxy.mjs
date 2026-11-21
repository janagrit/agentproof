// Sits between the agent and Shop. Two jobs:
//  1. Safety: the agent can only use 6 tools. Checkout, spend, account and
//     order tools are refused here, in code, and never reach Shop.
//  2. Faults: like the store's bugs, but they only change what the AGENT sees
//     (or skip a write). Shop's real state stays honest, so get_cart by our
//     harness is still a true answer key.
// It keeps two logs: `view` (what the agent saw) and `wire` (what was really
// sent to Shop and Shop's real reply).
import { randomUUID } from "node:crypto";

export const AGENT_TOOLS = ["search_catalog", "lookup_catalog", "get_product", "create_cart", "get_cart", "update_cart"];
export const FAULTS = ["none", "create_silently_dropped", "update_silently_dropped", "price_display_lowered"];
const PRICE_FACTOR = 0.7;

const success = sc => ({ isError: false, structuredContent: sc, content: [{ type: "text", text: "ok" }] });

// Every price an agent can see, lowered: variant.price.amount, line item.price,
// totals[].amount, price_range amounts.
function lowerPrices(v, key) {
  if (Array.isArray(v)) return v.map(x => lowerPrices(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lowerPrices(x, k)]));
  if (typeof v === "number" && (key === "amount" || key === "price")) return Math.round(v * PRICE_FACTOR);
  return v;
}

export function createProxy({ call, fault = "none" }) {
  if (!FAULTS.includes(fault)) throw new Error(`Unknown fault ${fault}. Known: ${FAULTS.join(", ")}`);
  const wire = [];
  const view = [];
  const fakeCarts = new Map();      // carts that exist only in the agent's view
  const lastSeenCart = new Map();   // cart id -> latest doc the agent saw
  const seenVariants = new Map();   // variant id -> {title, price} as the agent saw it

  async function real(name, args) {
    try {
      const result = await call(name, args);
      wire.push({ name, args, result });
      return result;
    } catch (e) {
      wire.push({ name, args, error: e.message });
      throw e;
    }
  }

  function remember(result) {
    const sc = result?.structuredContent;
    const vs = [...(sc?.products || []).flatMap(p => p.variants || []), ...(sc?.product?.variants || [])];
    for (const x of vs) seenVariants.set(x.id, { title: x.title, price: x.price?.amount });
    if (Array.isArray(sc?.line_items) && sc.id) lastSeenCart.set(sc.id, sc);
  }

  // A believable cart doc built from what the agent asked for.
  function fakeCartDoc(id, lineItems, base = {}) {
    const lines = lineItems.map(l => {
      const seen = seenVariants.get(l.item?.id) || {};
      const price = seen.price ?? l.item?.price ?? 0;
      return {
        id: l.id ?? `gid://shopify/CartLine/${randomUUID()}?cart=${randomUUID().slice(0, 8)}`,
        item: { id: l.item?.id, title: seen.title ?? l.item?.title ?? "item", price },
        quantity: l.quantity, totals: [{ type: "total", amount: price * l.quantity }],
      };
    });
    const amount = lines.reduce((s, l) => s + l.item.price * l.quantity, 0);
    return { ...base, id, line_items: lines, currency: "USD", messages: [], next: [],
      totals: [{ type: "subtotal", amount, display_text: "Subtotal" }, { type: "total", amount, display_text: "Total" }] };
  }

  async function invoke(name, args) {
    let result;
    if (!AGENT_TOOLS.includes(name)) {
      result = { isError: true, structuredContent: { messages: [{ type: "error", code: "tool_not_allowed", content: `${name} is not available to this agent. It may only search and build carts.` }] } };
    } else if (name === "create_cart" && fault === "create_silently_dropped") {
      const id = `gid://shopify/Cart/${randomUUID()}`;
      const doc = fakeCartDoc(id, args.cart?.line_items || []);
      fakeCarts.set(id, doc);
      result = success(doc);
    } else if (name === "get_cart" && fakeCarts.has(args.id)) {
      result = success(fakeCarts.get(args.id));
    } else if (name === "update_cart" && (fakeCarts.has(args.id) || fault === "update_silently_dropped")) {
      const base = fakeCarts.get(args.id) ?? lastSeenCart.get(args.id) ?? {};
      const doc = fakeCartDoc(args.id, args.cart?.line_items || [], base);
      if (fakeCarts.has(args.id)) fakeCarts.set(args.id, doc);
      else lastSeenCart.set(args.id, doc); // the agent now "sees" its change; Shop never got it
      result = success(doc);
    } else if (name === "search_catalog" && fault === "price_display_lowered" && args?.catalog?.filters?.price?.max != null) {
      // The agent filters on the prices it sees (lowered), so ask Shop with the
      // limit scaled back to real prices. Read-only search; no cart is touched.
      const real_args = structuredClone(args);
      real_args.catalog.filters.price.max = Math.round(args.catalog.filters.price.max / PRICE_FACTOR);
      result = await real(name, real_args);
    } else {
      result = await real(name, args);
    }
    if (fault === "price_display_lowered") result = lowerPrices(result);
    remember(result);
    view.push({ name, args, result });
    return result;
  }

  return { invoke, view, wire, fault };
}
