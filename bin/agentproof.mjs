#!/usr/bin/env node
// Reusable AgentProof CLI for checking any live URL or recorded agent run.
//
// Examples:
//   npx agentproof check --url "https://janagrit.github.io/Moisha/" --task "Paste https://www.airbnb.com/rooms/48425132 and verify primary unit is 1 bedroom (not 3BR) with real airbnb.com/rooms links"
//   npx agentproof verify --dir ./runs_check/moisha
//   npx agentproof mcp
import dotenv from "dotenv";
import path from "node:path";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { rootPath, userPath } from "../src/paths.mjs";
import { checkUrl, verifyAppRun, loadSavedRun } from "../agentproof/app-check.mjs";
import { VERIFIERS } from "../agentproof/verifiers.mjs";

// Load .env from current project first, then fallback to AgentProof's own .env
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: rootPath(".env") });

const [subcommand, ...rest] = process.argv.slice(2);

function printHelp() {
  console.log(`AgentProof CLI — Independent 3-Model Agent Verifier

Commands:
  agentproof check  --url <url> --task "<instruction>" [--out <dir>] [--headed] [--no-decision]
  agentproof verify --dir <run-dir> [--verifier <name>] [--no-decision]
  agentproof mcp    (starts stdio MCP server so AI coding agents in any repo can call AgentProof)
`);
}

if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
  printHelp();
  process.exit(0);
}

if (subcommand === "mcp") {
  await import("../src/mcp-server.mjs");
} else if (subcommand === "check") {
  const { values } = parseArgs({
    args: rest,
    options: {
      url: { type: "string" },
      task: { type: "string" },
      out: { type: "string" },
      steps: { type: "string", default: "18" },
      headed: { type: "boolean", default: false },
      "no-decision": { type: "boolean", default: false },
    },
    strict: true,
  });

  if (!values.url || !values.task) {
    console.error("Usage: agentproof check --url <url> --task \"<instruction>\" [--out <dir>] [--headed]");
    process.exit(2);
  }

  const slug = new URL(values.url).hostname.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const outDir = values.out
    ? userPath(values.out)
    : userPath(path.join("runs_check", `${slug}_${Date.now()}`));

  console.log(`Checking URL: ${values.url}`);
  console.log(`Task:         ${values.task}`);
  console.log(`Output dir:   ${outDir}\n`);

  const { run, verdict } = await checkUrl({
    url: values.url,
    instruction: values.task,
    outDir,
    headed: values.headed,
    maxSteps: Math.max(1, Number.parseInt(values.steps, 10) || 18),
    useDecision: !values["no-decision"],
  });

  const lied = run.agent.success && verdict.task_succeeded === false;
  console.log(`Agent claimed:  success=${run.agent.success} — "${run.agent.claim}"`);
  console.log(`AgentProof:     task_succeeded=${verdict.task_succeeded}${lied ? "  <-- CAUGHT DISCREPANCY!" : ""}`);
  console.log(`Evidence:       ${verdict.evidence}`);
  console.log(`Saved artifacts: ${outDir}`);
  process.exit(verdict.task_succeeded ? 0 : 1);
} else if (subcommand === "verify") {
  const { values } = parseArgs({
    args: rest,
    options: {
      dir: { type: "string" },
      verifier: { type: "string" },
      "no-decision": { type: "boolean", default: false },
    },
    strict: true,
  });

  if (!values.dir) {
    console.error("Usage: agentproof verify --dir <run-dir> [--verifier <name>]");
    process.exit(2);
  }

  const dir = userPath(values.dir);
  if (!existsSync(path.join(dir, "run.json"))) {
    console.error(`run.json not found in ${dir}`);
    process.exit(1);
  }

  const run = loadSavedRun(dir);
  let verdict;
  if (values.verifier) {
    if (!VERIFIERS[values.verifier]) {
      console.error(`Unknown verifier: ${values.verifier}. Known: ${Object.keys(VERIFIERS).join(", ")}`);
      process.exit(2);
    }
    verdict = await VERIFIERS[values.verifier](run, dir);
  } else {
    verdict = await verifyAppRun(run, dir, { useDecision: !values["no-decision"] });
  }

  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.task_succeeded ? 0 : 1);
} else {
  console.error(`Unknown subcommand: ${subcommand}`);
  printHelp();
  process.exit(2);
}
