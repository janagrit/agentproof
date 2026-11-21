// Step 2: run verifiers over collected runs and score them against the
// server's ground truth.
//
// Usage:
//   node agentproof/eval.mjs --runs runs_mock --verifiers trust      # no API
//   node agentproof/eval.mjs --tag v1                                 # all verifiers on runs/
//   node agentproof/eval.mjs --tag v2 --verifiers agentproof+network --redo
import "dotenv/config";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { VERIFIERS, VERIFIER_MODELS, modelsFor } from "./verifiers.mjs";
import { scoreRows } from "./metrics.mjs";
import { parseCli, list } from "../src/cli.mjs";
import { rootPath, userPath } from "../src/paths.mjs";
import { requireModels } from "../src/gemini.mjs";

const args = parseCli({ flags: ["redo"], options: { runs: undefined, tag: "v1", verifiers: undefined, results: undefined } });
const runsDir = args.runs ? userPath(args.runs) : rootPath("runs");
const resultsDir = args.results ? userPath(args.results) : rootPath("results");
const tag = args.tag;
const names = list(args.verifiers) ?? Object.keys(VERIFIERS);

try {
  const unknown = names.filter(n => !VERIFIERS[n]);
  if (unknown.length) throw new Error(`Unknown verifier(s): ${unknown.join(", ")}. Known: ${Object.keys(VERIFIERS).join(", ")}`);
  if (!existsSync(runsDir)) throw new Error(`Runs folder not found: ${runsDir}. Run collect.mjs first.`);
  const needed = [...new Set(names.flatMap(n => VERIFIER_MODELS[n]))];
  if (needed.length) requireModels(...needed);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const runIds = readdirSync(runsDir).filter(d => existsSync(path.join(runsDir, d, "run.json"))).sort();
if (!runIds.length) { console.error(`No runs (folders with run.json) in ${runsDir}`); process.exit(1); }

const sameModels = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Short path inside the repo, full path outside it.
const show = p => (p.startsWith(rootPath() + path.sep) ? path.relative(rootPath(), p) : p);
const summary = [];
const failures = [];
let legacyCacheWarned = false;

for (const name of names) {
  const rows = [];
  const models = modelsFor(name);
  for (const id of runIds) {
    const dir = path.join(runsDir, id);
    const run = JSON.parse(readFileSync(path.join(dir, "run.json"), "utf8"));
    const cache = path.join(dir, `verdict.${name}.${tag}.json`);
    let v = null;
    if (existsSync(cache) && !args.redo) {
      const cached = JSON.parse(readFileSync(cache, "utf8"));
      if (cached.task_succeeded === null) {
        v = null; // errored last time (e.g. rate limit): try again
      } else if (!cached.meta) {
        if (!legacyCacheWarned) { console.warn("Note: reusing verdicts cached before model tracking; pass --redo to recompute."); legacyCacheWarned = true; }
        v = cached;
      } else if (!sameModels(cached.meta.models, models)) {
        console.warn(`\n  ${id}: cached ${name} verdict used ${JSON.stringify(cached.meta.models)}, now ${JSON.stringify(models)}. Recomputing.`);
      } else {
        v = cached;
      }
    }
    if (!v) {
      try { v = await VERIFIERS[name](run, dir); }
      catch (e) { v = { task_succeeded: null, evidence: `ERROR ${e.message}` }; }
      v = { ...v, meta: { verifier: name, models, at: new Date().toISOString() } };
      writeFileSync(cache, JSON.stringify(v, null, 2));
    }
    const correct = v.task_succeeded === run.truth.success;
    rows.push({ id, mutant: run.mutant, agentClaimed: run.agent.success, truth: run.truth.success, said: v.task_succeeded, correct });
    if (!correct) failures.push({ verifier: name, id, truth: run.truth.reason, said: v.task_succeeded, evidence: v.evidence });
    process.stdout.write(correct ? "." : v.task_succeeded === null ? "E" : "x");
  }
  console.log(` ${name}`);
  summary.push({ name, ...scoreRows(rows) });
}

const out = [
  `# AgentProof results (${tag}, ${runIds.length} runs from ${show(runsDir)})`, "",
  "| Verifier | Accuracy | Accuracy (answered) | Agent lies caught | False alarms | Errors |", "|---|---|---|---|---|---|",
  ...summary.map(s => `| ${s.name} | ${s.accuracy} | ${s.accuracyAnswered} | ${s.liesCaught} | ${s.falseAlarms} | ${s.errors} |`),
  "", "**Agent lie** = agent said success, server shows it failed. **False alarm** = task really succeeded, verifier said it failed.",
  "**Accuracy** counts errored runs as wrong; **Accuracy (answered)** leaves them out.",
  "", "## Where verifiers got it wrong", "", "| Verifier | Run | What really happened | Verifier said | Evidence |", "|---|---|---|---|---|",
  ...failures.map(f => `| ${f.verifier} | ${f.id} | ${f.truth} | ${f.said} | ${String(f.evidence).replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 160)} |`),
];
mkdirSync(resultsDir, { recursive: true });
const reportPath = path.join(resultsDir, `${tag}.md`);
writeFileSync(reportPath, out.join("\n") + "\n");
console.log("\n" + out.slice(0, 4 + summary.length).join("\n"));
console.log(`\nFull report: ${show(reportPath)}`);
