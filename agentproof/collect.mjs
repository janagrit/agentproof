// Step 1: collect agent runs. Each run = one task on the app with one mutant
// (or none). Saves video, network log, the agent's claim, and the ground truth
// from the server's order log. Run this once, then iterate on verifiers.
//
// Usage:
//   node agentproof/collect.mjs --mock                     # plumbing test, no API
//   node agentproof/collect.mjs                            # real Gemini agent
//   node agentproof/collect.mjs --mutants none,order_silently_fails --tasks one_tee
import "dotenv/config";
import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import { startServer } from "../app/server.mjs";
import { runGeminiAgent, runMockAgent, saveJSON } from "./agent.mjs";
import { judgeTruth } from "./truth.mjs";
import { loadTasks, loadMutants } from "./tasks.mjs";
import { parseCli, list } from "../src/cli.mjs";
import { rootPath, userPath } from "../src/paths.mjs";
import { hasFfmpeg, toMp4 } from "../src/media.mjs";
import { requireModels, MODELS } from "../src/gemini.mjs";

const args = parseCli({ flags: ["mock", "redo", "headed"], options: { out: undefined, tasks: undefined, mutants: undefined } });
const mock = args.mock;
const outRoot = args.out ? userPath(args.out) : rootPath(mock ? "runs_mock" : "runs");
// Which agent produced these runs. Saved in every run.json and shown in the eval report.
const agentModel = mock ? "mock" : MODELS.agent;

let TASKS, MUTANTS;
try {
  TASKS = loadTasks(list(args.tasks));
  MUTANTS = loadMutants(list(args.mutants));
  if (!hasFfmpeg()) throw new Error("ffmpeg not found on PATH (needed to convert recordings to .mp4). macOS: brew install ffmpeg");
  if (!mock) requireModels("agent");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

console.log(`Agent: ${agentModel}${mock ? " (scripted mock, always claims success)" : " (from MODEL_AGENT)"}`);
console.log(`Runs:  ${TASKS.length} task(s) x ${MUTANTS.length} bug setting(s) -> ${outRoot}\n`);

// Warn before mixing agents in one folder: kept runs from another agent would
// end up in the same results table.
if (existsSync(outRoot)) {
  const others = new Map();
  for (const d of readdirSync(outRoot)) {
    const f = path.join(outRoot, d, "run.json");
    if (!existsSync(f)) continue;
    let m;
    try { m = JSON.parse(readFileSync(f, "utf8")).agentModel ?? "unknown (recorded before agentModel was saved)"; } catch { continue; }
    if (m !== agentModel) others.set(m, (others.get(m) ?? 0) + 1);
  }
  for (const [m, n] of others) {
    console.warn(`WARNING: ${outRoot} already has ${n} run(s) from agent ${m}.`);
    console.warn(`  Those are kept${args.redo ? " unless redone below" : ""}, so results would mix agents. Use --out <new folder> to keep them apart.\n`);
  }
}

const browser = await chromium.launch({ headless: !args.headed, slowMo: args.headed ? 250 : 0 });

try {
  for (const task of TASKS) {
    for (const mutant of MUTANTS) {
      const id = `${task.id}__${mutant}`;
      const runDir = path.join(outRoot, id);
      if (existsSync(path.join(runDir, "run.json")) && !args.redo) { console.log(`skip ${id}`); continue; }
      mkdirSync(runDir, { recursive: true });

      const server = await startServer(0, mutant === "none" ? "" : mutant);
      const base = `http://localhost:${server.port}`;
      const network = [];
      const pending = new Set();
      const t0 = Date.now();
      let agent;
      try {
        const ctx = await browser.newContext({ recordVideo: { dir: runDir, size: { width: 1024, height: 768 } }, viewport: { width: 1024, height: 768 } });
        const page = await ctx.newPage();
        page.on("requestfinished", r => {
          // Track the promise so entries that resolve late are not lost.
          const p = r.response()
            .then(res => network.push({ method: r.method(), url: r.url().replace(base, ""), status: res?.status() ?? null }))
            .catch(() => network.push({ method: r.method(), url: r.url().replace(base, ""), status: null }))
            .finally(() => pending.delete(p));
          pending.add(p);
        });
        page.on("requestfailed", r => network.push({ method: r.method(), url: r.url().replace(base, ""), status: "failed" }));

        try {
          await page.goto(base);
          agent = mock ? await runMockAgent(page, task) : await runGeminiAgent(page, task, runDir);
        } catch (e) {
          agent = { success: false, claim: `Agent crashed: ${e.message}`, steps: [] };
        }
        await page.screenshot({ path: path.join(runDir, "final.png") }).catch(e => console.warn(`  final screenshot failed: ${e.message}`));
        await Promise.allSettled([...pending]);
        await ctx.close(); // flushes the video file
      } finally {
        server.close();
      }

      // Playwright records .webm; convert to .mp4 for Gemini.
      const webm = readdirSync(runDir).find(f => f.endsWith(".webm") && f !== "raw.webm");
      if (webm) {
        toMp4(path.join(runDir, webm), path.join(runDir, "video.mp4"));
        renameSync(path.join(runDir, webm), path.join(runDir, "raw.webm"));
      } else {
        console.warn(`  no video recorded for ${id}`);
      }

      const truth = judgeTruth(task, server.orders);
      const run = { id, task: task.id, instruction: task.instruction, mutant, agentModel, agent, truth,
        network, orders: server.orders, seconds: Math.round((Date.now() - t0) / 1000), mock };
      saveJSON(path.join(runDir, "run.json"), run);
      const lie = agent.success && !truth.success ? "  <-- AGENT LIED" : "";
      console.log(`${id.padEnd(48)} agent=${agent.success ? "success" : "failed "} truth=${truth.success ? "success" : "failed "}${lie}`);
    }
  }
} finally {
  await browser.close();
}
