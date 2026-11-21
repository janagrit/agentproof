// No network: tests the pure helpers in src/gemini.mjs and verifiers.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelJSON, withRetry, isRetryable, requireModels } from "../src/gemini.mjs";
import { asVerdict } from "../agentproof/verifiers.mjs";

test("parseModelJSON: bare, fenced, with prose, arrays", () => {
  assert.deepEqual(parseModelJSON('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJSON('```\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJSON('Here you go:\n{"task_succeeded": false, "evidence": "x"}\nHope that helps'), { task_succeeded: false, evidence: "x" });
  assert.deepEqual(parseModelJSON("  [1,2]  "), [1, 2]);
});

test("parseModelJSON: garbage throws with a preview", () => {
  assert.throws(() => parseModelJSON("I could not watch the video."), /did not return valid JSON: I could not/);
  assert.throws(() => parseModelJSON(""), /valid JSON/);
  assert.throws(() => parseModelJSON(undefined), /valid JSON/);
});

const noWait = async () => {};
const quiet = fn => async () => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test("withRetry: succeeds after a 429", quiet(async () => {
  let calls = 0;
  const r = await withRetry(async () => { calls++; if (calls < 3) throw Object.assign(new Error("rate"), { status: 429 }); return "ok"; }, { wait: noWait });
  assert.equal(r, "ok");
  assert.equal(calls, 3);
}));

test("withRetry: gives up after `tries` attempts", quiet(async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw Object.assign(new Error("down"), { status: 503 }); }, { tries: 4, wait: noWait }), /down/);
  assert.equal(calls, 4);
}));

test("withRetry: does not retry a 400", quiet(async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw Object.assign(new Error("bad request"), { status: 400 }); }, { wait: noWait }), /bad request/);
  assert.equal(calls, 1);
}));

test("withRetry: backoff grows", quiet(async () => {
  const waits = [];
  await assert.rejects(withRetry(async () => { throw Object.assign(new Error("x"), { status: 500 }); }, { tries: 4, baseMs: 100, wait: async ms => waits.push(ms) }));
  assert.equal(waits.length, 3);
  assert.ok(waits[0] >= 75 && waits[0] <= 125, `first wait ${waits[0]}`);
  assert.ok(waits[2] >= 300 && waits[2] <= 500, `third wait ${waits[2]}`);
}));

test("isRetryable", () => {
  for (const s of [408, 429, 500, 503]) assert.equal(isRetryable({ status: s }), true, String(s));
  for (const s of [400, 401, 403, 404]) assert.equal(isRetryable({ status: s }), false, String(s));
  assert.equal(isRetryable(new TypeError("fetch failed")), true);
  assert.equal(isRetryable(new Error("Model ID missing")), false);
});

test("requireModels names what is missing", () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.throws(() => requireModels("perceive"), /GEMINI_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test("asVerdict only accepts real booleans", () => {
  assert.equal(asVerdict({ task_succeeded: false, evidence: "total was $24" }).task_succeeded, false);
  assert.equal(asVerdict({ task_succeeded: "false" }).task_succeeded, null);
  assert.equal(asVerdict({}).task_succeeded, null);
  assert.equal(asVerdict(null).task_succeeded, null);
  assert.deepEqual(asVerdict({ task_succeeded: true, evidence: "ok" }, { timeline: [] }), { task_succeeded: true, evidence: "ok", timeline: [] });
});
