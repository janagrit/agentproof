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
import { VERIFIERS, VERIFIER_MODELS, VERIFIERS_FOR, modelsFor } from "./verifiers.mjs";
import { scoreRows } from "./metrics.mjs";
import { parseCli, list } from "../src/cli.mjs";
import { rootPath, userPath } from "../src/paths.mjs";
import { requireModels } from "../src/gemini.mjs";

const args = parseCli({ flags: ["redo"], options: { runs: undefined, tag: "v1", verifiers: undefined, results: undefined } });
const runsDir = args.runs ? userPath(args.runs) : rootPath("runs");
const resultsDir = args.results ? userPath(args.results) : rootPath("results");
const tag = args.tag;

if (!existsSync(runsDir)) { console.error(`Runs folder not found: ${runsDir}. Run collect.mjs first.`); process.exit(1); }
const allIds = readdirSync(runsDir).filter(d => existsSync(path.join(runsDir, d, "run.json"))).sort();
if (!allIds.length) { console.error(`No runs (folders with run.json) in ${runsDir}`); process.exit(1); }
const runOf = id => JSON.parse(readFileSync(path.join(runsDir, id, "run.json"), "utf8"));

// Store runs (video) and Shop runs (tool logs) need different verifiers.
const kinds = new Set(allIds.map(id => runOf(id).kind ?? "store"));
if (kinds.size > 1) { console.error(`${runsDir} mixes ${[...kinds].join(" and ")} runs. Keep them in separate folders.`); process.exit(1); }
const kind = [...kinds][0];
const names = list(args.verifiers) ?? VERIFIERS_FOR[kind];

try {
  const unknown = names.filter(n => !VERIFIERS[n]);
  if (unknown.length) throw new Error(`Unknown verifier(s): ${unknown.join(", ")}. Known: ${Object.keys(VERIFIERS).join(", ")}`);
  const wrongKind = names.filter(n => !VERIFIERS_FOR[kind].includes(n));
  if (wrongKind.length) throw new Error(`Verifier(s) ${wrongKind.join(", ")} don't fit ${kind} runs. Use: ${VERIFIERS_FOR[kind].join(", ")}`);
  const needed = [...new Set(names.flatMap(n => VERIFIER_MODELS[n]))];
  if (needed.length) requireModels(...needed);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// A run whose answer key could not be read (truth.success === null) can't be
// scored either way: leave it out and say so.
const unverifiable = allIds.filter(id => runOf(id).truth?.success === null);
const runIds = allIds.filter(id => !unverifiable.includes(id));
if (unverifiable.length) console.warn(`Leaving out ${unverifiable.length} run(s) with no verifiable answer key: ${unverifiable.join(", ")}`);
if (!runIds.length) { console.error("No scorable runs."); process.exit(1); }

const sameModels = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Short path inside the repo, full path outside it.
const show = p => (p.startsWith(rootPath() + path.sep) ? path.relative(rootPath(), p) : p);

// Which agent(s) produced these runs. Older runs did not record it.
const agentCounts = new Map();
for (const id of runIds) {
  const r = JSON.parse(readFileSync(path.join(runsDir, id, "run.json"), "utf8"));
  const m = r.agentModel ?? (r.managed ? `managed: ${r.managed}` : r.mock ? "mock" : "unknown");
  agentCounts.set(m, (agentCounts.get(m) ?? 0) + 1);
}
const agentLine = [...agentCounts].map(([m, n]) => `${m} (${n} run${n === 1 ? "" : "s"})`).join(", ");
const mixedAgents = agentCounts.size > 1;
// Every model the chosen verifiers use, e.g. "perceive=gemini-4-hydrogen, author=gemini-4-carbon".
const verifierModels = Object.entries(Object.assign({}, ...names.map(modelsFor))).map(([k, v]) => `${k}=${v}`).join(", ") || "none (trust only)";
console.log(`Agent:     ${agentLine}`);
console.log(`Verifiers: ${names.join(", ")}  [${verifierModels}]`);
if (mixedAgents) console.warn("WARNING: these runs come from more than one agent; the table mixes them.");
console.log("");
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
  `**Agent checked:** ${agentLine}${mixedAgents ? " — **warning: mixed agents**" : ""}  `,
  `**Verifier models:** ${verifierModels}  `,
  `**Run kind:** ${kind}${unverifiable.length ? ` · ${unverifiable.length} run(s) left out (answer key unreadable): ${unverifiable.join(", ")}` : ""}`, "",
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
// Title, agent + models, then the score table.
console.log("\n" + out.slice(0, 8 + summary.length).join("\n"));
console.log(`\nFull report: ${show(reportPath)}`);
