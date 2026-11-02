/** unit tests: analysis (ranking, re-run detection, codegen+link) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeBuild } from "../dist/analysis.js";

function unit(name, version, target, duration, start = 0) {
  return { name, version, target, duration, rmetaTime: null, start, end: start + duration };
}
function build(units, wall = 20, nightly = false) {
  return { wallSeconds: wall, units, timingsPath: "/x", stdout: "", stderr: "", exitCode: 0, nightly };
}

const FIRST = [
  unit("slowdep", "0.2.0", "lib", 9.0),
  unit("serde", "1.0.0", "lib", 6.0),
  unit("corelib", "0.1.0", "lib", 2.0),
  unit("corelib", "0.1.0", "build-script-build", 0.3),
  unit("corelib", "0.1.0", "build-script-run", 0.4),
  unit("app", "0.1.0", "bin", 2.0),
];
// no-change rebuild: everything fresh except the build script re-ran
const SECOND = [
  unit("slowdep", "0.2.0", "lib", 0.01),
  unit("serde", "1.0.0", "lib", 0.01),
  unit("corelib", "0.1.0", "lib", 0.01),
  unit("corelib", "0.1.0", "build-script-build", 0.3),
  unit("corelib", "0.1.0", "build-script-run", 0.35),
  unit("app", "0.1.0", "bin", 0.5),
];

test("top crates ranked by duration, build scripts excluded", () => {
  const a = analyzeBuild(build(FIRST), build(SECOND));
  assert.equal(a.topCrates[0].name, "slowdep");
  assert.equal(a.topCrates[1].name, "serde");
  assert.ok(!a.topCrates.some((c) => c.target.includes("build-script")));
});

test("build script flagged as re-running on every build", () => {
  const a = analyzeBuild(build(FIRST), build(SECOND));
  const s = a.buildScripts.find((x) => x.crate === "corelib");
  assert.ok(s, "corelib script present");
  assert.equal(s.rerunsEveryBuild, true);
  assert.equal(a.rerunningBuildScripts, 1);
});

test("well-behaved script (absent from no-change rebuild) is not flagged", () => {
  const calm = SECOND.filter((u) => u.target !== "build-script-run");
  const a = analyzeBuild(build(FIRST), build(calm));
  const s = a.buildScripts.find((x) => x.crate === "corelib");
  assert.equal(s.rerunsEveryBuild, false);
});

test("codegen+link seconds = sum of bin units", () => {
  const a = analyzeBuild(build(FIRST));
  assert.equal(a.codegenLinkSeconds, 2.0);
});

test("recompiledUnits counts only units above threshold", () => {
  const a = analyzeBuild(build(SECOND));
  // 0.01 < 0.05 threshold: build-script-build 0.3, build-script-run 0.35, bin 0.5
  assert.equal(a.recompiledUnits, 3);
});
