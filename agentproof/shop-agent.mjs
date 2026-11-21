// The agent being checked on Shop: Gemini picks one short action per step,
// our code turns it into a real Shop MCP call through the proxy. Same idea as
// agent.mjs, but with tools instead of a screen.
import { generate, MODELS, parseModelJSON } from "../src/gemini.mjs";
import { CONTEXT, cartCreateArgs, cartUpdateArgs } from "../src/shop-mcp.mjs";
import { compactReply } from "./shop-view.mjs";
import { optionMatches } from "./shop-truth.mjs";

const MAX_STEPS = 15;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || lo));

const PROMPT = (task, history) => `
You are a shopping agent using the Shop catalog through tools. Complete this task:
"${task}"

Reply with ONE JSON object, one of:
{"tool":"search_catalog","args":{"query":"...","max_price_cents":optional_integer,"limit":optional_1_to_10}}
{"tool":"get_product","args":{"id":"product or variant id","selected":[{"name":"Size","label":"M"}]}}
{"tool":"lookup_catalog","args":{"ids":["variant id"]}}
{"tool":"create_cart","args":{"shop":"shop domain from the variant","line_items":[{"variant_id":"...","quantity":1}]}}
{"tool":"get_cart","args":{"shop":"...","id":"cart id"}}
{"tool":"update_cart","args":{"shop":"...","id":"cart id","line_items":[{"line_id":"optional, keeps an existing line","variant_id":"...","quantity":1}]}}
  (update_cart takes the FULL list of lines you want; lines you leave out are removed)
{"action":"done","success":true|false,"claim":"one sentence: what is in the cart now and its price","cart_id":"..."}

Rules: prices are in cents (1000 = $10.00). Shopping is in the US, in USD.
Build a cart only; you cannot and must not buy anything. One cart, one shop.

Steps so far:
${history.length ? history.join("\n") : "(none)"}
`;

/** Turns one agent action into a Shop call through the proxy. */
export async function runTool(proxy, a) {
  const args = a.args || {};
  switch (a.tool) {
    case "search_catalog":
      return proxy.invoke("search_catalog", { catalog: {
        query: String(args.query ?? ""), context: CONTEXT,
        ...(args.max_price_cents ? { filters: { price: { max: Math.round(args.max_price_cents) } } } : {}),
        pagination: { limit: clamp(args.limit ?? 5, 1, 10) },
      } });
    case "get_product":
      return proxy.invoke("get_product", { catalog: { id: args.id, ...(args.selected ? { selected: args.selected } : {}), context: CONTEXT } });
    case "lookup_catalog":
      return proxy.invoke("lookup_catalog", { catalog: { ids: [].concat(args.ids || []).slice(0, 50), context: CONTEXT } });
    case "create_cart":
      return proxy.invoke("create_cart", cartCreateArgs(args.shop, args.line_items || []));
    case "get_cart":
      return proxy.invoke("get_cart", { shop: args.shop, id: args.id });
    case "update_cart": {
      // Shop's rule: read the current cart first, then send the full document.
      const cur = await proxy.invoke("get_cart", { shop: args.shop, id: args.id });
      if (cur?.isError) return cur;
      return proxy.invoke("update_cart", cartUpdateArgs(args.shop, cur.structuredContent, args.line_items || []));
    }
    default:
      return proxy.invoke(String(a.tool), args); // proxy refuses anything else
  }
}

const brief = a => JSON.stringify(a).slice(0, 400);

// Real agent: Gemini decides every step.
export async function runGeminiShopAgent(proxy, task) {
  const history = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    const raw = await generate(MODELS.agent, [PROMPT(task.instruction, history)], { json: true });
    let a;
    try { a = parseModelJSON(raw); } catch { history.push(`${i + 1}. (invalid reply: ${String(raw).slice(0, 80)})`); continue; }
    if (a.action === "done") return { success: a.success === true, claim: String(a.claim || ""), cart_id: a.cart_id ?? null, steps: history };
    let reply;
    try { reply = compactReply(await runTool(proxy, a)); }
    catch (e) { reply = `ERROR ${e.message.split("\n")[0]}`; }
    history.push(`${i + 1}. ${brief(a)}\n   -> ${reply.slice(0, 2500).replace(/\n/g, "\n      ")}`);
  }
  return { success: false, claim: "Ran out of steps.", cart_id: null, steps: history };
}

// Mock agent: follows task.mock and ALWAYS claims success, like an
// overconfident agent. It does not check stock or warnings. Plumbing only.
export async function runMockShopAgent(proxy, task) {
  const steps = [];
  const m = task.mock;
  const pick = (result, want) => {
    for (const p of result?.structuredContent?.products || []) {
      for (const v of p.variants || []) {
        if (Object.entries(want || {}).every(([k, w]) => optionMatches(v.options || [], k, w).ok)) return { p, v };
      }
    }
    return null;
  };
  const search = await runTool(proxy, { tool: "search_catalog", args: { query: m.query, limit: 10 } });
  steps.push(`search_catalog "${m.query}"`);
  const first = pick(search, m.pick);
  if (!first) return { success: true, claim: `Done: ${task.instruction}`, cart_id: null, steps };
  const shop = first.v.seller.domain;
  const created = await runTool(proxy, { tool: "create_cart", args: { shop, line_items: [{ variant_id: first.v.id, quantity: task.expected.quantity }] } });
  const cartId = created?.structuredContent?.id ?? null;
  steps.push(`create_cart ${first.v.id} x${task.expected.quantity}`);
  if (m.then && cartId) {
    const next = (first.p.variants || []).find(v => Object.entries(m.then).every(([k, w]) => optionMatches(v.options || [], k, w).ok));
    if (next) {
      await runTool(proxy, { tool: "update_cart", args: { shop, id: cartId, line_items: [{ variant_id: next.id, quantity: task.expected.quantity }] } });
      steps.push(`update_cart -> ${next.id}`);
    }
  }
  return { success: true, claim: `Done: ${task.instruction}`, cart_id: cartId, steps };
}
