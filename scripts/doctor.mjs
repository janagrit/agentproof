// Preflight: is this machine ready to run AgentProof?
//   npm run doctor          checks everything, exits 1 if a real run would fail
import { existsSync, readFileSync } from "node:fs";
import { rootPath } from "../src/paths.mjs";
import { hasFfmpeg } from "../src/media.mjs";

const envFile = rootPath(".env");
// Load .env the same way the scripts do, without printing anything.
if (existsSync(envFile)) (await import("dotenv")).config({ path: envFile, quiet: true });

let failed = 0;
const line = (ok, label, detail = "") => {
  if (ok === false) failed++;
  const mark = ok === true ? "ok  " : ok === false ? "FAIL" : "warn";
  console.log(`  ${mark}  ${label}${detail ? `  ${detail}` : ""}`);
};
const mask = v => (v ? `${v.slice(0, 4)}…${v.slice(-2)} (${v.length} chars)` : "");

console.log("Runtime (needed for everything, incl. --mock):");
const major = Number(process.versions.node.split(".")[0]);
line(major >= 20, "Node >= 20", process.versions.node);
line(existsSync(rootPath("node_modules", "@playwright", "test")), "npm dependencies installed", existsSync(rootPath("node_modules")) ? "" : "run: npm ci");
line(hasFfmpeg(), "ffmpeg on PATH", hasFfmpeg() ? "" : "macOS: brew install ffmpeg");
try {
  const { chromium } = await import("@playwright/test");
  const exe = chromium.executablePath();
  line(existsSync(exe), "Playwright Chromium", existsSync(exe) ? "" : "run: npx playwright install chromium");
} catch (e) {
  line(false, "Playwright Chromium", e.message.split("\n")[0]);
}

console.log("\nGemini (needed for real runs, not for --mock / trust):");
const key = process.env.GEMINI_API_KEY;
// No .env is fine if the variables come from the shell instead.
line(existsSync(envFile) ? true : key ? null : false, ".env file", existsSync(envFile) ? "" : key ? "not found, using shell environment" : "run: cp .env.example .env");
line(Boolean(key), "GEMINI_API_KEY", mask(key));
const vars = [
  ["MODEL_AGENT", "agent being checked (falls back to MODEL_PERCEIVE)", process.env.MODEL_AGENT || process.env.MODEL_PERCEIVE],
  ["MODEL_PERCEIVE", "fast video model", process.env.MODEL_PERCEIVE],
  ["MODEL_AUTHOR", "strong judge", process.env.MODEL_AUTHOR],
  ["MODEL_BASELINE", "single-call baseline (falls back to MODEL_AUTHOR)", process.env.MODEL_BASELINE || process.env.MODEL_AUTHOR],
];
for (const [name, what, effective] of vars) {
  const own = process.env[name];
  line(Boolean(effective), name, effective ? `${effective}${own ? "" : " (fallback)"}` : `missing: ${what}`);
}

console.log("\nManaged agent (only for agentproof/managed.mjs):");
line(process.env.PUBLIC_URL ? true : null, "PUBLIC_URL", process.env.PUBLIC_URL || "not set (start a tunnel first)");

// Example file should list every var the code reads.
const example = existsSync(rootPath(".env.example")) ? readFileSync(rootPath(".env.example"), "utf8") : "";
for (const v of ["GEMINI_API_KEY", "MODEL_AGENT", "MODEL_PERCEIVE", "MODEL_AUTHOR", "MODEL_BASELINE"]) {
  if (!example.includes(v)) line(null, `.env.example lists ${v}`, "missing");
}

console.log(failed ? `\n${failed} problem(s). Mock mode needs only the Runtime section.` : "\nAll good.");
process.exit(failed ? 1 : 0);
