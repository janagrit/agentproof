// The Shop answer key: real cart + real variant options -> success or failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeShopTruth, optionMatches } from "../agentproof/shop-truth.mjs";

const V = "gid://shopify/ProductVariant/1";
const cart = (lines, extra = {}) => ({ id: "c", currency: "USD", messages: [], line_items: lines, ...extra });
const line = (price = 9500, quantity = 1, id = V) => ({ id: "l", item: { id, title: "x", price }, quantity });
const info = (options, available = true) => ({ [V]: { options: Object.entries(options).map(([name, label]) => ({ name, label })), available } });
const task = { expected: { quantity: 1, options: { size: "M" }, max_price: 12000, currency: "USD" } };

test("happy path", () => {
  assert.deepEqual(judgeShopTruth(task, { cart: cart([line()]), variants: info({ Size: "M" }) }), { success: true, reason: "cart matches task" });
});

test("size written differently still matches", () => {
  assert.equal(judgeShopTruth(task, { cart: cart([line()]), variants: info({ Size: "Medium" }) }).success, true);
  // Real Shop data: socks used "Accessory size", not "Size".
  assert.equal(judgeShopTruth(task, { cart: cart([line()]), variants: info({ "Accessory size": "M" }) }).success, true);
  assert.equal(optionMatches([{ name: "Color", label: "Black / White" }], "color", "black").ok, true);
});

const fails = {
  "no cart at Shop": [{ cart: null, variants: {} }, /no cart exists at Shop/],
  // Seen live: create_cart "succeeded" with an empty cart for a sold-out sock.
  "empty cart (sold out)": [{ cart: cart([], { messages: [{ type: "warning", code: "merchandise_out_of_stock" }] }), variants: {} }, /cart is empty \(merchandise_out_of_stock\)/],
  "wrong quantity": [{ cart: cart([line(9500, 2)]), variants: info({ Size: "M" }) }, /cart has 2 item\(s\), task asked for 1/],
  "wrong size": [{ cart: cart([line()]), variants: info({ Size: "L" }) }, /wrong size: wanted M, cart has Size=L/],
  "no size option at all": [{ cart: cart([line()]), variants: info({ Color: "Black" }) }, /wrong size: wanted M, cart has no size option/],
  "over budget": [{ cart: cart([line(12500)]), variants: info({ Size: "M" }) }, /over budget: \$125\.00 each, limit \$120\.00/],
  "wrong currency": [{ cart: cart([line()], { currency: "CAD" }), variants: info({ Size: "M" }) }, /currency CAD/],
  "sold out variant": [{ cart: cart([line()]), variants: info({ Size: "M" }, false) }, /sold out/],
};
for (const [name, [state, reason]] of Object.entries(fails)) {
  test(`fails: ${name}`, () => {
    const r = judgeShopTruth(task, state);
    assert.equal(r.success, false);
    assert.match(r.reason, reason);
  });
}

test("color only in the product title counts (seen live), size never does", () => {
  const blackTask = { expected: { quantity: 1, options: { size: "L", color: "Black" } } };
  const hoodie = { [V]: { options: [{ name: "Size", label: "L" }], title: "Tyson Oversized Heavyweight Hoodie - Black | Tyson Oversized Heavyweight Hoodie - Black - L", available: true } };
  assert.deepEqual(judgeShopTruth(blackTask, { cart: cart([line(2200)]), variants: hoodie }), { success: true, reason: "cart matches task" });
  const grey = { [V]: { ...hoodie[V], title: "Tyson Hoodie - Grey" } };
  assert.match(judgeShopTruth(blackTask, { cart: cart([line(2200)]), variants: grey }).reason, /wrong color: wanted Black, cart has no color option and title "Tyson Hoodie - Grey" doesn't say Black/);
  // "Blackberry" is not "Black".
  assert.equal(optionMatches([], "color", "Black", "Blackberry Hoodie").ok, false);
  // Size from a title is never accepted.
  assert.equal(optionMatches([], "size", "L", "Hoodie - Black - L").ok, false);
});

test("variant we can't look up is 'unknown', not a guess", () => {
  const r = judgeShopTruth(task, { cart: cart([line()]), variants: {} });
  assert.equal(r.success, null);
});

test("quantity counts across lines", () => {
  const two = { expected: { quantity: 2 } };
  const vs = { ...info({}), "gid://shopify/ProductVariant/2": { options: [], available: true } };
  assert.equal(judgeShopTruth(two, { cart: cart([line(), line(9500, 1, "gid://shopify/ProductVariant/2")]), variants: vs }).success, true);
});
