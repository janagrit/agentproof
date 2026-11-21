// Serves the demo app and records orders. The order log is the GROUND TRUTH
// for AgentProof: it shows what really happened, whatever the agent claims.
// Usage: PORT=4000 MUTANT=order_silently_fails node app/server.mjs
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(dir, "index.html"), "utf8");

export function startServer(port, mutant = "", { evidenceDir } = {}) {
  const page = html.replace(
    "<!--MUTANT-->",
    mutant ? `<script>window.__MUTANT__=${JSON.stringify(mutant)}</script>` : ""
  );
  const orders = [];
  const server = http.createServer((req, res) => {
    // Evidence upload for remote agents (Managed Agents run in Google's cloud,
    // so they send their screenshots / video / HAR back here).
    // curl --data-binary @shot.png https://<public-url>/__evidence/shot.png
    if (req.method === "POST" && req.url.startsWith("/__evidence/") && evidenceDir) {
      const name = path.basename(decodeURIComponent(req.url.slice("/__evidence/".length))) || "upload.bin";
      const chunks = [];
      req.on("data", d => chunks.push(d));
      req.on("end", () => {
        mkdirSync(evidenceDir, { recursive: true });
        writeFileSync(path.join(evidenceDir, name), Buffer.concat(chunks));
        res.writeHead(201); res.end("saved " + name);
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/order") {
      let body = "";
      req.on("data", d => (body += d));
      req.on("end", () => {
        try { orders.push(JSON.parse(body)); } catch { orders.push({ malformed: body }); }
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.url === "/api/orders") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(orders));
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page);
  });
  server.orders = orders;
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4000);
  await startServer(port, process.env.MUTANT || "");
  console.log(`Tiny Shop on http://localhost:${port}  mutant=${process.env.MUTANT || "none"}`);
}
