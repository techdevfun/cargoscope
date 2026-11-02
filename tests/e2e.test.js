/** e2e: real `cargo cargoscope measure` on examples/sample-crate.
 * Skips gracefully when cargo is not installed (CI installs the toolchain).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "index.js");

async function hasCargo() {
  try {
    await run("cargo", ["--version"], { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

test("e2e measure on the sample crate", { timeout: 240000 }, async (t) => {
  if (!(await hasCargo())) {
    t.skip("cargo not installed");
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "cargoscope-e2e-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  cpSync(join(ROOT, "examples", "sample-crate"), join(tmp, "crate"), { recursive: true });

  // install the CLI on PATH as cargo-cargoscope
  const bindir = join(tmp, "bin");
  const { mkdirSync, chmodSync } = await import("node:fs");
  mkdirSync(bindir, { recursive: true });
  writeFileSync(join(bindir, "cargo-cargoscope"), `#!/bin/sh\nexec node "${CLI}" "$@"\n`);
  chmodSync(join(bindir, "cargo-cargoscope"), 0o755);

  const env = { ...process.env, PATH: `${bindir}:${process.env.PATH}` };
  const crate = join(tmp, "crate");
  const manifest = join(tmp, "before.json");

  // build the CLI first (dist must exist); run measure through cargo itself
  const r1 = await run("cargo", ["cargoscope", "measure", "--json", manifest], {
    cwd: crate,
    env,
    timeout: 180000,
  });
  const out = r1.stdout + r1.stderr;
  assert.ok(out.includes("wall time"), "measure prints wall time");
  assert.ok(out.includes("top crates"), "measure prints top crates");
  assert.ok(out.includes("RE-RUNS ON EVERY BUILD"), "fixture build script is flagged");
  assert.ok(existsSync(manifest), "manifest written");

  const saved = JSON.parse((await import("node:fs")).readFileSync(manifest, "utf8"));
  assert.ok(saved.analysis.wallSeconds > 0, "wall time recorded");
  const names = saved.analysis.topCrates.map((c) => c.name);
  assert.ok(names.includes("corelib"), "corelib ranked");
  assert.ok(names.includes("app"), "app ranked");
  const corelib = saved.analysis.buildScripts.find((s) => s.crate === "corelib");
  assert.ok(corelib && corelib.rerunsEveryBuild, "corelib script flagged in manifest");

  // recommend: stable-safe subset on this stable toolchain
  const r2 = await run("cargo", ["cargoscope", "recommend", "--from", manifest], {
    cwd: crate,
    env,
    timeout: 60000,
  });
  assert.ok(r2.stdout.includes("cargo check"), "check recommendation present");
  assert.ok(!r2.stdout.includes("Cranelift"), "no nightly item without --nightly-ok");

  // compare: same manifest vs itself -> 0% delta
  const r3 = await run("cargo", ["cargoscope", "compare", manifest, manifest], {
    cwd: crate,
    env,
    timeout: 60000,
  });
  assert.ok(r3.stdout.includes("+0.0%"), "self-compare is 0%");
});
