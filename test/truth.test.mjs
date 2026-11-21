import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeTruth } from "../agentproof/truth.mjs";

const task = { expected: { items: { mug: 2 }, total: 21.6 } };
const ok = { items: { mug: 2 }, total: 21.6, code: "SAVE10" };

test("happy path: one matching order", () => {
  assert.deepEqual(judgeTruth(task, [ok]), { success: true, reason: "order matches task" });
});

test("float noise within 0.001 still matches", () => {
  assert.equal(judgeTruth(task, [{ ...ok, total: 21.600000000000001 }]).success, true);
});

test("zero-quantity keys do not count as extra items", () => {
  assert.equal(judgeTruth(task, [{ ...ok, items: { mug: 2, tee: 0 } }]).success, true);
});

const failures = {
  "no order": [],
  "two orders": [ok, ok],
  "wrong items": [{ ...ok, items: { cap: 2 } }],
  "extra item": [{ ...ok, items: { mug: 2, tee: 1 } }],
  "wrong qty": [{ ...ok, items: { mug: 1 } }],
  "wrong total (discount not applied)": [{ ...ok, total: 24 }],
  "off by a cent": [{ ...ok, total: 21.61 }],
  // These were judged SUCCESS before the fix: NaN comparisons are always false.
  "missing total": [{ items: { mug: 2 } }],
  "NaN total": [{ ...ok, total: NaN }],
  "string total": [{ ...ok, total: "21.60" }],
  "malformed body": [{ malformed: "{not json" }],
  "missing items": [{ total: 21.6 }],
  "array items": [{ ...ok, items: [] }],
  "fractional qty": [{ ...ok, items: { mug: 2.5 } }],
  "negative qty": [{ ...ok, items: { mug: 2, tee: -1 } }],
  "null order": [null],
};

for (const [name, orders] of Object.entries(failures)) {
  test(`fails: ${name}`, () => {
    const r = judgeTruth(task, orders);
    assert.equal(r.success, false, `expected failure, got ${JSON.stringify(r)}`);
    assert.ok(r.reason.length > 0);
  });
}

test("orders not an array is a failure, not a crash", () => {
  assert.equal(judgeTruth(task, undefined).success, false);
});
