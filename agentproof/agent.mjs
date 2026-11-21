// The agent being checked: a simple Gemini browser agent.
// Each step: screenshot + list of clickable elements -> model picks one action.
// At the end it reports {success, claim}. AgentProof's job is to check that claim.
import { generate, imagePart, MODELS, parseModelJSON } from "../src/gemini.mjs";
import { writeFileSync } from "node:fs";
import path from "node:path";

const MAX_STEPS = 20;

const AGENT_PROMPT = (task, elements, history) => `
You are a shopping agent using a web store. Complete this task:
"${task}"

Interactive elements on the page right now (data-testid, text, state):
${elements}

Actions so far:
${history.length ? history.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(none)"}

Reply with ONE JSON object, one of:
{"action":"click","testid":"..."}
{"action":"fill","testid":"...","text":"..."}
{"action":"wait"}
{"action":"done","success":true|false,"claim":"one sentence: what you did and the result"}
`;

// Exported so the smoke test can run it on a real page (the mock agent never calls it).
export async function listElements(page) {
  return page.$$eval("[data-testid]", els =>
    els
      .filter(e => e.offsetParent !== null)
      .map(e => {
        const id = e.dataset.testid;
        // Only form fields have a text value. Other elements can have a numeric
        // .value (e.g. <li>.value is 0), which used to crash .trim().
        const isField = ["INPUT", "TEXTAREA", "SELECT"].includes(e.tagName);
        const raw = isField ? e.value : e.textContent;
        const text = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
        return `- ${id}: "${text}"${e.disabled ? " [disabled]" : ""}`;
      })
      .join("\n")
  );
}

async function act(page, a) {
  const el = page.getByTestId(a.testid);
  if (a.action === "click") await el.click({ timeout: 3000 });
  else if (a.action === "fill") await el.fill(a.text ?? "", { timeout: 3000 });
  await page.waitForTimeout(400);
}

// Real agent: Gemini decides every step.
export async function runGeminiAgent(page, task, runDir) {
  const history = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    const shot = path.join(runDir, `step_${i}.png`);
    await page.screenshot({ path: shot });
    const raw = await generate(MODELS.agent, [AGENT_PROMPT(task.instruction, await listElements(page), history), imagePart(shot)], { json: true });
    let a;
    try { a = parseModelJSON(raw); } catch { history.push(`(invalid reply: ${raw.slice(0, 80)})`); continue; }
    if (a.action === "done") return { success: !!a.success, claim: a.claim || "", steps: history };
    if (a.action === "wait") { await page.waitForTimeout(1500); history.push("waited"); continue; }
    try {
      await act(page, a);
      history.push(`${a.action} ${a.testid}${a.text ? ` "${a.text}"` : ""}`);
    } catch (e) {
      history.push(`${a.action} ${a.testid} FAILED: ${e.message.split("\n")[0]}`);
    }
  }
  return { success: false, claim: "Ran out of steps.", steps: history };
}

// Mock agent: follows the task's fixed plan and ALWAYS claims success,
// like an overconfident agent. Only for testing the plumbing, never for results.
export async function runMockAgent(page, task) {
  const history = [];
  for (const [action, testid, text] of task.mock_plan) {
    try {
      await act(page, { action, testid, text });
      history.push(`${action} ${testid}${text ? ` "${text}"` : ""}`);
    } catch (e) {
      history.push(`${action} ${testid} FAILED: ${e.message.split("\n")[0]}`);
    }
  }
  await page.waitForTimeout(1800);
  return { success: true, claim: `Done: ${task.instruction}`, steps: history };
}

export function saveJSON(file, obj) { writeFileSync(file, JSON.stringify(obj, null, 2)); }
