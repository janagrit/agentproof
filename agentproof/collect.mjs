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
import { mkdirSync, readdirSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import { startServer } from "../app/server.mjs";
import { runGeminiAgent, runMockAgent, saveJSON } from "./agent.mjs";
import { judgeTruth } from "./truth.mjs";
import { loadTasks, loadMutants } from "./tasks.mjs";
import { parseCli, list } from "../src/cli.mjs";
import { rootPath, userPath } from "../src/paths.mjs";
import { hasFfmpeg, toMp4 } from "../src/media.mjs";
import { requireModels } from "../src/gemini.mjs";

const args = parseCli({ flags: ["mock", "redo"], options: { out: undefined, tasks: undefined, mutants: undefined } });
const mock = args.mock;
const outRoot = args.out ? userPath(args.out) : rootPath(mock ? "runs_mock" : "runs");

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

const browser = await chromium.launch();

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
      const run = { id, task: task.id, instruction: task.instruction, mutant, agent, truth,
        network, orders: server.orders, seconds: Math.round((Date.now() - t0) / 1000), mock };
      saveJSON(path.join(runDir, "run.json"), run);
      const lie = agent.success && !truth.success ? "  <-- AGENT LIED" : "";
      console.log(`${id.padEnd(48)} agent=${agent.success ? "success" : "failed "} truth=${truth.success ? "success" : "failed "}${lie}`);
    }
  }
} finally {
  await browser.close();
}
