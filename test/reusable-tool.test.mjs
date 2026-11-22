import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { MODELS, tagAndListElements, captureDomSnapshot } from "../index.mjs";
import { handleMcpRequest, MCP_TOOLS } from "../src/mcp-server.mjs";

test("MODELS resolves environment variables lazily when set after import", () => {
  const prev = process.env.MODEL_PERCEIVE;
  try {
    process.env.MODEL_PERCEIVE = "gemini-4-hydrogen-test";
    assert.equal(MODELS.perceive, "gemini-4-hydrogen-test");
  } finally {
    if (prev === undefined) delete process.env.MODEL_PERCEIVE;
    else process.env.MODEL_PERCEIVE = prev;
  }
});

test("MCP server initializes and lists agentproof_check_url & agentproof_verify_run tools", async () => {
  const initRes = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(initRes.result.serverInfo.name, "agentproof");

  const listRes = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(listRes.result.tools.length, MCP_TOOLS.length);
  assert.deepEqual(
    listRes.result.tools.map(t => t.name),
    ["agentproof_check_url", "agentproof_verify_run"],
  );
});

test("tagAndListElements and captureDomSnapshot index apps without data-testid attributes", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html><head><title>Moisha Test</title></head><body>
        <h1>Sunny DuPont Studio</h1>
        <label for="airbnb-url">Airbnb listing URL</label>
        <input id="airbnb-url" type="url" value="https://www.airbnb.com/rooms/44444444" />
        <button type="button">Continue to dashboard</button>
        <a href="https://www.airbnb.com/rooms/44444445">Open on Airbnb</a>
      </body></html>
    `);

    const listing = await tagAndListElements(page);
    assert.match(listing, /e1 \(input:url\).*label="Airbnb listing URL"/);
    assert.match(listing, /e2 \(button:button\).*"Continue to dashboard"/);
    assert.match(listing, /e3 \(a\).*"Open on Airbnb"/);

    const snap = await captureDomSnapshot(page);
    assert.equal(snap.title, "Moisha Test");
    assert.equal(snap.links[0].href, "https://www.airbnb.com/rooms/44444445");
  } finally {
    await browser.close();
  }
});
