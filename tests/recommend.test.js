/** unit tests: recommendation rules */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recommend } from "../dist/recommend.js";

function analysis(over = {}) {
  return {
    wallSeconds: 20,
    units: 6,
    sumUnitSeconds: 30,
    topCrates: [],
    codegenLinkSeconds: 4,
    linkSeconds: null,
    buildScripts: [],
    rerunningBuildScripts: 0,
    recompiledUnits: 6,
    nightly: false,
    ...over,
  };
}

test("stable subset excludes nightly items", () => {
  const recs = recommend(analysis(), false, "linux");
  assert.ok(recs.some((r) => r.id === "cargo-check"));
  assert.ok(recs.some((r) => r.id === "mold-linker"));
  assert.ok(!recs.some((r) => r.id === "cranelift"));
  assert.ok(recs.every((r) => !r.requiresNightly));
});

test("nightly-ok includes cranelift last", () => {
  const recs = recommend(analysis(), true, "linux");
  assert.ok(recs.some((r) => r.id === "cranelift"));
  const idx = recs.findIndex((r) => r.id === "cranelift");
  assert.equal(idx, recs.length - 1, "nightly item ranks last");
});

test("cheapest-first ordering", () => {
  const recs = recommend(analysis(), false, "linux");
  const rank = { free: 0, config: 1, install: 2, nightly: 3 };
  for (let i = 1; i < recs.length; i++) {
    assert.ok(rank[recs[i].cost] >= rank[recs[i - 1].cost], "sorted by cost");
  }
  assert.equal(recs[0].id, "cargo-check");
});

test("re-run fix appears only when a script re-runs", () => {
  assert.ok(!recommend(analysis(), false, "linux").some((r) => r.id === "rerun-if-changed"));
  const flagged = recommend(analysis({ rerunningBuildScripts: 1 }), false, "linux");
  assert.ok(flagged.some((r) => r.id === "rerun-if-changed"));
});

test("mold recommendation only on linux", () => {
  assert.ok(!recommend(analysis(), false, "darwin").some((r) => r.id === "mold-linker"));
});
