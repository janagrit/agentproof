import { test } from "node:test";
import assert from "node:assert/strict";
import { startViewer } from "../scripts/demo-viewer.mjs";

test("demo viewer serves HTML, run index, and rejects unknown runs cleanly", async () => {
  const s = await startViewer(0);
  try {
    const base = `http://localhost:${s.port}`;
    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /AgentProof/);

    const list = await fetch(`${base}/api/runs`);
    assert.equal(list.status, 200);
    const runs = await list.json();
    assert.ok(Array.isArray(runs));

    const miss = await fetch(`${base}/api/run/store/does_not_exist_xyz`);
    assert.equal(miss.status, 404);

    if (runs.some(r => r.kind === "store" && r.hasVideo)) {
      const vidRun = runs.find(r => r.kind === "store" && r.hasVideo);
      const badRange = await fetch(`${base}/media/${encodeURIComponent(vidRun.id)}/video.mp4`, {
        headers: { Range: "bytes=999999999-9999999999" },
      });
      assert.equal(badRange.status, 416);
    }
  } finally {
    s.close();
  }
});
