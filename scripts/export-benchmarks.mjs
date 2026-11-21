// Exports sanitized, committable benchmark data to benchmarks/ so others can
// check the README numbers without the raw local evidence.
//   node scripts/export-benchmarks.mjs
// Reads (never modifies) runs/, runs_shop/, runs_trial2/ and results/.
// Every value goes through redact(); the export is refused if anything
// key- or token-shaped survives. Videos and screenshots stay local.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rootPath } from "../src/paths.mjs";
import { redact } from "../src/shop-mcp.mjs";

const OUT = rootPath("benchmarks");
// Anything that looks like a credential or a live cart/line token.
export const SECRET = /AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_.-]{30,}|[?&](?:key|cart)=(?!\[REDACTED\])[^&"\s|)]+|GEMINI_API_KEY=[^\s"]{8,}|Bearer [A-Za-z0-9._-]{20,}|continue_url"\s*:\s*"http/;

function verdicts(dir) {
  const out = {};
  for (const f of readdirSync(dir)) {
    const m = f.match(/^verdict\.(.+)\.([^.]+)\.json$/);
    if (!m) continue;
    const v = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    (out[m[2]] ??= {})[m[1]] = { task_succeeded: v.task_succeeded, evidence: v.evidence ?? "", models: v.meta?.models ?? null };
  }
  return out; // { tag: { verifier: {...} } }
}

function exportRuns(folder, pick) {
  const dir = rootPath(folder);
  if (!existsSync(dir)) return null;
  return readdirSync(dir).sort()
    .filter(d => existsSync(path.join(dir, d, "run.json")))
    .map(d => {
      const r = JSON.parse(readFileSync(path.join(dir, d, "run.json"), "utf8"));
      return { ...pick(r), verdicts: verdicts(path.join(dir, d)) };
    });
}

const store = r => ({
  id: r.id, task: r.task, bug: r.mutant, agentModel: r.agentModel ?? null, seconds: r.seconds,
  agent: { success: r.agent.success, claim: r.agent.claim, steps: r.agent.steps },
  truth: r.truth, orders: r.orders, network: r.network,
});
const shop = r => ({
  id: r.id, task: r.task, fault: r.fault, agentModel: r.agentModel ?? null, seconds: r.seconds,
  agent: { success: r.agent.success, claim: r.agent.claim },
  truth: r.truth, cart: r.cart, tools: r.tools, wire: r.wire,
});

const files = {};
const datasets = [
  ["store-runs.json", "runs", store],
  ["store-trial2-runs.json", "runs_trial2", store],
  ["shop-runs.json", "runs_shop", shop],
];
for (const [name, folder, pick] of datasets) {
  const runs = exportRuns(folder, pick);
  if (runs) files[name] = JSON.stringify({ source: folder, count: runs.length, runs: redact(runs) }, null, 1) + "\n";
}
for (const dir of [rootPath("results"), rootPath("results", "trial2")]) {
  if (!existsSync(dir)) continue;
  const prefix = dir.endsWith("trial2") ? "trial2-" : "";
  for (const f of readdirSync(dir).filter(f => f.endsWith(".md"))) files[`reports/${prefix}${f}`] = redact(readFileSync(path.join(dir, f), "utf8"));
}

const leaks = Object.entries(files).filter(([, text]) => SECRET.test(text)).map(([n]) => n);
if (leaks.length) {
  console.error(`REFUSED: secret-shaped text found in ${leaks.join(", ")}. Nothing written.`);
  process.exit(1);
}
mkdirSync(path.join(OUT, "reports"), { recursive: true });
for (const [name, text] of Object.entries(files)) writeFileSync(path.join(OUT, name), text);
console.log(`Wrote ${Object.keys(files).length} files to benchmarks/ (0 secret-shaped strings):`);
for (const [name, text] of Object.entries(files)) console.log(`  ${name.padEnd(34)} ${(text.length / 1024).toFixed(0)} KB`);
