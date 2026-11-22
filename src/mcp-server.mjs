// Zero-dependency MCP Stdio Server (JSON-RPC 2.0 over stdin/stdout)
// Exposes AgentProof as callable tools (`agentproof_check_url`, `agentproof_verify_run`)
// to Antigravity, Claude Code, Cursor, or any MCP-compatible agent across workspaces.
import dotenv from "dotenv";
import path from "node:path";
import readline from "node:readline";
import { rootPath, userPath } from "./paths.mjs";
import { checkUrl, verifyAppRun, loadSavedRun } from "../agentproof/app-check.mjs";
import { VERIFIERS } from "../agentproof/verifiers.mjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: rootPath(".env") });

// Redirect any library console.warn/log to stderr so stdout stays strictly JSON-RPC
console.log = (...args) => process.stderr.write(args.join(" ") + "\n");
console.warn = (...args) => process.stderr.write(args.join(" ") + "\n");

export const MCP_TOOLS = [
  {
    name: "agentproof_check_url",
    description:
      "Opens a live web app URL in Chromium, attempts the given task/scenario, records video + DOM links + HTTP network statuses, and runs AgentProof's 3-model audit (Hydrogen + Carbon + gemini-decision-1) to verify whether the app truly succeeded or silently failed.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target HTTP(S) URL to open and check." },
        task: { type: "string", description: "Expected user scenario and concrete assertions to verify." },
        outDir: { type: "string", description: "Optional directory to save video.mp4, final.png, run.json, and verdict.json." },
        useDecision: { type: "boolean", description: "Use gemini-decision-1 calibrated gate (default true)." },
      },
      required: ["url", "task"],
    },
  },
  {
    name: "agentproof_verify_run",
    description:
      "Audits an existing recorded agent run folder (containing run.json, optional video.mp4 / final.png / network or wire logs) using AgentProof and returns task_succeeded, calibrated probability, failure_mode, lie_severity, and evidence.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Path to folder containing run.json." },
        verifier: {
          type: "string",
          description: "Optional specific verifier (e.g. agentproof+decision, agentproof+wire-decision). Omit for universal app verifier.",
        },
      },
      required: ["dir"],
    },
  },
];

export async function handleMcpRequest(msg) {
  const { id, method, params } = msg ?? {};
  if (method === "notifications/initialized" || id === undefined) return null;

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "agentproof", version: "0.2.0" },
        },
      };
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
    }

    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};

      if (name === "agentproof_check_url") {
        const outDir = args.outDir
          ? userPath(args.outDir)
          : rootPath("runs_live", `mcp_check_${Date.now()}`);
        const { run, verdict } = await checkUrl({
          url: args.url,
          instruction: args.task,
          outDir,
          useDecision: args.useDecision !== false,
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    task_succeeded: verdict.task_succeeded,
                    evidence: verdict.evidence,
                    decision: verdict.decision ?? null,
                    audit: verdict.audit ?? null,
                    agent_claim: run.agent,
                    outDir,
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        };
      }

      if (name === "agentproof_verify_run") {
        const dir = userPath(args.dir);
        const run = loadSavedRun(dir);
        const verdict = args.verifier
          ? await VERIFIERS[args.verifier](run, dir)
          : await verifyAppRun(run, dir);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(verdict, null, 2) }],
          },
        };
      }

      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown tool: ${name}` },
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        isError: true,
        content: [{ type: "text", text: `AgentProof error: ${e.message}` }],
      },
    };
  }
}

// Only start reading stdin when executed as the MCP server entrypoint
if (import.meta.url === `file://${process.argv[1]}` || process.argv[2] === "mcp") {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    const reply = await handleMcpRequest(msg);
    if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
  });
}
