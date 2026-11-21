// Turns Shop MCP replies into short text: what the agent reads, what the
// verifiers read, and what run.json stores. Keeping only these summaries (not
// raw catalog data) follows Shop's "use live data, don't cache" rule.
const money = c => (typeof c === "number" ? `$${(c / 100).toFixed(2)}` : "?");

function variantLine(x) {
  const opts = (x.options || []).map(o => `${o.name}=${o.label}`).join(", ") || "no options";
  const price = x.price?.amount ?? x.price;
  return `variant ${x.id} | ${opts} | ${money(price)} ${x.price?.currency ?? ""} (${price} cents) | ${x.availability?.available === false ? "SOLD OUT" : "in stock"} | shop=${x.seller?.domain ?? "?"}`;
}

function cartText(c) {
  const lines = (c.line_items || []).map(l => `  line ${l.id} | variant ${l.item?.id} | ${l.item?.title} | ${money(l.item?.price)} each | qty ${l.quantity}`);
  const total = (c.totals || []).find(t => t.type === "total")?.amount;
  return [`cart ${c.id} | ${c.currency ?? ""} total ${money(total)} | ${lines.length} line(s)`, ...(lines.length ? lines : ["  (no lines: cart is EMPTY)"])].join("\n");
}

const notes = sc => [
  ...(sc?.messages || []).map(m => `${(m.type || "message").toUpperCase()} ${m.code ?? ""}: ${m.content ?? ""}`.trim()),
  ...(sc?.next || []).slice(0, 2).map(n => `hint: ${String(n).slice(0, 200)}`),
];

/** Short text for one tool reply. */
export function compactReply(result, { maxProducts = 6, maxVariants = 6 } = {}) {
  if (!result) return "(no reply)";
  const sc = result.structuredContent ?? {};
  const out = [];
  if (result.isError) out.push("ERROR");
  if (Array.isArray(sc.products)) {
    out.push(`${sc.products.length} product(s)`);
    for (const p of sc.products.slice(0, maxProducts)) {
      out.push(`- ${p.title} (product ${p.id})`);
      for (const x of (p.variants || []).slice(0, maxVariants)) out.push(`    ${variantLine(x)}`);
    }
  }
  if (sc.product) {
    out.push(`product ${sc.product.title} (${sc.product.id})`);
    if (sc.product.selected_variant) out.push(`  selected: ${variantLine(sc.product.selected_variant)}`);
    for (const x of (sc.product.variants || []).slice(0, maxVariants)) out.push(`    ${variantLine(x)}`);
  }
  if (Array.isArray(sc.line_items)) out.push(cartText(sc));
  out.push(...notes(sc));
  return out.join("\n") || "(empty reply)";
}
