import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "../app/server.mjs";

function request(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, res => {
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

test("oversize order gets 413 and is not recorded", async () => {
  const server = await startServer(0, "", { maxOrderBytes: 32 });
  try {
    const r = await request(server.port, "POST", "/api/order", "x".repeat(128));
    assert.equal(r.status, 413);
    assert.deepEqual(server.orders, []);
  } finally {
    server.close();
  }
});
