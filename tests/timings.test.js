/** unit tests: timings parser (HTML UNIT_DATA format) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimingsHtml, parseTimingsJson, isBuildScriptUnit, isBinUnit, unitKey } from "../dist/timings.js";

const HTML = `<html><head><script>
const UNIT_DATA = [
  {"i": 1, "name": "serde", "version": "1.0.228", "target": "", "start": 0.0, "duration": 12.5,
   "sections": [["frontend", {"start": 0.0, "end": 6.0}], ["codegen", {"start": 6.0, "end": 12.5}]]},
  {"i": 2, "name": "app", "version": "0.1.0", "target": " app \\"bin\\"", "start": 12.5, "duration": 3.2},
  {"i": 3, "name": "corelib", "version": "0.1.0", "target": " build-script (run)", "start": 1.0, "duration": 0.4},
  {"i": 4, "name": "corelib", "version": "0.1.0", "target": " build-script", "start": 0.5, "duration": 0.3},
  {"name": 42, "start": "x"}
];
const CONCURRENCY_DATA = [];
</script></head></html>`;

test("parses UNIT_DATA and normalizes target labels", () => {
  const units = parseTimingsHtml(HTML);
  assert.equal(units.length, 4);
  assert.equal(units[0].target, "lib");
  assert.equal(units[1].target, "bin");
  assert.equal(units[2].target, "build-script-run");
  assert.equal(units[3].target, "build-script-build");
  assert.equal(units[0].end, 12.5);
  assert.deepEqual(units[0].sections[0], ["frontend", { start: 0.0, end: 6.0 }]);
  assert.equal(units[1].sections, null);
});

test("skips units missing name/start/duration", () => {
  const units = parseTimingsHtml(HTML);
  assert.ok(units.every((u) => typeof u.name === "string"));
});

test("rejects HTML without UNIT_DATA", () => {
  assert.throws(() => parseTimingsHtml("<html></html>"), /no UNIT_DATA/);
});

test("legacy JSON format still parses", () => {
  const units = parseTimingsJson(
    JSON.stringify([
      { name: "serde", version: "1.0.0", target: "lib", duration: 5, start: 0, end: 5 },
      { name: "x", target: "lib" },
    ])
  );
  assert.equal(units.length, 1);
  assert.equal(units[0].target, "lib");
});

test("unit kind classifiers", () => {
  const units = parseTimingsHtml(HTML);
  assert.ok(isBuildScriptUnit(units[2]));
  assert.ok(isBuildScriptUnit(units[3]));
  assert.ok(!isBuildScriptUnit(units[0]));
  assert.ok(isBinUnit(units[1]));
  assert.ok(!isBinUnit(units[0]));
});

test("unitKey is stable and distinguishes target kinds", () => {
  const units = parseTimingsHtml(HTML);
  assert.equal(unitKey(units[0]), "serde@1.0.228#lib");
  assert.equal(unitKey(units[1]), 'app@0.1.0#bin');
  assert.notEqual(unitKey(units[2]), unitKey(units[3]));
});
