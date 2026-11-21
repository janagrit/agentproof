import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCli, list } from "../src/cli.mjs";

const spec = { flags: ["mock", "redo"], options: { tag: "v1", tasks: undefined } };

test("defaults, flags and options", () => {
  assert.deepEqual({ ...parseCli(spec, []) }, { mock: false, redo: false, tag: "v1" });
  const a = parseCli(spec, ["--mock", "--tag", "v2", "--tasks", "one_tee,cap_and_tee"]);
  assert.equal(a.mock, true);
  assert.equal(a.tag, "v2");
  assert.deepEqual(list(a.tasks), ["one_tee", "cap_and_tee"]);
  // Order no longer matters: the old parser read "--tag" as the value of --redo.
  assert.equal(parseCli(spec, ["--redo", "--tag", "v3"]).tag, "v3");
});

test("list", () => {
  assert.equal(list(undefined), undefined);
  assert.equal(list(""), undefined);
  assert.deepEqual(list("a, b,,c "), ["a", "b", "c"]);
});
