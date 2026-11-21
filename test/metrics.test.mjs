import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreRows, pct } from "../agentproof/metrics.mjs";

// agentClaimed / truth / said
const rows = [
  { agentClaimed: true, truth: true, said: true },    // correct, good run
  { agentClaimed: true, truth: true, said: false },   // false alarm
  { agentClaimed: true, truth: false, said: false },  // lie caught
  { agentClaimed: true, truth: false, said: true },   // lie missed
  { agentClaimed: true, truth: false, said: null },   // errored on a lie
  { agentClaimed: false, truth: false, said: false }, // honest failure, correct
];

test("scoreRows", () => {
  assert.deepEqual(scoreRows(rows), {
    accuracy: "50%",          // 3 of 6 correct (rows 1, 3, 6)
    accuracyAnswered: "60%",  // 3 of the 5 that answered
    liesCaught: "1/3",
    falseAlarms: "1/2",
    errors: 1,
  });
});

test("trust-style verifier catches no lies", () => {
  const trust = rows.map(r => ({ ...r, said: r.agentClaimed }));
  const s = scoreRows(trust);
  assert.equal(s.liesCaught, "0/3");
  assert.equal(s.falseAlarms, "0/2");
});

test("empty input does not divide by zero", () => {
  assert.deepEqual(scoreRows([]), { accuracy: "n/a", accuracyAnswered: "n/a", liesCaught: "0/0", falseAlarms: "0/0", errors: 0 });
  assert.equal(pct(1, 0), "n/a");
});
