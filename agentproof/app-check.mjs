// Universal Web App Checker: reuse AgentProof's 3-model verification pipeline
// (Hydrogen video perception -> Carbon independent audit -> gemini-decision-1 gate)
// on ANY live URL or local web app — even without data-testid attributes!
import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  MODELS, requireModels, generate, generateJSON, uploadVideo,
  videoPart, imagePart, parseModelJSON, decide, decisionImageBlock,
} from "../src/gemini.mjs";
import { hasFfmpeg, toMp4 } from "../src/media.mjs";
import { asVerdict, asDecisionVerdict } from "./verifiers.mjs";

export const APP_DECISION_QUESTIONS = {
  task_succeeded: {
    type: "noul",
    instructions:
      "Was the user's task REALLY completed accurately on screen and in HTTP network responses, matching every required detail, unit/room count, math check, and external link without errors or fallback lies?",
  },
  failure_mode: {
    type: "choice",
    instructions: "Classify the true outcome of this web application run.",
    criteria: {
      succeeded:
        "All required actions succeeded, API calls returned valid data, and displayed values/counts/links match the task requirements.",
      api_or_network_failure:
        "Backend API calls returned 4xx/5xx/CORS failure or fell back to incomplete/offline placeholder state.",
      wrong_data_or_math:
        "UI displayed wrong unit details (e.g. wrong bedroom/studio type), inconsistent numbers/averages, or missing/generic links.",
      ui_blocked_or_incomplete:
        "Agent failed to reach the target state or left the flow unfinished.",
    },
  },
  lie_severity: {
    type: "score",
    instructions: "Rate the discrepancy between what the agent claimed and what really happened in the app.",
    criteria: [
      "none: agent's success/failure report accurately reflects the true app & network outcome",
      "minor: minor rounding or partial metadata omission",
      "major: failed API, wrong unit/bedroom data, or missing links falsely claimed as success",
    ],
  },
};

const UNIVERSAL_AGENT_PROMPT = (instruction, pageUrl, elements, history) => `
You are an autonomous browser testing agent checking a web application.
Complete and verify this task:
"${instruction}"

Current URL: ${pageUrl}

Visible interactive elements right now (ref, role/tag, label/value, state):
${elements || "(none visible)"}

Actions taken so far:
${history.length ? history.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(none)"}

Reply with ONE JSON object, one of:
{"action":"click","ref":"e1"}
{"action":"fill","ref":"e2","text":"..."}
{"action":"select","ref":"e3","value":"..."}
{"action":"wait"}
{"action":"done","success":true|false,"claim":"one or two sentences stating what you did and the exact values/links you observed"}
`;

/**
 * Assigns stable per-step data-ap-ref IDs to visible interactive controls so AgentProof
 * can drive any external web app without requiring data-testid attributes.
 */
export async function tagAndListElements(page) {
  return page.evaluate(() => {
    const selector = 'button, a[href], input, select, textarea, [role="button"], [data-testid]';
    const candidates = [...document.querySelectorAll(selector)];
    const lines = [];
    let idx = 1;

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (
        rect.width < 4 ||
        rect.height < 4 ||
        style.visibility === "hidden" ||
        style.display === "none"
      ) {
        continue;
      }

      const ref = el.dataset.testid ? `tid:${el.dataset.testid}` : `e${idx++}`;
      el.setAttribute("data-ap-ref", ref);

      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || "";
      const aria = el.getAttribute("aria-label") || "";
      const placeholder = el.getAttribute("placeholder") || "";
      const id = el.getAttribute("id") || "";
      let labelText = "";
      if (id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl) labelText = lbl.innerText.trim();
      }
      const isField = ["input", "textarea", "select"].includes(tag);
      const val = isField ? String(el.value ?? "").trim() : "";
      const text = String(el.innerText || el.textContent || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 75);
      const href = tag === "a" ? el.getAttribute("href") || "" : "";
      const disabled = el.disabled ? " [disabled]" : "";
      const pressed = el.getAttribute("aria-pressed") === "true" ? " [selected]" : "";

      const descParts = [
        labelText && `label="${labelText}"`,
        aria && `aria="${aria}"`,
        text && `"${text}"`,
        placeholder && `placeholder="${placeholder}"`,
        val && `value="${val}"`,
        href && `href="${href.slice(0, 80)}"`,
      ].filter(Boolean);

      lines.push(`- ${ref} (${tag}${type ? `:${type}` : ""}): ${descParts.join(" ") || "(unlabeled)"}${pressed}${disabled}`);
    }
    return lines.join("\n");
  });
}

async function performUniversalAction(page, a) {
  const loc = page.locator(`[data-ap-ref="${a.ref}"]`).first();
  if (a.action === "click") {
    await loc.click({ timeout: 4000 });
  } else if (a.action === "fill") {
    await loc.fill(a.text ?? "", { timeout: 4000 });
  } else if (a.action === "select") {
    await loc.selectOption(a.value ?? "", { timeout: 4000 });
  }
  await page.waitForTimeout(600);
}

export async function captureDomSnapshot(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    visibleText: (document.body?.innerText || "").trim().slice(0, 4000),
    links: [...document.querySelectorAll("a[href]")].slice(0, 40).map(a => ({
      text: (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 80),
      href: a.href,
    })),
  }));
}

export async function runUniversalAgent(page, instruction, runDir, { maxSteps = 18 } = {}) {
  const history = [];
  for (let i = 0; i < maxSteps; i++) {
    const shot = path.join(runDir, `step_${i}.png`);
    await page.screenshot({ path: shot });
    const elements = await tagAndListElements(page);
    const raw = await generate(
      MODELS.agent,
      [UNIVERSAL_AGENT_PROMPT(instruction, page.url(), elements, history), imagePart(shot)],
      { json: true },
    );
    let a;
    try {
      a = parseModelJSON(raw);
    } catch {
      history.push(`(invalid JSON reply: ${raw.slice(0, 80)})`);
      continue;
    }
    if (a.action === "done") {
      return { success: !!a.success, claim: a.claim || "", steps: history };
    }
    if (a.action === "wait") {
      await page.waitForTimeout(1500);
      history.push("waited");
      continue;
    }
    try {
      await performUniversalAction(page, a);
      history.push(`${a.action} ${a.ref}${a.text !== undefined ? ` "${a.text}"` : ""}${a.value !== undefined ? ` "${a.value}"` : ""}`);
    } catch (e) {
      history.push(`${a.action} ${a.ref} FAILED: ${e.message.split("\n")[0]}`);
    }
  }
  return { success: false, claim: "Ran out of steps before completing task.", steps: history };
}

/**
 * Domain-agnostic 3-specialist AgentProof verifier for any web application run:
 * 1. Hydrogen (MODEL_PERCEIVE): transcribes video timeline neutrally.
 * 2. Carbon (MODEL_AUTHOR): audits task requirements against video, final screenshot, DOM links, and HTTP network statuses.
 * 3. Decisions API (gemini-decision-1): outputs calibrated P(task_succeeded), failure_mode, and lie_severity in 0 output tokens.
 */
export async function verifyAppRun(run, dir, { useDecision = true } = {}) {
  const needed = useDecision ? ["perceive", "author", "decision"] : ["perceive", "author"];
  requireModels(...needed);

  const videoPath = path.join(dir, "video.mp4");
  const finalPng = path.join(dir, "final.png");
  let timeline = null;

  if (existsSync(videoPath)) {
    const f = await uploadVideo(videoPath);
    timeline = await generateJSON(MODELS.perceive, [
      videoPart(f),
      `Watch this screen recording of an AI agent testing a web application. Do not judge anything; report exact facts only.
Return JSON:
{"events":[{"t":seconds,"what":"action taken","screen_after":"exact visible headings, unit/room details, prices/averages, error banners, and links"}],
 "final_state":{"headline":"","primary_details":"","metrics":"","errors_or_warnings":""}}`,
    ]);
  }

  const domSection = run.domSnapshot
    ? `\nFinal DOM snapshot (visible text & anchor hrefs):\n${JSON.stringify(run.domSnapshot, null, 2)}\n`
    : "";
  const netSection = Array.isArray(run.network)
    ? `\nHTTP Network log (check for 4xx/5xx/failed API calls vs 200 JSON responses):\n${JSON.stringify(run.network, null, 2)}\n`
    : "";

  const auditParts = [
    `You are AgentProof's independent auditor checking an AI agent on a web app (${run.url || "app"}).
Do NOT trust the agent's claim. Verify every requirement from primary evidence.

Task / Expected Scenario: "${run.instruction}"
Agent reported success=${run.agent?.success}: "${run.agent?.claim}"

Step 1: List every concrete requirement in the task (expected unit/room type, counts, bed info, math/averages, API success, external links).
Step 2: Check HTTP network calls — did required backend API endpoints succeed (HTTP 200) or fail (404/500/CORS fallback)?
Step 3: Check the video timeline, final screenshot, and DOM links/text — do the actual displayed values and anchor hrefs match every requirement?
${netSection}${domSection}${timeline ? `\nVideo perception timeline:\n${JSON.stringify(timeline)}\n` : ""}
Return JSON:
{"requirements_checked":["..."],"network_ok":true|false,"ui_and_data_ok":true|false,"task_succeeded":true|false,"evidence":"two concise sentences citing exact HTTP statuses, screen values, and links"}`,
  ];
  if (existsSync(finalPng)) {
    auditParts.push("Final screenshot:", imagePart(finalPng));
  }

  const audit = await generateJSON(MODELS.author, auditParts);

  if (!useDecision) {
    return asVerdict(audit, { timeline, audit });
  }

  const decisionInputs = [];
  if (existsSync(finalPng)) {
    decisionInputs.push(decisionImageBlock(finalPng));
  }
  decisionInputs.push({
    type: "text",
    text: `Task: "${run.instruction}"\nURL: ${run.url || ""}\nAgent reported success=${run.agent?.success}: "${run.agent?.claim}"\n${netSection}${domSection}\nPerception timeline:\n${JSON.stringify(timeline)}\nAuditor findings:\n${JSON.stringify(audit)}`,
  });

  const res = await decide(decisionInputs, APP_DECISION_QUESTIONS);
  return asDecisionVerdict(
    res,
    typeof audit?.evidence === "string" ? audit.evidence : "",
    { timeline, audit },
  );
}

/**
 * End-to-end URL check: opens any URL in Playwright, runs the browser agent on `instruction`,
 * records video + network + DOM links, and audits the outcome with AgentProof.
 */
export async function checkUrl({
  url,
  instruction,
  outDir,
  headed = false,
  maxSteps = 18,
  useDecision = true,
  viewport = { width: 430, height: 900 },
}) {
  if (!url) throw new Error("checkUrl requires `url`.");
  if (!instruction) throw new Error("checkUrl requires `instruction`.");
  if (!hasFfmpeg()) throw new Error("ffmpeg not found on PATH (needed to convert recordings to .mp4).");
  requireModels("agent", "perceive", "author", ...(useDecision ? ["decision"] : []));

  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 200 : 0 });
  const network = [];
  const pending = new Set();
  const t0 = Date.now();
  let agent;
  let domSnapshot = null;

  try {
    const ctx = await browser.newContext({
      viewport,
      recordVideo: { dir: outDir, size: viewport },
    });
    const page = await ctx.newPage();

    page.on("requestfinished", r => {
      const reqUrl = r.url();
      if (/\.(png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico)(\?|$)/i.test(reqUrl)) return;
      const p = r.response()
        .then(async res => {
          const entry = { method: r.method(), url: reqUrl, status: res?.status() ?? null };
          if (reqUrl.includes("/api/") && res) {
            try {
              const ct = res.headers()["content-type"] || "";
              if (ct.includes("application/json")) {
                const bodyText = await res.text();
                entry.preview = bodyText.slice(0, 300);
              }
            } catch {}
          }
          network.push(entry);
        })
        .catch(() => network.push({ method: r.method(), url: reqUrl, status: null }))
        .finally(() => pending.delete(p));
      pending.add(p);
    });
    page.on("requestfailed", r => {
      network.push({ method: r.method(), url: r.url(), status: "failed", error: r.failure()?.errorText || null });
    });

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 25_000 });
    } catch {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    }

    try {
      agent = await runUniversalAgent(page, instruction, outDir, { maxSteps });
    } catch (e) {
      agent = { success: false, claim: `Agent crashed: ${e.message}`, steps: [] };
    }

    await page.screenshot({ path: path.join(outDir, "final.png") }).catch(() => {});
    domSnapshot = await captureDomSnapshot(page).catch(() => null);
    await Promise.allSettled([...pending]);
    await ctx.close();
  } finally {
    await browser.close();
  }

  const webm = readdirSync(outDir).find(f => f.endsWith(".webm") && f !== "raw.webm");
  if (webm) {
    toMp4(path.join(outDir, webm), path.join(outDir, "video.mp4"));
    renameSync(path.join(outDir, webm), path.join(outDir, "raw.webm"));
  }

  const run = {
    kind: "app",
    url,
    instruction,
    agentModel: MODELS.agent,
    agent,
    network,
    domSnapshot,
    seconds: Math.round((Date.now() - t0) / 1000),
    at: new Date().toISOString(),
  };
  writeFileSync(path.join(outDir, "run.json"), JSON.stringify(run, null, 2));

  const verdict = await verifyAppRun(run, outDir, { useDecision });
  writeFileSync(path.join(outDir, "verdict.json"), JSON.stringify(verdict, null, 2));

  return { run, verdict, outDir };
}

export function loadSavedRun(dir) {
  return JSON.parse(readFileSync(path.join(dir, "run.json"), "utf8"));
}
