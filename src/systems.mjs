// The two systems under test: baseline (1 call) and pipeline (2 models).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MODELS, uploadVideo, videoPart, imagePart, generate, extractCode } from "./gemini.mjs";
import { BASELINE_PROMPT, PERCEIVE_PROMPT, AUTHOR_PROMPT } from "./prompts.mjs";

export async function baseline(videoPath, dom) {
  const f = await uploadVideo(videoPath);
  const text = await generate(MODELS.baseline, [videoPart(f), BASELINE_PROMPT(dom)]);
  return extractCode(text);
}

function grabFrame(videoPath, t, outPng) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(Math.max(0, t)),
    "-i", videoPath, "-frames:v", "1", outPng]);
}

export async function pipeline(videoPath, dom, workDir) {
  // Step 1: fast model finds actions + timestamps.
  const f = await uploadVideo(videoPath);
  const raw = await generate(MODELS.perceive, [videoPart(f), PERCEIVE_PROMPT], { json: true });
  const { steps } = JSON.parse(raw);

  // Step 2: grab before/after frames around each action.
  const framesDir = path.join(workDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const images = [];
  steps.forEach((s, i) => {
    const before = path.join(framesDir, `${i}_before.png`);
    const after = path.join(framesDir, `${i}_after.png`);
    grabFrame(videoPath, s.t - 0.3, before);
    grabFrame(videoPath, s.t + 1.0, after);
    images.push(`Step ${i} BEFORE:`, imagePart(before), `Step ${i} AFTER:`, imagePart(after));
  });
  writeFileSync(path.join(workDir, "steps.json"), JSON.stringify(steps, null, 2));

  // Step 3: strong model writes the test from steps + frames + DOM.
  const text = await generate(MODELS.author, [AUTHOR_PROMPT(steps, dom), ...images]);
  return extractCode(text);
}

export const SYSTEMS = { baseline, pipeline };
