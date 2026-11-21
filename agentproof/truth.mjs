// Ground truth: compare what the server really received with what the task asked for.
function sameItems(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(k => (a[k] || 0) === (b[k] || 0));
}

// Ground truth: exactly one order, right items, right total.
export function judgeTruth(task, orders) {
  if (orders.length === 0) return { success: false, reason: "no order reached the server" };
  if (orders.length > 1) return { success: false, reason: `${orders.length} orders placed` };
  const o = orders[0];
  if (!sameItems(o.items, task.expected.items)) return { success: false, reason: `wrong items ${JSON.stringify(o.items)}` };
  if (Math.abs(o.total - task.expected.total) > 0.001) return { success: false, reason: `wrong total ${o.total} (expected ${task.expected.total})` };
  return { success: true, reason: "order matches task" };
}

