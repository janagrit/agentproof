// Runs every system on every recording, scores each generated test with
// mutation testing, and writes out/results.md + out/results.json.
//
// Usage:
//   node src/eval.mjs                 # all systems, all recordings
//   node src/eval.mjs --system pipeline --only checkout_misclick
//   node src/eval.mjs --tag v2        # label this run (keep v1 results for the before/after slide)
import "dotenv/config";
import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { SYSTEMS } from "./systems.mjs";
import { scoreSpec, MUTANTS } from "./score.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const tag = args.tag || "v1";
const systems = args.system ? [args.system] : Object.keys(SYSTEMS);
const recordings = readdirSync("rec2test_recordings")
  .filter(f => f.endsWith(".mp4"))
  .filter(f => !args.only || f.startsWith(args.only));

const dom = readFileSync("app/index.html", "utf8").replace(/<script>[\s\S]*<\/script>/, ""); // markup only, no logic
const results = [];

for (const sys of systems) {
  for (const rec of recordings) {
    const name = rec.replace(/\.mp4$/, "");
    const workDir = path.join("out", tag, sys, name);
    mkdirSync(workDir, { recursive: true });
    const spec = path.join(workDir, "generated.spec.ts");
    process.stdout.write(`[${sys}] ${name} ... `);
    const t0 = Date.now();
    let row = { system: sys, recording: name };
    try {
      if (!existsSync(spec) || args.regen) {
        writeFileSync(spec, await SYSTEMS[sys](path.join("rec2test_recordings", rec), dom, workDir));
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

mkdirSync(path.join("out", tag), { recursive: true });
writeFileSync(path.join("out", tag, "results.md"), lines.join("\n") + "\n");
writeFileSync(path.join("out", tag, "results.json"), JSON.stringify(results, null, 2));
console.log("\n" + lines.slice(0, 2 + 2 + systems.length).join("\n"));
