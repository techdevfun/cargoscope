/** unit tests: compare math */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareManifests } from "../dist/compare.js";

function manifest(wall, crates, link = null) {
  return {
    version: 1,
    tool: "cargoscope",
    measuredAt: new Date().toISOString(),
    profile: "dev",
    nightly: link !== null,
    analysis: {
      wallSeconds: wall,
      units: crates.length,
      sumUnitSeconds: wall,
      topCrates: crates.map(([name, d]) => ({
        key: `${name}@0.1.0#lib`,
        name,
        version: "0.1.0",
        target: "lib",
        duration: d,
        rmetaTime: null,
        share: 0,
      })),
      codegenLinkSeconds: 0,
      linkSeconds: link,
      buildScripts: [],
      rerunningBuildScripts: 0,
      recompiledUnits: crates.length,
      nightly: link !== null,
    },
  };
}

test("delta math: wall pct and per-crate wins", () => {
  const before = manifest(20, [["slowdep", 9], ["serde", 6]], 3);
  const after = manifest(15, [["slowdep", 5], ["serde", 6]], 1.5);
  const c = compareManifests(before, after);
  assert.equal(c.beforeWall, 20);
  assert.equal(c.afterWall, 15);
  assert.equal(c.wallDeltaPct, -25);
  assert.equal(c.biggestWins[0].name, "slowdep");
  assert.equal(c.biggestWins[0].delta, -4);
  assert.ok(c.verdict.includes("-25.0%"));
  assert.ok(c.verdict.includes("faster"));
});

test("slower verdict when wall grows", () => {
  const c = compareManifests(manifest(10, [["a", 5]]), manifest(12, [["a", 7]]));
  assert.ok(c.verdict.includes("+20.0%"));
  assert.ok(c.verdict.includes("slower"));
});

test("link share line only when both sides have link seconds", () => {
  const c1 = compareManifests(manifest(10, [["a", 5]], 2), manifest(9, [["a", 4]], 1));
  assert.ok(c1.verdict.includes("link"));
  const c2 = compareManifests(manifest(10, [["a", 5]]), manifest(9, [["a", 4]]));
  assert.ok(!c2.verdict.includes("link"));
});

test("removed crate counts as a win", () => {
  const c = compareManifests(
    manifest(10, [["a", 5], ["gone", 3]]),
    manifest(7, [["a", 5]])
  );
  assert.ok(c.biggestWins.some((d) => d.name === "gone" && d.delta === -3));
});
