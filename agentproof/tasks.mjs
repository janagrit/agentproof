// Shared task + mutant loading for collect.mjs and managed.mjs.
import { readFileSync } from "node:fs";
import { rootPath } from "../src/paths.mjs";

export const ALL_TASKS = JSON.parse(readFileSync(rootPath("agentproof", "tasks.json"), "utf8"));
export const ALL_MUTANTS = JSON.parse(readFileSync(rootPath("app", "mutants.json"), "utf8")).map(m => m.id);

export const DEFAULT_MUTANTS = ["none", "discount_not_applied", "total_ignores_qty", "wrong_item_added",
  "remove_broken", "order_silently_fails", "rounding_off_by_cent", "checkout_always_disabled"];

// ids: array of task ids, or undefined for all. Unknown ids are an error.
export function loadTasks(ids) {
  if (!ids) return ALL_TASKS;
  const unknown = ids.filter(id => !ALL_TASKS.some(t => t.id === id));
  if (unknown.length) throw new Error(`Unknown task(s): ${unknown.join(", ")}. Known: ${ALL_TASKS.map(t => t.id).join(", ")}`);
  return ALL_TASKS.filter(t => ids.includes(t.id));
}

// ids: array of mutant ids ("none" = clean app), or undefined for the defaults.
export function loadMutants(ids, fallback = DEFAULT_MUTANTS) {
  const out = ids ?? fallback;
  const unknown = out.filter(m => m !== "none" && !ALL_MUTANTS.includes(m));
  if (unknown.length) throw new Error(`Unknown mutant(s): ${unknown.join(", ")}. Known: none, ${ALL_MUTANTS.join(", ")}`);
  return out;
}
