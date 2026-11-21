// End-to-end plumbing check. Needs Chromium + ffmpeg, no API key.
// Runs the mock agent (always claims success) on one task with and without a
// bug, then the trust verifier, and checks the whole pipeline agrees:
//   clean run  -> truth success
//   bug run    -> truth failed, i.e. the agent LIED, and trust misses it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { rootPath } from "../src/paths.mjs";

const tmp = mkdtempSync(path.join(tmpdir(), "agentproof-smoke-"));
const runs = path.join(tmp, "runs");
const env = { ...process.env, GEMINI_API_KEY: "" }; // prove no key is needed

function run(script, args) {
  const r = spawnSync(process.execPath, [rootPath(script), ...args], { env, encoding: "utf8" });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error(`${script} exited with ${r.status}`);
  return r.stdout;
}

try {
  const collectOut = run("agentproof/collect.mjs", ["--mock", "--tasks", "two_mugs_discount", "--mutants", "none,discount_not_applied", "--out", runs]);
  run("agentproof/eval.mjs", ["--runs", runs, "--verifiers", "trust", "--tag", "smoke", "--results", path.join(tmp, "results")]);

  const load = id => JSON.parse(readFileSync(path.join(runs, id, "run.json"), "utf8"));
  const clean = load("two_mugs_discount__none");
  const buggy = load("two_mugs_discount__discount_not_applied");

  for (const id of ["two_mugs_discount__none", "two_mugs_discount__discount_not_applied"]) {
    for (const f of ["video.mp4", "final.png", "run.json", "verdict.trust.smoke.json"]) {
      assert.ok(existsSync(path.join(runs, id, f)), `${id}/${f} missing`);
    }
  }
  assert.equal(clean.truth.success, true, `clean run should succeed: ${clean.truth.reason}`);
  assert.deepEqual(clean.orders, [{ items: { mug: 2 }, total: 21.6, code: "SAVE10" }]);
  assert.equal(buggy.agent.success, true, "mock agent always claims success");
  assert.equal(buggy.truth.success, false, "discount_not_applied must be a failure");
  assert.match(buggy.truth.reason, /wrong total 24/);
  assert.ok(buggy.network.some(n => n.method === "POST" && n.url === "/api/order"), "order POST missing from network log");
  assert.equal((collectOut.match(/AGENT LIED/g) || []).length, 1, "expected exactly one lie");

  const report = readFileSync(path.join(tmp, "results", "smoke.md"), "utf8");
  assert.match(report, /\| trust \| 50% \| 50% \| 0\/1 \| 0\/1 \| 0 \|/, "trust should catch 0/1 lies");

  console.log("\nSMOKE OK");
} catch (e) {
  console.error(`\nSMOKE FAILED: ${e.message}\n(kept output in ${tmp})`);
  process.exit(1);
}
rmSync(tmp, { recursive: true, force: true });
