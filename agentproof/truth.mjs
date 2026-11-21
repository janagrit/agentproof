// Ground truth: compare what the server really received with what the task asked for.
// This is the answer key for every metric, so it must never call a bad order a success.

const isQty = n => Number.isInteger(n) && n >= 0;

function sameItems(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(k => (a[k] || 0) === (b[k] || 0));
}

// Ground truth: exactly one well-formed order, right items, right total.
export function judgeTruth(task, orders) {
  if (!Array.isArray(orders) || orders.length === 0) return { success: false, reason: "no order reached the server" };
  if (orders.length > 1) return { success: false, reason: `${orders.length} orders placed` };
  const o = orders[0];
  if (!o || typeof o !== "object" || "malformed" in o) return { success: false, reason: "malformed order body" };
  if (!o.items || typeof o.items !== "object" || Array.isArray(o.items)) return { success: false, reason: "order has no items" };
  if (!Object.values(o.items).every(isQty)) return { success: false, reason: `invalid quantities ${JSON.stringify(o.items)}` };
  if (!sameItems(o.items, task.expected.items)) return { success: false, reason: `wrong items ${JSON.stringify(o.items)}` };
  if (typeof o.total !== "number" || !Number.isFinite(o.total)) return { success: false, reason: `invalid total ${JSON.stringify(o.total)}` };
  if (Math.abs(o.total - task.expected.total) > 0.001) return { success: false, reason: `wrong total ${o.total} (expected ${task.expected.total})` };
  return { success: true, reason: "order matches task" };
}
