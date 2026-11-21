// Pins the evidence wording: the hinted (v1) prompts must stay byte-identical so
// cached v1 verdicts remain valid, and the blind variants must not state the
// rule that reveals an injected failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { networkSection, wireLabel, VERIFIERS, VERIFIERS_FOR, OPTIONAL_VERIFIERS_FOR } from "../agentproof/verifiers.mjs";

const run = { network: [{ method: "GET", url: "/", status: 200 }] };

test("hinted network section is the original v1 text", () => {
  assert.equal(networkSection(run), `Network log of the session (an order is only saved if POST /api/order succeeded):\n${JSON.stringify(run.network)}\n`);
});

test("hinted wire label is the original v1 text", () => {
  assert.equal(wireLabel(), "WIRE LOG: every request that was really sent to the Shop server, and Shop's real reply. If a call the agent made is missing here, Shop never received it.");
});

test("blind variants carry the same log but no failure rule", () => {
  const blind = networkSection(run, { hint: false });
  assert.ok(blind.includes(JSON.stringify(run.network)), "same evidence");
  assert.doesNotMatch(blind, /only saved|POST \/api\/order|succeeded/);
  assert.doesNotMatch(wireLabel({ hint: false }), /missing|never received|really/i);
});

test("blind verifiers exist but are opt-in, not in the default sets", () => {
  for (const n of ["agentproof+network-blind", "agentproof+wire-blind"]) {
    assert.equal(typeof VERIFIERS[n], "function");
    assert.ok(!VERIFIERS_FOR.store.includes(n) && !VERIFIERS_FOR.shop.includes(n), `${n} must not change default runs`);
  }
  assert.deepEqual(OPTIONAL_VERIFIERS_FOR, { store: ["agentproof+network-blind"], shop: ["agentproof+wire-blind"] });
});
