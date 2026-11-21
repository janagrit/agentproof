// Runs every system on every recording, scores each generated test with
// mutation testing, and writes rec2test/out/<tag>/results.md + results.json.
//
// Usage:
//   node rec2test/eval.mjs                 # all systems, all recordings
//   node rec2test/eval.mjs --system pipeline --only checkout_misclick
//   node rec2test/eval.mjs --tag v2        # label this run (keep v1 results for the before/after slide)
import "dotenv/config";
import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { SYSTEMS } from "./systems.mjs";
import { scoreSpec, MUTANTS } from "./score.mjs";
import { parseCli } from "../src/cli.mjs";
import { rootPath } from "../src/paths.mjs";
import { requireModels } from "../src/gemini.mjs";

const args = parseCli({ flags: ["regen"], options: { tag: "v1", system: undefined, only: undefined } });
const tag = args.tag;
const systems = args.system ? [args.system] : Object.keys(SYSTEMS);
const unknown = systems.filter(s => !SYSTEMS[s]);
if (unknown.length) { console.error(`Unknown system(s): ${unknown.join(", ")}. Known: ${Object.keys(SYSTEMS).join(", ")}`); process.exit(1); }

const recDir = rootPath("rec2test", "recordings");
const recordings = readdirSync(recDir)
  .filter(f => f.endsWith(".mp4"))
  .filter(f => !args.only || f.startsWith(args.only));
if (!recordings.length) { console.error(`No .mp4 recordings in ${recDir}`); process.exit(1); }

// Generated specs live under rec2test/ so Playwright's testDir finds them.
const outDir = rootPath("rec2test", "out", tag);
const specFor = (sys, rec) => path.join(outDir, sys, rec.replace(/\.mp4$/, ""), "generated.spec.ts");
const toGenerate = systems.filter(sys => recordings.some(rec => args.regen || !existsSync(specFor(sys, rec))));
if (toGenerate.length) {
  try { requireModels(...new Set(toGenerate.flatMap(s => (s === "baseline" ? ["baseline"] : ["perceive", "author"])))); }
  catch (e) { console.error(e.message); process.exit(1); }
}

const dom = readFileSync(rootPath("app", "index.html"), "utf8").replace(/<script>[\s\S]*<\/script>/, ""); // markup only, no logic
const results = [];

for (const sys of systems) {
  for (const rec of recordings) {
    const name = rec.replace(/\.mp4$/, "");
    const spec = specFor(sys, rec);
    const workDir = path.dirname(spec);
    mkdirSync(workDir, { recursive: true });
    process.stdout.write(`[${sys}] ${name} ... `);
    const t0 = Date.now();
    let row = { system: sys, recording: name };
    try {
      if (!existsSync(spec) || args.regen) {
        writeFileSync(spec, await SYSTEMS[sys](path.join(recDir, rec), dom, workDir));
      }
      const s = await scoreSpec(spec);
      row = { ...row, ...s, seconds: Math.round((Date.now() - t0) / 1000) };
      console.log(s.valid ? `valid, killed ${s.killed.length}/${MUTANTS.length}` : "INVALID (fails on clean app)");
    } catch (e) {
      row = { ...row, valid: false, error: String(e.message || e), killed: [], survived: [] };
      console.log("ERROR", e.message);
    }
    results.push(row);
    writeFileSync(path.join(workDir, "score.json"), JSON.stringify(row, null, 2));
  }
}

// Summary table
const lines = [`# Results (${tag})`, "", "| System | Valid tests | Mutation score | Bugs caught |", "|---|---|---|---|"];
for (const sys of systems) {
  const rows = results.filter(r => r.system === sys);
  const valid = rows.filter(r => r.valid).length;
  const killed = rows.reduce((n, r) => n + r.killed.length, 0);
  const possible = rows.length * MUTANTS.length;
  const pct = possible ? ((100 * killed) / possible).toFixed(1) : "0";
  lines.push(`| ${sys} | ${valid}/${rows.length} | ${pct}% | ${killed}/${possible} |`);
}
lines.push("", "## Which bugs slipped through most", "", "| Mutant | Survived (all systems) |", "|---|---|");
for (const m of MUTANTS) {
  const n = results.filter(r => r.valid && r.survived.includes(m.id)).length;
  lines.push(`| ${m.id}: ${m.desc} | ${n} |`);
}
lines.push("", "## Per recording", "", "| System | Recording | Valid | Killed |", "|---|---|---|---|");
for (const r of results) lines.push(`| ${r.system} | ${r.recording} | ${r.valid ? "yes" : "no"} | ${r.killed.length}/${MUTANTS.length} |`);

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "results.md"), lines.join("\n") + "\n");
writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
console.log("\n" + lines.slice(0, 2 + 2 + systems.length).join("\n"));
