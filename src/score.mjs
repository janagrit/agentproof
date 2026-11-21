// Mutation scoring: a generated test is only worth something if it
// (1) passes on the clean app and (2) FAILS when we inject a bug.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { startServer } from "../app/server.mjs";

const MUTANTS = JSON.parse(readFileSync(new URL("../app/mutants.json", import.meta.url)));
let nextPort = 4100;

async function runSpec(specPath, mutant) {
  const port = nextPort++;
  const server = await startServer(port, mutant);
  try {
    // Must be async: a sync spawn would block this process and the server inside it.
    return await new Promise(resolve => {
      let log = "";
      const p = spawn("npx", ["playwright", "test", specPath, "--reporter=line", "--retries=0"], {
        env: { ...process.env, BASE_URL: `http://localhost:${port}`, NO_PROXY: "localhost,127.0.0.1" },
      });
      const timer = setTimeout(() => p.kill("SIGKILL"), 60_000);
      p.stdout.on("data", d => (log += d));
      p.stderr.on("data", d => (log += d));
      p.on("close", code => { clearTimeout(timer); resolve({ passed: code === 0, log }); });
    });
  } finally {
    server.close();
  }
}

export async function scoreSpec(specPath) {
  const clean = await runSpec(specPath, "");
  if (!clean.passed) {
    return { valid: false, killed: [], survived: [], cleanLog: clean.log.slice(-2000) };
  }
  const killed = [], survived = [];
  for (const m of MUTANTS) {
    const r = await runSpec(specPath, m.id);
    (r.passed ? survived : killed).push(m.id);
  }
  return { valid: true, killed, survived };
}

export { MUTANTS };
