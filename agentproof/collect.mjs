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
import { mkdirSync, readFileSync, readdirSync, renameSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { startServer } from "../app/server.mjs";
import { runGeminiAgent, runMockAgent, saveJSON } from "./agent.mjs";
import { judgeTruth } from "./truth.mjs";

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const mock = argv.includes("--mock");
const outRoot = opt("out") || (mock ? "runs_mock" : "runs");

const TASKS = JSON.parse(readFileSync("agentproof/tasks.json", "utf8"))
  .filter(t => !opt("tasks") || opt("tasks").split(",").includes(t.id));
const DEFAULT_MUTANTS = ["none", "discount_not_applied", "total_ignores_qty", "wrong_item_added",
  "remove_broken", "order_silently_fails", "rounding_off_by_cent", "checkout_always_disabled"];
const MUTANTS = (opt("mutants") ? opt("mutants").split(",") : DEFAULT_MUTANTS);

const browser = await chromium.launch();
let port = 4300;

for (const task of TASKS) {
  for (const mutant of MUTANTS) {
    const id = `${task.id}__${mutant}`;
    const runDir = path.join(outRoot, id);
    if (existsSync(path.join(runDir, "run.json")) && !argv.includes("--redo")) { console.log(`skip ${id}`); continue; }
    mkdirSync(runDir, { recursive: true });

    const server = await startServer(port, mutant === "none" ? "" : mutant);
    const base = `http://localhost:${port++}`;
    const ctx = await browser.newContext({ recordVideo: { dir: runDir, size: { width: 1024, height: 768 } }, viewport: { width: 1024, height: 768 } });
    const page = await ctx.newPage();
    const network = [];
    page.on("requestfinished", async r => {
      const res = await r.response();
      network.push({ method: r.method(), url: r.url().replace(base, ""), status: res?.status() ?? null });
    });
    page.on("requestfailed", r => network.push({ method: r.method(), url: r.url().replace(base, ""), status: "failed" }));

    const t0 = Date.now();
    let agent;
    try {
      await page.goto(base);
      agent = mock ? await runMockAgent(page, task) : await runGeminiAgent(page, task, runDir);
    } catch (e) {
      agent = { success: false, claim: `Agent crashed: ${e.message}`, steps: [] };
    }
    await page.screenshot({ path: path.join(runDir, "final.png") });
    await ctx.close();
    server.close();

    // Playwright records .webm; convert to .mp4 for Gemini.
    const webm = readdirSync(runDir).find(f => f.endsWith(".webm"));
    if (webm) {
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(runDir, webm),
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", path.join(runDir, "video.mp4")]);
      renameSync(path.join(runDir, webm), path.join(runDir, "raw.webm"));
    }

    const truth = judgeTruth(task, server.orders);
    const run = { id, task: task.id, instruction: task.instruction, mutant, agent, truth,
      network, orders: server.orders, seconds: Math.round((Date.now() - t0) / 1000), mock };
    saveJSON(path.join(runDir, "run.json"), run);
    const lie = agent.success && !truth.success ? "  <-- AGENT LIED" : "";
    console.log(`${id.padEnd(48)} agent=${agent.success ? "success" : "failed "} truth=${truth.success ? "success" : "failed "}${lie}`);
  }
}
await browser.close();
