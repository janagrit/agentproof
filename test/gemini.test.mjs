// No network: tests the pure helpers in src/gemini.mjs and verifiers.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelJSON, withRetry, isRetryable, requireModels, extractText, decide, DECISIONS_URL } from "../src/gemini.mjs";
import { asVerdict, asDecisionVerdict } from "../agentproof/verifiers.mjs";

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

test("extractText skips thought parts and concatenates real reply parts", () => {
  assert.equal(extractText({
    candidates: [{ content: { parts: [
      { thought: true, text: "internal scratchpad" },
      { text: '{"task_succeeded":' },
      { text: " false}" },
    ] } }],
    text: "fallback",
  }), '{"task_succeeded": false}');
  assert.equal(extractText({ text: '{"a":1}' }), '{"a":1}');
  assert.equal(extractText({}), "");
});

test("decide sends POST /v1beta/decisions, retries 429, strips thought, and does not retry 400", quiet(async () => {
  const seen = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    n++;
    if (n === 1) return { ok: false, status: 429, text: async () => '{"error":{"message":"rate limit"}}' };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        answers: {
          task_succeeded: { type: "noul", noul: 0.04, confidence: 0.96, thought: "hidden" },
          failure_mode: { type: "choice", choice: "wrong_total", confidence: 0.95 },
        },
        usage: { total_input_tokens: 250, total_output_tokens: 0 },
      }),
    };
  };
  const out = await decide("sample input", { task_succeeded: { type: "noul", instructions: "ok?" } }, {
    apiKey: "FAKE_TEST_KEY",
    model: "gemini-decision-1",
    fetchImpl,
    retry: { wait: noWait },
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, DECISIONS_URL);
  assert.equal(seen[0].init.headers["x-goog-api-key"], "FAKE_TEST_KEY");
  assert.deepEqual(JSON.parse(seen[0].init.body), {
    model: "gemini-decision-1",
    input: "sample input",
    questions: { task_succeeded: { type: "noul", instructions: "ok?" } },
  });
  assert.equal("thought" in out.answers.task_succeeded, false);
  assert.equal(out.usage.total_output_tokens, 0);

  const v = asDecisionVerdict(out, "Total was $24 instead of $21.60.");
  assert.equal(v.task_succeeded, false);
  assert.match(v.evidence, /P\(succeeded\)=4\.0%, conf=96\.0%, mode=wrong_total/);
  assert.match(v.evidence, /Total was \$24/);

  let badCalls = 0;
  await assert.rejects(
    decide("x", {}, {
      apiKey: "FAKE_TEST_KEY",
      fetchImpl: async () => { badCalls++; return { ok: false, status: 400, text: async () => '{"error":{"message":"bad field"}}' }; },
      retry: { wait: noWait },
    }),
    /HTTP 400: bad field/
  );
  assert.equal(badCalls, 1);
}));

test("asDecisionVerdict treats missing or invalid noul probability as null error", () => {
  assert.equal(asDecisionVerdict({}).task_succeeded, null);
  assert.equal(asDecisionVerdict({ answers: { task_succeeded: { noul: "0.9" } } }).task_succeeded, null);
  assert.equal(asDecisionVerdict({ answers: { task_succeeded: { noul: 0.85, confidence: 0.85 } } }).task_succeeded, true);
});
