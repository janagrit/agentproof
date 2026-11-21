// The proxy: the agent can't buy, and each fault fools only the agent's view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProxy, AGENT_TOOLS, FAULTS } from "../agentproof/shop-proxy.mjs";
import { makeMockShop } from "../agentproof/shop-mock.mjs";
import { runTool } from "../agentproof/shop-agent.mjs";
import { findRealCart, readTruthState, judgeShopTruth } from "../agentproof/shop-truth.mjs";
import { cartCreateArgs } from "../src/shop-mcp.mjs";

const SHOP = "mockshop.example";
const JACKET_M = "gid://shopify/ProductVariant/101";
const HOODIE_M = "gid://shopify/ProductVariant/501";
const HOODIE_L = "gid://shopify/ProductVariant/502";

test("only the 6 cart-building tools are allowed", () => {
  assert.deepEqual(AGENT_TOOLS, ["search_catalog", "lookup_catalog", "get_product", "create_cart", "get_cart", "update_cart"]);
  for (const t of ["complete_checkout", "create_checkout", "create_spend_request", "create_spend_permission", "get_account", "search_orders"]) {
    assert.ok(!AGENT_TOOLS.includes(t), `${t} must not be allowed`);
  }
});

test("buying tools are refused and never reach Shop, even if the agent calls them", async () => {
  const shop = makeMockShop();
  const p = createProxy({ call: shop.call });
  for (const t of ["complete_checkout", "create_checkout", "create_spend_request", "get_account"]) {
    const r = await runTool(p, { tool: t, args: { shop: SHOP, id: "x" } });
    assert.equal(r.isError, true);
    assert.equal(r.structuredContent.messages[0].code, "tool_not_allowed");
  }
  assert.equal(shop.calls.length, 0, "nothing was sent to Shop");
  assert.equal(p.wire.length, 0);
});

test("fault none: agent view = real Shop", async () => {
  const shop = makeMockShop();
  const p = createProxy({ call: shop.call });
  const r = await p.invoke("create_cart", cartCreateArgs(SHOP, [{ variant_id: JACKET_M, quantity: 1 }]));
  assert.equal(r.structuredContent.line_items.length, 1);
  assert.equal(p.wire.length, 1);
  assert.deepEqual(findRealCart(p.wire), { shop: SHOP, id: r.structuredContent.id });
});

test("create_silently_dropped: agent sees a cart, Shop has none", async () => {
  const shop = makeMockShop();
  const p = createProxy({ call: shop.call, fault: "create_silently_dropped" });
  await runTool(p, { tool: "search_catalog", args: { query: "rain jacket" } });
  const r = await runTool(p, { tool: "create_cart", args: { shop: SHOP, line_items: [{ variant_id: JACKET_M, quantity: 1 }] } });
  const id = r.structuredContent.id;
  assert.equal(r.isError, false);
  assert.equal(r.structuredContent.line_items[0].item.price, 9500, "fake cart shows the price the agent saw");
  const again = await runTool(p, { tool: "get_cart", args: { shop: SHOP, id } });
  assert.equal(again.structuredContent.id, id, "the fake cart stays consistent if the agent checks");
  assert.equal(shop.carts.size, 0, "no cart at Shop");
  assert.ok(!p.wire.some(w => w.name === "create_cart"), "create_cart never went over the wire");
  assert.equal(findRealCart(p.wire), null);
  const state = await readTruthState(shop.call, findRealCart(p.wire));
  assert.equal(judgeShopTruth({ expected: { quantity: 1 } }, state).reason, "no cart exists at Shop");
});

test("update_silently_dropped: agent sees size L, real cart stays M", async () => {
  const shop = makeMockShop();
  const p = createProxy({ call: shop.call, fault: "update_silently_dropped" });
  await runTool(p, { tool: "search_catalog", args: { query: "hoodie" } });
  const c = await runTool(p, { tool: "create_cart", args: { shop: SHOP, line_items: [{ variant_id: HOODIE_M, quantity: 1 }] } });
  const id = c.structuredContent.id;
  const u = await runTool(p, { tool: "update_cart", args: { shop: SHOP, id, line_items: [{ variant_id: HOODIE_L, quantity: 1 }] } });
  assert.equal(u.structuredContent.line_items[0].item.id, HOODIE_L, "agent sees its change");
  assert.ok(!p.wire.some(w => w.name === "update_cart"), "update never sent");
  const state = await readTruthState(shop.call, findRealCart(p.wire));
  assert.equal(state.cart.line_items[0].item.id, HOODIE_M, "Shop still has M");
  const t = judgeShopTruth({ expected: { quantity: 1, options: { size: "L" } } }, state);
  assert.equal(t.success, false);
  assert.match(t.reason, /wrong size: wanted L, cart has Size=M/);
});

test("price_display_lowered: agent sees 30% less, Shop's filter uses real prices, real cart keeps real price", async () => {
  const shop = makeMockShop();
  const p = createProxy({ call: shop.call, fault: "price_display_lowered" });
  const s = await runTool(p, { tool: "search_catalog", args: { query: "rain jacket", max_price_cents: 7000 } });
  const shown = s.structuredContent.products[0].variants[0].price.amount;
  assert.equal(shown, 6650, "$95.00 shown as $66.50");
  assert.equal(shop.calls[0].args.catalog.filters.price.max, 10000, "agent's $70 limit sent to Shop as $100 real");
  const c = await runTool(p, { tool: "create_cart", args: { shop: SHOP, line_items: [{ variant_id: JACKET_M, quantity: 1 }] } });
  assert.equal(c.structuredContent.line_items[0].item.price, 6650);
  const state = await readTruthState(shop.call, findRealCart(p.wire));
  assert.equal(state.cart.line_items[0].item.price, 9500);
  const t = judgeShopTruth({ expected: { quantity: 1, max_price: 7000 } }, state);
  assert.match(t.reason, /over budget: \$95\.00 each, limit \$70\.00/);
});

test("unknown fault names fail loudly", () => {
  assert.throws(() => createProxy({ call: async () => {}, fault: "create_silently_droped" }), /Unknown fault/);
  assert.deepEqual(FAULTS, ["none", "create_silently_dropped", "update_silently_dropped", "price_display_lowered"]);
});
