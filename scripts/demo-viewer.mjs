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

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AgentProof — Audit & Replay Viewer</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --panel2: #1e222b; --border: #2a303c;
    --ink: #f1f3f5; --muted: #9aa3b2; --lie: #ff5c39; --ok: #2ecc71; --warn: #f5a623; --accent: #4da3ff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--ink); }
  header { padding: 14px 22px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; background: #12151b; }
  .brand { display: flex; align-items: baseline; gap: 12px; }
  .brand h1 { margin: 0; font-size: 20px; letter-spacing: -0.3px; }
  .brand span { color: var(--muted); font-size: 13px; }
  .scorebar { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12px; }
  .pill { padding: 5px 10px; border-radius: 999px; background: var(--panel2); border: 1px solid var(--border); }
  .pill strong { color: var(--ink); }
  .pill.win { border-color: rgba(46,204,113,.5); background: rgba(46,204,113,.12); }
  .featured { padding: 10px 22px; border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; overflow-x: auto; background: var(--panel); }
  .featured-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); white-space: nowrap; margin-right: 4px; }
  button.chip { background: var(--panel2); color: var(--ink); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; }
  button.chip:hover, button.chip.active { border-color: var(--accent); background: rgba(77,163,255,.16); }
  select { background: var(--panel2); color: var(--ink); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 12px; }
  main { display: grid; grid-template-columns: 1.08fr 1fr; gap: 18px; padding: 18px 22px; max-width: 1560px; margin: 0 auto; }
  @media (max-width: 1024px) { main { grid-template-columns: 1fr; } }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
  .card h2 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); display: flex; justify-content: space-between; align-items: center; }
  .banner { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  .box { padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel2); }
  .box .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 4px; }
  .box .v { font-size: 14px; line-height: 1.4; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .badge.lie { background: rgba(255,92,57,.2); color: var(--lie); border: 1px solid rgba(255,92,57,.5); }
  .badge.ok { background: rgba(46,204,113,.18); color: var(--ok); border: 1px solid rgba(46,204,113,.45); }
  .badge.fail { background: rgba(245,166,35,.18); color: var(--warn); border: 1px solid rgba(245,166,35,.45); }
  video { width: 100%; border-radius: 8px; background: #000; border: 1px solid var(--border); }
  .events { display: flex; flex-direction: column; gap: 6px; max-height: 230px; overflow-y: auto; margin-top: 10px; }
  .ev { display: flex; gap: 10px; align-items: flex-start; padding: 7px 9px; border-radius: 6px; background: var(--panel2); font-size: 12.5px; cursor: pointer; border: 1px solid transparent; }
  .ev:hover { border-color: var(--accent); }
  .ev .t { color: var(--accent); font-family: ui-monospace, monospace; font-weight: 600; min-width: 38px; }
  .ev .s { color: var(--muted); font-size: 11.5px; margin-top: 2px; }
  .vlist { display: flex; flex-direction: column; gap: 10px; }
  .vrow { padding: 11px 13px; border-radius: 8px; background: var(--panel2); border-left: 4px solid var(--border); }
  .vrow.caught { border-left-color: var(--ok); }
  .vrow.fooled { border-left-color: var(--lie); }
  .vhead { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 5px; }
  .vname { font-family: ui-monospace, monospace; font-weight: 700; font-size: 13px; }
  .vmodels { color: var(--muted); font-size: 11px; }
  .vev { font-size: 12.5px; line-height: 1.45; color: #d8dee9; }
  .bars { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); display: grid; gap: 5px; font-size: 11.5px; }
  .barrow { display: grid; grid-template-columns: 150px 1fr 52px; align-items: center; gap: 8px; }
  .track { height: 7px; background: #101319; border-radius: 4px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); }
  .fill.good { background: var(--ok); }
  .fill.bad { background: var(--lie); }
  pre { margin: 0; font-size: 11.5px; line-height: 1.45; color: #cfd6e4; white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow-y: auto; background: var(--panel2); padding: 10px; border-radius: 6px; }
</style>
</head>
<body>
<header>
  <div class="brand">
    <h1>AgentProof</h1>
    <span>Multi-Model Video + Network + Decisions API Verifier for AI Agents</span>
  </div>
  <div class="scorebar">
    <span class="pill">trust: <strong>0/17 lies</strong></span>
    <span class="pill">single (1 call): <strong>4/17</strong></span>
    <span class="pill">decision (0 out tok): <strong>10/17 (85%)</strong></span>
    <span class="pill">agentproof (H+C): <strong>11/17</strong></span>
    <span class="pill">blind (+net, no hint): <strong>16/17 (98%)</strong></span>
    <span class="pill win">agentproof+network / +decision: <strong>17/17 lies · 0 false alarms</strong></span>
    <span class="pill win">Shop MCP +wire / +decision: <strong>8/8 lies · 100%</strong></span>
  </div>
</header>
<div class="featured">
  <span class="featured-label">Featured runs:</span>
  <div id="chips" style="display:flex;gap:6px"></div>
  <span style="margin-left:auto;color:var(--muted);font-size:12px">All runs:</span>
  <select id="picker"></select>
</div>
<main>
  <section id="left"></section>
  <section id="right"></section>
</main>
<script>
const LABELS = {
  "two_mugs_discount__discount_not_applied": "Lie: Discount Trap ($24 vs $21.60)",
  "two_mugs_discount__rounding_off_by_cent": "Lie: Off by $0.01 ($21.61)",
  "one_tee__order_silently_fails": "Lie: Silent Drop (No POST)",
  "three_tees_discount__total_ignores_qty": "Lie: Qty Ignored ($18 vs $54)",
  "hoodie_m_to_l__update_silently_dropped": "Shop Lie: Dropped Size M→L",
  "beanie__price_display_lowered": "Shop Lie: Hidden Over-Budget",
  "remove_then_buy__remove_broken": "Honest Workaround (Used '−')",
};
let ALL = [];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

async function init() {
  ALL = await (await fetch("/api/runs")).json();
  const chips = document.getElementById("chips");
  const picker = document.getElementById("picker");
  ALL.filter(r => r.featuredRank >= 0).sort((a, b) => a.featuredRank - b.featuredRank).forEach(r => {
    const b = document.createElement("button");
    b.className = "chip";
    b.dataset.key = r.kind + ":" + r.id;
    b.textContent = LABELS[r.id] || r.id;
    b.onclick = () => selectRun(r.kind, r.id);
    chips.appendChild(b);
  });
  ALL.forEach(r => {
    const o = document.createElement("option");
    o.value = r.kind + ":" + r.id;
    o.textContent = \`[\${r.kind}] \${r.lie ? "LIE · " : r.truthSuccess ? "OK  · " : "FAIL· "} \${r.id}\`;
    picker.appendChild(o);
  });
  picker.onchange = () => { const [k, id] = picker.value.split(":"); selectRun(k, id); };
  const first = ALL.find(r => r.id === "two_mugs_discount__discount_not_applied") || ALL[0];
  if (first) selectRun(first.kind, first.id);
}

function decisionBars(d, usage) {
  if (!d) return "";
  const p = d.task_succeeded?.noul;
  const conf = d.task_succeeded?.confidence;
  const probs = d.failure_mode?.probabilities || {};
  const rows = [];
  if (typeof p === "number") {
    rows.push(\`<div class="barrow"><span>noul P(task_succeeded)</span><div class="track"><div class="fill \${p >= 0.5 ? 'good' : 'bad'}" style="width:\${(p*100).toFixed(1)}%"></div></div><span>\${(p*100).toFixed(1)}%</span></div>\`);
  }
  if (typeof conf === "number") {
    rows.push(\`<div class="barrow"><span>Decision confidence</span><div class="track"><div class="fill" style="width:\${(conf*100).toFixed(1)}%"></div></div><span>\${(conf*100).toFixed(1)}%</span></div>\`);
  }
  Object.entries(probs).sort((a,b) => b[1] - a[1]).slice(0, 3).forEach(([k, v]) => {
    rows.push(\`<div class="barrow"><span>choice: \${esc(k)}</span><div class="track"><div class="fill" style="width:\${(v*100).toFixed(1)}%"></div></div><span>\${(v*100).toFixed(1)}%</span></div>\`);
  });
  const tok = usage ? \`<div style="color:var(--muted);margin-top:2px">gemini-decision-1 · input \${usage.total_input_tokens ?? "?"} tok · output <strong>\${usage.total_output_tokens ?? 0} tok</strong></div>\` : "";
  return \`<div class="bars">\${rows.join("")}\${tok}</div>\`;
}

async function selectRun(kind, id) {
  document.getElementById("picker").value = kind + ":" + id;
  document.querySelectorAll("button.chip").forEach(b => b.classList.toggle("active", b.dataset.key === kind + ":" + id));
  const data = await (await fetch(\`/api/run/\${kind}/\${encodeURIComponent(id)}\`)).json();
  const { run, verdicts, hasVideo } = data;
  const lie = run.agent?.success && run.truth?.success === false;
  const badge = lie ? '<span class="badge lie">Agent Lied</span>' : run.truth?.success ? '<span class="badge ok">Honest Success</span>' : '<span class="badge fail">Honest Failure</span>';

  const tlSource = verdicts["agentproof+decision"]?.timeline || verdicts["agentproof+network"]?.timeline || verdicts["agentproof"]?.timeline;
  const eventsHtml = tlSource?.events?.length
    ? \`<div class="card"><h2><span>Step 1 · Video Perception (gemini-4-hydrogen)</span><span style="font-size:11px;text-transform:none">Click timestamp to seek video</span></h2>
        <div class="events">\${tlSource.events.map(e => \`<div class="ev" onclick="const v=document.getElementById('vid');if(v){v.currentTime=\${Number(e.t)||0};v.play();}"><div class="t">t=\${esc(e.t)}s</div><div><div>\${esc(e.what)}</div><div class="s">\${esc(e.screen_after)}</div></div></div>\`).join("")}</div></div>\`
    : "";

  const mediaHtml = hasVideo
    ? \`<div class="card"><h2><span>Screen Recording (\${esc(run.agentModel || "agent")} · \${run.seconds}s)</span>\${badge}</h2>
        <video id="vid" controls autoplay muted playsinline src="/media/\${encodeURIComponent(id)}/video.mp4"></video></div>\`
    : \`<div class="card"><h2><span>Live Shop MCP Tool View (What Agent Saw)</span>\${badge}</h2><pre>\${esc(JSON.stringify(run.tools, null, 2))}</pre></div>\`;

  const netTitle = kind === "shop" ? "Wire Log (What Shop Server Really Received)" : "Browser Network Log";
  const netBody = kind === "shop" ? run.wire : run.network;

  document.getElementById("left").innerHTML = \`
    <div class="card">
      <h2><span>Task: \${esc(run.id)}</span><span style="font-family:monospace;text-transform:none">fault/bug: \${esc(run.mutant)}</span></h2>
      <div style="font-size:15px;font-weight:600;margin-bottom:10px">"\${esc(run.instruction)}"</div>
      <div class="banner" style="margin-bottom:0">
        <div class="box">
          <div class="k">Agent Reported (\${run.agent?.success ? "success: true" : "success: false"})</div>
          <div class="v">"\${esc(run.agent?.claim)}"</div>
        </div>
        <div class="box">
          <div class="k">Answer Key (Hidden from Verifiers)</div>
          <div class="v">\${badge} <div style="margin-top:5px;color:var(--muted);font-size:12.5px">\${esc(run.truth?.reason)}</div></div>
        </div>
      </div>
    </div>
    \${mediaHtml}
    \${eventsHtml}
    <div class="card"><h2><span>\${netTitle}</span></h2><pre>\${esc(JSON.stringify(netBody, null, 2))}</pre></div>
  \`;

  const order = kind === "shop"
    ? ["trust", "agentproof+tools", "agentproof+wire", "agentproof+wire-blind", "agentproof+wire-decision"]
    : ["trust", "single", "decision", "agentproof", "agentproof+network-blind", "agentproof+network", "agentproof+decision"];

  const vrows = order.filter(k => verdicts[k]).map(k => {
    const v = verdicts[k];
    const matched = v.task_succeeded === run.truth?.success;
    const models = v.meta?.models ? Object.entries(v.meta.models).map(([r, m]) => \`\${r}=\${m}\`).join(", ") : "none";
    return \`<div class="vrow \${matched ? 'caught' : 'fooled'}">
      <div class="vhead">
        <div><span class="vname">\${esc(k)}</span> <span class="vmodels">[\${esc(models)}]</span></div>
        <span class="badge \${matched ? 'ok' : 'lie'}">\${matched ? (lie ? "Caught Lie" : "Correct") : "Fooled"} · said \${String(v.task_succeeded)}</span>
      </div>
      <div class="vev">\${esc(v.evidence)}</div>
      \${decisionBars(v.decision, v.usage)}
    </div>\`;
  }).join("");

  document.getElementById("right").innerHTML = \`
    <div class="card">
      <h2><span>Verifiers Compared (Never Shown Answer Key)</span></h2>
      <div class="vlist">\${vrows || '<div style="color:var(--muted)">No cached verdicts found for this run.</div>'}</div>
    </div>
  \`;
}
init();
</script>
</body>
</html>`;

export function startViewer(port = 4100) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
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
    const mMedia = u.pathname.match(/^\/media\/([^/]+)\/(video\.mp4|final\.png)$/);
    if (mMedia) {
      const safeId = path.basename(decodeURIComponent(mMedia[1]));
      const file = mMedia[2];
      serveMedia(req, res, rootPath("runs", safeId, file), file.endsWith(".mp4") ? "video/mp4" : "image/png");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
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
