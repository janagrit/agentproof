import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseClaim, harToNetwork } from "../agentproof/managed-lib.mjs";

test("parseClaim: JSON on the last line", () => {
  const out = 'Installing playwright...\nDone.\n{"success": true, "claim": "Bought 2 mugs for $21.60"}';
  assert.deepEqual(parseClaim(out), { success: true, claim: "Bought 2 mugs for $21.60" });
});

test("parseClaim: takes the LAST claim when there are several", () => {
  const out = '{"success": false, "claim": "first try"}\nretrying\n{"success": true, "claim": "second try"}\n';
  assert.equal(parseClaim(out).claim, "second try");
});

test("parseClaim: skips unparseable lines", () => {
  const out = '{"success": true, "claim": "ok"}\n{"success": tru, broken}';
  assert.deepEqual(parseClaim(out), { success: true, claim: "ok" });
});

test("parseClaim: success must be literally true", () => {
  assert.equal(parseClaim('{"success": "yes", "claim": "x"}').success, false);
});

test("parseClaim: no JSON at all", () => {
  const r = parseClaim("I could not reach the store.");
  assert.equal(r.success, false);
  assert.match(r.claim, /^\(no JSON claim\) I could not reach/);
  assert.equal(parseClaim().success, false);
});

test("harToNetwork", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "agentproof-har-"));
  try {
    const har = path.join(dir, "session.har");
    writeFileSync(har, JSON.stringify({ log: { entries: [
      { request: { method: "GET", url: "https://abc.trycloudflare.com/" }, response: { status: 200 } },
      { request: { method: "POST", url: "https://abc.trycloudflare.com/api/order" }, response: { status: 201 } },
    ] } }));
    assert.deepEqual(harToNetwork(har), [
      { method: "GET", url: "/", status: 200 },
      { method: "POST", url: "/api/order", status: 201 },
    ]);
    writeFileSync(har, "not json");
    assert.equal(harToNetwork(har), null);
    assert.equal(harToNetwork(path.join(dir, "missing.har")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
