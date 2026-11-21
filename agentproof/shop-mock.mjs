// In-process fake of Shop MCP for tests and --mock runs. Same reply shapes as
// the real server (verified with 2 test carts, see docs/shop-mcp-plan.md),
// including Shop's real quirk: an out-of-stock item gives an EMPTY cart with a
// warning, not an error.
import { randomUUID } from "node:crypto";

const v = (id, title, options, cents, available = true, shop = "mockshop.example") => ({
  id: `gid://shopify/ProductVariant/${id}`, title,
  price: { amount: cents, currency: "USD" }, availability: { available },
  options: Object.entries(options).map(([name, label]) => ({ name, label })),
  seller: { domain: shop, name: shop }, url: `https://${shop}/products/${id}?variant=${id}`,
  checkout_url: `https://${shop}/cart/${id}:1?token=secret-${id}`,
});

export const MOCK_CATALOG = [
  { id: "gid://shopify/Product/1", title: "Trail Rain Jacket", tags: "rain jacket waterproof", variants: [
    v(101, "Trail Rain Jacket - Black / M", { Color: "Black", Size: "M" }, 9500),
    v(102, "Trail Rain Jacket - Black / L", { Color: "Black", Size: "L" }, 9500),
  ] },
  { id: "gid://shopify/Product/2", title: "Everyday Crew Sock", tags: "socks crew", variants: [
    v(201, "Everyday Crew Sock - Black", { Color: "Black", "Accessory size": "M" }, 1200),
    v(202, "Everyday Crew Sock - White", { Color: "White", "Accessory size": "M" }, 1200, false),
  ] },
  { id: "gid://shopify/Product/3", title: "Classic Cotton T-Shirt", tags: "t-shirt tee white", variants: [
    v(301, "Classic Cotton T-Shirt - White / L", { Color: "White", Size: "Large" }, 2500),
  ] },
  { id: "gid://shopify/Product/4", title: "Rib Knit Beanie", tags: "beanie hat", variants: [
    v(401, "Rib Knit Beanie - Grey", { Color: "Grey" }, 2000),
  ] },
  { id: "gid://shopify/Product/5", title: "Fleece Hoodie", tags: "hoodie sweatshirt", variants: [
    v(501, "Fleece Hoodie - Black / M", { Color: "Black", Size: "M" }, 7000),
    v(502, "Fleece Hoodie - Black / L", { Color: "Black", Size: "L" }, 7000),
  ] },
  { id: "gid://shopify/Product/6", title: "Road Running Shoe", tags: "running shoes sneakers", variants: [
    v(601, "Road Running Shoe - 10", { Size: "10" }, 5500),
  ] },
];

const total = lines => lines.reduce((s, l) => s + l.item.price * l.quantity, 0);
const totals = amount => [{ type: "subtotal", amount, display_text: "Subtotal" }, { type: "total", amount, display_text: "Total" }];

export function makeMockShop({ catalog = MOCK_CATALOG } = {}) {
  const variants = new Map(catalog.flatMap(p => p.variants.map(x => [x.id, { product: p, variant: x }])));
  const carts = new Map();
  const calls = [];
  const ok = sc => ({ isError: false, structuredContent: sc, content: [{ type: "text", text: "ok" }] });
  const err = msg => ({ isError: true, structuredContent: { messages: [{ type: "error", code: "invalid", content: msg }] } });

  function buildLines(shop, wanted, messages) {
    const lines = [];
    for (const w of wanted) {
      const hit = variants.get(w.item?.id);
      if (!hit || hit.variant.seller.domain !== shop) { messages.push({ type: "warning", code: "merchandise_not_found", content: `Item ${w.item?.id} not found` }); continue; }
      if (!hit.variant.availability.available) {
        messages.push({ type: "warning", content_type: "plain", code: "merchandise_out_of_stock", content: `The product '${hit.variant.title}' is already sold out.` });
        continue;
      }
      const tok = randomUUID().slice(0, 8);
      lines.push({
        id: w.id && w.id.startsWith("gid://shopify/CartLine/") ? w.id : `gid://shopify/CartLine/${randomUUID()}?cart=${tok}`,
        item: { id: hit.variant.id, title: hit.variant.title, price: hit.variant.price.amount },
        quantity: w.quantity, totals: totals(hit.variant.price.amount * w.quantity),
      });
    }
    return lines;
  }

  function cartDoc(id, shop, lines, messages) {
    return {
      ucp: {}, id, line_items: lines, currency: "USD", totals: totals(total(lines)),
      expires_at: "2099-01-01T00:00:00Z", messages, links: [], continue_url: `https://${shop}/cart/c/${id}?key=secret`,
      next: lines.length ? [] : ["This cart is empty. Report that state briefly; add items only if the user wants this basket changed."],
    };
  }

  async function call(name, args) {
    calls.push({ name, args });
    const cat = args?.catalog;
    switch (name) {
      case "search_catalog": {
        const words = String(cat?.query || "").toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const max = cat?.filters?.price?.max;
        const products = catalog
          .map(p => ({ p, score: words.filter(w => `${p.title} ${p.tags}`.toLowerCase().includes(w.replace(/s$/, ""))).length }))
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .map(x => ({ id: x.p.id, title: x.p.title, variants: x.p.variants.filter(vv => max == null || vv.price.amount <= max) }))
          .filter(p => p.variants.length)
          .slice(0, cat?.pagination?.limit ?? 10);
        return ok({ products, messages: [], next: [] });
      }
      case "lookup_catalog": {
        const ids = cat?.ids || [];
        const products = catalog
          .map(p => ({ id: p.id, title: p.title, variants: p.variants.filter(x => ids.includes(x.id) || ids.includes(p.id)) }))
          .filter(p => p.variants.length);
        return ok({ products, messages: [], next: [] });
      }
      case "get_product": {
        const p = catalog.find(pp => pp.id === cat?.id || pp.variants.some(x => x.id === cat?.id));
        if (!p) return err(`Product ${cat?.id} not found`);
        let vs = p.variants;
        for (const s of cat?.selected || []) vs = vs.filter(x => x.options.some(o => o.name === s.name && o.label === s.label));
        return ok({ product: { id: p.id, title: p.title, variants: p.variants, selected_variant: vs[0] ?? p.variants[0] }, messages: [], next: [] });
      }
      case "create_cart": {
        const messages = [];
        const id = `gid://shopify/Cart/mock-${randomUUID()}`;
        const doc = cartDoc(id, args.shop, buildLines(args.shop, args.cart?.line_items || [], messages), messages);
        carts.set(id, { shop: args.shop, doc });
        return ok(doc);
      }
      case "get_cart": {
        const c = carts.get(args.id);
        return c && c.shop === args.shop ? ok(c.doc) : err(`Cart ${args.id} not found`);
      }
      case "update_cart": {
        const c = carts.get(args.id);
        if (!c || c.shop !== args.shop) return err(`Cart ${args.id} not found`);
        const messages = [];
        c.doc = cartDoc(args.id, args.shop, buildLines(args.shop, args.cart?.line_items || [], messages), messages);
        return ok(c.doc);
      }
      default:
        return err(`Mock Shop has no tool ${name}`);
    }
  }
  return { call, carts, calls };
}
