// Thin wrapper around the Gemini SDK. Model IDs come from .env so you can
// swap Argon / Carbon / Neon / Hydrogen without touching code.
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import { readFileSync } from "node:fs";

// Created on first use, so scripts that never call Gemini (mock mode, the
// trust verifier, unit tests) don't need an API key.
let client;
export function getAI() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and fill it in.");
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

export const MODELS = {
  // Fast model: watches the video, finds actions and timestamps.
  perceive: process.env.MODEL_PERCEIVE,
  // Strongest reasoner: the judge.
  author: process.env.MODEL_AUTHOR,
  // The agent being checked (any model; it does not need to be good).
  agent: process.env.MODEL_AGENT || process.env.MODEL_PERCEIVE,
  // Baseline: one call, video in, verdict out. Same strong model as author
  // so the comparison isolates the method, not the model.
  baseline: process.env.MODEL_BASELINE || process.env.MODEL_AUTHOR,
};

const ENV_FOR = { perceive: "MODEL_PERCEIVE", author: "MODEL_AUTHOR", agent: "MODEL_AGENT (or MODEL_PERCEIVE)", baseline: "MODEL_BASELINE (or MODEL_AUTHOR)" };

// Fail at startup, naming the missing variable, instead of on the first API call.
export function requireModels(...keys) {
  const missing = keys.filter(k => !MODELS[k]);
  const needKey = !process.env.GEMINI_API_KEY;
  if (missing.length || needKey) {
    const what = [...(needKey ? ["GEMINI_API_KEY"] : []), ...missing.map(k => ENV_FOR[k] || k)];
    throw new Error(`Missing in .env: ${what.join(", ")}. See .env.example.`);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Rate limits, server errors and dropped connections are worth retrying;
// bad requests (400/401/403/404) are not.
export function isRetryable(e) {
  const status = e?.status ?? e?.code ?? e?.response?.status;
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(String(e?.message ?? e));
}

/** Exponential backoff with jitter: ~1s, 2s, 4s between 4 attempts. */
export async function withRetry(fn, { tries = 4, baseMs = 1000, retryable = isRetryable, wait = sleep, label = "Gemini call" } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= tries || !retryable(e)) throw e;
      const ms = baseMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
      console.warn(`  ${label} failed (${String(e.message ?? e).split("\n")[0].slice(0, 120)}), retry ${attempt}/${tries - 1} in ${(ms / 1000).toFixed(1)}s`);
      await wait(ms);
    }
  }
}

const uploadCache = new Map();
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

export async function uploadVideo(filePath) {
  if (uploadCache.has(filePath)) return uploadCache.get(filePath);
  const ai = getAI();
  let f = await withRetry(() => ai.files.upload({ file: filePath, config: { mimeType: "video/mp4" } }), { label: "video upload" });
  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  while (f.state === "PROCESSING") {
    if (Date.now() > deadline) throw new Error(`Video still PROCESSING after ${UPLOAD_TIMEOUT_MS / 1000}s: ${filePath}`);
    await sleep(2000);
    f = await withRetry(() => ai.files.get({ name: f.name }), { label: "upload status" });
  }
  if (f.state === "FAILED") throw new Error(`Video upload failed: ${filePath}`);
  uploadCache.set(filePath, f);
  return f;
}

export const videoPart = f => createPartFromUri(f.uri, f.mimeType);

export const imagePart = pngPath => ({
  inlineData: { mimeType: "image/png", data: readFileSync(pngPath).toString("base64") },
});

export async function generate(model, parts, { json = false } = {}) {
  if (!model) throw new Error("Model ID missing. Fill in MODEL_* in .env");
  const ai = getAI();
  const res = await withRetry(() => ai.models.generateContent({
    model,
    contents: createUserContent(parts),
    config: json ? { responseMimeType: "application/json" } : {},
  }), { label: `generate(${model})` });
  if (typeof res.text !== "string" || !res.text) throw new Error(`Empty reply from ${model}`);
  return res.text;
}

// Models sometimes wrap JSON in ```json fences or add a sentence around it.
// Returns the parsed value, or throws with the start of the reply.
export function parseModelJSON(text) {
  const s = String(text ?? "").trim();
  const fenced = s.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const candidates = [s, fenced?.[1]?.trim()];
  const first = s.search(/[[{]/);
  const last = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (first >= 0 && last > first) candidates.push(s.slice(first, last + 1));
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c); } catch {}
  }
  throw new Error(`Model did not return valid JSON: ${s.slice(0, 120)}`);
}

// generate + parse. If the reply is not valid JSON, ask once more.
export async function generateJSON(model, parts) {
  const raw = await generate(model, parts, { json: true });
  try {
    return parseModelJSON(raw);
  } catch {
    const again = await generate(model, [...parts, "Your previous reply was not valid JSON. Reply with ONLY the JSON object."], { json: true });
    return parseModelJSON(again);
  }
}
