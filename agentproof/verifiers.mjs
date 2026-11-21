// The verifiers. Each one gets the agent's run (video, claim, optional
// network log) but NEVER the server's order log, which is the answer key.
// Each returns { task_succeeded: bool, evidence: string }.
import { MODELS, uploadVideo, videoPart, imagePart, generate } from "../src/gemini.mjs";
import path from "node:path";

const VERDICT_FORMAT = `
Return JSON: {"task_succeeded": true|false, "evidence": "one or two sentences citing what you saw, with timestamps"}
task_succeeded means the task was REALLY completed correctly, whatever the agent claims.
`;

// Baseline 1: what people do today. Believe the agent.
async function trust(run) {
  return { task_succeeded: run.agent.success, evidence: "Took the agent's word for it." };
}

// Baseline 2: one model call on the video.
async function single(run, dir) {
  const f = await uploadVideo(path.join(dir, "video.mp4"));
  const raw = await generate(MODELS.baseline, [videoPart(f), `
This is a screen recording of an AI agent doing a task in a web store.
Task: "${run.instruction}"
Agent's claim: "${run.agent.claim}"
Did the agent really complete the task correctly?
${VERDICT_FORMAT}`], { json: true });
  return JSON.parse(raw);
}

// AgentProof: two models, each with one job.
//  1. Perceive (fast model): watch the video and write down what is on screen.
//  2. Judge (strong model): work out what the right result should be from the
//     task, compare it to what was seen, and decide. Optionally reads the
//     network log, which catches failures the screen hides.
async function agentproof(run, dir, { network = false } = {}) {
  const f = await uploadVideo(path.join(dir, "video.mp4"));
  const timeline = await generate(MODELS.perceive, [videoPart(f), `
Watch this screen recording of a web store. Do not judge anything, just report.
Return JSON:
{"events":[{"t":seconds,"what":"action taken","screen_after":"exact visible values: cart items and quantities, total, discount message, button states, confirmation text, order number"}],
 "final_state":{"cart":"","total":"","discount_message":"","confirmation_visible":true|false,"order_number":""}}`], { json: true });

  const parts = [`
You are auditing an AI agent. Do NOT trust its claim. Work it out yourself.
Task: "${run.instruction}"
Agent's claim: "${run.agent.claim}"

Step 1: From the task and the prices on screen, compute what the cart and total SHOULD be.
Step 2: Compare with what the screen actually showed (timeline below and final screenshot).
Step 3: Check the order was really placed.
${network ? `Network log of the session (an order is only saved if POST /api/order succeeded):\n${JSON.stringify(run.network)}\n` : ""}
Timeline from the recording:
${timeline}
${VERDICT_FORMAT}`, "Final screenshot:", imagePart(path.join(dir, "final.png"))];
  const raw = await generate(MODELS.author, parts, { json: true });
  return { ...JSON.parse(raw), timeline: JSON.parse(timeline) };
}

export const VERIFIERS = {
  trust,
  single,
  agentproof,
  "agentproof+network": (run, dir) => agentproof(run, dir, { network: true }),
};
