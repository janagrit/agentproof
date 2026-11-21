// Checks tasks.json against the real store, so a typo in an expected total or
// a mock_plan step can't silently corrupt the answer key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rootPath } from "../src/paths.mjs";
import { ALL_TASKS, ALL_MUTANTS, DEFAULT_MUTANTS, loadTasks, loadMutants } from "../agentproof/tasks.mjs";

const html = readFileSync(rootPath("app", "index.html"), "utf8");
// Read prices from the store's own code so this test can't drift from it.
const PRICES = JSON.parse(html.match(/const PRICES = (\{[^}]*\})/)[1].replace(/(\w+):/g, '"$1":'));
const SKUS = Object.keys(PRICES);
const STATIC_IDS = new Set([...html.matchAll(/data-testid="([^"$]+)"/g)].map(m => m[1]));
const DYNAMIC = new RegExp(`^(inc|dec|remove|qty|cart-item)-(${SKUS.join("|")})$`);

test("store prices parsed", () => {
  assert.deepEqual(PRICES, { mug: 12, tee: 20, cap: 15 });
});

test("task ids are unique", () => {
  const ids = ALL_TASKS.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

for (const t of ALL_TASKS) {
  test(`${t.id}: expected total matches store prices`, () => {
    for (const sku of Object.keys(t.expected.items)) assert.ok(SKUS.includes(sku), `unknown sku ${sku}`);
    const subtotal = Object.entries(t.expected.items).reduce((s, [sku, q]) => s + PRICES[sku] * q, 0);
    const discounted = /SAVE10/.test(t.instruction);
    const want = Number((subtotal * (discounted ? 0.9 : 1)).toFixed(2));
    assert.equal(t.expected.total, want);
  });

  test(`${t.id}: every mock_plan step targets a real element`, () => {
    assert.ok(Array.isArray(t.mock_plan) && t.mock_plan.length > 0);
    for (const [action, testid] of t.mock_plan) {
      assert.ok(["click", "fill"].includes(action), `bad action ${action}`);
      assert.ok(STATIC_IDS.has(testid) || DYNAMIC.test(testid), `no element with data-testid=${testid}`);
    }
  });
}

test("default mutants all exist in app/mutants.json", () => {
  assert.deepEqual(loadMutants(undefined), DEFAULT_MUTANTS);
  for (const m of DEFAULT_MUTANTS) if (m !== "none") assert.ok(ALL_MUTANTS.includes(m), m);
});

test("every mutant id is implemented in the store", () => {
  for (const m of ALL_MUTANTS) assert.ok(html.includes(`"${m}"`), `mutant ${m} is not referenced in index.html`);
});

test("unknown task or mutant names fail loudly", () => {
  assert.throws(() => loadTasks(["one_te"]), /Unknown task/);
  assert.throws(() => loadMutants(["discount_not_aplied"]), /Unknown mutant/);
  assert.deepEqual(loadTasks(["one_tee"]).map(t => t.id), ["one_tee"]);
});
