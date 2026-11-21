import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "../app/server.mjs";

// Raw request so paths like /__evidence/../x are sent exactly as written.
function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath }, res => {
      let data = "";
      res.on("data", d => (data += d));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test("port 0 picks a free port and orders are recorded", async () => {
  const server = await startServer(0);
  try {
    assert.ok(server.port > 0);
    const r = await request(server.port, "POST", "/api/order", JSON.stringify({ items: { tee: 1 }, total: 20 }));
    assert.equal(r.status, 201);
    await request(server.port, "POST", "/api/order", "{not json");
    assert.deepEqual(server.orders, [{ items: { tee: 1 }, total: 20 }, { malformed: "{not json" }]);
    const list = await request(server.port, "GET", "/api/orders");
    assert.equal(JSON.parse(list.body).length, 2);
  } finally { server.close(); }
});

test("mutant is injected into the page, clean app has none", async () => {
  const bad = await startServer(0, "order_silently_fails");
  const clean = await startServer(0, "");
  try {
    assert.match((await request(bad.port, "GET", "/")).body, /window.__MUTANT__="order_silently_fails"/);
    assert.doesNotMatch((await request(clean.port, "GET", "/")).body, /__MUTANT__=/);
  } finally { bad.close(); clean.close(); }
});

test("busy port rejects instead of hanging", async () => {
  const a = await startServer(0);
  try {
    await assert.rejects(startServer(a.port), /EADDRINUSE/);
  } finally { a.close(); }
});

test("evidence uploads stay inside evidenceDir", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "agentproof-test-"));
  const evidenceDir = path.join(root, "evidence");
  const server = await startServer(0, "", { evidenceDir });
  try {
    assert.equal((await request(server.port, "POST", "/__evidence/final.png", "png")).status, 201);
    assert.equal((await request(server.port, "POST", "/__evidence/..%2F..%2Fescape.txt", "x")).status, 201);
    assert.equal((await request(server.port, "POST", "/__evidence/../raw.txt", "y")).status, 201);
    assert.equal((await request(server.port, "POST", "/__evidence/%E0%A4%A", "z")).status, 201); // bad encoding
    assert.deepEqual(readdirSync(root), ["evidence"], "nothing written outside evidenceDir");
    assert.deepEqual(readdirSync(evidenceDir).sort(), ["escape.txt", "final.png", "raw.txt", "upload.bin"]);
    assert.equal(readFileSync(path.join(evidenceDir, "final.png"), "utf8"), "png");
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("oversize evidence gets 413 and is not saved", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "agentproof-test-"));
  const server = await startServer(0, "", { evidenceDir: root, maxEvidenceBytes: 10 });
  try {
    const r = await request(server.port, "POST", "/__evidence/big.bin", "x".repeat(100));
    assert.equal(r.status, 413);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
