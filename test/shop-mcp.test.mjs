// Shop MCP client: request format, errors, retries, redaction, cart documents. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeShopCall, redact, cartCreateArgs, cartUpdateArgs, PROTOCOL } from "../src/shop-mcp.mjs";

const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
const quiet = fn => async () => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test("sends the headers and _meta that protocol 2026-07-28 requires", async () => {
  let seen;
  const call = makeShopCall({ fetchImpl: async (url, init) => { seen = { url, init }; return reply(200, { jsonrpc: "2.0", id: 1, result: { isError: false, structuredContent: { products: [] } } }); } });
  const r = await call("search_catalog", { catalog: { query: "socks" } });
  assert.deepEqual(r.structuredContent, { products: [] });
  assert.equal(seen.url, "https://mcp.shop.com/");
  assert.equal(seen.init.headers["mcp-protocol-version"], PROTOCOL);
  assert.equal(seen.init.headers["mcp-method"], "tools/call");
  assert.equal(seen.init.headers["mcp-name"], "search_catalog");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.name, "search_catalog");
  // Without these two the real server answers HTTP 400 (seen in our first test call).
  assert.equal(body.params._meta["io.modelcontextprotocol/protocolVersion"], PROTOCOL);
  assert.deepEqual(body.params._meta["io.modelcontextprotocol/clientCapabilities"], {});
});

test("JSON-RPC errors throw with the server's message, no retry on 400", quiet(async () => {
  let n = 0;
  const call = makeShopCall({ retry: { wait: async () => {} }, fetchImpl: async () => { n++; return reply(400, { error: { code: -32602, message: "Invalid params" } }); } });
  await assert.rejects(call("search_catalog", {}), /HTTP 400.*Invalid params/);
  assert.equal(n, 1);
}));

test("429 is retried", quiet(async () => {
  let n = 0;
  const call = makeShopCall({ retry: { wait: async () => {} }, fetchImpl: async () => (++n < 3 ? reply(429, {}) : reply(200, { result: { isError: false } })) });
  assert.deepEqual(await call("get_cart", { shop: "x", id: "y" }), { isError: false });
  assert.equal(n, 3);
}));

test("redact hides key-bearing links and cart tokens, keeps product links", () => {
  const r = redact({
    continue_url: "https://shop.example/cart/c/abc?key=1",
    line_items: [{ id: "gid://shopify/CartLine/eefd?cart=FAKEcartTOKEN01", item: { id: "gid://shopify/ProductVariant/1" } }],
    variants: [{ url: "https://shop.example/products/sock?variant=1", checkout_url: "https://shop.example/cart/1:1" }],
    text: "line gid://shopify/CartLine/eefd?cart=FAKEcartTOKEN01 qty 1",
  });
  assert.equal(r.continue_url, "[REDACTED]");
  assert.equal(r.line_items[0].id, "gid://shopify/CartLine/eefd?cart=[REDACTED]");
  assert.equal(r.variants[0].checkout_url, "[REDACTED]");
  assert.equal(r.variants[0].url, "https://shop.example/products/sock?variant=1", "merchant links stay exactly as returned");
  assert.equal(r.text, "line gid://shopify/CartLine/eefd?cart=[REDACTED] qty 1");
});

test("redact hides the key inside cart ids (same shape as live ids; fake values)", () => {
  const id = "gid://shopify/Cart/FAKEcartID0000000000000a?key=0000000000000000fakefakefake0000";
  assert.equal(redact(id), "gid://shopify/Cart/FAKEcartID0000000000000a?key=[REDACTED]");
  assert.equal(redact(`cart ${id} | USD total $22.00`), "cart gid://shopify/Cart/FAKEcartID0000000000000a?key=[REDACTED] | USD total $22.00");
  assert.equal(redact({ args: { id } }).args.id, "gid://shopify/Cart/FAKEcartID0000000000000a?key=[REDACTED]");
});

test("cartCreateArgs builds Shop's line_items and an idempotency key", () => {
  const a = cartCreateArgs("nobull.myshopify.com", [{ variant_id: "gid://shopify/ProductVariant/1", quantity: 2 }], "key-1");
  assert.deepEqual(a, { shop: "nobull.myshopify.com", cart: { line_items: [{ item: { id: "gid://shopify/ProductVariant/1" }, quantity: 2 }] }, meta: { "idempotency-key": "key-1" } });
});

test("cartUpdateArgs: full document, response-only fields dropped, lines replaced", () => {
  const current = {
    id: "cart-1", currency: "USD", buyer: { consent: {} }, discounts: {}, next: ["hint"], signals: {}, attribution: {},
    line_items: [{ id: "line-a", item: { id: "v-M", title: "Hoodie M", price: 7000 }, quantity: 1, totals: [] }],
  };
  const a = cartUpdateArgs("s", current, [{ line_id: "line-a", variant_id: "v-M", quantity: 3 }, { variant_id: "v-L", quantity: 1 }], "k");
  assert.equal(a.id, "cart-1");
  assert.ok(!("next" in a.cart) && !("signals" in a.cart) && !("attribution" in a.cart));
  assert.deepEqual(a.cart.buyer, { consent: {} }, "unrelated fields kept, including empty objects");
  assert.deepEqual(a.cart.discounts, {});
  assert.deepEqual(a.cart.line_items[0], { ...current.line_items[0], quantity: 3 }, "existing line kept by its own id");
  assert.deepEqual(a.cart.line_items[1], { item: { id: "v-L" }, quantity: 1 });
  assert.deepEqual(current.next, ["hint"], "does not mutate the input");
  // Changing the variant of a line = new line (old one removed).
  const swap = cartUpdateArgs("s", current, [{ line_id: "line-a", variant_id: "v-L", quantity: 1 }], "k");
  assert.deepEqual(swap.cart.line_items, [{ item: { id: "v-L" }, quantity: 1 }]);
});
