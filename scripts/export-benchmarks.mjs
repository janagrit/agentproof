// Exports sanitized, committable benchmark data to benchmarks/ and static
// viewer data to docs/demo-data.json so others can inspect all runs on GitHub
// and https://janagrit.github.io/agentproof/ without local run folders.
//   node scripts/export-benchmarks.mjs
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rootPath } from "../src/paths.mjs";
import { redact } from "../src/shop-mcp.mjs";

const OUT = rootPath("benchmarks");
export const SECRET = /AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_.-]{30,}|[?&](?:key|cart)=(?!\[REDACTED\])[^&"\s|)]+|GEMINI_API_KEY=[^\s"]{8,}|Bearer [A-Za-z0-9._-]{20,}|continue_url"\s*:\s*"http/;

function verdicts(dir) {
  const out = {};
  for (const f of readdirSync(dir)) {
    const m = f.match(/^verdict\.(.+)\.([^.]+)\.json$/);
    if (!m) continue;
    const v = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    (out[m[2]] ??= {})[m[1]] = {
      task_succeeded: v.task_succeeded,
      evidence: v.evidence ?? "",
      models: v.meta?.models ?? null,
      ...(v.decision ? { decision: v.decision } : {}),
    };
  }
  return out;
}

function primaryVerdicts(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).sort()) {
    const m = f.match(/^verdict\.(.+)\.([^.]+)\.json$/);
    if (!m) continue;
    const [, verifier, tag] = m;
    const priority = /^(v1|shop_v1|decision_v1|shop_decision_v1|blind1|shop_blind1b|shop_blind1)$/.test(tag);
    try {
      const raw = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      const cur = out[verifier];
      if (!cur || (cur.task_succeeded === null && raw.task_succeeded !== null) || (priority && !(raw.task_succeeded === null && cur.task_succeeded !== null))) {
        out[verifier] = {
          task_succeeded: raw.task_succeeded,
          evidence: raw.evidence ?? "",
          tag,
          meta: { models: raw.meta?.models ?? null },
          ...(raw.decision ? { decision: raw.decision } : {}),
          ...(raw.usage ? { usage: raw.usage } : {}),
          ...(raw.timeline?.events ? { timeline: { events: raw.timeline.events } } : {}),
        };
      }
    } catch {}
  }
  // Keep timeline on a single verifier per run so demo-data.json stays compact.
  let keptTimeline = false;
  for (const k of ["agentproof+decision", "agentproof+network", "agentproof"]) {
    if (out[k]?.timeline) {
      if (keptTimeline) delete out[k].timeline;
      else keptTimeline = true;
    }
  }
  return out;
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

function exportViewerRuns(folder, kind) {
  const dir = rootPath(folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort()
    .filter(d => existsSync(path.join(dir, d, "run.json")))
    .map(d => {
      const runDir = path.join(dir, d);
      const r = JSON.parse(readFileSync(path.join(runDir, "run.json"), "utf8"));
      return redact({
        kind,
        id: r.id,
        task: r.task,
        mutant: r.mutant ?? r.fault ?? "none",
        instruction: r.instruction,
        agentModel: r.agentModel ?? null,
        seconds: r.seconds,
        hasVideo: kind === "store" && existsSync(path.join(runDir, "video.mp4")),
        agent: { success: Boolean(r.agent?.success), claim: r.agent?.claim ?? "" },
        truth: r.truth,
        ...(kind === "shop" ? { tools: r.tools, wire: r.wire } : { network: r.network }),
        verdicts: primaryVerdicts(runDir),
      });
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
  for (const f of readdirSync(dir).filter(f => f.endsWith(".md"))) {
    const clean = readFileSync(path.join(dir, f), "utf8").replaceAll(rootPath() + path.sep, "");
    files[`reports/${prefix}${f}`] = redact(clean);
  }
}

const demoRuns = [...exportViewerRuns("runs", "store"), ...exportViewerRuns("runs_shop", "shop")];
const demoText = JSON.stringify({ runs: demoRuns }) + "\n";

const leaks = [
  ...Object.entries(files).filter(([, text]) => SECRET.test(text)).map(([n]) => n),
  ...(SECRET.test(demoText) ? ["docs/demo-data.json"] : []),
];
if (leaks.length) {
  console.error(`REFUSED: secret-shaped text found in ${leaks.join(", ")}. Nothing written.`);
  process.exit(1);
}
mkdirSync(path.join(OUT, "reports"), { recursive: true });
for (const [name, text] of Object.entries(files)) writeFileSync(path.join(OUT, name), text);
if (demoRuns.length) {
  mkdirSync(rootPath("docs"), { recursive: true });
  writeFileSync(rootPath("docs", "demo-data.json"), demoText);
}
console.log(`Wrote ${Object.keys(files).length} files to benchmarks/ + docs/demo-data.json (0 secret-shaped strings):`);
for (const [name, text] of Object.entries(files)) console.log(`  ${name.padEnd(34)} ${(text.length / 1024).toFixed(0)} KB`);
if (demoRuns.length) console.log(`  ${"docs/demo-data.json".padEnd(34)} ${(demoText.length / 1024).toFixed(0)} KB`);
