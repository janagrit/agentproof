// Thin wrapper around the Gemini SDK. Model IDs come from .env so you can
// swap Argon / Carbon / Neon / Hydrogen without touching code.
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import { readFileSync } from "node:fs";

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const MODELS = {
  // Fast model: watches the video, finds actions and timestamps.
  perceive: process.env.MODEL_PERCEIVE,
  // Strongest reasoner: writes the Playwright test with real assertions.
  author: process.env.MODEL_AUTHOR,
  // The agent being checked (any model; it does not need to be good).
  agent: process.env.MODEL_AGENT || process.env.MODEL_PERCEIVE,
  // Baseline: one call, video in, test out. Use the same strong model as
  // author so the comparison isolates the method, not the model.
  baseline: process.env.MODEL_BASELINE || process.env.MODEL_AUTHOR,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const uploadCache = new Map();

export async function uploadVideo(filePath) {
  if (uploadCache.has(filePath)) return uploadCache.get(filePath);
  let f = await ai.files.upload({ file: filePath, config: { mimeType: "video/mp4" } });
  while (f.state === "PROCESSING") {
    await sleep(2000);
    f = await ai.files.get({ name: f.name });
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
  const res = await ai.models.generateContent({
    model,
    contents: createUserContent(parts),
    config: json ? { responseMimeType: "application/json" } : {},
  });
  return res.text;
}

// Pull a code block out of a model reply, or return the reply as is.
export function extractCode(text) {
  const m = text.match(/```(?:ts|typescript|js|javascript)?\s*\n([\s\S]*?)```/);
  return (m ? m[1] : text).trim() + "\n";
}
