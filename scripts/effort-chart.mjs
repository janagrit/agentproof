// Builds the agent-effort charts for the README from runs/ (store runs).
//   node scripts/effort-chart.mjs            -> docs/effort-runs.svg, docs/effort-by-outcome.svg
// Static SVGs (GitHub won't run scripts in a README); the README table next to
// them is the table view. Colors: validated categorical slots 1-3, light + dark.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rootPath } from "../src/paths.mjs";
import { ALL_TASKS, DEFAULT_MUTANTS } from "../agentproof/tasks.mjs";

const runsDir = rootPath("runs");
const runs = [];
for (const t of ALL_TASKS) for (const m of DEFAULT_MUTANTS) {
  const f = path.join(runsDir, `${t.id}__${m}`, "run.json");
  if (existsSync(f)) runs.push(JSON.parse(readFileSync(f, "utf8")));
}
if (!runs.length) { console.error(`No runs in ${runsDir}`); process.exit(1); }

export const outcome = r => (r.agent.success && !r.truth.success ? "lie" : r.truth.success ? "success" : "fail");
const LABEL = { success: "Honest success", lie: "Lie (said success, server says no)", fail: "Honest failure" };
const ORDER = ["success", "lie", "fail"];

const STYLE = `
  <style>
    .s{--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--grid:#e4e3df;--success:#2a78d6;--lie:#eb6834;--fail:#1baf7a}
    @media (prefers-color-scheme: dark){.s{--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--grid:#33332f;--success:#3987e5;--lie:#d95926;--fail:#199e70}}
    .bg{fill:var(--surface)} .t{fill:var(--ink);font:600 15px system-ui,-apple-system,Segoe UI,sans-serif}
    .sub,.ax{fill:var(--ink2);font:12px system-ui,-apple-system,Segoe UI,sans-serif} .lg{fill:var(--ink);font:12px system-ui,-apple-system,Segoe UI,sans-serif}
    .val{fill:var(--ink);font:600 12px system-ui,-apple-system,Segoe UI,sans-serif}
    .grid{stroke:var(--grid);stroke-width:1} .base{stroke:var(--ink2);stroke-width:1}
    .success{fill:var(--success)} .lie{fill:var(--lie)} .fail{fill:var(--fail)}
  </style>`;

// Bar with 4px rounded top, square on the baseline.
const bar = (x, y, w, h, cls, title) => {
  const r = Math.min(4, w / 2, h);
  return `<path class="${cls}" d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z"><title>${title}</title></path>`;
};
const legend = (x, y, keys) => keys.map((k, i) => {
  const lx = x + i * 250;
  return `<rect class="${k}" x="${lx}" y="${y - 10}" width="12" height="12" rx="3"/><text class="lg" x="${lx + 18}" y="${y}">${LABEL[k]}</text>`;
}).join("");

function chartRuns(rs) {
  const W = 760, H = 340, L = 48, R = 16, T = 92, B = 44;
  const maxY = Math.max(8, ...rs.map(r => r.agent.steps.length));
  const pw = W - L - R, ph = H - T - B, step = pw / rs.length, bw = Math.min(26, step - 4);
  const y = v => T + ph - (v / maxY) * ph;
  let g = "";
  for (let v = 0; v <= maxY; v += 2) g += `<line class="${v ? "grid" : "base"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  rs.forEach((r, i) => {
    const s = r.agent.steps.length, x = L + i * step + (step - bw) / 2, k = outcome(r);
    g += bar(x, y(s), bw, y(0) - y(s), k, `Run ${i + 1}: ${r.task} / ${r.mutant} - ${s} steps, ${r.seconds}s - ${LABEL[k]}`);
    g += `<text class="ax" x="${x + bw / 2}" y="${H - B + 18}" text-anchor="middle">${i + 1}</text>`;
    if (k === "lie") g += `<text class="val" x="${x + bw / 2}" y="${y(s) - 6}" text-anchor="middle">${s}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" class="s" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Steps the Gemini 4 Argon agent took in runs 1 to ${rs.length}, colored by outcome">${STYLE}
  <rect class="bg" width="${W}" height="${H}" rx="8"/>
  <text class="t" x="${L}" y="28">Agent effort, runs 1–${rs.length}: steps taken per run</text>
  <text class="sub" x="${L}" y="47">Gemini 4 Argon on the demo store. Lies (labeled) take as many steps as honest successes.</text>
  ${legend(L, 74, ORDER)}
  ${g}
  <text class="ax" x="${L + pw / 2}" y="${H - 6}" text-anchor="middle">Run number (table above)</text>
  <text class="ax" transform="translate(14 ${T + ph / 2}) rotate(-90)" text-anchor="middle">Steps</text>
</svg>\n`;
}

function chartByOutcome(rs) {
  const W = 760, H = 300, L = 228, R = 70, T = 70, B = 36;
  const groups = ORDER.map(k => {
    const g = rs.filter(r => outcome(r) === k);
    const avg = g.reduce((s, r) => s + r.agent.steps.length, 0) / (g.length || 1);
    const secs = g.reduce((s, r) => s + r.seconds, 0) / (g.length || 1);
    return { k, n: g.length, avg, secs };
  });
  const maxX = 8, pw = W - L - R, rowH = (H - T - B) / groups.length, bh = 26;
  const x = v => L + (v / maxX) * pw;
  let g = "";
  for (let v = 0; v <= maxX; v += 2) g += `<line class="${v ? "grid" : "base"}" x1="${x(v)}" x2="${x(v)}" y1="${T - 6}" y2="${H - B}"/><text class="ax" x="${x(v)}" y="${H - B + 16}" text-anchor="middle">${v}</text>`;
  groups.forEach((d, i) => {
    const cy = T + i * rowH + (rowH - bh) / 2, w = x(d.avg) - x(0), r = Math.min(4, bh / 2);
    g += `<text class="lg" x="${L - 12}" y="${cy + bh / 2 - 2}" text-anchor="end">${LABEL[d.k].replace(/ \(.*\)/, "")}</text>`;
    g += `<text class="ax" x="${L - 12}" y="${cy + bh / 2 + 13}" text-anchor="end">${d.n} runs · avg ${Math.round(d.secs)}s</text>`;
    g += `<path class="${d.k}" d="M${x(0)},${cy} H${x(0) + w - r} Q${x(0) + w},${cy} ${x(0) + w},${cy + r} V${cy + bh - r} Q${x(0) + w},${cy + bh} ${x(0) + w - r},${cy + bh} H${x(0)} Z"><title>${LABEL[d.k]}: ${d.n} runs, ${d.avg.toFixed(1)} steps on average, ${Math.round(d.secs)}s</title></path>`;
    g += `<text class="val" x="${x(0) + w + 8}" y="${cy + bh / 2 + 4}">${d.avg.toFixed(1)} steps</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" class="s" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Average steps per run by outcome, all ${rs.length} runs">${STYLE}
  <rect class="bg" width="${W}" height="${H}" rx="8"/>
  <text class="t" x="24" y="28">All ${rs.length} runs: average steps by outcome</text>
  <text class="sub" x="24" y="47">A lying run looks just as busy as an honest one. Effort can't tell you the agent lied; the answer key can.</text>
  ${g}
  <text class="ax" x="${L + pw / 2}" y="${H - 4}" text-anchor="middle">Average steps per run</text>
</svg>\n`;
}

writeFileSync(rootPath("docs", "effort-runs.svg"), chartRuns(runs.slice(0, 20)));
writeFileSync(rootPath("docs", "effort-by-outcome.svg"), chartByOutcome(runs));
console.log(`Wrote docs/effort-runs.svg (runs 1-${Math.min(20, runs.length)}) and docs/effort-by-outcome.svg (${runs.length} runs)`);
