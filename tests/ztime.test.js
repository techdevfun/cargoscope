/** unit tests: nightly -Ztime stderr parser (link-step timing) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseZTime } from "../dist/cargo.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(here, "fixtures", "ztime-nightly.stderr.txt"), "utf8");

const approx = (a, b) => Math.abs(a - b) < 1e-9;

test("parses linking seconds from a -Ztime line", () => {
  const passes = parseZTime("time:  0.123s  linking\n");
  assert.ok(approx(passes.get("linking"), 0.123));
});

test("sums the linking pass across crates (recorded-format fixture)", () => {
  const passes = parseZTime(FIXTURE);
  // corelib 0.231s + app 0.119s — the value cli.ts reads for linkSeconds
  assert.ok(approx(passes.get("linking"), 0.35));
});

test("multi-word pass names resolve to their last token", () => {
  const passes = parseZTime(FIXTURE);
  // "codegen passes" and "LLVM passes" both end in "passes"
  assert.ok(approx(passes.get("passes"), 0.412 + 0.088 + 0.305 + 0.071));
  assert.ok(approx(passes.get("checking"), 0.012 + 0.009));
});

test("ignores cargo build lines and warnings", () => {
  const passes = parseZTime(
    "   Compiling foo v0.1.0 (/tmp/foo)\nwarning: unused variable: `x`\n    Finished `dev` profile in 1.20s\n"
  );
  assert.equal(passes.size, 0);
});

test("ignores malformed time lines", () => {
  const passes = parseZTime("time: linking\ntime: abcs linking\ntime:  s  linking\n");
  assert.equal(passes.size, 0);
});

test("empty stderr yields an empty map", () => {
  assert.equal(parseZTime("").size, 0);
});

test("stable stderr (no -Ztime) has no linking key", () => {
  // cli.ts only fills linkSeconds when passes.get("linking") is defined;
  // on stable the link time stays inseparable from codegen+link by design.
  const passes = parseZTime("   Compiling foo v0.1.0\n    Finished `dev` profile in 0.42s\n");
  assert.equal(passes.get("linking"), undefined);
});
