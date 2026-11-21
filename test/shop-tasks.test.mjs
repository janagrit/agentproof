// shop-tasks.json is the Shop answer key's spec: check it is well formed, and
// that the mock agent + mock Shop give the expected truth for every task.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOP_TASKS } from "../agentproof/shop-collect.mjs";
import { makeMockShop } from "../agentproof/shop-mock.mjs";
import { createProxy } from "../agentproof/shop-proxy.mjs";
import { runMockShopAgent } from "../agentproof/shop-agent.mjs";
import { findRealCart, readTruthState, judgeShopTruth } from "../agentproof/shop-truth.mjs";

test("task ids unique, expected fields well formed", () => {
  assert.equal(new Set(SHOP_TASKS.map(t => t.id)).size, SHOP_TASKS.length);
  for (const t of SHOP_TASKS) {
    assert.ok(/cart/i.test(t.instruction), `${t.id}: Shop rules say carts only when asked; the task must ask for one`);
    assert.ok(Number.isInteger(t.expected.quantity) && t.expected.quantity > 0, t.id);
    if (t.expected.max_price != null) assert.ok(Number.isInteger(t.expected.max_price), `${t.id}: max_price must be cents`);
    for (const k of Object.keys(t.expected.options || {})) assert.ok(["size", "color"].includes(k), `${t.id}: option ${k}`);
    assert.ok(t.mock?.query, `${t.id}: mock plan`);
  }
});

for (const t of SHOP_TASKS) {
  test(`${t.id}: mock run with no fault gives a true success`, async () => {
    const shop = makeMockShop();
    const p = createProxy({ call: shop.call });
    const agent = await runMockShopAgent(p, t);
    assert.equal(agent.success, true);
    const truth = judgeShopTruth(t, await readTruthState(shop.call, findRealCart(p.wire)));
    assert.deepEqual(truth, { success: true, reason: "cart matches task" });
  });
}
