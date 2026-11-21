// Pure helpers for managed.mjs (no network, no env), so they can be unit tested.
import { readFileSync } from "node:fs";

// The managed agent's last line of output should be {"success":..,"claim":..}.
// Search from the bottom for the last parseable one.
export function parseClaim(text = "") {
  const lines = String(text).trim().split("\n").reverse();
  for (const l of lines) {
    const m = l.match(/\{.*"success".*\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]);
        return { success: j.success === true, claim: typeof j.claim === "string" ? j.claim : "" };
      } catch {}
    }
  }
  return { success: false, claim: `(no JSON claim) ${String(text).slice(-200)}` };
}

// Pull a simple network list out of a HAR, same shape as collect.mjs records.
// Returns null if the HAR is missing or unreadable.
export function harToNetwork(harPath) {
  try {
    const har = JSON.parse(readFileSync(harPath, "utf8"));
    return har.log.entries.map(e => ({
      method: e.request.method,
      url: e.request.url.replace(/^https?:\/\/[^/]+/, ""),
      status: e.response?.status ?? null,
    }));
  } catch { return null; }
}
