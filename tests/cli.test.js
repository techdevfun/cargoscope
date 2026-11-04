/** unit tests: --flag=value parsing (cargo users write --profile=release) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../dist/cli.js";

test("parseArgs accepts --profile=release", () => {
  const { cmd, opts } = parseArgs(["cargoscope", "measure", "--profile=release"]);
  assert.equal(cmd, "measure");
  assert.equal(opts.profile, "release");
});

test("parseArgs accepts --json=out.json", () => {
  const { opts } = parseArgs(["cargoscope", "measure", "--json=out.json"]);
  assert.equal(opts.jsonOut, "out.json");
});

test("parseArgs accepts --from=m.json with --nightly-ok", () => {
  const { cmd, opts } = parseArgs(["cargoscope", "recommend", "--from=m.json", "--nightly-ok"]);
  assert.equal(cmd, "recommend");
  assert.equal(opts.from, "m.json");
  assert.equal(opts.nightlyOk, true);
});

test("parseArgs still accepts space-separated values", () => {
  const { opts } = parseArgs(["cargoscope", "measure", "--profile", "release", "--json", "o.json"]);
  assert.equal(opts.profile, "release");
  assert.equal(opts.jsonOut, "o.json");
});

test("parseArgs rejects --flag=value on boolean flags", () => {
  assert.throws(() => parseArgs(["cargoscope", "measure", "--nightly-ok=yes"]), /unknown flag/);
});

test("parseArgs still rejects unknown flags", () => {
  assert.throws(() => parseArgs(["cargoscope", "measure", "--nope"]), /unknown flag/);
});
