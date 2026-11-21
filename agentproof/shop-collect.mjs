// Shop version of collect.mjs: runs the agent on live Shop (or the mock) for
// each task x fault, then reads the real cart as the answer key.
//
// Usage:
//   node agentproof/shop-collect.mjs --mock                           # fake Shop, no API, no network
//   node agentproof/shop-collect.mjs --tasks rain_jacket_m --faults none,create_silently_dropped
// Each real run creates real anonymous carts at real stores (no orders, no money).
import "dotenv/config";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseCli, list } from "../src/cli.mjs";
import { rootPath, userPath } from "../src/paths.mjs";
import { requireModels, MODELS } from "../src/gemini.mjs";
import { makeShopCall, redact } from "../src/shop-mcp.mjs";
import { makeMockShop } from "./shop-mock.mjs";
import { createProxy, FAULTS } from "./shop-proxy.mjs";
import { runGeminiShopAgent, runMockShopAgent } from "./shop-agent.mjs";
import { findRealCart, readTruthState, judgeShopTruth } from "./shop-truth.mjs";
import { compactReply } from "./shop-view.mjs";
import { saveJSON } from "./agent.mjs";

export const SHOP_TASKS = JSON.parse(readFileSync(rootPath("agentproof", "shop-tasks.json"), "utf8"));

// What a call asked for, without full cart documents or secrets.
export function compactArgs(name, args) {
  if (name === "create_cart" || name === "update_cart") {
    return { shop: args.shop, ...(args.id ? { id: args.id } : {}),
      lines: (args.cart?.line_items || []).map(l => ({ variant: l.item?.id, quantity: l.quantity, ...(l.id ? { line: l.id } : {}) })) };
  }
  if (args?.catalog) {
    const { context, ...rest } = args.catalog;
    return rest;
  }
  return args;
}

export const logOf = entries => redact(entries.map(e => ({
  name: e.name, args: compactArgs(e.name, e.args || {}),
  reply: e.error ? `ERROR ${e.error}` : compactReply(e.result),
})));

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = parseCli({ flags: ["mock", "redo"], options: { out: undefined, tasks: undefined, faults: undefined } });
  const mock = args.mock;
  const outRoot = args.out ? userPath(args.out) : rootPath(mock ? "runs_shop_mock" : "runs_shop");
  const agentModel = mock ? "mock" : MODELS.agent;

  let tasks, faults;
  try {
    const ids = list(args.tasks);
    const unknown = (ids || []).filter(id => !SHOP_TASKS.some(t => t.id === id));
    if (unknown.length) throw new Error(`Unknown Shop task(s): ${unknown.join(", ")}. Known: ${SHOP_TASKS.map(t => t.id).join(", ")}`);
    tasks = ids ? SHOP_TASKS.filter(t => ids.includes(t.id)) : SHOP_TASKS;
    faults = list(args.faults) ?? FAULTS;
    const bad = faults.filter(f => !FAULTS.includes(f));
    if (bad.length) throw new Error(`Unknown fault(s): ${bad.join(", ")}. Known: ${FAULTS.join(", ")}`);
    if (!mock) requireModels("agent");
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  console.log(`Agent: ${agentModel}${mock ? " (scripted mock, always claims success)" : " (from MODEL_AGENT)"}`);
  console.log(`Shop:  ${mock ? "MOCK (in-process, no network)" : "LIVE https://mcp.shop.com/ (real anonymous carts, no orders)"}`);
  console.log(`Runs:  ${tasks.length} task(s) x ${faults.length} fault(s) -> ${outRoot}\n`);

  const liveCall = mock ? null : makeShopCall();
  for (const task of tasks) {
    for (const fault of faults) {
      const id = `${task.id}__${fault}`;
      const runDir = path.join(outRoot, id);
      if (existsSync(path.join(runDir, "run.json")) && !args.redo) { console.log(`skip ${id}`); continue; }
      mkdirSync(runDir, { recursive: true });

      const call = mock ? makeMockShop().call : liveCall;
      const proxy = createProxy({ call, fault });
      const t0 = Date.now();
      let agent;
      try {
        agent = mock ? await runMockShopAgent(proxy, task) : await runGeminiShopAgent(proxy, task);
      } catch (e) {
        agent = { success: false, claim: `Agent crashed: ${e.message}`, cart_id: null, steps: [] };
      }
      let truth, state = { cart: null, variants: {} };
      try {
        state = await readTruthState(call, findRealCart(proxy.wire));
        truth = judgeShopTruth(task, state);
      } catch (e) {
        truth = { success: null, reason: `could not read the real cart: ${e.message}` };
      }
      const run = {
        id, kind: "shop", task: task.id, instruction: task.instruction, mutant: fault, fault, agentModel,
        agent: redact(agent), truth,
        tools: logOf(proxy.view),   // what the agent saw
        wire: logOf(proxy.wire),    // what Shop really got and answered
        cart: redact(state.cart ? compactReply({ structuredContent: state.cart }) : null),
        seconds: Math.round((Date.now() - t0) / 1000), mock,
      };
      saveJSON(path.join(runDir, "run.json"), run);
      const lie = agent.success && truth.success === false ? "  <-- AGENT LIED" : "";
      const t = truth.success === null ? "UNKNOWN" : truth.success ? "success" : "failed ";
      console.log(`${id.padEnd(44)} agent=${agent.success ? "success" : "failed "} truth=${t}${lie}${truth.success ? "" : `  (${truth.reason})`}`);
    }
  }
}
