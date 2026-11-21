// Local interactive audit & replay viewer for AgentProof runs (no API key needed).
// Plays recorded store videos alongside the agent's claim, Hydrogen's timeline,
// network/wire logs, Carbon's reasoning, Decisions API probabilities, and ground truth.
//
// Usage: npm run demo   (opens http://localhost:4100, or set PORT=...)
import http from "node:http";
import { existsSync, readdirSync, readFileSync, statSync, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rootPath } from "../src/paths.mjs";
import { redact } from "../src/shop-mcp.mjs";

const FEATURED = [
  "two_mugs_discount__discount_not_applied",
  "two_mugs_discount__rounding_off_by_cent",
  "one_tee__order_silently_fails",
  "three_tees_discount__total_ignores_qty",
  "hoodie_m_to_l__update_silently_dropped",
  "beanie__price_display_lowered",
  "remove_then_buy__remove_broken",
];

function readVerdicts(runDir) {
  const out = {};
  if (!existsSync(runDir)) return out;
  for (const f of readdirSync(runDir).sort()) {
    const m = f.match(/^verdict\.(.+)\.([^.]+)\.json$/);
    if (!m) continue;
    const [, verifier, tag] = m;
    // Prefer primary tags over repeat tags, and never overwrite a valid verdict with a null error.
    const priority = /^(v1|shop_v1|decision_v1|shop_decision_v1|blind1|shop_blind1b|shop_blind1)$/.test(tag);
    try {
      const parsed = { ...redact(JSON.parse(readFileSync(path.join(runDir, f), "utf8"))), tag };
      const cur = out[verifier];
      if (!cur || (cur.task_succeeded === null && parsed.task_succeeded !== null) || (priority && !(parsed.task_succeeded === null && cur.task_succeeded !== null))) {
        out[verifier] = parsed;
      }
    } catch {}
  }
  return out;
}

function listDataset(folder, kind) {
  const base = rootPath(folder);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter(d => existsSync(path.join(base, d, "run.json")))
    .sort()
    .map(id => {
      const dir = path.join(base, id);
      const r = redact(JSON.parse(readFileSync(path.join(dir, "run.json"), "utf8")));
      const lie = Boolean(r.agent?.success && r.truth?.success === false);
      return {
        id,
        kind,
        folder,
        task: r.task,
        mutant: r.mutant ?? r.fault ?? "none",
        instruction: r.instruction,
        agentSuccess: Boolean(r.agent?.success),
        claim: r.agent?.claim ?? "",
        truthSuccess: r.truth?.success,
        truthReason: r.truth?.reason ?? "",
        lie,
        featuredRank: FEATURED.indexOf(id),
        hasVideo: existsSync(path.join(dir, "video.mp4")),
      };
    });
}

function loadRunDetail(kind, id) {
  const folder = kind === "shop" ? "runs_shop" : "runs";
  const safeId = path.basename(id);
  const dir = rootPath(folder, safeId);
  const runFile = path.join(dir, "run.json");
  if (!existsSync(runFile)) return null;
  const run = redact(JSON.parse(readFileSync(runFile, "utf8")));
  const verdicts = readVerdicts(dir);
  return {
    kind,
    run,
    verdicts,
    hasVideo: existsSync(path.join(dir, "video.mp4")),
    hasFinalPng: existsSync(path.join(dir, "final.png")),
  };
}

function serveMedia(req, res, filePath, mime) {
  if (!existsSync(filePath)) { res.writeHead(404); res.end("Not found"); return; }
  const stat = statSync(filePath);
  const range = req.headers.range;
  if (range && mime === "video/mp4" && stat.size > 0) {
    const [s, e] = range.replace(/bytes=/, "").split("-");
    const start = Number.parseInt(s, 10) || 0;
    const rawEnd = e ? Number.parseInt(e, 10) : stat.size - 1;
    const end = Number.isFinite(rawEnd) ? Math.min(rawEnd, stat.size - 1) : stat.size - 1;
    if (start < 0 || start >= stat.size || end < start) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": mime,
    });
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Length": stat.size, "Content-Type": mime, "Accept-Ranges": "bytes" });
  createReadStream(filePath).pipe(res);
}

function buildLiveDemoData() {
  const out = [];
  for (const [folder, kind] of [["runs", "store"], ["runs_shop", "shop"]]) {
    const base = rootPath(folder);
    if (!existsSync(base)) continue;
    for (const id of readdirSync(base).filter(d => existsSync(path.join(base, d, "run.json"))).sort()) {
      const dir = path.join(base, id);
      const r = redact(JSON.parse(readFileSync(path.join(dir, "run.json"), "utf8")));
      out.push({
        kind,
        id: r.id,
        task: r.task,
        mutant: r.mutant ?? r.fault ?? "none",
        instruction: r.instruction,
        agentModel: r.agentModel ?? null,
        seconds: r.seconds,
        hasVideo: kind === "store" && (existsSync(path.join(dir, "video.mp4")) || existsSync(rootPath("docs", "videos", `${id}.mp4`))),
        agent: { success: Boolean(r.agent?.success), claim: r.agent?.claim ?? "" },
        truth: r.truth,
        ...(kind === "shop" ? { tools: r.tools, wire: r.wire } : { network: r.network }),
        verdicts: readVerdicts(dir),
      });
    }
  }
  if (out.length) return { runs: out };
  const fallback = rootPath("docs", "demo-data.json");
  return existsSync(fallback) ? JSON.parse(readFileSync(fallback, "utf8")) : { runs: [] };
}

export function startViewer(port = 4100) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/api/demo-data") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(buildLiveDemoData()));
      return;
    }
    if (u.pathname === "/api/runs") {
      const all = [...listDataset("runs", "store"), ...listDataset("runs_shop", "shop")];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(all));
      return;
    }
    const mRun = u.pathname.match(/^\/api\/run\/(store|shop)\/([^/]+)$/);
    if (mRun) {
      const detail = loadRunDetail(mRun[1], decodeURIComponent(mRun[2]));
      if (!detail) { res.writeHead(404); res.end("Run not found"); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(detail));
      return;
    }
    if (u.pathname === "/docs/proof.mp4") {
      serveMedia(req, res, rootPath("docs", "proof.mp4"), "video/mp4");
      return;
    }
    const mMedia = u.pathname.match(/^\/media\/([^/]+)\/(video\.mp4|final\.png)$/);
    if (mMedia) {
      const safeId = path.basename(decodeURIComponent(mMedia[1]));
      const file = mMedia[2];
      const primary = rootPath("runs", safeId, file);
      const fallback = file === "video.mp4" ? rootPath("docs", "videos", `${safeId}.mp4`) : primary;
      serveMedia(req, res, existsSync(primary) ? primary : fallback, file.endsWith(".mp4") ? "video/mp4" : "image/png");
      return;
    }
    const html = readFileSync(rootPath("docs", "index.html"), "utf8")
      .replace('fetch("./demo-data.json")', 'fetch("/api/demo-data")')
      .replace('src="./videos/${encodeURIComponent(id)}.mp4"', 'src="/media/${encodeURIComponent(id)}/video.mp4"')
      .replace('src="./proof.mp4"', 'src="/docs/proof.mp4"');
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      server.port = server.address().port;
      resolve(server);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4100);
  const s = await startViewer(port);
  console.log(`AgentProof Demo Viewer running at http://localhost:${s.port}`);
}
