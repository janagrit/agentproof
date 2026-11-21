// Minimal Shop MCP client. Each tool call is one JSON-RPC POST to
// https://mcp.shop.com/ (protocol 2026-07-28, no session). Anonymous: search,
// products and carts need no account. See docs/shop-mcp-plan.md.
import { randomUUID } from "node:crypto";
import { withRetry } from "./gemini.mjs";

export const SHOP_URL = process.env.SHOP_MCP_URL || "https://mcp.shop.com/";
export const PROTOCOL = "2026-07-28";
// All AgentProof Shop tasks shop in the US, in USD.
export const CONTEXT = { address_country: "US", currency: "USD" };

/** Returns call(name, args) -> MCP result ({structuredContent, content, isError}). */
export function makeShopCall({ url = SHOP_URL, fetchImpl = globalThis.fetch, retry = {} } = {}) {
  let n = 0;
  return function call(name, args) {
    return withRetry(async () => {
      const body = {
        jsonrpc: "2.0", id: ++n, method: "tools/call",
        params: {
          name, arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "agentproof", version: "0.1.0" },
          },
        },
      };
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": PROTOCOL,
          "mcp-method": "tools/call",
          "mcp-name": name,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let j;
      try { j = JSON.parse(text); } catch { j = null; }
      if (!j || j.error || res.status === 429 || res.status >= 500) {
        const e = new Error(`Shop ${name}: HTTP ${res.status} ${j?.error ? JSON.stringify(j.error).slice(0, 300) : text.slice(0, 200)}`);
        e.status = res.status;
        throw e;
      }
      return j.result;
    }, { label: `shop ${name}`, ...retry });
  };
}

// ---- Redaction -----------------------------------------------------------
// Shop docs: continue_url is key-bearing ("keep them out of logs"). Search
// variants carry checkout_url, cart line ids embed ?cart=<token>, and real cart
// ids embed ?key=<secret> (seen live: gid://shopify/Cart/<id>?key=<hex>).
const SECRET_KEYS = /^(continue_url|checkout_url|payment_url|authorization|.*token.*|.*secret.*)$/i;
const CART_TOKEN = /([?&](?:cart|key)=)[^&"\s|)]+/g;

export function redact(v) {
  if (typeof v === "string") return v.replace(CART_TOKEN, "$1[REDACTED]");
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? "[REDACTED]" : redact(x)]));
  }
  return v;
}

// ---- Cart documents ------------------------------------------------------
// The agent sends short line lists; these build Shop's real requests.

/** lines: [{variant_id, quantity}] */
export function cartCreateArgs(shop, lines, key = randomUUID()) {
  return {
    shop,
    cart: { line_items: lines.map(l => ({ item: { id: l.variant_id }, quantity: l.quantity })) },
    meta: { "idempotency-key": key },
  };
}

/**
 * Full-document update, per Shop's rules: start from the current cart, drop
 * response-only root fields, keep everything else, replace only line_items.
 * lines: the full list of lines wanted, [{line_id?, variant_id, quantity}].
 * A line_id that matches an existing line keeps that line object (new quantity).
 */
export function cartUpdateArgs(shop, current, lines, key = randomUUID()) {
  const doc = structuredClone(current);
  delete doc.next; delete doc.signals; delete doc.attribution;
  doc.line_items = lines.map(l => {
    const existing = l.line_id && (current.line_items || []).find(x => x.id === l.line_id);
    if (existing && (!l.variant_id || existing.item?.id === l.variant_id)) return { ...existing, quantity: l.quantity };
    return { item: { id: l.variant_id }, quantity: l.quantity };
  });
  return { shop, id: current.id, cart: doc, meta: { "idempotency-key": key } };
}
