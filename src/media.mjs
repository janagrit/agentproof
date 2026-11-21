// Video helpers. Playwright records .webm; Gemini wants .mp4.
import { execFileSync, spawnSync } from "node:child_process";

export function hasFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return r.status === 0;
}

export function toMp4(src, dst) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", dst]);
}
