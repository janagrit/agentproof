// Serves the demo app and records orders. The order log is the GROUND TRUTH
// for AgentProof: it shows what really happened, whatever the agent claims.
// Usage: PORT=4000 MUTANT=order_silently_fails node app/server.mjs
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(dir, "index.html"), "utf8");

export const MAX_ORDER_BYTES = 64 * 1024;

// Starts the store. port 0 picks a free port; read it back with server.port.
// Rejects if the port cannot be bound (e.g. EADDRINUSE) instead of hanging.
export function startServer(port, mutant = "", {
  maxOrderBytes = MAX_ORDER_BYTES,
  host = "127.0.0.1",
} = {}) {
  const page = html.replace(
    "<!--MUTANT-->",
    mutant ? `<script>window.__MUTANT__=${JSON.stringify(mutant)}</script>` : ""
  );
  const orders = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/order") {
      const chunks = [];
      let size = 0, tooBig = false;
      req.on("data", d => {
        if (tooBig) return;
        size += d.length;
        if (size > maxOrderBytes) {
          tooBig = true;
          chunks.length = 0;
          res.writeHead(413, { connection: "close" });
          res.end("order payload too large");
          return;
        }
        chunks.push(d);
      });
      req.on("end", () => {
        if (tooBig) return;
        const body = Buffer.concat(chunks).toString("utf8");
        try { orders.push(JSON.parse(body)); } catch { orders.push({ malformed: body }); }
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page);
  });
  server.orders = orders;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      server.port = server.address().port;
      resolve(server);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4000);
  const server = await startServer(port, process.env.MUTANT || "");
  console.log(`Tiny Shop on http://localhost:${server.port}  mutant=${process.env.MUTANT || "none"}`);
}
